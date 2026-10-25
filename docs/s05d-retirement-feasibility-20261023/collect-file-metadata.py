"""Bounded, read-only control metadata; output stays next to this script."""
import datetime
import hashlib
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent
STATE = Path('D:/codex-isolated/main-manual-release-20261016')
WORKER = Path('D:/teruisi-runtime/teruisi-worker-sales')
START = '2026-10-22T07:10:00'
END = '2026-10-22T07:32:00'

def raw_file(p):
    st = p.lstat()
    if not p.is_file() or p.is_symlink() or st.st_nlink != 1 or st.st_size > 1024 * 1024:
        raise ValueError(f'Unsafe/oversized metadata: {p}')
    raw = p.read_bytes()
    after = p.lstat()
    if (st.st_ino, st.st_size, st.st_mtime_ns) != (after.st_ino, after.st_size, after.st_mtime_ns):
        raise ValueError(f'Metadata changed: {p}')
    return raw

def pin(p):
    raw = raw_file(p)
    return {'path': str(p), 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}

def names(p, limit=2048):
    if p.is_symlink() or p.resolve() != p.absolute():
        raise ValueError(f'Redirected root: {p}')
    rows = sorted(p.iterdir())
    if len(rows) > limit:
        raise ValueError(f'Entry bound exceeded: {p}')
    return rows

queue = {}
for domain in ['tickets', 'dispatches', 'results', 'resolutions']:
    for p in names(STATE/'prebuild-queue-v2'/domain):
        if p.suffix == '.json' and p.is_file():
            queue[str(p.relative_to(STATE/'prebuild-queue-v2'))] = pin(p)

executions = []
execution_names = names(STATE/'control-executions', 4096)
for p in execution_names:
    if p.suffix != '.json':
        continue
    raw = raw_file(p)
    value = json.loads(raw)
    if START <= value.get('startedAt', '')[:19] <= END:
        token = value.get('token') or {}
        executions.append({
            **pin(p),
            **{k:value.get(k) for k in ['version','executionId','installId','bundleSha256','entry','mode','pid','createdAt','startedAt','commandLineSha256','executableSha256']},
            'token': {k:token.get(k) for k in ['sessionId','elevated','integrityLevel','integrityRid']},
            'bindingLimit':'Control entry identity only; no child tree/dispatch association inferred.'
        })

staging = []
for p in names(WORKER/'.staging', 256):
    st = p.lstat()
    staging.append({'name':p.name,'dev':st.st_dev,'ino':st.st_ino,
                    'birthtime':getattr(st,'st_birthtime',None),'mtime':st.st_mtime,
                    'isLink':p.is_symlink(),'isDirectory':p.is_dir(),
                    'directChildren':[c.name for c in names(p,256)] if p.is_dir() and not p.is_symlink() else None})

result = {
    'version':'s05d-retirement-file-metadata-v1',
    'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'queueJsonLeaves':queue,
    'controlExecutionWindow':{'startUtc':START+'Z','endUtc':END+'Z','enumerated':len(execution_names),'matching':executions},
    'staging':{'root':str(WORKER/'.staging'),'entries':staging},
    'pins':[pin(STATE/n) for n in ['CONTROL-INSTALLATION.json','main-publisher-config.json']],
    'limits':['No recursive staging contents, runtime payloads, process census or complete effect/consumption inventory.',
              'Entry names, absence and timestamps are not ownership or zero-effect proofs.',
              'No source/control/native operators executed; only bounded file metadata read.']
}
(OUT/'file-metadata.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'queueFiles':len(queue),'windowExecutions':len(executions),'stagingEntries':len(staging)}))
