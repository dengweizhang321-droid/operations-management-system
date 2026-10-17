"""Real Pi/rootless Docker acceptance. No FakePi and no paid provider.

PI_RUNNER_TEST_CONFIG must name a *private isolated* Linux config whose namespace
starts pi-test-. The synthetic provider replies travel through the real trusted
extension/UI RPC protocol and execute real built-in tools inside the container.
"""
import base64
import io
import json
import os
from pathlib import Path
import time
import threading
import unittest
import uuid
import zipfile

from .protocol import decode
from .server import Broker
from .wsl_control import verify_stop_readiness


CONFIG=os.environ.get('PI_RUNNER_TEST_CONFIG')


@unittest.skipUnless(CONFIG,'real isolated Pi/rootless config is required')
class RealPiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        config=decode(Path(CONFIG).read_bytes())
        if not config['namespace'].startswith('pi-test-'):raise ValueError('test_namespace_required')
        cls.broker=Broker(config);cls.broker.stop_monitor.set()
        cls.jobs=[]

    @classmethod
    def tearDownClass(cls):
        cls.cleanup()
        cls.broker.ledger.db.close()
        cls.broker.lock_file.close()

    def tearDown(self):self.cleanup()

    @classmethod
    def cleanup(cls):
        for job in cls.jobs:
            session=cls.broker.sessions.get(__import__('pi_runner.protocol',fromlist=['workspace_key']).workspace_key(job))
            if session:
                try:cls.broker.execute({**job,'command':'dispose','payload':{}})
                except Exception:pass
                # Delete only this test's exact owned volume after container removal.
                meta=decode(cls.broker.docker_command(['volume','inspect',session.volume]))[0]
                if meta['Labels'].get('teruisi.pi.workspace')==session.key:
                    cls.broker.docker_command(['volume','rm',session.volume])
        cls.jobs.clear()

    def job(self,conversation=None,seq=1):
        job={'operationId':'test-'+uuid.uuid4().hex,'ownerId':'synthetic@example.invalid','conversationId':conversation or 'test-'+uuid.uuid4().hex,'epoch':1,'generation':1,'seq':seq}
        self.jobs.append(job)
        return job

    def call(self,job,command,payload=None):
        payload=payload or {}
        if command=='prompt':payload={'timeoutMs':600000,**payload}
        return self.broker.execute({**job,'command':command,'payload':payload})

    def create(self,job):
        return self.call(job,'create',{'gateway':{'url':self.broker.gateway_url,'capability':'synthetic-capability-'+job['operationId']},
            'model':{'id':'synthetic','contextWindow':65536,'maxTokens':8192,'reasoning':True},'skillVersion':'1.0.0',
            'skillIds':['sales-promotion-inventory','stock-replenishment','excel-report']})

    def pump(self,job,replies):
        deadline=time.monotonic()+90;observed=[];seen=set();cursor=0
        while time.monotonic()<deadline:
            value=self.call(job,'state',{'afterEventSeq':cursor})
            observed.extend(value['events'])
            if value['events']:cursor=value['events'][-1]['eventSeq']
            for request in value['pendingGatewayRequests']:
                if request['requestId'] in seen:continue
                seen.add(request['requestId'])
                if request['kind']!='model':raise AssertionError('unexpected_gateway_kind')
                self.assertTrue(request['messages'][0]['content'])
                message=replies.pop(0)(request) if callable(replies[0]) else replies.pop(0)
                self.call(job,'gateway_response',{'requestId':request['requestId'],'response':{'message':message}})
            if value['status'] in {'settled','handled','failed','aborted','unknown','frozen'} and not value['hasMore']:
                value['events']=observed;return value
            time.sleep(.05)
        self.fail('real_pi_timeout')

    @staticmethod
    def text(text):return {'role':'assistant','content':[{'type':'text','text':text}],'stopReason':'stop'}

    @staticmethod
    def tool(name,args):return {'role':'assistant','content':[{'type':'toolCall','id':'call-'+uuid.uuid4().hex,'name':name,'arguments':args}],'stopReason':'toolUse'}

    def test_01_real_skill_script_xlsx_and_persistent_rounds(self):
        job=self.job();created=self.create(job)
        self.assertEqual(created['status'],'idle');self.assertEqual(len(created['skills']),3)
        session=self.broker.sessions[created['state']['workspaceId']]
        initial=decode(self.broker.docker_command(['inspect',session.container]))[0]['Id']
        prompt='/skill:excel-report 用合成数据制作带来源、口径和缺失的报告'
        self.call(job,'prompt',{'message':prompt,'gateway':{'url':self.broker.gateway_url,'capability':'synthetic-next-'+job['operationId']}})
        script="python3 - <<'PY'\nimport json,os\nfrom pathlib import Path\np=Path('/workspace/work/report.json');p.write_text(json.dumps({'columns':['货品','金额分'],'rows':[{'货品':'合成一','金额分':-120}],'sources':['synthetic fixture; 2026-10-16'],'metricDefinitions':['人民币分; 退款为负'],'missingData':['未提供成本']}))\nos.system('python3 /opt/pi/skill-bundles/1.0.0/excel-report/scripts/create_report.py /workspace/work/report.json /workspace/outputs/report.xlsx')\nPath('/workspace/home/persistent-marker').write_text('kept')\nprint('中文\\u2028inside\\u2029line')\nPY"
        result=self.pump(job,[self.tool('read',{'path':'/opt/pi/skill-bundles/1.0.0/excel-report/references/report-format.md'}),self.tool('bash',{'command':script}),self.text('已生成合成报告\u2028结束\u2029。')])
        self.assertEqual(result['status'],'settled')
        types=[e['type'] for e in result['events']]
        self.assertIn('agent_end',types);self.assertIn('agent_settled',types)
        response=[e for e in result['events'] if e['type']=='response' and e.get('command')=='prompt'][0]
        self.assertEqual(response['data']['disposition'],'started')
        self.assertLess(response['eventSeq'],next(e['eventSeq'] for e in result['events'] if e['type']=='agent_settled'))
        file=result['files'][0]
        with zipfile.ZipFile(io.BytesIO(base64.b64decode(file['base64']))) as book:
            self.assertEqual(len([n for n in book.namelist() if n.startswith('xl/worksheets/')]),4)
            self.assertIn('未提供成本',book.read('xl/worksheets/sheet4.xml').decode())
        self.call(job,'ack')
        next_job=self.job(job['conversationId'],2);next_created=self.create(next_job)
        self.assertEqual(initial,decode(self.broker.docker_command(['inspect',session.container]))[0]['Id'])
        self.call(next_job,'prompt',{'message':'核验上一轮HOME文件仍存在','gateway':{'url':self.broker.gateway_url,'capability':'synthetic-next-'+next_job['operationId']}})
        result=self.pump(next_job,[self.tool('bash',{'command':'cat /workspace/home/persistent-marker'}),self.text('kept')])
        self.assertEqual(result['status'],'settled')
        content=str(result['events']);self.assertIn('kept',content)

    def test_02_handled_no_run(self):
        job=self.job();self.create(job)
        result=self.call(job,'prompt',{'message':'/runner-ping','gateway':{'url':self.broker.gateway_url,'capability':'synthetic-next-'+job['operationId']}})
        self.assertEqual(result['status'],'handled')
        self.assertNotIn('agent_start',[e['type'] for e in result['events']])
        self.assertTrue(any(e.get('data',{}).get('disposition')=='handled' for e in result['events']))

    def test_03_abort_actual_settled_and_busy_skill_version(self):
        job=self.job();self.create(job)
        self.call(job,'prompt',{'message':'等待模型','gateway':{'url':self.broker.gateway_url,'capability':'synthetic-next-'+job['operationId']}})
        deadline=time.monotonic()+10
        while time.monotonic()<deadline:
            if self.call(job,'state')['pendingGatewayRequests']:break
            time.sleep(.05)
        with self.assertRaisesRegex(ValueError,'skill_update_while_busy'):
            self.call(job,'skills',{'skillVersion':'1.1.0','skillIds':['excel-report']})
        self.call(job,'abort')
        result=self.pump(job,[])
        self.assertEqual(result['status'],'aborted')
        self.assertIn('agent_settled',[e['type'] for e in result['events']])

    def test_04_idle_atomic_skill_update(self):
        job=self.job();created=self.create(job)
        before=created['skills'][2]['sha256']
        challenge='skill-context-'+uuid.uuid4().hex
        self.call(job,'prompt',{'message':challenge,'gateway':{'url':self.broker.gateway_url,'capability':'synthetic-'+job['operationId']}})
        self.pump(job,[self.text('skill-ack-'+challenge)])
        result=self.call(job,'skills',{'skillVersion':'1.1.0','skillIds':['excel-report']})
        self.assertEqual(result['state']['skillVersion'],'1.1.0')
        self.assertEqual(len(result['skills']),1);self.assertNotEqual(result['skills'][0]['sha256'],before)
        self.assertEqual([x['name'] for x in result['state']['commands'] if x['source']=='skill'],['skill:excel-report'])
        next_job=self.job(job['conversationId'],2)
        self.call(next_job,'create',{'gateway':{'url':self.broker.gateway_url,'capability':'synthetic-'+next_job['operationId']},
            'model':{'contextWindow':65536,'maxTokens':8192,'reasoning':True},'skillIds':['excel-report'],'skillVersion':'1.1.0'})
        self.call(next_job,'prompt',{'message':'核验技能更新续上下文','gateway':{'url':self.broker.gateway_url,'capability':'synthetic-'+next_job['operationId']}})
        def verify(request):
            self.assertIn(challenge,str(request['messages']));self.assertIn('skill-ack-'+challenge,str(request['messages']))
            return self.text('上下文仍在')
        self.assertEqual(self.pump(next_job,[verify])['status'],'settled')

    def test_05_empty_single_and_new_version_creation(self):
        for selected,version in [([], '1.0.0'),(['excel-report'],'1.0.0'),(['excel-report'],'1.1.0')]:
            with self.subTest(selected=selected,version=version):
                job=self.job()
                result=self.call(job,'create',{'gateway':{'url':self.broker.gateway_url,'capability':'synthetic-'+job['operationId']},
                    'model':{'contextWindow':65536,'maxTokens':8192,'reasoning':True},'skillIds':selected,'skillVersion':version})
                self.assertEqual(result['status'],'idle')
                self.assertEqual({s['id'] for s in result['skills']},set(selected))
                self.assertEqual(result['state']['skillVersion'],version)

    def test_06_real_22_turns_42_local_tools(self):
        job=self.job();self.create(job)
        self.call(job,'prompt',{'message':'进行21轮合成文件读取，最终返回完成','gateway':{'url':self.broker.gateway_url,'capability':'synthetic-'+job['operationId']}})
        replies=[]
        for _ in range(21):
            one=self.tool('read',{'path':'/opt/pi/skill-bundles/1.0.0/excel-report/references/report-format.md'})
            two=self.tool('read',{'path':'/opt/pi/skill-bundles/1.0.0/stock-replenishment/references/replenishment.md'})
            one['content'].extend(two['content']);replies.append(one)
        replies.append(self.text('42次实际工具、22轮模型调用完成'))
        result=self.pump(job,replies)
        self.assertEqual(result['status'],'settled');self.assertTrue(result['filesCollected'])
        current=[e for e in result['events'] if e['operationId']==job['operationId']]
        self.assertEqual(sum(e['type']=='tool_execution_end' for e in current),42)
        self.assertEqual(sum(e['type']=='turn_end' for e in current),22)
        self.assertEqual([e['eventSeq'] for e in current],list(range(current[0]['eventSeq'],current[-1]['eventSeq']+1)))

    def test_07_kernel_and_network_boundaries(self):
        job=self.job();created=self.create(job)
        self.call(job,'prompt',{'message':'核验合成隔离边界','gateway':{'url':self.broker.gateway_url,'capability':'synthetic-'+job['operationId']}})
        script="python3 - <<'PY'\nimport os,socket,json\nfrom pathlib import Path\nblocked=False\ntry:socket.create_connection(('8.8.8.8',53),timeout=1)\nexcept OSError:blocked=True\nro=False\ntry:Path('/opt/test-write').write_text('no')\nexcept OSError:ro=True\nassert os.getuid()==65532 and blocked and ro\nassert Path('/sys/fs/cgroup/memory.max').read_text().strip()=='1073741824'\nassert Path('/sys/fs/cgroup/pids.max').read_text().strip()=='128'\nassert Path('/sys/fs/cgroup/cpu.max').read_text().strip()=='100000 100000'\nassert not Path('/var/run/docker.sock').exists()\nassert not any(('KEY' in key or 'SECRET' in key or 'DATABASE' in key) for key in os.environ)\nprint('isolation-verified')\nPY"
        result=self.pump(job,[self.tool('bash',{'command':script}),self.text('边界通过')])
        self.assertEqual(result['status'],'settled')
        self.assertIn('isolation-verified',str(result['events']))
        session=self.broker.sessions[created['state']['workspaceId']]
        self.broker.inspect(session)
        check="import sys,json,pathlib;needle=json.loads(sys.stdin.buffer.read())['needle'].encode();assert not any(needle in p.read_bytes() for root in ['/workspace/home','/workspace/sessions'] for p in pathlib.Path(root).rglob('*') if p.is_file());print('capability-not-persisted')"
        raw=self.broker.docker_command(['exec','--interactive',session.container,'python3','-I','-c',check],raw=__import__('pi_runner.protocol',fromlist=['encode']).encode({'needle':'synthetic-'+job['operationId']}))
        self.assertIn(b'capability-not-persisted',raw)

    def test_08_idle_stop_resume_preserves_home(self):
        job=self.job();created=self.create(job);session=self.broker.sessions[created['state']['workspaceId']]
        challenge='challenge-'+uuid.uuid4().hex
        self.call(job,'prompt',{'message':'设置持久文件 '+challenge,'gateway':{'url':self.broker.gateway_url,'capability':'synthetic-'+job['operationId']}})
        self.pump(job,[self.tool('bash',{'command':"printf 'persistent' > /workspace/home/idle-marker"}),self.text('ack-'+challenge)])
        saved=self.broker.limits.copy();self.broker.limits['idleSeconds']=1
        session.last_activity=time.monotonic()-5
        self.broker.stop_monitor.clear();monitor=threading.Thread(target=self.broker.monitor,daemon=True);monitor.start()
        try:
            deadline=time.monotonic()+10
            while session.phase!='stopped' and time.monotonic()<deadline:time.sleep(.05)
            self.assertEqual(session.phase,'stopped')
        finally:self.broker.stop_monitor.set();monitor.join(5);self.broker.limits=saved
        next_job=self.job(job['conversationId'],2);self.create(next_job)
        self.call(next_job,'prompt',{'message':'读取持久文件','gateway':{'url':self.broker.gateway_url,'capability':'synthetic-'+next_job['operationId']}})
        def verify_context(request):
            transcript=str(request['messages']);self.assertIn('设置持久文件 '+challenge,transcript);self.assertIn('ack-'+challenge,transcript)
            return self.tool('bash',{'command':'cat /workspace/home/idle-marker'})
        result=self.pump(next_job,[verify_context,self.text('恢复完成')])
        self.assertEqual(result['status'],'settled');self.assertIn('persistent',str(result['events']))

    def test_09_soft_workspace_file_limit_stops_exact_container(self):
        job=self.job();created=self.create(job);session=self.broker.sessions[created['state']['workspaceId']]
        self.call(job,'prompt',{'message':'创建合成限额测试文件','gateway':{'url':self.broker.gateway_url,'capability':'synthetic-'+job['operationId']}})
        pending=[];deadline=time.monotonic()+10
        while not pending and time.monotonic()<deadline:
            pending=self.call(job,'state')['pendingGatewayRequests'];time.sleep(.05)
        self.assertTrue(pending)
        tool=self.tool('bash',{'command':"python3 -c \"from pathlib import Path; [(Path('/workspace/work')/('quota-'+str(i))).write_text('x') for i in range(150)]\""})
        self.call(job,'gateway_response',{'requestId':pending[0]['requestId'],'response':{'message':tool}})
        saved=self.broker.limits.copy();self.broker.limits['workspaceFiles']=100
        self.broker.stop_monitor.clear();monitor=threading.Thread(target=self.broker.monitor,daemon=True);monitor.start()
        try:
            deadline=time.monotonic()+10
            while session.phase not in {'frozen','unknown'} and time.monotonic()<deadline:time.sleep(.05)
            self.assertEqual(session.phase,'frozen')
            state=decode(self.broker.docker_command(['inspect','--format','{{json .State}}',session.container]))
            self.assertFalse(state['Running'])
            other=self.job(job['conversationId'],2)
            with self.assertRaisesRegex(ValueError,'session_unavailable'):self.create(other)
        finally:self.broker.stop_monitor.set();monitor.join(5);self.broker.limits=saved

    def test_10_workspace_cannot_select_trusted_skill_version(self):
        job=self.job();created=self.create(job);session=self.broker.sessions[created['state']['workspaceId']]
        self.call(job,'prompt',{'message':'模拟不可信工作区修改','gateway':{'url':self.broker.gateway_url,'capability':'synthetic-'+job['operationId']}})
        tamper="printf '%s' '{\"version\":\"1.1.0\",\"ids\":[\"sales-promotion-inventory\",\"stock-replenishment\",\"excel-report\"]}' > /workspace/skill-selection.json"
        self.pump(job,[self.tool('bash',{'command':tamper}),self.text('合成篡改完成')])
        old=session.proc;session.proc=None;old.stdin.close();old.wait(timeout=15);session.phase='stopped'
        next_job=self.job(job['conversationId'],2)
        result=self.create(next_job)
        self.assertEqual(result['state']['skillVersion'],'1.0.0')
        self.assertTrue(all('/1.0.0/' in x['sourceInfo']['path'] for x in result['state']['commands'] if x['source']=='skill'))
        self.assertEqual({s['sha256'] for s in result['skills']},{s['sha256'] for s in created['skills']})

    def test_11_broker_restart_resumes_only_terminal_workspace(self):
        job=self.job();created=self.create(job);session=self.broker.sessions[created['state']['workspaceId']]
        self.call(job,'prompt',{'message':'写重启标记','gateway':{'url':self.broker.gateway_url,'capability':'synthetic-'+job['operationId']}})
        self.pump(job,[self.tool('bash',{'command':"printf 'restart-kept' > /workspace/home/restart-marker"}),self.text('完成')])
        old_broker=self.broker;old_broker.stop_monitor.set();session.phase='disposed';session.active=None
        old_broker.ledger.db.close();old_broker.lock_file.close()
        type(self).broker=Broker(decode(Path(CONFIG).read_bytes()));self.broker.stop_monitor.set()
        next_job=self.job(job['conversationId'],2);self.create(next_job)
        session.proc.stdin.close();session.proc.wait(timeout=5)
        self.call(next_job,'prompt',{'message':'核验重启文件','gateway':{'url':self.broker.gateway_url,'capability':'synthetic-'+next_job['operationId']}})
        result=self.pump(next_job,[self.tool('bash',{'command':'cat /workspace/home/restart-marker'}),self.text('恢复成功')])
        self.assertEqual(result['status'],'settled');self.assertIn('restart-kept',str(result['events']))

    def test_12_crashed_active_operation_cannot_replay_new_id(self):
        job=self.job();created=self.create(job);session=self.broker.sessions[created['state']['workspaceId']]
        self.call(job,'prompt',{'message':'模拟接收后中断而不调用付费模型','gateway':{'url':self.broker.gateway_url,'capability':'synthetic-'+job['operationId']}})
        deadline=time.monotonic()+10
        pending=[]
        while not pending and time.monotonic()<deadline:
            pending=self.call(job,'state')['pendingGatewayRequests'];time.sleep(.05)
        self.assertTrue(pending)
        background=self.tool('bash',{'command':"(while true; do printf x >> /workspace/work/unknown-background; sleep 0.1; done) >/dev/null 2>&1 & echo background-started"})
        self.call(job,'gateway_response',{'requestId':pending[0]['requestId'],'response':{'message':background}})
        first_request=pending[0]['requestId'];deadline=time.monotonic()+10
        while time.monotonic()<deadline:
            pending=self.call(job,'state')['pendingGatewayRequests']
            if any(p['requestId']!=first_request for p in pending):break
            time.sleep(.05)
        def size():return int(self.broker.docker_command(['exec',session.container,'python3','-I','-c',"from pathlib import Path;print(Path('/workspace/work/unknown-background').stat().st_size)"]).strip())
        before=size();time.sleep(.3);self.assertGreater(size(),before)
        old_broker=self.broker;old_broker.stop_monitor.set();session.phase='disposed';session.active=None
        old_broker.ledger.db.close();old_broker.lock_file.close()
        type(self).broker=Broker(decode(Path(CONFIG).read_bytes()));self.broker.stop_monitor.set()
        next_job=self.job(job['conversationId'],2)
        try:
            with self.assertRaisesRegex(ValueError,'unresolved_previous_session|session_unavailable'):self.create(next_job)
            self.assertEqual(self.call(job,'state')['status'],'unknown')
            self.assertTrue(self.call(job,'state')['state']['restartStopVerified'])
            current=decode(self.broker.docker_command(['inspect',session.container]))[0]
            self.assertFalse(current['State']['Running'])
            health=self.broker.health()
            self.assertEqual(health['unresolvedCount'],1);self.assertEqual(health['unsafeUnknownCount'],0)
            self.assertEqual(health['unknownStoppedVerifiedCount'],1);verify_stop_readiness(health)
            self.broker.docker_command(['start',session.container])
            health=self.broker.health();self.assertEqual(health['unresolvedCount'],1);self.assertEqual(health['unsafeUnknownCount'],1)
            with self.assertRaisesRegex(ValueError,'active_or_unsafe_unknown'):verify_stop_readiness(health)
            self.broker.docker_command(['stop','--time','1',session.container])
            verify_stop_readiness(self.broker.health())
            with self.broker.ledger.lock:
                status=self.broker.ledger.db.execute('SELECT status FROM sessions WHERE workspace=?',(session.key,)).fetchone()[0]
            self.assertEqual(status,'unknown')
        finally:
            # Explicit test cleanup only, after proving the runner itself did
            # not adopt, replay, remove or silently clean the unknown operation.
            self.broker.inspect(session)
            self.call(job,'dispose')
            with self.assertRaisesRegex(ValueError,'frozen_workspace_requires_generation'):
                other=self.job(job['conversationId'],3);self.create(other)
            session.proc.stdin.close();session.proc.wait(timeout=5)
            meta=decode(self.broker.docker_command(['volume','inspect',session.volume]))[0]
            self.assertEqual(meta['Labels']['teruisi.pi.workspace'],session.key)
            self.broker.docker_command(['volume','rm',session.volume])

    def test_13_signed_frame_keeps_protocol_and_model_binding(self):
        job=self.job();self.create(job)
        envelope={'version':1,'protocol':'anthropic','modelConfigId':'synthetic-model-a','modelVersion':'7',
            'frame':{'role':'assistant','content':[{'type':'thinking','thinking':'opaque-test','signature':'synthetic-signature'}]}}
        message={'role':'assistant','content':[{'type':'thinking','thinking':'opaque-test','thinkingSignature':json.dumps(envelope)},
            {'type':'text','text':'public answer'}],'stopReason':'stop'}
        self.call(job,'prompt',{'message':'保留合成有签名frame','gateway':{'url':self.broker.gateway_url,'capability':'synthetic-'+job['operationId']}})
        self.pump(job,[message])
        next_job=self.job(job['conversationId'],2);self.create(next_job)
        self.call(next_job,'prompt',{'message':'核frame绑定','gateway':{'url':self.broker.gateway_url,'capability':'synthetic-'+next_job['operationId']}})
        def verify(request):
            assistants=[m for m in request['messages'] if m['role']=='assistant' and m.get('providerFrame')]
            self.assertTrue(assistants);self.assertEqual(assistants[-1]['providerFrame'],envelope)
            self.assertNotIn('reasoning_content',assistants[-1])
            return self.text('绑定保留')
        self.assertEqual(self.pump(next_job,[verify])['status'],'settled')
        self.call(next_job,'ack')
        # The private native Pi session retains the envelope for model resume,
        # but the independent audit/cache SQLite must not make another copy.
        rows=self.broker.ledger.db.execute('SELECT result FROM commands WHERE result IS NOT NULL').fetchall()+self.broker.ledger.db.execute('SELECT record FROM events').fetchall()
        for (raw,) in rows:
            self.assertNotIn(b'opaque-test',raw);self.assertNotIn(b'synthetic-signature',raw)
            self.assertNotIn(('synthetic-'+next_job['operationId']).encode(),raw)
            self.assertNotIn(b'providerFrame',raw)
        self.broker.ledger.db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
        for file in self.broker.state.glob('ledger.sqlite3*'):
            raw=file.read_bytes()
            for marker in [b'opaque-test',b'synthetic-signature',('synthetic-'+next_job['operationId']).encode()]:self.assertNotIn(marker,raw)

    def test_14_sales_and_stock_skills_execute_real_scripts(self):
        job=self.job()
        selected=['sales-promotion-inventory','stock-replenishment']
        self.call(job,'create',{'gateway':{'url':self.broker.gateway_url,'capability':'synthetic-'+job['operationId']},
            'model':{'contextWindow':65536,'maxTokens':8192,'reasoning':True},'skillIds':selected,'skillVersion':'1.0.0'})
        prompt={'message':'对合成输入执行联合分析及补货试算，明确来源和缺口','gateway':{'url':self.broker.gateway_url,'capability':'synthetic-'+job['operationId']}}
        self.call(job,'prompt',prompt)
        replay=self.call(job,'prompt',prompt)
        self.assertEqual(replay['pendingGatewayRequests'],[])
        replies=[]
        for skill,reference in [('sales-promotion-inventory','metrics.md'),('stock-replenishment','replenishment.md')]:
            replies.extend([self.tool('read',{'path':f'/opt/pi/skill-bundles/1.0.0/{skill}/SKILL.md'}),
                            self.tool('read',{'path':f'/opt/pi/skill-bundles/1.0.0/{skill}/references/{reference}'})])
        script="python3 - <<'PY'\nimport json,subprocess\nfrom pathlib import Path\nw=Path('/workspace/work')\n(w/'join.json').write_text(json.dumps({'sales':[{'product_code':'SYN-A','amount_cents':-120}],'promotion':[{'product_code':'SYN-A','spend_cents':50}],'inventory':[{'product_code':'SYN-A','available':3}]}))\nsubprocess.run(['python3','/opt/pi/skill-bundles/1.0.0/sales-promotion-inventory/scripts/join_summary.py',str(w/'join.json'),'/workspace/outputs/join.json'],check=True)\n(w/'stock.json').write_text(json.dumps([{'product_code':'SYN-A','available':3,'in_transit':2,'positive_units':30,'window_days':30,'target_days':10}]))\nsubprocess.run(['python3','/opt/pi/skill-bundles/1.0.0/stock-replenishment/scripts/replenish.py',str(w/'stock.json'),'/workspace/outputs/stock.json'],check=True)\nassert json.loads(Path('/workspace/outputs/join.json').read_text())[0]['amount_cents']==-120\nassert json.loads(Path('/workspace/outputs/stock.json').read_text())[0]['suggested_units']==5\nprint('synthetic-only; source=fixture; missing=cost and real snapshots; suggestion=draft')\nPY"
        replies.extend([self.tool('bash',{'command':script}),self.text('合成来源与缺口已披露，建议仅为试算草稿')])
        result=self.pump(job,replies);self.assertEqual(result['status'],'settled')
        files={f['fileName']:json.loads(base64.b64decode(f['base64'])) for f in result['files']}
        self.assertEqual(files['join.json'][0]['amount_cents'],-120);self.assertEqual(files['stock.json'][0]['suggested_units'],5)
        self.assertIn('synthetic-only',str(result['events']))
        self.assertEqual(sum(e['type']=='response' and e.get('command')=='prompt' for e in result['events']),1)
        self.call(job,'ack');replayed_ack=self.call(job,'ack')
        self.assertTrue(all('base64' not in file for file in replayed_ack['files']))


if __name__=='__main__':unittest.main(verbosity=2)
