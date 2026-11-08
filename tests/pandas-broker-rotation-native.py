"""Real Linux/rootless rehearsal. Run only in the private W6R WSL distribution."""
import base64
import hashlib
import hmac
import http.client
import importlib
import json
import os
from pathlib import Path
import pwd
import secrets
import socket
import sqlite3
import subprocess
import sys
import time
import uuid


if os.getuid() != 0 or os.environ.get("WSL_DISTRO_NAME") != "Codex-AI-Batch2-20261108":
    raise SystemExit("private W6R distro required")

MATERIALS = Path("/root/w6r-fixture")
ROOT = Path("/opt/teruisi-pandas-w6r-fixture")
HOME = Path("/home/teruisi-pandas")
sys.path.insert(0, str(MATERIALS))
from pandas_broker_rotation_linux import Rotation, Refused, create_file, decode, encode, sha, source_digest


class Fixture(Rotation):
    def __init__(self, name):
        if name not in {"happy", "intent", "reload"}:
            raise ValueError("fixed rehearsal fixture required")
        super().__init__(operator_sha=sha((MATERIALS / "pandas_broker_rotation_linux.py").read_bytes()))
        self.install = ROOT / name
        self.releases = self.install / "releases"
        self.control = self.install / "rotation"
        self.config = HOME / ".config" / ("teruisi-pandas-w6r-" + name)
        self.unit_name = f"teruisi-pandas-w6r-{name}.service"
        self.unit = Path("/etc/systemd/user") / self.unit_name
        self.port = 18129
        self.distribution = "Codex-AI-Batch2-20261108"
        self.fault = None

    def unit_bytes(self, digest):
        # The broker bytes stay exact. The separate user unit pins a distinct
        # port via a root-owned, test-only Python bootstrap outside the release.
        return super().unit_bytes(digest).replace(b"Environment=PYTHONUTF8=1\n",
            f"Environment=PYTHONUTF8=1 PYTHONPATH={ROOT}\n".encode())

    def replace_unit(self, path, plan):
        if self.fault == "after-intent":
            raise Refused("injected_after_intent")
        super().replace_unit(path, plan)
        if self.fault == "daemon-reload":
            raise Refused("injected_daemon_reload_failure")

    def ctl(self, *args):
        return self.user("/usr/bin/systemctl", "--user", *args)

    def install_original(self, files, image):
        old = source_digest(files)
        self.install.mkdir(mode=0o755)
        package = self.releases / old / "backend/pandas_runner"
        package.mkdir(parents=True, mode=0o755)
        for name, content in files.items():
            create_file(package / name, content, 0o444)
        for path in (package, package.parent, package.parent.parent, self.releases, self.install):
            path.chmod(0o555)
        self.config.mkdir(mode=0o700)
        self.state.mkdir(mode=0o700)
        key = secrets.token_bytes(32)
        create_file(self.config / "key", key, 0o600)
        create_file(self.config / "broker.json", encode({
            "docker": "/usr/bin/docker", "socket": "/run/user/1000/docker.sock", "image": image,
            "keyFile": str(self.config / "key"), "stateDirectory": str(self.state),
        }), 0o600)
        account = pwd.getpwnam("teruisi-pandas")
        for path in (self.config, self.state, self.config / "key", self.config / "broker.json"):
            os.chown(path, 1000, account.pw_gid)
        create_file(self.unit, self.unit_bytes(old), 0o644)
        self.ctl("daemon-reload")
        self.ctl("start", self.unit_name)
        return old, key


def assert_refused(function, reason=None):
    try:
        function()
    except (Refused, BlockingIOError, FileNotFoundError) as error:
        if reason is not None:
            assert str(error) == reason, (str(error), reason)
        return str(error)
    raise AssertionError("unsafe condition passed")


def signature(key, stamp, nonce, payload, path, direction):
    body = "\n".join(["pandas-v1", direction, "POST", path, stamp, nonce, sha(payload)]).encode()
    return hmac.new(key, body, hashlib.sha256).hexdigest()


