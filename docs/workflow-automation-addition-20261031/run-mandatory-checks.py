"""Execute code-only checks; no binder, lifecycle, credentials or database calls.

Adapted from docs/ci-two-gates-fix-20261031/run-mandatory-checks.py. Two
changes, both in the migration-closure stage, and one addition in the output
stage.

Why migration closure changes. The predecessor ran against the Sales154 gate
alone and recorded the two merged workflow migrations under
`unrelatedMergedMigrations`, asserting that gate.source_delta REFUSED the tree.
This generation adopts exactly those two migrations, so the same facts now have
two different meanings depending on which gate is asking:

  * For the WorkflowAutomation gate they are its own declared stepFiles, and
    source_delta against a real 154-era Git fixture must PASS.
  * For the Sales154 gate they are still outside its pinned 153-to-154
    inventory, so its source_delta still REFUSES this tree. That gate is not
    renewed or relaxed here; its refusal is recorded as a fact, exactly as
    before.

There is therefore no `UNRELATED` set any more: every migration added since the
154 baseline must be one of this generation's two steps. A third unrelated
migration makes this script fail rather than be absorbed silently.

Why two evidence files. check_schema_code_digest.py requires each recipe's
evidence `sourceFiles` to equal that recipe's own gate CODE_FILES map. The
Sales154 gate has 86 members and this generation's has 96, so one file cannot
satisfy both. Both are written from this single run, so they share one
baseCommit, one migration inventory and one set of syntax results.
"""
import ast
import collections
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
import sales_preflight_addition as sales_gate
import workflow_automation_addition as gate

# The commit that introduced this generation's first step. Its parent is the
# exact 154-era tree, i.e. what plan's copytree of the installed app produces.
BASELINE_REF = 'ed3bd8b3^'


def run(args):
    value = subprocess.run(args, cwd=ROOT, text=True, encoding='utf-8', errors='replace',
                           capture_output=True, timeout=120)
    if value.returncode:
        raise RuntimeError(json.dumps({'command': args, 'exitCode': value.returncode,
                                       'stdout': value.stdout[-8000:], 'stderr': value.stderr[-8000:]}))
    return value.stdout.strip()


