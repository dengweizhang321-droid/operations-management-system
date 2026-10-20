"""Real registered model + real Pi + approved direct DingTalk, private DB only."""
import base64
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import uuid
import zipfile
from unittest.mock import patch
from django.test import TransactionTestCase, override_settings
from django.db import close_old_connections
from sales.auth import Principal
from ai_assistant import tests as domain, pi_service as service, pi_worker as worker, provider, transport
from ai_assistant import pi_business as business, pi_business_report as report, dingtalk_transport, pi_workspace, dingtalk
from ai_assistant.pi_models import PiOperation, PiFile, PiDispatch, PiEvent, PiBusinessAction, PiBusinessAudit
from ai_assistant.test_pi_real_stack import PiRealStackTests
from ai_assistant.policy import canonical

LIVE = json.load(sys.stdin)
ROOT = Path(os.environ['PI_LIVE_ROOT'])
OUT = Path(os.environ.get('PI_LIVE_EVIDENCE_DIRECTORY',str(ROOT/'docs/pi-unified-chat-20261020/live-evidence')))
OUT.mkdir(parents=True, exist_ok=True)
RAWOUT=Path(os.environ.get('PI_LIVE_RAW_DIRECTORY',str(OUT)))
RAWOUT.mkdir(parents=True,exist_ok=True)


