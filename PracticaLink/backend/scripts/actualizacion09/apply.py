"""Prepared write procedure. NEVER run before explicit approval. No auto-resume/down."""
import argparse,hashlib,json,logging,sys
from datetime import datetime,timezone
from pathlib import Path
from common import ROOT,MIGRATIONS,EP06,update
from preflight import connect,verify,PreflightPassed,module

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--plan',action='store_true');p.add_argument('--authorized-remote-write',action='store_true')
    p.add_argument('--confirm-maintenance',action='store_true');p.add_argument('--approve-ep06-candidate',action='store_true')
    for name in ('catalog','context','ca','backup-receipt','archive','receipt'):p.add_argument('--'+name,type=Path)
    a=p.parse_args();logging.disable(logging.CRITICAL)
    if a.plan:
        print('NO CONNECTION. History reconciliation: 12–16; SQL: 17–27 + EP06 01–09; candidate and temporary membership require approval; no down/resume.')
        return 0
    if not(a.authorized_remote_write and a.confirm_maintenance and a.approve_ep06_candidate and all(getattr(a,k) for k in ('catalog','context','ca','backup_receipt','archive','receipt'))):p.error('Explicit approvals and all protected artifacts required; use --plan first')
    try:
        catalog=json.loads(a.catalog.read_text());context=json.loads(a.context.read_text());backup=json.loads(a.backup_receipt.read_text())
        if backup['status']!='complete' or backup['target_sha256']!=catalog['target_sha256']:raise ValueError('backup target/status mismatch')
        if hashlib.sha256(a.archive.read_bytes()).hexdigest()!=backup['archive_sha256']:raise ValueError('archive corrupt')
        if not backup.get('storage_backed_up'):raise ValueError('Storage backup incomplete')
        if not backup.get('restoration_verified'):raise ValueError('restore approval/verification missing')
        age=(datetime.now(timezone.utc)-datetime.fromisoformat(backup['generated_utc'])).total_seconds()
        if not 0<=age<=3600:raise ValueError('backup older than maintenance window (1h)')
        if a.receipt.exists():raise ValueError('receipt already exists')
        approved=json.loads((Path(__file__).parent/'integridad.json').read_text())
        for name,digest in approved.items():
            if hashlib.sha256((Path(__file__).parent/name).read_bytes()).hexdigest()!=digest:raise ValueError('package integrity changed')
        with connect(catalog,a.ca) as db:
            try:verify(db,catalog,context)
            except PreflightPassed:pass
            update(db,temporary_membership=True,compatible_ep06=True)
        result={'status':'complete','target_sha256':catalog['target_sha256'],'history_versions':27,
          'source_hashes':{str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in MIGRATIONS+EP06},
          'ep06_candidate_sha256':approved['ep06_01_compatible_roundtrip.sql'],
          'generated_utc':datetime.now(timezone.utc).isoformat(),'rule':'No down migration; never restore unsafe closure functions'}
        module().write_report(a.receipt,result)
        print('Committed; receipt saved. Keep maintenance until independent postflight and runtime principal tests.')
        return 0
    except Exception as error:
        code=getattr(error,'sqlstate',None)
        print('UPDATE_NOT_CONFIRMED. Stop; no blind retry. SQLSTATE: '+(code if isinstance(code,str) and len(code)==5 else 'unavailable'),file=sys.stderr)
        return 1
if __name__=='__main__':raise SystemExit(main())
