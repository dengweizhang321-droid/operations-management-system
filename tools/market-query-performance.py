"""Bounded synthetic PostgreSQL experiment; never connects to production.

Uses the existing schema/indexes. Run from a Git worktree with the installed
Python executable; only PostgreSQL binaries are shared with production.
"""
from __future__ import annotations

import argparse
import ctypes
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
BIN = Path(r"D:\teruisi-runtime\django-sales\postgresql-17.11\bin")
PORT = 55485
DATABASE = "market_performance_isolated"
FIELDS = (("categories", "category"), ("scopes", "scope"), ("brands", "brand"),
          ("rankingDimensions", "ranking_dimension"), ("operationModes", "operation_mode"),
          ("subcategories", "subcategory"))


def percentile(values, p):
    """Nearest rank; retain raw samples so small-tail estimates are explicit."""
    return sorted(values)[max(0, math.ceil(len(values) * p) - 1)]


def machine_load():
    class Memory(ctypes.Structure):
        _fields_ = [('length', ctypes.c_ulong), ('load', ctypes.c_ulong)] + [
            (name, ctypes.c_ulonglong) for name in ('total', 'available', 'pageTotal',
                'pageAvailable', 'virtualTotal', 'virtualAvailable', 'extended')]
    memory = Memory()
    memory.length = ctypes.sizeof(memory)
    if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(memory)):
        raise RuntimeError('Memory observation unavailable')
    idle, kernel, user = (ctypes.c_ulonglong() for _ in range(3))
    if not ctypes.windll.kernel32.GetSystemTimes(ctypes.byref(idle), ctypes.byref(kernel), ctypes.byref(user)):
        raise RuntimeError('CPU observation unavailable')
    return {'time': time.time(), 'availableBytes': memory.available,
            'memoryLoadPercent': memory.load, 'idle': idle.value, 'total': kernel.value+user.value}


def wait_for_capacity():
    # This is a small single-client experiment, not a stress test. Avoid known
    # contention, fail after a bounded wait, and record load during every case.
    deadline = time.monotonic() + 60
    while True:
        first = machine_load()
        time.sleep(.5)
        second = machine_load()
        total = second['total']-first['total']
        cpu = 100*(1-(second['idle']-first['idle'])/total) if total else 100
        if cpu < 50 and second['availableBytes'] >= 2.5*1024**3:
            return
        print(json.dumps({'stage': 'capacity_wait', 'cpuPercent': round(cpu, 1),
            'availableGiB': round(second['availableBytes']/1024**3, 2)}), flush=True)
        if time.monotonic() >= deadline:
            raise RuntimeError('Measurement deferred: capacity remained constrained for 60 seconds')
        time.sleep(5)


