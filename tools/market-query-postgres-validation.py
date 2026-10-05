"""Reuse market's PostgreSQL suite with current protected-role prerequisites.

Only writes a bound test entry point in this worktree's .runtime. The original
cluster, migration, market reader/writer grants and negative probes are reused.
No production role or connection is read or modified.
"""
import ast
import hashlib
import json
from pathlib import Path
import secrets
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def main():
    if not (ROOT / '.git').is_file() or ROOT == Path(r'D:\运营管理系统'):
        raise RuntimeError('Requires isolated Git worktree')
    source = ROOT / 'tools/market-annotation-postgres-rehearsal.py'
    prerequisites = ROOT / 'tools/integration-migration-role-rehearsal.py'
    tree = ast.parse(prerequisites.read_text(encoding='utf-8-sig'))
    closed = next(ast.literal_eval(node.value) for node in tree.body if
        isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and
        t.id == 'CLOSED_ROLES' for t in node.targets))
    roles = ('teruisi_ai_reader', 'teruisi_ai_writer', 'teruisi_finance_reader',
             'teruisi_finance_writer', 'teruisi_netshop_reader', 'teruisi_netshop_writer',
             'teruisi_ai_seal_writer', *closed)
    text = source.read_text(encoding='utf-8-sig')
    for before, after in (
        ('PORT = 55447', 'PORT = 55485'),
        ('DATABASE = "market_annotation_rehearsal"', 'DATABASE = "market_performance_regression"'),
    ):
        if text.count(before) != 1:
            raise RuntimeError('Reused harness changed; review required')
        text = text.replace(before, after)
    marker = '        run([BIN / "createdb.exe", DATABASE])\n'
    if text.count(marker) != 1:
        raise RuntimeError('Reused cluster bootstrap changed; review required')
    bootstrap = '''        import psycopg
        from psycopg import sql
        with psycopg.connect(environment["TERUISI_DJANGO_DATABASE_URL"]) as bootstrap:
            identity = bootstrap.execute("SELECT inet_server_port(),current_database(),current_user").fetchone()
            if identity != (55485, "market_performance_regression", ADMIN):
                raise RuntimeError("Protected-role preparation escaped the test cluster")
            for name in PROTECTED_ROLES:
                bootstrap.execute(sql.SQL("CREATE ROLE {} NOLOGIN NOINHERIT NOSUPERUSER "
                    "NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD NULL").format(sql.Identifier(name)))
'''.replace('PROTECTED_ROLES', repr(roles))
    text = text.replace(marker, marker + bootstrap)
    runtime = ROOT / '.runtime'
    runtime.mkdir(exist_ok=True)
    token = secrets.token_hex(6)
    runner_name = 'market_query_runner_' + token
    settings_name = 'market_query_settings_' + token
    runner = '''from unittest import TestSuite
from django.test import TransactionTestCase, TestCase
from django.test.runner import DiscoverRunner

SCOPES = {
    'market.tests.test_analysis_options.MarketOptionsOwningTests': ['market', 'access_control'],
    'market.tests.test_annotation_queue.AnnotationQueueConcurrencyTests': ['market'],
    'market.tests.test_filter_count_performance.FacetRevisionRegressionTests': ['market'],
    'market.tests.test_complete_performance.ScalarCacheApplicationTests': ['market'],
    'market.tests.test_prompt_concurrency.PromptConcurrencyTests': ['market'],
}

class ScopedMarketRunner(DiscoverRunner):
    def build_suite(self, *args, **kwargs):
        suite = super().build_suite(*args, **kwargs)
        def walk(items):
            for item in items:
                if isinstance(item, TestSuite):
                    yield from walk(item)
                else:
                    yield item
        for case in walk(suite):
            if isinstance(case, TransactionTestCase) and not isinstance(case, TestCase):
                identity = type(case).__module__ + '.' + type(case).__name__
                if identity not in SCOPES:
                    raise RuntimeError('Review transaction fixture ownership: ' + identity)
                # Django's supported app-scoped teardown. Keep all migrations,
                # protected AI tables, FK constraints and triggers installed.
                # Market transaction tests must not flush unrelated AI tables.
                type(case).available_apps = SCOPES[identity]
        return suite
'''
    runner_path = runtime / (runner_name + '.py')
    runner_path.write_text(runner, encoding='utf-8')
    settings_path = runtime / (settings_name + '.py')
    settings_path.write_text('from teruisi_backend.settings import *\nTEST_RUNNER = ' +
        repr(runner_name + '.ScopedMarketRunner') + '\n', encoding='utf-8')
    marker = '    def run(command, *, env=None, timeout=300, label="step"):\n'
    if text.count(marker) != 1:
        raise RuntimeError('Reused environment setup changed; review required')
    text = text.replace(marker, '    environment["DJANGO_SETTINGS_MODULE"] = ' + repr(settings_name) +
        '\n    environment["PYTHONPATH"] = str(runtime) + os.pathsep + environment["PYTHONPATH"]\n\n' + marker)
    entry = runtime / ('market-validation-entry-' + token + '.py')
    with entry.open('x', encoding='utf-8') as stream:
        stream.write(text)
    binding = {
        'source': str(source.relative_to(ROOT)),
        'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
        'prerequisitesSource': str(prerequisites.relative_to(ROOT)),
        'prerequisitesSha256': hashlib.sha256(prerequisites.read_bytes()).hexdigest(),
        'entrySha256': hashlib.sha256(entry.read_bytes()).hexdigest(),
        'runnerSha256': hashlib.sha256(runner_path.read_bytes()).hexdigest(),
        'settingsSha256': hashlib.sha256(settings_path.read_bytes()).hexdigest(),
        'teardownScope': 'Only market-owned transaction fixtures; analysis-options also owns access_control fixtures',
        'migrationsConstraintsAndTriggersPreserved': True,
        'port': 55485, 'database': 'market_performance_regression',
        'preparedClosedRoles': list(roles), 'productionTouched': False,
    }
    (runtime / 'regression-harness-binding.json').write_text(json.dumps(binding, indent=2), encoding='utf-8')
    result = subprocess.run([sys.executable, '-B', str(entry), *sys.argv[1:]], cwd=ROOT)
    raise SystemExit(result.returncode)


if __name__ == '__main__':
    main()
