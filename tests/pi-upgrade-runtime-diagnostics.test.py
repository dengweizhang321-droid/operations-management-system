"""Synthetic child processes only: no WSL, production files, keys or services."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('pi_upgrade_runtime',ROOT/'tools/pi_agent_upgrade_runtime.py')
upgrade=importlib.util.module_from_spec(spec)
spec.loader.exec_module(upgrade)
SECRET='synthetic-sensitive-key-customer-payload'


class UpgradeDiagnosticsTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='pi-upgrade-diagnostics-')
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.value={'action':'apply','namespace':'pi-agent-v1','releaseParent':str(self.root),
                    'newSourceSha256':'b'*64,'syntheticSecret':SECRET}
        self.package=self.root/('b'*64)/'backend/pi_runner'
        self.package.mkdir(parents=True)
        (self.package/'__init__.py').write_text('',encoding='utf-8')

    def linux(self,body):
        # The production wrapper runs unchanged. Only getuid and the imported
        # dispatch module are synthetic, so the test can also run on Windows.
        (self.package/'runtime_upgrade.py').write_text('def dispatch(value):\n'+
            ''.join('    '+line+'\n' for line in body.splitlines()),encoding='utf-8')
        return subprocess.run([sys.executable,'-B','-c','import os\nos.getuid=lambda:1000\n'+upgrade.LINUX],
            input=json.dumps(self.value).encode(),capture_output=True,timeout=10)

    def invoke(self,result=None,error=None):
        with patch.dict(os.environ,{'SystemRoot':str(self.root)}),patch.object(
                upgrade.subprocess,'run',return_value=result,side_effect=error) as run:
            if error is None and result.returncode==0:
                answer=upgrade.invoke(self.value)
            else:
                with self.assertRaises(upgrade.UpgradeInvocationError) as raised:
                    upgrade.invoke(self.value)
                answer=upgrade.failure_document(raised.exception)
            self.assertEqual(run.call_count,1,'a diagnostic must never replay the upgrade')
        self.assertNotIn(SECRET,json.dumps(answer))
        return answer

    def test_actual_linux_child_reports_wal_reason_and_nonzero_exit(self):
        child=self.linux("raise ValueError('ledger_wal_not_checkpointed')")
        self.assertEqual(child.returncode,1)
        self.assertEqual(child.stdout,b'')
        result=self.invoke(child)
        self.assertEqual(result['error'],'pi_source_upgrade_failed_closed')
        self.assertEqual(result['diagnostic'],{'stage':'linux_apply','reason':'ledger_wal_not_checkpointed',
            'causeReasons':[],'action':'apply','directExitCode':1})

    def test_actual_linux_child_drops_sensitive_exception_and_subprocess_output(self):
        for body,reason in [
            ("raise ValueError(value['syntheticSecret'])",'unexpected_error'),
            ("raise ValueError([value['syntheticSecret']])",'unexpected_error'),
            ("import subprocess\nraise subprocess.CalledProcessError(9,[value['syntheticSecret']],output=value['syntheticSecret'],stderr=value['syntheticSecret'])",'subprocess_failed'),
            ("import subprocess\nraise subprocess.TimeoutExpired(value['syntheticSecret'],1,output=value['syntheticSecret'],stderr=value['syntheticSecret'])",'subprocess_timeout'),
            ("raise OSError(13,value['syntheticSecret'],value['syntheticSecret'])",'os_error')]:
            with self.subTest(reason=reason,body=body):
                child=self.linux(body)
                self.assertNotIn(SECRET.encode(),child.stdout+child.stderr)
                self.assertNotIn(b'Traceback',child.stderr)
                self.assertEqual(self.invoke(child)['diagnostic']['reason'],reason)

    def test_safe_exception_chain_survives_rejected_candidate(self):
        child=self.linux("try:\n    raise ValueError('source_upgrade_candidate_unknown')\nexcept ValueError:\n    raise ValueError('source_upgrade_rejected_old_retained')")
        detail=self.invoke(child)['diagnostic']
        self.assertEqual(detail['reason'],'source_upgrade_rejected_old_retained')
        self.assertEqual(detail['causeReasons'],['source_upgrade_candidate_unknown'])

    def test_windows_warning_is_discarded_and_one_safe_record_is_preserved(self):
        child=self.linux("raise ValueError('source_upgrade_unknown_no_replay')")
        child.stderr=SECRET.encode()+b' WSL warning\n'+child.stderr
        self.assertEqual(self.invoke(child)['diagnostic']['reason'],'source_upgrade_unknown_no_replay')

    def test_nonzero_exit_never_accepts_success_stdout(self):
        child=self.linux("raise ValueError('ledger_wal_not_checkpointed')")
        child.returncode=23
        child.stdout=b'{"upgraded":true}'
        result=self.invoke(child)
        self.assertEqual(result['diagnostic']['directExitCode'],23)
        self.assertNotIn('upgraded',result)

    def test_bad_diagnostic_shapes_are_unknown_without_echo(self):
        good={'piUpgradeFailure':1,'stage':'linux_apply','reason':'ledger_wal_not_checkpointed','causeReasons':[]}
        invalid=[b'legacy traceback '+SECRET.encode(),
            (json.dumps(good)+'\n'+json.dumps(good)).encode(),
            b'x'*4097,
            json.dumps({**good,'reason':SECRET}).encode(),
            json.dumps({**good,'stage':['linux_apply']}).encode(),
            json.dumps({**good,'stage':'linux_prepare'}).encode(),
            json.dumps({**good,'causeReasons':[SECRET]}).encode(),
            json.dumps({**good,'causeReasons':['os_error']*4}).encode(),
            json.dumps({**good,'piUpgradeFailure':True}).encode(),
            json.dumps({**good,'raw':SECRET}).encode()]
        for stderr in invalid:
            with self.subTest(stderr=stderr[:50]):
                child=subprocess.CompletedProcess(['synthetic'],7,b'',stderr)
                self.assertEqual(self.invoke(child)['diagnostic'],{'stage':'wsl_transport',
                    'reason':'linux_failure_unknown','action':'apply','directExitCode':7})

    def test_transport_timeout_does_not_infer_success_from_partial_output(self):
        result=self.invoke(error=subprocess.TimeoutExpired(SECRET,180,output=b'{"upgraded":true}',stderr=SECRET.encode()))
        self.assertEqual(result['diagnostic'],{'stage':'wsl_transport','action':'apply',
            'reason':'wsl_timeout','directExitCode':None})

    def test_transport_launch_failure_is_redacted(self):
        result=self.invoke(error=OSError(2,SECRET,SECRET))
        self.assertEqual(result['diagnostic']['reason'],'wsl_launch_failed')

    def test_malformed_success_remains_unknown(self):
        for stdout in [b'',b'[]',b'null',b'{}\n{}',SECRET.encode(),b'\xff']:
            with self.subTest(stdout=stdout):
                with patch.dict(os.environ,{'SystemRoot':str(self.root)}),patch.object(
                        upgrade.subprocess,'run',return_value=subprocess.CompletedProcess([],0,stdout,b'')) as run:
                    with self.assertRaises(upgrade.UpgradeInvocationError) as raised:
                        upgrade.invoke(self.value)
                detail=upgrade.failure_document(raised.exception)['diagnostic']
                self.assertEqual(detail['reason'],'pi_source_upgrade_response_unknown')
                self.assertEqual(detail['directExitCode'],0)
                self.assertEqual(run.call_count,1)

    def test_valid_success_contract_is_unchanged(self):
        child=self.linux("return {'upgraded':True,'operationId':'synthetic-operation'}")
        self.assertEqual(child.returncode,0)
        self.assertEqual(child.stderr,b'')
        self.assertEqual(self.invoke(child),{'upgraded':True,'operationId':'synthetic-operation'})

    def test_zero_exit_with_conflicting_failure_record_is_unknown(self):
        child=self.linux("raise ValueError('ledger_wal_not_checkpointed')")
        child.returncode=0
        child.stdout=b'{"upgraded":true}'
        with patch.dict(os.environ,{'SystemRoot':str(self.root)}),patch.object(
                upgrade.subprocess,'run',return_value=child) as run:
            with self.assertRaises(upgrade.UpgradeInvocationError) as raised:
                upgrade.invoke(self.value)
        self.assertEqual(run.call_count,1)
        self.assertEqual(raised.exception.diagnostic['reason'],'pi_source_upgrade_response_unknown')

    def test_windows_local_exception_text_is_never_echoed(self):
        for error in [ValueError(SECRET),ValueError([SECRET]),OSError(13,SECRET,SECRET)]:
            answer=upgrade.failure_document(error)
            self.assertNotIn(SECRET,json.dumps(answer))
            self.assertEqual(answer['diagnostic']['stage'],'windows_upgrade')
        self.assertEqual(upgrade.failure_document(ValueError('upgrade_predecessor_changed'))['diagnostic']['reason'],
                         'upgrade_predecessor_changed')

    def test_actual_cli_refusal_remains_json_and_exit_one(self):
        child=subprocess.run([sys.executable,'-B',str(ROOT/'tools/pi_agent_upgrade_runtime.py'),
            'apply','--runtime',str(self.root),'--execute'],capture_output=True,timeout=10)
        self.assertEqual(child.returncode,1)
        self.assertEqual(child.stderr,b'')
        answer=json.loads(child.stdout)
        self.assertEqual(answer['message'],upgrade.FAILURE_MESSAGE)
        self.assertEqual(answer['diagnostic'],{'stage':'windows_upgrade','reason':'native_pi_upgrade_required'})


if __name__=='__main__':unittest.main()
