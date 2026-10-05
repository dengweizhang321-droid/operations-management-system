"""Populate only the parent-approved synthetic SQLite preview, never production."""
import os,sys,json,hashlib,sqlite3
from pathlib import Path
ROOT=next(p for p in Path(__file__).resolve().parents if (p/'.git').exists())
OUT=ROOT/'.runtime/market-independent-20261005';OUT.mkdir(exist_ok=True)
DB=ROOT/'.runtime/preview/demo-1791212224923-ee9514f1.sqlite3'
assert DB.is_file() and DB.resolve().is_relative_to((ROOT/'.runtime/preview').resolve())
for key in list(os.environ):
    if key.upper().startswith(('TERUISI_','DJANGO_','PG','AI_','OPENAI_','ARK_','OLLAMA_','CLOUDFLARE_')):os.environ.pop(key)
os.environ.update(TERUISI_DJANGO_ENVIRONMENT='test',TERUISI_DJANGO_SQLITE_PATH=str(DB),DJANGO_SETTINGS_MODULE='teruisi_backend.settings')
sys.path.insert(0,str(ROOT/'backend'))
import django;django.setup()
from django.db import connection,transaction
from django.utils import timezone
from market.models import *
from market.revisions import bump_revision
assert connection.vendor=='sqlite' and Path(connection.settings_dict['NAME']).resolve()==DB.resolve()
assert MarketRankingEntry.objects.count()==40
assert not MarketRankingEntry.objects.exclude(natural_key__startswith='preview-').exists(), 'Only original synthetic preview facts may be expanded'
backup=OUT/'preview-before-independent.sqlite3'
if not backup.exists():
    with sqlite3.connect(DB) as source,sqlite3.connect(backup) as target:source.backup(target)