def experiment(args, output):
    import django
    django.setup()
    from django.db import connection, transaction
    from django.db.models import Count, F
    from market import query, filter_cache
    from market.models import MarketRankingEntry, MarketDataRevision
    from market.views import _consistent_read
    from sales.auth import Principal

    with connection.cursor() as cursor:
        cursor.execute("SELECT inet_server_port(),current_database()")
        assert cursor.fetchone() == (PORT, DATABASE)
    # Wholly synthetic, deliberately wide fact rows, repeated products/dates,
    # low-cardinality facets and uneven empty/nonempty values.
    seed = MarketRankingEntry.objects.create(natural_key="seed", source_row_number=1,
        period_start="2026-06-01", period_end="2026-06-01", sku_code="seed",
        category="synthetic", last_import_batch_id="synthetic-only", quantity=10,
        raw_json={"padding": "0123456789abcdef" * 90})
    quote = connection.ops.quote_name
    columns = [f.column for f in MarketRankingEntry._meta.concrete_fields if f.column != "id"]
    day = "to_char(date '2026-06-01'+((g-1)/700)::integer,'YYYY-MM-DD')"
    overrides = {"natural_key": "'synthetic-'||g", "sku_code": "'sku-'||((g-1)%700)",
        "period_start": day, "period_end": day, "category": "'category-'||((g-1)%7)",
        "scope": "CASE WHEN g%9=0 THEN 'other' ELSE 'all' END",
        "brand": "CASE WHEN g%8=0 THEN '' ELSE 'brand-'||(g%17) END",
        "operation_mode": "CASE WHEN g%5=0 THEN '' ELSE 'POP' END",
        "subcategory": "'segment-'||(g%30)", "rank": "1+(g%100)",
        "gmv_cents": "10000+g%1000", "image_url": "'https://example.invalid/'||(g%2000)"}
    with connection.cursor() as cursor:
        cursor.execute('INSERT INTO market_ranking_entries (' + ','.join(map(quote, columns)) +
            ') SELECT ' + ','.join(overrides.get(c, 's.'+quote(c)).replace('%', '%%') for c in columns) +
            ' FROM market_ranking_entries s CROSS JOIN generate_series(1,%s) g WHERE s.id=%s', [args.rows, seed.id])
    seed.delete()
    changed_row = MarketRankingEntry.objects.order_by('-pk').values('pk', 'brand').first()
    with connection.cursor() as cursor:
        cursor.execute("VACUUM (ANALYZE) market_ranking_entries")
        cursor.execute("SELECT pg_relation_size('market_ranking_entries'),pg_indexes_size('market_ranking_entries')")
        sizes = cursor.fetchone()
        cursor.execute("SET statement_timeout='7s'")
        cursor.execute("SET max_parallel_workers_per_gather=0")
    plans = {}
    for _, field in FIELDS:
        for expression in ("pk", "*"):
            qs = MarketRankingEntry.objects.exclude(**{field: ""}).order_by().values(field).annotate(count=Count(expression)).order_by("-count", field)
            plans[field+':'+expression] = json.loads(qs.explain(analyze=True, buffers=True, format="json"))
    image_query = MarketRankingEntry.objects.exclude(image_url='').order_by().values('image_url').distinct()
    plans['imageDistinct'] = json.loads(image_query.explain(analyze=True, buffers=True, format='json'))
    (output / "plans.json").write_text(json.dumps(plans, indent=2), encoding="utf-8")
    report = {"schema": "market-performance-v1", "rows": args.rows, "heapBytes": sizes[0],
        "indexBytes": sizes[1], "port": PORT, "productionTouched": False,
        "concurrency": 1, "samplesPerCase": args.samples, "percentile": "nearest-rank",
        "coldDefinition": "application cache cleared; OS and PostgreSQL buffers not flushed",
        "salesConsumer": "deterministic synthetic stub; excludes network/Worker/browser latency",
        "sourceSha256": hashlib.sha256((ROOT/'backend/market/query.py').read_bytes()).hexdigest(),
        "complete": False, "machine": {'logicalCpus': os.cpu_count(), 'initial': machine_load()}, "results": []}
    if args.plans_only:
        (output/'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
        return
    reference = Path(args.reference).resolve()
    if not reference.is_relative_to(ROOT / '.runtime'):
        raise RuntimeError('Reference must be inside this worktree .runtime')
    spec = importlib.util.spec_from_file_location('market.performance_reference', reference)
    baseline = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(baseline)
    report['referenceSha256'] = hashlib.sha256(reference.read_bytes()).hexdigest()
    principal = Principal('synthetic@example.invalid', 'Synthetic', 'analyst', None)
    def sales(_principal, request):
        return {'rows': [{'productCode': code, 'owned': False, 'ownSalesCents': 0}
                         for code in request['productCodes']]}, '1:synthetic'
    cases = [("filters", None, 1)]
    for name, start, end in (("day", "2026-07-15", "2026-07-15"),
            ("week", "2026-07-09", "2026-07-15"),
            ("month", "2026-07-01", "2026-07-30"),
            ("all", None, None), ("empty", "2030-01-01", "2030-01-01")):
        cases.append((name, {"startDate": start, "endDate": end}, 1))
    cases.append(("page2", None, 2))
    # Capture real SQL and parameters without executing it, then analyze the
    # same ranking query once. No SQL or user data is taken from production.
    from unittest.mock import patch
    from market.ranking_query import ranking_page
    class CapturedQuery(Exception):
        pass
    captured = {}
    def capture(sql, params):
        captured.update(sql=sql, params=params)
        raise CapturedQuery()
    try:
        with patch('market.ranking_query._read', side_effect=capture):
            ranking_page(query._queryset(query.validate_filters(None)), [], 1, 20)
    except CapturedQuery:
        pass
    with connection.cursor() as cursor:
        cursor.execute('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+captured['sql'], captured['params'])
        plans['rankingAll'] = cursor.fetchone()[0]
    (output/'plans.json').write_text(json.dumps(plans, indent=2), encoding='utf-8')
    digests = {}
    for name, filters, page in cases:
        for state in ('cold', 'hot', 'invalidated'):
            wait_for_capacity()
            load_start = machine_load()
            # Alternate before/after every sample to reduce temporal load bias.
            measurements = {'baseline': [], 'candidate': []}
            for sample in range(args.samples):
                for label, module in ((('baseline', baseline), ('candidate', query)) if sample%2 == 0 else
                                      (('candidate', query), ('baseline', baseline))):
                    # Restore the identical source before either implementation.
                    # All writes stay outside measured reads in this test DB.
                    with transaction.atomic():
                        restored = MarketRankingEntry.objects.filter(pk=changed_row['pk']).exclude(
                            brand=changed_row['brand']).update(brand=changed_row['brand'])
                        if restored:
                            MarketDataRevision.objects.filter(domain='market').update(revision=F('revision')+1)
                    filter_cache.cache = filter_cache.FilterCache()
                    def read():
                        return _consistent_read(module.filter_options if name == 'filters' else
                            lambda: module.overview(principal, {'operation': 'overview', 'view': 'ranking',
                                'page': page, 'pageSize': 20, 'filters': filters,
                                'includeFilterOptions': False}, sales_loader=sales))[0]
                    if state != 'cold':
                        read()
                    if state == 'invalidated':
                        with transaction.atomic():
                            MarketRankingEntry.objects.filter(pk=changed_row['pk']).update(brand='changed-fixture-brand')
                            MarketDataRevision.objects.filter(domain='market').update(revision=F('revision')+1)
                    started = time.perf_counter()
                    value = read()
                    elapsed = (time.perf_counter()-started)*1000
                    digest = hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
                    key = name+':'+state
                    if key in digests and digest != digests[key]:
                        raise AssertionError('Response mismatch: '+name)
                    digests[key] = digest
                    measurements[label].append(round(elapsed, 3))
                    time.sleep(0.025)
            for label, values in measurements.items():
                load_end = machine_load()
                total = load_end['total']-load_start['total']
                report['results'].append({'case': name, 'state': state, 'version': label,
                    'samplesMs': values, 'p50Ms': percentile(values, .5), 'p95Ms': percentile(values, .95),
                    'maxMs': max(values), 'responseSha256': digests[name+':'+state],
                    'load': {'start': load_start, 'end': load_end, 'cpuPercent':
                        round(100*(1-(load_end['idle']-load_start['idle'])/total), 2) if total else None}})
            (output/'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
            print(json.dumps({'case': name, 'state': state, 'p95': {k: percentile(v,.95) for k,v in measurements.items()}}), flush=True)
    report['complete'] = True
    (output/'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rows', type=int, default=42000)
    parser.add_argument('--samples', type=int, default=20)
    parser.add_argument('--plans-only', action='store_true')
    parser.add_argument('--reference')
    args = parser.parse_args()
    if not (ROOT/'.git').is_file() or ROOT == Path(r'D:\运营管理系统'):
        raise RuntimeError('Requires isolated Git worktree')
    if not 700 <= args.rows <= 84000 or not 20 <= args.samples <= 100:
        raise RuntimeError('Bounded experiment requires 700..84000 rows and 20..100 samples')
    if not args.plans_only and not args.reference:
        parser.error('--reference required for comparison')
    run_root = ROOT/'.runtime'/('market-performance-'+secrets.token_hex(6))
    run_root.mkdir(parents=True)
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', PORT))
    password = secrets.token_hex(32)
    pwfile = run_root/'password.txt'
    pwfile.write_text(password, encoding='ascii')
    env = {k:v for k,v in os.environ.items() if not k.upper().startswith(
        ('TERUISI_', 'DJANGO_', 'PG', 'OPENAI_', 'AI_', 'CLOUDFLARE_', 'ARK_', 'OLLAMA_'))}
    env.update(PGHOST='127.0.0.1', PGPORT=str(PORT), PGUSER='market_perf_admin',
        PGPASSWORD=password, PGDATABASE=DATABASE, PYTHONUTF8='1', PYTHONDONTWRITEBYTECODE='1',
        DJANGO_SETTINGS_MODULE='teruisi_backend.settings', TERUISI_DJANGO_ENVIRONMENT='test',
        TERUISI_DJANGO_PROCESS_ROLE='development', DJANGO_SECRET_KEY=secrets.token_hex(32),
        TERUISI_DJANGO_INTERNAL_SECRET=secrets.token_hex(32),
        TERUISI_DJANGO_DATABASE_URL=f'postgresql://market_perf_admin:{password}@127.0.0.1:{PORT}/{DATABASE}')
    def run(command, label):
        with (run_root/(label+'.log')).open('wb') as out:
            result = subprocess.run(list(map(str, command)), cwd=ROOT, env=env, stdout=out, stderr=out,
                timeout=180, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        if result.returncode:
            raise RuntimeError('Failed '+label+'; see '+str(run_root))
    started = False
    try:
        wait_for_capacity()
        run([BIN/'initdb.exe', '-D', run_root/'data', '-U', 'market_perf_admin', '--auth=scram-sha-256',
            '--encoding=UTF8', '--locale=C', '--pwfile', pwfile], 'init')
        with (run_root/'data/postgresql.conf').open('a') as f:
            f.write(f"\nlisten_addresses='127.0.0.1'\nport={PORT}\nmax_connections=12\nshared_buffers='32MB'\nwork_mem='4MB'\nmax_parallel_workers_per_gather=0\n")
        run([BIN/'pg_ctl.exe', '-D', run_root/'data', '-l', run_root/'postgres.log', '-w', 'start'], 'start')
        started = True
        run([BIN/'createdb.exe', DATABASE], 'createdb')
        run([sys.executable, ROOT/'backend/manage.py', 'migrate', 'market', '--noinput', '--verbosity', '0'], 'migrate')
        os.environ.clear()
        os.environ.update(env)
        sys.path.insert(0, str(ROOT/'backend'))
        print(json.dumps({'output': str(run_root), 'stage': 'experiment'}), flush=True)
        experiment(args, run_root)
    finally:
        try:
            if started:
                from django.conf import settings
                if settings.configured:
                    from django.db import connections
                    connections.close_all()
                run([BIN/'pg_ctl.exe', '-D', run_root/'data', '-m', 'fast', '-w', 'stop'], 'stop')
        finally:
            pwfile.unlink(missing_ok=True)
    print(json.dumps({'output': str(run_root), 'stopped': True}), flush=True)


if __name__ == '__main__':
    main()
