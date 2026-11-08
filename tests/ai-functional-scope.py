"""Nonempty scope fences through the original signed tool and conversation paths."""
import json,time,uuid
from ai_functional_http import call,user
from ai_functional_environment import OUT
from ai_assistant import transport
from ai_assistant.policy import digest
from access_control.models import AppUser

records=[]
original=user('scoped').scope
try:
    principal=user('scoped')
    entries=transport.catalog(principal,'ai_chat')
    allowed=transport.execute_tool('get_netshop_performance',{'platform':'京东','shop':'隔离周报甲店','startDate':'2026-11-06','endDate':'2026-11-06','dataset':'product_daily','limit':6},principal,surface='ai_chat',request_id='scope-positive-'+uuid.uuid4().hex,policy_digest=digest(entries))
    records.append({'label':'allowed-platform-tool','result':allowed});assert allowed.get('ok') is True,allowed
    result=transport.execute_tool('get_netshop_performance',{'platform':'天猫','shop':'隔离周报甲店','startDate':'2026-11-06','endDate':'2026-11-06','dataset':'product_daily','limit':6},principal,surface='ai_chat',request_id='scope-tool-'+uuid.uuid4().hex,policy_digest=digest(entries))
    records.append({'label':'denied-platform-tool','result':result})
    assert result.get('ok') is False and 'data' not in result,result
    client='web-chat-v1-'+str(int(time.time()*1000))+'-'+str(uuid.uuid4())
    r=call('/api/ai/chat',{'clientRequestId':client,'workspaceModule':'sales','message':'简短解释一条工作原则。','modelId':'isofunc-chat-ok'},actor='scoped')
    records.append({'label':'scoped-conversation-create','clientRequestId':client,'result':r});assert r['status']==200,r
    conv=r['body']['conversationId']
    r=call('/api/ai/chat?conversationId='+conv+'&workspaceModule=sales',method='GET',actor='scoped')
    records.append({'label':'original-scope-read','result':r});assert r['status']==200
    AppUser.objects.filter(email=principal.email).update(scope={'warehouses':[],'channels':[],'platforms':[]})
    r=call('/api/ai/chat?conversationId='+conv+'&workspaceModule=sales',method='GET',actor='scoped')
    records.append({'label':'narrowed-scope-read','result':r});assert r['status']==404,r
    passed=True
except Exception as error:
    passed=False;records.append({'exception':type(error).__name__,'message':str(error)[:3000]})
finally:
    AppUser.objects.filter(email='scoped@functional.invalid').update(scope=original)
    with (OUT/('SCOPE-'+str(time.time_ns())+'.json')).open('x',encoding='utf8') as f:json.dump({'passed':passed,'normalLogin':False,'records':records},f,ensure_ascii=False,indent=2)
print(json.dumps({'passed':passed,'checks':len(records)}))
if not passed:raise SystemExit(1)