before_hash=hashlib.sha256(DB.read_bytes()).hexdigest()
svg='<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="#dbeafe"/><text x="12" y="64" font-size="15">Synthetic</text></svg>'
from urllib.parse import quote
url='data:image/svg+xml,'+quote(svg);digest=hashlib.sha256(svg.encode()).hexdigest();created={}
with transaction.atomic():
    rows=list(MarketRankingEntry.objects.order_by('id'))
    cats=sorted({r.category for r in rows})
    for n,cat in enumerate(cats):
        MarketSubcategoryTaxonomy.objects.update_or_create(category=cat,subcategory='演示细分类目',defaults={'id':f'independent-taxonomy-{n}','created_by':'fixture@example.invalid','updated_by':'fixture@example.invalid'})
        prompt,_=MarketAnnotationPromptVersion.objects.get_or_create(category=cat,status='active',defaults={'id':f'independent-prompt-{n}','version':1,'source':'manual','segments_json':['演示细分类目'],'prompt_body':'Synthetic read-only fixture; never execute models','created_by':'fixture@example.invalid'})
        job,_=MarketAnnotationJob.objects.update_or_create(id=f'independent-review-job-{n}',defaults={'category':cat,'prompt_version_id':prompt.id,'executor':'cloud','status':'review_ready','total_count':20,'completed_count':20,'created_by':'fixture@example.invalid'})
        band,_=MarketPriceBandVersion.objects.get_or_create(category=cat,status='published',defaults={'id':f'independent-band-{n}','version':1,'effective_from':'2026-01-01','created_by':'fixture@example.invalid','published_by':'fixture@example.invalid','published_at':timezone.now(),'note':'Synthetic fixture only'})
        MarketPriceBandItem.objects.update_or_create(id=f'independent-band-item-{n}',defaults={'version_id':band.id,'label':'演示价格带','min_cents':0,'max_cents':1000000})
        MarketMasterMappingRule.objects.update_or_create(id=f'independent-map-{n}',defaults={'kind':'brand_alias','category':cat,'source_value':'演示品牌别名','target_value':'演示品牌','status':'published','created_by':'fixture@example.invalid'})
        MarketDownloadConfig.objects.update_or_create(id=f'independent-config-{n}',defaults={'category':cat,'scope':'全部','ranking_dimension':'SKU','month_start':'2026-10','month_end':'2026-10','status':'disabled','created_by':'fixture@example.invalid'})
        MarketDownloadTask.objects.update_or_create(id=f'independent-download-{n}',defaults={'category':cat,'scope':'全部','month':'2026-10','ranking_dimension':'SKU','status':'completed','source_file_name':'合成只读下载记录.xlsx','row_count':20,'completed_at':timezone.now()})
    for n,row in enumerate(rows):
        row.image_url=url;row.price_cents=row.price_cents if row.price_cents is not None else 10000+n*100;row.save(update_fields=['image_url','price_cents'])
        identity=dict(category=row.category,scope=row.scope,ranking_dimension=row.ranking_dimension,sku_code=row.sku_code)
        MarketMasterIdentity.objects.update_or_create(**identity,defaults={'latest_entry_id':row.id})
        MarketSkuGmvTotal.objects.update_or_create(sku_code=row.sku_code,defaults={'gmv_total_cents':row.gmv_cents})
        snap,_=MarketPriceSnapshot.objects.update_or_create(**identity,month=row.period_end[:7],defaults={'id':f'independent-snapshot-{n}','source_price_cents':row.price_cents,'ai_image_price_cents':row.price_cents,'ai_price_type':'标准售价','ai_confidence_bps':9500,'ai_reason':'Synthetic only','confirmed_market_price_cents':row.price_cents if n<10 else None,'confirmation_status':'confirmed' if n<10 else 'source_table','image_content_sha256':digest,'image_url':url,'source_import_batch_id':'preview-market','confirmed_by':'fixture@example.invalid' if n<10 else ''})
        job_id=f'independent-review-job-{cats.index(row.category)}';prompt=MarketAnnotationJob.objects.get(id=job_id).prompt_version_id
        MarketAnnotationItem.objects.update_or_create(id=f'independent-review-item-{n}',defaults={**identity,'job_id':job_id,'month':row.period_end[:7],'image_content_sha256':digest,'product_name':row.product_name,'brand':row.brand,'source_image_url':url,'resolved_image_url':url,'image_source':'synthetic','status':'review_pending','ai_segment':'演示细分类目','ai_image_price_cents':row.price_cents,'ai_price_type':'标准售价','ai_confidence_bps':9500,'ai_reason':'Synthetic fixture, no model called','reviewed_segment':'演示细分类目','reviewed_image_price_cents':row.price_cents,'version':1})
    MarketBrandSeed.objects.update_or_create(id='independent-brand-seed',defaults={'canonical_brand':'演示品牌','seed_text':'演示品牌','normalized_seed':'演示品牌','source':'manual','created_by':'fixture@example.invalid'})
    MarketBrandRecognitionJob.objects.update_or_create(id='independent-brand-job',defaults={'model_id':'synthetic-no-model','status':'paused','total_count':40,'processed_count':10,'recognized_count':10,'created_by':'fixture@example.invalid'})
    MarketMasterAuditLog.objects.create(actor_email='fixture@example.invalid',actor_role='admin',action='synthetic_fixture',entity_type='market_preview',entity_id='independent-readonly',after_json={'synthetic':True,'externalCalls':0})
    bump_revision({'kind':'independent_synthetic_fixture','identities':40})
    for model in (MarketMasterIdentity,MarketPriceSnapshot,MarketSubcategoryTaxonomy,MarketAnnotationPromptVersion,MarketAnnotationJob,MarketAnnotationItem,MarketMasterMappingRule,MarketPriceBandVersion,MarketPriceBandItem,MarketDownloadConfig,MarketDownloadTask,MarketBrandSeed,MarketBrandRecognitionJob,MarketMasterAuditLog):created[model._meta.db_table]=model.objects.count()
from market.admin import execute_master_query
from market.annotations import execute_annotation_query
from sales.auth import Principal
principal=Principal('fixture@example.invalid','Synthetic','admin',None)
primary=execute_master_query({'operation':'master','view':'database_primary','params':{'page':1,'pageSize':30}})
review=execute_annotation_query({'operation':'annotations','view':'review','params':{'aggregateJobs':True,'itemPage':1,'itemPageSize':20}},principal)
assert primary['masterData']['pagination']['total']==40 and len(primary['masterData']['items'])==30
assert review['itemPagination']['total']==40 and len(review['items'])==20 and all(i['snapshotValid'] for i in review['items'])
report={'database':str(DB.relative_to(ROOT)),'synthetic':True,'productionTouched':False,'externalCalls':0,'modelCalls':0,'baselineBackup':str(backup.relative_to(ROOT)),'beforeSha256':before_hash,'afterSha256':hashlib.sha256(DB.read_bytes()).hexdigest(),'tables':created,'rankingRows':40,'masterPage':30,'reviewPage':20,'reviewAllSnapshotValid':True,'image':'Embedded synthetic SVG; no remote bytes','downloadConfigs':'disabled','annotationJobs':'review_ready','brandJob':'paused'}
(OUT/'preview-fixture.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8');print(json.dumps(report,ensure_ascii=False))

