#!/usr/bin/env python3
"""Read-only PostgreSQL 17 catalog audit. Never invokes application functions.

Manual execution FROM backend, only after approval:
  .venv/bin/python -B scripts/diagnostico_supabase_catalogo.py \
    --execute-read-only --expected-target-sha256 <approved-fingerprint> \
    --output /tmp/practicalink-catalogo.json
Optional: --reference /tmp/previous-report.json (same script/report format).

Uses app.core.config.settings, NOT app.core.database/app.main. Imports configuration
only after explicit execution opt-in. Does not print URLs, exceptions, SQL bodies,
passwords, tokens, comments, defaults, application rows or migration-history rows.
Absence/presence is an indicator, never evidence that a migration was applied.
TLS verify-full is mandatory; use --show-target-fingerprint without connecting,
then independently confirm that the fingerprint identifies the authorized test project.
The output is published atomically without overwrite, with mode 0600 (Linux renameat2/RENAME_NOREPLACE).
No report is published if serialization exceeds 8 MiB or writing fails.
"""
from __future__ import annotations

import argparse
import ctypes
import hashlib
import json
import logging
import os
from pathlib import Path
import re
import sys
import tempfile
import time
from datetime import datetime, timezone

BACKEND = Path(__file__).resolve().parents[1]
ROW_LIMIT = 2000
STATEMENT_MS = 5000
TOTAL_SECONDS = 60
REPORT_BYTES = 8 * 1024 * 1024
SCHEMAS = ['public', 'practicas_privadas', 'seguimientos_privados',
           'docente_privado', 'informes_privados', 'incidencias_privadas',
           'supabase_migrations']
TABLES = ['rol', 'usuario', 'usuario_rol', 'estudiante', 'centro_practica',
          'estado_practica', 'practica', 'historial_estado', 'seguimiento',
          'incidencia', 'notificacion', 'tipo_documento', 'documento',
          'cierre_practica', 'dispositivo_push', 'recordatorio_cierre_practica',
          'historial_asignacion_docente', 'informe_final', 'informe_entrega',
          'evaluacion_informe', 'evaluacion_evento', 'tipo_incidencia',
          'historial_estado_incidencia']
EP07 = [
    'public.fn_ep07_exigir_cierre_registrado()',
    'public.fn_actualizar_estado_practica(bigint,bigint,bigint,character varying)',
    'public.fn_listar_gestores_activos(bigint)',
    'public.fn_asignar_gestor_practica(bigint,bigint,bigint)',
    'public.fn_listar_practicas_gestion_usuario(bigint)',
    'public.fn_listar_practicas_gestion()',
    'public.fn_cerrar_practica(bigint,bigint,text)',
    'public.fn_procesar_recordatorios_cierre()',
]
PUBLIC_FUNCTIONS = [signature.split('.')[1].split('(')[0] for signature in EP07] + [
    'fn_registrar_dispositivo_push', 'fn_eliminar_dispositivo_push',
    'fn_eliminar_dispositivos_usuario_push', 'fn_listar_destinatarios_mensaje_push',
    'fn_crear_mensaje_push_gestor', 'fn_crear_mensaje_push_broadcast',
    'fn_ep07_recordatorio_habilitado', 'fn_revisar_practica',
    'fn_puede_gestionar_practica', 'fn_registrar_seguimiento', 'fn_listar_seguimientos',
]
PARAMS = {'schemas': SCHEMAS, 'tables': TABLES, 'functions': PUBLIC_FUNCTIONS}
REL_SCOPE = "n.nspname='public' AND c.relname::text=ANY(:tables)"
FUNC_SCOPE = """p.prokind='f' AND
 ((n.nspname='public' AND p.proname::text=ANY(:functions)) OR
  (n.nspname::text=ANY(:schemas) AND n.nspname NOT IN ('public','supabase_migrations')))"""
ROLE_SCOPE = """(left(r.rolname,3)='pl_' OR r.rolname IN ('anon','authenticated','service_role')
 OR r.rolname=current_user OR EXISTS(
  SELECT 1 FROM pg_catalog.pg_auth_members membership
  JOIN pg_catalog.pg_roles parent ON parent.oid=membership.roleid
  WHERE membership.member=r.oid AND left(parent.rolname,3)='pl_'))"""

