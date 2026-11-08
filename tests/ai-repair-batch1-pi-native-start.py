"""Observe the original Pi Runner entry twice with one private empty ledger."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile

APP = "eee39f9d315eaf9dd71f8390181879cdb6ba2c82"
TREE = "18ce84ef8fe69ebd9128dc2b540ee5c67dc977ed"
RUNNER = "fb02a402f02764b6eab3cb2c890f7d36a44e5f4bdc8b1e9ba6680cb57c74df08"
IMAGE = "sha256:7975d9cae783f1b33fb21063d6be40a2fdbb1a7d718550fd13a54ed64961097d"
LINUX = r'''
import hashlib, io, json, os, pathlib, secrets, shutil, signal, socket, sqlite3, subprocess, sys, tarfile, time
app, tree, source, image = sys.argv[1:]
assert os.getuid() == 1000
os.umask(0o077)
ns = "pi-test-g02-" + secrets.token_hex(8)
root = pathlib.Path.home() / ns
root.mkdir()
state = root / "state"
state.mkdir()
config = root / "config.json"
key_file = root / "key"
key = secrets.token_bytes(32)
key_file.write_bytes(key)
sock = pathlib.Path(f"/run/user/{os.getuid()}/docker.sock")
assert sock.is_socket() and sock.stat().st_uid == os.getuid()
env = {"PATH":"/usr/bin:/bin", "PYTHONPATH":str(root / "backend"), "PYTHONDONTWRITEBYTECODE":"1",
       "DOCKER_HOST":"unix://" + str(sock)}
config.write_text(json.dumps({"docker":"/usr/bin/docker","socket":str(sock),"image":image,"keyFile":str(key_file),
    "stateDirectory":str(state),"gatewayUrl":"http://127.0.0.1:49159/api/ai/pi/gateway","namespace":ns,
    "limits":{"workspaceBytes":268435456,"workspaceFiles":5000,"idleSeconds":1800,"maxSessions":1}}))
assert (config.stat().st_mode & 0o777) == (key_file.stat().st_mode & 0o777) == 0o600
process = None
port = None
records = []
active_identity = None

def docker(*args):
    return subprocess.check_output(["/usr/bin/docker", *args], env=env, timeout=15)

def empty_namespace():
    tag = "label=teruisi.pi.namespace=" + ns
    return not docker("ps","-aq","--filter",tag).strip() and not docker("volume","ls","-q","--filter",tag).strip()

def identity(proc):
    p = pathlib.Path("/proc") / str(proc.pid)
    assert p.stat().st_uid == os.getuid()
    args = (p / "cmdline").read_bytes().rstrip(b"\0").split(b"\0")
    assert args == [os.fsencode(part) for part in argv]
    return {"pid":proc.pid,"procStartTicks":int((p/"stat").read_text().rsplit(")",1)[1].split()[19])}

def stop(proc, expected):
    assert expected == identity(proc)
    proc.send_signal(signal.SIGTERM)
    code = proc.wait(timeout=25)
    assert code == 0
    return {"signal":"SIGTERM","target":expected,"exitCode":code}

def unused_port(port=0):
    with socket.socket() as probe:
        probe.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
        probe.bind(("127.0.0.1",port))
        return probe.getsockname()[1]

def ledger_receipt():
    db = state / "ledger.sqlite3"
    info = db.stat()
    wal = state / "ledger.sqlite3-wal"
    assert not wal.exists() or wal.stat().st_size == 0
    connection = sqlite3.connect(db.as_uri()+"?mode=ro&immutable=1",uri=True)
    try:
        nonces = connection.execute("SELECT COUNT(*) FROM nonce").fetchone()[0]
    finally:
        connection.close()
    members = {name:hashlib.sha256((state/name).read_bytes()).hexdigest() for name in
               ("ledger.sqlite3","ledger.sqlite3-wal","ledger.sqlite3-shm") if (state/name).is_file()}
    return {"path":str(db),"device":info.st_dev,"inode":info.st_ino,"signedHealthNonceCount":nonces,"members":members}

try:
    with tarfile.open(fileobj=io.BytesIO(sys.stdin.buffer.read()),mode="r:") as archive:
        for item in archive:
            relative = pathlib.PurePosixPath(item.name)
            if item.isdir() and relative.parts == ("backend",):continue
            assert relative.parts[:2] == ("backend","pi_runner") and ".." not in relative.parts
            if item.isdir():continue
            assert item.isfile()
            dest = root.joinpath(*relative.parts)
            dest.parent.mkdir(parents=True,exist_ok=True)
            dest.write_bytes(archive.extractfile(item).read())
    sys.path.insert(0,str(root/"backend"))
    from pi_runner.client import command
    from pi_runner.install_linux import source_digest
    from pi_runner.protocol import HEALTH_PATH
    assert source_digest() == source and empty_namespace()
    actual = json.loads(docker("image","inspect",image))[0]
    labels = {name:actual["Config"]["Labels"].get(name) for name in
              ("teruisi.pi.workspace","teruisi.pi.native-capabilities","teruisi.pi.local-restore")}
    assert actual["Id"]==image and actual["Os"]=="linux" and list(labels.values())==["2","1","1"]
    port = unused_port()
    argv = [sys.executable,"-B","-m","pi_runner.server","--config",str(config),"--port",str(port)]
    for index in (1,2):
        assert unused_port(port)==port
        with (root/f"start-{index}.log").open("xb") as stream:
            process = subprocess.Popen(argv, env=env, cwd=root, stdin=subprocess.DEVNULL, stdout=stream, stderr=stream)
            active_identity = identity(process)
            deadline = time.monotonic() + 15
            while True:
                assert process.poll() is None
                try: health = command(f"http://127.0.0.1:{port}",key,{},timeout=2,path=HEALTH_PATH)
                except OSError:
                    if time.monotonic()>=deadline:raise
                    time.sleep(.08)
                    continue
                break
            assert health == {"version":1,"image":image,"sourceSha256":source,"namespace":ns,"activeCount":0,
                "unresolvedCount":0,"unsafeUnknownCount":0,"unknownStoppedVerifiedCount":0,"closing":False}
            termination = stop(process,active_identity)
            process = None
            active_identity = None
        native_log = (root/f"start-{index}.log").read_bytes()
        records.append({"start":index,"listenPortWasFree":True,"argv":argv,"signedHealth":health,
            "termination":termination,"ledgerAfterExit":ledger_receipt(),
            "directLogSha256":hashlib.sha256(native_log).hexdigest(),"directLog":native_log[:4096].decode("utf8","replace")})
    first, second = (r["ledgerAfterExit"] for r in records)
    assert (first["path"],first["device"],first["inode"])==(second["path"],second["device"],second["inode"])
    assert first["signedHealthNonceCount"]==1 and second["signedHealthNonceCount"]==2
finally:
    if len(records)!=2:
        print(json.dumps({"privateNamespace":ns,"port":port,"completedObservations":len(records)}),file=sys.stderr)
    if process is not None and process.poll() is None:
        stop(process,active_identity or identity(process))
    assert all(not pathlib.Path("/proc",str(r["termination"]["target"]["pid"])).exists() for r in records)
    assert empty_namespace()
    if port is not None:assert unused_port(port)==port
    assert root.parent == pathlib.Path.home() and root.name == ns and not root.is_symlink() and root.stat().st_uid==os.getuid()
    shutil.rmtree(root)
assert not root.exists()
print(json.dumps({"version":"teruisi-ai-repair-batch1-pi-native-v1","status":"passed","commit":app,"tree":tree,
    "runnerSourceSha256":source,"image":image,"labels":labels,"namespace":ns,"port":port,"config":str(config),
    "python":sys.executable,"records":records,"cleanup":{"namespaceEmpty":True,"portFree":True,"processesExited":True,
    "privateDirectoryRemoved":True},"emptyLedgerOnly":True,"productionTouched":False},sort_keys=True))
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    out = args.out.resolve()
    assert out != root and root not in out.parents and not out.exists()
    out.mkdir(parents=False)
    assert subprocess.check_output(["git","rev-parse",APP+"^{tree}"],cwd=root,text=True).strip() == TREE
    archive = subprocess.check_output(["git","archive",APP,"backend/pi_runner"],cwd=root)
    run = subprocess.run(["wsl","-d","TERUISI-Pandas","--exec","/usr/bin/python3","-B","-c",LINUX,APP,TREE,RUNNER,IMAGE],
        input=archive, capture_output=True, timeout=130)
    (out/"stdout.log").write_bytes(run.stdout)
    (out/"stderr.log").write_bytes(run.stderr)
    if run.returncode:
        raise SystemExit(run.returncode)
    receipt = json.loads(run.stdout)
    receipt["fixtureSha256"] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    receipt["gitArchiveSha256"] = hashlib.sha256(archive).hexdigest()
    receipt["process"] = {"exitCode":run.returncode,"stdoutSha256":hashlib.sha256(run.stdout).hexdigest(),
        "stderrSha256":hashlib.sha256(run.stderr).hexdigest()}
    (out/"NATIVE.json").write_text(json.dumps(receipt,indent=2)+"\n",encoding="utf8")
    print(json.dumps({"status":receipt["status"],"receipt":str(out/"NATIVE.json")}))


if __name__ == "__main__":
    main()
