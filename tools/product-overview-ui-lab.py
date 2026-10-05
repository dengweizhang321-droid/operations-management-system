"""Synthetic domain timing server for the paired UI lab, loopback GET only."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import types
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, parse_qs

ROOT=Path(__file__).resolve().parents[1]
RUN=ROOT/'.runtime/product-overview-lab'
RUN.mkdir(parents=True,exist_ok=True)
TOKEN=os.environ.get('PRODUCT_OVERVIEW_LAB_TOKEN','')
if len(TOKEN)!=64 or not (ROOT/'.git').is_file() or not subprocess.check_output(['git','branch','--show-current'],cwd=ROOT,encoding='utf-8').strip().startswith('codex/'):
    raise RuntimeError('Use the owned lab launcher in an independent codex worktree')
if any(k.startswith('TERUISI_') for k in os.environ):
    raise RuntimeError('Lab must use a clean environment')
sys.path[:0]=[str(ROOT/'backend'),str(ROOT/'tools')]
os.environ.update(DJANGO_SETTINGS_MODULE='product_overview_test_settings',TERUISI_DJANGO_SQLITE_PATH=str(RUN/'synthetic.sqlite3'),TERUISI_DJANGO_ENVIRONMENT='test',TERUISI_DJANGO_PROCESS_ROLE='development',PYTHONUTF8='1')
import django
django.setup()
from django.core.management import call_command
from django.db import connection, close_old_connections
from django.utils import timezone
from sales.auth import Principal
from sales.models import SalesOrderLine, SalesImportBatch, SalesDataRevision, ErpProductMaster, sales_projection_values
from products.models import ProductInventoryProjection, ProductInventoryProjectionControl, ProductShippingRate
from products.query import product_summary
from products.summary_cache import cache
call_command('migrate',interactive=False,verbosity=0)
if not ErpProductMaster.objects.exists():
    stamp=timezone.now().isoformat();digest=hashlib.sha256(b'paired-ui-synthetic-v1').hexdigest()
    SalesImportBatch.objects.create(id='lab-sales',source='synthetic',file_name='Synthetic UI lab',file_size_bytes=0,file_hash=digest,sheet_name='fixture',status='completed',row_count=3600,inserted_count=3600,created_at=stamp,completed_at=stamp)
    ErpProductMaster.objects.bulk_create([ErpProductMaster(product_code=f'LAB-{i:03d}',product_name=f'合成商品 {i:03d}',brand='演示品牌',category='演示厨电' if i%2 else '演示设备',supplier='演示供应商',specification='演示规格',source_row_number=i+1,last_import_batch_id='lab-erp') for i in range(120)])
    defaults={f.name:'' for f in SalesOrderLine._meta.fields if f.get_internal_type()=='TextField' and not f.has_default()}
    rows=[]
    for day in range(1,31):
        for i in range(120):
            qty=-1 if (i+day)%11==0 else i%5+1
            raw=dict(source_line_key=f'lab-{i}-{day}',ship_time=f'2026-09-{day:02d}T10:00:00+08:00',product_code=f'LAB-{i:03d}',product_name=f'合成商品 {i:03d}',warehouse='演示仓',category='演示厨电' if i%2 else '演示设备',channel='演示-演示店',platform='演示',shop_name='演示店',order_no=f'lab-{i}-{day}')
            values={**defaults,**raw,**sales_projection_values(raw)}
            values.update(source_row_hash=hashlib.sha256(raw['source_line_key'].encode()).hexdigest(),first_import_batch_id='lab-sales',last_import_batch_id='lab-sales',source_row_number=len(rows)+1,quantity=qty,list_unit_price_cents=10000+i*100,cost_amount_cents=6000*qty,allocated_unit_price_cents=10000+i*100,allocated_amount_cents=(10000+i*100)*qty,fee_allocation_cents=100*qty,gross_profit_cents=(4000+i*100)*qty,gross_margin_bps=4000,untaxed_gross_profit_cents=4000*qty,untaxed_gross_margin_bps=4000,created_at=stamp,updated_at=stamp)
            rows.append(SalesOrderLine(**values))
    SalesOrderLine.objects.bulk_create(rows,batch_size=1000)
    for domain in ('sales','erp'):SalesDataRevision.objects.update_or_create(domain=domain,defaults={'revision':1})
    control=ProductInventoryProjectionControl.objects.get(id=1)
    control.active_revision='c'*64;control.active_total=120;control.active_source_batch_id='lab-stock';control.active_snapshot_date='2026-09-30';control.save()
    ProductInventoryProjection.objects.bulk_create([ProductInventoryProjection(projection_revision=control.active_revision,product_code=f'LAB-{i:03d}',brand='演示品牌',available_quantity=i,known_stock_value_cents=i*6000,priced_available_quantity=i if i%2 else 0,source_batch_id='lab-stock',snapshot_date='2026-09-30') for i in range(120)])
    ProductShippingRate.objects.bulk_create([ProductShippingRate(product_code=f'LAB-{i:03d}',shipping_rate='.05' if i%2 else '0',source_row_number=i+1,last_import_batch_id='lab-rate') for i in range(120)])
baseline=types.ModuleType('products._baseline');baseline.__package__='products'
exec(compile(subprocess.check_output(['git','show','31d0d806:backend/products/query.py'],cwd=ROOT,encoding='utf-8'),'baseline-query.py','exec'),baseline.__dict__)
principal=Principal('lab@example.invalid','Synthetic UI lab','admin',None)
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.headers.get('Authorization')!='Bearer '+TOKEN:self.send_response(403);self.end_headers();return
        close_old_connections()
        parsed=urlsplit(self.path)
        if parsed.path=='/health':self.send_response(200);self.end_headers();self.wfile.write(b'{"fixture":"product-overview-lab-v1"}');return
        if parsed.path!='/api/products/summary':self.send_response(404);self.end_headers();return
        qs=parse_qs(parsed.query)
        options={}
        for key,value in qs.items():
            target={'platform':'platforms','shop':'shopKeys','q':'query','category':'categories','marginBand':'marginBands','view':'projection','snapshotToken':'expectedSnapshotToken'}.get(key,key)
            options[target]=value if target in {'platforms','shopKeys','categories','marginBands'} else int(value[0]) if target in {'page','pageSize','days'} else value[0]
        reader=baseline.product_summary if self.headers.get('X-Lab-Implementation')=='baseline' else product_summary
        stats={'sql':0,'queries':0}
        def execute(fn,sql,params,many,context):
            started=time.perf_counter()
            try:return fn(sql,params,many,context)
            finally:stats['sql']+=(time.perf_counter()-started)*1000;stats['queries']+=1
        started=time.perf_counter()
        try:
            with connection.execute_wrapper(execute):payload=reader(principal,options)
            status=200
        except Exception as error:
            status=getattr(error,'status',500);payload={'error':str(error),'code':getattr(error,'code','lab_error')}
        compute=(time.perf_counter()-started)*1000
        serialized=time.perf_counter();body=json.dumps(payload,ensure_ascii=False).encode();serialize_ms=(time.perf_counter()-serialized)*1000
        self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(body)))
        self.send_header('Server-Timing',f'domain;dur={compute:.3f},sql;dur={stats["sql"]:.3f},serialize;dur={serialize_ms:.3f}')
        self.send_header('X-Lab-Queries',str(stats['queries']));self.end_headers();self.wfile.write(body)
    def log_message(self,*args):pass
    def do_POST(self):
        if self.path=='/__stop' and self.headers.get('Authorization')=='Bearer '+TOKEN:
            self.send_response(200);self.end_headers();threading.Thread(target=self.server.shutdown,daemon=True).start()
        else:self.send_response(403);self.end_headers()
print('Synthetic lab 120 products / 3600 sales / 120 stock / 120 rates; localhost:18138',flush=True)
ThreadingHTTPServer(('127.0.0.1',18138),Handler).serve_forever()
