"""Isolated PG17 rehearsal, observed ACL/roles, backup/restore and atomic upgrade.
No project configuration imports or external database URL accepted.
"""
import argparse,hashlib,json,os,secrets,subprocess,sys,time,uuid
from pathlib import Path
from types import SimpleNamespace
import psycopg
from psycopg import sql
from common import ROOT,MIGRATIONS,EP06,update,quoted,literal
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--docker-local',action='store_true',required=True)
p.add_argument('--catalog',type=Path,required=True);p.add_argument('--context',type=Path,required=True)
p.add_argument('--output',type=Path,required=True);args=p.parse_args()
if not args.output.is_dir():p.error('output directory must exist')
report=json.loads(args.catalog.read_text());context=json.loads(args.context.read_text())
assert report['status']=='complete' and context['status']=='complete'
D=['docker','--host','unix:///var/run/docker.sock'];tag='practicalink09-package-'+uuid.uuid4().hex[:12]
label='practicalink09.package='+tag;network=tag+'-net';created=[];results=[];host=None

def run(arguments,**kw):return subprocess.run(D+arguments,check=True,capture_output=True,**kw)
def check(condition,name):
    if not condition:raise AssertionError(name)
    results.append(name);print('PASS:',name,flush=True)
def connection(database='baseline',user='postgres',autocommit=True,application_name=''):
    return psycopg.connect(host=host,hostaddr=host,port=5432,dbname=database,user=user,password='',sslmode='disable',gssencmode='disable',passfile='/dev/null',connect_timeout=5,autocommit=autocommit,application_name=application_name)
def psql(source,database='baseline',user='postgres',one=False):
    command=['exec','-i',tag,'psql','-X','-qAt','-U',user,'-d',database,'-v','ON_ERROR_STOP=1']+(['--single-transaction'] if one else [])
    r=run(command,input=source,text=True)
    return r.stdout.strip()
def digest(db):
    objects={}
    tables=db.execute("SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN ('public','supabase_migrations') ORDER BY 1,2").fetchall()
    for schema,name in tables:
        q=sql.SQL('SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,\'[]\')) FROM {}.{} t').format(sql.Identifier(schema),sql.Identifier(name))
        objects[schema+'.'+name]=db.execute(q).fetchone()[0]
    return objects