def main():
    before = {name: gate.common.sha(ROOT / name) for name in gate.CODE_FILES}
    sales_before = {name: gate.common.sha(ROOT / name) for name in sales_gate.CODE_FILES}
    code_sha = gate.code_digest(ROOT)
    sales_code_sha = sales_gate.code_digest(ROOT)
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
        baseline_commit = run(['git', 'rev-parse', BASELINE_REF])
        entries = run(['git', 'ls-tree', '-r', '--name-only', baseline_commit, '--', 'backend']).splitlines()
        baseline_paths = [name for name in entries if len(Path(name).parts) == 4
                          and Path(name).parts[2] == 'migrations' and name.endswith('.py')]
        assert len(baseline_paths) < 1000
        archive = subprocess.check_output(['git', 'archive', '--format=tar', baseline_commit, *baseline_paths], cwd=ROOT)
        assert len(archive) < 16 * 1024 * 1024
        baseline = temporary / 'parent154'
        baseline.mkdir()
        with tarfile.open(fileobj=io.BytesIO(archive)) as stream:
            for member in stream:
                if not member.isfile():
                    assert member.isdir()
                    continue
                target = (baseline / member.name).resolve()
                assert target.is_relative_to(baseline.resolve()) and member.name in baseline_paths
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
        # The Git fixture must really be the 154 generation: every inherited
        # migration byte-identical, and this generation's two steps absent.
        edited = sorted(name for name, value in old.items() if current.get(name) != value)
        assert not edited, 'Inherited parent-154 migrations were modified: ' + repr(edited)
        assert not set(old) & set(gate.FILES)
        assert all(current.get(name) == value for name, value in gate.FILES.items())
        added = set(current) - set(old)
        assert added == set(gate.FILES), 'Unexpected migration additions: ' + repr(sorted(added))
        # This generation's own delta must be admitted against that fixture.
        workflow_delta = gate.source_delta(ROOT, baseline)
        # The Sales154 gate stays pinned to its own 153-to-154 inventory and is
        # NOT renewed here; record its real refusal instead of bypassing it.
        try:
            sales_gate.source_delta(ROOT, baseline)
            sales_delta_admitted, refusal = True, None
        except ValueError as error:
            sales_delta_admitted, refusal = False, str(error)
        assert not sales_delta_admitted, 'Sales154 source_delta unexpectedly admitted this tree'
        migration_sha = gate.common.digest(current)
        assert workflow_delta == migration_sha, 'source_delta digest differs from the source inventory'
        step_nodes = sorted(Path(name).parts[1] + '.' + Path(name).stem for name in gate.FILES)
        assert step_nodes == sorted(gate.STEPS)
        migration = {'status': 'passed',
                     'method': 'real parent-154 Git migration-only fixture; inherited bytes byte-identical, this '
                               'generation two steps admitted by its own source_delta, Sales154 refusal recorded',
                     'baselineRef': BASELINE_REF, 'baselineCommit': baseline_commit,
                     'fromGeneration': 154, 'toGeneration': 156,
                     'baselinePythonFiles': len(old), 'candidatePythonFiles': len(current),
                     'baselineRepositoryMigrationNodes': len(old_nodes), 'candidateRepositoryMigrationNodes': len(new_nodes),
                     'builtinMigrationNodes': sorted(builtin_nodes),
                     'inheritedMigrationsByteIdentical': True,
                     'added': sorted(added), 'stepFiles': gate.FILES, 'stepNodes': step_nodes,
                     'unrelatedMergedMigrations': {},
                     'workflowDeltaAdmittedByGateSourceDelta': True,
                     'workflowDeltaSha256': workflow_delta,
                     'salesDeltaAdmittedByGateSourceDelta': sales_delta_admitted,
                     'salesGateSourceDeltaRefusal': refusal,
                     'scope': 'source inventory only; the Sales154 generation delta is NOT re-admitted and no '
                              'ancestor addition module, catalogue, admission path or installed gate is modified',
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
            operations = {}
            for step in gate.STEPS:
                selected = loader.disk_migrations[tuple(step.split('.', 1))]
                operations[step] = [type(operation).__name__ for operation in selected.operations]
            assert operations[gate.STEPS[0]] == ['CreateModel'] * 4, operations
            assert operations[gate.STEPS[1]] == ['RunPython'], operations
            # 0010's RunPython is reversible, so an interrupted install's
            # rollback is a defined operation rather than an unknown.
            assert loader.disk_migrations[tuple(gate.STEPS[1].split('.', 1))].operations[0].reversible
            # The declared registry rows must be exactly what the catalogue reads.
            sys.path.insert(0, str(ROOT / 'backend'))
            import workflow_automation_catalog as catalog
            registry = catalog.registry_rows()
            assert sorted(registry) == ['jd_customer_service.chat_log',
                                        'jd_customer_service.paired_daily_import',
                                        'jd_customer_service.session_excel'], sorted(registry)
            catalog.verify_defaults(loader.project_state(loader.graph.leaf_nodes()).apps)
            changes = MigrationAutodetector(loader.project_state(), ProjectState.from_apps(apps)).changes(graph=loader.graph)
            assert not changes, 'Models differ from migration state: ' + repr(changes)
            migration.update({'graphMigrationNodes': len(nodes), 'operations': operations,
                              'modelsMatchMigrationState': True,
                              'registryModules': sorted(registry),
                              'migrationStateDefaultsVerified': True,
                              'graphMethod': 'MigrationLoader(None), dummy backend, guarded connections, MigrationAutodetector',
                              'djangoVersion': django.get_version()})
    assert {name: gate.common.sha(ROOT / name) for name in gate.CODE_FILES} == before
    assert {name: gate.common.sha(ROOT / name) for name in sales_gate.CODE_FILES} == sales_before
    assert gate.code_digest(ROOT) == code_sha and sales_gate.code_digest(ROOT) == sales_code_sha
    assert all(gate.common.sha(ROOT / name) == digest for name, digest in supplemental.items())
    shared = {'version': 'teruisi-schema-mandatory-code-execution-v1',
              'checkedAt': datetime.now(timezone.utc).isoformat(),
              'baseCommit': run(['git', 'rev-parse', 'HEAD']),
              'productionTouched': False, 'functionalValidationPerformed': False,
              'fullBackupOrRestorePerformed': False, 'checks': sorted(gate.CHECKS),
              'supplementalSourceFiles': supplemental, 'migrationSha256': migration['migrationSha256'],
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
    written = {}
    for filename, kind, files, digest in (
            ('MANDATORY-CHECKS.json', 'WorkflowAutomation', before, code_sha),
            ('MANDATORY-CHECKS-SALES154.json', 'SalesPreflightIndex', sales_before, sales_code_sha)):
        evidence = {**shared, 'additionKind': kind, 'codeSha256': digest,
                    'codeFileCount': len(files), 'sourceFiles': files}
        # The two differ only in which gate's CODE_FILES map they bind; every
        # executed check above is shared, so neither can claim an unrun check.
        evidence['sourceFilesScope'] = ('exactly tools/' + ('workflow_automation' if kind == 'WorkflowAutomation'
                                        else 'sales_preflight') + '_addition.CODE_FILES for this run')
        destination = OUT / filename
        with destination.open('xb') as file:
            file.write((json.dumps(evidence, ensure_ascii=False, indent=2) + '\n').encode())
        written[filename] = {'additionKind': kind, 'codeFileCount': len(files), 'codeSha256': digest,
                            'evidenceSha256': gate.common.sha(destination)}
    print(json.dumps({'status': 'passed', 'written': written,
                      'pythonFiles': len(python_files), 'nodeFiles': len(node_files),
                      'powershellFiles': len(powershell_files), 'powershellHosts': ps_results,
                      'jsonFiles': len(groups['.json']), 'migrationClosure': migration},
                     ensure_ascii=True, indent=2))


if __name__ == '__main__':
    main()
