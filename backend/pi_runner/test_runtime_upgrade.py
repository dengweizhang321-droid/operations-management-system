"""Actual isolated old-source user-unit -> new-source signed Runner handoff."""
import base64
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import time
import unittest
import uuid
import tempfile
import importlib.util

from .client import command
from .protocol import HEALTH_PATH,decode,encode
from .runtime_upgrade import prepare,apply,check,reconcile,systemctl,source_digest,sha

CONFIG=os.environ.get('PI_RUNNER_TEST_CONFIG')
LEGACY=os.environ.get('PI_RUNNER_LEGACY_SOURCE_DIR')


@unittest.skipUnless(os.name=='nt','CurrentUser DPAPI Windows boundary')
class WindowsSourceUpgradeReceiptTests(unittest.TestCase):
    def test_response_loss_config_stages_fragments_and_same_dpapi_owner(self):
        from pandas_runner.key_file import dpapi,read_key
        path=Path(__file__).resolve().parents[2]/'tools/pi_agent_upgrade_runtime.py'
        spec=importlib.util.spec_from_file_location('pi_upgrade_test_tool',path);tool=importlib.util.module_from_spec(spec);spec.loader.exec_module(tool)
        with tempfile.TemporaryDirectory(prefix='pi-source-reconcile-') as folder:
            root=Path(folder);key=os.urandom(32);key_file=root/'key.dpapi.json'
            tool.publish(key_file,{'version':1,'keyDpapiBase64':base64.b64encode(dpapi(key,protect=True)).decode()})
            wrapper=key_file.read_bytes();self.assertEqual(read_key(key_file),key)
            old={'version':1,'runnerSourceSha256':'a'*64,'runnerImage':'sha256:'+'b'*64,'channelKeySha256':sha(key),'keyFileSha256':sha(wrapper)}
            new={**old,'runnerSourceSha256':'c'*64,'runnerImage':'sha256:'+'d'*64}
            old_raw=encode(old);new_raw=encode(new)
            receipt={'oldWindowsConfigSha256':sha(old_raw),'newWindowsConfig':new}
            original={'upgraded':True,'operationId':'operation-fixed','planSha256':'e'*64,'sourceSha256':'c'*64,'image':'sha256:'+'d'*64,
                      'freshStateSha256':'f'*64,'candidateStateSha256':'1'*64,'oldReleaseRetained':True}
            config_file=root/'config.json';result_file=root/'result.json'
            config_file.write_bytes(old_raw);config_file.with_name('config.json.new').write_bytes(new_raw)
            tool.finish_windows(config_file,result_file,receipt,{**original,'reconciled':True},sha(wrapper),reconcile=True)
            self.assertEqual(config_file.read_bytes(),new_raw)
            # Lost response after config publication and partial result write.
            result_file.unlink()
            expected={**original,'windowsConfigSha256':sha(new_raw),'windowsKeyFileSha256':sha(wrapper)}
            fragment=result_file.with_name('result.json.new');fragment.write_bytes(encode(expected))
            tool.finish_windows(config_file,result_file,receipt,{**original,'reconciled':True},sha(wrapper),reconcile=True)
            self.assertEqual(result_file.read_bytes(),encode(expected))
            exact=result_file.read_bytes()
            tool.finish_windows(config_file,result_file,receipt,{**original,'reconciled':True},sha(wrapper),reconcile=True)
            self.assertEqual(result_file.read_bytes(),exact)
            self.assertEqual(key_file.read_bytes(),wrapper);self.assertEqual(read_key(key_file),key)
            config_file.write_bytes(b'foreign-config')
            with self.assertRaisesRegex(ValueError,'foreign_config'):
                tool.finish_windows(config_file,result_file,receipt,{**original,'reconciled':True},sha(wrapper),reconcile=True)
            self.assertEqual(config_file.read_bytes(),b'foreign-config')
            config_file.write_bytes(new_raw);result_file.unlink();fragment.write_bytes(b'foreign-result')
            with self.assertRaisesRegex(ValueError,'foreign_fragment'):
                tool.finish_windows(config_file,result_file,receipt,{**original,'reconciled':True},sha(wrapper),reconcile=True)
            self.assertEqual(fragment.read_bytes(),b'foreign-result')


