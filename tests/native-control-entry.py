"""Run the original entry in a fixed private installation with a clean environment.

This records original exit/output and never translates failure into readiness.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

SOURCE = Path(__file__).resolve().parents[1]
ROOT = Path(r'D:/codex-isolated/native-control-ai-20261108')
EVIDENCE = Path(r'D:/codex-artifacts/ai-native-control-isolation-20261108')


def environment():
    # No caller cloud/provider tokens, proxy, model settings or business URL.
    names = ['SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT', 'PATH', 'USERPROFILE',
             'APPDATA', 'LOCALAPPDATA', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramData',
             'HOMEDRIVE', 'HOMEPATH', 'USERNAME', 'USERDOMAIN', 'PROCESSOR_ARCHITECTURE']
    env = {name: os.environ[name] for name in names if name in os.environ}
    for folder in ['scratch', 'home']:
        (ROOT / folder).mkdir(exist_ok=True)
    (ROOT / 'empty-npmrc').touch(exist_ok=True)
    env.update(TEMP=str(ROOT/'scratch'), TMP=str(ROOT/'scratch'), HOME=str(ROOT/'home'),
        TERUISI_NATIVE_ISOLATION_FILE=str(ROOT/'isolation.json'),
        TERUISI_NATIVE_ISOLATION_SHA256=hashlib.sha256((ROOT/'isolation.json').read_bytes()).hexdigest(),
        PYTHONDONTWRITEBYTECODE='1', PYTHONUTF8='1', PYTHONIOENCODING='utf-8',
        WRANGLER_SEND_METRICS='false', WRANGLER_WRITE_LOGS='false',
        CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV='false',
        NPM_CONFIG_USERCONFIG=str(ROOT/'empty-npmrc'), NO_UPDATE_NOTIFIER='1', DO_NOT_TRACK='1', CI='true')
    return env


def main():
    label, script, action = sys.argv[1:4]
    if not label.replace('-', '').isalnum() or '/' in label:
        raise ValueError('invalid_evidence_label')
    scripts = {
        'django-source': SOURCE/'tools/django-local-service.ps1',
        'django-installed': ROOT/'django/app/tools/django-local-service.ps1',
        'system': SOURCE/'tools/operations-system-service.ps1',
        'worker': SOURCE/'tools/worker-local-service.ps1',
    }
    if action not in {'Configure', 'DeployApp', 'HardenAcl', 'Start', 'Stop', 'Status', 'AggregateStatus', 'Deploy', 'Verify'}:
        raise ValueError('action_outside_rehearsal')
    env = environment()
    args = [shutil.which('pwsh.exe'), '-NoProfile', '-NonInteractive', '-File', str(scripts[script]), '-Action', action, *sys.argv[4:]]
    start = time.time()
    with (EVIDENCE/(label+'.stdout.log')).open('xb') as out, (EVIDENCE/(label+'.stderr.log')).open('xb') as err:
        result = subprocess.run(args, env=env, cwd=SOURCE, stdout=out, stderr=err,
                                timeout=1800, creationflags=subprocess.CREATE_NO_WINDOW)
    record = {'label': label, 'script': str(scripts[script]), 'action': action,
              'exitCode': result.returncode, 'elapsedSeconds': time.time()-start,
              'environmentNames': sorted(env), 'inheritedBusinessCredentials': False,
              'isolationSha256': env['TERUISI_NATIVE_ISOLATION_SHA256'],
              'scriptSha256': hashlib.sha256(scripts[script].read_bytes()).hexdigest()}
    for kind in ['stdout', 'stderr']:
        record[kind+'Sha256'] = hashlib.sha256((EVIDENCE/(label+'.'+kind+'.log')).read_bytes()).hexdigest()
    (EVIDENCE/(label+'.json')).write_text(json.dumps(record, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({k: record[k] for k in ['label', 'exitCode', 'elapsedSeconds']}))
    raise SystemExit(result.returncode)


if __name__ == '__main__':
    main()
