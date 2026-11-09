"""PDF/DOCX SQL migration tests. Exclusive offline PostgreSQL 18.6; stdlib only.
Run: .venv/bin/python -B tests/integration/run_pdf_docx.py --docker-local
No remote URLs, env files, installs or image pulls. Only our random container is removed.
"""
import argparse
import ast
import json
from pathlib import Path
import selectors
import subprocess
import sys
import time
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).parent
MIGRATION = '20261110100000_informes_pdf_docx.sql'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--docker-local', action='store_true', required=True)
    parser.parse_args()
    name = 'practicalink-pdf-docx-' + uuid4().hex[:12]
    subprocess.run(['docker','image','inspect','postgres:18.6'],check=True,stdout=subprocess.DEVNULL)
    subprocess.run(['docker','run','-d','--pull=never','--name',name,'--network','none',
        '--memory','1g','--cpus','2','--pids-limit','256',
        '--tmpfs','/var/lib/postgresql:rw,size=768m',
        '-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_USER=pd_test',
        '-e','POSTGRES_DB=practicalink_pdf_docx','postgres:18.6'],check=True,stdout=subprocess.DEVNULL)
    base=['docker','exec','-i',name,'psql','-X','-qAt','-U','pd_test',
          '-d','practicalink_pdf_docx','-v','ON_ERROR_STOP=1']
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
    def reserve(p, version=0, fmt='DOCX'):
        k=str(uuid4()); extension=fmt.lower()
        return k, f"SELECT informes_privados.reservar({p},1430,'{k}',{version},repeat('c',64),'synthetic.{extension}',5,'{fmt}')"
    def confirmed(p, version=0, fmt='DOCX'):
        k, statement=reserve(p,version,fmt)
        sql('SET ROLE pl_s42_executor; '+statement+f"; SELECT informes_privados.confirmar({p},1430,'{k}')")
        return int(sql(f'SELECT id_documento FROM public.informe_final WHERE id_practica={p}'))
    def start(p,d,version=1):
        e=str(uuid4())
        return e,f"SELECT informes_privados.iniciar_evaluacion({p},1432,'{e}',{d},{version})"
    def resolve(p,e,result='APROBADO'):
        return f"SELECT informes_privados.resolver_evaluacion({p},1432,'{uuid4()}','{e}','{result}',"+("'Corregir')" if result=='CON_OBSERVACIONES' else 'NULL)')
    try:
        for _ in range(75):
            pid=subprocess.run(['docker','exec',name,'cat','/proc/1/comm'],capture_output=True,text=True).stdout.strip()
            if pid=='postgres' and subprocess.run(['docker','exec',name,'pg_isready','-U','pd_test'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0: break
            time.sleep(.2)
        else: raise RuntimeError('PostgreSQL not ready')
        info=json.loads(subprocess.run(['docker','inspect',name],check=True,capture_output=True,text=True).stdout)[0]
        check(info['HostConfig']['NetworkMode']=='none' and not info['HostConfig']['PortBindings'],'container not isolated')
        check(sql('SHOW server_version').startswith('18.6'),'wrong PostgreSQL version')
        sql("CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN; CREATE SCHEMA auth; CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;")
        paths=sorted((ROOT/'PracticaLink/supabase/migrations').glob('*.sql'))
        for path in paths:
            if path.name >= '20261109100000_s43_evaluacion_academica.sql': break
            sql(path.read_text(),path.name!='20261017000000_initial_schema.sql')
        sql((HERE/'s41_asignacion_docente.sql').read_text())
        sql((HERE/'s42_informe_final.sql').read_text())
        sql((ROOT/'PracticaLink/supabase/migrations/20261109100000_s43_evaluacion_academica.sql').read_text(),True)
        print('PASS baseline: S4.1/S4.2 regressions and S4.3 migration',flush=True)
        seed=(HERE/'s43_evaluacion_academica.sql').read_text().split('CREATE FUNCTION pg_temp.ok')[0]
        for i in range(439,429,-1): seed=seed.replace(str(i),str(i+1000))
        seed=seed.replace('generate_series(1430,1435)','generate_series(1430,1450)')
        sql(seed+'COMMIT;')
        sql("SET ROLE pl_s42_executor; SELECT informes_privados.reservar(1430,1430,'dd000000-0000-0000-0000-000000000001',0,repeat('a',64),'old.pdf',5); SELECT informes_privados.confirmar(1430,1430,'dd000000-0000-0000-0000-000000000001'); SELECT informes_privados.reservar(1430,1430,'dd000000-0000-0000-0000-000000000002',1,repeat('b',64),'pending.pdf',6)")
        old_key=str(uuid4())
        sql(f"SET ROLE pl_s42_executor; SELECT informes_privados.reservar(1431,1430,'{old_key}',0,repeat('a',64),'historical.pdf',5); SELECT informes_privados.confirmar(1431,1430,'{old_key}')")
        d=int(sql('SELECT id_documento FROM public.informe_final WHERE id_practica=1431')); e,statement=start(1431,d)
        sql('SET ROLE pl_s42_executor; '+statement+'; '+resolve(1431,e)+'; SELECT public.fn_cerrar_practica(1431,1431,NULL)')
        before=sql("SELECT jsonb_agg(to_jsonb(e) ORDER BY id_entrega) FROM public.informe_entrega e")
        tuples=sql("SELECT array_agg(ROW(ctid,xmin)::text ORDER BY id_entrega) FROM public.informe_entrega")
        documents=sql('SELECT jsonb_agg(to_jsonb(d) ORDER BY id_documento) FROM public.documento d')
        academic=sql('SELECT jsonb_agg(to_jsonb(e) ORDER BY id_evaluacion) FROM public.evaluacion_informe e')
        closure=sql('SELECT to_jsonb(c) FROM public.cierre_practica c WHERE id_practica=1431')
        sql((ROOT/'PracticaLink/supabase/migrations'/MIGRATION).read_text(),True)
        check(before==sql("SELECT jsonb_agg(to_jsonb(e)-'formato' ORDER BY id_entrega) FROM public.informe_entrega e"),'legacy delivery changed')
        check(tuples==sql("SELECT array_agg(ROW(ctid,xmin)::text ORDER BY id_entrega) FROM public.informe_entrega"),'legacy heap rows rewritten')
        check(documents==sql('SELECT jsonb_agg(to_jsonb(d) ORDER BY id_documento) FROM public.documento d'),'historical PDF metadata changed')
        check(academic==sql('SELECT jsonb_agg(to_jsonb(e) ORDER BY id_evaluacion) FROM public.evaluacion_informe e'),'historical evaluation changed')
        check(closure==sql('SELECT to_jsonb(c) FROM public.cierre_practica c WHERE id_practica=1431'),'historical closure changed')
        print('PASS upgrade: confirmed/pending PDFs, evaluations/closure and physical tuples preserved',flush=True)
        # Execute the exact current FastAPI ACL query as a genuine restricted login role.
        sql('CREATE ROLE pd_backend LOGIN INHERIT NOSUPERUSER NOBYPASSRLS; GRANT pl_s42_executor TO pd_backend')
        tree=ast.parse((ROOT/'PracticaLink/backend/app/informes/database.py').read_text())
        query=next(node.value for node in ast.walk(tree) if isinstance(node,ast.Constant) and isinstance(node.value,str) and 'SELECT NOT rolsuper' in node.value)
        check(sql('SET ROLE pd_backend; '+query)=='t','current backend ACL guard rejected the overload')
        sql((HERE/'pdf_docx.sql').read_text())
        print('PASS formats: legacy adapter, DOCX/PDF changes, retries, notifications, metadata, rollback, cleanup and effective ACL/RLS',flush=True)
        # Competing formats: only one expected version can become current.
        k1,s1=reserve(1434,fmt='PDF'); k2,s2=reserve(1434)
        sql('SET ROLE pl_s42_executor; '+s1+'; '+s2)
        race(f"SELECT informes_privados.confirmar(1434,1430,'{k1}')",expected(f"SELECT informes_privados.confirmar(1434,1430,'{k2}')",'P0409'),'PDF before DOCX confirmation')
        check(sql('SELECT version FROM public.informe_final WHERE id_practica=1434')=='1','duplicate version')
        k1,s1=reserve(1435); k2,s2=reserve(1435,fmt='PDF')
        sql('SET ROLE pl_s42_executor; '+s1+'; '+s2)
        race(f"SELECT informes_privados.confirmar(1435,1430,'{k1}')",expected(f"SELECT informes_privados.confirmar(1435,1430,'{k2}')",'P0409'),'DOCX before PDF confirmation')
        # Both orders of replacement/start; old-version approval never transfers.
        old=confirmed(1436,fmt='PDF'); k,s=reserve(1436,1); sql('SET ROLE pl_s42_executor; '+s)
        e,start_sql=start(1436,old)
        race(f"SELECT informes_privados.confirmar(1436,1430,'{k}')",expected(start_sql,'P0409'),'DOCX replacement before PDF evaluation start')
        d=confirmed(1437); k,s=reserve(1437,1,'PDF'); sql('SET ROLE pl_s42_executor; '+s); e,start_sql=start(1437,d)
        race(start_sql,expected(f"SELECT informes_privados.confirmar(1437,1430,'{k}')",'P0409'),'DOCX evaluation start before PDF replacement')
        race(resolve(1437,e,'CON_OBSERVACIONES'),f"SELECT informes_privados.confirmar(1437,1430,'{k}')",'observations release pending format change')
        check(sql('SELECT count(*) FROM public.evaluacion_informe e JOIN public.informe_final f USING(id_documento) WHERE f.id_practica=1437')=='0','new PDF inherited evaluation')
        d=confirmed(1438); k,s=reserve(1438,1,'PDF'); sql('SET ROLE pl_s42_executor; '+s); e,start_sql=start(1438,d)
        sql('SET ROLE pl_s42_executor; '+start_sql)
        race(resolve(1438,e),expected(f"SELECT informes_privados.confirmar(1438,1430,'{k}')",'P0409'),'DOCX approval blocks pending PDF')
        race('SELECT public.fn_cerrar_practica(1438,1431,NULL)',expected(f"SELECT informes_privados.confirmar(1438,1430,'{k}')",'P0409'),'DOCX closure blocks pending PDF')
        d=confirmed(1439); e,start_sql=start(1439,d); sql('SET ROLE pl_s42_executor; '+start_sql)
        race('SELECT informes_privados.consultar(1439,1431); '+expected('SELECT public.fn_cerrar_practica(1439,1431,NULL)','P0409'),resolve(1439,e),'closure before DOCX approval is rejected')
        d=confirmed(1440); e,start_sql=start(1440,d); sql('SET ROLE pl_s42_executor; '+start_sql)
        race(resolve(1440,e),'SELECT public.fn_cerrar_practica(1440,1431,NULL)','DOCX approval before closure succeeds')
        d=confirmed(1441); e,start_sql=start(1441,d); sql('SET ROLE pl_s42_executor; '+start_sql)
        race("SET LOCAL ROLE pl_s41_docente_executor; SELECT docente_privado.fn_gestionar_asignacion(1441,1431,1433,'Cambio concurrente')",expected(resolve(1441,e),'42501'),'DOCX reassignment rejects old evaluator')
        check(sql(f"SELECT estado FROM public.evaluacion_informe WHERE id_evaluacion='{e}'")=='INTERRUMPIDA','pending evaluation not interrupted')
        print('PASS final: formats preserve academic barriers and concurrency; no remote services used',flush=True)
    finally:
        subprocess.run(['docker','rm','-f',name],check=True,stdout=subprocess.DEVNULL)
    # Unchanged S4.3 + E03/E05 scenarios in a separate exclusive local container.
    subprocess.run([sys.executable,'-B',str(HERE/'run_evaluacion_academica.py'),'--docker-local','--pdf-docx'],check=True)


if __name__=='__main__':
    main()
