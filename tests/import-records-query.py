import sys,datetime,decimal,json
sys.path.insert(0,'backend')
from django.conf import settings
settings.configure(INSTALLED_APPS=['sales','finance','inventory','erp_reference','netshop','customer_service','products'],DATABASES={'default':{'ENGINE':'django.db.backends.sqlite3','NAME':':memory:'}},USE_TZ=True,SECRET_KEY='synthetic-test')
import django
django.setup()
from django.db import connection,models
from django.http import QueryDict
from sales.import_record_query import list_records
from sales.models import SalesImportBatch
from finance.models import FinanceImportBatch
from inventory.models import InventoryImportBatch
from erp_reference.models import ErpReferenceImportBatch
from netshop.models import NetshopImportBatch
from customer_service.models import CustomerServiceImportBatch
from products.models import ProductShippingRateImportBatch
classes={'sales':SalesImportBatch,'finance':FinanceImportBatch,'inventory':InventoryImportBatch,'erp':ErpReferenceImportBatch,'netshop':NetshopImportBatch,'customer_service':CustomerServiceImportBatch,'products':ProductShippingRateImportBatch}
with connection.schema_editor() as schema:
 for model in classes.values():schema.create_model(model)
for domain,model in classes.items():
 data={}
 for field in model._meta.fields:
  if field.auto_created or getattr(field,'auto_now_add',False):continue
  if field.has_default() or field.null:continue
  if isinstance(field,models.DateTimeField):data[field.name]=datetime.datetime(2026,11,3,tzinfo=datetime.timezone.utc)
  elif isinstance(field,models.DateField):data[field.name]=datetime.date(2026,11,3)
  elif isinstance(field,(models.IntegerField,models.FloatField,models.DecimalField)):data[field.name]=0
  else:data[field.name]=''
 data.update(id='synthetic-'+domain,status='completed',created_at='2026-11-03T00:00:00Z',completed_at='2026-11-03T00:00:00Z')
 if domain=='netshop':data.update(source='jd_product_master',dataset='sku_master',platform='synthetic',shop_name='synthetic')
 if domain=='inventory':data['dataset']='stock'
 if domain=='erp':data.update(source_key='products',source_label='synthetic')
 if domain=='sales':data.update(warnings_json='[]',totals_json='{}')
 model.objects.create(**data)
 result=list_records(domain,QueryDict('records=1&page=1&pageSize=20'),Exception)
 assert len(result['items'])==1,(domain,result)
 assert result['pagination']['total']==1
 empty=list_records(domain,QueryDict('records=1&page=1&pageSize=20&recordStatus=failed'),Exception)
 assert empty['pagination']['total']==0,(domain,empty)
 print(domain,json.dumps({'total':result['pagination']['total'],'key':result['items'][0]['sourceKey'],'sortAt':result['items'][0]['sortAt']}))
print('All 7 domain SQL query and serializer projections passed')
# Exercise SQL offset/limit and filtering before pagination on synthetic history.
from django.test.utils import CaptureQueriesContext
from sales.write_service import SalesImportServiceError
for i in range(1,46):
 SalesImportBatch.objects.create(id=f'page-{i:03}',source='',file_name='synthetic',file_size_bytes=0,file_hash=f'hash-{i}',sheet_name='',status='completed' if i%2 else 'failed',created_at=f'2026-11-03T01:{i:02}:00+08:00',completed_at=None)
with CaptureQueriesContext(connection) as queries:
 result=list_records('sales',QueryDict('records=1&page=2&pageSize=20'),SalesImportServiceError)
 assert result['pagination']['total']==46 and len(result['items'])==20
 assert any('LIMIT 20 OFFSET 20' in query['sql'] for query in queries.captured_queries)
filtered=list_records('sales',QueryDict('records=1&page=2&pageSize=20&recordStatus=completed'),SalesImportServiceError)
assert filtered['pagination']['total']==24 and len(filtered['items'])==4
assert filtered['pagination']['truncated'] is False
empty=list_records('sales',QueryDict('records=1&page=1&pageSize=20&recordStatus=running'),SalesImportServiceError)
assert empty['pagination']['total']==0 and empty['pagination']['completeness']=='complete'
for bad in ('records=1&pageSize=201','records=1&page=0','records=1&recordStatus=invalid','records=1&page=1&page=2'):
 try:list_records('sales',QueryDict(bad),SalesImportServiceError)
 except SalesImportServiceError as error:assert error.status==400
 else:raise AssertionError(bad)
# SQL status groups must retain presentation semantics, including the JSON warnings.
from customer_service.models import CustomerServiceImportBatch
CustomerServiceImportBatch.objects.filter(id='synthetic-customer_service').update(warnings_json={'items':['synthetic warning']})
warn=list_records('customer_service',QueryDict('records=1&recordStatus=warning'),SalesImportServiceError)
assert warn['pagination']['total']==1 and warn['items'][0]['warningCount']==1
complete=list_records('customer_service',QueryDict('records=1&recordStatus=completed'),SalesImportServiceError)
assert complete['pagination']['total']==0
# Naive legacy dates use Shanghai; explicit offsets and native timestamps keep their instant.
ProductShippingRateImportBatch.objects.filter(id='synthetic-products').update(completed_at='2026-11-03 08:00:00')
legacy=list_records('products',QueryDict('records=1'),SalesImportServiceError)
assert legacy['items'][0]['sortAt']=='2026-11-03T00:00:00.000000+00:00'
print('SQL offset/limit, filtered totals, empty/last page, caps, warning groups and legacy timezone passed')