# Every FROM relation is pg_catalog; unnest/aclexplode inspect catalog arrays only.
# Raw function bodies/default expressions/policy expressions are deliberately hashed.
QUERIES = {
    'schemas': """SELECT nspname AS name, pg_catalog.pg_get_userbyid(nspowner) AS owner
        FROM pg_catalog.pg_namespace WHERE nspname::text=ANY(:schemas) ORDER BY 1""",
    'relations': f"""SELECT n.nspname AS schema,c.relname AS name,c.relkind AS kind,
        pg_catalog.pg_get_userbyid(c.relowner) AS owner,c.relrowsecurity AS rls,
        c.relforcerowsecurity AS force_rls
        FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE {REL_SCOPE} ORDER BY 1,2""",
    'columns': f"""SELECT c.relname AS relation,a.attname AS name,a.attnum AS position,
        pg_catalog.format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS not_null,
        a.attidentity AS identity,a.attgenerated AS generated,
        pg_catalog.md5(pg_catalog.pg_get_expr(d.adbin,d.adrelid)) AS default_hash
        FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
        JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
        WHERE {REL_SCOPE} AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum""",
    'constraints': f"""SELECT c.relname AS relation,k.conname AS name,k.contype AS type,
        k.convalidated AS validated,k.condeferrable AS deferrable,k.condeferred AS deferred,
        k.conkey AS columns,k.confkey AS referenced_columns,k.confdeltype AS on_delete,
        k.confupdtype AS on_update,rn.nspname AS referenced_schema,rc.relname AS referenced_relation,
        pg_catalog.md5(pg_catalog.pg_get_constraintdef(k.oid)) AS definition_hash
        FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid=k.conrelid
        JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        LEFT JOIN pg_catalog.pg_class rc ON rc.oid=k.confrelid
        LEFT JOIN pg_catalog.pg_namespace rn ON rn.oid=rc.relnamespace
        WHERE {REL_SCOPE} ORDER BY 1,2""",
    'indexes': f"""SELECT c.relname AS relation,ic.relname AS name,
        i.indisunique AS unique,i.indisprimary AS primary,i.indisvalid AS valid,i.indisready AS ready,
        i.indkey::text AS columns,pg_catalog.md5(pg_catalog.pg_get_indexdef(i.indexrelid)) AS definition_hash,
        pg_catalog.md5(pg_catalog.pg_get_expr(i.indpred,i.indrelid)) AS predicate_hash
        FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indrelid
        JOIN pg_catalog.pg_class ic ON ic.oid=i.indexrelid
        JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE {REL_SCOPE} ORDER BY 1,2""",
    'triggers': f"""SELECT c.relname AS relation,t.tgname AS name,t.tgenabled AS enabled,
        t.tgtype AS event_mask,t.tgattr::text AS update_columns,
        pn.nspname AS function_schema,p.proname AS function_name,
        pg_catalog.pg_get_function_identity_arguments(p.oid) AS function_arguments,
        pg_catalog.md5(pg_catalog.pg_get_triggerdef(t.oid)) AS definition_hash
        FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
        JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
        JOIN pg_catalog.pg_namespace pn ON pn.oid=p.pronamespace
        WHERE {REL_SCOPE} AND NOT t.tgisinternal ORDER BY 1,2""",
    'functions': f"""SELECT n.nspname AS schema,p.proname AS name,
        pg_catalog.pg_get_function_identity_arguments(p.oid) AS arguments,p.proargnames AS argument_names,
        pg_catalog.pg_get_function_result(p.oid) AS result,
        pg_catalog.pg_get_userbyid(p.proowner) AS owner,p.prosecdef AS security_definer,
        (SELECT pg_catalog.split_part(v,'=',2) FROM pg_catalog.unnest(p.proconfig) v
         WHERE pg_catalog.split_part(v,'=',1)='search_path' LIMIT 1) AS search_path,
        pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) AS definition_hash,
        (SELECT pg_catalog.jsonb_object_agg(r.rolname,pg_catalog.has_function_privilege(r.oid,p.oid,'EXECUTE'))
         FROM pg_catalog.pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role')) AS client_execute
        FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
        WHERE {FUNC_SCOPE} ORDER BY 1,2,3""",
    'function_acl': f"""SELECT n.nspname AS schema,p.proname AS name,
        pg_catalog.pg_get_function_identity_arguments(p.oid) AS arguments,
        CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END AS grantee,
        a.privilege_type AS privilege,a.is_grantable
        FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
        CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
        WHERE {FUNC_SCOPE} ORDER BY 1,2,3,4,5""",
    'ep07_contracts': """SELECT e.signature,p.oid IS NOT NULL AS present,
        pg_catalog.pg_get_function_result(p.oid) AS result,
        pg_catalog.pg_get_userbyid(p.proowner) AS owner,p.prosecdef AS security_definer,
        pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) AS definition_hash,
        (SELECT pg_catalog.jsonb_object_agg(r.rolname,pg_catalog.has_function_privilege(r.oid,p.oid,'EXECUTE'))
         FROM pg_catalog.pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role')) AS client_execute
        FROM pg_catalog.unnest(CAST(:ep07 AS text[])) e(signature)
        LEFT JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(e.signature)
        ORDER BY 1""",
    'roles': f"""SELECT r.rolname AS name,r.rolcanlogin AS login,r.rolinherit AS inherit,
        r.rolsuper AS superuser,r.rolcreatedb AS create_db,r.rolcreaterole AS create_role,
        r.rolbypassrls AS bypass_rls,r.rolreplication AS replication
        FROM pg_catalog.pg_roles r WHERE {ROLE_SCOPE} ORDER BY 1""",
    'memberships': """SELECT parent.rolname AS granted_role,member.rolname AS member,
        m.admin_option,m.inherit_option,m.set_option
        FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles parent ON parent.oid=m.roleid
        JOIN pg_catalog.pg_roles member ON member.oid=m.member
        WHERE left(parent.rolname,3)='pl_' OR left(member.rolname,3)='pl_' ORDER BY 1,2""",
    'schema_acl': """SELECT n.nspname AS schema,
        CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END AS grantee,
        a.privilege_type AS privilege,a.is_grantable
        FROM pg_catalog.pg_namespace n
        CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) a
        WHERE n.nspname::text=ANY(:schemas) ORDER BY 1,2,3""",
    'relation_acl': f"""SELECT c.relname AS relation,
        CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END AS grantee,
        a.privilege_type AS privilege,a.is_grantable
        FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
        WHERE {REL_SCOPE} ORDER BY 1,2,3""",
    'column_acl': f"""SELECT c.relname AS relation,col.attname AS column,
        CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END AS grantee,
        a.privilege_type AS privilege,a.is_grantable
        FROM pg_catalog.pg_attribute col JOIN pg_catalog.pg_class c ON c.oid=col.attrelid
        JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        CROSS JOIN LATERAL pg_catalog.aclexplode(col.attacl) a
        WHERE {REL_SCOPE} AND col.attnum>0 AND NOT col.attisdropped ORDER BY 1,2,3,4""",
    'effective_table_privileges': f"""SELECT c.relname AS relation,r.rolname AS role,
        pg_catalog.has_table_privilege(r.oid,c.oid,'SELECT') AS select_table,
        pg_catalog.has_table_privilege(r.oid,c.oid,'INSERT') AS insert_table,
        pg_catalog.has_table_privilege(r.oid,c.oid,'UPDATE') AS update_table,
        pg_catalog.has_table_privilege(r.oid,c.oid,'DELETE') AS delete_table,
        pg_catalog.has_table_privilege(r.oid,c.oid,'TRUNCATE') AS truncate_table,
        pg_catalog.has_any_column_privilege(r.oid,c.oid,'SELECT') AS select_column,
        pg_catalog.has_any_column_privilege(r.oid,c.oid,'INSERT') AS insert_column,
        pg_catalog.has_any_column_privilege(r.oid,c.oid,'UPDATE') AS update_column
        FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        CROSS JOIN pg_catalog.pg_roles r WHERE {REL_SCOPE} AND {ROLE_SCOPE}
        AND c.relkind IN ('r','p') ORDER BY 1,2""",
    'default_acl': """SELECT pg_catalog.pg_get_userbyid(d.defaclrole) AS creator,
        COALESCE(n.nspname,'<global>') AS schema,d.defaclobjtype AS object_type,
        CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END AS grantee,
        a.privilege_type AS privilege,a.is_grantable
        FROM pg_catalog.pg_default_acl d LEFT JOIN pg_catalog.pg_namespace n ON n.oid=d.defaclnamespace
        CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) a
        WHERE d.defaclnamespace=0 OR n.nspname::text=ANY(:schemas) ORDER BY 1,2,3,4,5""",
    'policies': f"""SELECT c.relname AS relation,pol.polname AS name,pol.polpermissive AS permissive,
        pol.polcmd AS command,
        ARRAY(SELECT CASE WHEN role_oid=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(role_oid) END
              FROM pg_catalog.unnest(pol.polroles) role_oid ORDER BY 1) AS roles,
        pg_catalog.md5(pg_catalog.pg_get_expr(pol.polqual,pol.polrelid)) AS using_hash,
        pg_catalog.md5(pg_catalog.pg_get_expr(pol.polwithcheck,pol.polrelid)) AS check_hash
        FROM pg_catalog.pg_policy pol JOIN pg_catalog.pg_class c ON c.oid=pol.polrelid
        JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE {REL_SCOPE} ORDER BY 1,2""",
}

