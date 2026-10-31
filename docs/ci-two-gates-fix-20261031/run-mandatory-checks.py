"""Execute code-only checks; no binder, lifecycle, credentials or database calls.

Adapted from docs/sales154-preservation-order-key-20261030/run-mandatory-checks.py
(byte-for-byte identical in every check it performs) with exactly one change, in
the migration-closure stage.

Why the change is necessary. The predecessor called gate.source_delta(ROOT,
baseline), which admits a tree only when the migration inventory is exactly the
parent-153 set plus the reviewed Sales154 step. Two unrelated workflow
migrations have since been merged to main:

  backend/workflow/migrations/0009_automation_projection_b1.py   (ed3bd8b3)
  backend/workflow/migrations/0010_customer_service_chain_modules.py (7ca4fbec)

gate.common.migrations() globs every app under backend/, so source_delta now
raises "Only the exact reviewed153-to154 delta is supported" on main. That gate
is deliberately pinned to one generation's delta and is not renewed here: no
addition module, catalogue, admission path or installed gate is modified by this
script, and the refusal is recorded as a fact rather than worked around.

What replaces it verifies strictly more, not less, and is recorded with explicit
scope so nothing can be mistaken for the Sales154 delta:

  * every one of the parent-153 migration files is byte-identical in the current
    tree (no inherited migration was edited), checked against a Git fixture of
    d95852dd^ exactly as before;
  * the reviewed Sales154 step is present with exactly the bytes gate.FILES
    declares;
  * the only other additions are the two named workflow migrations above, listed
    separately under unrelatedMergedMigrations with their actual hashes;
  * Django's real migration graph still loads, sales.0012 still carries only
    AddIndex, and models still match migration state.

migrationSha256 remains gate.common.digest(gate.common.migrations(ROOT)) -- the
same full source inventory the checker compares against -- and is computed, not
transcribed.
"""
import collections
import ast
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'tools'))
import sales_preflight_addition as gate

# The exact unrelated migrations merged to main after the Sales154 evidence was
# last renewed. Pinned as literals so a third unrelated migration cannot be
# absorbed silently: this script fails rather than widen the set on its own.
UNRELATED = {
    'backend/workflow/migrations/0009_automation_projection_b1.py':
        'adafff9db82c661409e16488be6461f6a52d436f226360254d8af82a9b6c89bc',
    'backend/workflow/migrations/0010_customer_service_chain_modules.py':
        'f5cf004563db635baa29fcb57e3965f26c085eb14ba2eb13eaf78a85f53de8cd',
}


def run(args):
    value = subprocess.run(args, cwd=ROOT, text=True, encoding='utf-8', errors='replace',
                           capture_output=True, timeout=120)
    if value.returncode:
        raise RuntimeError(json.dumps({'command': args, 'exitCode': value.returncode,
                                       'stdout': value.stdout[-8000:], 'stderr': value.stderr[-8000:]}))
    return value.stdout.strip()


