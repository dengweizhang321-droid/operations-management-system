"""Synthetic child processes only: no WSL, production files, keys or services."""
import argparse
import importlib.util
import io
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
_MISSING=object()


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

    def test_utf16_wsl_warning_then_utf8_failure_keeps_exact_record(self):
        child=self.linux("raise ValueError('fixed_upgrade_owner_required')")
        warning=('wsl: \u542f\u52a8\u8b66\u544a '+SECRET+'\r\n').encode('utf-16-le')
        child.stderr=warning+child.stderr
        self.assertEqual(self.invoke(child)['diagnostic']['reason'],'fixed_upgrade_owner_required')

    def test_mixed_encoding_fix_does_not_normalize_arbitrary_nuls(self):
        good=json.dumps({'piUpgradeFailure':1,'stage':'linux_apply',
            'reason':'fixed_upgrade_owner_required','causeReasons':[]}).encode()
        warning='wsl: synthetic warning\r\n'.encode('utf-16-le')
        for stderr in [b'\x00'+good,warning+b'\x00'+good,
                       warning+good.replace(b'linux_apply',b'linux_\x00apply'),
                       warning+good+b'\n'+good]:
            with self.subTest(stderr=stderr[:50]):
                child=subprocess.CompletedProcess(['synthetic'],1,b'',stderr)
                self.assertEqual(self.invoke(child)['diagnostic']['reason'],'linux_failure_unknown')

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


class RebuiltImageReplacementEligibility(unittest.TestCase):
    """The 'rebuild death loop': build_image.py is not actually reproducible
    (same source, same lock files, different Docker layer metadata each
    build), so a retried `prepare` gets a new image id every time. Only when
    every OTHER field of the registered plan still matches, and neither side
    of that plan was ever dispatched, may `prepared.json` be replaced."""
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='pi-upgrade-rebuild-')
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.key_path=self.root/'secrets/pi-agent.dpapi.json'
        self.key_path.parent.mkdir(parents=True)
        self.key_path.write_bytes(b'private-fixture-dpapi-ciphertext')
        self.old_raw=json.dumps({'version':1,'runnerSourceSha256':'a'*64},sort_keys=True).encode()
        self.new_sha='b'*64
        self.plan={'operationId':'f'*32,'newSourceSha256':self.new_sha,'newImage':'sha256:'+'1'*64,
                   'releaseParent':'/home/teruisi-pandas/.local/share/teruisi-pi-runner/releases'}
        self.saved={'oldWindowsConfigSha256':upgrade.sha(self.old_raw),'windowsKeyFileSha256':upgrade.sha(self.key_path.read_bytes()),
                    'newWindowsConfig':{'skillVersion':'1.1.0'},'plan':self.plan}
        self.plan_directory=self.root/'config/pi-agent-upgrades'/self.new_sha
        self.plan_directory.mkdir(parents=True)

    def allowed(self,image='sha256:'+'2'*64,skill_version='1.1.0',new_sha=None):
        return upgrade.rebuilt_image_replacement_allowed(
            self.saved,self.old_raw,self.key_path,new_sha or self.new_sha,image,skill_version,self.plan_directory)

    def test_four_fields_equal_only_image_differs_is_allowed(self):
        result=self.allowed()
        self.assertIsNotNone(result)
        self.assertEqual(result,self.plan)

    def test_identical_image_is_not_a_replacement_case(self):
        # Same image means the original 5-way check would not have failed at
        # all; this function must not short-circuit that path into "allowed".
        self.assertIsNone(self.allowed(image=self.plan['newImage']))

    def test_old_windows_config_sha_mismatch_blocks(self):
        self.saved['oldWindowsConfigSha256']='0'*64
        self.assertIsNone(self.allowed())

    def test_windows_key_file_sha_mismatch_blocks(self):
        self.saved['windowsKeyFileSha256']='0'*64
        self.assertIsNone(self.allowed())

    def test_new_source_sha_mismatch_blocks(self):
        # Source actually changed: must stay on the strict rejection path.
        self.assertIsNone(self.allowed(new_sha='c'*64))

    def test_skill_version_mismatch_blocks(self):
        self.saved['newWindowsConfig']['skillVersion']='9.9.9'
        self.assertIsNone(self.allowed())

    def test_intent_present_blocks_even_with_four_fields_equal(self):
        (self.plan_directory/'intent.json').write_bytes(b'{}')
        self.assertIsNone(self.allowed())

    def test_result_present_blocks_even_with_four_fields_equal(self):
        (self.plan_directory/'result.json').write_bytes(b'{}')
        self.assertIsNone(self.allowed())

    def test_in_flight_fragment_blocks(self):
        for name in ('prepared.json.new','preparing.json.new','intent.json.new','result.json.new'):
            with self.subTest(name=name):
                fragment=self.plan_directory/name
                fragment.write_bytes(b'{}')
                self.assertIsNone(self.allowed())
                fragment.unlink()

    def test_malformed_plan_shape_blocks(self):
        self.saved['plan']=None
        self.assertIsNone(self.allowed())


