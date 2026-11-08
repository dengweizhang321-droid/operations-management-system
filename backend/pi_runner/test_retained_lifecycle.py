"""Real rootless Docker/Pi lifecycle. Gateway model replies are synthetic."""
import concurrent.futures
import hashlib
import os
from pathlib import Path
import tempfile
import threading
import time
import traceback
import unittest
from unittest.mock import Mock, patch
import uuid

from .protocol import VERSION, decode, encode, workspace_key
from .server import Broker, Ledger, Session
from .workspace import init_ledger, register_session, value_get, value_set

CONFIG = os.environ.get("PI_RETAINED_TEST_CONFIG")


class LegacyImageRejectionTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.broker = object.__new__(Broker)
        broker = self.broker
        broker.lock = threading.RLock()
        broker.state = Path(temporary.name)
        broker.ledger = Ledger(broker.state / "ledger.sqlite3")
        self.addCleanup(broker.ledger.db.close)
        init_ledger(broker.ledger)
        broker.namespace = "pi-test-legacy"
        broker.image = "sha256:" + "b" * 64
        broker.gateway_url = "http://127.0.0.1:49159/api/ai/pi/gateway"
        broker.closing = False
        self.identity = {"operationId": "fixture", "ownerId": "fixture@example.invalid", "conversationId": "fixture",
                         "epoch": 1, "generation": 1, "seq": 1}
        key = workspace_key(self.identity)
        name = broker.namespace + "-" + key[:32]
        self.session = Session(broker, self.identity, name, name + "-workspace", [])
        self.session.container_id = "a" * 64
        self.session.phase = "stopped"
        self.session.skill_version = "1.3.0"
        broker.sessions = {key: self.session}
        broker.save_session(self.session)
        broker.docker_command = Mock(return_value=encode([{"Config": {"Labels": {}}}]))
        broker.popen = Mock(side_effect=AssertionError("unexpected start"))
        self.fence = {"mode": "execute", "rootSessionId": "fixture", "modeRevision": 1,
                      "admissionEpoch": 1, "treeVersion": 1, "scopeSha256": "a" * 64}
        value_set(self.session, "admission", self.fence)

    def phase(self):
        return self.broker.ledger.db.execute("SELECT status FROM sessions WHERE workspace=?", (self.session.key,)).fetchone()[0]

    def test_legacy_create_is_rejected_before_stopped_fence_changes(self):
        with self.assertRaisesRegex(ValueError, "^workspace_native_image_upgrade_required$"):
            self.broker.execute({**self.identity, "command": "create", "payload": {}})
        self.assertEqual((self.phase(), self.session.phase), ("stopped", "stopped"))
        self.assertEqual(self.broker.ledger.db.execute("SELECT status FROM commands").fetchone()[0], "rejected")
        self.broker.docker_command.assert_called_once_with(["image", "inspect", self.session.image], maximum=128000)
        self.broker.popen.assert_not_called()

    def test_legacy_reclaim_keeps_shell_even_when_local_restore_not_required(self):
        response = self.broker.execute({**self.identity, "command": "workspace", "payload": {"action": "control",
            "command": "reclaim_stopped", "controlId": "legacy-reclaim", "controlSeq": 1,
            "payload": {"expected": self.broker.shell_binding(self.session), "admission": self.fence}}})
        self.assertEqual((response["control"]["status"], response["control"]["errorCode"]),
            ("failed", "workspace_native_image_upgrade_required"))
        self.assertEqual(self.phase(), "stopped")
        self.assertEqual(self.session.container_id, "a" * 64)
        self.assertIsNone(value_get(self.session, "reclaimIntent"))
        self.broker.docker_command.assert_called_once_with(["image", "inspect", self.session.image], maximum=128000)

    def test_failure_with_same_code_after_start_boundary_keeps_unknown(self):
        self.broker.docker_command.return_value = encode([{"Config": {"Labels": {"teruisi.pi.native-capabilities": "1"}}}])
        self.broker.inspect = Mock(return_value={"State": {"Running": False}})
        value_set(self.session, "currentSessionId", "empty")
        value_set(self.session, "stoppedHistory", {"sessionId": "empty", "seq": 0, "empty": True})
        with patch.object(self.session, "start", side_effect=ValueError("workspace_native_image_upgrade_required")):
            with self.assertRaisesRegex(ValueError, "^workspace_resume_unknown$"):
                self.broker.execute({**self.identity, "command": "create", "payload": {}})
        self.assertEqual((self.phase(), self.session.phase), ("unknown", "unknown"))
        self.assertEqual(self.broker.ledger.db.execute("SELECT status FROM commands").fetchone()[0], "unknown")

    def test_uncertain_stopped_history_fences_default_dispose(self):
        self.broker.docker_command.return_value = encode([{"Config": {"Labels": {"teruisi.pi.native-capabilities": "1"}}}])
        self.broker.inspect = Mock(return_value={"State": {"Running": False}})
        with self.assertRaisesRegex(ValueError, "^workspace_resume_history_unknown$"):
            self.broker.execute({**self.identity, "command": "create", "payload": {}})
        hold = value_get(self.session, "resumeHold")
        self.assertEqual((hold["reason"], hold["containerId"]), ("workspace_resume_history_unknown", "a" * 64))
        self.assertEqual((self.phase(), self.session.phase, self.session.revoked), ("unknown", "unknown", True))
        with self.assertRaisesRegex(ValueError, "^workspace_preserved_for_recovery$"):
            self.broker.execute({**self.identity, "command": "dispose", "payload": {}})
        self.assertEqual(self.phase(), "unknown")
        self.broker.docker_command.assert_called_once_with(["image", "inspect", self.session.image], maximum=128000)
        self.broker.popen.assert_not_called()


