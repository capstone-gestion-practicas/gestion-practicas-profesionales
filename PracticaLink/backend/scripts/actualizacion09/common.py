"""Pure preparation helpers: no configuration imports, database or network on import."""
import hashlib,json,re
from pathlib import Path
# Resolve this checkout, never a personal path or another worktree.
ROOT=Path(__file__).resolve().parents[4]
MIGRATIONS=sorted((ROOT/'PracticaLink/supabase/migrations').glob('*.sql'))
EP06=sorted((ROOT/'scripts/BD/fixes').glob('ep06-0*.sql'))
assert len(MIGRATIONS)==27 and len(EP06)==9

def quoted(name):return '"'+name.replace('"','""')+'"'
def literal(value):return "'"+str(value).replace("'","''")+"'"
def adopted(source):
    """Adopt ONLY audited external transaction frame, keeping all body bytes intact."""
    begins=list(re.finditer(r'^BEGIN;\s*$',source,re.M));ends=list(re.finditer(r'^COMMIT;\s*$',source,re.M))
    if not begins and not ends:return source
    if len(begins)!=1 or len(ends)!=1 or ends[0].end()!=len(source.rstrip()) and source[ends[0].end():].strip():
        raise ValueError('unexpected transaction frame')
    b,e=begins[0],ends[0]
    if b.end()>e.start():raise ValueError('invalid frame')
    return source[:b.start()]+source[b.end():e.start()]+source[e.end():]

def history_sql(path):
    version,name=path.stem.split('_',1)
    return 'INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('+literal(version)+','+literal(name)+',NULL)'

def cleanup_sql():
    # Keep the implicit ADMIN option of the creator, remove inherited/SET capabilities.
    return """DO $cleanup$ DECLARE x record; BEGIN
    FOR x IN SELECT r.rolname FROM pg_catalog.pg_auth_members a
      JOIN pg_catalog.pg_roles r ON r.oid=a.roleid
      WHERE a.member=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user)
        AND a.grantor=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user)
        AND r.rolname IN ('pl_ep04_executor','pl_ep04_owner','pl_ep05_executor','pl_ep05_owner','pl_ep05_read_executor','pl_ep05_read_owner','pl_ep06_executor','pl_ep06_history_owner','pl_ep06_owner','pl_ep06_read_owner','pl_ep06_state_owner','pl_s41_docente_executor','pl_s41_docente_owner','pl_s42_executor','pl_s42_owner','pl_s43_cierre_owner') LOOP
      EXECUTE format('REVOKE %I FROM %I GRANTED BY %I',x.rolname,current_user,current_user);
    END LOOP; END $cleanup$"""

def update(db, *, temporary_membership=False, inject_after=None, compatible_ep06=False, audit=None):
    """One outer transaction: reconciliation, DDL, history and cleanup are atomic.
    Existing own BEGIN/COMMIT frames are adopted in memory, never edit source files.
    Caller must preflight target/catalog/maintenance/backup and authorize writes.
    """
    global LAST_STEP
    with db.transaction():
        db.execute('SET TRANSACTION READ WRITE')
        db.execute('SET LOCAL lock_timeout=\'5s\'')
        db.execute('SET LOCAL statement_timeout=\'90s\'')
        db.execute('SELECT pg_catalog.pg_advisory_xact_lock(90920261110)')
        actual=[r[0] for r in db.execute('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version')]
        if actual!=[p.name[:14] for p in MIGRATIONS[:11]]:raise ValueError('history drift')
        if db.execute("SELECT count(*) FROM pg_roles WHERE left(rolname,3)='pl_'").fetchone()[0]:raise ValueError('unexpected private roles')
        if temporary_membership:db.execute("SET LOCAL createrole_self_grant='inherit,set'")
        for path in MIGRATIONS[11:16]:db.execute(history_sql(path))
        for path in MIGRATIONS[16:]+EP06:
            LAST_STEP=path.name
            source=(Path(__file__).parent/'ep06_01_compatible_roundtrip.sql').read_text() if compatible_ep06 and path==EP06[0] else path.read_text()
            db.execute(adopted(source),prepare=False)
            if inject_after==path.name:raise RuntimeError('synthetic injected failure')
            if path in MIGRATIONS:db.execute(history_sql(path))
        if audit is not None:
            audit['before']=db.execute("SELECT p.proname,pg_get_function_identity_arguments(p.oid),pg_get_userbyid(p.proowner),p.proacl::text,has_function_privilege('pl_s42_executor',p.oid,'EXECUTE') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='informes_privados' ORDER BY 1,2").fetchall()
        db.execute(cleanup_sql())
        if audit is not None:
            audit['after']=db.execute("SELECT p.proname,pg_get_function_identity_arguments(p.oid),pg_get_userbyid(p.proowner),p.proacl::text,has_function_privilege('pl_s42_executor',p.oid,'EXECUTE') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='informes_privados' ORDER BY 1,2").fetchall()
