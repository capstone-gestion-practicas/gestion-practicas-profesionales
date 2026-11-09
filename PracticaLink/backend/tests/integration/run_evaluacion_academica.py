"""S4.3 PostgreSQL 18.6 synthetic tests; stdlib only, no env/real DB URLs."""
import argparse
import json
from pathlib import Path
import selectors
import subprocess
import time
from uuid import uuid4
from s43_concurrencia_roles import run_cases as run_e05_cases

ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).parent


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--docker-local', action='store_true', required=True)
    parser.parse_args()
    name = 'practicalink-s43-' + uuid4().hex[:12]
    image = 'postgres:18.6'
    subprocess.run(['docker', 'image', 'inspect', image], check=True, stdout=subprocess.DEVNULL)
    subprocess.run(['docker', 'run', '-d', '--pull=never', '--name', name,
                    '--network', 'none', '--tmpfs', '/var/lib/postgresql',
                    '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-e', 'POSTGRES_USER=s43_test',
                    '-e', 'POSTGRES_DB=practicalink_s43', image], check=True, stdout=subprocess.DEVNULL)
    base = ['docker', 'exec', '-i', name, 'psql', '-X', '-qAt', '-U', 's43_test',
            '-d', 'practicalink_s43', '-v', 'ON_ERROR_STOP=1']
    def sql(source, transaction=False):
        result = subprocess.run(base + (['--single-transaction'] if transaction else []), input=source,
                                text=True, capture_output=True, timeout=40)
        if result.returncode:
            raise RuntimeError(result.stderr)
        return result.stdout.strip()
    def check(value, message):
        if not value:
            raise RuntimeError(message)
    def expected(statement, code):
        statement = statement.replace("'", "''")
        return f"DO $test$ BEGIN BEGIN EXECUTE '{statement}'; EXCEPTION WHEN SQLSTATE '{code}' THEN RETURN; END; RAISE EXCEPTION 'expected {code}'; END $test$"
    def race(first, second, label):
        processes = []
        try:
            a = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            processes.append(a)
            # Redirect SELECT output so TextIO buffering cannot swallow our marker.
            a.stdin.write("\\o /dev/null\nSET statement_timeout='15s'; BEGIN; SET LOCAL ROLE pl_s42_executor; " + first + ";\n\\o\n\\echo LOCK_READY\n")
            a.stdin.flush()
            with selectors.DefaultSelector() as selector:
                selector.register(a.stdout, selectors.EVENT_READ)
                check(bool(selector.select(20)), label + ': first session timed out')
                check(a.stdout.readline().strip() == 'LOCK_READY', label + ': first session failed: ' + (a.stderr.read() if a.poll() is not None else 'no marker'))
            b = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            processes.append(b)
            b.stdin.write("SET application_name='s43_race'; SET statement_timeout='15s'; SET lock_timeout='10s'; BEGIN; SET LOCAL ROLE pl_s42_executor; " + second + "; COMMIT;\n")
            b.stdin.close()
            for _ in range(50):
                if sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='s43_race' AND wait_event_type='Lock'") == '1':
                    break
                if b.poll() is not None:
                    raise RuntimeError(label + ': second did not wait: ' + b.stderr.read())
                time.sleep(.1)
            else:
                raise RuntimeError(label + ': no observable lock wait')
            a.stdin.write('COMMIT;\n'); a.stdin.close()
            for process in processes:
                process.wait(timeout=20)
                check(process.returncode == 0, label + ': ' + process.stderr.read())
            print('PASS concurrency: ' + label, flush=True)
        finally:
            for process in processes:
                if process.poll() is None:
                    process.kill(); process.wait()
    def doc(p):
        return int(sql(f'SELECT id_documento FROM public.informe_final WHERE id_practica={p}'))
    def reserve(p, version):
        key = str(uuid4())
        sql(f"SET ROLE pl_s42_executor; SELECT informes_privados.reservar({p},430,'{key}',{version},repeat('a',64),'synthetic.pdf',5)")
        return key
    def start(p, teacher=432):
        key = str(uuid4())
        sql(f"SET ROLE pl_s42_executor; SELECT informes_privados.iniciar_evaluacion({p},{teacher},'{key}',{doc(p)},1)")
        return key
    def resolve(p, evaluation, result='APROBADO', teacher=432):
        return f"SELECT informes_privados.resolver_evaluacion({p},{teacher},'{uuid4()}','{evaluation}','{result}'," + ("'Corregir sintético')" if result == 'CON_OBSERVACIONES' else 'NULL)')
    try:
        for _ in range(75):
            pid = subprocess.run(['docker', 'exec', name, 'cat', '/proc/1/comm'], capture_output=True, text=True).stdout.strip()
            if pid == 'postgres' and subprocess.run(['docker', 'exec', name, 'pg_isready', '-U', 's43_test'], stdout=subprocess.DEVNULL).returncode == 0:
                break
            time.sleep(.2)
        else:
            raise RuntimeError('PostgreSQL not ready')
        info = json.loads(subprocess.run(['docker', 'inspect', name], check=True, capture_output=True, text=True).stdout)[0]
        check(info['HostConfig']['NetworkMode'] == 'none' and not info['HostConfig']['PortBindings'], 'container not isolated')
        check(sql('SHOW server_version').startswith('18.6'), 'wrong PostgreSQL version')
        sql("CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN; CREATE SCHEMA auth; CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;")
        paths = sorted((ROOT / 'PracticaLink/supabase/migrations').glob('*.sql'))
        for path in paths:
            if path.name.startswith('20261109100000'):
                break
            sql(path.read_text(), path.name != '20261017000000_initial_schema.sql')
        sql((HERE / 's41_asignacion_docente.sql').read_text())
        sql((HERE / 's42_informe_final.sql').read_text())
        print('PASS baseline: S4.1/S4.2 SQL before upgrade', flush=True)
        # Real pre-upgrade closure must remain byte-for-byte intact (new nullable FK excluded).
        sql("""INSERT INTO public.usuario(id_usuario,nombre,apellido,correo,password_hash)
         SELECT id,'Histórico','Sintético','legacy-'||id||'@example.invalid','synthetic' FROM generate_series(530,532) id;
         INSERT INTO public.usuario_rol SELECT id,id_rol FROM (VALUES(530,'ESTUDIANTE'),(531,'GESTOR'),(532,'DOCENTE')) x(id,nombre) JOIN public.rol USING(nombre);
         INSERT INTO public.estudiante(id_estudiante,id_usuario,rut,carrera,sede) VALUES(530,530,'22222222-2','Sintética','Alameda');
         INSERT INTO public.centro_practica(id_centro,nombre) VALUES(530,'Centro histórico sintético');
         INSERT INTO public.practica(id_practica,id_estudiante,id_centro,id_estado_actual,id_gestor,id_docente,fecha_termino)
         SELECT 530,530,530,id_estado,531,532,CURRENT_DATE-1 FROM public.estado_practica WHERE nombre='EN_CURSO';
         SELECT public.fn_cerrar_practica(530,531,'Histórico anterior a S4.3');""")
        before = sql('SELECT to_jsonb(c) FROM public.cierre_practica c WHERE id_practica=530')
        legacy = sql('SELECT to_jsonb(p) FROM public.practica p WHERE id_practica=530')
        for path in paths:
            if path.name.startswith('20261109100000'):
                sql(path.read_text(), True)
        check(before == sql("SELECT to_jsonb(c)-'id_evaluacion' FROM public.cierre_practica c WHERE id_practica=530"), 'legacy closure altered')
        check(legacy == sql('SELECT to_jsonb(p) FROM public.practica p WHERE id_practica=530'), 'legacy practice altered')
        print('PASS upgrade: incremental migration and historical preservation', flush=True)
        sql((HERE / 's43_historial_finalizada.sql').read_text())
        print('PASS E03: non-superuser DML, RLS, rollback and immutable legacy final history', flush=True)
        sql((HERE / 's41_asignacion_docente.sql').read_text())
        sql((HERE / 's43_evaluacion_academica.sql').read_text())
        print('PASS S4.3: authorization, self-evaluation, retries, versions, results, reassignment, closure, immutability, ACL/RLS', flush=True)
        source = (HERE / 's43_evaluacion_academica.sql').read_text()
        sql(source.split('CREATE FUNCTION pg_temp.ok')[0] + 'COMMIT;')
        for p in range(430, 436):
            key = reserve(p, 0)
            sql(f"SET ROLE pl_s42_executor; SELECT informes_privados.confirmar({p},430,'{key}')")
        eid = str(uuid4()); d = doc(430)
        race(f"SELECT informes_privados.iniciar_evaluacion(430,432,'{eid}',{d},1)",
             expected(f"SELECT informes_privados.iniciar_evaluacion(430,432,'{uuid4()}',{d},1)", 'P0409'), 'two explicit starts')
        race(resolve(430,eid), "SET LOCAL ROLE pl_s41_docente_executor; SELECT docente_privado.fn_gestionar_asignacion(430,431,433,'Cambio tras resolución')", 'resolution before reassignment')
        check(sql(f"SELECT estado FROM public.evaluacion_informe WHERE id_evaluacion='{eid}'") == 'RESUELTA', 'final result overwritten')
        eid = start(431)
        race("SET LOCAL ROLE pl_s41_docente_executor; SELECT docente_privado.fn_gestionar_asignacion(431,431,433,'Cambio durante evaluación')",
             expected(resolve(431,eid),'42501'), 'reassignment before old teacher resolution')
        check(sql(f"SELECT estado FROM public.evaluacion_informe WHERE id_evaluacion='{eid}'") == 'INTERRUMPIDA', 'pending evaluation not interrupted')
        old = doc(432); key = reserve(432,1)
        race(f"SELECT informes_privados.confirmar(432,430,'{key}')",expected(f"SELECT informes_privados.iniciar_evaluacion(432,432,'{uuid4()}',{old},1)",'P0409'), 'replacement before evaluation start')
        key = reserve(433,1); eid = str(uuid4())
        race(f"SELECT informes_privados.iniciar_evaluacion(433,432,'{eid}',{doc(433)},1)",expected(f"SELECT informes_privados.confirmar(433,430,'{key}')",'P0409'),'evaluation start before replacement')
        eid2 = start(431,433)
        race(resolve(431,eid2,teacher=433),expected(resolve(431,eid2,teacher=433),'P0409'),'two competing resolutions')
        check(sql(f"SELECT count(*) FROM public.evaluacion_evento WHERE id_evaluacion='{eid2}' AND tipo='RESUELTA'") == '1', 'duplicate resolution event')
        key = reserve(434,1)
        race("SET LOCAL ROLE pl_s41_docente_executor; SELECT docente_privado.fn_gestionar_asignacion(434,431,NULL,'Retiro concurrente')",expected(f"SELECT informes_privados.confirmar(434,430,'{key}')",'P0409'),'teacher withdrawal before replacement')
        sql("SET ROLE pl_s41_docente_executor; SELECT docente_privado.fn_gestionar_asignacion(434,431,432,NULL)")
        pending = start(434)
        race("SET LOCAL ROLE pl_s41_docente_executor; SELECT docente_privado.fn_gestionar_asignacion(434,431,NULL,'Retiro durante evaluación')",expected(resolve(434,pending),'42501'),'withdrawal interrupts pending evaluation')
        check(sql(f"SELECT estado FROM public.evaluacion_informe WHERE id_evaluacion='{pending}'") == 'INTERRUMPIDA', 'withdrawal lost interruption')
        key = reserve(435,1); eid = start(435); sql('SET ROLE pl_s42_executor; '+resolve(435,eid))
        race('SELECT public.fn_cerrar_practica(435,431,NULL)',expected(f"SELECT informes_privados.confirmar(435,430,'{key}')",'P0409'),'closure before pending PDF confirmation')
        race(resolve(433,str(sql("SELECT id_evaluacion FROM public.evaluacion_informe WHERE id_practica=433 AND estado='EN_CURSO'"))), 'SELECT public.fn_cerrar_practica(433,431,NULL)', 'approval before responsible gestor closure')
        race("RESET ROLE; SELECT public.fn_asignar_gestor_practica(430,434,435)",expected('SELECT public.fn_cerrar_practica(430,431,NULL)','42501'),'EP07 gestor reassignment before closure')
        sql('SET ROLE pl_s42_executor; SELECT public.fn_cerrar_practica(430,435,NULL)')
        # Initial APROBADA remains independent of academic approval.
        result = sql("INSERT INTO public.practica(id_practica,id_estudiante,id_centro,id_estado_actual) SELECT 436,430,430,id_estado FROM public.estado_practica WHERE nombre='REGISTRADA'; SELECT public.fn_revisar_practica(436,431,'APROBADA',NULL)")
        check(json.loads(result)['estado'] == 'APROBADA', 'initial review contract changed')
        print('PASS EP08: initial request approval remains independent', flush=True)
        sql((HERE / 's43_historial_finalizada.sql').read_text())
        print('PASS E03: legacy and new closure histories preserved after concurrency', flush=True)
        run_e05_cases(sql, base, check)
        check(before == sql("SELECT to_jsonb(c)-'id_evaluacion' FROM public.cierre_practica c WHERE id_practica=530"), 'historical closure changed by tests')
        print('PASS final: historical closure preserved; synthetic container will be removed', flush=True)
    finally:
        subprocess.run(['docker', 'rm', '-f', name], check=True, stdout=subprocess.DEVNULL)


if __name__ == '__main__':
    main()