@unittest.skipUnless(CONFIG, "private rootless Pi config is required")
class RetainedLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.config = decode(Path(CONFIG).read_bytes())
        slots = 2 if self._testMethodName == "test_upgrade_of_legacy_paused_workspace_restores_local_model_without_gateway" else 1
        if not self.config["namespace"].startswith("pi-test-") or self.config["limits"]["maxSessions"] != slots:
            self.fail("exact private test configuration required")
        self.open_broker()
        self.addCleanup(self.close_broker)

    def open_broker(self):
        self.broker = Broker(self.config)
        self.broker.stop_monitor.set()
        self.control_seq = {}
        original = self.broker.start_stopped

        def start_stopped(*args, **kwargs):
            try:
                return original(*args, **kwargs)
            except ValueError:
                if args[0].phase == "unknown":
                    traceback.print_exc()
                raise
        self.broker.start_stopped = start_stopped

    def close_broker(self):
        self.broker.shutdown()
        self.broker.ledger.db.close()
        self.broker.lock_file.close()

    def restart(self):
        old_seq = self.control_seq
        self.close_broker()
        self.open_broker()
        self.control_seq = old_seq

    def new_job(self, conversation=None, seq=1):
        return {"operationId": "op-" + uuid.uuid4().hex, "ownerId": "isolated@example.invalid",
            "conversationId": conversation or "test-" + uuid.uuid4().hex, "epoch": 1, "generation": 1, "seq": seq}

    def admission(self, job, mode="execute", revision=1):
        return {"mode": mode, "rootSessionId": job["conversationId"], "modeRevision": revision,
            "admissionEpoch": revision, "treeVersion": revision, "scopeSha256": "a" * 64}

    def call(self, job, command, payload=None):
        return self.broker.execute({**job, "command": command, "payload": payload or {}})

    def create_args(self, job):
        return {"gateway": {"url": self.broker.gateway_url, "capability": "private-fixture-" + job["operationId"]},
            "admission": self.admission(job),
            "model": {"id": "synthetic", "contextWindow": 65536, "maxTokens": 8192, "reasoning": True,
                "supportedThinkingLevels": ["off", "low", "high"], "thinkingLevel": "low"},
            "skillVersion": "1.3.0", "skillIds": ["excel-report"]}

    def create(self, job):
        return self.call(job, "create", self.create_args(job))

    def control(self, job, command, payload=None, *, fence=None, request=None):
        key = workspace_key(job)
        if request is None:
            self.control_seq[key] = self.control_seq.get(key, 0) + 1
            request = {"action": "control", "controlId": "control-" + uuid.uuid4().hex, "controlSeq": self.control_seq[key],
                "command": command, "payload": {**(payload or {}), "admission": fence or self.admission(job)}}
        result = self.call(job, "workspace", request)
        return request, result["control"]

    def history(self, job, question="history-marker"):
        self.call(job, "prompt", {**self.create_args(job), "message": question, "files": [], "timeoutMs": 45000})
        cutoff = time.monotonic() + 20
        responded = False
        while time.monotonic() < cutoff:
            state = self.call(job, "state")
            for request in state["pendingGatewayRequests"]:
                if responded:
                    continue
                self.assertEqual(request["capability"], self.create_args(job)["gateway"]["capability"])
                self.assertEqual(request["kind"], "model")
                self.call(job, "gateway_response", {"requestId": request["requestId"], "response": {"message":
                    {"role": "assistant", "content": [{"type": "text", "text": "answer-marker"}], "stopReason": "stop"}}})
                responded = True
            if state["status"] == "settled":
                self.assertTrue(responded)
                return
            time.sleep(.05)
        self.fail("synthetic-provider Pi turn did not settle")

    def bash(self, job, command, *, fence=None, expected_status="completed"):
        req, receipt = self.control(job, "bash", {"command": command, "excludeFromContext": True}, fence=fence)
        cutoff = time.monotonic() + 15
        while receipt["status"] == "accepted" and time.monotonic() < cutoff:
            time.sleep(.05)
            receipt = self.call(job, "workspace", {"action": "receipt", "controlId": req["controlId"]})["control"]
        self.assertEqual(receipt["status"], expected_status, receipt.get("errorCode"))
        return receipt.get("result", {})

    def reclaim(self, job):
        session = self.broker.sessions[workspace_key(job)]
        binding = self.broker.shell_binding(session)
        return self.control(job, "reclaim_stopped", {"expected": binding})

    def test_one_slot_reclaim_restart_rebuild_and_wake_without_old_capability(self):
        job, other = self.new_job(), self.new_job()
        self.create(job)
        self.history(job)
        session = self.broker.sessions[workspace_key(job)]
        original_id, original_volume, original_image = session.container_id, session.volume, session.image
        native_id = session.pi_state["sessionId"]
        self.assertEqual(self.bash(job, "printf saved > retention-marker; python3 --version; npm --version; uv --version")["exitCode"], 0)
        messages = session.rpc("get_messages", {})["data"]
        self.assertIn("history-marker", str(messages))
        self.assertEqual(self.control(job, "pause")[1]["status"], "completed")
        with self.assertRaisesRegex(ValueError, "^session_limit$"):
            self.create(other)
        original_request, reclaimed = self.reclaim(job)
        self.assertEqual(reclaimed["status"], "completed", reclaimed)
        self.assertEqual(reclaimed["result"]["containerId"], original_id)
        self.assertEqual(len(self.broker.managed_containers()), 0)
        self.assertEqual(self.control(job, "reclaim_stopped", request=original_request)[1], reclaimed)
        self.restart()
        restored = self.broker.sessions[workspace_key(job)]
        self.assertEqual((restored.phase, restored.container_id, restored.volume, restored.image, restored.last_seq),
            ("stopped", None, original_volume, original_image, job["seq"]))
        contenders = [self.new_job(), self.new_job()]
        barrier = threading.Barrier(len(contenders))

        def allocate(contender):
            barrier.wait(5)
            try:
                self.create(contender)
                return contender
            except ValueError as error:
                self.assertEqual(str(error), "session_limit")

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            winners = [value for value in pool.map(allocate, contenders) if value]
        self.assertEqual(len(winners), 1)
        self.assertEqual(len(self.broker.managed_containers()), 1)
        self.assertEqual(self.control(job, "wake")[1]["errorCode"], "session_limit")
        self.assertIsNone(restored.container_id)
        self.assertEqual(self.control(winners[0], "pause")[1]["status"], "completed")
        self.assertEqual(self.reclaim(winners[0])[1]["status"], "completed")
        wake = self.control(job, "wake")[1]
        self.assertEqual(wake["status"], "completed", wake)
        self.assertEqual(wake["result"]["localRestoreVersion"], 1)
        self.assertEqual(len(self.broker.managed_containers()), 1)
        self.assertNotEqual(restored.container_id, original_id)
        self.assertEqual((restored.volume, restored.image, restored.last_seq), (original_volume, original_image, job["seq"]))
        self.assertEqual(restored.pi_state["sessionId"], native_id)
        self.assertEqual(restored.pi_state["thinkingLevel"], "low")
        self.assertEqual(restored.rpc("get_messages", {})["data"], messages)
        self.assertEqual(restored.skills_catalog["snapshot"]["selectedIds"], ["excel-report"])
        self.assertIsNone(restored.gateway)
        self.assertEqual(self.bash(job, "cat retention-marker")["output"], "saved")
        after = self.new_job(job["conversationId"], 2)
        self.create(after)
        self.history(after, "new-authorized-operation")

    def test_reclaim_lost_delete_response_does_not_replay_after_restart(self):
        job = self.new_job()
        self.create(job)
        self.assertEqual(self.control(job, "pause")[1]["status"], "completed")
        session = self.broker.sessions[workspace_key(job)]
        original = self.broker.docker_command

        def command(args, *pos, **kwargs):
            result = original(args, *pos, **kwargs)
            if args == ["rm", session.container_id]:
                raise ValueError("isolated_delete_response_lost")
            return result

        with patch.object(self.broker, "docker_command", side_effect=command):
            request, receipt = self.reclaim(job)
        self.assertEqual(receipt["status"], "unknown")
        self.assertIsNotNone(value_get(session, "reclaimIntent"))
        self.restart()
        with self.assertRaisesRegex(ValueError, "session_unavailable|persisted_workspace_unavailable"):
            self.create(self.new_job(job["conversationId"], 2))
        self.assertEqual(len(self.broker.managed_containers()), 0)
        self.broker.inspect_volume(session)

    def test_plan_mode_and_missing_volume_cannot_get_execute_or_empty_restore(self):
        job = self.new_job()
        self.create(job)
        self.assertEqual(self.control(job, "pause")[1]["status"], "completed")
        self.assertEqual(self.control(job, "mode_set", fence=self.admission(job, "plan", 2))[1]["status"], "completed")
        self.assertEqual(self.control(job, "wake")[1]["errorCode"], "stale_admission")
        plan = self.admission(job, "plan", 2)
        self.assertEqual(self.control(job, "wake", fence=plan)[1]["status"], "completed")
        self.bash(job, "echo forbidden", fence=plan, expected_status="failed")
        self.assertEqual(self.control(job, "pause", fence=plan)[1]["status"], "completed")
        session = self.broker.sessions[workspace_key(job)]
        old_id = session.container_id
        args = {"expected": self.broker.shell_binding(session)}
        with patch("pi_runner.upgrade_linux.retained_reference", return_value=True):
            self.assertEqual(self.control(job, "reclaim_stopped", args, fence=plan)[1]["status"], "failed")
        self.assertTrue(self.broker.container_exists(old_id, by_id=True))
        self.assertEqual(self.control(job, "reclaim_stopped", args, fence=plan)[1]["status"], "completed")
        self.broker.docker_command(["volume", "rm", session.volume])
        self.restart()
        with self.assertRaisesRegex(ValueError, "session_unavailable|persisted_workspace_unavailable"):
            self.create(self.new_job(job["conversationId"], 2))
        self.assertEqual(len(self.broker.managed_containers()), 0)

    def test_legacy_empty_ledger_reclaims_but_missing_used_history_keeps_shell(self):
        job = self.new_job()
        self.create(job)
        session = self.broker.sessions[workspace_key(job)]
        native_id = value_get(session, "currentSessionId")
        prospective = value_get(session, "sessions", {}).get(native_id)
        self.assertTrue(prospective and prospective.endswith(".jsonl"))
        # The previous stop did not persist whether the prospective JSONL existed.
        with patch("pi_runner.workspace.record_stop_history", side_effect=register_session):
            self.assertEqual(self.control(job, "pause")[1]["status"], "completed")
        self.assertIsNone(value_get(session, "stoppedHistory"))
        self.assertEqual(session.last_seq, 0)
        self.assertEqual(self.reclaim(job)[1]["status"], "completed")
        self.restart()
        session = self.broker.sessions[workspace_key(job)]
        current = self.new_job(job["conversationId"], 2)
        self.create(current)
        # The original image may reuse its explicit initial ID. Either way,
        # the worktree binding is unchanged and no native history is invented.
        self.assertEqual(session.key, workspace_key(job))
        self.assertEqual(session.pi_state["messageCount"], 0)
        self.history(current)
        with patch("pi_runner.workspace.record_stop_history", side_effect=register_session):
            self.assertEqual(self.control(current, "pause")[1]["status"], "completed")
        value_set(session, "sessions", {value_get(session, "currentSessionId"): "/workspace/sessions/missing-history.jsonl"})
        shell = session.container_id
        refusal = self.reclaim(current)[1]
        self.assertEqual((refusal["status"], refusal["errorCode"]), ("failed", "workspace_history_unverified"))
        self.assertTrue(self.broker.container_exists(shell, by_id=True))
        self.assertIsNone(value_get(session, "reclaimIntent"))

    def test_upgrade_of_legacy_paused_workspace_restores_local_model_without_gateway(self):
        from .install_linux import source_digest
        from . import upgrade_linux
        from .upgrade_linux import probe_volume, register

        job = self.new_job()
        old_image = os.environ["PI_NATIVE_LEGACY_IMAGE"]
        target = self.broker.image
        self.broker.image = old_image
        try:
            self.create(job)
        finally:
            self.broker.image = target
        self.history(job, "legacy-paused-history")
        session = self.broker.sessions[workspace_key(job)]
        native_id = session.pi_state["sessionId"]
        history = hashlib.sha256(encode(session.rpc("get_messages", {})["data"])).hexdigest()
        self.assertEqual(self.control(job, "pause")[1]["status"], "completed")
        value_set(session, "localModel", None)
        self.assertEqual(self.control(job, "wake")[1]["errorCode"], "workspace_native_image_upgrade_required")
        self.assertEqual(session.phase, "stopped")
        before = probe_volume(self.broker, old_image, session.volume)
        after = probe_volume(self.broker, target, session.volume)
        self.assertEqual(before, after)
        evidence = {f"{field}{stage}": profile[field] for stage, profile in (("Before", before), ("After", after))
                    for field in ("workspaceManifest", "pythonPackages", "nodePackages", "runtime")}
        evidence.update(sessionBefore=native_id, sessionAfter=native_id, historyBefore=history, historyAfter=history)
        plan = register(self.config, {"schemaVersion": 1, "passed": True, "fromImage": old_image, "toImage": target,
            "sourceSha256": source_digest(), "protocolVersion": VERSION,
            "checks": {"piSession": True, "pythonDependencies": True, "nodeDependencies": True, "workspace": True}, "evidence": evidence})
        model = {key: value for key, value in self.create_args(job)["model"].items() if key != "id"}
        original_apply = upgrade_linux._apply

        def observe(*args):
            try:
                return original_apply(*args)
            except Exception:
                traceback.print_exc()
                raise

        with patch.object(upgrade_linux, "_apply", side_effect=observe):
            command, receipt = self.control(job, "upgrade", {"planId": plan["planId"], "localModel": model})
            cutoff = time.monotonic() + 30
            while receipt["status"] == "accepted" and time.monotonic() < cutoff:
                time.sleep(.05)
                receipt = self.call(job, "workspace", {"action": "receipt", "controlId": command["controlId"]})["control"]
        self.assertEqual(receipt["status"], "completed", receipt.get("errorCode"))
        self.assertEqual(session.image, target)
        self.assertEqual(session.pi_state["sessionId"], native_id)
        self.assertEqual(hashlib.sha256(encode(session.rpc("get_messages", {})["data"])).hexdigest(), history)
        self.assertIsNone(session.gateway)
        self.assertTrue(self.broker.container_exists(receipt["result"]["originalContainerId"], by_id=True))
        self.assertEqual(self.control(job, "wake")[1]["status"], "completed")
        self.assertEqual(self.bash(job, "echo local-after-upgrade")["output"].strip(), "local-after-upgrade")
        self.assertIsNone(session.gateway)
