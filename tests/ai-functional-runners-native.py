"""Native signed Pi capacity, retained wake and Pandas container verification."""
import base64
import hashlib
import hmac
import http.client
import importlib.util
import json
import os
from pathlib import Path
import sys
import time
import uuid


def load_setup():
    path = Path(__file__).with_name("ai-functional-runners-setup.py")
    spec = importlib.util.spec_from_file_location("functional_runner_setup", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


SETUP = load_setup()
profile = SETUP.PRIVATE / "isolation.json"
os.environ["TERUISI_NATIVE_ISOLATION_FILE"] = str(profile)
os.environ["TERUISI_NATIVE_ISOLATION_SHA256"] = SETUP.sha(profile.read_bytes())
sys.path.insert(0, str(SETUP.SOURCE / "backend"))
from pandas_runner.key_file import read_key
from pandas_runner import protocol as pandas
from pandas_runner.probe import probe
from pi_runner.client import command
from pi_runner.protocol import HEALTH_PATH, workspace_key


SOURCE = json.loads((SETUP.OUT / "SOURCE.json").read_bytes())
PI_URL = "http://127.0.0.1:28123"
PI_KEY = read_key(SETUP.PRIVATE / "pi.dpapi.json")


class Workspace:
    def __init__(self):
        self.job = {"operationId": "functional-pi-" + uuid.uuid4().hex,
                    "ownerId": "functional-runner@example.invalid",
                    "conversationId": "functional-pi-" + uuid.uuid4().hex,
                    "epoch": 1, "generation": 1, "seq": 1}
        self.sequence = 0
        self.admission = {"mode": "execute", "rootSessionId": self.job["conversationId"],
                          "modeRevision": 1, "admissionEpoch": 1, "treeVersion": 1, "scopeSha256": "a" * 64}

    def call(self, name, payload=None):
        result = command(PI_URL, PI_KEY, {**self.job, "command": name, "payload": payload or {}})
        assert all(result[key] == value for key, value in self.job.items())
        return result

    def create(self):
        return self.call("create", {"gateway": {"url": "http://127.0.0.1:28112/api/ai/pi/gateway",
                                               "capability": uuid.uuid4().hex},
                                    "admission": self.admission,
                                    "model": {"id": "synthetic-no-provider-called", "contextWindow": 65536,
                                              "maxTokens": 8192, "reasoning": True,
                                              "supportedThinkingLevels": ["off", "low", "high"], "thinkingLevel": "low"},
                                    "skillVersion": "1.3.0", "skillIds": ["excel-report"]})

    def state(self):
        return self.call("workspace", {"action": "state"})["workspace"]

    def control(self, name, payload=None, *, status="completed", record_name=None):
        self.sequence += 1
        cid = "functional-" + uuid.uuid4().hex
        request = {"action": "control", "controlId": cid, "controlSeq": self.sequence,
                   "command": name, "payload": {**(payload or {}), "admission": self.admission}}
        response = self.call("workspace", request)
        receipt = response["control"]
        cutoff = time.monotonic() + 20
        while receipt["status"] == "accepted" and time.monotonic() < cutoff:
            time.sleep(0.1)
            receipt = self.call("workspace", {"action": "receipt", "controlId": cid})["control"]
        SETUP.record((record_name or ("pi-" + name)) + ".json", receipt)
        assert receipt["status"] == status, receipt
        return receipt


def inventory(label):
    return SETUP.invoke(label, "workspace-inventory")


def capacity_rejection(workspace):
    try:
        workspace.create()
    except ValueError as error:
        assert str(error) == "session_limit"
        return str(error)
    raise AssertionError("capacity rejection missing")


def pi_lifecycle():
    health = command(PI_URL, PI_KEY, {}, path=HEALTH_PATH)
    SETUP.record("PI-HEALTH.json", health)
    assert health["activeCount"] == health["unresolvedCount"] == 0
    assert health["sourceSha256"] == SOURCE["runnerDigests"]["pi"]
    start = inventory("pi-inventory-before")
    assert not start["pi"]
    first = Workspace()
    created = first.create()
    assert created["status"] == "idle" and created["state"]["skillVersion"] == "1.3.0"
    assert any(item.get("name") == "skill:excel-report" for item in created["state"]["commands"])
    reference = json.loads((SETUP.SOURCE / "backend/pi_runner/bundled_skills/1.3.0/manifest.json").read_bytes())
    assert created["skills"] == [item for item in reference["skills"] if item["id"] == "excel-report"]
    SETUP.record("PI-CREATE.json", {key: value for key, value in created.items()
                                   if key in ("status", "state", "skills", "operationId")})
    active = first.state()
    original_id, original_volume = active["containerId"], active["volume"]
    original_session = active["piState"]["sessionId"]
    rejected_running = capacity_rejection(Workspace())
    live = inventory("pi-inventory-live")
    assert len(live["pi"]) == 1 and live["pi"][0]["id"] == original_id
    assert live["pi"][0]["running"] is True and live["pi"][0]["network"] == "none"
    marker = b"retained-synthetic-file\n"
    marker_sha = hashlib.sha256(marker).hexdigest()
    first.control("file_write", {"path": "work/functional.txt", "expectedSha256": None,
                                 "base64": base64.b64encode(marker).decode()})
    stopped = first.control("pause")
    assert stopped["result"] == {"containerId": original_id, "stoppedVerified": True}
    stopped_native = inventory("pi-inventory-stopped")
    assert len(stopped_native["pi"]) == 1 and stopped_native["pi"][0]["running"] is False
    rejected_stopped = capacity_rejection(Workspace())
    binding = {key: active[key] for key in ("workspaceId", "containerId", "image", "volume", "lastSeq")}
    reclaimed = first.control("reclaim_stopped", {"expected": binding, "requireLocalRestore": True})["result"]
    assert reclaimed["containerRemoved"] is True and reclaimed["volumePreserved"] is True
    retained_native = inventory("pi-inventory-retained")
    assert not retained_native["pi"] and original_volume in retained_native["volumes"]
    awake = first.control("wake")["result"]
    assert awake["localRestoreVersion"] == 1 and awake["containerId"] != original_id
    new = first.state()
    assert new["volume"] == original_volume and new["piState"]["sessionId"] == original_session
    assert new["piState"]["thinkingLevel"] == "low" and new["image"] == active["image"]
    assert first.call("state")["pendingGatewayRequests"] == []
    new_native = inventory("pi-inventory-awake")
    assert len(new_native["pi"]) == 1 and new_native["pi"][0]["volumes"] == [original_volume]
    read = first.control("file_read", {"path": "work/functional.txt", "expectedSha256": marker_sha})
    assert read["result"]["text"] == marker.decode() and read["result"]["sha256"] == marker_sha
    raw = first.call("workspace", {"action": "download", "downloadId": read["result"]["downloadId"]})["download"]
    assert base64.b64decode(raw["base64"], validate=True) == marker
    disposed = first.call("dispose")
    assert disposed["status"] == "disposed"
    SETUP.record("PI-DISPOSE.json", {"status": disposed["status"], "operationId": disposed["operationId"]})
    removal = SETUP.invoke("pi-remove-owned-volume", "remove-disposed-volume", workspace_key(first.job), original_volume)
    after = inventory("pi-inventory-after")
    assert after["pi"] == start["pi"] and after["volumes"] == start["volumes"]
    SETUP.record("PI-LIFECYCLE.json", {"rejectedRunning": rejected_running, "rejectedStopped": rejected_stopped,
                                     "originalContainerId": original_id, "newContainerId": awake["containerId"],
                                     "volume": original_volume, "nativeSessionId": original_session, "localRestoreVersion": 1,
                                     "fileSha256": marker_sha, "removal": removal, "modelRequests": 0})


def pandas_signed(job):
    key = read_key(SETUP.PRIVATE / "pandas.dpapi.json")
    raw = pandas.encode(pandas.validate_job(job))
    nonce, stamp = uuid.uuid4().hex, str(int(time.time()))
    connection = http.client.HTTPConnection("127.0.0.1", 28121, timeout=23)
    try:
        connection.request("POST", pandas.PATH, body=raw, headers={"Content-Type": "application/json",
                           "X-Nonce": nonce, "X-Timestamp": stamp, "X-Signature": pandas.signature(key, stamp, nonce, raw)})
        with connection.getresponse() as response:
            body = response.read(pandas.MAX_OUTPUT + 1025)
            assert len(body) < pandas.MAX_OUTPUT + 1025
            assert hmac.compare_digest(response.getheader("X-Signature"), pandas.signature(key, stamp, nonce, body, "response"))
            return {"status": response.status, "reply": pandas.decode(body), "brokerRef": hashlib.sha256(nonce.encode()).hexdigest()}
    finally:
        connection.close()


def pandas_container():
    pd_image = SOURCE["images"]["pandas"]
    readiness = probe(SETUP.PRIVATE / "pandas.dpapi.json", pd_image)
    start = inventory("pandas-inventory-before")
    code = """
import os, pathlib, socket
from tempfile import TemporaryFile
with TemporaryFile(dir='/work') as f:
    f.write(b'synthetic transient file')
    f.seek(0)
    transient = f.read() == b'synthetic transient file'
with socket.socket() as client:
    client.settimeout(1)
    no_listener = client.connect_ex(('127.0.0.1', 28123)) != 0
result = pd.DataFrame([{'net_cents': int(frames['sales']['amount_cents'].sum()),
 'loopback_only': [name for _, name in socket.if_nameindex()] == ['lo'],
 'host_runner_unreachable': no_listener, 'nonroot': os.getuid() != 0,
 'temporary_file_usable': transient, 'host_key_inaccessible': not pathlib.Path('/run/user/1000/docker.sock').exists()}])
"""
    frames = {"sales": [{"amount_cents": 1800}, {"amount_cents": -300}]}
    good = pandas_signed({"frames": frames, "code": code})
    SETUP.record("PANDAS-CONTAINER-SUCCESS.json", good)
    assert good["status"] == 200 and good["reply"]["cleanupVerified"] is True and good["reply"]["image"] == pd_image
    assert good["reply"]["result"]["rows"] == [{"net_cents": 1500, "loopback_only": True, "host_runner_unreachable": True,
                                              "nonroot": True, "temporary_file_usable": True, "host_key_inaccessible": True}]
    middle = inventory("pandas-inventory-success")
    assert not middle["containers"]
    failure = pandas_signed({"frames": frames, "code": "raise RuntimeError('synthetic isolated execution failure')"})
    SETUP.record("PANDAS-CONTAINER-ERROR.json", failure)
    assert failure["status"] == 503 and failure["reply"] == {"error": "sandbox_failed"}
    after = inventory("pandas-inventory-error")
    assert not after["containers"] and start["volumes"] == middle["volumes"] == after["volumes"]
    assert probe(SETUP.PRIVATE / "pandas.dpapi.json", pd_image) == readiness
    SETUP.record("PANDAS-NATIVE.json", {"readiness": readiness, "successBrokerRef": good["brokerRef"],
                                      "failureBrokerRef": failure["brokerRef"], "cleanAfterEach": True})


if __name__ == "__main__":
    SETUP.check_distro()
    {"pi": pi_lifecycle, "pandas": pandas_container}[sys.argv[1]]()