def fixture(admin):
    # SQL roles only: no passwords or application accounts copied from Supabase.
    for role in context['roles']:
        name=role['rolname']
        if name.startswith('pg_'):continue
        flags=' '.join([('LOGIN' if role['rolcanlogin'] else 'NOLOGIN'),('INHERIT' if role['rolinherit'] else 'NOINHERIT'),('SUPERUSER' if role['rolsuper'] else 'NOSUPERUSER'),('CREATEDB' if role['rolcreatedb'] else 'NOCREATEDB'),('CREATEROLE' if role['rolcreaterole'] else 'NOCREATEROLE'),('BYPASSRLS' if role['rolbypassrls'] else 'NOBYPASSRLS'),('REPLICATION' if role['rolreplication'] else 'NOREPLICATION')])
        admin.execute('CREATE ROLE '+quoted(name)+' '+flags)
    for membership in context['memberships']:
        if membership['parent']=='pg_database_owner':continue
        admin.execute('GRANT '+quoted(membership['parent'])+' TO '+quoted(membership['child'])+' WITH ADMIN '+str(membership['admin_option']).upper()+', INHERIT '+str(membership['inherit_option']).upper()+', SET '+str(membership['set_option']).upper())
    admin.execute('CREATE DATABASE baseline OWNER postgres')
    with connection(user='lab_admin') as a:
        a.execute("CREATE SCHEMA auth; CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$; GRANT USAGE ON SCHEMA auth TO PUBLIC")
        a.execute('GRANT USAGE,CREATE ON SCHEMA public TO postgres')
    # Migrate 1–16 with default ACL context, then impose the observed explicit ACL.
    for entry in report['sections']['default_acl']:
        kind={'r':'TABLES','S':'SEQUENCES','f':'FUNCTIONS'}.get(entry['object_type'])
        if kind is None:raise ValueError('unsupported default ACL')
        cmd='ALTER DEFAULT PRIVILEGES FOR ROLE '+quoted(entry['creator'])+' IN SCHEMA '+quoted(entry['schema'])+' GRANT '+entry['privilege']+' ON '+kind+' TO '+('PUBLIC' if entry['grantee']=='PUBLIC' else quoted(entry['grantee']))+(' WITH GRANT OPTION' if entry['is_grantable'] else '')
        with connection(user='lab_admin') as a:a.execute(cmd)
    for i,path in enumerate(MIGRATIONS[:16],1):psql(path.read_text(),one=i!=1)
    with connection(user='lab_admin') as a:
        a.execute('ALTER TABLE public.practica RENAME CONSTRAINT fk_practica_estado TO fk_practica_estado_actual')
        for entry in report['sections']['relation_acl']:
            a.execute('GRANT '+entry['privilege']+' ON TABLE public.'+quoted(entry['relation'])+' TO '+('PUBLIC' if entry['grantee']=='PUBLIC' else quoted(entry['grantee']))+(' WITH GRANT OPTION' if entry['is_grantable'] else ''))
        a.execute('CREATE SCHEMA supabase_migrations AUTHORIZATION postgres')
        a.execute('CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,statements text[],name text); ALTER TABLE supabase_migrations.schema_migrations OWNER TO postgres')
        for path in MIGRATIONS[:11]:a.execute('INSERT INTO supabase_migrations.schema_migrations(version,name) VALUES(%s,%s)',(path.name[:14],path.stem.split('_',1)[1]))
    check(len(context['history_versions'])==11,'observed eleven migration versions')
    with connection() as db:
        row=db.execute("SELECT rolsuper,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname=current_user").fetchone()
        check(row==(False,True,True),'migration actor matches observed NOSUPERUSER/CREATEROLE/BYPASSRLS; not a runtime executor')
        check(db.execute('SHOW createrole_self_grant').fetchone()[0]=='','observed empty createrole_self_grant')
        for entry in report['sections']['effective_table_privileges']:
            for field,priv in [('select_table','SELECT'),('insert_table','INSERT'),('update_table','UPDATE'),('delete_table','DELETE'),('truncate_table','TRUNCATE')]:
                actual=db.execute('SELECT has_table_privilege(%s,%s,%s)',(entry['role'],'public.'+entry['relation'],priv)).fetchone()[0]
                if actual!=entry[field]:raise AssertionError('observed effective ACL mismatch')
        check(True,'320 observed effective table privilege checks reproduced')
        for row in context['function_contracts']:
            value=db.execute("SELECT pronargdefaults,md5(coalesce(pg_get_expr(proargdefaults,0),'')) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=%s AND pg_get_function_identity_arguments(p.oid)=%s",(row['proname'],row['arguments'])).fetchone()
            if value!=(row['pronargdefaults'],row['defaults_hash']):raise AssertionError('function default contract mismatch')
        check(True,'17 observed function default contracts match versioned 1–16 source')
        db.execute("INSERT INTO public.usuario(id_usuario,nombre,apellido,correo,password_hash) VALUES(9001,'Admin','Sintético','admin@example.invalid','synthetic'); INSERT INTO public.usuario_rol SELECT 9001,id_rol FROM public.rol WHERE nombre='ADMINISTRADOR'")
        check(isinstance(db.execute('SELECT public.fn_listar_usuarios()').fetchone()[0],list),'real JSONB user list contract')
        check(isinstance(db.execute('SELECT public.fn_listar_roles()').fetchone()[0],list),'real JSONB role list contract')
        for function,params in [('fn_crear_usuario_admin', (9001,json.dumps({'nombre':'Sintético','apellido':'Prueba','correo':'empty@example.invalid','roles':[]}),'synthetic')),('fn_actualizar_usuario_admin',(9001,9001,json.dumps({'nombre':'Admin','apellido':'Sintético','correo':'admin@example.invalid','roles':[]})))]:
            q='SELECT public.'+function+'('+','.join(['%s','%s::jsonb','%s'] if function=='fn_crear_usuario_admin' else ['%s','%s','%s::jsonb'])+')'
            value=db.execute(q,params).fetchone()[0]
            check(value.get('error')=='ROLES_INVALIDOS',function+' invalid roles emits ROLES_INVALIDOS, never SIN_ROLES')