def signed(port, key, path, raw, *, stamp=None, nonce=None, valid=True):
    stamp = stamp or str(int(time.time()))
    nonce = nonce or uuid.uuid4().hex
    supplied = signature(key, stamp, nonce, raw, path, "request") if valid else "0" * 64
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=24)
    try:
        connection.request("POST", path, body=raw, headers={"Content-Type": "application/json",
            "X-Nonce": nonce, "X-Timestamp": stamp, "X-Signature": supplied})
        reply = connection.getresponse()
        body = reply.read(24000)
        if valid:
            assert hmac.compare_digest(reply.getheader("X-Signature", ""), signature(key, stamp, nonce, body, path, "response"))
        else:
            assert reply.getheader("X-Signature") is None
        return reply.status, decode(body)
    finally:
        connection.close()


def strict_probe(package, key_file, image, self_test):
    sys.path.insert(0, str(package))
    try:
        probe = importlib.import_module("pandas_runner.probe")
        probe.PORT = 18129
        return probe.probe(key_file, image, self_test=self_test)
    finally:
        for name in list(sys.modules):
            if name == "pandas_runner" or name.startswith("pandas_runner."):
                del sys.modules[name]
        sys.path.pop(0)


def wait_status(fixture, key, digest):
    for _ in range(40):
        try:
            result = signed(fixture.port, key, "/v1/status", b"{}")
            assert result[0] == 200 and result[1]["runnerSha256"] == digest, result
            return
        except (ConnectionError, TimeoutError):
            time.sleep(.25)
    raise AssertionError("private broker unavailable")


def package_files(path):
    return {item.name: item.read_bytes() for item in path.glob("*.py") if not item.name.startswith("test_")}


