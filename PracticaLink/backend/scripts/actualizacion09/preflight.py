"""Read-only preflight. Importing does not read settings or connect."""
import argparse,collections,hashlib,importlib.util,json,logging,re,ssl,sys
from pathlib import Path
from common import ROOT,MIGRATIONS,EP06

def module():
    spec=importlib.util.spec_from_file_location('pl09_diag',ROOT/'PracticaLink/backend/scripts/diagnostico_supabase_catalogo.py')
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

def connect(catalog,ca):
    import psycopg
    from sqlalchemy.engine import make_url
    sys.path.insert(0,str(ROOT/'PracticaLink/backend'))
    from app.core.config import settings
    u=make_url(settings.supabase_database_url)
    if (module().target_fingerprint(u)!=catalog['target_sha256'] or u.drivername!='postgresql+psycopg'
            or u.query.get('sslmode','verify-full')!='verify-full'
            or set(u.query)-{'sslmode','sslrootcert','connect_timeout'}):raise ValueError('target/TLS rejected')
    if hashlib.sha256(ssl.PEM_cert_to_DER_cert(ca.read_text())).hexdigest()!='807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa':raise ValueError('unapproved CA')
    return psycopg.connect(host=u.host,port=u.port or 5432,user=u.username,password=u.password,dbname=u.database,
       sslmode='verify-full',sslrootcert=str(ca),connect_timeout=5,autocommit=True,prepare_threshold=None,
       options='-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1000 -c search_path=pg_catalog')

def verify(db,catalog,context):
    from psycopg.rows import dict_row
    if catalog['status']!='complete' or not catalog['capture_exhaustive'] or context['status']!='complete':raise ValueError('incomplete reference')
    with db.transaction():
        db.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
        m=module();params={**m.PARAMS,'ep07':m.EP07,'row_limit':2001}
        with db.cursor(row_factory=dict_row) as cursor:
            for section,query in m.QUERIES.items():
                query=re.sub(r'(?<!:):(\w+)',r'%(\1)s',query)
                cursor.execute(query+' LIMIT %(row_limit)s',params)
                rows=cursor.fetchall()
                def bag(data):return collections.Counter(json.dumps(dict(row),sort_keys=True,default=str) for row in data)
                if len(rows)>2000 or bag(rows)!=bag(catalog['sections'][section]):raise ValueError('CATALOG_DRIFT:'+section)
        versions=[r[0] for r in db.execute('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version')]
        if versions!=context['history_versions'] or versions!=[p.name[:14] for p in MIGRATIONS[:11]]:raise ValueError('history drift')
        for path in MIGRATIONS+EP06:
            if hashlib.sha256(path.read_bytes()).hexdigest()!=catalog['source_hashes'][str(path.relative_to(ROOT))]:raise ValueError('source drift')
        # An explicit exception forces rollback even on a successful preflight.
        raise PreflightPassed()
class PreflightPassed(Exception):pass

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--catalog',type=Path,required=True);p.add_argument('--context',type=Path,required=True);p.add_argument('--ca',type=Path,required=True)
    a=p.parse_args();logging.disable(logging.CRITICAL)
    try:
        catalog=json.loads(a.catalog.read_text());context=json.loads(a.context.read_text())
        with connect(catalog,a.ca) as db:
            try:verify(db,catalog,context)
            except PreflightPassed:pass
        print('PASS: preflight read-only; exact approved catalog/history/sources; rollback')
        return 0
    except Exception:
        print('PREFLIGHT_FAILED: no raw exception exported',file=sys.stderr);return 1
if __name__=='__main__':raise SystemExit(main())
