"""Correct numeric prices in already-authorized synthetic-only preview fixtures."""
import os,sys,json,hashlib
from pathlib import Path
ROOT=next(p for p in Path(__file__).resolve().parents if (p/'.git').exists());OUT=ROOT/'.runtime/market-independent-20261005';DB=ROOT/'.runtime/preview/demo-1791212224923-ee9514f1.sqlite3'
assert DB.is_file() and DB.resolve().is_relative_to((ROOT/'.runtime/preview').resolve())
for k in list(os.environ):
    if k.upper().startswith(('TERUISI_','DJANGO_','PG','AI_','OPENAI_','ARK_','OLLAMA_')):os.environ.pop(k)
os.environ.update(TERUISI_DJANGO_ENVIRONMENT='test',TERUISI_DJANGO_SQLITE_PATH=str(DB),DJANGO_SETTINGS_MODULE='teruisi_backend.settings');sys.path.insert(0,str(ROOT/'backend'))
import django;django.setup()
from django.db import transaction
from market.models import MarketRankingEntry,MarketPriceSnapshot,MarketAnnotationItem
from market.revisions import bump_revision
from market.admin import list_master
assert MarketRankingEntry.objects.count()==40 and not MarketRankingEntry.objects.exclude(natural_key__startswith='preview-').exists()
before={'confirmed':list_master({'priceStatuses':['confirmed']})['pagination']['total'],'pending':list_master({'priceStatuses':['pending']})['pagination']['total']}
with transaction.atomic():
    for n,row in enumerate(MarketRankingEntry.objects.order_by('id')):
        price=10000+n*100
        row.price_cents=price;row.save(update_fields=['price_cents'])
        assert MarketPriceSnapshot.objects.filter(id=f'independent-snapshot-{n}').update(source_price_cents=price,ai_image_price_cents=price,confirmed_market_price_cents=price if n<10 else None,confirmation_status='confirmed' if n<10 else 'source_table')==1
        assert MarketAnnotationItem.objects.filter(id=f'independent-review-item-{n}').update(ai_image_price_cents=price,reviewed_image_price_cents=price)==1
    bump_revision({'kind':'independent_synthetic_numeric_price_correction','sourceWasMissing':True})
after={'confirmed':list_master({'priceStatuses':['confirmed']})['pagination']['total'],'pending':list_master({'priceStatuses':['pending']})['pagination']['total']}
assert after=={'confirmed':10,'pending':30}
report={'database':str(DB.relative_to(ROOT)),'synthetic':True,'productionTouched':False,'modelsCalled':0,'rankingRows':40,'beforeActualPriceFilters':before,'afterActualPriceFilters':after,'correction':'Initial seed copied missing source prices; final fixtures install explicit synthetic numeric prices and verify real query predicates','databaseSha256':hashlib.sha256(DB.read_bytes()).hexdigest()}
(OUT/'preview-price-correction.json').write_text(json.dumps(report,indent=2),encoding='utf8');print(json.dumps(report))
