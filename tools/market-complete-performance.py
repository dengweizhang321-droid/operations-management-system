"""Paired PostgreSQL market read measurements. Synthetic data, private port only.

Reuses the reviewed cluster bootstrap; no production configuration or connection.
Baseline source bytes must be captured from the recorded SHA before running.
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import time
import subprocess

ROOT = Path(__file__).resolve().parents[1]
BASELINE = 'bab42d8ce836b4ee9acd82e80de085ff71f9f494'


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


harness = module('market_perf_bootstrap', ROOT / 'tools/market-query-performance.py')
harness.PORT = 55523
harness.DATABASE = 'market_complete_isolated'
PLAN_ONLY = '--capture-plans' in sys.argv
EXTRA_ONLY = '--extra-reads' in sys.argv
REMAINING_ONLY = '--remaining-reads' in sys.argv
UNDER_LOAD = '--loaded-machine' in sys.argv


def experiment(args, output):
    import django
    django.setup()
    from django.db import connection
    from django.db.models import Count
    from market import query, admin, filter_cache
    from market.models import MarketRankingEntry, MarketImageCache, MarketPriceSnapshot, MarketMasterIdentity
    from market.views import _consistent_read
    from market.annotations import execute_annotation_query
    from sales.auth import Principal
    with connection.cursor() as c:
        c.execute('SELECT inet_server_port(),current_database()')
        assert c.fetchone() == (harness.PORT, harness.DATABASE)
    baseline_dir = ROOT / '.runtime/market-performance-complete'
    before_query = module('market.complete_query_reference', baseline_dir / 'backend_market_query.py')
    before_admin = module('market.complete_admin_reference', baseline_dir / 'backend_market_admin.py')
    before_master = module('market.complete_master_reference', baseline_dir / 'backend_market_master_query.py')
    before_admin.item_trend = before_query.item_trend
    before_admin.master_page = before_master.master_page
    seed = MarketRankingEntry.objects.create(natural_key='seed', source_row_number=1,
        period_start='2026-01-01', period_end='2026-01-01', sku_code='seed',
        category='synthetic', last_import_batch_id='synthetic-only', quantity=10,
        raw_json={'padding': '0123456789abcdef' * 90})
    columns = [f.column for f in MarketRankingEntry._meta.concrete_fields if f.column != 'id']
    q = connection.ops.quote_name
    rows = 350000
    day = "to_char(date '2026-01-01'+((g-1)/1400)::integer,'YYYY-MM-DD')"
    overrides = {'natural_key': "'synthetic-'||g", 'sku_code': "'sku-'||((g-1)%1400)",
        'period_start': day, 'period_end': day, 'category': "'category-'||((g-1)%7)",
        'scope': "CASE WHEN g%9=0 THEN 'other' ELSE 'all' END",
        'brand': "CASE WHEN g%8=0 THEN '' ELSE 'brand-'||(g%17) END",
        'operation_mode': "CASE WHEN g%5=0 THEN '自营' ELSE 'POP' END",
        'subcategory': "'segment-'||(g%30)", 'rank': '1+(g%200)',
        'gmv_cents': '10000+g%1000', 'image_url': "'https://example.invalid/'||(g%70000)",
        'product_name': "'synthetic RO office product '||g"}
    with connection.cursor() as c:
        c.execute('INSERT INTO market_ranking_entries (' + ','.join(map(q, columns)) +
            ') SELECT ' + ','.join(overrides.get(col, 's.'+q(col)).replace('%', '%%') for col in columns) +
            ' FROM market_ranking_entries s CROSS JOIN generate_series(1,%s) g WHERE s.id=%s', [rows, seed.id])
    seed.delete()
    # Formal/invalid/missing snapshots; wide image metadata and multiple statuses.
    months = [f'2026-{n:02d}' for n in range(1, 10)]
    MarketPriceSnapshot.objects.bulk_create([MarketPriceSnapshot(id=f'price-{month}-{n}-{scope}',
        category=f'category-{n%7}', scope=scope, ranking_dimension='SKU', sku_code=f'sku-{n}', month=month,
        confirmed_market_price_cents=10000+n, confirmation_status='confirmed', ai_price_type='标准售价',
        image_content_sha256='a'*64 if n%3 else 'bad')
        for month in months for n in range(1400) for scope in ('all', 'other')], batch_size=1000)
    MarketImageCache.objects.bulk_create([MarketImageCache(source_url=f'https://example.invalid/{n}',
        status=('ready', 'failed', 'pending', 'unknown')[n%4]) for n in range(70000)], batch_size=1000)
    with connection.cursor() as c:
        c.execute('''INSERT INTO market_master_identities(category,scope,ranking_dimension,sku_code,latest_entry_id,updated_at)
            SELECT category,scope,ranking_dimension,sku_code,MAX(id),CURRENT_TIMESTAMP FROM market_ranking_entries
            GROUP BY category,scope,ranking_dimension,sku_code''')
        c.execute('VACUUM (ANALYZE) market_ranking_entries')
        c.execute('ANALYZE market_price_snapshots')
        c.execute('ANALYZE market_image_cache')
        c.execute("SET statement_timeout='7s'")
        c.execute('SET max_parallel_workers_per_gather=0')
        c.execute("SELECT pg_relation_size('market_ranking_entries'),pg_indexes_size('market_ranking_entries')")
        sizes = c.fetchone()
    principal = Principal('synthetic@example.invalid', 'Synthetic', 'admin', None)
    def sales(_principal, request):
        return {'rows': [{'productCode': code, 'owned': False, 'ownSalesCents': 0}
            for code in request['productCodes']]}, '1:synthetic'
    def overview(mod, view, filters, page=1):
        return mod.overview(principal, {'operation':'overview','view':view,'page':page,'pageSize':20,
            'includeFilterOptions':False,'filters':filters}, sales_loader=sales)
    identity = {'operation':'trend','skuCode':'sku-1','category':'category-1','scope':'all','rankingDimension':'SKU'}
    def compare(mod):
        return mod.comparison({'selections':[{key:value for key,value in identity.items() if key!='operation'},
            {'skuCode':'sku-2','category':'category-2','scope':'all','rankingDimension':'SKU'}]})
    cases = [
        ('filters', lambda m,a: m.filter_options()),
        ('ranking-7d', lambda m,a: overview(m,'ranking',{'startDate':'2026-08-01','endDate':'2026-08-07'})),
        ('ranking-all', lambda m,a: overview(m,'ranking',{})),
        ('ranking-page2', lambda m,a: overview(m,'ranking',{},2)),
        ('ranking-unconfirmed', lambda m,a: overview(m,'ranking',{'priceBands':['未确认价格']})),
        ('report-7d', lambda m,a: overview(m,'full',{'startDate':'2026-08-01','endDate':'2026-08-07'})),
        ('report-category', lambda m,a: overview(m,'full',{'categories':['category-1']})),
        ('trend', lambda m,a: m.item_trend(identity)),
        ('compare', lambda m,a: compare(a)),
        ('settings-status', lambda m,a: a.settings_status()),
        ('database-primary', lambda m,a: a.execute_master_query({'operation':'master','view':'database_primary','params':{}})),
        ('database-secondary', lambda m,a: a.execute_master_query({'operation':'master','view':'database_secondary','params':{}})),
    ] + [(f'workspace-{section}', lambda m,a,s=section: a.master_workspace({'section':s}))
        for section in ('subcategory','brand','mapping','data')]
    if EXTRA_ONLY:
        cases = [('system-kpis',lambda m,a:a.system_kpis()),
            ('annotation-candidates',lambda m,a:execute_annotation_query({'operation':'annotations','view':'candidate_counts','params':{}},principal)),
            ('annotation-workspace',lambda m,a:execute_annotation_query({'operation':'annotations','view':'workspace_fast','params':{}},principal)),
            ('annotation-review',lambda m,a:execute_annotation_query({'operation':'annotations','view':'review','params':{}},principal)),
            ('database-filters',lambda m,a:a.execute_master_query({'operation':'master','view':'database_filters','params':{}}))]
    if PLAN_ONLY:
        cases = [case for case in cases if case[0] in ('ranking-7d','ranking-all','report-7d','trend','settings-status','workspace-mapping','database-primary','database-secondary')]
    if REMAINING_ONLY:
        cases = [case for case in cases if case[0].startswith(('database-','workspace-'))]
    report = {'baselineSHA':'bab42d8ce836b4ee9acd82e80de085ff71f9f494',
        'rows':rows,'priceSnapshots':MarketPriceSnapshot.objects.count(),'imageRows':MarketImageCache.objects.count(),
        'masterIdentities':MarketMasterIdentity.objects.count(),'heapBytes':sizes[0],'indexBytes':sizes[1],
        'database':harness.DATABASE,'port':harness.PORT,'concurrency':1,'samplesPerVersion':1 if PLAN_ONLY else 10,
        'mode':'actual-plans' if PLAN_ONLY else 'extra-reads' if EXTRA_ONLY else 'remaining-reads' if REMAINING_ONLY else 'paired-reads',
        'loadedMachine':UNDER_LOAD,
        'toolSHA256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'sourceSha256':{str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest()
            for p in [ROOT/'backend/market/query.py',ROOT/'backend/market/admin.py',ROOT/'backend/market/master_query.py']},
        'conditions':'Filter cache cleared at case sample0; image scalar empty at first ranking then shared across scopes; shared OS/PG buffers; synthetic consumer excludes network',
        'productionTouched':False,'results':[],'complete':False}
    plans = {}
    # Capture actual statements outside measurements. Regular paired run uses
    # estimated plans; --capture-plans separately obtains ANALYZE/BUFFERS.
    for name, call in cases:
        if not (EXTRA_ONLY or REMAINING_ONLY or UNDER_LOAD):
            harness.wait_for_capacity()
        # The lightweight follow-up groups still require bootstrap capacity,
        # but record concurrent machine load instead of repeatedly deferring
        # the entire remaining inventory. Never call their tails idle P95.
        initial = harness.machine_load()
        values = {'baseline':[], 'candidate':[]}
        hashes = {'baseline':[], 'candidate':[]}
        work = {}
        for sample in range(1 if PLAN_ONLY else 10):
            for label in (('baseline','candidate') if sample%2==0 else ('candidate','baseline')):
                m,a = (before_query,before_admin) if label=='baseline' else (query,admin)
                if sample==0:
                    filter_cache.cache.entry = filter_cache.cache.failure = None
                captured = []
                def record(execute, sql, params, many, context):
                    started = time.perf_counter()
                    try:
                        return execute(sql,params,many,context)
                    finally:
                        captured.append((sql,params,(time.perf_counter()-started)*1000))
                started = time.perf_counter()
                try:
                    with connection.execute_wrapper(record):
                        payload, revision = _consistent_read(lambda: call(m,a))
                except Exception as error:
                    payload = {'measurementError':type(error).__name__}
                    # Failed scopes are retained and skipped after one sample;
                    # don't repeat known 7s timeouts just to collect a tail.
                    report.setdefault('failures',[]).append({'case':name,'version':label,
                        'sample':sample,'errorType':type(error).__name__})
                values[label].append((time.perf_counter()-started)*1000)
                digest = hashlib.sha256(json.dumps(payload,sort_keys=True,ensure_ascii=False,default=str).encode()).hexdigest()
                hashes[label].append(digest)
                if sample==0:
                    work[label] = {'queries':len(captured),'sqlMs':sum(t for _,_,t in captured),
                        'statements':[{'sql':s,'params':p,'ms':t} for s,p,t in captured]}
                    if PLAN_ONLY or name in ('report-7d','trend','settings-status','workspace-mapping','ranking-all'):
                        captured_plans = []
                        for sql,params,_ in captured:
                            if sql.lstrip().upper().startswith(('SELECT','WITH')) and any(t in sql for t in ('market_ranking_entries','market_image_cache')):
                                with connection.cursor() as c:
                                    try:
                                        c.execute(('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' if PLAN_ONLY else 'EXPLAIN (FORMAT JSON) ')+sql,params)
                                        captured_plans.append(c.fetchone()[0])
                                    except Exception as error:
                                        captured_plans.append({'planError':type(error).__name__})
                        plans[name+':'+label] = captured_plans
                time.sleep(.025)
            if any(f['case']==name for f in report.get('failures',[])):
                break
        succeeded = not any(f['case']==name for f in report.get('failures',[]))
        assert not succeeded or len(set(hashes['baseline']+hashes['candidate']))==1, name+' response differs'
        final_load = harness.machine_load()
        delta = final_load['total']-initial['total']
        cpu = 100*(1-(final_load['idle']-initial['idle'])/delta) if delta else None
        entry = {'case':name,'equal':succeeded,'digest':hashes['candidate'][0],'samples':values,'work':work,
            'p50':{k:harness.percentile(v,.5) for k,v in values.items()},
            'p95':{k:harness.percentile(v,.95) for k,v in values.items()},
            'initialLoad':initial,'finalLoad':final_load,'cpuAveragePercent':cpu,
            'loadQualified':cpu is not None and cpu<50 and min(initial['availableBytes'],final_load['availableBytes'])>=2.5*1024**3}
        report['results'].append(entry)
        (output/'complete-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2,default=str),encoding='utf-8')
        (output/'complete-plans.json').write_text(json.dumps(plans,ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps({'case':name,'p50':entry['p50'],'p95':entry['p95'],'equal':succeeded}),flush=True)
    report['complete']=True
    (output/'complete-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2,default=str),encoding='utf-8')


if __name__ == '__main__':
    baseline_dir = ROOT / '.runtime/market-performance-complete'
    baseline_dir.mkdir(parents=True,exist_ok=True)
    for source in ('backend/market/query.py','backend/market/admin.py','backend/market/master_query.py'):
        expected = subprocess.check_output(['git','show',BASELINE+':'+source],cwd=ROOT)
        target = baseline_dir / source.replace('/','_')
        if target.exists() and target.read_bytes()!=expected:
            raise RuntimeError('Baseline source bytes do not match the recorded SHA')
        if not target.exists():
            target.write_bytes(expected)
    harness.experiment = experiment
    if UNDER_LOAD:
        # Explicit diagnostic mode for concurrently busy development hosts.
        # Retain all samples and load flags; never qualify this as idle P95.
        # Only the mirror bootstrap memory gate changes, not SQL/HTTP/roles.
        def loaded_capacity():
            if harness.machine_load()['availableBytes'] < 1.5*1024**3:
                raise RuntimeError('Loaded-machine diagnostic requires 1.5 GiB free memory')
        harness.wait_for_capacity = loaded_capacity
    # Preserve the reviewed bootstrap's bounded options. The experiment above
    # fixes its own representative scale and number of serial samples.
    sys.argv = [sys.argv[0], '--plans-only']
    harness.main()