# Indicators only. No result is labelled "migration applied".
MARKERS = {
    '12': [('relation','dispositivo_push'),('function','fn_registrar_dispositivo_push')],
    '13': [('function','fn_listar_destinatarios_mensaje_push'),('function','fn_crear_mensaje_push_gestor')],
    '14': [('function','fn_crear_mensaje_push_broadcast')],
    '15': [('index','idx_dispositivo_push_un_activo_por_usuario')],
    '16': [('column','practica.id_gestor'),('relation','recordatorio_cierre_practica'),('trigger','trg_ep07_exigir_cierre_registrado')],
    '17': [('function','fn_actualizar_estado_practica')],
    '18': [('function','fn_actualizar_estado_practica')],
    '19': [('function','fn_puede_gestionar_practica')],
    '20': [('schema','practicas_privadas')],
    '21': [('schema','seguimientos_privados'),('column','seguimiento.fecha_seguimiento')],
    '22': [('function','fn_ep07_recordatorio_habilitado')],
    '23': [('function','fn_revisar_practica')],
    '24': [('column','practica.id_docente'),('schema','docente_privado'),('relation','historial_asignacion_docente')],
    '25': [('schema','informes_privados'),('relation','informe_final'),('relation','informe_entrega')],
    '26': [('relation','evaluacion_informe'),('relation','evaluacion_evento'),('column','cierre_practica.id_evaluacion')],
    '27': [('column','informe_entrega.formato')],
    'EP06': [('schema','incidencias_privadas'),('relation','tipo_incidencia'),('relation','historial_estado_incidencia'),('column','incidencia.id_tipo_incidencia')],
}


