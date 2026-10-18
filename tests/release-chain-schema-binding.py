"""Read-only binding check; the retained fresh PG rehearsal supplies DB proof."""
import json
from pathlib import Path
import pi_workspace_addition as gate

root = Path(__file__).resolve().parents[1]
recipe = gate.common.read(root / 'config/main-schema-releases/ai-0085.json')
proof = gate.common.read(root / recipe['validation'], recipe['validationSha256'])
assert proof['version'] == 'pi-workspace-private-postgres-v1'
assert proof['status'] == 'passed' and proof['productionTouched'] is False
assert proof['codeSha256'] == recipe['codeSha256'] == gate.code_digest(root)
assert proof['steps'] == list(gate.STEPS) and set(proof['checks']) == gate.CHECKS
assert proof['generations'] == [150, 151] and proof['parentVariants'] == [[150, 151]]
assert proof['fullBackupOrRestorePerformed'] is False
for member in ('tools/manual-maintenance-process.psm1', 'tools/manual-maintenance-preflight.ps1', 'tools/frozen-main-source.mjs'):
    assert member in gate.CODE_FILES and (root / member).is_file()
print(json.dumps({'status': 'bound', 'newPostgresExecution': False, 'codeSha256': proof['codeSha256'], 'validation': recipe['validation']}))
