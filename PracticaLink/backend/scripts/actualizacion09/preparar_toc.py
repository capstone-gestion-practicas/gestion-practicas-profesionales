"""Offline TOC preparation. Keeps original archive intact; never contacts a database."""
import argparse,os
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--toc',type=Path,required=True);p.add_argument('--out',type=Path,required=True)
p.add_argument('--confirm-provider-defaults-match',action='store_true',required=True)
a=p.parse_args();lines=[];excluded=[]
for line in a.toc.read_text().splitlines():
    if ('DEFAULT ACL' in line and line.rstrip().endswith('supabase_admin')) or ' SCHEMA - public ' in line:
        excluded.append(line);lines.append(';provider-bootstrap-preverified '+line)
    else:lines.append(line)
if not excluded:raise SystemExit('No expected provider bootstrap entries; review before restore')
fd=os.open(a.out,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as f:f.write('\n'.join(lines)+'\n')
print('Offline restore list prepared; excluded provider bootstrap entries:',len(excluded))
