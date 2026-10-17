"""Standalone HMAC client. Exactly one HTTP attempt, redirects/proxy disabled."""
import hashlib
import hmac
import time
import urllib.error
import urllib.request
import uuid

from .protocol import MAX_RESPONSE, PATH, decode, encode, signature


def command(url,key,value,timeout=45,path=PATH):
    raw=encode(value);stamp=str(int(time.time()));nonce=uuid.uuid4().hex
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*_):raise ValueError('runner_redirect_forbidden')
    request=urllib.request.Request(url+path,data=raw,method='POST',headers={
        'Content-Type':'application/json','X-Timestamp':stamp,'X-Nonce':nonce,'X-Signature':signature(key,stamp,nonce,raw,path=path)})
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
    try:response=opener.open(request,timeout=timeout)
    except urllib.error.HTTPError as error:response=error
    with response:
        body=response.read(MAX_RESPONSE+1)
        if len(body)>MAX_RESPONSE or not hmac.compare_digest(response.headers.get('X-Signature',''),signature(key,stamp,nonce,body,direction='response',path=path)):
            raise ValueError('invalid_runner_response')
        result=decode(body)
        if response.status!=200:raise ValueError(result.get('error','runner_failed_closed'))
        return result