def assess(sections):
    available = {
        'schema': {r['name'] for r in sections.get('schemas', [])},
        'relation': {r['name'] for r in sections.get('relations', [])},
        'column': {r['relation']+'.'+r['name'] for r in sections.get('columns', [])},
        'function': {r['name'] for r in sections.get('functions', [])},
        'trigger': {r['name'] for r in sections.get('triggers', [])},
        'index': {r['name'] for r in sections.get('indexes', [])},
    }
    return {number: [{'kind':kind,'object':name,'present':name in available[kind]}
                     for kind,name in markers] for number,markers in MARKERS.items()}


def reference_diff(sections, reference):
    """Identify object/field changes without printing reference values or SQL bodies."""
    keys = {
        'schemas': ('name',), 'relations': ('schema','name'),
        'columns': ('relation','name'), 'constraints': ('relation','name'),
        'indexes': ('relation','name'), 'triggers': ('relation','name'),
        'functions': ('schema','name','arguments'),
        'function_acl': ('schema','name','arguments','grantee','privilege'),
        'ep07_contracts': ('signature',), 'roles': ('name',),
        'memberships': ('granted_role','member'),
        'schema_acl': ('schema','grantee','privilege'),
        'relation_acl': ('relation','grantee','privilege'),
        'column_acl': ('relation','column','grantee','privilege'),
        'effective_table_privileges': ('relation','role'),
        'default_acl': ('creator','schema','object_type','grantee','privilege'),
        'policies': ('relation','name'),
    }
    differences=[]
    for section, rows in sections.items():
        old=reference.get('sections', {}).get(section)
        if old is None:
            differences.append({'section':section,'change':'missing_reference_section'})
            continue
        identity=lambda row: tuple(row.get(field) for field in keys[section])
        before={identity(row):row for row in old}
        after={identity(row):row for row in rows}
        for key in sorted(before.keys() | after.keys(),key=repr):
            previous=before.get(key); current=after.get(key)
            if previous==current: continue
            changes={'section':section,'object':dict(zip(keys[section],key))}
            if previous is None: changes['change']='new_in_current'
            elif current is None: changes['change']='missing_in_current'
            else:
                changes['change']='changed'
                changes['fields']=[field for field in sorted(previous.keys() | current.keys())
                                   if previous.get(field)!=current.get(field)]
            differences.append(changes)
    return differences


