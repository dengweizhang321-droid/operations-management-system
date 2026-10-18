"""Real phase-two acceptance; requires opt-in isolated rootless Pi image."""
import base64
import hashlib
import os
from pathlib import Path
import tempfile
import threading
import time
import unittest
import uuid
from unittest import mock

from .protocol import decode, encode
from .server import Ledger
from .workspace import init_ledger
from .test_real import RealPiTests, CONFIG


class WorkspaceLedgerTests(unittest.TestCase):
    def test_interrupted_controls_and_inputs_fence_on_restart(self):
        with tempfile.TemporaryDirectory() as folder:
            ledger = Ledger(Path(folder) / 'ledger.sqlite3')
            init_ledger(ledger)
            with ledger.db:
                ledger.db.execute('INSERT INTO workspace_controls VALUES (?,?,?,?,?,?,?)', ('w','c',1,'d','bash','accepted',encode({})))
                ledger.db.execute('INSERT INTO terminal_inputs VALUES (?,?,?,?,?,?)', ('w','t','i',1,'d','dispatching'))
            ledger.db.close()
            ledger = Ledger(Path(folder) / 'ledger.sqlite3')
            init_ledger(ledger)
            self.assertEqual(ledger.db.execute('SELECT status FROM workspace_controls').fetchone()[0], 'unknown')
            self.assertEqual(ledger.db.execute('SELECT status FROM terminal_inputs').fetchone()[0], 'unknown')
            ledger.db.close()


