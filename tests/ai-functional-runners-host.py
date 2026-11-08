"""Private WSL fixture operations for the AI functional Runner evidence."""
import hashlib
import io
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tarfile
import time


DISTRO = "Codex-AI-Batch2-20261108"
ID = "ai-functional-runners-20261108"
HOME = Path("/home/teruisi-pandas")
ROOT = HOME / ".local/share" / f"native-control-{ID}"
UNIT_DIR = HOME / ".config/systemd/user"
UNITS = {domain: f"codex-native-{ID}-{domain}.service" for domain in ("pi", "pandas")}
NAMESPACE = f"pi-native-{ID}"
ENV = {
    "HOME": str(HOME),
    "PATH": "/usr/bin:/bin",
    "XDG_RUNTIME_DIR": "/run/user/1000",
    "DBUS_SESSION_BUS_ADDRESS": "unix:path=/run/user/1000/bus",
    "DOCKER_HOST": "unix:///run/user/1000/docker.sock",
    "DOCKER_CONFIG": str(ROOT / "docker-client"),
}


def run(*argv, timeout=50):
    return subprocess.check_output(argv, env=ENV, timeout=timeout).decode().strip()


def systemctl(*args):
    return run("/usr/bin/systemctl", "--user", *args)


def docker(*args):
    return run("/usr/bin/docker", *args)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def show(unit):
    return dict(line.split("=", 1) for line in systemctl(
        "show", unit, "-p", "MainPID", "-p", "ActiveState", "-p", "SubState",
        "-p", "FragmentPath", "-p", "InvocationID").splitlines())


def listeners():
    return [line.split()[3] for line in run("/usr/bin/ss", "-H", "-ltn").splitlines()
            if line.split()[3].rsplit(":", 1)[-1] in {"28121", "28123"}]


def old_intents():
    return {str(p): sha(p) for p in Path("/opt/teruisi-pandas-w6r-fixture").glob("*/rotation/**/*")
            if p.is_file()}


def snapshot():
    old_units = [f"teruisi-pandas-w6r-{name}.service"
                 for name in ("happy", "intent", "reload", "windows-seam")]
    states = {unit: show(unit) for unit in old_units}
    unit_hashes = {unit: sha(Path(state["FragmentPath"])) for unit, state in states.items()}
    return {"oldUnits": states, "oldUnitSha256": unit_hashes,
            "docker": show("docker.service"), "listeners": listeners(),
            "units": {name: show(unit) for name, unit in UNITS.items()}}


def inventory():
    return {"containers": docker("ps", "-aq", "--no-trunc").splitlines(),
            "volumes": sorted(docker("volume", "ls", "-q").splitlines())}


def workspace_inventory():
    value = inventory()
    value["pi"] = []
    for container in docker("ps", "-aq", "--no-trunc", "--filter",
                            "label=teruisi.pi.namespace=" + NAMESPACE).splitlines():
        item = json.loads(docker("inspect", container))[0]
        value["pi"].append({"id": item["Id"], "image": item["Image"], "running": item["State"]["Running"],
                            "workspace": item["Config"]["Labels"]["teruisi.pi.workspace"],
                            "network": item["HostConfig"]["NetworkMode"],
                            "volumes": [m["Name"] for m in item["Mounts"] if m["Type"] == "volume"]})
    return value


def remove_disposed_volume(workspace, volume):
    assert len(workspace) == 64 and all(c in "0123456789abcdef" for c in workspace)
    assert volume == f"{NAMESPACE}-{workspace[:32]}-workspace"
    with sqlite3.connect(f"file:{ROOT / 'pi-state/ledger.sqlite3'}?mode=ro", uri=True) as db:
        assert db.execute("SELECT status, volume FROM sessions WHERE workspace=?", (workspace,)).fetchone() == (
            "disposed", volume)
        assert db.execute("SELECT COUNT(*) FROM commands WHERE workspace=? AND status='unknown'",
                          (workspace,)).fetchone()[0] == 0
    assert not docker("ps", "-aq", "--filter", "volume=" + volume)
    actual = json.loads(docker("volume", "inspect", volume))[0]
    assert actual["Name"] == volume and actual["Driver"] == "local"
    assert actual["Labels"] == {"teruisi.pi.namespace": NAMESPACE, "teruisi.pi.workspace": workspace}
    assert docker("volume", "rm", volume) == volume
    assert volume not in inventory()["volumes"]
    return {"removedVolume": volume, "workspace": workspace, "ledgerState": "disposed"}


