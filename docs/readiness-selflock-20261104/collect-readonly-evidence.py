"""Bounded local-file evidence only. Never connects to services or databases."""
import collections
import datetime
import hashlib
import json
from pathlib import Path
import re
import time

OUT = Path(__file__).parent
STATE = Path('D:/codex-isolated/main-manual-release-20261016')
PACKET = Path('D:/codex-isolated/main-release-packages/ba78ceff052c-9918ce3e-527bb5f5')
DJANGO = Path('D:/teruisi-runtime/django-sales')
WORKER = Path('D:/teruisi-runtime/teruisi-worker-sales')


def read_small(path, limit=128 * 1024):
    assert path.stat().st_size <= limit, str(path)
    raw = path.read_bytes()
    return json.loads(raw.decode('utf-8-sig')), hashlib.sha256(raw).hexdigest()


def main():
    start = time.perf_counter()
    result = {'observedAt': datetime.datetime.now().astimezone().isoformat(), 'method': 'bounded local files; no HTTP or SQL', 'logs': []}
    for date in ['2026-11-03', '2026-11-04']:
        p = DJANGO / 'logs' / f'postgresql-{date}.log'
        size = p.stat().st_size
        assert size < 5 * 1024 * 1024, 'Log grew beyond diagnostic bound'
        categories = collections.defaultdict(list)
        shared = []
        wait_count = 0
        digest = hashlib.sha256()
        consumed = 0
        with p.open('rb') as f:
            for lineno, raw in enumerate(f, 1):
                consumed += len(raw)
                if consumed > size:
                    break  # Do not chase an actively growing log.
                digest.update(raw)
                line = raw.decode('utf-8', errors='replace').strip()
                if 'still waiting' in line:
                    wait_count += 1
                if 'could not reserve shared memory region' in line:
                    shared.append({'line': lineno, 'at': line[:23], 'code487': '487' in line})
                m = re.search(r'duration: ([\d.]+) ms\s+statement:', line)
                if not m:
                    continue
                category = ('ai_revision_for_update' if 'ai_data_revisions' in line and 'FOR UPDATE' in line
                            else 'netshop_identity_count' if 'SELECT COUNT(*) FROM (SELECT DISTINCT' in line and 'netshop_rows' in line
                            else None)
                if category:
                    duration = float(m[1])
                    end = datetime.datetime.strptime(line[:23], '%Y-%m-%d %H:%M:%S.%f')
                    categories[category].append({'line': lineno, 'endedAtCst': line[:23], 'durationMs': duration,
                                                 'startedAtCstEstimate': (end - datetime.timedelta(milliseconds=duration)).isoformat(sep=' ', timespec='milliseconds')})
        stats = {}
        for key, records in categories.items():
            hourly = {}
            for hour in sorted(set(x['endedAtCst'][:13] for x in records)):
                items = [x for x in records if x['endedAtCst'].startswith(hour)]
                hourly[hour] = {'loggedCount': len(items), 'maxMs': max(x['durationMs'] for x in items)}
            near_check = [x for x in records if x['startedAtCstEstimate'] <= '2026-11-04 01:05:12.000' and x['endedAtCst'] >= '2026-11-04 01:01:40.000']
            after0030 = [x for x in records if x['endedAtCst'] >= '2026-11-04 00:30:00.000']
            stats[key] = {'loggedCount': len(records), 'minMs': min(x['durationMs'] for x in records),
                          'maxMs': max(x['durationMs'] for x in records), 'totalLoggedMs': round(sum(x['durationMs'] for x in records), 3),
                          'hourly': hourly, 'slowest': sorted(records, key=lambda x: x['durationMs'], reverse=True)[:3],
                          'overlapsFailedCheckWindow': near_check, 'after0030': {'loggedCount': len(after0030), 'maxMs': max((x['durationMs'] for x in after0030), default=None)}}
        result['logs'].append({'path': str(p), 'snapshotBytes': size, 'scannedBytes': min(consumed, size),
                               'scannedPrefixSha256': digest.hexdigest(), 'stillWaitingLinesAllRelations': wait_count,
                               'durationStatements': stats, 'sharedMemoryFailures': shared})

    catalog, catalog_sha = read_small(STATE / 'PUBLISHED-MAIN.json')
    control, control_sha = read_small(STATE / 'CONTROL-INSTALLATION.json')
    prepared_path = PACKET / 'publish-ba78ceff052c/preparation/PREPARED.json'
    prepared, prepared_sha = read_small(prepared_path)
    request, request_file_sha = read_small(PACKET / 'main-release-request.json')
    result['publication'] = {k: catalog.get(k) for k in ['status', 'at', 'mainCommit', 'workerRelease', 'workerManifestSha256', 'djangoManifestSha256']}
    result['publication']['catalogSha256'] = catalog_sha
    result['control'] = {k: control.get(k) for k in ['status', 'bundleRoot', 'bundleSha256']}
    result['control']['installationSha256'] = control_sha
    result['prepared'] = {'path': str(prepared_path), 'sha256': prepared_sha, 'requestFileSha256': request_file_sha, **prepared}
    result['request'] = {k: request.get(k) for k in ['mainCommit', 'deployedCommit', 'components', 'migrate']}
    result['attemptMembers'] = sorted(x.name for x in (PACKET / 'publish-ba78ceff052c').iterdir())
    _, django_sha = read_small(DJANGO / 'app/deployment.json', 2 * 1024 * 1024)
    _, candidate_django_sha = read_small(DJANGO / ('app.deploy-' + prepared['djangoPackage']['id']) / 'deployment.json', 2 * 1024 * 1024)
    result['manifestChecks'] = {'liveDjangoMatchesCatalog': django_sha == catalog['djangoManifestSha256'],
                               'candidateDjangoMatchesPrepared': candidate_django_sha == prepared['djangoManifestSha256']}
    worker_receipt, _ = read_small(WORKER / 'state/worker-process.json')
    result['workerReceipt'] = {k: worker_receipt.get(k) for k in ['releaseId', 'manifestSha256', 'supervisorPid', 'supervisorCreationDate']}
    result['markers'] = {str(p): p.exists() for p in [DJANGO / 'run/system-maintenance.json', DJANGO / 'run/automation-drain.json', DJANGO / 'run/release-publication-lease.json']}
    result['elapsedSeconds'] = round(time.perf_counter() - start, 3)
    (OUT / 'READONLY-EVIDENCE.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'evidence': str(OUT / 'READONLY-EVIDENCE.json'), 'elapsedSeconds': result['elapsedSeconds'], 'logs': [{'path': x['path'], 'bytes': x['snapshotBytes'], 'durationStatements': {k: {f: v[f] for f in ['loggedCount', 'minMs', 'maxMs']} for k,v in x['durationStatements'].items()}, 'sharedMemoryFailureCount': len(x['sharedMemoryFailures'])} for x in result['logs']], 'manifestChecks': result['manifestChecks']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
