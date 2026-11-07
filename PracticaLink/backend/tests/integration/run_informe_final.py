"""Opt-in S4.2 SQL tests. Standard library only. No network, env files or real DB URLs."""
import argparse
from pathlib import Path
import subprocess
import time
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[4]


def run():
    parser = argparse.ArgumentParser()
    parser.add_argument('--docker-local', action='store_true', required=True)
    parser.parse_args()
    name = 'practicalink-s42-' + uuid4().hex[:12]
    image = 'postgres:18.6'
    subprocess.run(['docker', 'image', 'inspect', image], check=True, stdout=subprocess.DEVNULL)
    subprocess.run(['docker', 'run', '-d', '--pull=never', '--name', name,
                    '--network', 'none', '--tmpfs', '/var/lib/postgresql',
                    '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-e', 'POSTGRES_USER=s42_test',
                    '-e', 'POSTGRES_DB=practicalink_s42', image], check=True, stdout=subprocess.DEVNULL)
    base = ['docker', 'exec', '-i', name, 'psql', '-X', '-qAt', '-U', 's42_test',
            '-d', 'practicalink_s42', '-v', 'ON_ERROR_STOP=1']
    def sql(source, transaction=False):
        r = subprocess.run(base + (['--single-transaction'] if transaction else []),
                           input=source, text=True, capture_output=True, timeout=30)
        if r.returncode:
            raise RuntimeError(r.stderr)
        return r.stdout.strip()
    def race(first, second):
        processes = []
        try:
            a = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            processes.append(a)
            a.stdin.write("BEGIN; SET LOCAL ROLE pl_s42_executor; " + first + ";\n\\echo LOCK_READY\n"); a.stdin.flush()
            while True:
                line = a.stdout.readline()
                if not line:
                    raise RuntimeError(a.stderr.read())
                if line.strip() == 'LOCK_READY':
                    break
            b = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            processes.append(b)
            b.stdin.write("SET application_name='s42_race'; SET lock_timeout='10s'; BEGIN; " + second + "; COMMIT;\n"); b.stdin.close()
            for _ in range(50):
                if sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='s42_race' AND wait_event_type='Lock'") == '1':
                    break
                time.sleep(.1)
            else:
                raise RuntimeError('second session did not wait for row lock')
            a.stdin.write('COMMIT;\n'); a.stdin.close()
            for process in processes:
                process.wait(timeout=15)
                if process.returncode:
                    raise RuntimeError(process.stderr.read())
        finally:
            for process in processes:
                if process.poll() is None:
                    process.kill(); process.wait()
    try:
        for _ in range(60):
            if (subprocess.run(['docker', 'exec', name, 'cat', '/proc/1/comm'], capture_output=True, text=True).stdout.strip() == 'postgres'
                    and subprocess.run(['docker', 'exec', name, 'pg_isready', '-U', 's42_test'], stdout=subprocess.DEVNULL).returncode == 0):
                break
            time.sleep(.2)
        else:
            raise RuntimeError('PostgreSQL did not become ready')
        if not sql('SHOW server_version').startswith('18.6'):
            raise RuntimeError('PostgreSQL version mismatch')
        sql("CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN; CREATE SCHEMA auth; CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;")
        for path in sorted((ROOT / 'PracticaLink/supabase/migrations').glob('*.sql')):
            sql(path.read_text(), path.name != '20261017000000_initial_schema.sql')
        print('PASS: migrations applied in fresh PostgreSQL 18.6', flush=True)
        source = (Path(__file__).parent / 's42_informe_final.sql').read_text()
        sql(source)
        print('PASS: authorization, metadata, versions, notifications, rollback, RLS/ACL', flush=True)
        sql(source.split('CREATE FUNCTION pg_temp.assert_true')[0] + 'COMMIT;')
        for key in [1, 2]:
            sql(f"SELECT informes_privados.reservar(880,880,'00000000-0000-0000-0000-{key:012d}',0,repeat('a',64),'informe.pdf',5)")
        race("SELECT informes_privados.confirmar(880,880,'00000000-0000-0000-0000-000000000001')",
             "SET LOCAL ROLE pl_s42_executor; DO $$ BEGIN BEGIN PERFORM informes_privados.confirmar(880,880,'00000000-0000-0000-0000-000000000002'); RAISE EXCEPTION 'lost-update allowed'; EXCEPTION WHEN SQLSTATE 'P0409' THEN NULL; END; END $$")
        if sql('SELECT version FROM public.informe_final WHERE id_practica=880') != '1':
            raise RuntimeError('concurrent confirmation changed version twice')
        print('PASS: concurrent confirmations serialize, stale version rejected', flush=True)
        sql("SELECT informes_privados.reservar(880,880,'00000000-0000-0000-0000-000000000003',1,repeat('a',64),'informe.pdf',5)")
        # Evaluation transition is simulated under owner, no evaluation endpoint exists.
        a = "SELECT informes_privados.consultar(880,880); RESET ROLE; SET LOCAL ROLE pl_s42_owner; UPDATE public.informe_final SET estado='EN_EVALUACION' WHERE id_practica=880"
        b = "SET LOCAL ROLE pl_s42_executor; DO $$ BEGIN BEGIN PERFORM informes_privados.confirmar(880,880,'00000000-0000-0000-0000-000000000003'); RAISE EXCEPTION 'evaluation lock bypassed'; EXCEPTION WHEN SQLSTATE 'P0409' THEN NULL; END; END $$"
        race(a, b)
        print('PASS: evaluation-start simulation blocks pending replacement', flush=True)
    finally:
        # Only this random container created by this invocation; no volume deletion.
        subprocess.run(['docker', 'rm', '-f', name], check=True, stdout=subprocess.DEVNULL)


if __name__ == '__main__':
    run()