def pandas_requests():
    with sqlite3.connect(f"file:{ROOT / 'pandas-state/requests.sqlite3'}?mode=ro", uri=True) as db:
        return {"count": db.execute("SELECT COUNT(*) FROM requests").fetchone()[0]}


def pandas_journal():
    raw = run("/usr/bin/journalctl", "--no-pager", "-n", "150", "-o", "cat",
              "_SYSTEMD_USER_UNIT=" + UNITS["pandas"])
    return [json.loads(line.split("pandas_stage ", 1)[1]) for line in raw.splitlines() if "pandas_stage " in line]


def unit_bytes(name, profile_digest):
    root = ROOT.as_posix()
    return "\n".join([
        "[Unit]", "Description=Private AI functional Runner test", "Requires=docker.service", "After=docker.service",
        "[Service]", "Type=simple", f"WorkingDirectory={root}/backend",
        f"ExecStart=/usr/bin/python3 -E -B -m {name}_runner.server --config {root}/{name}.json",
        f"Environment=TERUISI_NATIVE_ISOLATION_FILE={root}/isolation.json",
        f"Environment=TERUISI_NATIVE_ISOLATION_SHA256={profile_digest}",
        "UMask=0077", "NoNewPrivileges=yes", "Restart=no", "TimeoutStopSec=45", "",
    ]).encode()


def start_docker():
    systemctl("start", "docker.service")
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        try:
            if run("/usr/bin/docker", "info", "--format", "{{.ID}}", timeout=5):
                return
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
            time.sleep(0.25)
    raise RuntimeError("private rootless Docker did not become ready")


def start_units():
    systemctl("start", *UNITS.values())
    deadline = time.monotonic() + 25
    while time.monotonic() < deadline and set(listeners()) != {"127.0.0.1:28121", "127.0.0.1:28123"}:
        time.sleep(0.25)
    assert set(listeners()) == {"127.0.0.1:28121", "127.0.0.1:28123"}
    after = snapshot()
    assert all(state["ActiveState"] == "active" and int(state["MainPID"]) > 0 for state in after["units"].values())
    return after


def start_existing():
    before = snapshot()
    assert before["docker"]["ActiveState"] == "inactive" and not before["listeners"]
    assert all(item["ActiveState"] == "inactive" and item["MainPID"] == "0" for item in before["units"].values())
    profile_digest = sha(ROOT / "isolation.json")
    for name, unit in UNITS.items():
        assert (UNIT_DIR / unit).read_bytes() == unit_bytes(name, profile_digest)
    inputs = json.loads((ROOT / "inputs.json").read_bytes())
    assert all(sha(ROOT / path) == digest for path, digest in inputs["files"].items())
    for db_file, tables in {"pi-state/ledger.sqlite3": ("commands", "sessions", "nonce"),
                            "pandas-state/requests.sqlite3": ("requests",)}.items():
        with sqlite3.connect(f"file:{ROOT / db_file}?mode=ro", uri=True) as db:
            for table in tables:
                assert db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] == 0
    start_docker()
    docker_inventory = inventory()
    assert docker_inventory == json.loads((ROOT / "initial-inventory.json").read_bytes())
    return {"before": before, "after": start_units(), "docker": docker_inventory, "priorDispatches": 0,
            "unitSha256": {name: sha(UNIT_DIR / unit) for name, unit in UNITS.items()}}