def target_fingerprint(url):
    """Stable target identity, including pooler routing user; excludes passwords/options."""
    endpoint=[url.drivername, url.host.lower(), url.port or 5432, url.database, url.username]
    return hashlib.sha256(json.dumps(endpoint,separators=(',',':')).encode()).hexdigest()


def validate_reference(reference):
    if (not isinstance(reference,dict) or reference.get('format_version')!=1
            or reference.get('scope')!='postgresql_catalogs_only'
            or reference.get('status')!='complete'
            or not isinstance(reference.get('sections'),dict)):
        raise ValueError('invalid reference')
    for name in QUERIES:
        rows=reference['sections'].get(name)
        if not isinstance(rows,list) or len(rows)>ROW_LIMIT or not all(isinstance(r,dict) for r in rows):
            raise ValueError('invalid reference section')


def publish_report(temporary, path):
    """Linux atomic rename with no replacement; no unsafe portability fallback."""
    rename=ctypes.CDLL(None,use_errno=True).renameat2
    rename.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint]
    rename.restype=ctypes.c_int
    # AT_FDCWD=-100; RENAME_NOREPLACE=1. Unsupported filesystems fail closed.
    if rename(-100,os.fsencode(temporary),-100,os.fsencode(path),1)!=0:
        raise OSError(ctypes.get_errno(),'atomic publication failed')


def write_report(path, report):
    """Bounded serialization, fsync and atomic no-clobber publication; fail closed."""
    payload=bytearray()
    encoder=json.JSONEncoder(ensure_ascii=False,indent=2,allow_nan=False)
    for chunk in encoder.iterencode(report):
        encoded=chunk.encode('utf-8')
        if len(payload)+len(encoded)+1>REPORT_BYTES:
            raise ValueError('report too large')
        payload.extend(encoded)
    payload.extend(b'\n')
    temporary=None
    try:
        descriptor, temporary=tempfile.mkstemp(prefix='.practicalink-catalog-',dir=path.parent)
        with os.fdopen(descriptor,'wb') as output:
            os.fchmod(output.fileno(),0o600)
            output.write(payload)
            output.flush()
            os.fsync(output.fileno())
        # Nothing fallible follows successful publication; rename consumes the temp
        # name. Unlike replace(), RENAME_NOREPLACE cannot overwrite a raced target.
        publish_report(temporary,path)
        temporary=None
    finally:
        if temporary is not None:
            os.unlink(temporary)