def exercise(name, old_files, new_files, data):
    fixture = Fixture(name)
    image, job = data["image"], data["job"]
    successor = source_digest(new_files)
    old, key = fixture.install_original(old_files, image)
    try:
        wait_status(fixture, key, old)
        broker_manifest = "c" * 64
        binding = {"sourceCommit": "a" * 40, "preparedAppId": "b" * 32, "preparedAppSha256": "d" * 64,
                   "preparedManifestSha256": broker_manifest, "windowsConfigSha256": "e" * 64,
                   "windowsKeySha256": "f" * 64, "channelKeySha256": sha(key), "image": image, "sourceSha256": successor,
                   "operatorSha256": fixture.operator_sha}
        owner = {"maintenanceId": "a" * 32, "publicationOwnerPid": 4321}
        before = {"unit": fixture.unit.read_bytes(), "config": (fixture.config / "broker.json").read_bytes(),
                  "key": (fixture.config / "key").read_bytes(), "pid": fixture.effective()["MainPID"],
                  "ledger": (fixture.state / "requests.sqlite3").read_bytes()}
        prepare_request = {"action": "prepare", "binding": binding, "predecessorSourceSha256": old,
                           "files": {name: base64.b64encode(raw).decode() for name, raw in new_files.items()}}
        prepared = fixture.dispatch(prepare_request)
        plan = prepared["registeredPlanSha256"]
        check = {"action": "check", "binding": binding, "planSha256": plan}
        switch = check | {"action": "switch", "owner": owner}
        assert fixture.dispatch(prepare_request) == prepared
        assert fixture.dispatch(check)["checked"] is True
        assert fixture.unit.read_bytes() == before["unit"] and fixture.effective()["MainPID"] == before["pid"]
        assert (fixture.config / "broker.json").read_bytes() == before["config"] and (fixture.config / "key").read_bytes() == before["key"]
        assert (fixture.state / "requests.sqlite3").read_bytes() == before["ledger"]
        assert_refused(lambda: fixture.dispatch(prepare_request | {"binding": binding | {"channelKeySha256": "8" * 64}}),
                       "channel_key_identity_mismatch")
        assert_refused(lambda: fixture.dispatch(check | {"binding": binding | {"preparedAppSha256": "7" * 64}}),
                       "registered_plan_binding_changed")
        assert_refused(lambda: fixture.dispatch(switch))
        plan_path = fixture.control / plan
        assert not (plan_path / "intent.json").exists()

        if name == "happy":
            candidate_file = fixture.releases / successor / "backend/pandas_runner/server.py"
            candidate_file.chmod(0o644)
            try:
                assert_refused(lambda: fixture.dispatch(check), "unexpected_owner_mode_or_file_type")
            finally:
                candidate_file.chmod(0o444)
            dropin = fixture.unit.with_name(fixture.unit.name + ".d")
            dropin.mkdir()
            create_file(dropin / "fixture.conf", b"[Service]\nEnvironment=W6R_FIXTURE=1\n", 0o644)
            fixture.ctl("daemon-reload")
            assert_refused(lambda: fixture.dispatch(check), "effective_unit_binding_changed")
            (dropin / "fixture.conf").unlink()
            dropin.rmdir()
            fixture.ctl("daemon-reload")
            fixture.ctl("stop", fixture.unit_name)
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
                listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                listener.bind(("127.0.0.1", fixture.port))
                listener.listen()
                assert_refused(lambda: fixture.dispatch(switch), "pandas_port_still_bound")
                assert not (plan_path / "intent.json").exists()
            with fixture.unit.open("ab") as unit_stream:
                unit_stream.write(b"# fixture CAS conflict\n")
            try:
                assert_refused(lambda: fixture.dispatch(switch), "unit_compare_and_swap_conflict")
                assert not (plan_path / "intent.json").exists()
            finally:
                fixture.unit.write_bytes(before["unit"])
                fixture.ctl("daemon-reload")
            orphan_name = "teruisi-pandas-" + uuid.uuid4().hex
            fixture.docker("create", "--pull=never", "--name", orphan_name, "--label", "teruisi.pandas-broker=v1", image)
            try:
                assert_refused(lambda: fixture.dispatch(switch), "unresolved_pandas_container")
                assert fixture.docker("ps", "-aq", "--filter", "name=^/" + orphan_name + "$").strip()
                assert not (plan_path / "intent.json").exists()
            finally:
                fixture.docker("rm", orphan_name)
            fixture.ctl("start", fixture.unit_name)
            wait_status(fixture, key, old)

        nonce, stamp = uuid.uuid4().hex, str(int(time.time()))
        assert signed(fixture.port, key, "/v1/status", b"{}", stamp=stamp, nonce=nonce)[0] == 200
        fixture.ctl("stop", fixture.unit_name)
        ledger = fixture.state / "requests.sqlite3"
        ledger_before = ledger.stat().st_ino, sha(ledger.read_bytes())
        if name != "happy":
            fixture.fault = "after-intent" if name == "intent" else "daemon-reload"
            original_error = assert_refused(lambda: fixture.dispatch(switch))
            assert (plan_path / "intent.json").exists() and not (plan_path / "switched.json").exists()
            assert fixture.unit.read_bytes() == fixture.unit_bytes(old if name == "intent" else successor)
            assert_refused(lambda: fixture.dispatch(switch), "original_switch_outcome_unresolved")
            assert_refused(lambda: fixture.dispatch(switch | {"action": "startup-check"}))
            assert (ledger.stat().st_ino, sha(ledger.read_bytes())) == ledger_before
            return {"scenario": name, "injected": original_error, "preservedIntent": True, "replayRejected": True}

        switched = fixture.dispatch(switch)
        assert switched["status"] == "switched_stopped" and not switched["started"]
        assert fixture.effective()["MainPID"] == "0"
        assert (ledger.stat().st_ino, sha(ledger.read_bytes())) == ledger_before
        assert fixture.dispatch(switch | {"action": "startup-check"}) == switched
        assert_refused(lambda: fixture.dispatch(switch), "original_switch_outcome_unresolved")
        fixture.ctl("start", fixture.unit_name)
        wait_status(fixture, key, successor)
        observed = fixture.dispatch(switch | {"action": "identity"})["processIdentity"]
        candidate_backend = fixture.releases / successor / "backend"
        status = strict_probe(candidate_backend, fixture.config / "key", image, False)
        selftest = strict_probe(candidate_backend, fixture.config / "key", image, True)
        assert fixture.dispatch(switch | {"action": "identity"})["processIdentity"] == observed
        receipt = {"version": 1, "switch": switched, "processIdentity": observed,
                   "signedStatus": status, "signedSelfTest": selftest, "applicationManifestSha256": broker_manifest}
        bad = encode(receipt | {"signedSelfTest": status})
        done = switch | {"action": "complete", "startupReceipt": base64.b64encode(bad).decode(),
                         "startupReceiptSha256": sha(bad)}
        assert_refused(lambda: fixture.dispatch(done), "original_signed_startup_unproved")
        raw = encode(receipt)
        done |= {"startupReceipt": base64.b64encode(raw).decode(), "startupReceiptSha256": sha(raw)}
        verified = fixture.dispatch(done)
        assert verified["postconditionsVerified"] and fixture.dispatch(done) == verified
        assert strict_probe(candidate_backend, fixture.config / "key", image, False)["status"] == "ready"
        for package, pinned in [(fixture.releases / old / "backend", image), (candidate_backend, "sha256:" + "0" * 64)]:
            try:
                strict_probe(package, fixture.config / "key", pinned, False)
            except ValueError:
                pass
            else:
                raise AssertionError("strict probe accepted a changed digest or image")
        assert signed(fixture.port, key, "/v1/status", b"{}", valid=False)[0] == 403
        assert abs(time.time() - int(stamp)) < 60
        assert signed(fixture.port, key, "/v1/status", b"{}", stamp=stamp, nonce=nonce)[0] == 503
        with sqlite3.connect("file:" + str(ledger) + "?mode=ro", uri=True) as db:
            assert db.execute("SELECT COUNT(*) FROM requests WHERE nonce = ?", (nonce,)).fetchone() == (1,)
        assert ledger.stat().st_ino == ledger_before[0]
        request_nonce = uuid.uuid4().hex
        code, computed = signed(fixture.port, key, "/v1/pandas", encode(job), nonce=request_nonce)
        assert code == 200 and computed["cleanupVerified"] and computed["result"]["rows"] == data["expectedRows"], computed
        journal = subprocess.run(["/usr/bin/journalctl", "--no-pager", "-o", "cat", "SYSLOG_IDENTIFIER=teruisi-pandas"],
                                 timeout=8, capture_output=True, check=True).stdout.decode()
        events = [json.loads(line.split("pandas_stage ", 1)[1]) for line in journal.splitlines()
                  if "pandas_stage " in line and hashlib.sha256(request_nonce.encode()).hexdigest() in line]
        expected_stages = {"broker_receive", "broker_job_decode", "broker_admission", "container_preflight", "container_create",
                           "container_isolation_check", "container_execute", "container_result_validation", "container_cleanup", "broker_reply"}
        assert {entry["stage"] for entry in events if entry["status"] == "ok"} == expected_stages, events
        assert job["code"] not in journal and request_nonce not in journal
        assert not fixture.docker("ps", "-aq", "--filter", "label=teruisi.pandas-broker=v1").strip()
        return {"scenario": name, "predecessor": old, "successor": successor, "image": image,
                "dataframeResult": computed["result"]["rows"], "exportProvenance": data["provenance"],
                "rootlessUser": 1000, "zeroContainers": True, "sameLedgerReplayRejected": True,
                "startupReceiptSha256": verified["startupReceiptSha256"], "repeatCompletionReused": True,
                "realDiagnosticStages": sorted(expected_stages)}
    finally:
        fixture.ctl("stop", fixture.unit_name)


def main():
    account = pwd.getpwnam("teruisi-pandas")
    try:
        (HOME / ".config").mkdir(mode=0o700)
        os.chown(HOME / ".config", account.pw_uid, account.pw_gid)
    except FileExistsError:
        pass
    ROOT.mkdir(mode=0o755)
    create_file(ROOT / "sitecustomize.py",
        b"import sys\nfrom pathlib import Path\nsys.path.insert(0, str(Path.cwd()))\n"
        b"from pandas_runner import protocol\nprotocol.PORT = 18129\nsys.path.pop(0)\n", 0o444)
    old = package_files(MATERIALS / "old")
    new = package_files(MATERIALS / "new")
    data = decode((MATERIALS / "frames.json").read_bytes())
    for name in ("happy", "intent", "reload"):
        result = exercise(name, old, new, data)
        print(encode(result).decode(), flush=True)


if __name__ == "__main__":
    main()
