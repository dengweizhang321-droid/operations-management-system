"""Provision and reconcile the bounded private WSL Runner test services."""
import base64
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tarfile
import time
import winreg


SOURCE = Path(__file__).resolve().parents[1]
HOST_PATH = Path(__file__).with_name("ai-functional-runners-host.py")
HOST_CODE = HOST_PATH.read_text(encoding="utf-8")
HOST = {}
exec(compile(HOST_CODE, str(HOST_PATH), "exec"), HOST)
DISTRO, ID = HOST["DISTRO"], HOST["ID"]
PRIVATE = Path("D:/codex-isolated") / f"native-control-{ID}"
OUT = Path("D:/codex-artifacts/ai-isolated-functional-20261108/runners")
PREVIOUS = Path("D:/codex-artifacts/ai-native-control-isolation-20261108")
FIXTURE_ROOT = Path("D:/codex-isolated/ai-repair-batch2-20261108-wsl")
PROOF = {
    "pi": Path("D:/codex-artifacts/ai-repair-batch3-20261108/w11b/IMAGE.json"),
    "pandas": Path("D:/codex-artifacts/ai-repair-batch2-20261108/environment/IMAGE.json"),
}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def record(name, value):
    with (OUT / name).open("x", encoding="utf-8") as file:
        json.dump(value, file, ensure_ascii=False, indent=2, sort_keys=True)
        file.write("\n")


def check_distro():
    roots = []
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Lxss") as parent:
        for i in range(winreg.QueryInfoKey(parent)[0]):
            with winreg.OpenKey(parent, winreg.EnumKey(parent, i)) as child:
                if winreg.QueryValueEx(child, "DistributionName")[0] == DISTRO:
                    roots.append(Path(winreg.QueryValueEx(child, "BasePath")[0]).resolve(strict=True))
    assert roots == [FIXTURE_ROOT.resolve(strict=True)]


def invoke(label, action, *args, raw=None):
    assert not any((OUT / (label + suffix)).exists() for suffix in (".stderr", ".stdout"))
    user = "root" if action in {"old-intents", "pandas-journal"} else "teruisi-pandas"
    command = ["wsl.exe", "-d", DISTRO, "-u", user, "--exec", "/usr/bin/python3", "-B", "-c", HOST_CODE, action, *args]
    env = {key: os.environ[key] for key in ("SystemRoot", "SystemDrive", "PATH", "TEMP", "TMP") if key in os.environ}
    result = subprocess.run(command, input=raw, capture_output=True, env=env, timeout=130)
    for suffix, data in ((".stderr", result.stderr), (".stdout", result.stdout)):
        with (OUT / (label + suffix)).open("xb") as file:
            file.write(data)
    result.check_returncode()
    return json.loads(result.stdout)


def historical_compare(before, intents):
    old = json.loads((PREVIOUS / "WSL-BEFORE.json").read_bytes())
    assert len(intents) == 24 and intents == old["oldIntentFiles"]
    assert {unit: {key: value[key] for key in ("MainPID", "ActiveState", "SubState")}
            for unit, value in before["oldUnits"].items()} == old["units"]


def inputs():
    git = lambda *args: subprocess.check_output(["git", *args], cwd=SOURCE, timeout=30)
    commit = git("rev-parse", "HEAD").decode().strip()
    tree = git("rev-parse", commit + "^{tree}").decode().strip()
    raw = git("archive", commit, "backend/pi_runner", "backend/pandas_runner",
              "containers/pi-agent", "containers/pandas-sandbox")
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:") as archive:
        files = {m.name: archive.extractfile(m).read() for m in archive if m.isfile()}
    packages = {name: value for name, value in files.items()
                if name.startswith(("backend/pi_runner/", "backend/pandas_runner/"))
                and not Path(name).name.startswith("test_")}
    for name, value in files.items():
        assert (SOURCE / name).read_bytes() == value, f"source_materialization_changed: {name}"
    old = json.loads((PREVIOUS / "WSL-INSTALL.json").read_bytes())
    manifest = {name: sha(value) for name, value in packages.items()}
    assert manifest == old["manifest"]
    proofs = {name: json.loads(path.read_bytes()) for name, path in PROOF.items()}
    builder_path = SOURCE / "containers/pi-agent/build_image.py"
    spec = importlib.util.spec_from_file_location("pi_builder", builder_path)
    builder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(builder)
    pi_inputs = {name: sha(value) for name, value in builder.source_inputs(SOURCE).items()}
    assert sha(encode(pi_inputs)) == proofs["pi"]["inputsSha256"]
    pd_inputs = {name: sha(files[name]) for name in proofs["pandas"]["sources"]}
    assert pd_inputs == proofs["pandas"]["sources"]
    images = {name: proof["image"] for name, proof in proofs.items()}
    assert images == old["images"]
    return packages, {"commit": commit, "tree": tree, "files": manifest, "runnerDigests": old["digests"],
                      "images": images, "imageInputs": {"pi": pi_inputs, "pandas": pd_inputs},
                      "imageProofSha256": {name: sha(path.read_bytes()) for name, path in PROOF.items()}}