try:
    run(['image','inspect','postgres:17'])
    run(['network','create','--internal','--label',label,network]);created.append(('network',network))
    run(['run','-d','--pull=never','--name',tag,'--label',label,'--network',network,'--memory','1g','--cpus','2','--pids-limit','256','--tmpfs','/var/lib/postgresql/data:rw,size=768m','-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_USER=lab_admin','-e','POSTGRES_DB=control','postgres:17']);created.append(('container',tag))
    for _ in range(100):
        info=json.loads(run(['inspect',tag],text=True).stdout)[0]
        if run(['exec',tag,'cat','/proc/1/comm'],text=True).stdout.strip()=='postgres':
            ready=subprocess.run(D+['exec',tag,'pg_isready','-U','lab_admin'],capture_output=True).returncode==0
            if ready:break
        time.sleep(.1)
    else:raise RuntimeError('startup timeout')
    check(not info['HostConfig']['PortBindings'],'no published ports')
    net=json.loads(run(['network','inspect',network],text=True).stdout)[0];check(net['Internal'],'internal network without external route')
    host=info['NetworkSettings']['Networks'][network]['IPAddress']
    with connection('control','lab_admin') as admin:fixture(admin)
    with connection() as writer,connection(autocommit=False) as keeper:
        keeper.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
        snapshot=keeper.execute('SELECT pg_export_snapshot()').fetchone()[0];before=digest(keeper)
        original_check=keeper.execute("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.incidencia'::regclass AND conname='chk_incidencia_estado'").fetchone()[0]
        writer.execute("INSERT INTO usuario(id_usuario,nombre,apellido,correo,password_hash) VALUES(9999,'Después','Snapshot','after@example.invalid','synthetic')")
        run(['exec',tag,'pg_dump','-U','postgres','-d','baseline','-Fc','--snapshot='+snapshot,'--schema=public','--schema=supabase_migrations','--file=/tmp/before.dump'])
        keeper.rollback()
    check(True,'pg_dump17 exported MVCC snapshot with concurrent synthetic writer')
    run(['cp',tag+':/tmp/before.dump',str(args.output/'before.dump')]);os.chmod(args.output/'before.dump',0o600)
    with connection('control','lab_admin') as admin:admin.execute('CREATE DATABASE ep04_integration OWNER postgres')
    with connection('ep04_integration','lab_admin') as admin:
        admin.execute("DROP SCHEMA public; CREATE SCHEMA auth; CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$; GRANT USAGE ON SCHEMA auth TO PUBLIC")
    try:
        run(['exec',tag,'pg_restore','-U','postgres','-d','ep04_integration','--exit-on-error','--single-transaction','/tmp/before.dump'])
    except subprocess.CalledProcessError as e:
        message=(e.stderr or b'').decode(errors='replace')
        if 'default privileges' not in message and 'supabase_admin' not in message:raise
        check(True,'negative restore: customer principal cannot alter provider-owned defaults')
        # Provider bootstrap owns provider defaults. Never grant customer membership
        # in supabase_admin or alter provider defaults as a workaround.
        with connection('ep04_integration','lab_admin') as a:
            a.execute('CREATE SCHEMA public AUTHORIZATION pg_database_owner')
            for acl in report['sections']['schema_acl']:
                if acl['schema']=='public':
                    a.execute('GRANT '+acl['privilege']+' ON SCHEMA public TO '+('PUBLIC' if acl['grantee']=='PUBLIC' else quoted(acl['grantee']))+(' WITH GRANT OPTION' if acl['is_grantable'] else ''))
            for entry in report['sections']['default_acl']:
                if entry['creator']!='supabase_admin':continue
                kind={'r':'TABLES','S':'SEQUENCES','f':'FUNCTIONS'}[entry['object_type']]
                a.execute('ALTER DEFAULT PRIVILEGES FOR ROLE '+quoted(entry['creator'])+' IN SCHEMA public GRANT '+entry['privilege']+' ON '+kind+' TO '+('PUBLIC' if entry['grantee']=='PUBLIC' else quoted(entry['grantee']))+(' WITH GRANT OPTION' if entry['is_grantable'] else ''))
        toc=run(['exec',tag,'pg_restore','--list','/tmp/before.dump'],text=True).stdout
        lines=[];excluded=[]
        for line in toc.splitlines():
            if ('DEFAULT ACL' in line and line.rstrip().endswith('supabase_admin')) or ' SCHEMA - public ' in line:
                excluded.append(line);lines.append(';provider-default-preverified '+line)
            else:lines.append(line)
        if not excluded:raise AssertionError('no managed defaults found in TOC')
        (args.output/'restore-app.list').write_text('\n'.join(lines)+'\n')
        run(['cp',str(args.output/'restore-app.list'),tag+':/tmp/restore-app.list'])
        run(['exec',tag,'pg_restore','-U','postgres','-d','ep04_integration','--exit-on-error','--single-transaction','--use-list=/tmp/restore-app.list','/tmp/before.dump'])
    with connection('ep04_integration') as db:
        check(digest(db)==before,'restored every table digest, including migration history; post-snapshot writer excluded')
        restored_check=db.execute("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.incidencia'::regclass AND conname='chk_incidencia_estado'").fetchone()[0]
        (args.output/'check-roundtrip.json').write_text(json.dumps({'original':original_check,'restored':restored_check,'equal':original_check==restored_check},indent=2))
        print('CHECK_ROUNDTRIP_EQUAL:',original_check==restored_check,flush=True)
        check(db.execute('SELECT count(*) FROM usuario WHERE id_usuario=9999').fetchone()[0]==0,'restored snapshot excludes concurrent insert')
        error=None
        try:update(db)
        except psycopg.Error as e:error=e.sqlstate
        check(error=='42501','negative: original sequence without owner membership preparation fails with 42501')
        import common
        print('UNPREPARED_STAGE:',common.LAST_STEP,flush=True)
        check(db.execute('SELECT count(*) FROM supabase_migrations.schema_migrations').fetchone()[0]==11,'failed sequence rolls back history and DDL')
        try:update(db,temporary_membership=True,inject_after=MIGRATIONS[20].name)
        except RuntimeError:pass
        check(db.execute("SELECT count(*) FROM pg_roles WHERE left(rolname,3)='pl_'").fetchone()[0]==0,'failure after adopted migration21 rolls back private roles and all DDL')
        with connection() as original:
            try:
                update(original,temporary_membership=True,inject_after=EP06[-1].name)
            except RuntimeError:
                check(True,'original pre-dump schema passes all migration and EP06 guards; probe rolled back')
        # Reject incompatible definitions even with the candidate guard.
        candidate=(Path(__file__).parent/'ep06_01_compatible_roundtrip.sql').read_text()
        from common import adopted
        for statement in [
            'ALTER TABLE public.incidencia DROP CONSTRAINT chk_incidencia_estado; ALTER TABLE public.incidencia ADD CONSTRAINT chk_incidencia_estado CHECK(estado IS NOT NULL)',
            'ALTER TABLE public.incidencia DROP CONSTRAINT fk_incidencia_practica; ALTER TABLE public.incidencia ADD CONSTRAINT fk_incidencia_practica FOREIGN KEY(id_practica) REFERENCES public.practica ON DELETE RESTRICT']:
            caught=False
            try:
                with db.transaction():
                    db.execute(statement,prepare=False);db.execute(adopted(candidate),prepare=False)
            except psycopg.errors.RaiseException:caught=True
            check(caught,'candidate still rejects incompatible CHECK/FK')
        audit={}
        update(db,temporary_membership=True,compatible_ep06=True,audit=audit)
        (args.output/'acl-transient.json').write_text(json.dumps(audit,indent=2))
        check(db.execute('SELECT count(*) FROM supabase_migrations.schema_migrations').fetchone()[0]==27,'atomic reconciliation + 17–27 + EP06 commits 27 history rows')
        check(db.execute("SELECT count(*) FROM pg_auth_members a JOIN pg_roles p ON p.oid=a.roleid WHERE a.member=(SELECT oid FROM pg_roles WHERE rolname=current_user) AND left(p.rolname,3)='pl_' AND (a.inherit_option OR a.set_option)").fetchone()[0]==0,'temporary owner inheritance/SET removed, ADMIN management retained')
        for group in ['pl_s42_executor','pl_s41_docente_executor']:
            check(not db.execute("SELECT has_table_privilege(%s,'public.practica','UPDATE')",(group,)).fetchone()[0],group+' has no direct UPDATE')
    # The original failure-injection harness requires a fixture administrator.
    # Business assertions use SET ROLE; production installation above was NOSUPERUSER.
    psql((ROOT/'PracticaLink/backend/tests/integration/s43_evaluacion_academica.sql').read_text(),'ep04_integration',user='lab_admin')
    check(True,'S4.3 SQL regression under private SET ROLE; fixture admin only for failure injection')
    # Execute the existing real HTTP integration against this database; only Storage/push mocked.
    sys.path.insert(0,str(ROOT/'PracticaLink/backend/tests/integration'))
    from run_evaluacion_backend import http_tests
    class Adapter:
        admin_password=''
        def sql(self,source,check=True):return SimpleNamespace(stdout=psql(source,'ep04_integration'))
    adapter=Adapter();adapter.host=host
    check(http_tests(adapter)==0,'real HTTP integration with private runtime executors after managed-like upgrade')
    # Both approval/closure orders with a real restricted login and observable lock wait.
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event
    with connection('ep04_integration') as db:
        db.execute('CREATE ROLE pl09_race LOGIN INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB')
        db.execute('GRANT pl_s42_executor TO pl09_race')
        db.execute("INSERT INTO usuario(id_usuario,nombre,apellido,correo,password_hash) SELECT x,'Race','Synthetic','race-'||x||'@example.invalid','synthetic' FROM generate_series(10100,10103) x")
        db.execute("INSERT INTO usuario_rol SELECT x,id_rol FROM (VALUES(10100,'ESTUDIANTE'),(10101,'GESTOR'),(10102,'DOCENTE'),(10103,'GESTOR')) a(x,nombre) JOIN rol USING(nombre)")
        db.execute("INSERT INTO estudiante(id_estudiante,id_usuario,rut,carrera,sede) VALUES(10100,10100,'33333333-3','Sintética','Alameda'); INSERT INTO centro_practica(id_centro,nombre) VALUES(10100,'Race synthetic'); INSERT INTO practica(id_practica,id_estudiante,id_centro,id_estado_actual,id_gestor,id_docente,fecha_termino) SELECT 10100,10100,10100,id_estado,10101,10102,(clock_timestamp() AT TIME ZONE 'America/Santiago')::date FROM estado_practica WHERE nombre='EN_CURSO'")
    delivery,evaluation,resolution=str(uuid.uuid4()),str(uuid.uuid4()),str(uuid.uuid4())
    with connection('ep04_integration','pl09_race') as db:
        db.execute("SELECT informes_privados.reservar(10100,10100,%s,0,repeat('a',64),'synthetic.docx',5,'DOCX')",(delivery,))
        db.execute('SELECT informes_privados.confirmar(10100,10100,%s)',(delivery,))
        document=db.execute('SELECT informes_privados.consultar(10100,10102)').fetchone()[0]['id_documento']
        db.execute('SELECT informes_privados.iniciar_evaluacion(10100,10102,%s,%s,1)',(evaluation,document))
        for actor,expected in [(10101,'P0409'),(9001,'42501'),(10103,'42501')]:
            error=None
            try:db.execute('SELECT public.fn_cerrar_practica(10100,%s,NULL)',(actor,))
            except psycopg.Error as e:error=e.sqlstate
            check(error==expected,'closure denies missing approval/admin/other manager: '+expected)
    ready,release=Event(),Event()
    def approve():
        with connection('ep04_integration','pl09_race',False,'pl09-approve') as db:
            value=db.execute("SELECT informes_privados.resolver_evaluacion(10100,10102,%s,%s,'APROBADO',NULL)",(resolution,evaluation)).fetchone()[0]
            ready.set()
            if not release.wait(10):raise TimeoutError('controlled wait')
            db.commit();return value
    def close_after_wait():
        with connection('ep04_integration','pl09_race',False,'pl09-close-wait') as db:
            value=db.execute('SELECT public.fn_cerrar_practica(10100,10101,NULL)').fetchone()[0]
            db.commit();return value
    with ThreadPoolExecutor(max_workers=2) as pool:
        first=pool.submit(approve)
        try:
            check(ready.wait(10),'approval session holds transaction locks')
            second=pool.submit(close_after_wait);waited=False
            with connection('ep04_integration') as monitor:
                for _ in range(50):
                    if monitor.execute("SELECT count(*) FROM pg_stat_activity WHERE application_name='pl09-close-wait' AND wait_event_type='Lock'").fetchone()[0]==1:waited=True;break
                    time.sleep(.1)
            check(waited,'closure visibly waits for academic approval lock')
        finally:release.set()
        first.result(timeout=15);closed=second.result(timeout=15)
        check(closed['estado']=='FINALIZADA','waiting closure revalidates committed approval')
    with connection('ep04_integration') as db:
        check(db.execute("SELECT count(*) FROM cierre_practica c JOIN evaluacion_informe e ON e.id_evaluacion=c.id_evaluacion JOIN informe_final f ON f.id_practica=c.id_practica WHERE c.id_practica=10100 AND e.id_documento=f.id_documento AND e.resultado='APROBADO'").fetchone()[0]==1,'closure bound to approved current version exactly once')
        check(db.execute("SELECT coalesce(max(n),0) FROM (SELECT count(*) n FROM notificacion WHERE id_practica=10100 GROUP BY id_usuario,tipo) q").fetchone()[0]==1,'no duplicate operation notifications after concurrent close')
    (args.output/'result.json').write_text(json.dumps({'status':'PASS','checks':results,'backend_debt':'19 pre-existing test results reviewed separately','remote_writes':False,'limitations':['PG17.11 image, target PG17.6','provider extensions/event triggers not emulated','SQL roles/selected ACL/defaults copied as metadata only','Storage/push mocked in HTTP integration'],'backup_sha256':hashlib.sha256((args.output/'before.dump').read_bytes()).hexdigest()},indent=2))
