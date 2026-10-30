"""HU015 real: PostgreSQL 18.6 Docker exclusivo, sin .env ni servicios externos."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import signal
import sys
import time
import unittest
from run_historial_seguimiento import connection, suite as read_suite, SafeResult
from run_registro_seguimiento import SeguimientoPostgres, make_suite as write_suite
from run_inicio_practica import ROOT

FILES = [ROOT / 'scripts/BD/fixes' / f'ep06-0{i}-{name}.sql' for i, name in
         [(1, 'modelo-incidencias'), (2, 'permisos-incidencias'), (3, 'registrar-incidencia')]]
CALL = 'SELECT incidencias_privadas.fn_registrar_incidencia(%s,%s,%s,%s)'


def suite(pg):
    import psycopg
    from psycopg import sql
    with connection(pg) as db:
        practice = db.execute("INSERT INTO practica(id_estudiante,id_centro,id_estado_actual) SELECT 100,100,id_estado FROM estado_practica WHERE nombre='FINALIZADA' RETURNING id_practica").fetchone()[0]
        for state, description in [('ABIERTA', ''), ('EN_REVISION', 'x'*2001), ('RESUELTA', 'vieja'), ('CERRADA', 'antigua')]:
            identifier = db.execute('INSERT INTO incidencia(id_practica,id_usuario,estado,descripcion) VALUES(%s,101,%s,%s) RETURNING id_incidencia', (practice,state,description)).fetchone()[0]
            db.execute("INSERT INTO alerta(id_incidencia,tipo,mensaje) VALUES(%s,'SINTETICA','Histórica')", (identifier,))
        legacy = db.execute('SELECT to_jsonb(i) FROM incidencia i ORDER BY id_incidencia').fetchall()
        alerts = db.execute('SELECT * FROM alerta ORDER BY id_alerta').fetchall()
        functions = db.execute("SELECT oid,pg_get_functiondef(oid),proacl::text FROM pg_proc WHERE pronamespace IN ('seguimientos_privados'::regnamespace,'practicas_privadas'::regnamespace) ORDER BY oid").fetchall()
        # No modificar FK/CHECK si tienen otra definición, aunque se llamen igual.
        for alter in ["ALTER TABLE incidencia DROP CONSTRAINT fk_incidencia_practica; ALTER TABLE incidencia ADD CONSTRAINT fk_incidencia_practica FOREIGN KEY(id_practica) REFERENCES practica ON DELETE RESTRICT",
                      "ALTER TABLE incidencia DROP CONSTRAINT chk_incidencia_estado; ALTER TABLE incidencia ADD CONSTRAINT chk_incidencia_estado CHECK(estado IS NOT NULL)"]:
            db.execute('BEGIN')
            try:
                db.execute(alter)
                source = FILES[0].read_text().replace('BEGIN;', '', 1).rsplit('COMMIT;', 1)[0]
                try: db.execute(source)
                except psycopg.errors.RaiseException: pass
                else: raise AssertionError('Preflight aceptó definición incompatible')
            finally: db.execute('ROLLBACK')
        db.execute(FILES[0].read_text())
        for setup, undo in [('ALTER TABLE incidencia DISABLE ROW LEVEL SECURITY','ALTER TABLE incidencia ENABLE ROW LEVEL SECURITY'),
                            ('GRANT SELECT(descripcion) ON incidencia TO PUBLIC','REVOKE SELECT(descripcion) ON incidencia FROM PUBLIC'),
                            ('GRANT USAGE ON SEQUENCE tipo_incidencia_id_tipo_incidencia_seq TO PUBLIC','REVOKE USAGE ON SEQUENCE tipo_incidencia_id_tipo_incidencia_seq FROM PUBLIC')]:
            db.execute(setup)
            try:
                try: db.execute(FILES[1].read_text())
                except psycopg.errors.RaiseException: db.execute('ROLLBACK')
                else: raise AssertionError('Preflight aceptó permisos incompatibles')
                assert not db.execute("SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='pl_ep06_owner')").fetchone()[0]
            finally: db.execute(undo)
        db.execute(FILES[1].read_text())
        db.execute('ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO ep05_test_client')
        try: db.execute(FILES[2].read_text())
        finally: db.execute('ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM ep05_test_client')
        assert functions == db.execute("SELECT oid,pg_get_functiondef(oid),proacl::text FROM pg_proc WHERE pronamespace IN ('seguimientos_privados'::regnamespace,'practicas_privadas'::regnamespace) ORDER BY oid").fetchall()
        db.execute(sql.SQL('CREATE ROLE ep06_test_login LOGIN INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD {}').format(sql.Literal(pg.executor_password)))
        db.execute('GRANT pl_ep06_executor TO ep06_test_login')

    class IncidenciaTests(unittest.TestCase):
        def setUp(self):
            self.admin=connection(pg); self.addCleanup(self.admin.close)
            self.db=connection(pg,'ep06_test_login'); self.addCleanup(self.db.close)
            self.identifier=self.practice()

        def practice(self,state='EN_CURSO'):
            return self.admin.execute('INSERT INTO practica(id_estudiante,id_centro,id_estado_actual) SELECT 100,100,id_estado FROM estado_practica WHERE nombre=%s RETURNING id_practica',(state,)).fetchone()[0]

        def register(self,actor=101,kind='OTRO',description='Descripción sintética',identifier=None):
            return self.db.execute(CALL,(self.identifier if identifier is None else identifier,actor,kind,description)).fetchone()[0]

        def test_roles_types_and_atomic_initial_history(self):
            for actor in (101,102):
                for kind in ('ABANDONO','PROBLEMA_CENTRO','SALUD','OTRO'):
                    before=self.admin.execute('SELECT clock_timestamp()').fetchone()[0]
                    result=self.register(actor,kind)
                    row=self.admin.execute('SELECT id_practica,id_usuario,estado,prioridad,fecha,fecha_resolucion FROM incidencia WHERE id_incidencia=%s',(result['id_incidencia'],)).fetchone()
                    after=self.admin.execute('SELECT clock_timestamp()').fetchone()[0]
                    self.assertEqual(row[:4],(self.identifier,actor,'PENDIENTE','MEDIA'))
                    self.assertTrue(before<=row[4]<=after); self.assertIsNone(row[5])
                    self.assertEqual(result['tipo'],kind)
                    self.assertEqual(result['id_usuario'],actor)
                    self.assertEqual(self.admin.execute('SELECT id_usuario,estado_anterior,estado_nuevo,fecha FROM historial_estado_incidencia WHERE id_incidencia=%s',(result['id_incidencia'],)).fetchall(),[(actor,None,'PENDIENTE',row[4])])

        def test_unauthorized_and_inactive(self):
            for actor in (100,None,999999):
                self.assertEqual(self.register(actor,identifier=999999),{'error':'USUARIO_NO_AUTORIZADO'})
            for setup,undo in [('UPDATE usuario SET activo=false WHERE id_usuario=101','UPDATE usuario SET activo=true WHERE id_usuario=101'),("UPDATE rol SET activo=false WHERE nombre='GESTOR'","UPDATE rol SET activo=true WHERE nombre='GESTOR'")]:
                self.admin.execute(setup)
                try: self.assertEqual(self.register(),{'error':'USUARIO_NO_AUTORIZADO'})
                finally: self.admin.execute(undo)

        def test_practice_states_and_missing(self):
            self.assertEqual(self.register(identifier=999999),{'error':'PRACTICA_NO_ENCONTRADA'})
            for state, in self.admin.execute("SELECT nombre FROM estado_practica WHERE nombre<>'EN_CURSO'"):
                self.assertEqual(self.register(identifier=self.practice(state)),{'error':'PRACTICA_NO_EN_CURSO'})

        def test_type_validation(self):
            for kind in (None,'Salud','INVALIDO',"OTRO'; DROP TABLE incidencia;--"):
                self.assertEqual(self.register(kind=kind),{'error':'TIPO_INVALIDO'})
            self.admin.execute("UPDATE tipo_incidencia SET activo=false WHERE codigo='OTRO'")
            try: self.assertEqual(self.register(),{'error':'TIPO_INVALIDO'})
            finally: self.admin.execute("UPDATE tipo_incidencia SET activo=true WHERE codigo='OTRO'")

        def test_description_limits_unicode(self):
            for value in (None,'','   ','\t\n','😀'*2001):
                self.assertEqual(self.register(description=value),{'error':'DESCRIPCION_INVALIDA'})
            for value in ('😀'*2000,' á\n '):
                self.assertEqual(self.register(description=value)['descripcion'],value)

        def test_history_failure_rolls_back_incidence(self):
            self.admin.execute('CREATE POLICY ep06_test_deny ON historial_estado_incidencia AS RESTRICTIVE FOR INSERT TO pl_ep06_owner WITH CHECK(false)')
            before=self.admin.execute('SELECT count(*) FROM incidencia').fetchone()
            try:
                with self.assertRaises(psycopg.errors.InsufficientPrivilege): self.register()
                self.assertEqual(before,self.admin.execute('SELECT count(*) FROM incidencia').fetchone())
            finally: self.admin.execute('DROP POLICY ep06_test_deny ON historial_estado_incidencia')

        def test_explicit_rollback(self):
            self.db.execute('BEGIN')
            result=self.register()
            self.assertEqual(self.admin.execute('SELECT count(*) FROM incidencia WHERE id_incidencia=%s',(result['id_incidencia'],)).fetchone()[0],0)
            self.db.execute('ROLLBACK')
            self.assertEqual(self.admin.execute('SELECT count(*) FROM historial_estado_incidencia WHERE id_incidencia=%s',(result['id_incidencia'],)).fetchone()[0],0)

        def test_concurrent_transition_first(self):
            self.admin.execute('BEGIN')
            self.admin.execute("UPDATE practica SET id_estado_actual=(SELECT id_estado FROM estado_practica WHERE nombre='FINALIZADA') WHERE id_practica=%s",(self.identifier,))
            with ThreadPoolExecutor(1) as pool:
                pending=pool.submit(self.register)
                time.sleep(.2); self.assertFalse(pending.done())
                self.admin.execute('COMMIT')
                self.assertEqual(pending.result(timeout=8),{'error':'PRACTICA_NO_EN_CURSO'})

        def test_concurrent_registration_first(self):
            self.db.execute('BEGIN'); result=self.register()
            def transition():
                with connection(pg) as other:
                    other.execute("UPDATE practica SET id_estado_actual=(SELECT id_estado FROM estado_practica WHERE nombre='FINALIZADA') WHERE id_practica=%s",(self.identifier,))
            with ThreadPoolExecutor(1) as pool:
                pending=pool.submit(transition)
                time.sleep(.2); self.assertFalse(pending.done())
                self.db.execute('COMMIT'); pending.result(timeout=8)
            self.assertEqual(self.admin.execute('SELECT count(*) FROM incidencia WHERE id_incidencia=%s',(result['id_incidencia'],)).fetchone()[0],1)

        def test_delete_truncate_and_restrict(self):
            result=self.register()
            with self.assertRaises(psycopg.errors.RestrictViolation):
                self.admin.execute('DELETE FROM practica WHERE id_practica=%s',(self.identifier,))
            for statement in ['DELETE FROM incidencia','TRUNCATE incidencia CASCADE','DELETE FROM historial_estado_incidencia','TRUNCATE practica CASCADE']:
                with self.assertRaises(psycopg.errors.CheckViolation): self.admin.execute(statement)
            self.assertEqual(self.admin.execute('SELECT count(*) FROM incidencia WHERE id_incidencia=%s',(result['id_incidencia'],)).fetchone()[0],1)
            # Una práctica sin registros sí puede eliminarse.
            self.admin.execute('DELETE FROM practica WHERE id_practica=%s',(self.practice(),))

        def test_historical_rows_and_alerts_exact(self):
            self.assertEqual(legacy,self.admin.execute("SELECT to_jsonb(i)-'id_tipo_incidencia' FROM incidencia i WHERE id_practica=%s ORDER BY id_incidencia",(practice,)).fetchall())
            self.assertEqual(alerts,self.admin.execute('SELECT * FROM alerta ORDER BY id_alerta').fetchall())
            self.assertEqual(self.admin.execute('SELECT count(*) FROM historial_estado_incidencia h JOIN incidencia i USING(id_incidencia) WHERE i.id_practica=%s',(practice,)).fetchone()[0],0)

        def test_privileges_and_capability_isolation(self):
            for table in ('incidencia','historial_estado_incidencia','tipo_incidencia','practica','usuario'):
                for statement in (f'SELECT * FROM {table}',f'DELETE FROM {table}',f'TRUNCATE {table} CASCADE'):
                    with self.assertRaises(psycopg.errors.InsufficientPrivilege): self.db.execute(statement)
            for statement in ["INSERT INTO incidencia(id_practica,id_usuario,descripcion) VALUES(1,101,'x')","UPDATE incidencia SET descripcion='x'",'SET ROLE pl_ep06_owner']:
                with self.assertRaises(psycopg.errors.InsufficientPrivilege): self.db.execute(statement)
            for seq, in self.admin.execute("SELECT pg_get_serial_sequence(t,c) FROM (VALUES ('public.incidencia','id_incidencia'),('public.tipo_incidencia','id_tipo_incidencia'),('public.historial_estado_incidencia','id_historial')) x(t,c)"):
                self.assertFalse(self.db.execute("SELECT has_sequence_privilege(current_user,%s,'USAGE,SELECT,UPDATE')",(seq,)).fetchone()[0])
            for user in ('ep05_test_client','ep05_test_login','ep05_read_test','ep04_integration_login'):
                with connection(pg,user) as other:
                    with self.assertRaises(psycopg.errors.InsufficientPrivilege): other.execute(CALL,(self.identifier,101,'OTRO','x'))

        def test_new_row_constraints_and_no_legacy_rewrite(self):
            kind=self.admin.execute("SELECT id_tipo_incidencia FROM tipo_incidencia WHERE codigo='OTRO'").fetchone()[0]
            for state,description,kind_id in [('ABIERTA','x',kind),('PENDIENTE','',kind),('PENDIENTE','x'*2001,kind),('PENDIENTE','x',None)]:
                with self.assertRaises(psycopg.errors.CheckViolation):
                    self.admin.execute('INSERT INTO incidencia(id_practica,id_usuario,estado,descripcion,id_tipo_incidencia) VALUES(%s,101,%s,%s,%s)',(self.identifier,state,description,kind_id))
            with self.assertRaises(psycopg.errors.CheckViolation):
                self.admin.execute('UPDATE incidencia SET descripcion=descripcion WHERE id_practica=%s',(practice,))

        def test_function_flags_and_minimal_owner(self):
            self.assertEqual(self.admin.execute("SELECT prosecdef,proconfig FROM pg_proc WHERE oid='incidencias_privadas.fn_registrar_incidencia(bigint,bigint,text,text)'::regprocedure").fetchone(),(True,['search_path=pg_catalog, pg_temp','TimeZone=UTC']))
            for role in ('pl_ep06_owner','pl_ep06_executor'):
                self.assertEqual(self.admin.execute('SELECT rolcanlogin,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname=%s',(role,)).fetchone(),(False,False,False,False,False))
            self.admin.execute('BEGIN; SET LOCAL ROLE pl_ep06_owner')
            try:
                with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                    self.admin.execute('UPDATE usuario SET id_usuario=id_usuario WHERE id_usuario=101')
            finally: self.admin.execute('ROLLBACK')

        def test_equivalent_index_reused(self):
            source=FILES[0].read_text()
            source=source[source.index('DO $index$'):source.index('$index$;')+len('$index$;')]
            self.admin.execute('BEGIN')
            try:
                self.admin.execute('DROP INDEX idx_ep06_incidencia_historial; CREATE INDEX ep06_equivalent ON incidencia(id_practica,fecha,id_incidencia)')
                self.admin.execute(source)
                self.assertIsNone(self.admin.execute("SELECT to_regclass('idx_ep06_incidencia_historial')").fetchone()[0])
            finally: self.admin.execute('ROLLBACK')

        def test_rls_and_temp_shadowing(self):
            self.db.execute('CREATE TEMP TABLE usuario(id_usuario bigint); CREATE TEMP TABLE incidencia(id_incidencia bigint); SET search_path=pg_temp,public')
            self.assertIn('id_incidencia',self.register())
            self.admin.execute('CREATE POLICY ep06_test_deny ON incidencia AS RESTRICTIVE FOR INSERT TO pl_ep06_owner WITH CHECK(false)')
            try:
                with self.assertRaises(psycopg.errors.InsufficientPrivilege): self.register()
            finally: self.admin.execute('DROP POLICY ep06_test_deny ON incidencia')

    return unittest.defaultTestLoader.loadTestsFromTestCase(IncidenciaTests)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--docker-local',action='store_true',required=True)
    args=parser.parse_args()
    pg=SeguimientoPostgres('postgres:18.6')
    pg.name='ep06-hu015-'+pg.run_id; pg.network=pg.name+'-net'; pg.volume=pg.name+'-data'
    def interrupted(*_): raise KeyboardInterrupt
    signal.signal(signal.SIGTERM,interrupted)
    code=1
    try:
        pg.start()
        with connection(pg) as db:
            legacy=db.execute("INSERT INTO practica(id_estudiante,id_centro,id_estado_actual) SELECT 100,100,id_estado FROM estado_practica WHERE nombre='FINALIZADA' RETURNING id_practica").fetchone()[0]
            for medium,description in [(None,''),('Antiguo','x'*2001)]:
                db.execute("INSERT INTO seguimiento(id_practica,id_usuario,fecha,tipo,observacion) VALUES(%s,102,'2026-07-01 02:30:00+00',%s,%s)",(legacy,medium,description))
        hu013=write_suite(pg); hu014=read_suite(pg,legacy); hu015=suite(pg)
        result=unittest.TextTestRunner(verbosity=2,resultclass=SafeResult).run(unittest.TestSuite([hu015,hu014,hu013]))
        code=0 if result.wasSuccessful() else 1
    except (Exception,KeyboardInterrupt) as error:
        print('HU015 no completada:',type(error).__name__,file=sys.stderr)
    finally:
        try: pg.close()
        except Exception:
            print('Limpieza pendiente: revisar solo candidatos enumerados.',file=sys.stderr);code=1
    return code

if __name__=='__main__': sys.exit(main())
