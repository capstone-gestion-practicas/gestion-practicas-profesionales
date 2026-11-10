"""Verify a SEPARATE, authorized recovery target read-only; never restores/writes SQL.
Archive restoration itself requires a separately approved protected environment.
"""
import argparse,configparser,hashlib,json,logging,sys
from pathlib import Path
from backup import service_identity
from preflight import module

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--authorized-recovery-read',action='store_true',required=True);p.add_argument('--confirm-restore-command-succeeded',action='store_true',required=True)
    for k in ('service-file','backup-receipt','archive','ca','out'):p.add_argument('--'+k,type=Path,required=True)
    p.add_argument('--service',default='practicalink_recovery');p.add_argument('--expected-recovery-sha256',required=True)
    a=p.parse_args();logging.disable(logging.CRITICAL)
    try:
        b=json.loads(a.backup_receipt.read_text());fp=service_identity(a.service_file,a.service)
        if fp!=a.expected_recovery_sha256 or fp==b['target_sha256']:raise ValueError('recovery target must be distinct and independently approved')
        if hashlib.sha256(a.archive.read_bytes()).hexdigest()!=b['archive_sha256']:raise ValueError('archive corrupt')
        import ssl
        if hashlib.sha256(ssl.PEM_cert_to_DER_cert(a.ca.read_text())).hexdigest()!='807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa':raise ValueError('unapproved CA')
        c=configparser.ConfigParser(interpolation=None);c.read(a.service_file);v=c[a.service]
        import psycopg
        from psycopg import sql
        with psycopg.connect(host=v['host'],port=int(v.get('port','5432')),user=v['user'],password=v['password'],dbname=v['dbname'],sslmode='verify-full',sslrootcert=str(a.ca),connect_timeout=5,autocommit=True,options='-c default_transaction_read_only=on -c statement_timeout=5000') as db:
            with db.transaction():
                db.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
                for name,count in b['table_counts'].items():
                    schema,table=name.split('.',1)
                    if schema not in ('public','supabase_migrations'):raise ValueError('invalid backup scope')
                    if db.execute(sql.SQL('SELECT count(*) FROM {}.{}').format(sql.Identifier(schema),sql.Identifier(table))).fetchone()[0]!=count:raise ValueError('restore row count mismatch')
        b.update(restoration_verified=True,recovery_target_sha256=fp,
            verification_scope='archive checksum + protected restore operator success + all source snapshot table counts; not entire Supabase platform or Storage bytes')
        module().write_report(a.out,b)
        print('PASS recovery counts/checksum in distinct read-only target; Storage flag preserved')
        return 0
    except Exception:
        print('RESTORE_VERIFICATION_FAILED: no raw error exported',file=sys.stderr);return 1
if __name__=='__main__':raise SystemExit(main())
