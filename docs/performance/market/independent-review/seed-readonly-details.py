"""Purely synthetic finished validation/paused progress/disabled runner detail fixtures."""
import os,sys,json,socket,hashlib
from pathlib import Path
ROOT=next(p for p in Path(__file__).resolve().parents if (p/'.git').exists());OUT=ROOT/'.runtime/market-independent-20261005';DB=ROOT/'.runtime/preview/demo-1791212224923-ee9514f1.sqlite3'
with socket.socket() as probe:
    assert probe.connect_ex(('127.0.0.1',3186))!=0,'Preview must remain stopped while fixtures are installed'
assert DB.is_file() and DB.resolve().is_relative_to((ROOT/'.runtime/preview').resolve())
for k in list(os.environ):
    if k.upper().startswith(('TERUISI_','DJANGO_','PG','AI_','OPENAI_','ARK_','OLLAMA_')):os.environ.pop(k)
os.environ.update(TERUISI_DJANGO_ENVIRONMENT='test',TERUISI_DJANGO_SQLITE_PATH=str(DB),DJANGO_SETTINGS_MODULE='teruisi_backend.settings');sys.path.insert(0,str(ROOT/'backend'))
import django;django.setup()
from django.db import transaction
from django.utils import timezone
from market.models import *
from market.revisions import bump_revision
assert MarketRankingEntry.objects.count()==40
with transaction.atomic():
    for n,prompt in enumerate(MarketAnnotationPromptVersion.objects.order_by('category')):
        item=MarketAnnotationItem.objects.filter(category=prompt.category).first()
        sample,_=MarketAnnotationValidationSample.objects.update_or_create(id=f'independent-validation-sample-{n}',defaults={'category':item.category,'scope':item.scope,'sku_code':item.sku_code,'ranking_dimension':item.ranking_dimension,'image_content_sha256':item.image_content_sha256,'product_name':item.product_name,'brand':item.brand,'image_url':item.source_image_url,'gold_segment':'演示细分类目','created_by':'fixture@example.invalid'})
        run,_=MarketAnnotationValidationRun.objects.update_or_create(id=f'independent-validation-run-{n}',defaults={'category':prompt.category,'candidate_prompt_id':prompt.id,'model_id':'synthetic-no-model','status':'completed','seed':'independent-synthetic','requested_sample_count':1,'sample_count':1,'sample_hash':hashlib.sha256((item.id+'-synthetic').encode()).hexdigest(),'gate_json':{'passed':False,'reasons':['合成只读验证样本，未调用模型']},'created_by':'fixture@example.invalid','completed_at':timezone.now()})
        MarketAnnotationValidationResult.objects.update_or_create(id=f'independent-validation-result-{n}',defaults={'run_id':run.id,'sample_id':sample.id,'prompt_version_id':prompt.id,'status':'completed','predicted_segment':'合成错例','is_correct':False,'error_message':'合成只读验证样本，未调用模型','sample_snapshot_json':{'skuCode':item.sku_code,'productName':item.product_name,'goldSegment':'演示细分类目'}})
        job=MarketAnnotationJob.objects.get(category=prompt.category)
        MarketAnnotationCloudRun.objects.update_or_create(job_id=job.id,defaults={'state':'paused','completed_at':timezone.now(),'retry_state_json':{'synthetic':True}})
        MarketAnnotationConcurrencySetting.objects.update_or_create(category=prompt.category,executor='cloud',defaults={'concurrency':1,'updated_by':'fixture@example.invalid'})
    MarketAnnotationLocalAgent.objects.update_or_create(id='independent-disabled-agent',defaults={'name':'合成停用 runner（无执行能力）','token_hash':hashlib.sha256(b'synthetic-disabled-no-credential').hexdigest(),'status':'revoked','created_by':'fixture@example.invalid','revoked_at':timezone.now()})
    bump_revision({'kind':'independent_completed_readonly_details','externalCalls':0})
report={'database':str(DB.relative_to(ROOT)),'synthetic':True,'modelCalls':0,'productionTouched':False,'validationRuns':2,'validationResults':2,'pausedCloudRuns':2,'disabledAgent':1,'allJobsNonRunnable':True,'rankingRows':40}
(OUT/'readonly-detail-fixture.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8');print(json.dumps(report))
