"""Explicitly authorised synthetic acceptance through the actual public Pi API.

No credentials, production DB connection, service lifecycle or retries. Each
mutation is issued once; unknown results retain their original identities.
"""
import argparse
import base64
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import time
import urllib.error
import urllib.request
import uuid


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--authorized-live-acceptance',action='store_true')
    parser.add_argument('--model-id',default='ai-model-35ca8a89-01d4-4693-b649-04b84ed69389')
    parser.add_argument('--evidence-name',default='public-copy')
    parser.add_argument('--workspace-staging',action='store_true')
    args=parser.parse_args()
    if not args.authorized_live_acceptance:
        raise SystemExit('Requires current explicit authorisation for real model and current-principal synthetic direct delivery')
    root=Path(__file__).resolve().parents[1]
    assert re.fullmatch(r'[a-z0-9-]{1,70}',args.evidence_name)
    out=root/'docs/pi-unified-chat-20261020/live-evidence/resume-20261021'/args.evidence_name
    rawout=Path('D:/codex-artifacts/pi-unified-chat-20261020/live/resume-20261021')/args.evidence_name
    out.mkdir(parents=True,exist_ok=True);rawout.mkdir(parents=True,exist_ok=True)
    assert not (out/'public-results.json').exists(), 'Evidence already exists; never overwrite an original attempt'
    source=rawout.parent.parent
    base='http://localhost:3000'
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
    evidence={'startedAt':datetime.now(timezone.utc).isoformat(),'route':'actual public HTTP Pi API',
        'newPrivatePostgresStarted':False,'newPrivateRunnerStarted':False,'rounds':[],'deliveries':[],
        'mutations':[],'status':'running','businessAndCustomerDataQueried':False}
    def save():
        (out/'public-results.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2),encoding='utf8')
        (rawout/'public-results.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2),encoding='utf8')
    def req(path,body=None):
        if body is not None:
            evidence['mutations'].append({'path':path,'clientRequestId':body.get('clientRequestId'),'issuedAt':datetime.now(timezone.utc).isoformat()});save()
        request=urllib.request.Request(base+path,data=json.dumps(body,ensure_ascii=False).encode() if body is not None else None,
            headers={'Content-Type':'application/json','Origin':base})
        try:
            with opener.open(request,timeout=45) as response:
                data=response.read(4*1024*1024+1)
                if len(data)>4*1024*1024:raise RuntimeError('bounded public response exceeded')
                return json.loads(data)
        except urllib.error.HTTPError as error:
            value=json.loads(error.read(20000))
            raise RuntimeError('public API refused '+str(error.code)+' '+str(value.get('code',''))) from None
    def key(prefix):return prefix+'-'+uuid.uuid4().hex
    sid=None
    def stopped():
        if (out/'REQUEST-STOP').exists():raise RuntimeError('user requested stop; no new action')
    def wait_operation(opid):
        abort_sent=False
        while True:
            if (out/'REQUEST-STOP').exists() and not abort_sent:
                req('/api/ai/pi/sessions/'+sid+'/abort',{'clientRequestId':key('user-stop')});abort_sent=True
            detail=req('/api/ai/pi/sessions/'+sid)
            operation=next(x for x in detail['operations'] if x['id']==opid)
            if operation['status'] in {'succeeded','failed','canceled','unknown','frozen'}:
                evidence['rounds'].append(operation);save()
                print(json.dumps({'phase':'model-round','operationId':opid,'status':operation['status'],'errorCode':operation.get('errorCode')},ensure_ascii=False),flush=True)
                if operation['status']!='succeeded':raise RuntimeError('original model operation '+operation['status']+' '+operation.get('errorCode',''))
                return detail
            time.sleep(3)
    def run(message,*,file_ids=None,delivery=False):
        stopped()
        payload={'clientRequestId':key('live-resume'),'message':message,'modelId':model['id'],'skillIds':[],
            **({'fileIds':file_ids} if file_ids else {}),
            **({'businessExecution':{'allowedActions':['deliver_report']}} if delivery else {})}
        value=req('/api/ai/pi/sessions/'+sid+'/messages',payload)
        return wait_operation(value['operation']['id'])
    def control(command,payload):
        stopped()
        reply=req('/api/ai/pi/sessions/'+sid+'/workspace',{'clientRequestId':key('live-workspace'),'command':command,'payload':payload})
        receipt=reply['control']
        while receipt['status'] in {'prepared','sent','accepted','queued'}:
            time.sleep(2)
            snapshot=req('/api/ai/pi/sessions/'+sid+'/workspace')
            receipt=next(x for x in snapshot['controls'] if x['id']==receipt['id'])
        assert receipt['status'] in {'completed','handled'}, 'original workspace control did not complete'
        evidence.setdefault('stagingControls',[]).append({k:receipt.get(k) for k in ('id','command','status','errorCode')});save()
        return receipt
    try:
        actor=req('/api/auth/me')['user']
        assert actor['role']=='admin' and actor['scopeRestricted'] is False
        models=req('/api/ai/models')['items']
        model=next(x for x in models if x['id']==args.model_id and x['status']=='enabled')
        evidence['modelConfiguration']={k:model.get(k) for k in ('id','name','modelName','protocol','version','maxTokens','timeoutMs','reasoningMode','generationOptions')}
        evidence['actor']={'role':actor['role'],'scopeRestricted':actor['scopeRestricted'],'currentAccountUsed':True}
        sid=req('/api/ai/pi/sessions',{'clientRequestId':key('live-resume-session'),'title':'LIVE ACCEPTANCE 20261021 existing synthetic attachment delivery'})['session']['id']
        evidence['sessionId']=sid;save()
        directory=req('/api/ai/pi/sessions/'+sid+'/business-actions?recipients=true')['recipients']
        direct=[x for x in directory if x['recipientType']=='direct']
        assert len(direct)==1 and direct[0]['recipientName']==actor['displayName']
        target=direct[0];evidence['directTarget']={k:target[k] for k in ('recipientId','recipientType','robotName','policyVersion')};save()
        inputs=[];assets={}
        if args.workspace_staging:
            evidence['independentPurpose']='deliver existing validated synthetic attachments; does not repeat the prior OpenCode copy prompt'
            evidence['linkedUnknownOperation']='pi-op-b59d4836-4b87-4990-84e8-c82fa6ff3c02'
            evidence['originalUnknownRetainedAndDisposed']=True
            control('model_set',{'modelId':model['id']})
        for extension in ('xlsx','pdf'):
            name='live-acceptance-synthetic.'+extension
            raw=(source/name).read_bytes();assets[name]=hashlib.sha256(raw).hexdigest()
            original_manifest=json.loads((source/'MANIFEST.json').read_text(encoding='utf8'))
            assert assets[name]==next(x['sha256'] for x in original_manifest if x['path']==name), 'preserved synthetic attachment digest changed'
            if args.workspace_staging:
                path='outputs/'+name
                control('file_write',{'path':path,'base64':base64.b64encode(raw).decode(),'expectedSha256':None})
                control('file_download',{'path':path,'expectedSha256':assets[name]})
            else:
                value=req('/api/ai/pi/sessions/'+sid+'/files',{'clientRequestId':key('live-upload'),'fileName':name,
                    'mimeType':'application/pdf' if extension=='pdf' else 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    'base64':base64.b64encode(raw).decode()})
                inputs.append(value['file']['id'])
        if args.workspace_staging:
            detail=req('/api/ai/pi/sessions/'+sid)
        else:
            detail=run('LIVE ACCEPTANCE: use only the TWO supplied synthetic input files. Do not read any business system data, install dependencies, or send messages. Execute ONE bash command to copy the two supplied paths into /workspace/outputs with the same names live-acceptance-synthetic.xlsx and live-acceptance-synthetic.pdf, then print their sha256 hashes. Do not regenerate or inspect other files. Finish in Chinese.',file_ids=inputs)
        files={name:next(x for x in detail['files'] if x['direction']=='output' and x['sha256']==sha and x['fileName'].endswith(name)) for name,sha in assets.items()}
        evidence['collectedFiles']=[{k:files[name][k] for k in ('id','fileName','sizeBytes','sha256','direction')} for name in assets];save()
        for extension in ('xlsx','pdf'):
            caption='[LIVE ACCEPTANCE 20261021 '+extension.upper()+'] Synthetic test only. No business/customer data. Reply not required.'
            filename=files['live-acceptance-synthetic.'+extension]['fileName']
            detail=run('Authorised independent synthetic report-delivery acceptance. The existing file is already collected in this environment; do not create or copy files. First call get_pi_business_options. Select ONLY the unique recipientType=direct for the current account, never a group. Choose the exact discovered fileName='+filename+' (SHA256 '+assets['live-acceptance-synthetic.'+extension]+'). Call prepare_pi_report_delivery once using the discovered userIntentId/fileId/recipientId and caption exactly '+json.dumps(caption)+'. Stop after this concrete preview; do not send. Do not query business data or execute local tools. Reply in Chinese.',delivery=True)
            parent=evidence['rounds'][-1]['id']
            listing=req('/api/ai/pi/sessions/'+sid+'/business-actions')
            actions=[x for x in listing['items'] if x['parentOperationId']==parent and x['actionType']=='deliver_report']
            assert len(actions)==1
            action=actions[0];preview=action['preview']['details']
            assert action['status']=='prepared' and preview['recipient']['recipientType']=='direct'
            assert preview['recipient']['recipientId']==target['recipientId'] and preview['body']==caption
            assert preview['attachment']['sha256']==assets['live-acceptance-synthetic.'+extension]
            delivery={'extension':extension,'actionId':action['actionId'],'parentOperationId':parent,
                'previewDigest':action['previewDigest'],'targetVersion':action['targetVersion'],
                'recipientType':'direct','attachmentSha256':preview['attachment']['sha256'],'caption':caption,'status':'prepared'}
            evidence['deliveries'].append(delivery);save();stopped()
            req('/api/ai/pi/sessions/'+sid+'/business-actions',{'command':'confirm','clientRequestId':key('live-confirm'),
                'actionId':action['actionId'],'expectedVersion':action['version'],'previewDigest':action['previewDigest']})
            while True:
                listing=req('/api/ai/pi/sessions/'+sid+'/business-actions')
                current=next(x for x in listing['items'] if x['actionId']==action['actionId'])
                if current['status'] in {'succeeded','failed','canceled','unknown'}:
                    delivery.update(status=current['status'],errorCode=current['errorCode'],result=current['result']);save()
                    print(json.dumps({'phase':'delivery','extension':extension,'status':current['status'],'result':current['result']},ensure_ascii=False),flush=True)
                    assert current['status']=='succeeded' and current['result']['receipt']['state']=='accepted_by_platform'
                    break
                time.sleep(3)
        workspace=req('/api/ai/pi/sessions/'+sid+'/workspace')
        evidence['usage']=workspace['workspace'].get('usage')
        evidence['status']='passed';save()
    except Exception as error:
        evidence['status']='incomplete';evidence['failureType']=type(error).__name__
        evidence['failure']=str(error)[:300];save();raise
    finally:
        if sid:
            try:
                # Only the newly created acceptance environment is paused. The
                # shared formal Runner/service and retained unknowns are untouched.
                result=req('/api/ai/pi/sessions/'+sid+'/workspace',{'clientRequestId':key('live-cleanup'),'command':'pause','payload':{}})
                control=result.get('control',{})
                evidence['cleanup']={'newPrivatePostgresStarted':False,'newPrivateRunnerStarted':False,
                    'publicPauseControl':{k:control.get(k) for k in ('id','status','command','errorCode','result')}}
            except Exception as error:evidence['cleanup']={'status':'unconfirmed','failureType':type(error).__name__,'failure':str(error)[:200]}
        evidence['finishedAt']=datetime.now(timezone.utc).isoformat();save()


if __name__=='__main__':main()
