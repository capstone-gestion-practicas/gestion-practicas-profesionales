"""Prepared read-only backup client. Never connects without explicit read approval.
Uses existing postgres:17 tools in a utility container, NOT the synthetic laboratory.
Secrets are mounted read-only via a protected pg_service.conf, never passed as values.
"""
import argparse,configparser,hashlib,json,os,re,resource,ssl,subprocess,sys,uuid
from datetime import datetime,timezone
from pathlib import Path
from preflight import module

def service_identity(path,section):
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}',section):raise ValueError('invalid service alias')
    if path.stat().st_uid!=os.getuid() or path.stat().st_mode&0o077:raise ValueError('service file must be private and user-owned')
    c=configparser.ConfigParser(interpolation=None);c.read(path)
    values=dict(c[section])
    if set(values)-{'host','port','dbname','user','password','sslmode','sslrootcert','connect_timeout','options'}:raise ValueError('unsupported service fields')
    if any(not values.get(k) for k in ('host','dbname','user','password')) or ',' in values['host']:raise ValueError('explicit single target required')
    return hashlib.sha256(json.dumps(['postgresql+psycopg',values['host'].lower(),int(values.get('port','5432')),values['dbname'],values['user']],separators=(',',':')).encode()).hexdigest()

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--plan',action='store_true');p.add_argument('--authorized-backup-read',action='store_true');p.add_argument('--confirm-encrypted-destination',action='store_true')
    for name in ('service-file','catalog','ca','out'):p.add_argument('--'+name,type=Path)
    p.add_argument('--service',default='practicalink_test');p.add_argument('--max-bytes',type=int,default=1024**3)
    a=p.parse_args()
    if a.plan:print('NO CONNECTION. Private service/CA, approved target, pg_dump17 single snapshot, public+supabase_migrations, max 1GiB; Storage separate; real restore authorization pending.');return 0
    if not(a.authorized_backup_read and a.confirm_encrypted_destination and all(getattr(a,k) for k in ('service_file','catalog','ca','out'))):p.error('Read approval, protected/encrypted destination assertion and artifacts required')
    D=['docker','--host','unix:///var/run/docker.sock'];name='practicalink09-backup-'+uuid.uuid4().hex[:12];owned=False;temporary=None;keeper=None
    try:
        catalog=json.loads(a.catalog.read_text())
        if catalog['status']!='complete' or not catalog['capture_exhaustive'] or service_identity(a.service_file,a.service)!=catalog['target_sha256']:raise ValueError('unapproved target')
        if hashlib.sha256(ssl.PEM_cert_to_DER_cert(a.ca.read_text())).hexdigest()!='807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa':raise ValueError('unapproved CA')
        if a.out.exists():raise ValueError('output already exists')
        if any((x/'.git').exists() for x in [a.out.resolve(),*a.out.resolve().parents]):raise ValueError('backups must stay outside Git worktrees')
        if ',' in str(a.service_file.resolve()) or ',' in str(a.ca.resolve()):raise ValueError('invalid mount path')
        a.out.mkdir(mode=0o700)
        base=D+['run','--rm','--pull=never','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','256m','--pids-limit','64','--user',str(os.getuid())+':'+str(os.getgid())]
        version=subprocess.run(base+['--network','none','postgres:17','pg_dump','--version'],capture_output=True,text=True,timeout=30,check=True).stdout.strip()
        if ' 17.' not in version:raise ValueError('client17 required')
        import psycopg
        from psycopg import sql
        secret=configparser.ConfigParser(interpolation=None);secret.read(a.service_file);v=secret[a.service]
        keeper=psycopg.connect(host=v['host'],port=int(v.get('port','5432')),user=v['user'],password=v['password'],dbname=v['dbname'],sslmode='verify-full',sslrootcert=str(a.ca),connect_timeout=5,autocommit=False,options='-c default_transaction_read_only=on -c statement_timeout=5000 -c idle_in_transaction_session_timeout=650000')
        keeper.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
        snapshot=keeper.execute('SELECT pg_export_snapshot()').fetchone()[0]
        tables=keeper.execute("SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN ('public','supabase_migrations') ORDER BY 1,2").fetchall()
        counts={schema+'.'+name:keeper.execute(sql.SQL('SELECT count(*) FROM {}.{}').format(sql.Identifier(schema),sql.Identifier(name))).fetchone()[0] for schema,name in tables}
        storage_count=keeper.execute('SELECT count(*) FROM storage.objects').fetchone()[0]
        bucket_config=keeper.execute('SELECT id,name,public,file_size_limit,allowed_mime_types FROM storage.buckets ORDER BY id').fetchall()
        cmd=base+['--name',name,'--label','practicalink09.backup='+name,'--network','host',
           '--mount','type=bind,src='+str(a.service_file.resolve())+',dst=/run/pg_service.conf,readonly',
           '--mount','type=bind,src='+str(a.ca.resolve())+',dst=/run/ca.crt,readonly',
           '--env','PGSERVICEFILE=/run/pg_service.conf','postgres:17','pg_dump','--no-password','--format=custom','--snapshot='+snapshot,'--lock-wait-timeout=5s',
           '--schema=public','--schema=supabase_migrations',
           '--dbname=service='+a.service+' sslmode=verify-full sslrootcert=/run/ca.crt connect_timeout=5 options=\'-c default_transaction_read_only=on\'']
        temporary=a.out/'database.dump.incomplete'
        def limits():resource.setrlimit(resource.RLIMIT_FSIZE,(a.max_bytes,a.max_bytes))
        with temporary.open('xb') as f:
            os.fchmod(f.fileno(),0o600);owned=True
            subprocess.run(cmd,stdout=f,stderr=subprocess.PIPE,timeout=600,check=True,preexec_fn=limits)
            f.flush();os.fsync(f.fileno())
        keeper.rollback();keeper.close();keeper=None
        if not 0<temporary.stat().st_size<=a.max_bytes:raise ValueError('archive size')
        # Validate the archive with the same major's restore client, offline.
        with temporary.open('rb') as archive:
            toc=subprocess.run(base+['--network','none','-i','postgres:17','pg_restore','--list'],stdin=archive,capture_output=True,timeout=60,check=True).stdout
        if b'TABLE DATA public usuario' not in toc:raise ValueError('application data absent')
        if b'supabase_migrations' not in toc:raise ValueError('history absent')
        (a.out/'restore-all.list').write_bytes(toc);os.chmod(a.out/'restore-all.list',0o600)
        module().publish_report(temporary,a.out/'database.dump');temporary=None
        receipt={'status':'complete','generated_utc':datetime.now(timezone.utc).isoformat(),'target_sha256':catalog['target_sha256'],
          'archive_sha256':hashlib.sha256((a.out/'database.dump').read_bytes()).hexdigest(),'client_version':version,
          'tls_mode':'verify-full','scope':['public','supabase_migrations'],'snapshot':'one exported repeatable-read snapshot shared with verification counts','table_counts':counts,'storage_objects':storage_count,'storage_bucket_config':bucket_config,
          'restoration_verified':False,'storage_backed_up':storage_count==0,'storage_backup_kind':'metadata_only_no_objects' if storage_count==0 else 'REQUIRED_SEPARATE_OBJECT_BACKUP','encrypted_destination':'operator assertion; not technically verified'}
        module().write_report(a.out/'backup.json',receipt)
        print('Backup read completed. Protected archive/receipt saved; real restore and Storage verification remain mandatory.')
        return 0
    except Exception:
        print('BACKUP_INCOMPLETE: no raw errors or connection data exported',file=sys.stderr);return 1
    finally:
        if keeper is not None:
            try:keeper.rollback();keeper.close()
            except Exception:print('BACKUP_CLEANUP_FAILED',file=sys.stderr)
        if temporary is not None and owned:temporary.unlink(missing_ok=True)
        # If the Docker client was killed, remove only the labelled utility we created.
        r=subprocess.run(D+['inspect',name],capture_output=True,text=True) if owned else None
        if r is not None and r.returncode==0:
            info=json.loads(r.stdout)[0]
            if info['Config']['Labels'].get('practicalink09.backup')==name:subprocess.run(D+['rm','-f',info['Id']],capture_output=True)
if __name__=='__main__':raise SystemExit(main())
