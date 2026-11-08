"""Direct private-binding checks; no service, database or network calls."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
PROFILE = Path(r'D:/codex-isolated/native-control-ai-20261108/isolation.json')
env = {**os.environ, 'TERUISI_NATIVE_ISOLATION_FILE': str(PROFILE),
       'TERUISI_NATIVE_ISOLATION_SHA256': hashlib.sha256(PROFILE.read_bytes()).hexdigest(),
       'PYTHONPATH': str(ROOT / 'backend'), 'PYTHONDONTWRITEBYTECODE': '1'}
checks = []


def run(label, args, expected=0, changes=None):
    if '-Command' in args:
        args = [*args[:-1], "$ErrorActionPreference='Stop'; $Action='Status'; " + args[-1]]
    result = subprocess.run(args, cwd=ROOT, env={**env, **(changes or {})},
                            capture_output=True, timeout=30)
    assert (result.returncode == 0) == (expected == 0), (label, result.returncode, result.stderr[-1500:])
    checks.append({'check': label, 'exitCode': result.returncode, 'expectedSuccess': expected == 0,
                   'stdoutSha256': hashlib.sha256(result.stdout).hexdigest(),
                   'stderrSha256': hashlib.sha256(result.stderr).hexdigest()})


ps = ". ./tools/native-isolation.ps1; if ($NativePorts[3000] -ne 23000 -or $NativePorts[5432] -ne 25432) { throw 'wrong map' }; if ((Get-NativeRuntimeRoot 'django' '' $false) -notlike '*native-control-ai-20261108*') { throw 'wrong root' }"
for shell in ['powershell.exe', 'pwsh.exe']:
    run(shell + '-real-map', [shell, '-NoProfile', '-NonInteractive', '-Command', ps])
    run(shell + '-bad-hash', [shell, '-NoProfile', '-NonInteractive', '-Command', ps], 1,
        {'TERUISI_NATIVE_ISOLATION_SHA256': '0' * 64})
    run(shell + '-production-root-rejected', [shell, '-NoProfile', '-NonInteractive', '-Command',
        ". ./tools/native-isolation.ps1; Get-NativeRuntimeRoot 'django' 'D:\\teruisi-runtime\\django-sales' $true"], 1)
    run(shell + '-private-root-missing-profile', [shell, '-NoProfile', '-NonInteractive', '-Command',
        ". ./tools/native-isolation.ps1; Get-NativeRuntimeRoot 'django' 'D:\\codex-isolated\\native-control-ai-20261108\\django' $true"], 1,
        {'TERUISI_NATIVE_ISOLATION_FILE': '', 'TERUISI_NATIVE_ISOLATION_SHA256': ''})
run('node-real-map', ['node', '--input-type=module', '-e',
    "import {nativePort,nativeIsolation} from './tools/native-isolation.mjs'; if(nativePort(3000)!==23000 || !nativeIsolation) throw Error('wrong map')"])
run('node-bad-hash', ['node', '--input-type=module', '-e', "await import('./tools/native-isolation.mjs')"], 1,
    {'TERUISI_NATIVE_ISOLATION_SHA256': '0' * 64})
run('python-real-map', [sys.executable, '-B', '-c',
    'from pandas_runner.native_isolation import native_port,PROFILE; assert native_port(8121)==28121 and PROFILE'])
run('python-bad-hash', [sys.executable, '-B', '-c', 'import pandas_runner.native_isolation'], 1,
    {'TERUISI_NATIVE_ISOLATION_SHA256': '0' * 64})
assert (ROOT / 'backend/pandas_runner/native_isolation.py').read_bytes() == (ROOT / 'backend/pi_runner/native_isolation.py').read_bytes()
print(json.dumps({'status': 'passed', 'scope': 'binding-only-no-lifecycle', 'checks': checks}, indent=2))