@unittest.skipUnless(CONFIG, 'real isolated Pi/rootless config is required')
class WorkspaceRealTests(unittest.TestCase):
    setUpClass = classmethod(RealPiTests.setUpClass.__func__)
    tearDownClass = classmethod(RealPiTests.tearDownClass.__func__)
    @classmethod
    def cleanup(cls):
        RealPiTests.cleanup.__func__(cls)
        # Upgrades deliberately retain original snapshots. Remove only this
        # private test namespace after checking each exact namespace label.
        namespace=cls.broker.namespace
        if not namespace.startswith('pi-test-'):raise ValueError('test_namespace_required')
        for container_id in cls.broker.managed_containers():
            meta=decode(cls.broker.docker_command(['inspect',container_id]))[0]
            if meta['Config']['Labels'].get('teruisi.pi.namespace')!=namespace:raise ValueError('test_container_scope')
            cls.broker.docker_command(['rm','--force',meta['Id']])
        raw=cls.broker.docker_command(['volume','ls','-q','--filter','label=teruisi.pi.namespace='+namespace])
        for volume in raw.decode().split():
            meta=decode(cls.broker.docker_command(['volume','inspect',volume]))[0]
            if meta['Labels'].get('teruisi.pi.namespace')!=namespace:raise ValueError('test_volume_scope')
            cls.broker.docker_command(['volume','rm',volume])
    tearDown = RealPiTests.tearDown
    job = RealPiTests.job
    call = RealPiTests.call
    create = RealPiTests.create
    pump = RealPiTests.pump
    text = staticmethod(RealPiTests.text)
    tool = staticmethod(RealPiTests.tool)

    def control(self, job, name, args=None, wait=True):
        self.control_seq = getattr(self, 'control_seq', 0) + 1
        payload = {'action':'control','controlId':'control-'+uuid.uuid4().hex,'controlSeq':self.control_seq,'command':name,'payload':args or {}}
        value = self.call(job, 'workspace', payload)
        if wait:
            deadline = time.monotonic() + 40
            while value['control']['status'] in {'accepted','dispatching'} and time.monotonic() < deadline:
                time.sleep(.05)
                value = self.call(job, 'workspace', payload)
        return value, payload

    def state(self, job, cursors=None):
        return self.call(job, 'workspace', {'action':'state','afterTerminalSeq':cursors or {}})['workspace']

    def test_real_ptys_utf8_resize_ctrlc_and_replay(self):
        job=self.job(); self.create(job)
        result,payload=self.control(job,'terminal_create',{'cols':80,'rows':24})
        self.assertEqual(result['control']['status'],'completed')
        terminal_id=result['control']['result']['terminalId']
        second,_=self.control(job,'terminal_create')
        self.assertNotEqual(second['control']['result']['terminalId'],terminal_id)
        data={'terminalId':terminal_id,'inputId':'input-1','inputSeq':1,'data':"printf '中文标记\\n'; tty; stty size\n"}
        applied,input_payload=self.control(job,'terminal_input',data)
        self.assertEqual(applied['control']['result']['status'],'applied')
        self.assertEqual(self.call(job,'workspace',input_payload)['control'],applied['control'])
        changed={**input_payload,'payload':{**data,'data':'echo SHOULD-NOT-RUN\n'}}
        with self.assertRaisesRegex(ValueError,'control_payload_changed'):
            self.call(job,'workspace',changed)
        deadline=time.monotonic()+10
        while time.monotonic()<deadline:
            tab=self.state(job)['terminals'][0]
            output=''.join(item['data'] for item in tab['output'])
            if '24 80' in output and '/dev/pts/' in output:break
            time.sleep(.05)
        self.assertIn('中文标记',output); self.assertIn('/dev/pts/',output)
        self.control(job,'terminal_resize',{'terminalId':terminal_id,'cols':111,'rows':35})
        self.control(job,'terminal_input',{'terminalId':terminal_id,'inputId':'input-2','inputSeq':2,'data':'stty size; sleep 30\n'})
        time.sleep(.2)
        self.control(job,'terminal_input',{'terminalId':terminal_id,'inputId':'input-3','inputSeq':3,'data':'\u0003'})
        self.control(job,'terminal_input',{'terminalId':terminal_id,'inputId':'input-4','inputSeq':4,'data':'echo after-interrupt\n'})
        deadline=time.monotonic()+10
        while time.monotonic()<deadline:
            tab=self.state(job)['terminals'][0]
            output=''.join(item['data'] for item in tab['output'])
            if '35 111' in output and 'after-interrupt\r\n' in output:break
            time.sleep(.05)
        self.assertIn('35 111',output); self.assertIn('after-interrupt\r\n',output)
        self.assertEqual(tab['nextInputSeq'],5)
        self.control(job,'terminal_input',{'terminalId':terminal_id,'inputId':'input-5','inputSeq':5,'data':"python3 -c \"print('x'*300000)\"\n"})
        deadline=time.monotonic()+10
        while time.monotonic()<deadline:
            tab=self.state(job)['terminals'][0]
            if tab['hasGap']:break
            time.sleep(.05)
        self.assertTrue(tab['hasGap']);self.assertLessEqual(sum(item['byteLength'] for item in tab['output']),256*1024)
        after=self.state(job,{terminal_id:tab['lastOutputSeq']})['terminals'][0]
        self.assertFalse(after['hasGap']);self.assertEqual(after['output'],[])

    def test_real_file_sha_download_snapshot_and_unsafe_paths(self):
        job=self.job();self.create(job)
        data='初稿\n'.encode();sha=hashlib.sha256(data).hexdigest()
        value,_=self.control(job,'file_write',{'path':'work/fixture.txt','expectedSha256':None,'base64':base64.b64encode(data).decode()})
        self.assertEqual(value['control']['result']['sha256'],sha)
        download,_=self.control(job,'file_download',{'path':'work/fixture.txt','expectedSha256':sha})
        snapshot_id=download['control']['result']['downloadId']
        conflict,_=self.control(job,'file_write',{'path':'work/fixture.txt','expectedSha256':'0'*64,'base64':'bmV3'})
        self.assertEqual(conflict['control']['status'],'failed')
        self.control(job,'file_write',{'path':'work/fixture.txt','expectedSha256':sha,'base64':'bmV3'})
        snapshot=self.call(job,'workspace',{'action':'download','downloadId':snapshot_id})['download']
        self.assertEqual(base64.b64decode(snapshot['base64']),data)
        for path in ['../etc/passwd','/etc/passwd','work/../../home','work\\bad','home/.pi/agent/settings.json']:
            result,_=self.control(job,'file_read',{'path':path})
            self.assertEqual(result['control']['status'],'failed')
        result,_=self.control(job,'bash',{'command':'ln -s /etc /workspace/work/link'})
        self.assertEqual(result['control']['status'],'completed')
        result,_=self.control(job,'file_read',{'path':'work/link/passwd'})
        self.assertEqual(result['control']['status'],'failed')
        self.assertNotEqual(self.state(job)['environmentStatus'],'unknown')
        for command,action in [('file_list','delete'),('file_read','write')]:
            value,_=self.control(job,command,{'path':'work/fixture.txt','action':action,'base64':'ZWZmbGVjdA==','expectedSha256':hashlib.sha256(b'new').hexdigest()})
            self.assertEqual(value['control']['status'],'failed')
            self.assertEqual(value['control']['errorCode'],'invalid_file_payload')
        large=b'x'*300000
        self.control(job,'file_write',{'path':'work/large.txt','expectedSha256':None,'base64':base64.b64encode(large).decode()})
        value,_=self.control(job,'file_read',{'path':'work/large.txt'})
        self.assertFalse(value['control']['result']['editable'])
        self.assertTrue(value['control']['result']['previewOmitted'])
        self.assertNotIn('text',value['control']['result'])

    def test_real_restart_idle_get_and_explicit_wake_without_prompt_replay(self):
        from .server import Broker
        job=self.job();created=self.create(job);session=self.broker.sessions[created['state']['workspaceId']]
        old=self.broker;session.phase='disposed';old.ledger.db.close();old.lock_file.close()
        type(self).broker=Broker(decode(Path(CONFIG).read_bytes()));self.broker.stop_monitor.set()
        if session.proc:
            session.proc.stdin.close();session.proc.wait(timeout=5)
        snapshot=self.call(job,'workspace',{'action':'state'})['workspace']
        self.assertEqual(snapshot['environmentStatus'],'stopped')
        self.assertFalse(decode(self.broker.docker_command(['inspect',session.container]))[0]['State']['Running'])
        value,_=self.control(job,'wake');self.assertEqual(value['control']['status'],'completed')
        self.assertEqual(self.call(job,'state')['status'],'idle')
        self.assertFalse(any(event['type']=='agent_start' for event in self.call(job,'state')['events']))

    def test_real_restart_idle_accepted_control_stops_owner_and_precise_helper(self):
        from .server import Broker
        job=self.job();created=self.create(job);session=self.broker.sessions[created['state']['workspaceId']]
        helper=session.container+'-files-crash';labels=['--label','teruisi.pi.file-helper='+session.key]
        helper_id=self.broker.docker_command(['create','--name',helper,'--network=none','--read-only','--user=65532:65532',*labels,
            '--mount','type=volume,src='+session.volume+',dst=/workspace','--entrypoint','python3',session.image,'-I','-B','-c',
            "from pathlib import Path;import time;p=Path('/workspace/work/helper-crash');\nwhile True:p.write_text(str(time.time()));time.sleep(.1)"]).decode().strip()
        with self.broker.ledger.lock,self.broker.ledger.db:
            self.broker.ledger.db.execute('INSERT INTO workspace_helpers VALUES (?,?,?,?,?,?)',(session.key,helper,helper_id,session.image,session.volume,'dispatching'))
            self.broker.ledger.db.execute('INSERT INTO workspace_controls VALUES (?,?,?,?,?,?,?)',(session.key,'accepted-before-crash',1,'d','file_write','accepted',encode({})))
        self.broker.docker_command(['start',helper_id]);time.sleep(.2)
        old=self.broker;session.phase='disposed';old.ledger.db.close();old.lock_file.close()
        type(self).broker=Broker(decode(Path(CONFIG).read_bytes()));self.broker.stop_monitor.set()
        if session.proc:
            session.proc.stdin.close();session.proc.wait(timeout=5)
        self.assertEqual(self.call(job,'workspace',{'action':'state'})['workspace']['environmentStatus'],'unknown')
        self.assertFalse(self.broker.docker_command(['ps','-aq','--filter','id='+helper_id]).strip())
        self.assertFalse(decode(self.broker.docker_command(['inspect',session.container]))[0]['State']['Running'])
        health=self.broker.health();self.assertEqual(health['unresolvedCount'],1);self.assertEqual(health['unsafeUnknownCount'],0)
        self.assertEqual(self.call(job,'workspace',{'action':'receipt','controlId':'accepted-before-crash'})['control']['status'],'unknown')

    @unittest.skipUnless(os.environ.get('PI_RUNNER_DEPENDENCY_FIXTURES'),'real offline install bundle required')
    def test_real_fetch_activity_body_receipts_idle_handoff_and_expiry(self):
        from .workspace import expire_activities
        job=self.job();created=self.create(job);session=self.broker.sessions[created['state']['workspaceId']]
        activity_id='fetch-'+uuid.uuid4().hex
        begin={'action':'activity_begin','activityId':activity_id,'activitySeq':1,'kind':'dependency_fetch','timeoutMs':60000}
        first=self.call(job,'workspace',begin)['activity'];time.sleep(.05)
        self.assertEqual(self.call(job,'workspace',begin)['activity'],first)
        with self.assertRaisesRegex(ValueError,'activity_payload_changed'):
            self.call(job,'workspace',{**begin,'timeoutMs':61000})
        session.last_activity=time.monotonic()-100
        self.assertTrue(self.broker.workspace_active(session))
        # Polling leaves the original fixed deadline unchanged.
        self.state(job);self.state(job)
        self.assertEqual(self.state(job)['activities'][0]['deadline'],first['deadline'])
        bundle=decode((Path(os.environ['PI_RUNNER_DEPENDENCY_FIXTURES'])/'install-six.json').read_bytes())
        control={'action':'control','controlId':activity_id,'controlSeq':1,'command':'resource_install','payload':{'bundle':bundle}}
        accepted=self.call(job,'workspace',control)
        self.assertIn(accepted['control']['status'],{'accepted','completed'})
        end={'action':'activity_end','activityId':activity_id,'activitySeq':2}
        ended=self.call(job,'workspace',end)['activity'];self.assertEqual(ended['status'],'completed')
        self.assertEqual(self.call(job,'workspace',end)['activity'],ended)
        deadline=time.monotonic()+20
        while time.monotonic()<deadline:
            result=self.call(job,'workspace',{'action':'receipt','controlId':activity_id})['control']
            if result['status']=='completed':break
            time.sleep(.05)
        self.assertEqual(result['status'],'completed')
        expires={'action':'activity_begin','activityId':'expires-'+uuid.uuid4().hex,'activitySeq':1,'kind':'dependency_fetch','timeoutMs':100}
        self.call(job,'workspace',expires);time.sleep(.15)
        self.assertTrue(expire_activities(session))
        state=self.state(job);self.assertTrue(state['hasUnresolvedActivities']);self.assertEqual(state['environmentStatus'],'unknown')
        self.assertFalse(decode(self.broker.docker_command(['inspect',session.container]))[0]['State']['Running'])
        with self.assertRaisesRegex(ValueError,'activity_unknown'):
            self.call(job,'workspace',{'action':'activity_end','activityId':expires['activityId'],'activitySeq':2})

    @unittest.skipUnless(os.environ.get('PI_RUNNER_DEPENDENCY_FIXTURES'),'outside-fetched exact bundles required')
    def test_real_idle_preserves_install_pending_ui_and_background_process(self):
        from .workspace import handle_ui
        job=self.job();created=self.create(job);session=self.broker.sessions[created['state']['workspaceId']]
        previous_limits=dict(self.broker.limits);previous_stop=self.broker.stop_monitor
        stop=threading.Event();self.broker.stop_monitor=stop;self.broker.limits['idleSeconds']=1
        watcher=threading.Thread(target=self.broker.monitor,daemon=True);watcher.start()
        release=threading.Event();entered=threading.Event();original=self.broker.docker_command
        def delayed(args,*pos,**kwargs):
            if args[-1:] == ['/opt/pi/dependency-install.py']:
                entered.set();release.wait(10)
            return original(args,*pos,**kwargs)
        try:
            bundle=decode((Path(os.environ['PI_RUNNER_DEPENDENCY_FIXTURES'])/'install-six.json').read_bytes())
            with mock.patch.object(self.broker,'docker_command',side_effect=delayed):
                value,payload=self.control(job,'resource_install',{'bundle':bundle},wait=False)
                self.assertTrue(entered.wait(5));session.last_activity=time.monotonic()-100
                time.sleep(2)
                self.assertEqual(session.phase,'idle')
                self.assertTrue(decode(original(['inspect',session.container]))[0]['State']['Running'])
                release.set()
                deadline=time.monotonic()+20
                while time.monotonic()<deadline:
                    value=self.call(job,'workspace',{'action':'receipt','controlId':payload['controlId']})
                    if value['control']['status']=='completed':break
                    time.sleep(.05)
                self.assertEqual(value['control']['status'],'completed')
            handle_ui(session,{'type':'extension_ui_request','id':'pending-test-ui','method':'input','title':'ordinary pending'})
            session.last_activity=time.monotonic()-100
            time.sleep(2);self.assertEqual(session.phase,'idle')
            self.control(job,'ui_response',{'requestId':'pending-test-ui','cancelled':True})
            self.control(job,'bash',{'command':"python3 -c 'import time;time.sleep(20)' >/dev/null 2>&1 & echo $! > /workspace/work/bg.pid"})
            session.last_activity=time.monotonic()-100
            time.sleep(2);self.assertEqual(session.phase,'idle')
            self.assertGreater(session.background_process_count,0)
            self.control(job,'bash',{'command':'kill $(cat /workspace/work/bg.pid)'})
        finally:
            release.set();stop.set();watcher.join(timeout=10)
            self.broker.limits=previous_limits;self.broker.stop_monitor=previous_stop

    def test_real_sessions_bash_context_and_pause_wake(self):
        job=self.job();self.create(job)
        self.control(job,'bash',{'command':'! printf included-context'})
        self.control(job,'bash',{'command':'!! printf excluded-context'})
        session=self.broker.sessions[self.state(job)['workspaceId']]
        messages=session.rpc('get_messages',{})['data']['messages']
        bash=[item for item in messages if item.get('role')=='bashExecution']
        self.assertTrue(any(item.get('excludeFromContext') is False for item in bash))
        self.assertTrue(any(item.get('excludeFromContext') is True for item in bash))
        self.call(job,'prompt',{'message':'session-proof','gateway':{'url':self.broker.gateway_url,'capability':'synthetic-capability-next-'+job['operationId']}})
        self.pump(job,[self.text('session-response')])
        tree,_=self.control(job,'tree'); self.assertTrue(tree['control']['result']['tree'])
        old=self.state(job)['piState']['sessionId']
        cloned,_=self.control(job,'session_clone'); self.assertEqual(cloned['control']['status'],'completed')
        clone_id=cloned['control']['result']['sessionId'];self.assertNotEqual(old,clone_id)
        switched,_=self.control(job,'session_switch',{'sessionId':old});self.assertEqual(switched['control']['result']['sessionId'],old)
        forged,_=self.control(job,'session_switch',{'sessionId':'/etc/passwd'});self.assertEqual(forged['control']['status'],'failed')
        exported,_=self.control(job,'export_html');self.assertEqual(exported['control']['status'],'completed')
        snapshot=self.call(job,'workspace',{'action':'download','downloadId':exported['control']['result']['downloadId']})['download']
        self.assertIn(b'session-response',base64.b64decode(snapshot['base64']))
        paused,_=self.control(job,'pause');self.assertEqual(paused['control']['status'],'completed')
        self.assertEqual(self.state(job)['environmentStatus'],'stopped')
        woken,_=self.control(job,'wake');self.assertEqual(woken['control']['status'],'completed')
        self.assertEqual(self.state(job)['piState']['sessionId'],old)

    def test_real_native_bash_live_output_exit_truncation_and_separate_cancel(self):
        job=self.job();self.create(job)
        value,payload=self.control(job,'bash',{'command':"!! printf first-live; sleep 3; printf second-live; exit 7"},wait=False)
        deadline=time.monotonic()+2.5;first=None
        while time.monotonic()<deadline:
            runs=self.state(job)['bashRuns']
            if runs and 'first-live' in ''.join(item['data'] for item in runs[-1]['output']):first=runs[-1];break
            time.sleep(.025)
        self.assertIsNotNone(first);self.assertEqual(first['status'],'running')
        self.assertNotIn('second-live',''.join(item['data'] for item in first['output']))
        deadline=time.monotonic()+10
        while time.monotonic()<deadline:
            result=self.call(job,'workspace',{'action':'receipt','controlId':payload['controlId']})['control']
            if result['status']=='completed':break
            time.sleep(.025)
        self.assertEqual(result['result']['exitCode'],7);self.assertTrue(result['result']['excludeFromContext'])
        value,payload=self.control(job,'bash',{'command':'printf cancel-live; sleep 30'},wait=False)
        deadline=time.monotonic()+5
        while time.monotonic()<deadline:
            runs=self.state(job)['bashRuns']
            if runs and 'cancel-live' in ''.join(item['data'] for item in runs[-1]['output']):break
            time.sleep(.025)
        self.control(job,'abort_bash')
        deadline=time.monotonic()+10
        while time.monotonic()<deadline:
            result=self.call(job,'workspace',{'action':'receipt','controlId':payload['controlId']})['control']
            if result['status']=='completed':break
            time.sleep(.025)
        self.assertTrue(result['result']['cancelled'])
        self.assertEqual(self.call(job,'state')['status'],'idle')
        result,_=self.control(job,'bash',{'command':"python3 -c \"print('x'*400000)\""})
        self.assertTrue(result['control']['result']['truncated'])
        run=self.state(job)['bashRuns'][-1]
        self.assertTrue(run['truncated']);self.assertTrue(run['hasGap'])
        self.assertLessEqual(sum(len(item['data'].encode()) for item in run['output']),131072)
        self.assertLess(len(encode(self.state(job))),2*1024*1024)

    def test_real_compact_rejection_has_terminal_file_receipt(self):
        job=self.job();self.create(job)
        value,_=self.control(job,'compact',{'timeoutMs':60000,'gateway':{'url':self.broker.gateway_url,'capability':'synthetic-compact-'+job['operationId']},
            'model':{'contextWindow':65536,'maxTokens':8192,'reasoning':True}})
        self.assertEqual(value['control']['status'],'failed')
        result=self.call(job,'state')
        self.assertEqual(result['status'],'failed')
        self.assertTrue(result['filesCollected'])
        self.assertEqual(result['terminalReceipt']['operationId'],job['operationId'])

    def test_real_multiple_queue_receipts_and_abort_clears(self):
        job=self.job();self.create(job)
        self.call(job,'prompt',{'message':'等待','gateway':{'url':self.broker.gateway_url,'capability':'synthetic-'+job['operationId']}})
        for _ in range(100):
            if self.call(job,'state')['pendingGatewayRequests']:break
            time.sleep(.05)
        one,_=self.control(job,'steer',{'message':'第一条'})
        two,_=self.control(job,'steer',{'message':'第二条'})
        follow,_=self.control(job,'follow_up',{'message':'第三条'})
        for value in (one,two,follow):self.assertIn(value['control']['status'],{'queued','handled','completed'})
        self.call(job,'abort'); self.pump(job,[])
        receipts={item['controlId']:item for item in self.state(job)['controls']}
        for value in (one,two,follow):
            self.assertEqual(receipts[value['control']['controlId']]['status'],'completed')
            self.assertEqual(receipts[value['control']['controlId']]['result']['disposition'],'canceled')

    def test_real_multiple_queue_inputs_processed_same_run(self):
        job=self.job();self.create(job)
        self.call(job,'prompt',{'message':'queued-processing-start','gateway':{'url':self.broker.gateway_url,'capability':'synthetic-'+job['operationId']}})
        for _ in range(100):
            if self.call(job,'state')['pendingGatewayRequests']:break
            time.sleep(.05)
        values=[]
        for command,text in [('steer','queue-one'),('steer','queue-two'),('follow_up','queue-three')]:
            value,_=self.control(job,command,{'message':text});values.append(value)
        result=self.pump(job,[self.tool('bash',{'command':'printf queued-tool'}),self.text('queue-answer-1'),self.text('queue-answer-2'),self.text('queue-answer-3'),self.text('queue-answer-4')])
        self.assertEqual(result['status'],'settled')
        receipts={item['controlId']:item for item in self.state(job)['controls']}
        for value in values:
            receipt=receipts[value['control']['controlId']]
            self.assertEqual(receipt['status'],'completed',receipt)
            self.assertEqual(receipt['result']['disposition'],'processed')

    def test_real_ordinary_extension_ui_wait_and_scoped_responses(self):
        job=self.job();self.create(job)
        began=time.monotonic()
        value=self.call(job,'prompt',{'message':'/workspace-ui','gateway':{'url':self.broker.gateway_url,'capability':'synthetic-ui-'+job['operationId']}})
        self.assertLess(time.monotonic()-began,5)
        self.assertIn(value['status'],{'dispatching','accepted'})
        seen=[];deadline=time.monotonic()+30
        while time.monotonic()<deadline:
            state=self.state(job)
            for pending in state['pendingUi']:
                if pending['requestId'] in seen:continue
                seen.append(pending['requestId'])
                self.assertNotEqual(pending.get('title'),'pi-gateway-v1')
                self.assertEqual(pending['operationId'],job['operationId'])
                if pending['method']=='select':
                    # Human response can take longer than the generic RPC's old
                    # 15 second wait. The one original prompt must remain alive.
                    time.sleep(16)
                    self.assertEqual(self.call(job,'state')['status'],'dispatching')
                response={'requestId':pending['requestId']}
                if pending['method']=='confirm':response['confirmed']=True
                else:response['value']={'select':'Continue','input':'普通中文输入','editor':'普通编辑结果'}[pending['method']]
                applied,_=self.control(job,'ui_response',response)
                self.assertEqual(applied['control']['status'],'completed')
            run=self.call(job,'state')
            self.assertEqual(run['pendingGatewayRequests'],[])
            if run['status']=='handled':break
            time.sleep(.05)
        self.assertEqual(run['status'],'handled');self.assertEqual(len(seen),4)
        effects=self.state(job)['uiEffects'];methods={effect['method'] for effect in effects}
        self.assertTrue({'notify','setStatus','setWidget','setTitle','set_editor_text'}.issubset(methods))
        self.assertTrue(all(effect['generation']==job['generation'] for effect in effects))
        late,_=self.control(job,'ui_response',{'requestId':seen[-1],'value':'late'})
        self.assertEqual(late['control']['status'],'failed')

    @unittest.skipUnless(os.environ.get('PI_RUNNER_DEPENDENCY_FIXTURES'),'outside-fetched exact bundles required')
    def test_real_offline_python_node_dependencies_survive_pause(self):
        job=self.job();self.create(job)
        root=Path(os.environ['PI_RUNNER_DEPENDENCY_FIXTURES'])
        for name in ['install-six.json','install-is-odd.json']:
            bundle=decode((root/name).read_bytes())
            value,_=self.control(job,'resource_install',{'bundle':bundle})
            self.assertEqual(value['control']['status'],'completed',value['control'])
            self.assertEqual(value['control']['result']['network'],'none')
        check="/workspace/venv/bin/python -c 'import six; print(six.__version__)'; node -e \"console.log(require('/workspace/work/node_modules/is-odd')(3))\""
        result,_=self.control(job,'bash',{'command':check})
        self.assertEqual(result['control']['status'],'completed')
        self.assertIn('1.17.0',str(result['control']['result']));self.assertIn('true',str(result['control']['result']))
        self.control(job,'pause');self.control(job,'wake')
        result,_=self.control(job,'bash',{'command':check})
        self.assertIn('1.17.0',str(result['control']['result']));self.assertIn('true',str(result['control']['result']))
        uv_job=self.job();self.create(uv_job)
        bundle=decode((root/'install-six.json').read_bytes());bundle['ecosystem']='uv'
        installed,_=self.control(uv_job,'resource_install',{'bundle':bundle})
        self.assertEqual(installed['control']['status'],'completed',installed['control'])
        self.assertEqual(installed['control']['result']['installer'],'uv')
        uv_check="uv --version; /workspace/venv/bin/python -c 'import six; print(six.__version__)'"
        checked,_=self.control(uv_job,'bash',{'command':uv_check})
        self.assertIn('uv 0.13.1',str(checked['control']['result']));self.assertIn('1.17.0',str(checked['control']['result']))
        self.control(uv_job,'pause');self.control(uv_job,'wake')
        checked,_=self.control(uv_job,'bash',{'command':uv_check})
        self.assertIn('1.17.0',str(checked['control']['result']))

    @unittest.skipUnless(os.environ.get('PI_RUNNER_DEPENDENCY_FIXTURES') and os.environ.get('PI_RUNNER_UPGRADE_FROM_IMAGE'),'old image and real dependency bundles required')
    def test_real_upgrade_original_snapshot_history_and_dependencies(self):
        from .upgrade_linux import probe_volume,register
        from .install_linux import source_digest
        from .workspace import value_set
        from .protocol import VERSION
        old_image=os.environ['PI_RUNNER_UPGRADE_FROM_IMAGE'];target_image=self.broker.image
        job=self.job();self.broker.image=old_image
        try:created=self.create(job)
        finally:self.broker.image=target_image
        original=self.broker.sessions[created['state']['workspaceId']]
        self.call(job,'prompt',{'message':'original-upgrade-history','gateway':{'url':self.broker.gateway_url,'capability':'synthetic-'+job['operationId']}})
        self.pump(job,[self.text('original-history-answer')])
        self.control(job,'bash',{'command':'printf original-workspace > /workspace/work/upgrade-marker'})
        # The exact new installer is also tested on an old-image volume while
        # every old-image writer is engine-paused, without enabling its network.
        self.broker.docker_command(['pause',original.container_id])
        try:
            for name in ['install-six.json','install-is-odd.json']:
                bundle=decode((Path(os.environ['PI_RUNNER_DEPENDENCY_FIXTURES'])/name).read_bytes())
                raw=self.broker.docker_command(['run','--rm','--pull=never','--network=none','--read-only','--user=65532:65532',
                    '--cap-drop=ALL','--security-opt=no-new-privileges:true','--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=128m',
                    '--mount','type=volume,src='+original.volume+',dst=/workspace','--entrypoint','python3','--interactive',target_image,
                    '-I','-B','/opt/pi/dependency-install.py'],raw=encode({'bundle':bundle}),timeout=120)
                self.assertNotIn('error',decode(raw))
        finally:self.broker.docker_command(['unpause',original.container_id])
        original_session=original.rpc('get_state',{})['data']['sessionId']
        history=hashlib.sha256(encode(original.rpc('get_messages',{})['data'])).hexdigest()
        self.control(job,'pause')
        before=probe_volume(self.broker,old_image,original.volume)
        # Independent real compatibility run on a copied synthetic workspace.
        preview_job=self.job();preview_created=self.create(preview_job)
        preview=self.broker.sessions[preview_created['state']['workspaceId']]
        self.control(preview_job,'pause')
        copy='import shutil;shutil.copytree("/source","/workspace",dirs_exist_ok=True,symlinks=True)'
        self.broker.docker_command(['run','--rm','--network=none','--read-only','--user=65532:65532','--cap-drop=ALL',
            '--security-opt=no-new-privileges:true','--mount','type=volume,src='+original.volume+',dst=/source,readonly',
            '--mount','type=volume,src='+preview.volume+',dst=/workspace','--entrypoint','python3',target_image,'-I','-B','-c',copy],timeout=60)
        after=probe_volume(self.broker,target_image,preview.volume)
        self.assertEqual(before,after)
        value_set(preview,'currentSessionId',original_session)
        self.control(preview_job,'wake')
        preview_state=preview.rpc('get_state',{})['data']
        preview_history=hashlib.sha256(encode(preview.rpc('get_messages',{})['data'])).hexdigest()
        self.assertEqual(history,preview_history)
        check="/workspace/venv/bin/python -c 'import six; assert six.__version__==\"1.17.0\"; print(\"python-dependency-ok\")'; node -e \"if(!require('/workspace/work/node_modules/is-odd')(3))process.exit(1);console.log('node-dependency-ok')\""
        checked,_=self.control(preview_job,'bash',{'command':check})
        self.assertIn('python-dependency-ok',str(checked['control']['result']));self.assertIn('node-dependency-ok',str(checked['control']['result']))
        proof={'schemaVersion':1,'passed':True,'fromImage':old_image,'toImage':target_image,'sourceSha256':source_digest(),'protocolVersion':VERSION,
            'checks':{'piSession':True,'pythonDependencies':True,'nodeDependencies':True,'workspace':True},
            'evidence':{'workspaceManifestBefore':before['workspaceManifest'],'workspaceManifestAfter':after['workspaceManifest'],
                'pythonPackagesBefore':before['pythonPackages'],'pythonPackagesAfter':after['pythonPackages'],
                'nodePackagesBefore':before['nodePackages'],'nodePackagesAfter':after['nodePackages'],
                'runtimeBefore':before['runtime'],'runtimeAfter':after['runtime'],'sessionBefore':original_session,
                'sessionAfter':preview_state['sessionId'],'historyBefore':history,'historyAfter':preview_history}}
        plan=register(decode(Path(CONFIG).read_bytes()),proof)
        self.control(job,'wake')
        old_volume=original.volume;old_id=original.container_id
        upgraded,_=self.control(job,'upgrade',{'planId':plan['planId']})
        self.assertEqual(upgraded['control']['status'],'completed',upgraded['control'])
        receipt=upgraded['control']['result']
        self.assertNotEqual(original.volume,old_volume)
        self.assertEqual(receipt['originalContainerId'],old_id)
        self.assertEqual(probe_volume(self.broker,old_image,old_volume),before)
        checked,_=self.control(job,'bash',{'command':check+'; cat /workspace/work/upgrade-marker'})
        self.assertIn('original-workspace',str(checked['control']['result']))
        self.assertIn('python-dependency-ok',str(checked['control']['result']))
        # The real compatibility proof contains hashes only; no model text,
        # dependency bytes or operation capability are copied into audit.
        (Path(CONFIG).parent/'upgrade-compatibility-proof.json').write_bytes(encode(proof))
        meta=decode(self.broker.docker_command(['inspect',old_id]))[0]
        self.assertFalse(meta['State']['Running'])
        # Inject a failure only after writing into a real candidate copy. The
        # stopped original volume must remain byte-for-byte unchanged.
        failed_job=self.job();self.broker.image=old_image
        try:failed_created=self.create(failed_job)
        finally:self.broker.image=target_image
        failed_session=self.broker.sessions[failed_created['state']['workspaceId']]
        self.control(failed_job,'pause')
        self.broker.docker_command(['run','--rm','--network=none','--read-only','--user=65532:65532','--cap-drop=ALL',
            '--security-opt=no-new-privileges:true','--mount','type=volume,src='+old_volume+',dst=/source,readonly',
            '--mount','type=volume,src='+failed_session.volume+',dst=/workspace','--entrypoint','python3',target_image,'-I','-B','-c',copy],timeout=60)
        failed_original_volume=failed_session.volume
        original_digest=probe_volume(self.broker,old_image,failed_original_volume)
        self.control(failed_job,'wake')
        def fail_after_candidate_write():
            self.broker.docker_command(['run','--rm','--network=none','--read-only','--user=65532:65532',
                '--mount','type=volume,src='+failed_session.volume+',dst=/workspace','--entrypoint','python3',target_image,
                '-I','-B','-c',"from pathlib import Path;Path('/workspace/work/candidate-only').write_text('candidate-write')"])
            raise RuntimeError('injected_after_candidate_write')
        with mock.patch.object(failed_session,'start',side_effect=fail_after_candidate_write) as candidate_start:
            rejected,replay_payload=self.control(failed_job,'upgrade',{'planId':plan['planId']})
            self.assertEqual(rejected['control']['status'],'unknown')
            replay=self.call(failed_job,'workspace',replay_payload)
            self.assertEqual(replay['control']['status'],'unknown');self.assertEqual(candidate_start.call_count,1)
        self.assertEqual(probe_volume(self.broker,old_image,failed_original_volume),original_digest)
        self.assertNotEqual(probe_volume(self.broker,target_image,failed_session.volume)['workspaceManifest'],original_digest['workspaceManifest'])
        self.broker.docker_command(['rm',old_id])
        self.broker.docker_command(['volume','rm',old_volume])


if __name__=='__main__':unittest.main()
