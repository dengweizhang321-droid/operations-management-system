"""Project verified local JD files with existing domain readers in a RAM-only database.

Input is a private JSON intermediate produced by parseJdLogisticsWorkbook. Never
connects to an operating database or calls business writers. No real data in Git.
"""
import argparse
from collections import Counter
from datetime import date, datetime, timedelta
import hashlib
import json
import os
from pathlib import Path
import sys

parser = argparse.ArgumentParser()
parser.add_argument('--input', required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args()
payload = json.loads(Path(args.input).read_text(encoding='utf8'))
assert set(s['kind'] for s in payload['sources']) == {'flow', 'shop_products', 'realtime_inventory', 'inventory_snapshot'}
assert len(payload['sources']) == 4
for source in payload['sources']:
    assert hashlib.sha256(Path(source['sourcePath']).read_bytes()).hexdigest() == source['sha256'], 'Source file changed'
    assert Path(source['sourcePath']).name == source['name']
os.environ.pop('TERUISI_DJANGO_DATABASE_URL', None)
os.environ.update(TERUISI_DJANGO_SQLITE_PATH=':memory:', TERUISI_DJANGO_ENVIRONMENT='test', TERUISI_DJANGO_PROCESS_ROLE='development', DJANGO_SETTINGS_MODULE='teruisi_backend.settings')
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
import django
django.setup()
from django.db import connection
from inventory import jd_logistics as service, jd_logistics_models as models
from inventory.models import InventoryDataRevision
from inventory import jd_logistics_notifications as notifications
assert connection.vendor == 'sqlite' and str(connection.settings_dict['NAME']) == ':memory:'
with connection.cursor() as cursor:
    cursor.execute('PRAGMA database_list')
    assert all(not row[2] for row in cursor.fetchall()), 'Refuse any file-backed connection'
# The file artifact has no runtime notification channel. Avoid reading any local
# channel configuration; this process only uses source documents and RAM tables.
notifications.notification_available = lambda: False
with connection.schema_editor() as editor:
    for model in (models.JdLogisticsDepartment, models.JdLogisticsScope, models.JdLogisticsBatch, models.JdLogisticsFact, models.JdLogisticsProductMapping, models.JdLogisticsTransferManual, InventoryDataRevision):
        editor.create_model(model)
InventoryDataRevision.objects.create(domain='inventory', revision=0)
identifier = 'local-file-' + hashlib.sha256(payload['bu'].encode()).hexdigest()[:16]
department = models.JdLogisticsDepartment.objects.create(id=identifier, name=payload['departmentName'], business_unit_code=payload['bu'], updated_by='local-file-projection')
sources = []
for source in payload['sources']:
    kind = source['kind']
    days = [str(r.get('snapshotDate') or r.get('businessTime') or source['collectedAt'])[:10] for r in source['rows']]
    start, end = date.fromisoformat(min(days)), date.fromisoformat(max(days)) + timedelta(days=1)
    normalized = service.normalize_rows(kind, source['rows'], payload['bu'], start, end)
    batch_id = 'local-file-' + source['sha256'][:48]
    batch = models.JdLogisticsBatch.objects.create(id=batch_id, department=department, source_kind=kind, range_start=start, range_end=end, raw_file_hash=source['sha256'], content_hash=service._content_hash(row for row, _day in normalized), file_name=source['name'], row_count=len(normalized), status='file_snapshot', scope_revision=0, origin='local_file', collected_at=datetime.fromisoformat(source['collectedAt']), source_as_of=max(days) if kind == 'inventory_snapshot' else source['collectedAt'], actor='local-file-projection')
    occurrences = Counter()
    facts = []
    for row, day in normalized:
        digest = service._hash(row)
        occurrences[digest] += 1
        facts.append(models.JdLogisticsFact(id=service._hash([batch_id, digest, occurrences[digest]]), department=department, batch=batch, source_kind=kind, business_date=day, warehouse_code=row.get('warehouseCode', ''), warehouse_key=row.get('warehouseKey', ''), goods_code=row['goodsCode'], goods_code_kind=row['goodsCodeKind'], document_no=row.get('documentNo', ''), row_hash=digest, occurrence=occurrences[digest], data=row))
    models.JdLogisticsFact.objects.bulk_create(facts)
    assert models.JdLogisticsFact.objects.filter(batch=batch).count() == len(source['rows'])
    sources.append({'kind':kind, 'fileName':source['name'], 'sha256':source['sha256'], 'rows':len(normalized), 'startDate':str(start), 'endDateExclusive':str(end), 'collectedAt':source['collectedAt']})
filters = {'departmentId':identifier, 'page':1, 'pageSize':20000}
warehouses = {}
for row in models.JdLogisticsFact.objects.exclude(warehouse_key=''):
    warehouses[row.warehouse_key] = {'key':row.warehouse_key, 'code':row.warehouse_code, 'name':row.data['warehouseName'], 'identityKind':row.data['warehouseIdentityKind']}
options = service._base(departments=[service._department_payload(department)], warehouses=list(warehouses.values()), scopeRevisions=[], notification={'implemented':True, 'enabled':False, 'configured':False, 'groupName':'', 'robotName':'', 'configDigest':'', 'reason':'offline_file_snapshot'})
result = {'provenance':{'mode':'local-files', 'departmentId':identifier, 'sources':sources, 'businessWrites':False, 'notificationConfigured':False, 'notes':['本机已下载文件的只读快照，未导入正式系统；不是实时联网页面。', '实时库存为2026-10-15；销售出库快照截至2026-10-14，按T与T-1配对。', '快照与店铺商品文件缺少事业部列时，归属沿用此前导出页面已核实的事业部；不猜测所属京东店铺。', 'ERP商品对照、ERP单据、缺货阈值与正式导入记录未从运营系统读取，保留未确认；监控和通知均未启用。', '离线搜索按展示的京东SKU及商品名称筛选；汇总复用后台预计算，不在浏览器重算库存口径。']}, 'options':options, 'lists':{}, 'matrices':{}, 'catalog':[], 'aggregateValues':[], 'searchScopes':{}}
for operation in ('flows', 'transfers', 'mappings', 'products'):
    value = service.read(operation, filters)
    assert value['total'] == len(value['items']), 'Refuse truncated file projection'
    result['lists'][operation] = value
flow_days = sorted({row['businessTime'][:10] for row in result['lists']['flows']['items']})
assert len(flow_days) == 1, 'Offline ledger export currently requires a single business day to preserve date-slice transfer semantics'
result['transferScopes'] = {}
for warehouse in ('', *sorted({row.warehouse_code for row in models.JdLogisticsFact.objects.filter(source_kind='flow') if row.warehouse_code})):
    result['transferScopes'][warehouse] = service.read('transfers', {**filters, 'warehouseCode':warehouse})
result['provenance']['flowDate'] = flow_days[0]
# Never present RAM-only projection batches as actual system import records.
result['lists']['batches'] = service._base(items=[], total=0, page=1, pageSize=25)
full = service.inventory_monitor({**filters, 'layout':'warehouse', 'salesWindow':30})
assert full['total'] == len(full['items']) and len(full['items']) < service.MAX_MATRIX_DETAILS
catalog = {row['goodsCode']:row['goodsName'] for row in full['items']}
codes = sorted(catalog)
result['catalog'] = [{'code':code, 'name':catalog[code]} for code in codes]
index = {code:i for i, code in enumerate(codes)}
terms = {}
for code in codes:
    text = (code + ' ' + catalog[code]).lower()
    for start in range(len(text)):
        for end in range(start + 1, min(len(text) + 1, start + 101)):
            term = text[start:end]
            terms[term] = terms.get(term, 0) | (1 << index[code])
selections = set(terms.values()) | {0, (1 << len(codes)) - 1}
del terms
aggregate_ids = {}
preview_members = {}
def register_preview(metric, members):
    ids = sorted(row['id'] for row in members)
    key = service._hash(ids)
    preview_members[key] = ids
    metric['replenishmentPreviewKey'] = key

inventory_warehouses = sorted({row['warehouseKey'] for row in full['items']})
cycle_rows_by_day = {}
result['healthFilterMasks'] = {warehouse:{} for warehouse in ('', *inventory_warehouses)}
for cycle in (7, 14, 30, 45, 60, 90):
    models.JdLogisticsDepartment.objects.filter(id=identifier).update(replenishment_cycle_days=cycle)
    cycle_rows = service.inventory_monitor({**filters, 'layout':'warehouse', 'salesWindow':30})['items']
    cycle_rows_by_day[cycle] = {row['id']:row for row in cycle_rows}
    for warehouse in ('', *inventory_warehouses):
        members = [row for row in cycle_rows if not warehouse or row['warehouseKey'] == warehouse]
        masks = {}
        for state in service.HEALTH_FILTER_STATES:
            selected, _counts, _filter_counts = service._health_filter_scope(members, state)
            masks[state] = format(sum(1 << index[code] for code in {row['goodsCode'] for row in selected}), 'x')
        result['healthFilterMasks'][warehouse][str(cycle)] = masks
models.JdLogisticsDepartment.objects.filter(id=identifier).update(replenishment_cycle_days=30)
for window in (7, 30):
    full = service.inventory_monitor({**filters, 'layout':'warehouse', 'salesWindow':window})
    for warehouse in ('', *inventory_warehouses):
        rows = [row for row in full['items'] if not warehouse or row['warehouseKey'] == warehouse]
        available_mask = sum(1 << index[code] for code in {row['goodsCode'] for row in rows})
        scope = json.dumps([warehouse, window], ensure_ascii=False, separators=(',', ':'))
        result['matrices'][scope] = {**full, **service._product_matrix(rows, filters, window)}
        matrix = result['matrices'][scope]
        register_preview(matrix['totals'], rows)
        for product in matrix['items']:
            assert product['detailsComplete'], 'Cycle preview requires complete product membership'
            register_preview(product['summary'], product['details'])
            for cell in product['cells']:
                register_preview(cell, [row for row in product['details'] if row['columnKey'] == cell['columnKey']])
            for detail in product['details']:
                register_preview(detail, [detail])
        result['searchScopes'][scope] = {}
        scoped_selections = {selection & available_mask for selection in selections}
        for masks in result['healthFilterMasks'][warehouse].values():
            for health_mask in masks.values():
                scoped_selections.update(selection & available_mask & int(health_mask, 16) for selection in selections)
        for mask in scoped_selections:
            chosen = [row for row in rows if mask & (1 << index[row['goodsCode']])]
            aggregate = {'totals':service._aggregate_metrics(chosen, window, scope_total=True), 'summary':{'monitoredCount':len(chosen), 'qualifiedCount':sum(row['qualified'] for row in chosen), 'stockoutRiskCount':sum(row['warningState'] == 'stockout_risk' for row in chosen)}}
            register_preview(aggregate['totals'], chosen)
            digest = service._hash(aggregate)
            if digest not in aggregate_ids:
                aggregate_ids[digest] = len(result['aggregateValues'])
                result['aggregateValues'].append(aggregate)
            result['searchScopes'][scope][format(mask, 'x')] = aggregate_ids[digest]
    print(json.dumps({'window':window, 'warehouseScopes':len(inventory_warehouses)+1, 'aggregateValues':len(result['aggregateValues'])}), flush=True)
result['replenishmentPreviews'] = {}
for cycle in (7, 14, 30, 45, 60, 90):
    cycle_rows = cycle_rows_by_day[cycle]
    values = {}
    for key, ids in preview_members.items():
        aggregate = service._aggregate_metrics([cycle_rows[row_id] for row_id in ids], 30)
        values[key] = {'quantity':aggregate['suggestedReplenishmentQuantity'], 'days':aggregate['replenishmentCycleDays'], 'cycles':aggregate['replenishmentCycleDaysValues'], 'reasons':aggregate['metricQualifications']['suggestedReplenishmentQuantity'], **{field:aggregate[field] for field in ('inventoryHealthState', 'inventoryHealthReasons', 'healthCounts', 'hasStockout', 'hasReplenishmentNeed')}}
    result['replenishmentPreviews'][str(cycle)] = values
models.JdLogisticsDepartment.objects.filter(id=identifier).update(replenishment_cycle_days=30)
result['provenance']['notes'].append('库存周转周期表示目标库存覆盖天数，默认30天，沿用补货周期；健康状态与TAB成员由后台计算，HTML只切换预计算结果，不修改系统配置或推送。')
output = Path(args.output)
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')), encoding='utf8')
print(json.dumps({'sources':[{'kind':s['kind'], 'rows':s['rows']} for s in sources], 'products':len(codes), 'warehouseItems':full['total'], 'columns':len(result['matrices']['["",30]']['columns']), 'searchSelections':len(selections), 'bytes':output.stat().st_size, 'ramDatabaseOnly':True, 'businessWrites':False}))
connection.close()
