"""Private evidence/cleanup, bound to exact current installation."""
import hashlib,json,os,subprocess,sys
from pathlib import Path
from ai_functional_environment import ROOT,OUT,SOURCE,PGBIN,environment,keys,record,run
action=sys.argv[1]
if action=='snapshot':
    env=environment();os.environ.clear();os.environ.update(env)
    import django
    django.setup()
    from ai_assistant.models import AiChatRequestReceipts,AiChatProviderDispatches
    receipts=list(AiChatRequestReceipts.objects.values('id','client_request_id','owner_email','status','error_code','cancel_requested'))
    record('CHAT-FINAL-LEDGER.json',{'receipts':receipts,'dispatches':list(AiChatProviderDispatches.objects.values('receipt_id','dispatch_ordinal','provider_called_at')),'observedUnknownCount':sum(row['status']=='unknown' for row in receipts)})
elif action=='stop-pg':
    import psycopg
    with psycopg.connect(environment(admin=True)['TERUISI_DJANGO_DATABASE_URL']) as db:
        actual=db.execute("SELECT current_setting('data_directory'),inet_server_port(),current_database()").fetchone()
        assert Path(actual[0]).resolve()==(ROOT/'pg').resolve() and actual[1:]==(55488,'functional_ai')
    run('pg-final-stop',[PGBIN/'pg_ctl.exe','-D',ROOT/'pg','-m','fast','-w','-t','30','stop'],environment())
    assert not (ROOT/'pg/postmaster.pid').exists()
    record('PG-STOP.json',{'dataDirectory':str(ROOT/'pg'),'normalPgCtlExit':0,'postmasterPidAbsent':True,'databasePreserved':True})
elif action=='clear-credentials':
    assert (OUT/'PG-STOP.json').exists() and not (ROOT/'pg/postmaster.pid').exists()
    needles=[value.encode() for value in keys().values()]
    found=[];count=total=0
    candidates=list(OUT.rglob('*'))+list((SOURCE/'docs/ai-isolated-functional-20261108').glob('*'))+list((SOURCE/'tests').glob('ai-functional-*'))+[SOURCE/'tests/ai_functional_environment.py',SOURCE/'tests/ai_functional_http.py']
    for p in candidates:
        if not p.is_file():continue
        if p.stat().st_size>16*1024*1024:raise RuntimeError('bounded scan file too large: '+str(p))
        data=p.read_bytes();count+=1;total+=len(data)
        if any(n in data for n in needles):found.append(str(p))
    record('SECRET-SCAN.json',{'files':count,'bytes':total,'matches':found,'scope':'this stage evidence/docs/test scripts against five new private credentials; not full disk'})
    if found:raise RuntimeError('secret matches; do not publish')
    target=ROOT/'private.dpapi.json'
    assert target.resolve().parent==ROOT.resolve() and target.is_file()
    target.unlink()
    record('WINDOWS-CREDENTIAL-CLEANUP.json',{'removed':[str(target)],'privateDatabaseRetained':True,'newCredentialsRequiredToResume':True})
else:raise SystemExit('unknown action')