def install():
    assert not PRIVATE.exists()
    before = invoke("01-precheck", "snapshot")
    intents = invoke("02-old-intents-before", "old-intents")
    historical_compare(before, intents)
    assert before["docker"]["ActiveState"] == "inactive" and not before["listeners"]
    assert not any(item["FragmentPath"] for item in before["units"].values())
    packages, material = inputs()
    profile = encode({"version": 1, "id": ID, "root": str(PRIVATE), "sourceRoot": str(SOURCE),
                      "wslDistribution": DISTRO})
    profile_sha = sha(profile)
    unit_hashes = {name: sha(HOST["unit_bytes"](name, profile_sha)) for name in HOST["UNITS"]}
    record("PRECHECK.json", {"wsl": before, "intents": intents, "unitHashesToCreate": unit_hashes,
                             "registryRoot": str(FIXTURE_ROOT), "hostScriptSha256": sha(HOST_PATH.read_bytes())})
    record("SOURCE.json", material)
    PRIVATE.mkdir()
    (PRIVATE / "isolation.json").write_bytes(profile)
    sys.path.insert(0, str(SOURCE / "backend"))
    from pandas_runner.key_file import dpapi
    keys = {name: secrets.token_bytes(32) for name in HOST["UNITS"]}
    for name, key in keys.items():
        encrypted = base64.b64encode(dpapi(key, protect=True)).decode()
        with (PRIVATE / (name + ".dpapi.json")).open("xb") as file:
            file.write(encode({"version": 1, "keyDpapiBase64": encrypted}))
    archive = io.BytesIO()
    with tarfile.open(fileobj=archive, mode="w:") as packed:
        payload = {**packages, "inputs.json": encode(material), "isolation.json": profile,
                   **{name + ".key": key for name, key in keys.items()}}
        for name, raw in sorted(payload.items()):
            item = tarfile.TarInfo(name)
            item.size, item.mode = len(raw), 0o600
            packed.addfile(item, io.BytesIO(raw))
    actual = invoke("03-start", "start", raw=archive.getvalue())
    assert actual["unitSha256"] == unit_hashes
    record("RUNNERS-STARTED.json", actual)
    print(json.dumps({"profile": str(PRIVATE / "isolation.json"), "profileSha256": profile_sha,
                      "pandasImage": material["images"]["pandas"], "piPort": 28123, "pandasPort": 28121}))


def cleanup():
    before = json.loads((OUT / "PRECHECK.json").read_bytes())
    profile_sha = sha((PRIVATE / "isolation.json").read_bytes())
    unit_hashes = {name: sha(HOST["unit_bytes"](name, profile_sha)) for name in HOST["UNITS"]}
    final = invoke("04-stop", "stop", json.dumps(unit_hashes))
    final["oldIntents"] = invoke("05-old-intents-after", "old-intents")
    historical_compare(final["final"], final["oldIntents"])
    assert final["final"]["oldUnitSha256"] == before["wsl"]["oldUnitSha256"]
    assert final["oldIntents"] == before["intents"]
    record("RUNNERS-CLEANUP-LINUX.json", final)
    if not final["drained"]:
        raise RuntimeError("private Runner cleanup inventory unresolved; evidence, keys and unit files preserved")
    with (PRIVATE / "relay.stop").open("xb") as file:
        file.write(b"stop this private byte relay\n")
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        def occupied(port):
            with socket.socket() as sock:
                sock.settimeout(0.2)
                return sock.connect_ex(("127.0.0.1", port)) == 0
        if not any(occupied(port) for port in (28121, 28123)):
            break
        time.sleep(0.25)
    else:
        raise RuntimeError("private Windows relay still listening")
    final["relayPortsClosed"] = True
    for name in ("isolation.json", "pi.dpapi.json", "pandas.dpapi.json"):
        path = PRIVATE / name
        if path.is_file():
            assert not path.is_symlink() and path.stat().st_nlink == 1
            path.unlink()
    subprocess.run(["wsl.exe", "--terminate", DISTRO], capture_output=True, check=True, timeout=30)
    listed = subprocess.check_output(["wsl.exe", "--list", "--verbose"], timeout=15).decode("utf-16-le")
    assert any(DISTRO in line and "Stopped" in line for line in listed.splitlines())
    (OUT / "WSL-FINAL.txt").write_text(listed, encoding="utf-8")
    final["privateWslStopped"] = True
    final["windowsTemporaryKeysRemoved"] = True
    record("RUNNERS-CLEANUP.json", final)
    print(json.dumps({"privateWslStopped": True, "unresolvedContainers": final["preservedUnknowns"],
                      "oldUnitCount": len(final["final"]["oldUnits"]), "oldIntentCount": len(final["oldIntents"])}))