class StaleLinuxReleaseRemoval(unittest.TestCase):
    """Executes the embedded Linux snippet directly (no wsl.exe), following
    the same private-fixture-adapter pattern as pi-upgrade-status.test.py and
    pi-agent-upgrade-residue.test.py."""
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='pi-upgrade-rebuild-linux-')
        self.addCleanup(self.temp.cleanup)
        self.base=Path(self.temp.name)
        self.sha='d'*64

    def run_remove(self,value):
        script=upgrade.LINUX_REMOVE_NEVER_DISPATCHED_RELEASE
        namespace={}
        exec(compile(script[:script.rindex('\ntry:')],'<rebuild-linux>','exec'),namespace)
        import os as real_os
        had=hasattr(real_os,'getuid');original=getattr(real_os,'getuid',None)
        real_os.getuid=lambda:1000
        try:return namespace['remove'](value)
        finally:
            if had:real_os.getuid=original
            else:delattr(real_os,'getuid')

    def write_full_release(self,folder):
        (folder/'backend/pi_runner').mkdir(parents=True)
        (folder/'backend/pi_runner/__init__.py').write_bytes(b'')
        (folder/'state').mkdir()
        for name in ('channel.key','config.json','pi-runner.service','predecessor-unit.service','source-upgrade-plan.json'):
            (folder/name).write_bytes(b'x')

    def test_absent_release_reports_already_absent(self):
        answer=self.run_remove({'releaseParent':str(self.base),'sha':self.sha})
        self.assertEqual(answer,{'removed':False,'alreadyAbsent':True})

    def test_fully_prepared_never_dispatched_release_is_removed(self):
        folder=self.base/self.sha
        self.write_full_release(folder)
        answer=self.run_remove({'releaseParent':str(self.base),'sha':self.sha})
        self.assertEqual(answer,{'removed':True,'alreadyAbsent':False})
        self.assertFalse(folder.exists())

    def test_dispatched_release_with_intent_is_refused(self):
        folder=self.base/self.sha
        self.write_full_release(folder)
        (folder/'source-upgrade-intent.json').write_bytes(b'{}')
        with self.assertRaisesRegex(ValueError,'linux_rebuild_residue_dispatched'):
            self.run_remove({'releaseParent':str(self.base),'sha':self.sha})
        self.assertTrue(folder.exists())

    def test_fragment_anywhere_in_tree_is_refused(self):
        folder=self.base/self.sha
        self.write_full_release(folder)
        (folder/'config.json.new').write_bytes(b'{}')
        with self.assertRaisesRegex(ValueError,'linux_rebuild_residue_fragment_present'):
            self.run_remove({'releaseParent':str(self.base),'sha':self.sha})
        self.assertTrue(folder.exists())

    def test_nested_fragment_under_backend_is_refused(self):
        folder=self.base/self.sha
        self.write_full_release(folder)
        (folder/'backend/pi_runner/source-upgrade-plan.json.new').write_bytes(b'{}')
        with self.assertRaisesRegex(ValueError,'linux_rebuild_residue_fragment_present'):
            self.run_remove({'releaseParent':str(self.base),'sha':self.sha})

    def test_partial_release_missing_subdirectories_is_still_removed(self):
        # prepare() can fail before copying backend/ or creating state/; the
        # only thing that must never be true is a dispatched intent.
        folder=self.base/self.sha
        folder.mkdir(parents=True)
        (folder/'channel.key').write_bytes(b'x')
        answer=self.run_remove({'releaseParent':str(self.base),'sha':self.sha})
        self.assertEqual(answer,{'removed':True,'alreadyAbsent':False})

    def test_unexpected_top_level_entry_is_refused(self):
        folder=self.base/self.sha
        self.write_full_release(folder)
        (folder/'unexpected-file.json').write_bytes(b'{}')
        with self.assertRaisesRegex(ValueError,'linux_rebuild_residue_unexpected_entry'):
            self.run_remove({'releaseParent':str(self.base),'sha':self.sha})

    def test_invoked_via_wsl_transport_wrapper_removes_and_reports(self):
        folder=self.base/self.sha
        self.write_full_release(folder)
        calls=[]
        def fake_run(command,**kwargs):
            calls.append(command)
            record=self.run_remove(json.loads(kwargs['input'].decode()))
            return subprocess.CompletedProcess(command,0,(json.dumps(record)+'\n').encode(),b'')
        with patch.dict(os.environ,{'SystemRoot':str(self.base)}):
            result=upgrade.remove_stale_linux_release(str(self.base),self.sha,runner=fake_run)
        self.assertEqual(result,{'removed':True,'alreadyAbsent':False})
        self.assertEqual(len(calls),1)

    def test_wsl_transport_wrapper_raises_on_refusal(self):
        folder=self.base/self.sha
        self.write_full_release(folder)
        (folder/'source-upgrade-intent.json').write_bytes(b'{}')
        def fake_run(command,**kwargs):
            # Matches the embedded script's real behaviour: it always prints
            # its JSON record to stdout, even on the refusal/exit(1) path.
            return subprocess.CompletedProcess(command,1,
                b'{"removed":false,"alreadyAbsent":false,"reason":"linux_rebuild_residue_dispatched"}\n',b'')
        with patch.dict(os.environ,{'SystemRoot':str(self.base)}):
            with self.assertRaisesRegex(ValueError,'linux_rebuild_residue_dispatched'):
                upgrade.remove_stale_linux_release(str(self.base),self.sha,runner=fake_run)

    def test_wsl_transport_wrapper_raises_transport_unknown_when_exit_nonzero_with_no_output(self):
        def fake_run(command,**kwargs):
            return subprocess.CompletedProcess(command,1,b'',b'')
        with patch.dict(os.environ,{'SystemRoot':str(self.base)}):
            with self.assertRaisesRegex(ValueError,'linux_rebuild_residue_transport_unknown'):
                upgrade.remove_stale_linux_release(str(self.base),self.sha,runner=fake_run)

    def test_wsl_transport_wrapper_raises_on_unparseable_response(self):
        def fake_run(command,**kwargs):
            return subprocess.CompletedProcess(command,0,b'not json\n',b'')
        with patch.dict(os.environ,{'SystemRoot':str(self.base)}):
            with self.assertRaises((ValueError,json.JSONDecodeError)):
                upgrade.remove_stale_linux_release(str(self.base),self.sha,runner=fake_run)


