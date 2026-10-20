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
from ai_assistant import pi_business as business, pi_business_report as report, dingtalk_transport
from ai_assistant.pi_models import PiOperation, PiFile, PiDispatch, PiEvent, PiBusinessAction
from ai_assistant.test_pi_real_stack import PiRealStackTests
from ai_assistant.policy import canonical

LIVE = json.load(sys.stdin)
ROOT = Path(os.environ['PI_LIVE_ROOT'])
OUT = ROOT/'docs/pi-unified-chat-20261020/live-evidence'
OUT.mkdir(parents=True, exist_ok=True)


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
            'modelName':self.model.model_name,'modelVersion':self.model.version,'rounds':[],'deliveries':[]}
        def save():
            (OUT/'results.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2),encoding='utf8')
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
            current=module.inputs()
            self.assertEqual(current['actor']['email'],self.actor.email)
            self.assertEqual(current['config']['robotName'],LIVE['config']['robotName'])
            return current['config']
        def run(sid, message, delivery=False, file_ids=None):
            payload={'clientRequestId':'live-'+uuid.uuid4().hex,'message':message,'modelId':self.model.id,'skillIds':['excel-report']}
            if file_ids:payload['fileIds']=file_ids
            if delivery:payload['businessExecution']={'allowedActions':['deliver_report']}
            admitted=service.prompt(sid,payload,self.actor)
            operation=worker.claim();self.assertEqual(operation.id,admitted['operation']['id']);self.operations.append(operation)
            worker.perform(operation);operation.refresh_from_db()
            summary={'operationId':operation.id,'status':operation.status,'errorCode':operation.error_code,
                'dispatches':list(PiDispatch.objects.filter(operation=operation).values('kind','status','error_code')),
                'usage':list(PiDispatch.objects.filter(operation=operation,kind='model').values_list('usage_json',flat=True))}
            evidence['rounds'].append(summary);save();print(canonical(summary),flush=True)
            self.assertEqual(operation.status,'succeeded',operation.error_code)
            return operation
        actual_send=dingtalk_transport.send
        actual_media=dingtalk_transport.send_media
        def send(config_reader, session, *args, **kwargs):
            self.assertEqual(session.conversation_type,'1');self.assertTrue(session.sender_id==LIVE['config']['bindings'][0]['senderId'], 'direct recipient binding mismatch')
            return actual_send(config_reader,session,*args,**kwargs)
        def send_media(config_reader, session, *args, **kwargs):
            self.assertEqual(session.conversation_type,'1');self.assertTrue(session.sender_id==LIVE['config']['bindings'][0]['senderId'], 'direct recipient binding mismatch')
            return actual_media(config_reader,session,*args,**kwargs)
        try:
            with patch.object(provider,'decrypt',return_value=LIVE['apiKey']),patch.object(transport,'edge',side_effect=edge),patch.object(report,'_config',side_effect=effective_config),patch.object(dingtalk_transport,'send',side_effect=send),patch.object(dingtalk_transport,'send_media',side_effect=send_media):
                sid=service.create_session({'clientRequestId':'live-private-'+uuid.uuid4().hex,'title':'LIVE ACCEPTANCE synthetic files and direct receipt'},self.actor)['session']['id']
                evidence['sessionId']=sid;save()
                if LIVE.get('reuseGenerated'):
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
                files={f.file_name:f for f in PiFile.objects.filter(session_id=sid,direction='output')}
                for extension in ('xlsx','pdf'):
                    name='live-acceptance-synthetic.'+extension
                    self.assertIn(name,files)
                    raw=base64.b64decode(service.download(files[name].id,self.actor,content=True)['base64'])
                    self.assertEqual(hashlib.sha256(raw).hexdigest(),files[name].sha256)
                    if extension=='xlsx':
                        with zipfile.ZipFile(io.BytesIO(raw)) as z:self.assertIsNone(z.testzip())
                    else:self.assertTrue(raw.startswith(b'%PDF-'));self.assertIn(b'%%EOF',raw[-200:])
                    (OUT/name).write_bytes(raw)
                for extension in ('xlsx','pdf'):
                    caption='[LIVE ACCEPTANCE 20261020 '+extension.upper()+'] Synthetic test only. No business/customer data. Reply not required.'
                    run(sid,'Authorised report-delivery acceptance. Call get_pi_business_options to discover the current intent, collected files and recipients. Select ONLY the unique recipientType=direct for the current account (never group), and fileName=live-acceptance-synthetic.'+extension+'. Call prepare_pi_report_delivery with the server userIntentId, exact discovered fileId and recipientId, caption exactly '+json.dumps(caption)+'. Stop after concrete preview; do not send or create a second action. Respond in Chinese.',True)
                    action=PiBusinessAction.objects.get(parent_operation=self.operations[-1],action_type='deliver_report')
                    self.assertEqual(action.status,'prepared')
                    preview=json.loads(action.preview_json)['details']
                    self.assertEqual(preview['recipient']['recipientType'],'direct')
                    self.assertEqual(preview['body'],caption)
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
            for operation in self.operations:
                try:worker.dispose_environment(operation)
                except Exception:pass
            save()
