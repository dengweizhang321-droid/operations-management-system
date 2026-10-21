"""Private fixtures only; never runs WSL, a service, or production reads."""
import ast
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('pi_upgrade_status', ROOT / 'tools/pi_agent_upgrade_status.py')
status = importlib.util.module_from_spec(spec)
spec.loader.exec_module(status)


class WindowsObservation(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='pi-upgrade-status-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = 'b' * 64
        self.key = b'k' * 32
        self.key_raw = b'private-fixture-dpapi-ciphertext'
        self.old = {'version': 1, 'enabled': True, 'keyFileSha256': status.sha(self.key_raw),
                    'channelKeySha256': status.sha(self.key), 'skillVersion': '1.0.0',
                    'authorityEpoch': 'test-epoch', 'cutoverId': 'test-cutover',
                    'runnerImage': 'sha256:' + '1' * 64, 'runnerSourceSha256': 'a' * 64}
        self.new = {**self.old, 'runnerSourceSha256': self.source, 'runnerImage': 'sha256:' + '2' * 64, 'skillVersion': '1.1.0'}
        self.plan = {'operationId': 'f' * 32, 'namespace': 'pi-agent-v1', 'unitName': 'teruisi-pi-runner.service',
                     'unitPath': '/home/teruisi-pandas/.config/systemd/user/teruisi-pi-runner.service',
                     'releaseParent': '/home/teruisi-pandas/.local/share/teruisi-pi-runner/releases', 'port': 8123,
                     'oldSourceSha256': 'a' * 64, 'newSourceSha256': self.source,
                     'oldImage': self.old['runnerImage'], 'newImage': self.new['runnerImage'],
                     'channelKeySha256': status.sha(self.key), 'windowsConfigSha256': status.sha(status.encode(self.old)),
                     'windowsKeyFileSha256': status.sha(self.key_raw), 'schemaVersion': 1, 'protocolVersion': 'pi-runner-v1',
                     **{key: 'd' * 64 for key in ('oldConfigSha256', 'newConfigSha256', 'oldUnitSha256', 'newUnitSha256')}}
        self.receipt = {'prepared': True, 'started': False, 'plan': self.plan, 'planSha256': status.sha(status.encode(self.plan)),
                        'linuxPlanPath': self.plan['releaseParent'] + '/' + self.source + '/source-upgrade-plan.json',
                        'newWindowsConfig': self.new, 'oldWindowsConfigSha256': self.plan['windowsConfigSha256'],
                        'windowsKeyFileSha256': self.plan['windowsKeyFileSha256']}
        self.folder = self.root / 'config/pi-agent-upgrades' / self.source
        self.folder.mkdir(parents=True)
        (self.root / 'secrets').mkdir()
        self.write('config/pi-agent.json', self.old)
        (self.root / 'secrets/pi-agent.dpapi.json').write_bytes(self.key_raw)
        self.save_receipt()
        self.write(self.folder / 'preparing.json', {'operationId': self.plan['operationId'], 'oldWindowsConfigSha256': self.plan['windowsConfigSha256'],
                   'newSourceSha256': self.source, 'newImage': self.new['runnerImage'], 'skillVersion': self.new['skillVersion']})
        self.observation = {'observed': True, 'staticBindingVerified': True, 'active': True, 'loadedUnitVerified': True, 'oldFreshStateVerified': True}
        self.observed_calls = []

    def write(self, path, value):
        path = path if isinstance(path, Path) else self.root / path
        path.write_bytes(status.encode(value))

    def save_receipt(self):
        self.write(self.folder / 'prepared.json', self.receipt)
        self.expected = status.sha(status.encode(self.receipt))
        self.write(self.folder / 'intent.json', {'operationId': self.plan['operationId'], 'status': 'dispatching', 'registeredPlanSha256': self.expected})

    def observe(self, value):
        self.observed_calls.append(value)
        return self.observation, {'directExitCode': 0, 'stdoutBase64': '', 'stderrBase64': ''}

    def inspect(self):
        before = {str(p.relative_to(self.root)): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        answer = status.inspect_upgrade(self.root, self.expected, self.source, lambda _: self.key, self.observe)
        after = {str(p.relative_to(self.root)): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        self.assertEqual(before, after, 'observation must not write any fixture file')
        return answer

    def complete(self):
        result = {'upgraded': True, 'oldReleaseRetained': True, 'operationId': self.plan['operationId'],
                  'planSha256': self.receipt['planSha256'], 'sourceSha256': self.source, 'image': self.new['runnerImage'],
                  'freshStateSha256': 'c' * 64, 'candidateStateSha256': 'e' * 64,
                  'windowsConfigSha256': status.sha(status.encode(self.new)), 'windowsKeyFileSha256': status.sha(self.key_raw)}
        self.write('config/pi-agent.json', self.new)
        self.write(self.folder / 'result.json', result)
        return result

    def test_only_exact_active_successor_is_eligible(self):
        answer = self.inspect()
        self.assertEqual(answer['status'], 'reconcile_available')
        self.assertFalse(answer['postconditionsVerified'])
        self.assertIsNone(answer['upgradeReceipt'])
        self.assertFalse(self.observed_calls[0]['complete'])

    def test_completed_result_is_reused_even_after_unit_stopped(self):
        original = self.complete()
        self.observation = {'observed': True, 'staticBindingVerified': True, 'activityRequired': False}
        answer = self.inspect()
        self.assertEqual(answer['status'], 'windows_complete')
        self.assertEqual(answer['upgradeReceipt'], {**original, 'windowsConfigUpdated': True, 'sameDpapiOwner': True})
        self.assertFalse(answer['postconditionsVerified'], 'PowerShell owns ACL verification')
        self.assertTrue(self.observed_calls[0]['complete'])

    def test_inactive_or_old_restored_or_missing_linux_proof_is_blocked(self):
        for proof in ({'observed': False, 'reason': 'linux_unit_not_exact_successor'},
                      {'observed': True, 'staticBindingVerified': True, 'active': False},
                      {'observed': False, 'reason': 'linux_original_intent_unproved'}):
            self.observation = proof
            self.assertEqual(self.inspect()['status'], 'blocked')

    def test_complete_all_result_fields_and_original_intent_are_bound(self):
        original = self.complete()
        for field in original:
            broken = {**original, field: False if type(original[field]) is bool else 'changed'}
            self.write(self.folder / 'result.json', broken)
            self.assertEqual(self.inspect()['status'], 'blocked', field)
        self.write(self.folder / 'result.json', original)
        self.write(self.folder / 'intent.json', {'operationId': '0' * 32, 'status': 'dispatching', 'registeredPlanSha256': self.expected})
        self.assertEqual(self.inspect()['status'], 'blocked')

    def test_changed_key_config_or_registered_plan_blocks_before_linux(self):
        (self.root / 'secrets/pi-agent.dpapi.json').write_bytes(b'changed')
        self.assertEqual(self.inspect()['status'], 'blocked')
        self.assertEqual(self.observed_calls, [])
        (self.root / 'secrets/pi-agent.dpapi.json').write_bytes(self.key_raw)
        self.write('config/pi-agent.json', {**self.old, 'authorityEpoch': 'other'})
        self.assertEqual(self.inspect()['status'], 'blocked')
        self.write('config/pi-agent.json', self.old)
        self.expected = '0' * 64
        self.assertEqual(self.inspect()['reason'], 'registered_upgrade_plan_changed')

    def test_conflicting_fragments_block_but_exact_config_fragment_is_retained(self):
        fragment = self.root / 'config/pi-agent.json.new'
        fragment.write_bytes(b'foreign')
        self.assertEqual(self.inspect()['status'], 'blocked')
        fragment.write_bytes(status.encode(self.new))
        self.assertEqual(self.inspect()['status'], 'reconcile_available')
        (self.folder / 'intent.json.new').write_bytes(b'foreign')
        self.assertEqual(self.inspect()['status'], 'blocked')

    def test_duplicate_properties_and_non_object_records_block(self):
        for raw in (b'[]', b'{"upgraded":true,"upgraded":false}'):
            (self.folder / 'result.json').write_bytes(raw)
            self.assertEqual(self.inspect()['status'], 'blocked')

    def test_windows_change_during_linux_read_is_not_promoted_to_completion(self):
        self.complete()
        def racing_observer(value):
            self.write('config/pi-agent.json', self.old)
            return self.observation, {'directExitCode': 0}
        answer = status.inspect_upgrade(self.root, self.expected, self.source, lambda _: self.key, racing_observer)
        self.assertEqual(answer['status'], 'blocked')
        self.assertEqual(answer['reason'], 'upgrade_windows_observation_changed')


class NativeTransport(unittest.TestCase):
    def test_raw_bytes_and_direct_exit_are_preserved_before_strict_parse(self):
        for raw, code in ((b'\xfflegacy-codepage', 0), (b'{"observed":true,"staticBindingVerified":true}\n', 7)):
            result = SimpleNamespace(stdout=raw, stderr=b'\xffstderr', returncode=code)
            captured = []
            def run(command, **kwargs):
                captured.append((command, kwargs))
                return result
            with patch.dict(os.environ, {'SystemRoot': 'C:/Windows'}):
                proof, transport = status.invoke_linux({'fixture': True}, run)
            self.assertFalse(proof['observed'])
            self.assertEqual(transport['directExitCode'], code)
            self.assertEqual(status.base64.b64decode(transport['stdoutBase64']), raw)
            self.assertEqual(status.base64.b64decode(transport['stderrBase64']), b'\xffstderr')
            command, args = captured[0]
            self.assertEqual(command[-3:], ['-B', '-c', status.LINUX])
            self.assertNotIn('/mnt/d', ' '.join(command))
            self.assertEqual(args['input'], b'{"fixture":true}')
            self.assertNotIn('text', args)

    def test_timeout_keeps_original_partial_bytes_and_unknown_direct_exit(self):
        def run(*args, **kwargs):
            raise subprocess.TimeoutExpired(args[0], 60, output=b'partial\xff', stderr=b'err')
        with patch.dict(os.environ, {'SystemRoot': 'C:/Windows'}):
            proof, transport = status.invoke_linux({}, run)
        self.assertFalse(proof['observed'])
        self.assertIsNone(transport['directExitCode'])
        self.assertEqual(status.base64.b64decode(transport['stdoutBase64']), b'partial\xff')

    def test_embedded_linux_observer_has_no_write_or_lifecycle_entry(self):
        ast.parse(status.LINUX)
        for forbidden in ('dispatch(', 'reconcile(', 'command(', 'import sqlite3', 'os.replace', 'write_bytes', 'write_text', 'daemon-reload', "'start'", "'stop'", '/mnt/d'):
            self.assertNotIn(forbidden, status.LINUX)


class LinuxObservation(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='pi-upgrade-status-linux-')
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.ns = {}
        # Execute the actual embedded functions without its stdin CLI. Only
        # owner metadata, /proc and systemctl are private fixture adapters.
        exec(compile(status.LINUX[:status.LINUX.rindex('\ntry:')], '<native-linux-observer>', 'exec'), self.ns)
        home = self.home
        class FixturePath:
            def __init__(self, value):
                self.path = value.path if isinstance(value, FixturePath) else Path(value)
                if str(value) == '/proc':
                    self.path = home / 'private-proc'
            @staticmethod
            def home(): return FixturePath(home)
            def __truediv__(self, tail): return FixturePath(self.path / tail)
            def __str__(self): return str(self.path)
            def __eq__(self, other): return self.path == other.path
            @property
            def parent(self): return FixturePath(self.path.parent)
            @property
            def parents(self): return tuple(FixturePath(p) for p in self.path.parents)
            def stat(self):
                original = self.path.stat()
                return SimpleNamespace(st_uid=1000, st_mode=(0o40700 if self.path.is_dir() else 0o100600),
                                       st_nlink=original.st_nlink, st_size=original.st_size)
            def relative_to(self, root): return self.path.relative_to(root.path)
            def rglob(self, pattern): return (FixturePath(p) for p in self.path.rglob(pattern))
            def iterdir(self): return (FixturePath(p) for p in self.path.iterdir())
            def with_name(self, name): return FixturePath(self.path.with_name(name))
            def __lt__(self, other): return self.path < other.path
            def __getattr__(self, name): return getattr(self.path, name)
        self.ns['Path'] = FixturePath
        self.source_raw = b'# isolated source\n'
        self.source = status.sha(b'__init__.py\0' + self.source_raw)
        base = self.home / '.local/share/teruisi-pi-runner/releases'
        self.new = base / self.source
        self.old = base / ('a' * 64)
        (self.new / 'backend/pi_runner').mkdir(parents=True)
        (self.new / 'backend/pi_runner/__init__.py').write_bytes(self.source_raw)
        (self.old / 'state').mkdir(parents=True)
        self.unit = self.home / '.config/systemd/user/teruisi-pi-runner.service'
        self.unit.parent.mkdir(parents=True)
        self.unit.write_bytes(b'exact-new-unit')
        (self.new / 'pi-runner.service').write_bytes(b'exact-new-unit')
        (self.new / 'predecessor-unit.service').write_bytes(b'exact-old-unit')
        (self.old / 'config.json').write_bytes(b'old-config')
        (self.new / 'channel.key').write_bytes(b'k' * 32)
        config = {'image': 'sha256:' + '2' * 64, 'namespace': 'pi-agent-v1', 'keyFile': str(self.new / 'channel.key'), 'stateDirectory': str(self.new / 'state')}
        (self.new / 'config.json').write_bytes(status.encode(config))
        self.plan = {'namespace': 'pi-agent-v1', 'releaseParent': str(base), 'unitPath': str(self.unit),
                     'unitName': self.unit.name, 'port': 8123, 'operationId': 'f' * 32,
                     'oldSourceSha256': 'a' * 64, 'newSourceSha256': self.source, 'newImage': config['image'],
                     'newConfigSha256': status.sha(status.encode(config)), 'channelKeySha256': status.sha(b'k' * 32),
                     'oldConfigSha256': status.sha(b'old-config'), 'oldUnitSha256': status.sha(b'exact-old-unit'), 'newUnitSha256': status.sha(b'exact-new-unit')}
        self.intent = {'operationId': 'f' * 32, 'status': 'unknown', 'freshStateSha256': status.sha(b'[]'),
                       'candidateStateSha256': 'c' * 64, 'planSha256': status.sha(status.encode(self.plan))}
        self.value = {'plan': self.plan, 'planSha256': self.intent['planSha256'], 'complete': False, 'result': None}
        (self.new / 'source-upgrade-plan.json').write_bytes(status.encode(self.plan))
        self.save_intent()
        self.argv = ['/usr/bin/python3', '-B', '-m', 'pi_runner.server', '--config', str(self.new / 'config.json')]
        proc = self.home / 'private-proc/123'
        proc.mkdir(parents=True)
        (proc / 'cmdline').write_bytes(b'\0'.join(a.encode() for a in self.argv) + b'\0')
        self.fields = {'ActiveState': 'active', 'MainPID': '123', 'FragmentPath': str(self.unit), 'WorkingDirectory': str(self.new / 'backend'),
                       'ExecStart': '{ path=/usr/bin/python3 ; argv[]=' + ' '.join(self.argv) + ' ; ignore_errors=no ; }', 'NeedDaemonReload': 'no'}
        self.native_calls = []
        def run(command, **kwargs):
            self.native_calls.append(command)
            return SimpleNamespace(returncode=0, stdout='\n'.join(k + '=' + v for k, v in self.fields.items()).encode())
        self.ns['subprocess'] = SimpleNamespace(run=run)
        self.ns['os'] = SimpleNamespace(getuid=lambda: 1000, readlink=lambda _: str(self.new / 'backend'),
                                       path=SimpleNamespace(realpath=lambda _: '/usr/bin/python3'))

    def save_intent(self):
        (self.new / 'source-upgrade-intent.json').write_bytes(status.encode(self.intent))

    def test_actual_embedded_observer_requires_active_loaded_unit_and_exact_pid(self):
        answer = self.ns['observe'](self.value)
        self.assertTrue(answer['active'])
        self.assertEqual(answer['mainPid'], 123)
        self.assertEqual(self.native_calls[0][:3], ['/usr/bin/systemctl', '--user', 'show'])
        for key, wrong in (('ActiveState', 'inactive'), ('NeedDaemonReload', 'yes'), ('WorkingDirectory', '/foreign'), ('MainPID', '124'), ('ExecStart', 'foreign')):
            original = self.fields[key]
            self.fields[key] = wrong
            with self.assertRaises(ValueError, msg=key):
                self.ns['observe'](self.value)
            self.fields[key] = original

    def test_durable_complete_does_not_query_activity_or_rehash_live_state(self):
        self.value.update(complete=True, result={'freshStateSha256': self.intent['freshStateSha256'], 'candidateStateSha256': self.intent['candidateStateSha256']})
        (self.old / 'state/after-completion').write_bytes(b'changed later')
        self.fields['ActiveState'] = 'inactive'
        answer = self.ns['observe'](self.value)
        self.assertFalse(answer['activityRequired'])
        self.assertEqual(self.native_calls, [])

    def test_old_restored_unknown_source_fresh_state_or_intent_conflicts_block(self):
        self.unit.write_bytes(b'exact-old-unit')
        with self.assertRaisesRegex(ValueError, 'unit_not_exact_successor'):
            self.ns['observe'](self.value)
        self.unit.write_bytes(b'exact-new-unit')
        (self.new / 'backend/pi_runner/__init__.py').write_bytes(b'foreign-source')
        with self.assertRaisesRegex(ValueError, 'source_binding_changed'):
            self.ns['observe'](self.value)
        (self.new / 'backend/pi_runner/__init__.py').write_bytes(self.source_raw)
        (self.old / 'state/changed').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'old_fresh_state_changed'):
            self.ns['observe'](self.value)
        (self.old / 'state/changed').unlink()
        self.intent['status'] = 'rejected_old_unit_restored'
        self.save_intent()
        with self.assertRaisesRegex(ValueError, 'original_intent_unproved'):
            self.ns['observe'](self.value)

    def test_conflicting_old_pid_or_result_fragment_state_is_rejected(self):
        old_proc = self.home / 'private-proc/999'
        old_proc.mkdir()
        old_args = [*self.argv[:-1], str(self.old / 'config.json')]
        (old_proc / 'cmdline').write_bytes(b'\0'.join(a.encode() for a in old_args) + b'\0')
        with self.assertRaisesRegex(ValueError, 'runner_process_conflict'):
            self.ns['observe'](self.value)
        (old_proc / 'cmdline').unlink()
        old_proc.rmdir()
        self.value['pendingResult'] = {'freshStateSha256': '0' * 64, 'candidateStateSha256': self.intent['candidateStateSha256']}
        with self.assertRaisesRegex(ValueError, 'pending_result_state_conflict'):
            self.ns['observe'](self.value)


if __name__ == '__main__':
    unittest.main(verbosity=2)
