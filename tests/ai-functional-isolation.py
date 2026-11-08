"""Backend identity isolation only; no claim of host-login acceptance."""
import hashlib,json,time,urllib.error,urllib.request
from ai_functional_http import call,user,opener
from ai_functional_environment import OUT
from access_control.models import AppUser
from ai_assistant import models as m,transport

records=[]
def check(label,r,status):
    records.append({'label':label,'result':r});assert r['status']==status,(label,r)
try:
    prior=m.AiMemoryEntries.objects.filter(owner_email='owner@functional.invalid',memory_key='functional-isolation').first()
    saved=(call('/api/ai/memories/'+prior.id,method='GET') if prior else call('/api/ai/memories',{'confirmed':True,'kind':'preference','key':'functional-isolation','content':'优先使用简短的文字说明。'}))
    check('owner-memory-existing-read' if prior else 'owner-memory-save',saved,200 if prior else 201)
    memory_id=saved['body']['item']['id']
    check('owner-memory-read',call('/api/ai/memories/'+memory_id,method='GET'),200)
    check('other-memory-read',call('/api/ai/memories/'+memory_id,method='GET',actor='other'),404)
    check('viewer-memory-write',call('/api/ai/memories',{'confirmed':True,'kind':'preference','key':'viewer-write','content':'简短回答'},actor='viewer'),403)
    check('body-role-no-elevation',call('/api/ai/memories',{'confirmed':True,'kind':'preference','key':'forged-role','content':'简短回答','role':'admin'},actor='viewer'),403)
    conversation=m.AiChatRequestReceipts.objects.filter(owner_email='owner@functional.invalid',status='succeeded').order_by('created_at').first().conversation_id
    check('owner-conversation',call('/api/ai/chat?conversationId='+conversation+'&workspaceModule=sales',method='GET'),200)
    check('other-conversation',call('/api/ai/chat?conversationId='+conversation+'&workspaceModule=sales',method='GET',actor='other'),404)
    for suffix,roles,content in [('admin',['admin'],'合成知识仅管理员可见'),('analyst',['analyst'],'合成知识仅分析员可见')]:
        m.AiKnowledgeEntries.objects.get_or_create(id='isofunc-knowledge-'+suffix,defaults=dict(source_type='system_policy',source_ref='synthetic-'+suffix,title='隔离检索标记',content=content,allowed_roles_json=json.dumps(roles),content_digest=hashlib.sha256(content.encode()).hexdigest()))
    for who,allowed,denied in [('owner','仅管理员','仅分析员'),('other','仅分析员','仅管理员')]:
        r=call('/api/ai/consumer',{'operation':'knowledge','query':'隔离检索标记'},actor=who)
        check(who+'-knowledge-acl',r,200)
        text=json.dumps(r['body'],ensure_ascii=False);assert allowed in text and denied not in text
    principal=user('other')
    result=transport.edge('authorize_background',{'ownerEmail':principal.email,'scopeJson':'null'},principal)
    records.append({'label':'real-background-active','result':result});assert result['ok']
    AppUser.objects.filter(email=principal.email).update(status='disabled')
    try:
        check('disabled-user-read',call('/api/ai/memories',method='GET',actor='other'),403)
        try:
            outcome=transport.edge('authorize_background',{'ownerEmail':principal.email,'scopeJson':'null'},principal)
        except Exception as e:outcome={'code':getattr(e,'code',None),'status':getattr(e,'status',None)}
        records.append({'label':'real-background-disabled','result':outcome})
        assert not outcome.get('ok'),outcome
    finally:AppUser.objects.filter(email=principal.email).update(status='active')
    req=urllib.request.Request('http://127.0.0.1:28447/api/ai/memories')
    try:r=opener.open(req,timeout=5);unsigned=r.status
    except urllib.error.HTTPError as e:unsigned=e.code
    records.append({'label':'unsigned-request','status':unsigned});assert unsigned in (401,403)
    passed=True
except Exception as e:
    passed=False;records.append({'exception':type(e).__name__,'message':str(e)[:3000]})
with (OUT/('ISOLATION-'+str(time.time_ns())+'.json')).open('x',encoding='utf8') as f:json.dump({'passed':passed,'normalLogin':False,'scope':'backend registered-user/HMAC/real access-control and tool bridge only','records':records},f,ensure_ascii=False,indent=2)
print(json.dumps({'passed':passed,'checks':len(records),'normalLogin':False}))
if not passed:raise SystemExit(1)
