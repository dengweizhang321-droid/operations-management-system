"""Isolated Runner recovery gates. Uses temporary ledgers and no WSL calls."""
import json
from pathlib import Path
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import Mock
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'tools'), str(ROOT / 'backend')]
import ai159_pi_source_recovery as recovery
import pi_agent_upgrade_status as original
from pi_runner.runtime_upgrade import state_manifest
from pi_runner.server import Ledger
from pi_runner.workspace import init_ledger


def guest():
    source = recovery.linux_source(original.LINUX)
    compile(source, '<guest-recovery>', 'exec')
    functions = {}
    exec(source.rsplit('\ntry:\n print(json.dumps(dispatch', 1)[0], functions)
    return functions


class SourceRecovery(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.out = self.root / 'invocation'
        self.out.mkdir()
        self.runtime = self.root / 'runtime'
        (self.runtime / 'config').mkdir(parents=True)
        (self.runtime / 'config/pi-agent.json').write_bytes(b'old fixture')
        self.start = self.root / recovery.GUARD
        self.plan = {'operationId': recovery.OPERATION, 'newSourceSha256': recovery.NEW,
                     'oldSourceSha256': recovery.OLD, 'newUnitSha256': 'a' * 64, 'newConfigSha256': 'b' * 64,
                     'windowsConfigSha256': original.sha(b'old fixture')}
        self.candidate = {'active': False, 'dockerReady': True, 'mainPid': 0, 'loadedUnitVerified': True,
                          'oldFreshStateVerified': True, 'staticBindingVerified': True}
        self.proof = {**self.candidate, 'observed': True, 'active': True, 'mainPid': 19,
                      'listening': True, 'invocationId': 'c' * 32}
        self.original = SimpleNamespace(LINUX=original.LINUX, sha=original.sha, read=original.read,
                                        inspect_upgrade=self.inspect)
        self.phases = []
        self.direct = ({}, {'directExitCode': None})

    def inspect(self, runtime, expected, source, read_key, observer):
        value, transport = observer({'plan': self.plan, 'planSha256': recovery.PLAN, 'complete': False, 'pendingResult': None})
        return {'linuxObservation': value, 'linuxTransport': transport}

    def invoke(self, status, script, value, output, phase, expected=None):
        self.phases.append(phase)
        if phase == 'preflight':
            self.assertFalse(self.start.exists())
            return self.candidate, {'directExitCode': 0}
        self.assertEqual(expected, self.candidate)
        self.assertEqual(json.loads(self.start.read_bytes())['operationId'], recovery.OPERATION)
        if phase == 'start':
            return self.direct
        return self.proof, {'directExitCode': 0}

    def run_recovery(self):
        return recovery.recover(self.original, Mock(), self.out, {'processId': 32}, self.invoke, self.root, self.runtime)

    def test_lost_output_reuses_only_verified_active_successor_and_never_restarts(self):
        result = self.run_recovery()
        self.assertEqual(self.phases, ['preflight', 'start', 'postflight'])
        self.assertIsNone(result['startDirectExit'])
        self.assertEqual(result['mainPid'], 19)
        before = self.start.read_bytes()
        with self.assertRaisesRegex(ValueError, 'guard_exists'):
            self.run_recovery()
        self.assertEqual(self.start.read_bytes(), before)
        self.assertEqual(self.phases.count('start'), 1)

    def test_preflight_docker_block_never_starts(self):
        self.candidate['dockerReady'] = False
        with self.assertRaisesRegex(ValueError, 'preflight_unproved'):
            self.run_recovery()
        self.assertEqual(self.phases, ['preflight'])
        self.assertFalse(self.start.exists())

    def test_known_preflight_change_does_not_count_as_a_start(self):
        self.direct = ({'startDispatched': False}, {'directExitCode': 0})
        with self.assertRaisesRegex(ValueError, 'live_start_preflight_refused'):
            self.run_recovery()
        self.assertEqual(self.phases, ['preflight', 'start'])
        self.assertTrue(self.start.exists())

    def test_failed_start_without_active_proof_stays_unknown(self):
        self.direct = ({'startDispatched': True, 'startExitCode': 1}, {'directExitCode': 0})
        self.proof['listening'] = False
        with self.assertRaisesRegex(ValueError, 'successor_unproved'):
            self.run_recovery()
        self.assertEqual(self.phases, ['preflight', 'start', 'postflight'])
        self.assertTrue(self.start.exists())

    def test_guest_dispatch_rechecks_and_only_starts_the_original_unit_once(self):
        functions = guest()
        ctl = Mock(return_value=SimpleNamespace(returncode=0, stdout=b'', stderr=b''))
        functions.update(ctl=ctl, observe=Mock(return_value={'state': 'stopped'}))
        value = {'phase': 'start', 'plan': {'unitName': 'teruisi-pi-runner.service'}, 'expected': {'state': 'other'}}
        self.assertFalse(functions['dispatch'](value)['startDispatched'])
        ctl.assert_not_called()
        value['expected']['state'] = 'stopped'
        self.assertTrue(functions['dispatch'](value)['startDispatched'])
        self.assertEqual(ctl.call_count, 1)
        self.assertEqual(ctl.call_args.args[1:], ('start', 'teruisi-pi-runner.service'))

    def test_guest_manager_pid_accepts_real_busctl_shape_and_rejects_extra_fields(self):
        functions = guest()
        run = Mock(return_value=SimpleNamespace(returncode=0, stdout=b'u 209\n'))
        functions['subprocess'] = SimpleNamespace(run=run)
        self.assertEqual(functions['bus_manager_pid'](), 209)
        for raw in (b'u 209 unexpected\n', b'u 0\n', b'i 209\n'):
            run.return_value.stdout = raw
            with self.assertRaisesRegex(ValueError, 'user_manager_unproved'):
                functions['bus_manager_pid']()

    def test_sqlite_signed_nonce_write_reproduces_original_manifest_failure(self):
        ledger = Ledger(self.root / 'ledger.sqlite3')
        self.addCleanup(ledger.db.close)
        self.assertEqual((self.root / 'ledger.sqlite3-wal').stat().st_size, 0)
        state_manifest(self.root)
        ledger.nonce('a' * 32, str(int(time.time())))
        self.assertGreater((self.root / 'ledger.sqlite3-wal').stat().st_size, 0)
        with self.assertRaisesRegex(ValueError, 'ledger_wal_not_checkpointed'):
            state_manifest(self.root)

    def test_historical_gateway_unknown_requires_one_inactive_owner(self):
        ledger = Ledger(self.root / 'ledger.sqlite3')
        self.addCleanup(ledger.db.close)
        init_ledger(ledger)
        ledger.db.execute("INSERT INTO sessions (workspace,identity,status) VALUES ('scope',?,'disposed')", (b'fixture identity',))
        ledger.db.execute("INSERT INTO events VALUES ('scope',1,'op',?)", (b'fixture event never read',))
        ledger.db.executemany("INSERT INTO gateway VALUES ('op',?,?,'unknown')", ((str(i), 'a' * 64) for i in range(15)))
        ledger.db.commit()
        inspect = guest()['ledger_metadata']
        valid = inspect(ledger.db)
        self.assertEqual(valid['retainedGatewayUnknownCount'], 15)
        self.assertNotIn('fixture', str(valid))
        ledger.db.execute("INSERT INTO events VALUES ('other',1,'op',?)", (b'unbound event',))
        with self.assertRaisesRegex(ValueError, 'gateway_unknown_owner_unproved'):
            inspect(ledger.db)
        ledger.db.execute("DELETE FROM events WHERE workspace='other'")
        ledger.db.execute("UPDATE sessions SET status='running'")
        with self.assertRaisesRegex(ValueError, 'ledger_active_or_unsafe'):
            inspect(ledger.db)


if __name__ == '__main__':
    unittest.main()