def reconcile_started():
    profile_sha = sha((PRIVATE / "isolation.json").read_bytes())
    actual = json.loads((OUT / "03-start.stdout").read_bytes())
    unit_hashes = {name: sha(HOST["unit_bytes"](name, profile_sha)) for name in HOST["UNITS"]}
    observed = invoke("03-reconcile", "snapshot")
    assert actual["unitSha256"] == unit_hashes
    assert observed["units"] == actual["after"]["units"] and observed["listeners"] == actual["after"]["listeners"]
    record("RUNNERS-STARTED.json", actual)
    print(json.dumps({"reconciledWithoutRestart": True, "profileSha256": profile_sha, "unitSha256": unit_hashes}))


def start_existing():
    profile_sha = sha((PRIVATE / "isolation.json").read_bytes())
    original = json.loads((OUT / "03-start.stdout").read_bytes())
    hashes = {name: sha(HOST["unit_bytes"](name, profile_sha)) for name in HOST["UNITS"]}
    assert original["unitSha256"] == hashes
    actual = invoke("03-start-existing", "start-existing")
    assert actual["unitSha256"] == hashes and actual["docker"] == original["dockerBefore"]
    record("RUNNERS-STARTED.json", {**original, "startAfterKnownIdleStop": actual})
    print(json.dumps({"startedFromVerifiedInactive": True, "profileSha256": profile_sha, "unitSha256": hashes}))


def observe_completed():
    expected = json.loads((OUT / "PRECHECK.json").read_bytes())
    started = json.loads((OUT / "RUNNERS-STARTED.json").read_bytes())
    state = invoke("06-observe", "snapshot")
    intents = invoke("07-old-intents-observe", "old-intents")
    historical_compare(state, intents)
    assert state["oldUnitSha256"] == expected["wsl"]["oldUnitSha256"]
    assert state["units"] == started.get("startAfterKnownIdleStop", started)["after"]["units"]
    current_inventory = invoke("08-inventory-observe", "workspace-inventory")
    assert {"containers": current_inventory["containers"], "volumes": current_inventory["volumes"]} == started["dockerBefore"]
    listed = subprocess.check_output(["wsl.exe", "--list", "--verbose"], timeout=15).decode("utf-16-le")
    (OUT / "WSL-FUNCTIONAL-OBSERVED.txt").write_text(listed, encoding="utf-8")
    record("RUNNERS-OBSERVED.json", {"wsl": state, "oldIntents": intents, "inventory": current_inventory,
                                    "testWorkloadsDrained": True, "fixtureServiceTeardownPending": True})
    print(json.dumps({"observedTestContainerCount": len(current_inventory["containers"]),
                      "oldIntentCount": len(intents), "oldUnitCount": len(state["oldUnits"])}))


def evidence_index(*, final=False):
    filename = "RUNNERS-INDEX-FINAL.json" if final else "RUNNERS-INDEX.json"
    if final:
        assert (OUT / "RUNNERS-CLEANUP.json").is_file()
    excluded = {filename} if final else {filename, "relay.stdout", "relay.stderr"}
    evidence = {}
    for item in sorted(OUT.iterdir()):
        if item.name in excluded or not item.is_file():
            continue
        assert item.stat().st_size < 1024 * 1024
        evidence[item.name] = {"sha256": sha(item.read_bytes()), "bytes": item.stat().st_size}
    scripts = {item.relative_to(SOURCE).as_posix(): sha(item.read_bytes())
               for item in sorted((SOURCE / "tests").glob("ai-functional-runners-*.py"))}
    record(filename, {"runtimeCommit": json.loads((OUT / "SOURCE.json").read_bytes())["commit"],
                      "evidence": evidence, "scripts": scripts,
                      "teardownPending": not final,
                      "workingRelayLogsExcluded": sorted(excluded - {filename})})
    print(json.dumps({"index": filename, "evidenceFiles": len(evidence), "scripts": len(scripts)}))


if __name__ == "__main__":
    check_distro()
    OUT.mkdir(exist_ok=True, parents=True)
    {"install": install, "reconcile-started": reconcile_started, "start-existing": start_existing,
     "observe": observe_completed, "cleanup": cleanup, "index": evidence_index,
     "index-final": lambda: evidence_index(final=True)}[sys.argv[1]]()