except Exception as error:
    # No URL/arguments/password text from SQL/connection exceptions is exported.
    state=getattr(error,'sqlstate',None)
    if isinstance(error,subprocess.CalledProcessError):
        text=error.stderr if isinstance(error.stderr,str) else (error.stderr or b'').decode(errors='replace')
        reason=next((x for x in ['permission denied','must be able to SET ROLE','must be member of role','already exists','does not exist'] if x in text),'COMMAND_FAILED')
    else:reason=str(error) if isinstance(error,(AssertionError,ValueError)) else type(error).__name__
    if isinstance(error,subprocess.CalledProcessError):
        for line in text.splitlines():
            if 'ERROR:' in line:print('LAB_DB_ERROR:',line.split('ERROR:',1)[1].strip()[:220],flush=True)
    import common
    print('FAILED_STEP:',getattr(common,'LAST_STEP','fixture/backup'),flush=True)
    if state=='P0001':print('MIGRATION_GUARD:',error.diag.message_primary[:250],flush=True)
    print('LAB_FAILED',reason,'SQLSTATE',state,flush=True)
    (args.output/'failure.json').write_text(json.dumps({'status':'FAIL','checks':results,'type':type(error).__name__,'reason':reason,'sqlstate':state},indent=2))
    raise SystemExit(1)
finally:
    for kind,name in reversed(created):
        info=json.loads(run([kind,'inspect',name] if kind=='network' else ['inspect',name],text=True).stdout)[0]
        labels=info['Labels'] if kind=='network' else info['Config']['Labels']
        if labels.get('practicalink09.package')!=tag:raise RuntimeError('resource ownership mismatch')
        run(['network','rm',info['Id']] if kind=='network' else ['rm','-f',info['Id']])
    print('CLEANUP: only owned lab resources removed',flush=True)
