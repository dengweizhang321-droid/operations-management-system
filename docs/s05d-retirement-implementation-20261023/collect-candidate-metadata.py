"""Read fixed native metadata leaves only; never execute a native tool or read payloads."""
import datetime
import hashlib
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent
WORKER = Path('D:/teruisi-runtime/teruisi-worker-sales')
DJANGO = Path('D:/teruisi-runtime/django-sales')
DOMAINS = ['worker-prepared-builds','worker-release-publication-staging','worker-release-rotation-consumptions','worker-release-rotation-plans','worker-release-successors']
MAX_FILES = 3072  # Size-only census found 2,390 fixed leaves, about 5.8 MiB total.
MAX_BYTES = 24 * 1024 * 1024
used = 0
objects = []
members = {}

def entries(p):
    if p.is_symlink() or p.resolve() != p.absolute():
        raise ValueError('Redirected metadata root: '+str(p))
    result = sorted(p.iterdir())
    if len(result) > MAX_FILES:
        raise ValueError('Directory member bound exceeded')
    members[str(p)] = [x.name for x in result]
    return result

def read(p):
    global used
    st=p.lstat()
    if not p.is_file() or p.is_symlink() or p.resolve()!=p.absolute() or st.st_nlink!=1 or st.st_size>2*1024*1024:
        raise ValueError('Unsafe metadata: '+str(p))
    used += st.st_size
    if used>MAX_BYTES: raise ValueError('Total metadata byte bound exceeded')
    if len(objects)>=MAX_FILES: raise ValueError('Total metadata object bound exceeded')
    raw=p.read_bytes(); after=p.lstat()
    if (st.st_ino,st.st_size,st.st_mtime_ns)!=(after.st_ino,after.st_size,after.st_mtime_ns):
        raise ValueError('Metadata changed during read')
    return raw

FIELDS = ['version','id','releaseId','createdAt','updatedAt','at','status','phase','sequence','operationId','planSha256','planFile','planPath','planFileSha256','payloadSha256','candidateManifestSha256','candidateReleaseId','predecessorManifestSha256','predecessorChainStateSha256','identity','sourceBinding','candidate','predecessor','successor','binding','runtimeRoot','sourceRoot','deployedAt','fingerprintAlgorithm','fileCount','appFingerprint','sourceTree','targetCommit','mainCommit']
def record(p,kind):
    raw=read(p); item={'path':str(p),'kind':kind,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
    if p.name.endswith('.sha256'):
        if len(raw)>128: raise ValueError('Oversized sidecar')
        item['sidecarText']=raw.decode('ascii').strip()
    else:
        v=json.loads(raw); item['keys']=sorted(v);item['fields']={k:v[k] for k in FIELDS if k in v}
        if isinstance(v.get('source'),dict):item['fields']['source']={k:v['source'][k] for k in ['rootPathSha256','sourceFingerprint','tree','sourceBinding'] if k in v['source']}
        if isinstance(v.get('runtime'),dict):item['fields']['runtime']={k:v['runtime'][k] for k in ['runtimeRootPathSha256','releaseRootPathSha256'] if k in v['runtime']}
    objects.append(item)

for release in entries(WORKER/'releases'):
    if not release.is_dir():raise ValueError('Unexpected release root entry')
    manifest=release/'deployment-manifest.json'
    if manifest.exists():record(manifest,'worker-release-manifest')
    else:objects.append({'path':str(manifest),'kind':'worker-release-manifest','present':False})
for domain in DOMAINS:
    root=WORKER/'state'/domain
    # Only named JSON metadata and sidecars. Nested directories stay explicitly uninspected.
    for p in entries(root):
        if p.is_file() and (p.suffix=='.json' or p.name.endswith('.sha256')):record(p,domain)
        else:objects.append({'path':str(p),'kind':domain,'uninspected':True})
record(WORKER/'current-deployment.json','worker-current-pointer')
for p in entries(DJANGO):
    if p.name.startswith('app.prepare-') and p.suffix=='.json':record(p,'django-prepared')
    if p.name.startswith('app.deploy-') and p.is_dir():
        manifest=p/'deployment.json'
        if manifest.exists():record(manifest,'django-candidate-manifest')
        else:objects.append({'path':str(manifest),'kind':'django-candidate-manifest','present':False})
record(DJANGO/'app'/'deployment.json','django-current-manifest')
for directory,original in members.items():
    if sorted(x.name for x in Path(directory).iterdir())!=original:raise ValueError('Metadata membership changed')
result={'version':'s05d-candidate-metadata-v1','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'members':members,'objects':objects,'totalBytesRead':used,'limits':['Fixed metadata leaves only; no payload/secret contents.','This observation is not a complete ownership, integrity or consumption validation.','Missing or uninspected members are not evidence of zero effects.']}
(OUT/'candidate-metadata.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'objects':len(objects),'bytesRead':used,'membershipRoots':len(members)}))
