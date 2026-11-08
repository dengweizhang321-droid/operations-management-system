"""Actual signed HTTP requests from private registered users. Not login proof."""
import hashlib,hmac,json,os,time,urllib.request,urllib.error,urllib.parse,uuid
from ai_functional_environment import environment,network_guard,OUT
private_env=environment();os.environ.clear();os.environ.update(private_env);network_guard()
import django
django.setup()
from access_control.models import AppUser
from sales.auth import Principal
from ai_assistant.transport import signed_headers
from ai_assistant.policy import canonical

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())

def user(name='owner'):
    u=AppUser.objects.get(email=name+'@functional.invalid')
    return Principal(u.email,u.display_name,u.role_id,u.scope)

def call(path,payload=None,*,actor='owner',method='POST',request_id=None,accept=None,port=28447):
    split=urllib.parse.urlsplit(path)
    raw=canonical(payload).encode() if payload is not None else b''
    principal=user(actor)
    headers=signed_headers(split.path,payload or {},principal,request_id or 'http-'+uuid.uuid4().hex)
    headers['X-Teruisi-Content-SHA256']=hashlib.sha256(raw).hexdigest()
    signed='\n'.join(['v1',headers['X-Teruisi-Timestamp'],headers['X-Teruisi-Request-Id'],method,split.path,split.query,headers['X-Teruisi-Content-SHA256'],headers['X-Teruisi-Principal']])
    headers['X-Teruisi-Signature']='v1='+hmac.new(os.environ['TERUISI_DJANGO_INTERNAL_SECRET'].encode(),signed.encode(),hashlib.sha256).hexdigest()
    headers['Content-Type']='application/json'
    if accept:headers['Accept']=accept
    req=urllib.request.Request(f'http://127.0.0.1:{port}'+path,data=raw if method!='GET' else None,headers=headers,method=method)
    try:response=opener.open(req,timeout=45)
    except urllib.error.HTTPError as e:response=e
    events=[]
    if accept=='text/event-stream':
        started=time.monotonic();lines=[]
        while True:
            line=response.readline()
            if not line:break
            lines.append(line)
            if line.startswith(b'data:') or line.startswith(b'event:'):
                events.append({'elapsedMs':round((time.monotonic()-started)*1000,3),'line':line.decode('utf8').strip()})
        data=b''.join(lines).decode('utf8')
    else:data=response.read().decode('utf-8')
    try:parsed=json.loads(data)
    except ValueError:parsed=data
    result={'status':response.status,'body':parsed,'headers':{k:v for k,v in response.headers.items() if k.lower() in ['content-type','x-teruisi-write-replay','x-ai-revision']}}
    if events:result['streamEvents']=events
    return result

def fixture_count(model):
    p=OUT/'provider-requests.jsonl'
    return sum(json.loads(l).get('model')==model for l in p.read_text(encoding='utf8').splitlines()) if p.exists() else 0