class RebuildEvidenceWriting(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='pi-upgrade-rebuild-evidence-')
        self.addCleanup(self.temp.cleanup)
        self.evidence_directory=Path(self.temp.name)/'evidence'
        self.plan={'operationId':'f'*32,'newSourceSha256':'b'*64,'newImage':'sha256:'+'1'*64}

    def record(self):
        return upgrade.rebuild_evidence_record('f'*32,self.plan,'sha256:'+'1'*64,'e'*64,'sha256:'+'2'*64)

    def test_record_shape_matches_discarded_and_replacement_identity(self):
        record=self.record()
        self.assertEqual(record['discardedOldPlanImage'],'sha256:'+'1'*64)
        self.assertEqual(record['replacementNewImage'],'sha256:'+'2'*64)
        self.assertEqual(record['discardedPlanSha256'],'e'*64)
        self.assertEqual(record['newSourceSha256'],'b'*64)

    def test_evidence_is_written_and_not_under_runtime_path(self):
        self.assertFalse(str(self.evidence_directory).startswith(r'D:\teruisi-runtime'))
        path=upgrade.write_rebuild_evidence(self.evidence_directory,'f'*32,self.record())
        self.assertTrue(path.exists())
        record=json.loads(path.read_text(encoding='utf-8'))
        self.assertEqual(record['discardedOldPlanImage'],'sha256:'+'1'*64)
        self.assertEqual(record['replacementNewImage'],'sha256:'+'2'*64)
        self.assertEqual(record['discardedPlanSha256'],'e'*64)
        self.assertEqual(record['newSourceSha256'],'b'*64)

    def test_duplicate_operation_id_refuses_silent_overwrite(self):
        upgrade.write_rebuild_evidence(self.evidence_directory,'f'*32,self.record())
        with self.assertRaisesRegex(ValueError,'pi_upgrade_rebuild_evidence_exists'):
            upgrade.write_rebuild_evidence(self.evidence_directory,'f'*32,self.record())


