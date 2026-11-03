"""HU016 SQL real PostgreSQL 18.6, laboratorio exclusivo y regresiones intactas."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
import signal
import sys
import time
import unittest

from run_inicio_practica import ROOT
from run_historial_seguimiento import connection, suite as read_follow, SafeResult
from run_registro_seguimiento import SeguimientoPostgres, make_suite as write_follow
from run_registro_incidencia import suite as write_incidence
from run_consulta_incidencias import suite as read_incidence, snapshot

FILES = [ROOT/'scripts/BD/fixes'/name for name in (
    'ep06-05-permisos-estados-incidencias.sql',
    'ep06-06-cambiar-estado-incidencia.sql',
    'ep06-07-consultar-historial-incidencia.sql')]
CHANGE = 'SELECT incidencias_privadas.fn_cambiar_estado_incidencia(%s,%s,%s,%s,%s,%s)'
READ = 'SELECT incidencias_privadas.fn_consultar_historial_incidencia(%s,%s,%s,%s,%s)'
REGISTER = 'SELECT incidencias_privadas.fn_registrar_incidencia(%s,%s,%s,%s)'


def suite(pg):
    import psycopg
    with connection(pg) as db:
        def apply(path):
            try:
                db.execute(path.read_text())
            except psycopg.Error as error:
                # Solo DDL versionado HU016, sin datos/credenciales de conexión.
                print('DDL HU016:', path.name, error.sqlstate, error.diag.message_primary, flush=True)
                raise
        before = snapshot(db)
        funcs = db.execute("""SELECT oid,pg_get_functiondef(oid),proacl::text FROM pg_proc
            WHERE pronamespace IN ('incidencias_privadas'::regnamespace,
            'seguimientos_privados'::regnamespace,'practicas_privadas'::regnamespace) ORDER BY oid""").fetchall()
        for setup, undo in [
            ('GRANT CREATE ON SCHEMA public TO PUBLIC','REVOKE CREATE ON SCHEMA public FROM PUBLIC'),
            ('ALTER TABLE incidencia DISABLE ROW LEVEL SECURITY','ALTER TABLE incidencia ENABLE ROW LEVEL SECURITY'),
            ('GRANT UPDATE(comentario) ON historial_estado_incidencia TO PUBLIC','REVOKE UPDATE(comentario) ON historial_estado_incidencia FROM PUBLIC'),
            ('GRANT USAGE ON SEQUENCE historial_estado_incidencia_id_historial_seq TO PUBLIC','REVOKE USAGE ON SEQUENCE historial_estado_incidencia_id_historial_seq FROM PUBLIC'),
            ('ALTER TABLE incidencia DISABLE TRIGGER ep06_no_delete','ALTER TABLE incidencia ENABLE TRIGGER ep06_no_delete')]:
            db.execute(setup)
            try:
                try:
                    apply(FILES[0])
                except psycopg.errors.RaiseException:
                    db.execute('ROLLBACK')
                else:
                    raise AssertionError('Preflight accepted incompatible environment')
                assert not db.execute("SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='pl_ep06_state_owner')").fetchone()[0]
            finally:
                db.execute('ROLLBACK')
                db.execute(undo)
        apply(FILES[0])
        db.execute('ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO ep05_test_client')
        try:
            for path in FILES[1:]:
                apply(path)
        finally:
            db.execute('ROLLBACK')
            db.execute('ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM ep05_test_client')
        assert before == snapshot(db)
        assert funcs == db.execute('SELECT oid,pg_get_functiondef(oid),proacl::text FROM pg_proc WHERE oid=ANY(%s) ORDER BY oid',
                                   ([r[0] for r in funcs],)).fetchall()

    class EstadoTests(unittest.TestCase):
        def setUp(self):
            self.admin = connection(pg)
            self.addCleanup(self.admin.close)
            self.db = connection(pg,'ep06_test_login')
            self.addCleanup(self.db.close)
            self.practice = self.new_practice()
            self.incidence = self.new_incidence()
            self.initial = self.events()

        def new_practice(self, state='EN_CURSO'):
            return self.admin.execute("""INSERT INTO practica(id_estudiante,id_centro,id_estado_actual)
                SELECT 100,100,id_estado FROM estado_practica WHERE nombre=%s RETURNING id_practica""",(state,)).fetchone()[0]

        def new_incidence(self):
            return self.db.execute(REGISTER,(self.practice,101,'SALUD','Descripción sintética')).fetchone()[0]['id_incidencia']

        def change(self, expected='PENDIENTE', new='EN_ATENCION', comment=None, actor=101, practice=None, incidence=None, db=None):
            return (db or self.db).execute(CHANGE,(self.practice if practice is None else practice,
                self.incidence if incidence is None else incidence,actor,expected,new,comment)).fetchone()[0]

        def read(self, actor=101, practice=None, incidence=None, limit=50, offset=0):
            return self.db.execute(READ,(self.practice if practice is None else practice,
                self.incidence if incidence is None else incidence,actor,limit,offset)).fetchone()[0]

        def events(self):
            return self.admin.execute('SELECT to_jsonb(h) FROM historial_estado_incidencia h WHERE id_incidencia=%s ORDER BY id_historial',(self.incidence,)).fetchall()

        def row(self):
            return self.admin.execute('SELECT to_jsonb(i) FROM incidencia i WHERE id_incidencia=%s',(self.incidence,)).fetchone()[0]

        def reject(self, code, **kwargs):
            before = (self.row(),self.events())
            self.assertEqual(self.change(**kwargs),{'error':code})
            self.assertEqual((self.row(),self.events()),before)

        def wait_blocked(self, pid):
            end=time.monotonic()+4
            while time.monotonic()<end:
                if self.admin.execute('SELECT cardinality(pg_blocking_pids(%s))>0',(pid,)).fetchone()[0]:
                    return
                time.sleep(.02)
            self.fail('No observed database lock wait')

        def test_success_roles_chain_creation_preserved(self):
            original=self.row()
            first=self.change(comment='  Atención  ')
            self.assertEqual(first['estado_anterior'],'PENDIENTE')
            self.assertEqual(first['estado_nuevo'],'EN_ATENCION')
            self.assertEqual(first['comentario'],'Atención')
            self.assertEqual(first['id_usuario'],101)
            second=self.change(expected='EN_ATENCION',new='RESUELTA',comment='  Resuelto  ',actor=102)
            self.assertEqual(second['id_usuario'],102)
            self.assertEqual(self.events()[:1],self.initial)
            self.assertEqual(len(self.events()),3)
            row=self.row()
            for key in original.keys()-{'estado','fecha_resolucion'}:
                self.assertEqual(row[key],original[key])
            self.assertEqual(row['estado'],'RESUELTA')
            self.assertEqual(datetime.fromisoformat(row['fecha_resolucion']),datetime.fromisoformat(second['fecha']))
            self.assertEqual(self.events()[-1][0]['fecha'],row['fecha_resolucion'])

        def test_direct_resolution_server_time_and_hu015_get(self):
            before=self.admin.execute('SELECT clock_timestamp()').fetchone()[0]
            result=self.change(new='RESUELTA',comment='Solución')
            after=self.admin.execute('SELECT clock_timestamp()').fetchone()[0]
            self.assertTrue(before<=datetime.fromisoformat(result['fecha'])<=after)
            get=self.db.execute('SELECT incidencias_privadas.fn_consultar_incidencias(%s,101)',(self.practice,)).fetchone()[0]
            self.assertEqual(get['items'][0]['resolucion']['id_historial'],result['id_historial'])
            self.assertEqual(get['items'][0]['resolucion']['comentario'],'Solución')

        def test_all_repetitions_regressions_reopening(self):
            self.reject('TRANSICION_NO_PERMITIDA',new='PENDIENTE')
            self.change()
            for new in ('PENDIENTE','EN_ATENCION'):
                self.reject('TRANSICION_NO_PERMITIDA',expected='EN_ATENCION',new=new)
            self.change(expected='EN_ATENCION',new='RESUELTA',comment='Listo')
            for new in ('PENDIENTE','EN_ATENCION','RESUELTA'):
                self.reject('TRANSICION_NO_PERMITIDA',expected='RESUELTA',new=new,comment='No repetir')

        def test_invalid_states_and_stale(self):
            for state in (None,'ABIERTA','en_atencion',"RESUELTA'; DROP TABLE incidencia;--"):
                self.reject('ESTADO_INVALIDO',new=state)
                self.reject('ESTADO_INVALIDO',expected=state)
            self.change()
            self.reject('ESTADO_DESACTUALIZADO',new='RESUELTA',comment='Vieja pantalla')

        def test_invalid_identifiers(self):
            for bad in (None,0,-1):
                self.assertEqual(self.db.execute(CHANGE,(bad,self.incidence,101,'PENDIENTE','EN_ATENCION',None)).fetchone()[0],{'error':'IDENTIFICADOR_INVALIDO'})
                self.assertEqual(self.db.execute(CHANGE,(self.practice,bad,101,'PENDIENTE','EN_ATENCION',None)).fetchone()[0],{'error':'IDENTIFICADOR_INVALIDO'})
                self.assertEqual(self.db.execute(READ,(bad,self.incidence,101,50,0)).fetchone()[0],{'error':'IDENTIFICADOR_INVALIDO'})

        def test_auth_and_non_disclosure(self):
            for actor in (None,0,-1,100,999999):
                self.reject('USUARIO_NO_AUTORIZADO',actor=actor,practice=999999)
                self.assertEqual(self.read(actor=actor,practice=999999),{'error':'USUARIO_NO_AUTORIZADO'})
            for setup,undo in [
                ('UPDATE usuario SET activo=false WHERE id_usuario=101','UPDATE usuario SET activo=true WHERE id_usuario=101'),
                ("UPDATE rol SET activo=false WHERE nombre='GESTOR'","UPDATE rol SET activo=true WHERE nombre='GESTOR'")]:
                self.admin.execute(setup)
                try:
                    self.reject('USUARIO_NO_AUTORIZADO')
                    self.assertEqual(self.read(),{'error':'USUARIO_NO_AUTORIZADO'})
                finally:self.admin.execute(undo)

        def test_negative_actor_is_rejected_even_if_present_and_authorized(self):
            self.admin.execute("INSERT INTO usuario(id_usuario,nombre,apellido,correo,password_hash) VALUES(-101,'Sintético','Negativo','negative@example.invalid','not-a-password')")
            self.admin.execute("INSERT INTO usuario_rol SELECT -101,id_rol FROM rol WHERE nombre='GESTOR'")
            try:
                self.reject('USUARIO_NO_AUTORIZADO',actor=-101)
                self.assertEqual(self.read(actor=-101),{'error':'USUARIO_NO_AUTORIZADO'})
            finally:
                self.admin.execute('DELETE FROM usuario_rol WHERE id_usuario=-101')
                self.admin.execute('DELETE FROM usuario WHERE id_usuario=-101')

        def test_missing_and_association(self):
            for practice,incidence,code in [(999999,self.incidence,'PRACTICA_NO_ENCONTRADA'),
                (self.practice,999999,'INCIDENCIA_NO_ENCONTRADA'),
                (self.new_practice(),self.incidence,'INCIDENCIA_NO_ENCONTRADA')]:
                self.reject(code,practice=practice,incidence=incidence)
                self.assertEqual(self.read(practice=practice,incidence=incidence),{'error':code})

        def test_comment_required_whitespace_and_unicode_limits(self):
            for text in (None,'','   ','\t\n ','x'*2001,'😀'*2001):
                self.reject('COMENTARIO_INVALIDO',new='RESUELTA',comment=text)
            result=self.change(new='RESUELTA',comment='  '+'😀'*2000+'  ')
            self.assertEqual(result['comentario'],'😀'*2000)

        def test_optional_comment_normalization_and_limits(self):
            for text in (None,'','   ','\t\n'):
                self.incidence=self.new_incidence()
                self.assertIsNone(self.change(comment=text)['comentario'])
            self.incidence=self.new_incidence()
            self.reject('COMENTARIO_INVALIDO',comment='x'*2001)
            self.assertEqual(self.change(comment='x'*2000)['comentario'],'x'*2000)

        def test_finalized_existing_allowed_new_forbidden(self):
            self.admin.execute("UPDATE practica SET id_estado_actual=(SELECT id_estado FROM estado_practica WHERE nombre='FINALIZADA') WHERE id_practica=%s",(self.practice,))
            self.assertEqual(self.change(new='RESUELTA',comment='Cierre posterior')['estado_nuevo'],'RESUELTA')
            self.assertEqual(self.db.execute(REGISTER,(self.practice,101,'OTRO','No crear')).fetchone()[0],{'error':'PRACTICA_NO_EN_CURSO'})
            self.assertEqual(len(self.read()['items']),2)

        def test_inactive_type_and_original_author_do_not_block_other_actor(self):
            self.admin.execute('UPDATE usuario SET activo=false WHERE id_usuario=101')
            self.admin.execute("UPDATE tipo_incidencia SET activo=false WHERE codigo='SALUD'")
            try:self.assertEqual(self.change(actor=102)['id_usuario'],102)
            finally:
                self.admin.execute('UPDATE usuario SET activo=true WHERE id_usuario=101')
                self.admin.execute("UPDATE tipo_incidencia SET activo=true WHERE codigo='SALUD'")

        def test_legacy_preserved_and_readable_without_synthetic_events(self):
            rows=self.admin.execute('SELECT id_incidencia,id_practica FROM incidencia WHERE id_tipo_incidencia IS NULL').fetchall()
            self.assertGreater(len(rows),0)
            before=snapshot(self.admin)
            for identifier,practice in rows:
                self.assertEqual(self.change(incidence=identifier,practice=practice),{'error':'INCIDENCIA_NO_GESTIONABLE'})
                self.assertEqual(self.read(incidence=identifier,practice=practice)['items'],[])
            self.assertEqual(snapshot(self.admin),before)

        def test_missing_initial_trace_rejected(self):
            self.incidence=self.admin.execute("""INSERT INTO incidencia(id_practica,id_usuario,id_tipo_incidencia,descripcion)
                SELECT %s,101,id_tipo_incidencia,'Texto' FROM tipo_incidencia WHERE codigo='OTRO' RETURNING id_incidencia""",(self.practice,)).fetchone()[0]
            self.reject('HISTORIAL_INCONSISTENTE')
            self.assertEqual(self.read()['items'],[])

        def test_chain_discontinuity_even_when_last_state_matches(self):
            self.change()
            # Cada evento es válido individualmente; la cadena repite origen PENDIENTE.
            self.admin.execute("""INSERT INTO historial_estado_incidencia(id_incidencia,id_usuario,estado_anterior,estado_nuevo,fecha)
                VALUES(%s,101,'PENDIENTE','EN_ATENCION',clock_timestamp())""",(self.incidence,))
            self.reject('HISTORIAL_INCONSISTENTE',expected='EN_ATENCION',new='RESUELTA',comment='No resolver')

        def test_duplicate_initial_trace(self):
            self.admin.execute("""INSERT INTO historial_estado_incidencia(id_incidencia,id_usuario,estado_anterior,estado_nuevo,fecha)
                SELECT id_incidencia,id_usuario,NULL,'PENDIENTE',fecha FROM incidencia WHERE id_incidencia=%s""",(self.incidence,))
            self.reject('HISTORIAL_INCONSISTENTE')

        def test_initial_actor_date_and_current_state_consistency(self):
            for update in [
                'UPDATE historial_estado_incidencia SET id_usuario=102 WHERE id_incidencia=%s',
                "UPDATE historial_estado_incidencia SET fecha=fecha+interval '1 second' WHERE id_incidencia=%s",
                "UPDATE incidencia SET estado='EN_ATENCION' WHERE id_incidencia=%s",
                'UPDATE incidencia SET fecha_resolucion=clock_timestamp() WHERE id_incidencia=%s']:
                self.admin.execute('BEGIN')
                # Test in same admin transaction so injected inconsistency isn't persisted.
                try:
                    self.admin.execute(update,(self.incidence,))
                    expected='EN_ATENCION' if "SET estado=" in update else 'PENDIENTE'
                    self.assertEqual(self.change(expected=expected,new='RESUELTA',comment='Texto',db=self.admin),{'error':'HISTORIAL_INCONSISTENTE'})
                finally:self.admin.execute('ROLLBACK')

        def test_temporal_chain_validation(self):
            self.change()
            for date in ("'infinity'","clock_timestamp()+interval '1 day'","(SELECT fecha-interval '1 second' FROM incidencia WHERE id_incidencia=%s)"):
                self.admin.execute('BEGIN')
                try:
                    params=(self.incidence,self.incidence) if '%s' in date else (self.incidence,)
                    self.admin.execute('UPDATE historial_estado_incidencia SET fecha='+date+" WHERE id_incidencia=%s AND estado_nuevo='EN_ATENCION'",params)
                    self.assertEqual(self.change(expected='EN_ATENCION',new='RESUELTA',comment='Texto',db=self.admin),{'error':'HISTORIAL_INCONSISTENTE'})
                finally:self.admin.execute('ROLLBACK')

        def test_rollback_between_update_insert_and_suppressed_insert(self):
            original=(self.row(),self.events())
            for body in ("RAISE EXCEPTION 'synthetic fault';","RETURN NULL;"):
                self.admin.execute("CREATE FUNCTION public.hu016_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN "+body+" END $$")
                self.admin.execute('CREATE TRIGGER hu016_fail BEFORE INSERT ON historial_estado_incidencia FOR EACH ROW EXECUTE FUNCTION public.hu016_fail()')
                try:
                    with self.assertRaises(psycopg.errors.RaiseException):self.change()
                    self.assertEqual((self.row(),self.events()),original)
                finally:self.admin.execute('DROP TRIGGER hu016_fail ON historial_estado_incidencia; DROP FUNCTION public.hu016_fail()')

        def test_outer_rollback_and_deferred_failure(self):
            original=(self.row(),self.events())
            self.db.execute('BEGIN')
            self.change()
            self.db.execute('ROLLBACK')
            self.assertEqual((self.row(),self.events()),original)
            self.admin.execute("CREATE FUNCTION public.hu016_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic deferred fault'; END $$")
            self.admin.execute('CREATE CONSTRAINT TRIGGER hu016_fail AFTER INSERT ON historial_estado_incidencia DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.hu016_fail()')
            try:
                self.db.execute('BEGIN')
                self.change()
                with self.assertRaises(psycopg.errors.RaiseException):self.db.execute('COMMIT')
                self.db.execute('ROLLBACK')
                self.assertEqual((self.row(),self.events()),original)
            finally:self.admin.execute('DROP TRIGGER hu016_fail ON historial_estado_incidencia; DROP FUNCTION public.hu016_fail()')

        def test_two_managers_stale_after_real_lock_wait(self):
            with connection(pg,'ep06_test_login') as other, ThreadPoolExecutor(1) as pool:
                self.db.execute('BEGIN')
                self.change()
                pid=other.execute('SELECT pg_backend_pid()').fetchone()[0]
                future=pool.submit(self.change,new='RESUELTA',comment='Concurrente',actor=102,db=other)
                try:self.wait_blocked(pid)
                finally:self.db.execute('COMMIT')
                self.assertEqual(future.result(timeout=10),{'error':'ESTADO_DESACTUALIZADO'})
            self.assertEqual(len(self.events()),2)
            self.assertEqual(self.row()['estado'],'EN_ATENCION')

        def test_lock_timeout_rollback(self):
            original=(self.row(),self.events())
            self.admin.execute('BEGIN')
            self.admin.execute('SELECT id_practica FROM practica WHERE id_practica=%s FOR UPDATE',(self.practice,))
            self.db.execute("SET lock_timeout='150ms'; BEGIN")
            try:
                with self.assertRaises(psycopg.errors.LockNotAvailable):self.change()
                self.db.execute('ROLLBACK')
            finally:self.admin.execute('ROLLBACK')
            self.assertEqual((self.row(),self.events()),original)

        def test_repeatable_read_serialization_rollback(self):
            self.db.execute('BEGIN ISOLATION LEVEL REPEATABLE READ')
            self.db.execute(READ,(self.practice,self.incidence,101,50,0))
            with connection(pg,'ep06_test_login') as other:self.change(db=other)
            with self.assertRaises(psycopg.errors.SerializationFailure):
                self.change(new='RESUELTA',comment='Obsoleta')
            self.db.execute('ROLLBACK')
            self.assertEqual(len(self.events()),2)
            self.assertEqual(self.row()['estado'],'EN_ATENCION')

        def test_real_deadlock_rolls_back_victim(self):
            # Deliberate external lock inversion, not the production lock order.
            with connection(pg) as first, connection(pg) as second, ThreadPoolExecutor(2) as pool:
                first.execute('BEGIN')
                second.execute('BEGIN')
                first.execute('SELECT id_practica FROM practica WHERE id_practica=%s FOR UPDATE',(self.practice,))
                second.execute('SELECT id_usuario FROM usuario WHERE id_usuario=101 FOR UPDATE')
                pid=first.execute('SELECT pg_backend_pid()').fetchone()[0]
                def attempt(db):
                    try:
                        result=self.change(db=db)
                        db.execute('COMMIT')
                        return result
                    except psycopg.Error as error:
                        db.execute('ROLLBACK')
                        return error.sqlstate
                a=pool.submit(attempt,first)
                self.wait_blocked(pid)
                b=pool.submit(attempt,second)
                results=[a.result(timeout=12),b.result(timeout=12)]
                self.assertIn('40P01',results)
                self.assertEqual(sum(isinstance(r,dict) and r.get('estado_nuevo')=='EN_ATENCION' for r in results),1)
            self.assertEqual(len(self.events()),2)

        def test_history_pagination_order_defaults_and_isolation(self):
            self.change()
            self.change(expected='EN_ATENCION',new='RESUELTA',comment='Listo')
            result=self.read(limit=2)
            self.assertTrue(result['hay_mas'])
            self.assertEqual([i['estado_nuevo'] for i in result['items']],['RESUELTA','EN_ATENCION'])
            last=self.read(limit=2,offset=2)
            self.assertFalse(last['hay_mas'])
            self.assertEqual(len(last['items']),1)
            self.assertIsNone(last['items'][0]['estado_anterior'])
            self.assertIsNone(last['items'][0]['comentario'])
            self.assertEqual(self.db.execute('SELECT incidencias_privadas.fn_consultar_historial_incidencia(%s,%s,102)',(self.practice,self.incidence)).fetchone()[0],self.read(actor=102))
            self.assertEqual(self.read(offset=10)['items'],[])
            for limit,offset in [(0,0),(101,0),(None,0),(50,-1),(50,None)]:
                self.assertEqual(self.read(limit=limit,offset=offset),{'error':'PAGINACION_INVALIDA'})

        def test_read_only_null_historical_values_and_no_write(self):
            before=snapshot(self.admin)
            for zone in ('UTC','America/Santiago'):
                self.db.execute("SELECT set_config('TimeZone',%s,false)",(zone,))
                self.db.execute('BEGIN READ ONLY')
                try:
                    result=self.read()
                    self.assertEqual(result['items'][0]['comentario'],None)
                    self.assertEqual(result['items'][0]['estado_anterior'],None)
                finally:self.db.execute('ROLLBACK')
            self.assertEqual(snapshot(self.admin),before)

        def test_dml_acl_owners_sequences_and_shadowing(self):
            for query in ('SELECT * FROM incidencia',"UPDATE incidencia SET estado='RESUELTA'",
                'DELETE FROM incidencia','TRUNCATE incidencia CASCADE',
                'SELECT * FROM historial_estado_incidencia','DELETE FROM historial_estado_incidencia',
                'TRUNCATE historial_estado_incidencia CASCADE',
                "UPDATE historial_estado_incidencia SET comentario='No'",
                "INSERT INTO historial_estado_incidencia(id_incidencia) VALUES(1)",
                'SET ROLE pl_ep06_state_owner','SET ROLE pl_ep06_history_owner'):
                with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.db.execute(query)
            for owner in ('pl_ep06_state_owner','pl_ep06_history_owner'):
                self.assertEqual(self.admin.execute('SELECT rolcanlogin,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=%s',(owner,)).fetchone(),(False,False,False,False,False))
                self.admin.execute('BEGIN; SET LOCAL ROLE '+owner)
                try:
                    with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                        self.admin.execute("UPDATE historial_estado_incidencia SET comentario='No'")
                finally:self.admin.execute('ROLLBACK')
            for user in ('ep05_test_client','ep05_test_login','ep05_read_test','ep04_integration_login'):
                with connection(pg,user) as db:
                    with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.change(db=db)
                    with self.assertRaises(psycopg.errors.InsufficientPrivilege):db.execute(READ,(self.practice,self.incidence,101,50,0))
            self.db.execute('CREATE TEMP TABLE incidencia(id_incidencia bigint); CREATE TEMP TABLE historial_estado_incidencia(id_historial bigint); SET search_path=pg_temp,public')
            self.assertEqual(self.change()['estado_nuevo'],'EN_ATENCION')
            self.assertEqual(len(self.read()['items']),2)

        def test_rls_effective_update_and_insert_denial_roll_back(self):
            before=(self.row(),self.events())
            for table,operation in [('incidencia','UPDATE'),('historial_estado_incidencia','INSERT')]:
                self.admin.execute(f'CREATE POLICY hu016_deny ON {table} AS RESTRICTIVE FOR {operation} TO pl_ep06_state_owner WITH CHECK(false)')
                try:
                    with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.change()
                    self.assertEqual((self.row(),self.events()),before)
                finally:self.admin.execute(f'DROP POLICY hu016_deny ON {table}')
            self.admin.execute('CREATE POLICY hu016_deny ON historial_estado_incidencia AS RESTRICTIVE FOR SELECT TO pl_ep06_history_owner USING(false)')
            try:self.assertEqual(self.read()['items'],[])
            finally:self.admin.execute('DROP POLICY hu016_deny ON historial_estado_incidencia')

    return unittest.defaultTestLoader.loadTestsFromTestCase(EstadoTests)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--docker-local',action='store_true',required=True)
    parser.parse_args()
    pg=SeguimientoPostgres('postgres:18.6')
    pg.name='ep06-hu016-'+pg.run_id
    pg.network,pg.volume=pg.name+'-net',pg.name+'-data'
    def interrupted(*_):raise KeyboardInterrupt
    signal.signal(signal.SIGTERM,interrupted)
    code=1
    try:
        pg.start()
        with connection(pg) as db:
            legacy=db.execute("INSERT INTO practica(id_estudiante,id_centro,id_estado_actual) SELECT 100,100,id_estado FROM estado_practica WHERE nombre='FINALIZADA' RETURNING id_practica").fetchone()[0]
            for medium,description in [(None,''),('Antiguo','x'*2001)]:
                db.execute("INSERT INTO seguimiento(id_practica,id_usuario,fecha,tipo,observacion) VALUES(%s,102,'2026-07-01 02:30:00+00',%s,%s)",(legacy,medium,description))
        hu013=write_follow(pg)
        hu014=read_follow(pg,legacy)
        hu015=write_incidence(pg)
        get015=read_incidence(pg)
        hu016=suite(pg)
        result=unittest.TextTestRunner(verbosity=2,resultclass=SafeResult).run(
            unittest.TestSuite([hu016,get015,hu015,hu014,hu013]))
        code=0 if result.wasSuccessful() else 1
    except (Exception,KeyboardInterrupt) as error:
        print('HU016 no completada:',type(error).__name__,file=sys.stderr)
    finally:
        try:
            pg.close()
            assert all(pg.inspect_resource(kind,name) is None for kind,name in pg.candidates)
            print('Ausencia de recursos exclusivos confirmada.')
        except Exception:
            print('Limpieza pendiente: revisar solo candidatos enumerados.',file=sys.stderr)
            code=1
    return code


if __name__=='__main__':
    sys.exit(main())
