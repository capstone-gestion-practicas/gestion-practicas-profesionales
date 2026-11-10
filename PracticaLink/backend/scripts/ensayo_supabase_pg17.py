"""Exclusive PG17 lab: exact versioned SQL, no .env/imports of application config."""
import argparse,importlib.util,json,subprocess,time,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--docker-local',action='store_true',required=True)
parser.add_argument('--output-dir',type=Path,required=True)
args=parser.parse_args()
OUT=args.output_dir.resolve()
if not OUT.is_dir(): parser.error('output-dir must already exist; reports are never overwritten')
DOCKER=['docker','--host','unix:///var/run/docker.sock']
name='practicalink09-conciliacion-'+uuid.uuid4().hex[:12]
label='practicalink09.run='+name
created=False
spec=importlib.util.spec_from_file_location('diag',ROOT/'PracticaLink/backend/scripts/diagnostico_supabase_catalogo.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
base=DOCKER+['exec','-i',name,'psql','-X','-qAt','-U','lab_test','-d','lab_only','-v','ON_ERROR_STOP=1']

def sql(text,transaction=False):
 r=subprocess.run(base+(['--single-transaction'] if transaction else []),input=text,text=True,capture_output=True,timeout=60)
 if r.returncode: raise RuntimeError(r.stderr)
 return r.stdout.strip()

def snapshot(label):
 data={'format_version':1,'scope':'postgresql_catalogs_only','status':'complete','sections':{}}
 for key,query in m.QUERIES.items():
  for parameter,values in {**m.PARAMS,'ep07':m.EP07}.items():
   query=query.replace(':'+parameter,'ARRAY['+','.join("'"+v.replace("'","''")+"'" for v in values)+']')
  text='BEGIN READ ONLY; SET LOCAL statement_timeout=5000; SET LOCAL search_path=pg_catalog; SELECT COALESCE(json_agg(q),\'[]\'::json) FROM ('+query+' LIMIT 2001) q; ROLLBACK;'
  rows=json.loads(sql(text));assert len(rows)<=2000
  data['sections'][key]=rows
 m.write_report(OUT/('ensayo-final-'+label+'.json'),data)
 print('PASS catalog:',label,'17 original queries; read-only/rollback',flush=True)

try:
 subprocess.run(DOCKER+['run','-d','--pull=never','--name',name,'--label',label,'--network','none','--memory','1g','--cpus','2','--pids-limit','256','--tmpfs','/var/lib/postgresql/data:rw,size=768m','-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_USER=lab_test','-e','POSTGRES_DB=lab_only','postgres:17'],check=True,stdout=subprocess.DEVNULL)
 created=True
 info=json.loads(subprocess.run(DOCKER+['inspect',name],capture_output=True,text=True,check=True).stdout)[0]
 assert info['HostConfig']['NetworkMode']=='none' and not info['HostConfig']['PortBindings']
 assert not info['Mounts'] or all(mount['Type']=='tmpfs' for mount in info['Mounts'])
 for _ in range(100):
  pid=subprocess.run(DOCKER+['exec',name,'cat','/proc/1/comm'],capture_output=True,text=True).stdout.strip()
  if pid=='postgres' and subprocess.run(DOCKER+['exec',name,'pg_isready','-U','lab_test'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0:break
  time.sleep(.1)
 else: raise RuntimeError('lab not ready')
 print('PostgreSQL lab:',sql('SHOW server_version'),flush=True)
 sql("CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN; CREATE SCHEMA auth; CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;")
 migrations=sorted((ROOT/'PracticaLink/supabase/migrations').glob('*.sql'));assert len(migrations)==27
 for i,path in enumerate(migrations,1):
  sql(path.read_text(),i not in (1,21))
  print('PASS migration',i,path.name,flush=True)
  if i==11:
   snapshot('referencia-migraciones-11')
   sql((ROOT/'PracticaLink/backend/scripts/preflight_supabase_catalogo.sql').read_text())
   # Synthetic expected-name scenario, NOT a reconstruction of unknown remote DDL.
   sql('BEGIN; ALTER TABLE public.practica ADD COLUMN id_gestor bigint; '
       'ALTER TABLE public.practica ADD CONSTRAINT fk_practica_gestor FOREIGN KEY(id_gestor) REFERENCES public.usuario(id_usuario) ON DELETE RESTRICT; '
       +migrations[15].read_text()+'\nROLLBACK;')
   print('PASS expected-name EP07/id_gestor rehearsal rolled back; remote equivalence NOT inferred',flush=True)
 snapshot('referencia-migraciones-27')
 for path in sorted((ROOT/'scripts/BD/fixes').glob('ep06-0*.sql')):
  sql(path.read_text())
  print('PASS bootstrap',path.name,flush=True)
 snapshot('referencia-migraciones-27-ep06')
 sql((ROOT/'PracticaLink/backend/scripts/postflight_supabase_catalogo.sql').read_text())
 print('PASS preflight/postflight catalog SQL',flush=True)
 checks=sql("""SELECT json_build_object(
 'ep06_functions',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='incidencias_privadas'),
 'private_schemas',(SELECT count(*) FROM pg_namespace WHERE nspname IN ('practicas_privadas','seguimientos_privados','docente_privado','informes_privados','incidencias_privadas')),
 'client_execute',pg_catalog.has_function_privilege('authenticated','informes_privados.reservar(bigint,bigint,uuid,bigint,text,text,bigint,text)','EXECUTE'))""")
 print('Final catalog:',checks,flush=True)
finally:
 if created:
  info=json.loads(subprocess.run(DOCKER+['inspect',name],capture_output=True,text=True,check=True).stdout)[0]
  assert info['Config']['Labels'].get('practicalink09.run')==name
  subprocess.run(DOCKER+['rm','-f',info['Id']],check=True,stdout=subprocess.DEVNULL)
  print('CLEANUP: exclusive lab removed',flush=True)
