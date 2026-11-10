"""Offline recovery target check; exports no connection values and never connects."""
import argparse,json
from pathlib import Path
from backup import service_identity
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--service-file',type=Path,required=True);p.add_argument('--service',required=True)
p.add_argument('--expected-sha256',required=True);p.add_argument('--source-receipt',type=Path,required=True)
a=p.parse_args()
try:
    fp=service_identity(a.service_file,a.service)
    if fp!=a.expected_sha256 or fp==json.loads(a.source_receipt.read_text())['target_sha256']:raise ValueError('target rejected')
except Exception:raise SystemExit('RECOVERY_IDENTITY_REJECTED; no connection made')
print('PASS: distinct recovery target matches approved fingerprint; no connection made')
