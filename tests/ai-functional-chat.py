"""Finite real HTTP/PG/provider tests, preserving every issued client ID."""
import concurrent.futures,json,time,uuid
from ai_functional_http import call,fixture_count
from ai_functional_environment import OUT
from ai_assistant import models as m

case=__import__('sys').argv[1]
prefix=(__import__('sys').argv[2] if len(__import__('sys').argv)>2 else 'web-chat-v1-'+str(int(time.time()*1000))+'-'+str(uuid.uuid4()))
records=[]
def invoke(label,path,payload=None,**kwargs):
    r=call(path,payload,**kwargs);records.append({'label':label,'path':path,'payload':payload,'result':r});return r
def payload(model='chat-ok',message='你好，请解释普通经营问题，不需要创建任务。',client=None):
    return {'clientRequestId':client or prefix,'workspaceModule':'sales','message':message,'modelId':'isofunc-'+model}
def status():return invoke('status','/api/ai/chat?clientRequestId='+prefix+'&workspaceModule=sales',method='GET')
try:
    if case=='ordinary':
        before=fixture_count('isofunc-chat-ok')
        first=invoke('ordinary','/api/ai/chat',payload())
        assert first['status']==200,first
        duplicate=invoke('duplicate','/api/ai/chat',payload())
        assert duplicate['status']==200,duplicate
        assert fixture_count('isofunc-chat-ok')-before==1
        status()
    elif case=='stream':
        r=invoke('stream','/api/ai/chat',payload(message='请分段回复一句话。'),accept='text/event-stream')
        assert r['status']==200 and isinstance(r['body'],str),r
        assert 'data:' in r['body'] and '隔离' in r['body'],r
        deltas=[e for e in r['streamEvents'] if e['line']=='event: delta']
        assert len(deltas)==3 and deltas[-1]['elapsedMs']-deltas[0]['elapsedMs']>=200,deltas
        status()
    elif case=='cancel-before':
        before=fixture_count('isofunc-chat-ok')
        stop=invoke('stop-before','/api/ai/chat/cancel',{'clientRequestId':prefix,'workspaceModule':'sales'})
        r=invoke('post-after-stop','/api/ai/chat',payload())
        assert stop['status']==200 and r['status']==499 and r['body']['code']=='ai_request_cancelled',(stop,r)
        assert fixture_count('isofunc-chat-ok')==before
        status()
    elif case=='cancel-after':
        before=fixture_count('isofunc-chat-delay')
        with concurrent.futures.ThreadPoolExecutor() as pool:
            future=pool.submit(invoke,'delayed-chat','/api/ai/chat',payload('chat-delay'))
            deadline=time.monotonic()+15
            while fixture_count('isofunc-chat-delay')==before and time.monotonic()<deadline:time.sleep(.05)
            assert fixture_count('isofunc-chat-delay')==before+1
            stop=invoke('stop-after-dispatch','/api/ai/chat/cancel',{'clientRequestId':prefix,'workspaceModule':'sales'})
            r=future.result(20)
        assert stop['status']==200,(stop,r)
        invoke('repeat-cancelled','/api/ai/chat',payload('chat-delay'))
        assert fixture_count('isofunc-chat-delay')==before+1
        status()
    elif case=='disconnect':
        before=fixture_count('isofunc-chat-drop')
        first=invoke('truncated-provider','/api/ai/chat',payload('chat-drop'))
        again=invoke('same-id-recovery','/api/ai/chat',payload('chat-drop'))
        status()
        assert first['status']>=400 and again['status']==409,(first,again)
        assert fixture_count('isofunc-chat-drop')==before+1
    elif case=='routing':
        normal=invoke('shop-date-ordinary','/api/ai/chat',payload(message='查2026-11-05京东志高商用设备旗舰店商品日数据，若不支持请报告原因。'))
        assert normal['status']==200,normal
        receipt=m.AiChatRequestReceipts.objects.get(client_request_id=prefix)
        messages=list(m.AiConversationMessages.objects.filter(conversation_id=receipt.conversation_id).values('role','execution_json'))
        assert not any('promotionRequestedScope' in row['execution_json'] for row in messages)
        positive_id=(__import__('sys').argv[3] if len(__import__('sys').argv)>3 else 'web-chat-v1-'+str(int(time.time()*1000))+'-'+str(uuid.uuid4()))
        positive=invoke('explicit-promotion','/api/ai/chat',payload(message='分析志高商用设备旗舰店2026年11月1日至5日的推广效果',client=positive_id))
        routed=m.AiChatRequestReceipts.objects.get(client_request_id=positive_id)
        evidence=list(m.AiConversationMessages.objects.filter(conversation_id=routed.conversation_id).values('role','execution_json'))
        records.append({'label':'promotion-route-db','clientRequestId':positive_id,'messages':evidence})
        assert any('promotionRequestedScope' in row['execution_json'] for row in evidence),positive
        assert positive['status']==200 and positive['body']['execution']['promotionStatus']=='source_unavailable',positive
        assert positive['body']['execution']['toolCalls']==2
    else:raise ValueError(case)
    passed=True
except Exception as error:
    passed=False;records.append({'exceptionType':type(error).__name__,'message':str(error)[:3000]})
finally:
    receipts=list(m.AiChatRequestReceipts.objects.filter(client_request_id=prefix).values())
    safe=[{k:v for k,v in row.items() if 'payload' not in k} for row in receipts]
    result={'case':case,'clientRequestId':prefix,'passed':passed,'records':records,'receipts':safe,'scope':'real signed internal HTTP/private PG/real edge/HTTP supplier fixture; no normal login proof'}
    suffix='-recheck' if len(__import__('sys').argv)>2 else ''
    with (OUT/('CHAT-'+case+'-'+prefix+suffix+'.json')).open('x',encoding='utf8') as f:json.dump(result,f,ensure_ascii=False,indent=2,default=str)
    print(json.dumps({'case':case,'passed':passed,'clientRequestId':prefix}))
if not passed:raise SystemExit(1)
