import subprocess
import types
from urllib.parse import urlencode
from pathlib import Path
from unittest.mock import patch

from django.test import TransactionTestCase
from products.errors import ProductsApiError
from products.models import ProductDataRevision, ProductInventoryProjection, ProductInventoryProjectionControl, ProductShippingRate
from products.query import product_summary
from products.summary_cache import cache
from sales.auth import Principal
from sales.models import ErpProductMaster, SalesDataRevision
from sales.tests.factories import TEST_SECRET, signed_headers

class ProgressiveSummaryTests(TransactionTestCase):
    # Retain migration seed control rows between TransactionTestCase methods.
    serialized_rollback=True
    def setUp(self):
        cache.entries.clear();cache.bytes=0
        self.principal=Principal('fixture@example.invalid','Fixture','admin',None)
        self.options=dict(range='custom',startDate='2026-09-01',endDate='2026-09-30',pageSize=50)
        self.calls=[]
        for domain in ('sales','erp'):
            SalesDataRevision.objects.update_or_create(domain=domain,defaults={'revision':1})
        ErpProductMaster.objects.bulk_create([ErpProductMaster(product_code=f'X-{i:03d}',product_name=f'Fixture {i}',brand='Fixture',category=f'Category {i%2}',supplier='Fixture supplier',source_row_number=i+1,last_import_batch_id='fixture-erp') for i in range(120)])
        control=ProductInventoryProjectionControl.objects.get(id=1)
        control.active_revision='c'*64;control.active_total=120;control.active_source_batch_id='fixture-stock';control.active_snapshot_date='2026-09-30';control.save()
        ProductInventoryProjection.objects.bulk_create([ProductInventoryProjection(projection_revision=control.active_revision,product_code=f'X-{i:03d}',brand='Fixture inventory',available_quantity=i,known_stock_value_cents=i*100,priced_available_quantity=i if i%2 else 0,source_batch_id='fixture-stock',snapshot_date='2026-09-30') for i in range(120)])
        ProductShippingRate.objects.bulk_create([ProductShippingRate(product_code=f'X-{i:03d}',shipping_rate='.05' if i%2 else '0',source_row_number=i+1,last_import_batch_id='fixture-rate') for i in range(120)])
        self.freshness={'dataStartDate':'2026-09-01','dataCutoffDate':'2026-09-30','latestBatch':{'id':'fixture-sales','fileName':'synthetic','completedAt':'2026-09-30','rowCount':120}}
        def consumer(_principal,request):
            self.calls.append(request['operation'])
            if request['operation']=='freshness':return self.freshness
            rows=[]
            for code in request['productCodes']:
                i=int(code.split('-')[1]);sale=0 if i%11==0 else 10000+i*100
                rows.append(dict(productCode=code,productName='raw',specification='test',category='raw',supplier='raw',netQuantity=i-5,grossSalesCents=sale+100,refundAmountCents=100,netSalesCents=sale,costCents=i*100,feeCents=50,grossProfitCents=(-100 if i%7==0 else int(sale*(.3+i%4*.05))),absoluteQuantity=i+5,absoluteCostCents=i*100,outlets=[dict(platform='Fixture',shopName='Fixture shop',channel='Fixture-Fixture shop')]))
            return {**self.freshness,'truncated':False,'rows':rows,'outletOptions':[dict(platform='Fixture',shopName='Fixture shop',channel='Fixture-Fixture shop')]}
        self.consumer=patch('products.query.execute_consumer_query',side_effect=consumer);self.consumer.start();self.addCleanup(self.consumer.stop)

    def tearDown(self):
        cache.entries.clear();cache.bytes=0

    def test_complete_set_equivalence_initial_overview_page_and_cache_reuse(self):
        root=Path(__file__).resolve().parents[3]
        source=subprocess.check_output(['git','show','31d0d806:backend/products/query.py'],cwd=root,encoding='utf-8')
        baseline=types.ModuleType('products._baseline');baseline.__package__='products'
        exec(compile(source,'baseline-query.py','exec'),baseline.__dict__)
        with patch.object(baseline,'execute_consumer_query',side_effect=lambda p,r: self.consumer.target.execute_consumer_query(p,r)):
            # The baseline consumer uses the same bounded deterministic sales
            # response; dimensions, fee and stock are real private PostgreSQL.
            for sort in ['netSalesCents','grossProfitCents','grossMarginRate','refundRate','stockValueCents','netQuantity']:
                for direction in ['asc','desc']:
                    for filters in [{},{'categories':['Category 1']},{'marginBands':['atLeast45']},{'query':'X-001,X-119'}]:
                        opts={**self.options,**filters,'sortBy':sort,'direction':direction}
                        old=baseline.product_summary(self.principal,opts)
                        new=product_summary(self.principal,opts)
                        self.assertEqual(new,old)
            before=len(self.calls)
            initial=product_summary(self.principal,{**self.options,'projection':'initial-page'})
            self.assertNotIn('metrics',initial);self.assertNotIn('filters',initial)
            overview=product_summary(self.principal,{**self.options,'projection':'overview','expectedSnapshotToken':initial['snapshotToken']})
            page=product_summary(self.principal,{**self.options,'page':2,'projection':'page','expectedSnapshotToken':initial['snapshotToken']})
            self.assertNotIn('items',overview)
            self.assertEqual(overview['metrics']['skuCount'],120)
            self.assertEqual(page['pagination']['total'],120)
            self.assertEqual(len(page['items']),50)
            self.assertEqual(len(self.calls),before,'same base must not call sales again')

    def test_source_version_changes_invalidate_and_fail_closed(self):
        old=product_summary(self.principal,self.options)
        SalesDataRevision.objects.filter(domain='erp').update(revision=99)
        with self.assertRaises(ProductsApiError):product_summary(self.principal,{**self.options,'projection':'page','expectedSnapshotToken':old['snapshotToken']})
        new=product_summary(self.principal,self.options);self.assertNotEqual(new['snapshotToken'],old['snapshotToken'])
        ProductDataRevision.objects.filter(domain='products').update(revision=99)
        newer=product_summary(self.principal,self.options);self.assertNotEqual(newer['snapshotToken'],new['snapshotToken'])
        cache.entries.clear();cache.bytes=0
        with patch('products.query.sales_revision_token',side_effect=['v1','v2']):
            with self.assertRaises(ProductsApiError):product_summary(self.principal,self.options)
        self.assertFalse(cache.entries)

    def test_non_cacheable_base_returns_full_inline_without_second_region_scan(self):
        with patch.object(cache,'maximum_bytes',1):
            initial=product_summary(self.principal,{**self.options,'projection':'initial-page'})
            self.assertEqual(initial['projection'],'full')
            self.assertEqual(initial['metrics']['skuCount'],120)
            self.assertEqual(len(initial['items']),50)
            self.assertEqual(self.calls.count('product_performance'),1)
            self.assertFalse(cache.entries)

    def test_authoritative_no_sales_keeps_new_region_request_witness(self):
        self.freshness.update(dataStartDate=None,dataCutoffDate=None,latestBatch=None)
        initial=product_summary(self.principal,{**self.options,'projection':'initial-page'})
        self.assertFalse(initial['hasSales'])
        self.assertEqual(initial['sync']['requestedStartDate'],self.options['startDate'])
        self.assertEqual(initial['sync']['requestedEndDate'],self.options['endDate'])
        self.assertEqual(initial['items'],[])
        overview=product_summary(self.principal,{**self.options,'projection':'overview','expectedSnapshotToken':initial['snapshotToken']})
        self.assertEqual(overview['metrics']['skuCount'],0)
        self.assertEqual(overview['sync'],initial['sync'])
        legacy=product_summary(self.principal,self.options)
        self.assertIsNone(legacy['sync']['requestedStartDate'])

    @patch.dict('os.environ',{'TERUISI_DJANGO_INTERNAL_SECRET':TEST_SECRET})
    def test_signed_new_views_reject_missing_token_duplicates_and_scope(self):
        base='/api/products/summary'
        url=base+'?'+urlencode({'view':'initial-page',**self.options})
        initial=self.client.get(url,headers=signed_headers(url))
        self.assertEqual(initial.status_code,200,initial.content)
        token=initial.json()['snapshotToken']
        for query in ['view=overview','view=overview&snapshotToken=x','view=initial-page&snapshotToken='+token,'view=page&view=overview&snapshotToken='+token]:
            url=base+'?'+query
            self.assertEqual(self.client.get(url,headers=signed_headers(url)).status_code,400)
        url=base+'?'+urlencode({'view':'overview','snapshotToken':token,**self.options})
        response=self.client.get(url,headers=signed_headers(url))
        self.assertEqual(response.status_code,200,response.content)
        self.assertEqual(response['Cache-Control'],'no-store')
