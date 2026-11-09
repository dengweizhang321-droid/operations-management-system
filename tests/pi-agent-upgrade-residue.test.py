"""Private fixtures only; never runs wsl.exe or touches D:/teruisi-runtime."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('pi_upgrade_residue', ROOT / 'tools/pi_agent_upgrade_residue.py')
residue = importlib.util.module_from_spec(spec)
spec.loader.exec_module(residue)


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(json.dumps(value).encode())


class WindowsCandidateClassification(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='pi-upgrade-residue-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        # Use a valid-looking 64-hex folder name.
        self.folder = self.root / ('0' * 64)

    def test_preparing_only_is_eligible(self):
        write(self.folder / 'preparing.json', {'operationId': 'f' * 32})
        result = residue.windows_candidate(self.folder)
        self.assertIsNotNone(result)
        self.assertEqual(set(result['sha256ByFile']), {'preparing.json'})

    def test_prepared_present_blocks(self):
        write(self.folder / 'preparing.json', {'operationId': 'f' * 32})
        write(self.folder / 'prepared.json', {'plan': {}})
        self.assertIsNone(residue.windows_candidate(self.folder))

    def test_intent_present_blocks(self):
        write(self.folder / 'preparing.json', {'operationId': 'f' * 32})
        write(self.folder / 'intent.json', {'status': 'dispatching'})
        self.assertIsNone(residue.windows_candidate(self.folder))

    def test_result_present_blocks(self):
        write(self.folder / 'preparing.json', {'operationId': 'f' * 32})
        write(self.folder / 'result.json', {'upgraded': True})
        self.assertIsNone(residue.windows_candidate(self.folder))

    def test_all_four_present_blocks(self):
        for name in ('preparing.json', 'prepared.json', 'intent.json', 'result.json'):
            write(self.folder / name, {'k': name})
        self.assertIsNone(residue.windows_candidate(self.folder))

    def test_missing_preparing_blocks(self):
        self.folder.mkdir(parents=True)
        self.assertIsNone(residue.windows_candidate(self.folder))

    def test_fragment_present_blocks(self):
        write(self.folder / 'preparing.json', {'operationId': 'f' * 32})
        write(self.folder / 'preparing.json.new', {'operationId': 'f' * 32})
        self.assertIsNone(residue.windows_candidate(self.folder))

    def test_unexpected_entry_blocks_without_aborting_the_scan(self):
        write(self.folder / 'preparing.json', {'operationId': 'f' * 32})
        (self.folder / 'unexpected.json').write_bytes(b'{}')
        self.assertIsNone(residue.windows_candidate(self.folder))

    def test_not_a_directory_is_none(self):
        self.assertIsNone(residue.windows_candidate(self.root / 'missing'))


class ScanClassification(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='pi-upgrade-residue-scan-')
        self.addCleanup(self.temp.cleanup)
        self.runtime = Path(self.temp.name)
        self.active = 'a' * 64
        write(self.runtime / 'config/pi-agent.json', {'runnerSourceSha256': self.active, 'version': 1})
        self.calls = []

    def observer(self, release_parent, sha256, distribution='TERUISI-Pandas'):
        self.calls.append(sha256)
        return self.responses[sha256]

    def test_active_source_never_a_candidate_even_if_shaped_like_residue(self):
        write(self.runtime / 'config/pi-agent-upgrades' / self.active / 'preparing.json', {'operationId': 'f' * 32})
        self.responses = {}
        eligible, rejected = residue.scan(self.runtime, linux_observer=self.observer)
        self.assertEqual(eligible, [])
        self.assertEqual(rejected[0]['reason'], 'pi_upgrade_residue_is_active_source')
        self.assertEqual(self.calls, [], 'active source must never reach the Linux observer')

    def test_never_dispatched_on_both_sides_is_eligible(self):
        target = 'b' * 64
        write(self.runtime / 'config/pi-agent-upgrades' / target / 'preparing.json', {'operationId': 'f' * 32})
        self.responses = {target: {'exists': False, 'neverDispatched': True, 'files': {}}}
        eligible, rejected = residue.scan(self.runtime, linux_observer=self.observer)
        self.assertEqual(rejected, [])
        self.assertEqual(len(eligible), 1)
        self.assertEqual(eligible[0]['sha256'], target)
        self.assertEqual(eligible[0]['linux']['exists'], False)

    def test_linux_plan_without_intent_is_still_eligible_when_windows_is_preparing_only(self):
        # The Linux-side `prepare` built a release and plan, but Windows's own
        # process crashed before writing prepared.json. No intent exists on
        # either side; this is also "never dispatched" by the stated criterion.
        target = 'c' * 64
        write(self.runtime / 'config/pi-agent-upgrades' / target / 'preparing.json', {'operationId': 'f' * 32})
        self.responses = {target: {'exists': True, 'neverDispatched': True, 'files': {'config.json': 'x', 'source-upgrade-plan.json': 'y'}}}
        eligible, rejected = residue.scan(self.runtime, linux_observer=self.observer)
        self.assertEqual(len(eligible), 1)
        self.assertEqual(rejected, [])

    def test_linux_side_dispatched_blocks_even_though_windows_side_looks_clean(self):
        target = 'd' * 64
        write(self.runtime / 'config/pi-agent-upgrades' / target / 'preparing.json', {'operationId': 'f' * 32})
        self.responses = {target: {'exists': True, 'neverDispatched': False, 'files': {}}}
        eligible, rejected = residue.scan(self.runtime, linux_observer=self.observer)
        self.assertEqual(eligible, [])
        self.assertEqual(rejected[0]['reason'], 'pi_upgrade_residue_linux_side_not_eligible')

    def test_windows_side_with_prepared_never_reaches_linux_observer(self):
        target = 'e' * 64
        write(self.runtime / 'config/pi-agent-upgrades' / target / 'preparing.json', {'operationId': 'f' * 32})
        write(self.runtime / 'config/pi-agent-upgrades' / target / 'prepared.json', {'plan': {}})
        self.responses = {}
        eligible, rejected = residue.scan(self.runtime, linux_observer=self.observer)
        self.assertEqual(eligible, [])
        self.assertEqual(rejected[0]['reason'], 'pi_upgrade_residue_windows_side_not_eligible')
        self.assertEqual(self.calls, [])

    def test_fully_completed_directory_is_never_eligible(self):
        # Shape of the six real completed directories: all four files present.
        target = 'f' * 64
        for name in ('preparing.json', 'prepared.json', 'intent.json', 'result.json'):
            write(self.runtime / 'config/pi-agent-upgrades' / target / name, {'k': name})
        self.responses = {}
        eligible, rejected = residue.scan(self.runtime, linux_observer=self.observer)
        self.assertEqual(eligible, [])
        self.assertEqual(rejected[0]['reason'], 'pi_upgrade_residue_windows_side_not_eligible')
        self.assertEqual(self.calls, [])

    def test_unknown_entry_name_is_rejected_not_silently_skipped(self):
        (self.runtime / 'config/pi-agent-upgrades').mkdir(parents=True)
        (self.runtime / 'config/pi-agent-upgrades/not-a-sha').mkdir()
        self.responses = {}
        eligible, rejected = residue.scan(self.runtime, linux_observer=self.observer)
        self.assertEqual(eligible, [])
        self.assertEqual(rejected[0]['reason'], 'pi_upgrade_residue_unknown_entry')


class EvidenceAndRemoval(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='pi-upgrade-residue-exec-')
        self.addCleanup(self.temp.cleanup)
        self.runtime = Path(self.temp.name) / 'runtime'
        self.evidence_directory = Path(self.temp.name) / 'evidence'
        write(self.runtime / 'config/pi-agent.json', {'runnerSourceSha256': 'a' * 64, 'version': 1})

    def test_evidence_is_written_before_removal_and_lists_every_file(self):
        target = 'b' * 64
        folder = self.runtime / 'config/pi-agent-upgrades' / target
        write(folder / 'preparing.json', {'operationId': 'f' * 32})
        eligible = [{'sha256': target, 'windows': residue.windows_candidate(folder), 'linux': {'exists': False, 'neverDispatched': True, 'files': {}}}]
        path = residue.write_evidence(self.evidence_directory, eligible, [], self.runtime)
        self.assertTrue(path.exists())
        record = json.loads(path.read_text(encoding='utf-8'))
        self.assertEqual(record['version'], 'teruisi-pi-upgrade-residue-evidence-v1')
        self.assertEqual(record['eligible'][0]['sha256'], target)
        self.assertIn('preparing.json', record['eligible'][0]['windows']['sha256ByFile'])

    def test_execute_removal_removes_windows_dir_only_after_linux_confirms(self):
        target = 'c' * 64
        folder = self.runtime / 'config/pi-agent-upgrades' / target
        write(folder / 'preparing.json', {'operationId': 'f' * 32})
        eligible = [{'sha256': target, 'windows': residue.windows_candidate(folder), 'linux': {'exists': False, 'neverDispatched': True, 'files': {}}}]
        calls = []

        def remover(release_parent, sha256, distribution='TERUISI-Pandas'):
            calls.append(sha256)
            return {'removed': False, 'alreadyAbsent': True}

        results = residue.execute_removal(self.runtime, eligible, linux_remover=remover)
        self.assertEqual(calls, [target])
        self.assertEqual(results[0]['removed'], True)
        self.assertFalse(folder.exists())

    def test_execute_removal_refuses_when_linux_removal_fails(self):
        target = 'd' * 64
        folder = self.runtime / 'config/pi-agent-upgrades' / target
        write(folder / 'preparing.json', {'operationId': 'f' * 32})
        eligible = [{'sha256': target, 'windows': residue.windows_candidate(folder), 'linux': {'exists': True, 'neverDispatched': True, 'files': {}}}]

        def remover(release_parent, sha256, distribution='TERUISI-Pandas'):
            return {'removed': False, 'alreadyAbsent': False, 'reason': 'linux_residue_dispatched'}

        results = residue.execute_removal(self.runtime, eligible, linux_remover=remover)
        self.assertEqual(results[0]['removed'], False)
        self.assertEqual(results[0]['reason'], 'linux_residue_dispatched')
        self.assertTrue(folder.exists(), 'Windows side must be kept when the Linux side could not be confirmed removed')

    def test_execute_removal_rechecks_windows_side_is_still_the_classified_shape(self):
        target = 'e' * 64
        folder = self.runtime / 'config/pi-agent-upgrades' / target
        write(folder / 'preparing.json', {'operationId': 'f' * 32})
        windows_snapshot = residue.windows_candidate(folder)
        # Simulate a race: prepared.json lands between scan() and execute().
        write(folder / 'prepared.json', {'plan': {}})
        eligible = [{'sha256': target, 'windows': windows_snapshot, 'linux': {'exists': False, 'neverDispatched': True, 'files': {}}}]
        calls = []

        def remover(release_parent, sha256, distribution='TERUISI-Pandas'):
            calls.append(sha256)
            return {'removed': True, 'alreadyAbsent': False}

        results = residue.execute_removal(self.runtime, eligible, linux_remover=remover)
        self.assertEqual(results[0]['removed'], False)
        self.assertEqual(results[0]['reason'], 'pi_upgrade_residue_windows_side_changed')
        self.assertEqual(calls, [], 'must not touch Linux side once the Windows side changed underneath it')
        self.assertTrue(folder.exists())


class LinuxEmbeddedObserverAndRemover(unittest.TestCase):
    """Executes the embedded Linux snippets directly (no wsl.exe), following
    the same private-fixture-adapter pattern as pi-upgrade-status.test.py."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='pi-upgrade-residue-linux-')
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.release_parent = self.home / 'releases'

    def run_snippet(self, script, value):
        namespace = {}
        exec(compile(script[:script.rindex('\ntry:')], '<residue-linux>', 'exec'), namespace)
        return namespace

    def test_observe_reports_absent_directory_as_never_dispatched(self):
        namespace = self.run_snippet(residue.LINUX_OBSERVE, None)
        import os as real_os
        had_getuid = hasattr(real_os, 'getuid')
        original_getuid = getattr(real_os, 'getuid', None)
        real_os.getuid = lambda: 1000
        try:
            answer = namespace['observe']({'releaseParent': str(self.release_parent), 'sha': '0' * 64})
        finally:
            if had_getuid:
                real_os.getuid = original_getuid
            else:
                delattr(real_os, 'getuid')
        self.assertEqual(answer, {'exists': False, 'neverDispatched': True, 'files': {}})

    def test_observe_reports_intent_present_as_dispatched(self):
        folder = self.release_parent / ('1' * 64)
        folder.mkdir(parents=True)
        (folder / 'source-upgrade-plan.json').write_bytes(b'{}')
        (folder / 'source-upgrade-intent.json').write_bytes(b'{}')
        namespace = self.run_snippet(residue.LINUX_OBSERVE, None)
        import os as real_os
        had_getuid = hasattr(real_os, 'getuid')
        original_getuid = getattr(real_os, 'getuid', None)
        real_os.getuid = lambda: 1000
        try:
            answer = namespace['observe']({'releaseParent': str(self.release_parent), 'sha': '1' * 64})
        finally:
            if had_getuid:
                real_os.getuid = original_getuid
            else:
                delattr(real_os, 'getuid')
        self.assertEqual(answer['exists'], True)
        self.assertEqual(answer['neverDispatched'], False)

    def test_observe_reports_plan_without_intent_as_never_dispatched(self):
        folder = self.release_parent / ('2' * 64)
        folder.mkdir(parents=True)
        (folder / 'source-upgrade-plan.json').write_bytes(b'{}')
        (folder / 'config.json').write_bytes(b'{}')
        namespace = self.run_snippet(residue.LINUX_OBSERVE, None)
        import os as real_os
        had_getuid = hasattr(real_os, 'getuid')
        original_getuid = getattr(real_os, 'getuid', None)
        real_os.getuid = lambda: 1000
        try:
            answer = namespace['observe']({'releaseParent': str(self.release_parent), 'sha': '2' * 64})
        finally:
            if had_getuid:
                real_os.getuid = original_getuid
            else:
                delattr(real_os, 'getuid')
        self.assertEqual(answer['exists'], True)
        self.assertEqual(answer['neverDispatched'], True)
        self.assertEqual(set(answer['files']), {'source-upgrade-plan.json', 'config.json'})

    def test_observe_reports_fragment_present_as_not_never_dispatched(self):
        folder = self.release_parent / ('3' * 64)
        folder.mkdir(parents=True)
        (folder / 'source-upgrade-plan.json').write_bytes(b'{}')
        (folder / 'source-upgrade-plan.json.new').write_bytes(b'{}')
        namespace = self.run_snippet(residue.LINUX_OBSERVE, None)
        import os as real_os
        had_getuid = hasattr(real_os, 'getuid')
        original_getuid = getattr(real_os, 'getuid', None)
        real_os.getuid = lambda: 1000
        try:
            answer = namespace['observe']({'releaseParent': str(self.release_parent), 'sha': '3' * 64})
        finally:
            if had_getuid:
                real_os.getuid = original_getuid
            else:
                delattr(real_os, 'getuid')
        self.assertEqual(answer['neverDispatched'], False)

    def test_remove_refuses_when_intent_present(self):
        folder = self.release_parent / ('4' * 64)
        folder.mkdir(parents=True)
        (folder / 'source-upgrade-plan.json').write_bytes(b'{}')
        (folder / 'source-upgrade-intent.json').write_bytes(b'{}')
        namespace = self.run_snippet(residue.LINUX_REMOVE, None)
        import os as real_os
        had_getuid = hasattr(real_os, 'getuid')
        original_getuid = getattr(real_os, 'getuid', None)
        real_os.getuid = lambda: 1000
        try:
            with self.assertRaises(ValueError):
                namespace['remove']({'releaseParent': str(self.release_parent), 'sha': '4' * 64})
        finally:
            if had_getuid:
                real_os.getuid = original_getuid
            else:
                delattr(real_os, 'getuid')
        self.assertTrue(folder.exists())

    def test_remove_deletes_plan_only_directory(self):
        folder = self.release_parent / ('5' * 64)
        folder.mkdir(parents=True)
        (folder / 'source-upgrade-plan.json').write_bytes(b'{}')
        namespace = self.run_snippet(residue.LINUX_REMOVE, None)
        import os as real_os
        had_getuid = hasattr(real_os, 'getuid')
        original_getuid = getattr(real_os, 'getuid', None)
        real_os.getuid = lambda: 1000
        try:
            answer = namespace['remove']({'releaseParent': str(self.release_parent), 'sha': '5' * 64})
        finally:
            if had_getuid:
                real_os.getuid = original_getuid
            else:
                delattr(real_os, 'getuid')
        self.assertEqual(answer, {'removed': True, 'alreadyAbsent': False})
        self.assertFalse(folder.exists())

    def test_remove_reports_already_absent_without_error(self):
        namespace = self.run_snippet(residue.LINUX_REMOVE, None)
        import os as real_os
        had_getuid = hasattr(real_os, 'getuid')
        original_getuid = getattr(real_os, 'getuid', None)
        real_os.getuid = lambda: 1000
        try:
            answer = namespace['remove']({'releaseParent': str(self.release_parent), 'sha': '6' * 64})
        finally:
            if had_getuid:
                real_os.getuid = original_getuid
            else:
                delattr(real_os, 'getuid')
        self.assertEqual(answer, {'removed': False, 'alreadyAbsent': True})


if __name__ == '__main__':
    unittest.main(verbosity=2)
