"""Real CurrentUser DPAPI; the transport boundary is independently injected."""
import base64
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from .protocol import encode
from .wsl_control import control


@unittest.skipUnless(os.name=='nt','Windows CurrentUser DPAPI only')
class WindowsKeyBindingTests(unittest.TestCase):
    def test_dpapi_wrapper_and_channel_hash_are_distinct_and_verified(self):
        from pandas_runner.key_file import dpapi
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);key=os.urandom(32);key_file=root/'key.dpapi.json';config_file=root/'config.json'
            key_file.write_bytes(encode({'version':1,'keyDpapiBase64':base64.b64encode(dpapi(key,protect=True)).decode()}))
            config={'version':1,'enabled':True,'runnerSourceSha256':'a'*64,'runnerImage':'sha256:'+'b'*64,
                'keyFileSha256':hashlib.sha256(key_file.read_bytes()).hexdigest(),'channelKeySha256':hashlib.sha256(key).hexdigest()}
            self.assertNotEqual(config['keyFileSha256'],config['channelKeySha256'])
            config_file.write_bytes(encode(config))
            def transport(url,actual_key,value,**kwargs):
                self.assertEqual(actual_key,key);self.assertEqual(kwargs['path'],'/v1/status')
                return {'image':config['runnerImage'],'sourceSha256':config['runnerSourceSha256'],'namespace':'pi-agent-v1','closing':False}
            with patch('pi_runner.wsl_control.command',side_effect=transport) as mocked:
                self.assertEqual(control('probe',config_file,key_file)['image'],config['runnerImage']);self.assertEqual(mocked.call_count,1)
                config['channelKeySha256']='c'*64;config_file.write_bytes(encode(config))
                with self.assertRaisesRegex(ValueError,'runner_channel_key_changed'):control('probe',config_file,key_file)
                self.assertEqual(mocked.call_count,1)
                config['channelKeySha256']=hashlib.sha256(key).hexdigest();config['keyFileSha256']='d'*64;config_file.write_bytes(encode(config))
                with self.assertRaisesRegex(ValueError,'runner_key_file_changed'):control('probe',config_file,key_file)
                self.assertEqual(mocked.call_count,1)

    def test_stop_on_an_already_inactive_unit_is_a_success_without_probing(self):
        # Real incident: stopping a Pi unit whose HTTP service was not
        # listening used to probe first and raise urllib.error.URLError
        # (WinError 10061, connection actively refused), making an idempotent
        # stop fail. ActiveState=inactive must short-circuit to success
        # before any probe() HTTP attempt is made.
        from pandas_runner.key_file import dpapi
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);key=os.urandom(32);key_file=root/'key.dpapi.json';config_file=root/'config.json'
            key_file.write_bytes(encode({'version':1,'keyDpapiBase64':base64.b64encode(dpapi(key,protect=True)).decode()}))
            config={'version':1,'enabled':True,'runnerSourceSha256':'a'*64,'runnerImage':'sha256:'+'b'*64,
                'keyFileSha256':hashlib.sha256(key_file.read_bytes()).hexdigest(),'channelKeySha256':hashlib.sha256(key).hexdigest()}
            config_file.write_bytes(encode(config))
            working_directory=('/home/teruisi-pandas/.local/share/teruisi-pi-runner/releases/'+config['runnerSourceSha256']+'/backend')
            exec_start=('/usr/bin/python3 -B -m pi_runner.server --config /home/teruisi-pandas/.local/share/'
                'teruisi-pi-runner/releases/'+config['runnerSourceSha256']+'/config.json')
            responses=iter([working_directory,exec_start,'inactive'])
            def fake_run(args,**kwargs):
                self.assertNotIn('start',args);self.assertNotIn('stop',args)
                result=subprocess.CompletedProcess(args,0,stdout=next(responses).encode(),stderr=b'')
                return result
            with patch('pi_runner.wsl_control.subprocess.run',side_effect=fake_run) as mocked_run, \
                 patch('pi_runner.wsl_control.command') as mocked_probe:
                result=control('stop',config_file,key_file)
                self.assertEqual(result,{'stopped':True,'image':config['runnerImage'],'sourceSha256':config['runnerSourceSha256']})
                mocked_probe.assert_not_called()
                self.assertEqual(mocked_run.call_count,3)

    def test_stop_on_an_active_unit_still_probes_and_verifies_readiness_first(self):
        # Regression guard for the fix above: a genuinely running unit must
        # still go through the full probe -> verify_stop_readiness -> stop
        # -> verify sequence; the inactive short-circuit must not skip
        # readiness verification for a unit that is actually active.
        from pandas_runner.key_file import dpapi
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);key=os.urandom(32);key_file=root/'key.dpapi.json';config_file=root/'config.json'
            key_file.write_bytes(encode({'version':1,'keyDpapiBase64':base64.b64encode(dpapi(key,protect=True)).decode()}))
            config={'version':1,'enabled':True,'runnerSourceSha256':'a'*64,'runnerImage':'sha256:'+'b'*64,
                'keyFileSha256':hashlib.sha256(key_file.read_bytes()).hexdigest(),'channelKeySha256':hashlib.sha256(key).hexdigest()}
            config_file.write_bytes(encode(config))
            working_directory=('/home/teruisi-pandas/.local/share/teruisi-pi-runner/releases/'+config['runnerSourceSha256']+'/backend')
            exec_start=('/usr/bin/python3 -B -m pi_runner.server --config /home/teruisi-pandas/.local/share/'
                'teruisi-pi-runner/releases/'+config['runnerSourceSha256']+'/config.json')
            responses=iter([working_directory,exec_start,'active','','inactive'])
            def fake_run(args,**kwargs):
                return subprocess.CompletedProcess(args,0,stdout=next(responses).encode(),stderr=b'')
            def fake_probe(url,actual_key,value,**kwargs):
                return {'image':config['runnerImage'],'sourceSha256':config['runnerSourceSha256'],'namespace':'pi-agent-v1',
                    'closing':False,'activeCount':0,'unresolvedCount':0,'unsafeUnknownCount':0,'unknownStoppedVerifiedCount':0}
            with patch('pi_runner.wsl_control.subprocess.run',side_effect=fake_run) as mocked_run, \
                 patch('pi_runner.wsl_control.command',side_effect=fake_probe) as mocked_probe:
                result=control('stop',config_file,key_file)
                self.assertEqual(result,{'stopped':True,'image':config['runnerImage'],'sourceSha256':config['runnerSourceSha256']})
                self.assertEqual(mocked_probe.call_count,1)
                self.assertEqual(mocked_run.call_count,5)

    def test_cli_entry_point_writes_the_real_exception_to_stderr_while_stdout_stays_fixed(self):
        # Real incident: the catch-all printed only a fixed error string, so
        # the actual urllib.error.URLError/WinError 10061 cause was
        # unreachable without bypassing the CLI. A missing --config path is
        # a deterministic, platform-independent way to reach the except
        # Exception branch without needing WSL or a live Pi unit.
        missing_config=os.path.join(tempfile.gettempdir(),'does-not-exist-'+os.urandom(8).hex()+'.json')
        missing_key=os.path.join(tempfile.gettempdir(),'does-not-exist-'+os.urandom(8).hex()+'.json')
        completed=subprocess.run(
            [sys.executable,'-m','pi_runner.wsl_control','probe','--config',missing_config,'--key-file',missing_key],
            cwd=str(Path(__file__).resolve().parent.parent),capture_output=True,text=True,timeout=30,
        )
        self.assertEqual(completed.returncode,1)
        self.assertEqual(completed.stdout.strip(),'{"error":"pi_runner_lifecycle_failed_closed"}')
        self.assertIn('FileNotFoundError',completed.stderr)
        # Match only the unique basename: str(OSError) on Windows renders the
        # path with escaped backslashes, so asserting the raw path literal
        # would depend on that formatting rather than on real diagnosability.
        self.assertIn(os.path.basename(missing_config),completed.stderr)


if __name__=='__main__':unittest.main()