@override_settings(DJANGO_PROCESS_ROLE='development', DJANGO_ENVIRONMENT='test')
class LiveAcceptance(TransactionTestCase):
    setUp = domain.AiDomainTests.setUp
    user = domain.AiDomainTests.user
    _fixture_teardown = PiRealStackTests._fixture_teardown

    def test_real_model_files_and_direct_report_delivery(self):
        self.actor = Principal(LIVE['actor']['email'], LIVE['actor']['displayName'], LIVE['actor']['role'], None)
        for name, value in LIVE['configuration'].items():
            setattr(self.model,name,value)
        self.model.api_key_encrypted='live-credential-in-memory-only'
        self.model.save()
        self.operations=[]
        evidence={'realProvider':True,'realPi':True,'privatePostgres':True,'productionLifecycleChanged':False,
            'recipient':'current principal unique approved direct binding','robotName':LIVE['config']['robotName'],
            'selectedModelId':LIVE.get('selectedModelId'),'modelName':self.model.model_name,'modelVersion':self.model.version,'rounds':[],'deliveries':[],
            'sourceCommit':LIVE.get('sourceCommit'),'worktreeDirtyFixture':True,
            'modelRuntimeConfiguration':{k:LIVE['configuration'][k] for k in ['max_tokens','timeout_ms','reasoning_mode','generation_options_json']}}
        def save():
            (OUT/'results.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2),encoding='utf8')
        def dispatches(operation):
            rows=[]
            for row in PiDispatch.objects.filter(operation=operation).order_by('created_at'):
                value={'id':row.id,'kind':row.kind,'status':row.status,'errorCode':row.error_code}
                response=json.loads(row.response_json)
                diagnostics=response.get('responseDiagnostics',{})
                if diagnostics:
                    value['responseDiagnostics']={k:v for k,v in diagnostics.items() if k in {
                        'adapterVersion','stage','reason','protocol','responseMode','httpStatus','requestStarted',
                        'resolverPhase','finishReason','hasReasoning','completionUnits','outputUnits','sqlState','cleanupComplete'}
                        and (v is None or type(v) in (str,int,bool))}
                if row.kind=='tool':
                    details=response.get('details',{})
                    if isinstance(details,dict):
                        if type(details.get('ok')) is bool:value['toolOk']=details['ok']
                        error=details.get('error')
                        if isinstance(error,dict) and isinstance(error.get('code'),str):value['toolErrorCode']=error['code']
                rows.append(value)
            return rows
        def effects(sid):
            actions=PiBusinessAction.objects.filter(session_id=sid)
            return {'source':'live private ORM counts before test database destruction',
                'actions':actions.count(),
                'bodyDispatches':PiBusinessAudit.objects.filter(action__session_id=sid,event_type='report_delivery_body_dispatch').count(),
                'attachmentDispatches':PiBusinessAudit.objects.filter(action__session_id=sid,event_type='report_delivery_attachment_dispatch').count()}
        def edge(action, payload, principal, **kwargs):
            # Exact production registry bytes are loaded by Node from this candidate.
            # No synthetic tool result is returned and no business execute is allowed.
            if action=='catalog':return {'entries':[x for x in LIVE['catalog'] if payload['surface'] in x['execution']['allowedSurfaces']]}
            if action=='authorize_background':
                import urllib.request
                current=json.load(urllib.request.urlopen('http://localhost:3000/api/auth/me'))['user']
                self.assertEqual((current['email'],current['role'],current['scopeRestricted']), (self.actor.email,self.actor.role,False))
                return {'ok':True,'principal':{'email':self.actor.email,'role':self.actor.role,'scope':None}}
            raise AssertionError('unapproved edge operation '+action)
        spec=importlib.util.spec_from_file_location('private_live_inputs',ROOT/'tests/pi-live-acceptance-secrets.py')
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        def effective_config():
            from ai_assistant.dingtalk_bot_credentials import checked_path
            checked_path(str(module.RUNTIME/'config/dingtalk-ask.json'))
            current=module.current_policy(LIVE['policyReaderPassword'])
            dingtalk.validate_config(current['config'])
            if not current['config']['enabled']:
                from ai_assistant.policy import AiError
                raise AiError('企业机器人尚未启用','report_channel_unavailable',409)
            self.assertEqual(current['actor']['email'],self.actor.email)
            self.assertEqual(current['config']['robotName'],LIVE['config']['robotName'])
            return current['config']
        def run(sid, message, delivery=False, file_ids=None):
            payload={'clientRequestId':'live-'+uuid.uuid4().hex,'message':message,'modelId':self.model.id,'skillIds':[] if LIVE.get('workspaceStaging') else ['excel-report']}
            if file_ids:payload['fileIds']=file_ids
            if delivery:payload['businessExecution']={'allowedActions':['deliver_report']}
            admitted=service.prompt(sid,payload,self.actor)
            operation=worker.claim();self.assertEqual(operation.id,admitted['operation']['id']);self.operations.append(operation)
            worker.perform(operation);operation.refresh_from_db()
            summary={'operationId':operation.id,'status':operation.status,'errorCode':operation.error_code,
                'createdAt':operation.created_at.isoformat(),'updatedAt':operation.updated_at.isoformat(),
                'dispatches':dispatches(operation),
                'usage':list(PiDispatch.objects.filter(operation=operation,kind='model').values_list('usage_json',flat=True))}
            summary['toolEvents']=[]
            for event in PiEvent.objects.filter(operation=operation,event_type__in=['tool_execution_start','tool_execution_end']).order_by('event_seq'):
                data=json.loads(event.data_json)
                args=data.get('args',{})
                name=args.get('name') if isinstance(args,dict) else None
                summary['toolEvents'].append({'eventSeq':event.event_seq,'type':event.event_type,
                    'toolName':name if name in {'get_pi_business_options','prepare_pi_report_delivery','get_pi_business_action'} else data.get('toolName')})
            evidence['effects']=effects(sid)
            evidence['rounds'].append(summary);save();print(canonical(summary),flush=True)
            self.assertEqual(operation.status,'succeeded',operation.error_code)
            return operation
        actual_send=dingtalk_transport.send
        actual_media=dingtalk_transport.send_media
        def bound_sender(config):
            matches=[b for b in config['bindings'] if b['ownerEmail']==self.actor.email and b['role']==self.actor.role and b['scope'] is None]
            self.assertEqual(len(matches),1)
            return matches[0]['senderId']
        def send(config_reader, session, *args, **kwargs):
            self.assertEqual(session.conversation_type,'1');self.assertTrue(session.sender_id==bound_sender(LIVE['config']), 'direct recipient binding mismatch')
            return actual_send(config_reader,session,*args,**kwargs)
        def send_media(config_reader, session, *args, **kwargs):
            self.assertEqual(session.conversation_type,'1');self.assertTrue(session.sender_id==bound_sender(LIVE['config']), 'direct recipient binding mismatch')
            return actual_media(config_reader,session,*args,**kwargs)
        sid=None
        try:
            with patch.object(provider,'decrypt',return_value=LIVE['apiKey']),patch.object(transport,'edge',side_effect=edge),patch.object(report,'_config',side_effect=effective_config),patch.object(dingtalk_transport,'send',side_effect=send),patch.object(dingtalk_transport,'send_media',side_effect=send_media):
                sid=service.create_session({'clientRequestId':'live-private-'+uuid.uuid4().hex,'title':'LIVE ACCEPTANCE synthetic files and direct receipt'},self.actor)['session']['id']
                evidence['sessionId']=sid;save()
                if LIVE.get('workspaceStaging'):
                    source=Path('D:/codex-artifacts/pi-unified-chat-20261020/live')
                    manifest=json.loads((source/'MANIFEST.json').read_text())
                    controls=[]
                    def control(command,payload):
                        reply=pi_workspace.control(sid,{'clientRequestId':'live-stage-'+uuid.uuid4().hex,'command':command,'payload':payload},self.actor)
                        receipt=reply['control']
                        while receipt['status'] in {'prepared','queued','sent','accepted'}:
                            import time
                            time.sleep(.5)
                            receipt=next(c for c in pi_workspace.detail(sid,{},self.actor)['controls'] if c['id']==receipt['id'])
                        self.assertIn(receipt['status'],{'completed','handled'})
                        controls.append({k:receipt[k] for k in ['id','command','status']})
                        evidence['stagingControls']=controls;save()
                    control('model_set',{'modelId':self.model.id})
                    for extension in ('xlsx','pdf'):
                        name='live-acceptance-synthetic.'+extension;raw=(source/name).read_bytes()
                        sha=hashlib.sha256(raw).hexdigest()
                        self.assertEqual(sha,next(x['sha256'] for x in manifest if x['path']==name))
                        control('file_write',{'path':'outputs/'+name,'base64':base64.b64encode(raw).decode(),'expectedSha256':None})
                        control('file_download',{'path':'outputs/'+name,'expectedSha256':sha})
                    evidence['reusedRealModelGeneratedSyntheticFiles']=True
                    evidence['independentPurpose']='new candidate acceptance of existing synthetic attachment delivery; no old unknown prompt is replayed';save()
                elif LIVE.get('reuseGenerated'):
                    # Previous attempt completed real model generation and a
                    # preview, then failed in this test's preview projection
                    # before confirm. No body/media dispatch was admitted.
                    file_ids=[]
                    for extension in ('xlsx','pdf'):
                        name='live-acceptance-synthetic.'+extension
                        source=Path(os.environ.get('PI_LIVE_SYNTHETIC_DIRECTORY','D:/codex-artifacts/pi-unified-chat-20261020/live'))
                        raw=(source/name).read_bytes()
                        uploaded=service.upload(sid,{'clientRequestId':'live-input-'+extension,'fileName':name,
                            'mimeType':'application/pdf' if extension=='pdf' else 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                            'base64':base64.b64encode(raw).decode()},self.actor)
                        file_ids.append(uploaded['file']['id'])
                    evidence['reusedRealModelGeneratedSyntheticFiles']=True
                    run(sid,'LIVE ACCEPTANCE: the two supplied input files were already generated by the real model and independently validated in the previous acceptance attempt. Use one bash command to copy both from their /workspace/inputs paths into /workspace/outputs preserving exact file names and bytes. Verify sha256 and sizes, then finish in Chinese. Do not regenerate, install packages, query business data, or send any messages.',file_ids=file_ids)
                else:
                    run(sid,'LIVE ACCEPTANCE authorised synthetic test. Do not query business data or send any messages. Actually use local bash tools to create TWO valid files under /workspace/outputs: live-acceptance-synthetic.xlsx and live-acceptance-synthetic.pdf. Content is only "Synthetic acceptance test 2026-10-20; no business/customer data; metric A=1". Use the installed excel-report skill script for XLSX and installed PDF library or valid minimal PDF syntax. Validate both files locally. Do not install packages. Finish in Chinese with file names and byte counts.')
                outputs=list(PiFile.objects.filter(session_id=sid,direction='output'))
                files={'live-acceptance-synthetic.'+ext:next(f for f in outputs if f.file_name.endswith('live-acceptance-synthetic.'+ext)) for ext in ('xlsx','pdf')}
                for extension in ('xlsx','pdf'):
                    name='live-acceptance-synthetic.'+extension
                    self.assertIn(name,files)
                    raw=base64.b64decode(service.download(files[name].id,self.actor,content=True)['base64'])
                    self.assertEqual(hashlib.sha256(raw).hexdigest(),files[name].sha256)
                    if extension=='xlsx':
                        with zipfile.ZipFile(io.BytesIO(raw)) as z:self.assertIsNone(z.testzip())
                    else:self.assertTrue(raw.startswith(b'%PDF-'));self.assertIn(b'%%EOF',raw[-200:])
                    (RAWOUT/name).write_bytes(raw)
                for extension in ('xlsx','pdf'):
                    caption='[LIVE ACCEPTANCE '+LIVE.get('captionLabel','CANDIDATE')+' 20261021 '+extension.upper()+'] Synthetic test only. No business/customer data. Reply not required.'
                    filename=files['live-acceptance-synthetic.'+extension].file_name
                    run(sid,'Authorised independent existing synthetic report-delivery acceptance. Do not copy or generate files. Call get_pi_business_options first to discover the current intent, collected files and recipients. Only after its actual return, select the unique recipientType=direct for the current account (never group), and exact fileName='+filename+'. Never guess fileId/recipientId/userIntentId. Then call prepare_pi_report_delivery with the discovered IDs and caption exactly '+json.dumps(caption)+'. Stop after concrete preview; do not send or create a second action. Respond in Chinese.',True)
                    action=PiBusinessAction.objects.get(parent_operation=self.operations[-1],action_type='deliver_report')
                    self.assertEqual(action.status,'prepared')
                    preview=json.loads(action.preview_json)['details']
                    self.assertEqual(preview['recipient']['recipientType'],'direct')
                    self.assertEqual(preview['body'],caption)
                    expected_file=files['live-acceptance-synthetic.'+extension]
                    self.assertEqual(preview['attachment']['fileId'],expected_file.id)
                    self.assertEqual(preview['attachment']['sha256'],expected_file.sha256)
                    # User authorised real synthetic direct delivery. Confirm this
                    # exact reviewed preview through the unchanged business API.
                    response=business.control(sid,{'command':'confirm','clientRequestId':'live-confirm-'+uuid.uuid4().hex,
                        'actionId':action.id,'expectedVersion':action.version,'previewDigest':action.preview_digest},self.actor)
                    self.assertEqual(response['action']['status'],'queued')
                    claimed=business.claim();self.assertEqual(claimed.id,action.id);business.perform(claimed)
                    action.refresh_from_db();receipt=json.loads(action.result_json)
                    evidence['deliveries'].append({'actionId':action.id,'status':action.status,'errorCode':action.error_code,
                        'extension':extension,'previewDigest':action.preview_digest,'attachmentSha256':preview['attachment']['sha256'],
                        'result':receipt});save();print(canonical(evidence['deliveries'][-1]),flush=True)
                    self.assertEqual(action.status,'succeeded',action.error_code)
                    self.assertEqual(receipt['receipt']['state'],'accepted_by_platform')
                evidence['status']='passed';save()
        finally:
            close_old_connections()
            cleanup_operations=list(PiOperation.objects.filter(session_id=sid).order_by('-seq')) if sid else []
            for operation in cleanup_operations:
                try:worker.dispose_environment(operation)
                except Exception:pass
            if sid:
                evidence['effects']=effects(sid)
                evidence['finalOperations']=[{'operationId':op.id,'status':op.status,'errorCode':op.error_code,
                    'dispatches':dispatches(op)} for op in PiOperation.objects.filter(session_id=sid).order_by('seq')]
            save()
