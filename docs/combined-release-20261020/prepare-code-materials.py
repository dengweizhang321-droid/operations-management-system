"""Refresh exact code-only Pi152 materials after a publishing-tool change.

No database connection, application import, migration, or functional execution.
Old Pi proof files remain unchanged; the recipe points to this task's proof.
"""
from pathlib import Path
import ast
import base64
from datetime import datetime, timezone
import hashlib
import json
import os
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
OUT = Path('D:/codex-artifacts/combined-release-20261020/compatibility-code-materials')
OUT.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(ROOT / 'tools'))
os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
import pi_business_addition as gate

sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
write = lambda p, v: p.write_text(json.dumps(v, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
files = sorted(set(gate.CODE_FILES) | {
    'tools/django-workflow-service.ps1', 'tools/manual-maintenance-lock.psm1',
    'tools/manual-maintenance-start.ps1', 'tools/publish-main-progress.mjs',
    'tools/publish-prepared-main.mjs', 'tools/frozen-main-source.mjs',
    'tools/verify-release-candidate.mjs',
})
records = []
for name in files:
    file = ROOT / name
    if file.suffix == '.py':
        ast.parse(file.read_text(encoding='utf-8-sig'), filename=name)
    elif file.suffix in {'.mjs', '.js'}:
        run = subprocess.run(['node', '--check', str(file)], cwd=ROOT, capture_output=True, timeout=60)
        (OUT / (file.name + '.stdout.log')).write_bytes(run.stdout)
        (OUT / (file.name + '.stderr.log')).write_bytes(run.stderr)
        if run.returncode:
            raise RuntimeError('Node syntax rejected ' + name)
    records.append({'path': name, 'sha256': sha(file)})

ps_files = [str(ROOT / f) for f in files if Path(f).suffix in {'.ps1', '.psm1'}]
environment = {**os.environ, 'TERUISI_SYNTAX_FILES': json.dumps(ps_files)}
command = "$ErrorActionPreference='Stop';$files=$env:TERUISI_SYNTAX_FILES|ConvertFrom-Json;foreach($f in $files){$e=$null;$a=[Management.Automation.Language.Parser]::ParseFile($f,[ref]$null,[ref]$e);if($e.Count){throw ('Parse failed: '+$f)}};@{parsed=@($files).Count;version=$PSVersionTable.PSVersion.ToString()}|ConvertTo-Json -Compress"
encoded = base64.b64encode(command.encode('utf-16le')).decode('ascii')
shells = []
for label, host in [('ps5', 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'), ('ps7', 'D:/codex-isolated/main-manual-release-20261016/control-host/pwsh.exe')]:
    run = subprocess.run([host, '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], cwd=ROOT, env=environment, capture_output=True, timeout=120)
    (OUT / (label + '.stdout.log')).write_bytes(run.stdout)
    (OUT / (label + '.stderr.log')).write_bytes(run.stderr)
    if run.returncode:
        raise RuntimeError('PowerShell syntax rejected ' + label)
    shells.append({'host': host, 'sha256': sha(Path(host)), 'result': json.loads(run.stdout.decode('utf-8-sig')), 'stdoutSha256': hashlib.sha256(run.stdout).hexdigest()})

task = ROOT / 'docs/combined-release-20261020'
syntax_file = task / 'syntax-code-materials.json'
write(syntax_file, {'version': 'release-contention-code-syntax-v1', 'at': datetime.now(timezone.utc).isoformat(), 'functionalValidationPerformed': False, 'productionTouched': False, 'files': records, 'powershell': shells})
old_file = ROOT / 'docs/release-contention-20261020/mandatory-code-checks.json'
old = json.loads(old_file.read_text(encoding='utf-8-sig'))
delta = gate.source_delta(ROOT, Path('D:/teruisi-runtime/django-sales/app'))
if delta != old['migrationSha256']:
    raise RuntimeError('Migration closure changed; this refresh cannot approve new migrations')
proof_file = task / 'mandatory-code-checks.json'
proof = {**old, 'at': datetime.now(timezone.utc).isoformat(), 'codeSha256': gate.code_digest(ROOT),
         'syntaxEvidence': syntax_file.relative_to(ROOT).as_posix(), 'syntaxEvidenceSha256': sha(syntax_file),
         'previousProofSha256': sha(old_file), 'scope': 'Current exact code syntax and unchanged 151-to152 migration closure only. No business, database, or functional execution.',
         'rawByteNormalization': 'LF worktree bytes used for this task proof; old proof preserved.'}
write(proof_file, proof)
recipe_file = ROOT / 'config/main-schema-releases/ai-0086.json'
recipe = json.loads(recipe_file.read_text(encoding='utf-8-sig'))
recipe.update(validation=proof_file.relative_to(ROOT).as_posix(), validationSha256=sha(proof_file), codeSha256=proof['codeSha256'])
write(recipe_file, recipe)
print(json.dumps({'status': 'code-checked', 'files': len(files), 'powershellFiles': len(ps_files), 'migrationClosureUnchanged': True, 'codeSha256': proof['codeSha256']}))