def start():
    before = snapshot()
    assert before["docker"]["ActiveState"] == "inactive" and not before["listeners"]
    assert not ROOT.exists() and all(not (UNIT_DIR / unit).exists() for unit in UNITS.values())
    with tarfile.open(fileobj=io.BytesIO(sys.stdin.buffer.read()), mode="r:") as archive:
        ROOT.mkdir(mode=0o700)
        archive.extractall(ROOT, filter="data")
    inputs = json.loads((ROOT / "inputs.json").read_bytes())
    profile = ROOT / "isolation.json"
    bound = {"TERUISI_NATIVE_ISOLATION_FILE": str(profile),
             "TERUISI_NATIVE_ISOLATION_SHA256": sha(profile)}
    os.environ.update(bound)
    sys.path.insert(0, str(ROOT / "backend"))
    from pandas_runner.native_isolation import PROFILE
    from pandas_runner.protocol import package_digest
    from pi_runner.install_linux import source_digest
    assert PROFILE["namespace"] == NAMESPACE and PROFILE["piUnit"] == UNITS["pi"]
    assert PROFILE["pandasUnit"] == UNITS["pandas"]
    assert inputs["runnerDigests"] == {"pi": source_digest(), "pandas": package_digest()}
    for name, digest in inputs["files"].items():
        assert sha(ROOT / name) == digest
    (ROOT / "docker-client").mkdir()
    start_docker()
    docker_before = inventory()
    assert not docker_before["containers"]
    images = {}
    for name, image in inputs["images"].items():
        info = json.loads(docker("image", "inspect", image))[0]
        assert info["Id"] == image and info["Os"] == "linux"
        images[name] = {"id": info["Id"], "labels": info["Config"].get("Labels"),
                        "entrypoint": info["Config"]["Entrypoint"]}
    (ROOT / "initial-inventory.json").write_text(json.dumps(docker_before))
    for name, unit in UNITS.items():
        config = {"docker": "/usr/bin/docker", "socket": "/run/user/1000/docker.sock",
                  "image": inputs["images"][name], "keyFile": str(ROOT / (name + ".key")),
                  "stateDirectory": str(ROOT / (name + "-state"))}
        Path(config["stateDirectory"]).mkdir(mode=0o700)
        if name == "pi":
            config.update(gatewayUrl="http://127.0.0.1:28112/api/ai/pi/gateway",
                          namespace=NAMESPACE, limits={"workspaceBytes": 268435456,
                                                       "workspaceFiles": 5000, "idleSeconds": 1800, "maxSessions": 1})
        config_path = ROOT / (name + ".json")
        config_path.write_text(json.dumps(config))
        with (UNIT_DIR / unit).open("xb") as file:
            file.write(unit_bytes(name, bound["TERUISI_NATIVE_ISOLATION_SHA256"]))
    systemctl("daemon-reload")
    assert all(systemctl("is-enabled", unit) == "static" for unit in UNITS.values())
    after = start_units()
    return {"after": after, "before": before, "dockerBefore": docker_before, "images": images,
            "runnerDigests": inputs["runnerDigests"], "namespace": NAMESPACE,
            "unitSha256": {name: sha(UNIT_DIR / unit) for name, unit in UNITS.items()}}


def stop(expected_unit_hashes):
    observed = snapshot()
    unit_files = {name: UNIT_DIR / unit for name, unit in UNITS.items()}
    present = {name: sha(path) for name, path in unit_files.items() if path.exists()}
    assert all(expected_unit_hashes.get(name) == digest for name, digest in present.items())
    if present:
        systemctl("stop", *(UNITS[name] for name in present))
    stopped = snapshot()
    assert not stopped["listeners"] and all(state["MainPID"] == "0" for state in stopped["units"].values())
    docker_inventory = None
    if stopped["docker"]["ActiveState"] == "active":
        docker_inventory = inventory()
        systemctl("stop", "docker.service")
    baseline = json.loads((ROOT / "initial-inventory.json").read_bytes())
    drained = docker_inventory == baseline and not baseline["containers"]
    removed = []
    if drained:
        for path in [ROOT / name for name in ("pi.key", "pandas.key", "isolation.json")] + list(unit_files.values()):
            if path.is_file():
                assert not path.is_symlink() and path.stat().st_nlink == 1
                path.unlink()
                removed.append(str(path))
        systemctl("daemon-reload")
    final = snapshot()
    assert final["docker"]["MainPID"] == "0" and final["docker"]["ActiveState"] == "inactive"
    return {"stopped": stopped, "final": final, "removed": removed, "inventory": docker_inventory, "drained": drained,
            "preservedUnknowns": (docker_inventory or {}).get("containers", [])}


if __name__ == "__main__":
    action, *args = sys.argv[1:]
    assert os.environ.get("WSL_DISTRO_NAME") == DISTRO
    assert os.getuid() == (0 if action in {"old-intents", "pandas-journal"} else 1000)
    os.umask(0o077)
    if action == "old-intents":
        result = old_intents()
    elif action == "snapshot":
        result = snapshot()
    elif action == "start":
        result = start()
    elif action == "start-existing":
        result = start_existing()
    elif action == "workspace-inventory":
        result = workspace_inventory()
    elif action == "remove-disposed-volume":
        result = remove_disposed_volume(*args)
    elif action == "pandas-requests":
        result = pandas_requests()
    elif action == "pandas-journal":
        result = pandas_journal()
    elif action == "stop":
        result = stop(json.loads(args[0]))
    else:
        raise ValueError("unknown_private_fixture_action")
    print(json.dumps(result, sort_keys=True))