def connection_failure_code(error):
    """Classify known failures in memory; export only fixed non-sensitive codes."""
    try:
        message=str(getattr(error,'orig',error)).lower()
        patterns=(('root certificate file','TLS_ROOT_CA_MISSING'),
            ('certificate verify failed','TLS_CERTIFICATE_REJECTED'),
            ('does not match host name','TLS_HOSTNAME_MISMATCH'),
            ('failed to resolve host','DNS_FAILED'),('could not translate host name','DNS_FAILED'),
            ('unsupported startup parameter','STARTUP_PARAMETER_UNSUPPORTED'),
            ('password authentication failed','AUTHENTICATION_FAILED'),
            ('timeout expired','CONNECTION_TIMEOUT'))
        return next((code for text,code in patterns if text in message),'CONNECTION_FAILED')
    except Exception:
        return 'CONNECTION_FAILED'


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    mode=parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--execute-read-only',action='store_true',help='Explicit opt-in after approval')
    mode.add_argument('--show-target-fingerprint',action='store_true',help='Offline identity only; never connects')
    parser.add_argument('--expected-target-sha256',help='Independently approved endpoint fingerprint; no credentials')
    parser.add_argument('--output',type=Path,help='New local JSON file (0600); never overwritten')
    parser.add_argument('--tls-rootcert',help='Trusted CA PEM path or system; defaults to configured CA or system trust')
    parser.add_argument('--reference',type=Path,help='Optional trusted JSON report from this script')
    args=parser.parse_args()
    if args.show_target_fingerprint and (args.output or args.reference or args.expected_target_sha256):
        parser.error('Fingerprint mode accepts no report or reference options')
    if args.execute_read_only and (args.output is None or not args.expected_target_sha256
            or not re.fullmatch(r'[a-f0-9]{64}',args.expected_target_sha256)):
        parser.error('Execution requires a new output and an approved SHA-256 target fingerprint')
    if args.output is not None and (args.output.exists() or not args.output.parent.is_dir()):
        parser.error('The output must be a new file inside an existing directory')
    report={'format_version':1,'generated_utc':datetime.now(timezone.utc).isoformat(),
            'scope':'postgresql_catalogs_only','status':'incomplete','sections':{},
            'interpretation':'Complete means collection finished, never migration equivalence or deployment GO',
            'limits':{'statement_ms':STATEMENT_MS,'connect_seconds':5,'budget_seconds':TOTAL_SECONDS,'rows_per_section':ROW_LIMIT,'report_bytes':REPORT_BYTES},
            'limitations':['No application rows or migration-history rows read',
                'No business function invoked; object presence is not migration equivalence',
                'No raw function bodies, defaults, comments or policy predicates exported',
                'Hashes require an equivalent PostgreSQL reference and private review on mismatch',
                'No Storage API, bucket rows or external provider accessed'], 'findings':[]}
    engine=None
    capture_exhaustive=False
    stage='configuration'
    try:
        reference=None
        stage='reference_read'
        if args.reference:
            if args.reference.stat().st_size>16*1024*1024: raise ValueError('reference too large')
            reference=json.loads(args.reference.read_text())
            validate_reference(reference)
        stage='configuration'
        # Standalone audit: never allow third-party exception/SQL logging to reveal configuration.
        logging.disable(logging.CRITICAL)
        # Imports are deliberately lazy: --help never imports settings or opens a connection.
        from sqlalchemy import create_engine, text
        from sqlalchemy.engine import make_url
        from sqlalchemy.pool import NullPool
        sys.path.insert(0,str(BACKEND))
        from app.core.config import settings
        url=make_url(settings.supabase_database_url)
        if (url.drivername!='postgresql+psycopg' or not url.host or not url.username or not url.database
                or ',' in url.host or set(url.query)-{'sslmode','sslrootcert','connect_timeout'}):
            raise ValueError('unsupported configuration')
        stage='tls_configuration'
        if url.query.get('sslmode','verify-full')!='verify-full':
            raise ValueError('verified TLS required')
        # System trust still verifies the certificate chain AND the hostname. A
        # private CA must be provided explicitly; there is no verify-ca/require fallback.
        rootcert=args.tls_rootcert or url.query.get('sslrootcert') or 'system'
        if rootcert!='system' and (not Path(rootcert).is_file() or not os.access(rootcert,os.R_OK)):
            raise ValueError('trusted CA unavailable')
        fingerprint=target_fingerprint(url)
        if args.show_target_fingerprint:
            print('Target SHA-256: '+fingerprint)
            return 0
        stage='target_verification'
        if fingerprint!=args.expected_target_sha256:
            raise ValueError('target mismatch')
        report['target_sha256']=fingerprint
        report['tls_mode']='verify-full'
        report['tls_trust']='system' if rootcert=='system' else 'explicit_ca'
        options=('-c default_transaction_read_only=on -c statement_timeout=5000 '
                 '-c lock_timeout=1000 -c idle_in_transaction_session_timeout=10000 -c search_path=pg_catalog')
        engine=create_engine(url,echo=False,hide_parameters=True,poolclass=NullPool,
                             connect_args={'connect_timeout':5,'options':options,'sslmode':'verify-full','sslrootcert':rootcert})
        deadline=time.monotonic()+TOTAL_SECONDS
        stage='connection'
        with engine.connect().execution_options(isolation_level='REPEATABLE READ') as connection:
            transaction=connection.begin()
            try:
                connection.exec_driver_sql('SET TRANSACTION READ ONLY')
                server=dict(connection.execute(text("""SELECT
                    pg_catalog.current_setting('server_version_num') AS version_num,
                    pg_catalog.current_setting('transaction_read_only') AS read_only,
                    pg_catalog.current_setting('transaction_isolation') AS isolation""")).mappings().one())
                report['server']=server
                if int(server['version_num'])//10000!=17 or server['read_only']!='on' or server['isolation']!='repeatable read':
                    raise ValueError('server context rejected')
                parameters={**PARAMS,'ep07':EP07}
                for name,sql in QUERIES.items():
                    stage=name
                    remaining=int((deadline-time.monotonic())*1000)
                    if remaining<1: raise TimeoutError('audit budget exhausted')
                    timeout=min(STATEMENT_MS,remaining)
                    connection.exec_driver_sql(f'SET LOCAL statement_timeout = {timeout}')
                    rows=connection.execute(text(sql+' LIMIT :row_limit'),
                                            {**parameters,'row_limit':ROW_LIMIT+1}).mappings().all()
                    report['sections'][name]=[dict(row) for row in rows[:ROW_LIMIT]]
                    if len(rows)>ROW_LIMIT:
                        report['findings'].append({'section':name,'code':'ROW_LIMIT_REACHED'})
                capture_exhaustive=not report['findings']
            finally:
                try:
                    transaction.rollback()
                except Exception:
                    stage='rollback'
                    raise
            stage='connection_cleanup'
        stage='indicators'
        report['object_indicators']=assess(report['sections']) if capture_exhaustive else None
        report['ep06_functions']=[{'name':name,'present':any(r['schema']=='incidencias_privadas' and r['name']==name for r in report['sections'].get('functions',[]))}
            for name in ['fn_impedir_borrado','fn_registrar_incidencia','fn_consultar_incidencias','fn_cambiar_estado_incidencia','fn_consultar_historial_incidencia','fn_resumen_incidencias_pendientes']]
        stage='source_read'
        repo=BACKEND.parents[1]
        sources=sorted((BACKEND.parent/'supabase/migrations').glob('*.sql'))+sorted((repo/'scripts/BD/fixes').glob('ep06-*.sql'))
        report['source_hashes']={str(path.relative_to(repo)):hashlib.sha256(path.read_bytes()).hexdigest() for path in sources}
        report['missing_ep07_contracts']=[r['signature'] for r in report['sections'].get('ep07_contracts',[]) if not r['present']]
        stage='reference_comparison'
        if reference and capture_exhaustive:
            report['reference_differences']=reference_diff(report['sections'],reference)
        else:
            report['reference_comparison']='not_performed'
    except Exception as error:
        capture_exhaustive=False
        report['status']='incomplete'
        # Do not stringify errors: DBAPI/Pydantic exceptions can contain credentials.
        code=getattr(getattr(error,'orig',None),'sqlstate',None)
        finding={'section':stage,'code':'DIAGNOSTIC_INCOMPLETE'}
        if stage=='connection': finding['reason']=connection_failure_code(error)
        if isinstance(code,str) and re.fullmatch(r'[A-Z0-9]{5}',code): finding['sqlstate']=code
        report['findings'].append(finding)
    finally:
        if engine is not None:
            try:
                engine.dispose()
            except Exception:
                capture_exhaustive=False
                report['status']='incomplete'
                report['findings'].append({'section':'cleanup','code':'CONNECTION_CLEANUP_FAILED'})
    if args.show_target_fingerprint:
        print('No se pudo verificar la configuración del destino. Etapa: '+stage+'.',file=sys.stderr)
        return 1
    report['capture_exhaustive']=capture_exhaustive and not report['findings']
    report['status']='complete' if report['capture_exhaustive'] else 'incomplete'
    try:
        write_report(args.output,report)
    except Exception:
        report['status']='incomplete'
        print('Informe no confirmado. Etapa: report_write. Código: REPORT_WRITE_FAILED. '
              'No se sobrescribió ningún archivo.',file=sys.stderr)
        return 2
    print('Informe local generado. Estado: '+report['status']+'. No se modificó el esquema.')
    return 0 if report['status']=='complete' else 1


if __name__=='__main__':
    raise SystemExit(main())