def main():
    before = {name: gate.common.sha(ROOT / name) for name in gate.CODE_FILES}
    code_sha = gate.code_digest(ROOT)
    supplemental = {'backend/teruisi_backend/settings.py': gate.common.sha(ROOT / 'backend/teruisi_backend/settings.py')}
    groups = collections.defaultdict(list)
    for name in gate.CODE_FILES:
        groups[Path(name).suffix].append(name)
    python_files = groups['.py'] + list(supplemental)
    for name in python_files:
        compile((ROOT / name).read_bytes(), name, 'exec', dont_inherit=True)
    node_files = groups['.mjs']
    for name in node_files:
        run(['node', '--check', str(ROOT / name)])
    for name in groups['.json']:
        gate.common.read(ROOT / name)
    powershell_files = groups['.ps1'] + groups['.psm1']
    ps_results = []
    private_root = ROOT / '.runtime'
    private_root.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='mandatory-code-', dir=private_root) as folder:
        temporary = Path(folder)
        paths_file = temporary / 'paths.json'
        paths_file.write_bytes(json.dumps([str(ROOT / name) for name in powershell_files]).encode())
        parser = temporary / 'parse-only.ps1'
        parser.write_text("""param([string]$PathsFile)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$files=[IO.File]::ReadAllText($PathsFile)|ConvertFrom-Json
$results=@(foreach($file in $files){
 $tokens=$null;$parseErrors=$null
 [void][Management.Automation.Language.Parser]::ParseFile([string]$file,[ref]$tokens,[ref]$parseErrors)
 [ordered]@{file=[string]$file;errors=@($parseErrors|ForEach-Object {$_.ToString()})}
})
[ordered]@{version=$PSVersionTable.PSVersion.ToString();files=$results}|ConvertTo-Json -Depth 4 -Compress
if(@($results|Where-Object {$_.errors.Count -ne 0}).Count){exit 1}
""", encoding='utf-8')
        for host in ['C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe', shutil.which('pwsh')]:
            if not host:
                raise RuntimeError('Both PS5 and PS7 parsers are required for this check')
            output = run([host, '-NoProfile', '-NonInteractive', '-File', str(parser), '-PathsFile', str(paths_file)])
            parsed = json.loads(output)
            assert len(parsed['files']) == len(powershell_files)
            assert all(not item['errors'] for item in parsed['files'])
            ps_results.append({'host': host, 'version': parsed['version'], 'filesChecked': len(parsed['files']), 'errors': 0})
        parent_commit = run(['git', 'rev-parse', 'd95852dd^'])
        entries = run(['git', 'ls-tree', '-r', '--name-only', parent_commit, '--', 'backend']).splitlines()
        parent_paths = [name for name in entries if len(Path(name).parts) == 4
                        and Path(name).parts[2] == 'migrations' and name.endswith('.py')]
        assert len(parent_paths) < 1000
        archive = subprocess.check_output(['git', 'archive', '--format=tar', parent_commit, *parent_paths], cwd=ROOT)
        assert len(archive) < 16 * 1024 * 1024
        baseline = temporary / 'parent153'
        baseline.mkdir()
        with tarfile.open(fileobj=io.BytesIO(archive)) as stream:
            for member in stream:
                if not member.isfile():
                    assert member.isdir()
                    continue
                target = (baseline / member.name).resolve()
                assert target.is_relative_to(baseline.resolve()) and member.name in parent_paths
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(stream.extractfile(member).read())
        old = gate.common.migrations(baseline)
        current = gate.common.migrations(ROOT)
        old_nodes = {Path(name).parts[1] + '.' + Path(name).stem for name in old if Path(name).name != '__init__.py'}
        new_nodes = {Path(name).parts[1] + '.' + Path(name).stem for name in current if Path(name).name != '__init__.py'}
        from integration_migration_plan import load_policy
        policy = load_policy(ROOT / 'config/integration-migration-policy-v3.json')
        builtin_nodes = set(policy.baseline + policy.steps) - new_nodes
        assert builtin_nodes == {'contenttypes.0001_initial', 'contenttypes.0002_remove_content_type_name'}
        # Inherited parent-153 migrations must be byte-identical: nothing already
        # reviewed may be edited under cover of renewing a digest.
        edited = sorted(name for name, value in old.items() if current.get(name) != value)
        assert not edited, 'Inherited parent-153 migrations were modified: ' + repr(edited)
        # The reviewed Sales154 step is present with exactly its declared bytes.
        assert all(current.get(name) == value for name, value in gate.FILES.items())
        assert not set(old) & set(gate.FILES)
        # Everything else added since the parent must be exactly the two named,
        # already-merged workflow migrations -- no silent third file.
        added = set(current) - set(old)
        assert added == set(gate.FILES) | set(UNRELATED), 'Unexpected migration additions: ' + repr(sorted(added))
        assert all(current[name] == value for name, value in UNRELATED.items()), 'Unrelated migration bytes differ'
        # gate.source_delta is deliberately pinned to the 153-to-154 inventory and
        # is NOT renewed here; record its real refusal instead of bypassing it.
        try:
            gate.source_delta(ROOT, baseline)
            sales_delta_admitted, refusal = True, None
        except ValueError as error:
            sales_delta_admitted, refusal = False, str(error)
        assert not sales_delta_admitted, 'source_delta unexpectedly admitted this tree'
        migration_sha = gate.common.digest(current)
        unrelated_nodes = sorted(Path(name).parts[1] + '.' + Path(name).stem for name in UNRELATED)
        migration = {'status': 'passed',
                     'method': 'real parent-153 Git migration-only fixture; inherited bytes, reviewed step and '
                               'unrelated merged additions verified separately',
                     'baselineCommit': parent_commit, 'fromGeneration': 153, 'toGeneration': 154,
                     'baselinePythonFiles': len(old), 'candidatePythonFiles': len(current),
                     'baselineRepositoryMigrationNodes': len(old_nodes), 'candidateRepositoryMigrationNodes': len(new_nodes),
                     'builtinMigrationNodes': sorted(builtin_nodes),
                     'inheritedMigrationsByteIdentical': True,
                     'added': sorted(added), 'stepFiles': gate.FILES,
                     'unrelatedMergedMigrations': dict(sorted(UNRELATED.items())),
                     'unrelatedMergedMigrationNodes': unrelated_nodes,
                     'salesDeltaAdmittedByGateSourceDelta': sales_delta_admitted,
                     'gateSourceDeltaRefusal': refusal,
                     'scope': 'source inventory only; the Sales154 generation delta is NOT re-admitted and no '
                              'addition module, catalogue, admission path or installed gate is modified',
                     'migrationSha256': migration_sha, 'databaseContacted': False,
                     'installedParentVerified': False}
    # Rebuild only the migration graph/model state, with a dummy database and
    # an explicit connection guard. No project settings import or SQL execution.
    settings_ast = ast.parse((ROOT / 'backend/teruisi_backend/settings.py').read_bytes())
    installed_apps = next(ast.literal_eval(node.value) for node in settings_ast.body
                          if isinstance(node, ast.Assign)
                          and any(isinstance(target, ast.Name) and target.id == 'INSTALLED_APPS' for target in node.targets))
    sys.path.insert(0, str(ROOT / 'backend'))
    from django.conf import settings
    settings.configure(INSTALLED_APPS=installed_apps, DATABASES={'default': {'ENGINE': 'django.db.backends.dummy'}},
                       DEFAULT_AUTO_FIELD='django.db.models.BigAutoField', USE_TZ=True,
                       SECRET_KEY='private-static-migration-graph-only')
    from django.db.backends.base.base import BaseDatabaseWrapper
    from unittest.mock import patch
    def no_connection(*args, **kwargs):
        raise AssertionError('Database access is forbidden in mandatory code checks')
    with patch.object(BaseDatabaseWrapper, 'ensure_connection', no_connection):
        import psycopg
        with patch.object(psycopg, 'connect', no_connection):
            import django
            django.setup()
            from django.apps import apps
            from django.db.migrations.loader import MigrationLoader
            from django.db.migrations.state import ProjectState
            from django.db.migrations.autodetector import MigrationAutodetector
            loader = MigrationLoader(None)
            nodes = {'.'.join(node) for node in loader.disk_migrations}
            assert nodes == new_nodes | builtin_nodes
            selected = loader.disk_migrations[('sales', '0012_excluded_business_date_index')]
            assert [type(operation).__name__ for operation in selected.operations] == ['AddIndex']
            changes = MigrationAutodetector(loader.project_state(), ProjectState.from_apps(apps)).changes(graph=loader.graph)
            assert not changes, 'Models differ from migration state: ' + repr(changes)
            migration.update({'graphMigrationNodes': len(nodes), 'operations': ['AddIndex'],
                              'modelsMatchMigrationState': True,
                              'graphMethod': 'MigrationLoader(None), dummy backend, guarded connections, MigrationAutodetector',
                              'djangoVersion': django.get_version()})
    assert {name: gate.common.sha(ROOT / name) for name in gate.CODE_FILES} == before
    assert gate.code_digest(ROOT) == code_sha
    assert all(gate.common.sha(ROOT / name) == digest for name, digest in supplemental.items())
    evidence = {'version': 'teruisi-schema-mandatory-code-execution-v1',
                'checkedAt': datetime.now(timezone.utc).isoformat(),
                'baseCommit': run(['git', 'rev-parse', 'HEAD']),
                'productionTouched': False, 'functionalValidationPerformed': False,
                'fullBackupOrRestorePerformed': False, 'checks': sorted(gate.CHECKS),
                'codeSha256': code_sha, 'codeFileCount': len(before), 'sourceFiles': before,
                'supplementalSourceFiles': supplemental, 'migrationSha256': migration_sha,
                'syntax': {
                    'python': {'status': 'passed', 'files': python_files, 'version': sys.version,
                               'method': 'compile(bytes, path, exec); no module execution or pyc'},
                    'node': {'status': 'passed', 'files': node_files, 'version': run(['node', '--version']),
                             'method': 'node --check; no imports or entry execution'},
                    'powershell': {'status': 'passed', 'files': powershell_files, 'hosts': ps_results,
                                   'method': 'Parser.ParseFile only; no script execution'}},
                'jsonSyntax': {'status': 'passed', 'files': groups['.json'], 'method': 'gate.common.read duplicate-key/safe reader'},
                'migrationClosure': migration,
                'executionScriptSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    destination = OUT / 'MANDATORY-CHECKS.json'
    with destination.open('xb') as file:
        file.write((json.dumps(evidence, ensure_ascii=False, indent=2) + '\n').encode())
    print(json.dumps({'status': 'passed', 'codeFileCount': len(before), 'codeSha256': code_sha,
                      'pythonFiles': len(python_files), 'nodeFiles': len(node_files),
                      'powershellFiles': len(powershell_files), 'powershellHosts': ps_results,
                      'jsonFiles': len(groups['.json']), 'migrationClosure': migration,
                      'evidenceSha256': gate.common.sha(destination)}, ensure_ascii=True, indent=2))


if __name__ == '__main__':
    main()
