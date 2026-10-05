"""Read-only audit of author benchmark reports; no database connection."""
import json,hashlib
from pathlib import Path
ROOT=next(p for p in Path(__file__).resolve().parents if (p/'.git').exists());OUT=ROOT/'.runtime/market-independent-20261005';EVIDENCE=ROOT/'docs/performance/market/evidence'
summary=[]
for name in ('core-reading-stage1','settings-final','actual-plans','extra-reads'):
    directory=EVIDENCE/name;report=json.loads((directory/'complete-report.json').read_text(encoding='utf-8-sig'))
    sources={path:{'declared':digest,'actual':hashlib.sha256((ROOT/path).read_bytes()).hexdigest()} for path,digest in report['sourceSha256'].items()}
    cases=[]
    for item in report['results']:
        first=item['initialLoad'];last=item['finalLoad'];total=last['total']-first['total'];cpu=100*(1-(last['idle']-first['idle'])/total) if total else None
        cases.append({'case':item['case'],'equal':item['equal'],'sampleCounts':{version:len(samples) for version,samples in item['samples'].items()},'p50':item['p50'],'p95':item['p95'],'cpuAcrossCasePercent':cpu,'initialAvailableGiB':first['availableBytes']/1024**3,'finalAvailableGiB':last['availableBytes']/1024**3,'queryCounts':{v:w['queries'] for v,w in item['work'].items()}})
    plans=json.loads((directory/'complete-plans.json').read_text(encoding='utf-8-sig'));execution=[]
    def walk(value,key):
        if isinstance(value,dict):
            if 'Execution Time' in value:
                plan=value.get('Plan',{});execution.append({'key':key,'executionMs':value['Execution Time'],'actualRows':plan.get('Actual Rows'),'sharedHits':plan.get('Shared Hit Blocks'),'sharedReads':plan.get('Shared Read Blocks'),'tempWritten':plan.get('Temp Written Blocks')})
            for child in value.values():walk(child,key)
        elif isinstance(value,list):
            for child in value:walk(child,key)
    for key,value in plans.items():walk(value,key)
    summary.append({'name':name,'complete':report['complete'],'mode':report.get('mode'),'concurrency':report['concurrency'],'samplesPerVersion':report['samplesPerVersion'],'conditions':report['conditions'],'rows':report['rows'],'priceSnapshots':report['priceSnapshots'],'imageRows':report['imageRows'],'masterIdentities':report['masterIdentities'],'allDeclaredSourcesMatchCurrent':all(v['declared']==v['actual'] for v in sources.values()),'sources':sources,'failures':report.get('failures',[]),'cases':cases,'analyzePlanCount':len(execution),'actualPlans':execution})
result={'reports':summary,'productionTouched':False,'audit':'Author-generated artifacts independently inspected; no rerun or production/HTTP claim'}
(OUT/'evidence-audit.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps([{k:v for k,v in s.items() if k in ('name','complete','allDeclaredSourcesMatchCurrent','failures','analyzePlanCount')} for s in summary],ensure_ascii=False))

