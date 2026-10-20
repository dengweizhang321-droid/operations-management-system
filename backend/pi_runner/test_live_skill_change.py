"""Focused stale-reader and real, non-provider skill-change counterexamples."""
import io
import json
import os
from pathlib import Path
import re
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch
import uuid

from .server import Broker, Session
from .protocol import decode, encode


class ReaderGenerationTests(unittest.TestCase):
    def test_delayed_old_skill_frame_cannot_replace_new_catalog(self):
        entered,release=threading.Event(),threading.Event()
        record={'type':'extension_ui_request','method':'setStatus','statusKey':'pi-skills-v1',
            'statusText':json.dumps({'selected':[{'name':'old'}]})}
        class Delayed:
            used=False
            def readline(self,limit):
                if self.used:return b''
                self.used=True;entered.set();release.wait(2);return encode(record)+b'\n'
            def close(self):pass
        broker=SimpleNamespace(image='sha256:'+'a'*64,save_session=MagicMock())
        identity={'operationId':'old','ownerId':'synthetic@example.invalid','conversationId':'reader',
            'epoch':1,'generation':1,'seq':1}
        session=Session(broker,identity,'private-container','private-volume',[])
        old=SimpleNamespace(stdout=Delayed());session.proc=old;session.phase='idle'
        with patch('pi_runner.workspace.value_set'):
            thread=threading.Thread(target=session.read);thread.start()
            self.assertTrue(entered.wait(1))
            session.proc=SimpleNamespace(stdout=io.BytesIO())
            session.skills_catalog={'selected':[{'name':'new'}]}
            release.set();thread.join(2);self.assertFalse(thread.is_alive())
        self.assertEqual(session.skills_catalog,{'selected':[{'name':'new'}]})
        self.assertEqual(session.phase,'idle')

    def test_user_new_model_without_supported_old_level_still_requires_explicit_change(self):
        broker=SimpleNamespace(image='sha256:'+'a'*64,gateway_url='http://127.0.0.1:8112/api/ai/pi/gateway')
        identity={'operationId':'current','ownerId':'synthetic@example.invalid','conversationId':'thinking',
            'epoch':1,'generation':1,'seq':1}
        session=Session(broker,identity,'private-container','private-volume',[])
        session.pi_state={'thinkingLevel':'off'}
        session.effective_model={'contextWindow':1000,'maxTokens':100,'reasoning':True}
        session.model=dict(session.effective_model)
        session.rpc=MagicMock()
        with patch('pi_runner.admission.check',return_value={}):
            with self.assertRaisesRegex(ValueError,'thinking_level_requires_explicit_change'):
                session.bind({'url':broker.gateway_url,'capability':'synthetic-capability-only'},
                    {'contextWindow':1000,'maxTokens':100,'reasoning':True,'supportedThinkingLevels':['high']})
        session.rpc.assert_not_called()

    def test_old_frame_delayed_inside_decode_cannot_apply_after_process_replacement(self):
        for malformed in (False,True):
            with self.subTest(malformed=malformed):
                entered,release=threading.Event(),threading.Event()
                record={'type':'extension_ui_request','method':'setStatus','statusKey':'pi-skills-v1',
                    'statusText':json.dumps({'selected':[{'name':'old'}]})}
                raw=encode(record)+b'\n'
                broker=SimpleNamespace(image='sha256:'+'a'*64,save_session=MagicMock())
                identity={'operationId':'old','ownerId':'synthetic@example.invalid','conversationId':'decoded',
                    'epoch':1,'generation':1,'seq':1}
                session=Session(broker,identity,'private-container','private-volume',[])
                old=SimpleNamespace(stdout=io.BytesIO(raw));session.proc=old;session.phase='idle'
                def delayed(value):
                    entered.set();release.wait(2)
                    if malformed:raise ValueError('synthetic_bad_old_record')
                    return decode(value)
                with patch('pi_runner.server.decode',side_effect=delayed),patch('pi_runner.workspace.value_set'):
                    thread=threading.Thread(target=session.read,args=(old,));thread.start()
                    self.assertTrue(entered.wait(1))
                    with session.lock:
                        session.proc=SimpleNamespace(stdout=io.BytesIO())
                        session.skills_catalog={'selected':[{'name':'new'}]}
                    release.set();thread.join(2);self.assertFalse(thread.is_alive())
                self.assertEqual(session.skills_catalog,{'selected':[{'name':'new'}]})
                self.assertEqual(session.phase,'idle');broker.save_session.assert_not_called()

    def test_delayed_gateway_frame_cannot_revoke_or_write_to_new_process(self):
        broker=SimpleNamespace(image='sha256:'+'a'*64,save_session=MagicMock())
        identity={'operationId':'old','ownerId':'synthetic@example.invalid','conversationId':'gateway',
            'epoch':1,'generation':1,'seq':1}
        session=Session(broker,identity,'private-container','private-volume',[])
        old=SimpleNamespace(stdin=MagicMock());new=SimpleNamespace(stdin=MagicMock())
        session.proc=new;session.active={**identity,'operationId':'new'};session.phase='running'
        session.gateway_call({'id':'old-ui'},old)
        session.write({'type':'extension_ui_response','id':'old-ui'},expected_proc=old)
        self.assertFalse(session.revoked);self.assertIsNone(session.error)
        new.stdin.write.assert_not_called();old.stdin.write.assert_not_called()

    def test_cancel_queue_and_ordinary_write_do_not_invert_locks_or_write_under_state_lock(self):
        from .workspace import cancel_queues
        broker=SimpleNamespace(image='sha256:'+'a'*64,save_session=MagicMock())
        identity={'operationId':'current','ownerId':'synthetic@example.invalid','conversationId':'cancel-lock',
            'epoch':1,'generation':1,'seq':1}
        session=Session(broker,identity,'private-container','private-volume',[])
        writer_entered,cancel_entered=threading.Event(),threading.Event();errors=[];writes=[]
        class Pending(dict):
            def __iter__(self):cancel_entered.set();return super().__iter__()
        class OrderedWriteLock:
            def __init__(self):self.lock=threading.Lock()
            def __enter__(self):
                self.lock.acquire()
                if threading.current_thread().name=='ordinary-write':
                    writer_entered.set()
                    if not cancel_entered.wait(1):raise AssertionError('canceller could not enter state lock')
            def __exit__(self,*args):self.lock.release()
        session.write_lock=OrderedWriteLock();session.ui_pending=Pending({'old-question':{}})
        def write(raw):
            if session.lock._is_owned():raise AssertionError('blocking pipe write held session state lock')
            writes.append(raw)
        session.proc=SimpleNamespace(stdin=SimpleNamespace(write=write,flush=lambda:None))
        def run(action):
            try:action()
            except BaseException as error:errors.append(error)
        with patch('pi_runner.workspace.value_get',return_value=None):
            first=threading.Thread(name='ordinary-write',target=lambda:run(lambda:session.write({'type':'test'})),daemon=True)
            second=threading.Thread(target=lambda:run(lambda:cancel_queues(session)),daemon=True)
            first.start();self.assertTrue(writer_entered.wait(1));second.start()
            first.join(2);second.join(2)
        self.assertFalse(first.is_alive());self.assertFalse(second.is_alive())
        self.assertFalse(errors,errors);self.assertEqual(len(writes),2);self.assertFalse(session.ui_pending)