class RebuildReplacementEndToEndViaExtractedAction(unittest.TestCase):
    """Drives `run_prepare_action` (the exact body main() dispatches to for
    `action=='prepare'`, extracted verbatim) end to end against a synthetic
    runtime tree, with `invoke`/`remove_stale_linux_release`/the Linux
    `build()` skills step substituted for deterministic, no-WSL fixtures.
    main()'s own D:/teruisi-runtime/django-sales gate is never touched or
    bypassed here -- it simply is not part of what this function needs.

    Confirms the full rebuild-loop fix: round 1 prepares and registers an
    image id; a rebuild changes only the image id; a second `prepare` call
    replaces the stale plan (instead of looping on
    different_registered_upgrade_plan) and a *third* rebuild (image changes
    again) is handled the same way without leaving any fragment or orphaned
    directory behind."""
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='pi-upgrade-rebuild-e2e-')
        self.addCleanup(self.temp.cleanup)
        self.runtime=Path(self.temp.name)/'runtime'
        self.evidence_directory=Path(self.temp.name)/'evidence'
        self.fake_repo_root=Path(self.temp.name)/'repo'
        (self.runtime/'config').mkdir(parents=True)
        (self.runtime/'secrets').mkdir()
        (self.fake_repo_root/'backend/pi_runner').mkdir(parents=True)
        (self.fake_repo_root/'backend/pi_runner/__init__.py').write_bytes(b'')
        self.key_raw=b'private-fixture-dpapi-ciphertext'
        (self.runtime/'secrets/pi-agent.dpapi.json').write_bytes(self.key_raw)
        self.key=b'k'*32
        self.old_source='a'*64
        self.config={'version':1,'enabled':True,'keyFileSha256':upgrade.sha(self.key_raw),
                     'channelKeySha256':upgrade.sha(self.key),'skillVersion':'1.0.0',
                     'runnerImage':'sha256:'+'0'*64,'runnerSourceSha256':self.old_source}
        self.old_raw=json.dumps(self.config,sort_keys=True).encode()
        self.new_sha='b'*64
        self.plan_directory=self.runtime/'config/pi-agent-upgrades'/self.new_sha
        self.prepared=self.plan_directory/'prepared.json'
        self.key_path=self.runtime/'secrets/pi-agent.dpapi.json'

    def args(self,image,skill_version='1.1.0',rebuild_evidence_directory=_MISSING):
        directory=str(self.evidence_directory) if rebuild_evidence_directory is _MISSING else rebuild_evidence_directory
        return argparse.Namespace(image=image,source_sha256=self.new_sha,skill_version=skill_version,
            rebuild_evidence_directory=directory)

    def prepare(self,image,linux_prepare_response=None,skill_version='1.1.0',rebuild_evidence_directory=_MISSING):
        calls={'invoke':[],'remove':[]}
        def fake_invoke(value):
            calls['invoke'].append(value)
            action=value.get('action')
            if action=='prepare':return linux_prepare_response
            if action=='check':return {'prepared':True,'checked':True,'started':False}
            raise AssertionError('unexpected action '+str(action))
        def fake_remove(release_parent,source_sha,runner=None):
            calls['remove'].append(source_sha)
            return {'removed':True,'alreadyAbsent':False}
        fake_skills=type(sys)('pi_runner.skills');fake_skills.build=lambda path:None
        sys.modules['pi_runner.skills']=fake_skills
        try:
            with patch.object(upgrade,'invoke',fake_invoke), patch.object(upgrade,'remove_stale_linux_release',fake_remove), \
                 patch('sys.stdout',new_callable=io.StringIO) as stdout:
                upgrade.run_prepare_action(self.runtime,self.fake_repo_root,
                    self.args(image,skill_version,rebuild_evidence_directory),
                    self.config,self.old_raw,self.key,self.key_path,self.plan_directory,self.prepared,lambda:self.new_sha)
                calls['stdout']=json.loads(stdout.getvalue())
        finally:
            sys.modules.pop('pi_runner.skills',None)
        return calls

    def test_rebuild_then_second_rebuild_both_replace_without_fragments_or_orphans(self):
        plan_a={'operationId':'1'*32,'newSourceSha256':self.new_sha,'newImage':'sha256:'+'1'*64,
                'releaseParent':'/home/teruisi-pandas/.local/share/teruisi-pi-runner/releases'}
        self.prepare('sha256:'+'1'*64,{'prepared':True,'started':False,'plan':plan_a,
            'planSha256':upgrade.sha(json.dumps(plan_a).encode())})
        self.assertTrue(self.prepared.exists())
        receipt_a_raw=self.prepared.read_bytes()
        receipt_a=json.loads(receipt_a_raw)
        self.assertEqual(receipt_a['plan']['newImage'],'sha256:'+'1'*64)

        # Round 2: rebuild only changed the image id (B). Same source, same
        # skill version, same windows config/key -> must auto-replace, not
        # raise different_registered_upgrade_plan. A real WSL `prepare` call
        # also mints a fresh operationId every time (uuid4 per call); reuse
        # the same id here would be unrealistic test data, not a real retry.
        plan_b={**plan_a,'operationId':'2'*32,'newImage':'sha256:'+'2'*64}
        calls=self.prepare('sha256:'+'2'*64,{'prepared':True,'started':False,'plan':plan_b,
            'planSha256':upgrade.sha(json.dumps(plan_b).encode())})
        self.assertEqual(calls['remove'],[self.new_sha],'must clear the stale WSL release before re-preparing')
        receipt_b=json.loads(self.prepared.read_bytes())
        self.assertEqual(receipt_b['plan']['newImage'],'sha256:'+'2'*64)
        self.assertEqual(len(list(self.evidence_directory.glob('*.json'))),1)
        for name in ('prepared.json.new','preparing.json.new'):
            self.assertFalse((self.plan_directory/name).exists())
        # The replacement's final stdout JSON must carry the same evidence
        # that was (also) written to the explicit --rebuild-evidence-directory,
        # identifying the discarded old image/plan and the replacement image.
        evidence_b=calls['stdout']['rebuiltImageEvidence']
        self.assertEqual(evidence_b['operationId'],plan_a['operationId'])
        self.assertEqual(evidence_b['discardedOldPlanImage'],'sha256:'+'1'*64)
        self.assertEqual(evidence_b['replacementNewImage'],'sha256:'+'2'*64)
        self.assertEqual(evidence_b['discardedPlanSha256'],upgrade.sha(receipt_a_raw))
        on_disk_b=json.loads(next(self.evidence_directory.glob('*.json')).read_text(encoding='utf-8'))
        self.assertEqual(on_disk_b,evidence_b)

        # Round 3: rebuild again (image C). Must behave identically; no
        # leftover directories/fragments accumulate from round 2.
        plan_c={**plan_a,'operationId':'3'*32,'newImage':'sha256:'+'3'*64}
        calls=self.prepare('sha256:'+'3'*64,{'prepared':True,'started':False,'plan':plan_c,
            'planSha256':upgrade.sha(json.dumps(plan_c).encode())})
        self.assertEqual(calls['remove'],[self.new_sha])
        receipt_c=json.loads(self.prepared.read_bytes())
        self.assertEqual(receipt_c['plan']['newImage'],'sha256:'+'3'*64)
        self.assertEqual(calls['stdout']['rebuiltImageEvidence']['discardedOldPlanImage'],'sha256:'+'2'*64)
        self.assertEqual(calls['stdout']['rebuiltImageEvidence']['replacementNewImage'],'sha256:'+'3'*64)
        # preparing.json is written once per successful `prepare` and is never
        # cleaned up even on main's unmodified first-time-success path (it is
        # not part of this task); the no-orphans guarantee this fix owns is
        # narrower: no `.new` fragment and no THIRD file accumulates across
        # repeated rebuild-and-replace cycles.
        self.assertEqual({p.name for p in self.plan_directory.iterdir()},{'prepared.json','preparing.json'},
            'no fragment or extra file should accumulate across rebuild-and-replace cycles')
        self.assertEqual(len(list(self.evidence_directory.glob('*.json'))),2)

    def test_replacement_leaves_candidate_root_file_set_unchanged(self):
        """Direct regression test for the incident: a replacement must never
        add, remove or alter any file under the candidate app tree (`root`)
        passed into this function -- that is the tree a prepare run against
        a sealed `app.deploy-*` directory must not be able to perturb."""
        plan_a={'operationId':'1'*32,'newSourceSha256':self.new_sha,'newImage':'sha256:'+'1'*64,
                'releaseParent':'/home/teruisi-pandas/.local/share/teruisi-pi-runner/releases'}
        self.prepare('sha256:'+'1'*64,{'prepared':True,'started':False,'plan':plan_a,
            'planSha256':upgrade.sha(json.dumps(plan_a).encode())})
        before={f:f.read_bytes() for f in self.fake_repo_root.rglob('*') if f.is_file()}
        self.assertTrue(before,'fixture must contain at least one file under root to be a meaningful check')

        plan_b={**plan_a,'operationId':'2'*32,'newImage':'sha256:'+'2'*64}
        self.prepare('sha256:'+'2'*64,{'prepared':True,'started':False,'plan':plan_b,
            'planSha256':upgrade.sha(json.dumps(plan_b).encode())},rebuild_evidence_directory=None)

        after={f:f.read_bytes() for f in self.fake_repo_root.rglob('*') if f.is_file()}
        self.assertEqual(before,after,'replacement must not add, remove or modify any file under root')

    def test_no_rebuild_evidence_directory_writes_no_file_but_stdout_has_evidence(self):
        """Without --rebuild-evidence-directory, the evidence must only reach
        stdout (so the publisher's stdout.log captures it outside the runtime
        tree); no default directory under `root` is ever written to."""
        plan_a={'operationId':'1'*32,'newSourceSha256':self.new_sha,'newImage':'sha256:'+'1'*64,
                'releaseParent':'/home/teruisi-pandas/.local/share/teruisi-pi-runner/releases'}
        self.prepare('sha256:'+'1'*64,{'prepared':True,'started':False,'plan':plan_a,
            'planSha256':upgrade.sha(json.dumps(plan_a).encode())})
        before={f for f in self.fake_repo_root.rglob('*')}

        plan_b={**plan_a,'operationId':'2'*32,'newImage':'sha256:'+'2'*64}
        calls=self.prepare('sha256:'+'2'*64,{'prepared':True,'started':False,'plan':plan_b,
            'planSha256':upgrade.sha(json.dumps(plan_b).encode())},rebuild_evidence_directory=None)

        evidence=calls['stdout']['rebuiltImageEvidence']
        self.assertEqual(evidence['discardedOldPlanImage'],'sha256:'+'1'*64)
        self.assertEqual(evidence['replacementNewImage'],'sha256:'+'2'*64)
        after={f for f in self.fake_repo_root.rglob('*')}
        self.assertEqual(before,after,'no file may be created anywhere under root when no directory is requested')
        self.assertFalse(self.evidence_directory.exists(),'no default evidence directory should be created at all')

    def test_rebuild_evidence_directory_inside_root_is_rejected_without_writing(self):
        sealed=self.fake_repo_root/'docs/运维/部署与启动/pi-upgrade-rebuilt-image-evidence'
        plan_a={'operationId':'1'*32,'newSourceSha256':self.new_sha,'newImage':'sha256:'+'1'*64,
                'releaseParent':'/home/teruisi-pandas/.local/share/teruisi-pi-runner/releases'}
        self.prepare('sha256:'+'1'*64,{'prepared':True,'started':False,'plan':plan_a,
            'planSha256':upgrade.sha(json.dumps(plan_a).encode())})

        plan_b={**plan_a,'operationId':'2'*32,'newImage':'sha256:'+'2'*64}
        with self.assertRaises(ValueError) as raised:
            self.prepare('sha256:'+'2'*64,{'prepared':True,'started':False,'plan':plan_b,
                'planSha256':upgrade.sha(json.dumps(plan_b).encode())},rebuild_evidence_directory=str(sealed))
        self.assertEqual(str(raised.exception),'pi_upgrade_rebuild_evidence_directory_sealed')
        self.assertFalse(sealed.exists(),'rejected directory must never be created')
        # The original (round 1) plan must still be intact: a rejected
        # evidence directory must abort before any deletion/replacement step.
        receipt=json.loads(self.prepared.read_bytes())
        self.assertEqual(receipt['plan']['newImage'],'sha256:'+'1'*64)

    def test_rebuild_evidence_directory_inside_runtime_is_rejected_without_writing(self):
        sealed=self.runtime/'some/nested/evidence'
        plan_a={'operationId':'1'*32,'newSourceSha256':self.new_sha,'newImage':'sha256:'+'1'*64,
                'releaseParent':'/home/teruisi-pandas/.local/share/teruisi-pi-runner/releases'}
        self.prepare('sha256:'+'1'*64,{'prepared':True,'started':False,'plan':plan_a,
            'planSha256':upgrade.sha(json.dumps(plan_a).encode())})

        plan_b={**plan_a,'operationId':'2'*32,'newImage':'sha256:'+'2'*64}
        with self.assertRaises(ValueError) as raised:
            self.prepare('sha256:'+'2'*64,{'prepared':True,'started':False,'plan':plan_b,
                'planSha256':upgrade.sha(json.dumps(plan_b).encode())},rebuild_evidence_directory=str(sealed))
        self.assertEqual(str(raised.exception),'pi_upgrade_rebuild_evidence_directory_sealed')
        self.assertFalse(sealed.exists(),'rejected directory must never be created')

    def test_rebuild_evidence_directory_equal_to_root_is_rejected(self):
        plan_a={'operationId':'1'*32,'newSourceSha256':self.new_sha,'newImage':'sha256:'+'1'*64,
                'releaseParent':'/home/teruisi-pandas/.local/share/teruisi-pi-runner/releases'}
        self.prepare('sha256:'+'1'*64,{'prepared':True,'started':False,'plan':plan_a,
            'planSha256':upgrade.sha(json.dumps(plan_a).encode())})
        plan_b={**plan_a,'operationId':'2'*32,'newImage':'sha256:'+'2'*64}
        with self.assertRaises(ValueError) as raised:
            self.prepare('sha256:'+'2'*64,{'prepared':True,'started':False,'plan':plan_b,
                'planSha256':upgrade.sha(json.dumps(plan_b).encode())},rebuild_evidence_directory=str(self.fake_repo_root))
        self.assertEqual(str(raised.exception),'pi_upgrade_rebuild_evidence_directory_sealed')

    def test_rebuild_evidence_directory_outside_root_and_runtime_writes_matching_file(self):
        outside=Path(self.temp.name)/'elsewhere-outside-both'
        plan_a={'operationId':'1'*32,'newSourceSha256':self.new_sha,'newImage':'sha256:'+'1'*64,
                'releaseParent':'/home/teruisi-pandas/.local/share/teruisi-pi-runner/releases'}
        self.prepare('sha256:'+'1'*64,{'prepared':True,'started':False,'plan':plan_a,
            'planSha256':upgrade.sha(json.dumps(plan_a).encode())})
        plan_b={**plan_a,'operationId':'2'*32,'newImage':'sha256:'+'2'*64}
        calls=self.prepare('sha256:'+'2'*64,{'prepared':True,'started':False,'plan':plan_b,
            'planSha256':upgrade.sha(json.dumps(plan_b).encode())},rebuild_evidence_directory=str(outside))
        files=list(outside.glob('*.json'))
        self.assertEqual(len(files),1)
        on_disk=json.loads(files[0].read_text(encoding='utf-8'))
        self.assertEqual(on_disk,calls['stdout']['rebuiltImageEvidence'])

    def test_intent_present_still_raises_different_registered_upgrade_plan(self):
        plan_a={'operationId':'1'*32,'newSourceSha256':self.new_sha,'newImage':'sha256:'+'1'*64,
                'releaseParent':'/home/teruisi-pandas/.local/share/teruisi-pi-runner/releases'}
        self.prepare('sha256:'+'1'*64,{'prepared':True,'started':False,'plan':plan_a,
            'planSha256':upgrade.sha(json.dumps(plan_a).encode())})
        # A dispatch actually started: intent.json now exists on the Windows side.
        (self.plan_directory/'intent.json').write_bytes(json.dumps(
            {'operationId':plan_a['operationId'],'status':'dispatching',
             'registeredPlanSha256':upgrade.sha(self.prepared.read_bytes())}).encode())
        with self.assertRaises(ValueError) as raised:
            self.prepare('sha256:'+'2'*64,{})
        self.assertEqual(str(raised.exception),'different_registered_upgrade_plan')
        # Nothing was touched: prepared.json keeps the dispatched (old image) plan.
        receipt=json.loads(self.prepared.read_bytes())
        self.assertEqual(receipt['plan']['newImage'],'sha256:'+'1'*64)

    def test_result_present_still_raises_different_registered_upgrade_plan(self):
        plan_a={'operationId':'1'*32,'newSourceSha256':self.new_sha,'newImage':'sha256:'+'1'*64,
                'releaseParent':'/home/teruisi-pandas/.local/share/teruisi-pi-runner/releases'}
        self.prepare('sha256:'+'1'*64,{'prepared':True,'started':False,'plan':plan_a,
            'planSha256':upgrade.sha(json.dumps(plan_a).encode())})
        (self.plan_directory/'result.json').write_bytes(b'{"upgraded":true}')
        with self.assertRaises(ValueError) as raised:
            self.prepare('sha256:'+'2'*64,{})
        self.assertEqual(str(raised.exception),'different_registered_upgrade_plan')

    def test_source_changed_still_raises_different_registered_upgrade_plan(self):
        # A genuinely different source digest must never be auto-replaced,
        # even though main() would call this with a different new_sha and
        # thus a different plan_directory in practice -- directly exercising
        # rebuilt_image_replacement_allowed's own source check here via a
        # tampered saved-plan record under the *same* directory.
        plan_a={'operationId':'1'*32,'newSourceSha256':self.new_sha,'newImage':'sha256:'+'1'*64,
                'releaseParent':'/home/teruisi-pandas/.local/share/teruisi-pi-runner/releases'}
        self.prepare('sha256:'+'1'*64,{'prepared':True,'started':False,'plan':plan_a,
            'planSha256':upgrade.sha(json.dumps(plan_a).encode())})
        receipt=json.loads(self.prepared.read_bytes())
        receipt['plan']['newSourceSha256']='c'*64
        self.prepared.write_bytes(json.dumps(receipt).encode())
        with self.assertRaises(ValueError) as raised:
            self.prepare('sha256:'+'2'*64,{})
        self.assertEqual(str(raised.exception),'different_registered_upgrade_plan')


if __name__=='__main__':unittest.main()