@unittest.skipUnless(CONFIG and LEGACY and os.environ.get('PI_RUNNER_UPGRADE_FROM_IMAGE'),'actual legacy source/image required')
class SourceUpgradeRealTests(unittest.TestCase):
    def test_online_prepare_fresh_ledger_unknown_and_same_session_continuation(self):
        config=decode(Path(CONFIG).read_bytes());namespace=config['namespace']
        self.assertTrue(namespace.startswith('pi-test-'))
        task_root=Path(CONFIG).parent;base=task_root/'releases';base.mkdir(mode=0o700)
        key=Path(config['keyFile']).read_bytes();old_image=os.environ['PI_RUNNER_UPGRADE_FROM_IMAGE']
        old_sha=subprocess.check_output(['/usr/bin/env','PYTHONPATH='+LEGACY,'/usr/bin/python3','-B','-c',
            'from pi_runner.install_linux import source_digest;print(source_digest())']).decode().strip()
        old=base/old_sha;old.mkdir(mode=0o700);shutil.copytree(Path(LEGACY)/'pi_runner',old/'backend/pi_runner')
        (old/'state').mkdir(mode=0o700);(old/'channel.key').write_bytes(key);os.chmod(old/'channel.key',0o600)
        old_config={**config,'image':old_image,'keyFile':str(old/'channel.key'),'stateDirectory':str(old/'state')}
        (old/'config.json').write_bytes(encode(old_config));os.chmod(old/'config.json',0o600)
        sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close()
        unit_name=namespace+'.service';unit=Path.home()/'.config/systemd/user'/unit_name
        self.assertFalse(unit.exists())
        unit_text='\n'.join(['[Unit]','Description=Isolated Pi source upgrade proof','[Service]','Type=simple',
            'WorkingDirectory='+str(old/'backend'),'ExecStart=/usr/bin/python3 -B -m pi_runner.server --config '+str(old/'config.json')+' --port '+str(port),
            'UMask=0077','NoNewPrivileges=yes','Restart=no','KillMode=mixed','TimeoutStopSec=5',''])
        unit.write_text(unit_text);os.chmod(unit,0o600);(old/'pi-runner.service').write_text(unit_text);os.chmod(old/'pi-runner.service',0o600)
        url='http://127.0.0.1:'+str(port);jobs=[]
        docker=[config['docker']];env={**os.environ,'DOCKER_HOST':'unix://'+config['socket']}
        def dc(*args):return subprocess.check_output([*docker,*args],env=env)
        def call(job,name,payload=None):return command(url,key,{**job,'command':name,'payload':payload or {}},timeout=60)
        def identity(conversation=None,seq=1):
            value={'operationId':'source-'+uuid.uuid4().hex,'ownerId':'synthetic@example.invalid','conversationId':conversation or 'conversation-'+uuid.uuid4().hex,'epoch':1,'generation':1,'seq':seq};jobs.append(value);return value
        def create(job):return call(job,'create',{'gateway':{'url':config['gatewayUrl'],'capability':'synthetic-'+job['operationId']},'model':{'contextWindow':65536,'maxTokens':8192,'reasoning':True}})
        def prompt(job,text,reply=None,verify=None):
            call(job,'prompt',{'message':text,'timeoutMs':600000,'gateway':{'url':config['gatewayUrl'],'capability':'synthetic-'+job['operationId']}})
            end=time.monotonic()+30;seen=set()
            while time.monotonic()<end:
                state=call(job,'state')
                for request in state['pendingGatewayRequests']:
                    if request['requestId'] in seen:continue
                    seen.add(request['requestId'])
                    if verify:verify(request)
                    if reply is None:return state
                    call(job,'gateway_response',{'requestId':request['requestId'],'response':{'message':{'role':'assistant','content':[{'type':'text','text':reply}],'stopReason':'stop'}}})
                if state['status']=='settled':return state
                time.sleep(.03)
            self.fail('isolated_signed_runner_timeout')
        try:
            systemctl(unit_name,'daemon-reload');systemctl(unit_name,'start')
            for _ in range(100):
                try:
                    health=command(url,key,{},path=HEALTH_PATH,timeout=1);break
                except Exception:time.sleep(.1)
            self.assertEqual(health['sourceSha256'],old_sha)
            first=identity();create(first);self.assertEqual(prompt(first,'source-history-first','source-answer-first')['status'],'settled')
            value={'action':'prepare','operationId':uuid.uuid4().hex,'namespace':namespace,'unitName':unit_name,'unitPath':str(unit),
                'releaseParent':str(base),'port':port,'oldSourceSha256':old_sha,'newSourceSha256':source_digest(),
                'oldImage':old_image,'newImage':config['image'],'channelKeySha256':sha(key),
                'windowsConfigSha256':'a'*64,'windowsKeyFileSha256':'b'*64}
            prepared=prepare(value);self.assertTrue(prepared['prepared']);self.assertFalse(prepared['started'])
            self.assertEqual(command(url,key,{},path=HEALTH_PATH)['sourceSha256'],old_sha)
            self.assertTrue(check({**value,'action':'check','planSha256':prepared['planSha256']})['checked'])
            # Intervening live work occurs AFTER online preparation. Apply must
            # copy these new ledger messages and snapshot bytes, not stale data.
            second=identity(first['conversationId'],2);create(second)
            self.assertEqual(prompt(second,'source-history-after-prepare','source-answer-after-prepare')['status'],'settled')
            downloads=old/'state/workspace-downloads';downloads.mkdir(mode=0o700)
            (downloads/'synthetic-snapshot').write_bytes(b'immutable-after-prepare')
            unknown=identity();create(unknown);prompt(unknown,'unknown-source-model',None)
            # Simulate the exact old broker being lost, then explicitly fence
            # only this test namespace's containers before source handoff.
            systemctl(unit_name,'kill','--signal=SIGKILL');systemctl(unit_name,'stop');systemctl(unit_name,'reset-failed')
            for container_id in dc('ps','-aq','--filter','label=teruisi.pi.namespace='+namespace).decode().split():
                meta=decode(dc('inspect',container_id))[0]
                self.assertEqual(meta['Config']['Labels']['teruisi.pi.namespace'],namespace)
                if meta['State']['Running']:dc('stop','--time','1',meta['Id'])
            result=apply({**value,'action':'apply','planSha256':prepared['planSha256']})
            self.assertTrue(result['upgraded']);self.assertTrue(result['oldReleaseRetained'])
            candidate_pid=systemctl(unit_name,'show','--property=MainPID','--value')
            recovered=reconcile({**value,'action':'reconcile','planSha256':prepared['planSha256']})
            self.assertTrue(recovered['reconciled'])
            self.assertEqual(systemctl(unit_name,'show','--property=MainPID','--value'),candidate_pid)
            new=base/value['newSourceSha256']
            self.assertEqual((new/'state/workspace-downloads/synthetic-snapshot').read_bytes(),b'immutable-after-prepare')
            self.assertEqual((old/'channel.key').read_bytes(),(new/'channel.key').read_bytes())
            health=command(url,key,{},path=HEALTH_PATH)
            self.assertEqual(health['sourceSha256'],value['newSourceSha256'])
            self.assertEqual(call(unknown,'state')['status'],'unknown')
            observed=call(second,'workspace',{'action':'state'})['workspace']
            self.assertEqual(observed['environmentStatus'],'stopped')
            third=identity(first['conversationId'],3);create(third)
            def history(request):
                text=json.dumps(request['messages'],ensure_ascii=False)
                self.assertIn('source-history-after-prepare',text);self.assertIn('source-answer-after-prepare',text)
            self.assertEqual(prompt(third,'source-after-cutover','new-source-answer',history)['status'],'settled')
            proof={'passed':True,'oldSourceSha256':old_sha,'newSourceSha256':value['newSourceSha256'],'oldImage':old_image,'newImage':config['image'],
                'freshStateSha256':result['freshStateSha256'],'unknownPreserved':True,'sameSessionContinued':True,'interveningWorkPreserved':True,'sameChannelKey':True,'unit':unit_name,'port':port}
            (task_root/'source-upgrade-proof.json').write_bytes(encode(proof))
        finally:
            try:systemctl(unit_name,'stop')
            except Exception:pass
            if unit.exists():unit.unlink();systemctl(unit_name,'daemon-reload')
            for container_id in dc('ps','-aq','--filter','label=teruisi.pi.namespace='+namespace).decode().split():
                meta=decode(dc('inspect',container_id))[0];self.assertEqual(meta['Config']['Labels']['teruisi.pi.namespace'],namespace);dc('rm','--force',meta['Id'])
            for volume in dc('volume','ls','-q','--filter','label=teruisi.pi.namespace='+namespace).decode().split():
                meta=decode(dc('volume','inspect',volume))[0];self.assertEqual(meta['Labels']['teruisi.pi.namespace'],namespace);dc('volume','rm',volume)