@unittest.skipUnless(os.getenv('PI_RUNNER_TEST_CONFIG'),'explicit private rootless config required')
class RealSkillChangeTests(unittest.TestCase):
    def test_empty_to_excel_create_without_a_model_request(self):
        config=decode(Path(os.environ['PI_RUNNER_TEST_CONFIG']).read_bytes())
        self.assertTrue(config['namespace'].startswith('pi-test-'))
        broker=Broker(config);broker.stop_monitor.set()
        job={'operationId':'skill-initial-'+uuid.uuid4().hex,'ownerId':'synthetic@example.invalid',
            'conversationId':'skill-change-'+uuid.uuid4().hex,'epoch':1,'generation':1,'seq':1}
        following={**job,'operationId':'skill-next-'+uuid.uuid4().hex,'seq':2}
        admission={'mode':'execute','modeRevision':1,'admissionEpoch':1,'rootSessionId':job['conversationId'],
            'treeVersion':1,'scopeSha256':'a'*64}
        model={'contextWindow':1000000,'maxTokens':65536,'reasoning':True,'supportedThinkingLevels':['off']}
        def payload(selected):return {'gateway':{'url':broker.gateway_url,'capability':'synthetic-capability-'+uuid.uuid4().hex},
            'model':model,'skillVersion':'1.3.0','skillIds':selected,'admission':admission}
        observations=[]
        try:
            value=broker.execute({**job,'command':'create','payload':payload([])})
            observations.append({'stage':'initial-empty-create','status':value['status']})
            start=time.monotonic()
            try:
                value=broker.execute({**following,'command':'create','payload':payload(['excel-report'])})
            except Exception as error:
                code=str(error)
                observations.append({'stage':'existing-create-skill-change','exceptionType':type(error).__name__,
                    'fixedError':code if re.fullmatch('[a-z_]{1,64}',code) else 'nonpublic_error',
                    'elapsedSeconds':round(time.monotonic()-start,3)})
                raise
            self.assertEqual([x['id'] for x in value['skills']],['excel-report'])
            self.assertEqual(next(iter(broker.sessions.values())).pi_state['thinkingLevel'],'off')
            observations.append({'stage':'existing-create-skill-change','status':value['status'],
                'elapsedSeconds':round(time.monotonic()-start,3)})
        finally:
            observations.append({'gatewayRequestCount':broker.ledger.db.execute('SELECT count(*) FROM gateway').fetchone()[0]})
            try:
                result=broker.execute({**following,'command':'dispose','payload':{}})
                observations.append({'stage':'original-dispose','status':result['status']})
            finally:
                for name in broker.managed_containers():
                    meta=decode(broker.docker_command(['inspect',name]))[0]
                    self.assertEqual(meta['Config']['Labels']['teruisi.pi.namespace'],config['namespace'])
                    broker.docker_command(['rm','--force',meta['Id']])
                for volume in broker.docker_command(['volume','ls','-q','--filter','label=teruisi.pi.namespace='+config['namespace']]).decode().split():
                    meta=decode(broker.docker_command(['volume','inspect',volume]))[0]
                    self.assertEqual(meta['Labels']['teruisi.pi.namespace'],config['namespace']);broker.docker_command(['volume','rm',volume])
                observations.append({'cleanupComplete':not broker.managed_containers()})
                broker.ledger.db.close();broker.lock_file.close()
                print(json.dumps({'nonPaidSkillChange':observations}),flush=True)
