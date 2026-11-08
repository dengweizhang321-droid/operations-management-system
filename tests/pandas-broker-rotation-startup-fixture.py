"""Test-only bridge to the fixed private W6R Linux rehearsal material."""
import base64
import os
from pathlib import Path
import subprocess
import sys


if os.name == "nt":
    cli = str(Path(os.environ["SystemRoot"]) / "System32/wsl.exe")
    prefix = [cli, "-d", "Codex-AI-Batch2-20261108", "-u", "root", "--cd", "/root", "--exec"]
    target = "/root/w6r-fixture/windows-seam.py"
    if sys.argv[1] == "setup":
        command = ("from pathlib import Path; import sys; "
                   "p=Path('/root/w6r-fixture/windows-seam.py'); p.open('xb').write(sys.stdin.buffer.read())")
        subprocess.run(prefix + ["/usr/bin/python3", "-I", "-B", "-c", command],
                       input=Path(__file__).read_bytes(), timeout=15, capture_output=True, check=True)
    result = subprocess.run(prefix + ["/usr/bin/python3", "-B", target, *sys.argv[1:]],
                            timeout=50, capture_output=True)
    sys.stdout.buffer.write(result.stdout)
    if result.returncode:
        sys.stderr.buffer.write(result.stderr.split(b"Traceback")[-1])
    raise SystemExit(result.returncode)


from native import Fixture, HOME, ROOT, MATERIALS, create_file, decode, encode, package_files, sha, source_digest, strict_probe, wait_status

fixture = Fixture("happy")
fixture.install = ROOT / "windows-seam"
fixture.releases = fixture.install / "releases"
fixture.control = fixture.install / "rotation"
fixture.config = HOME / ".config/teruisi-pandas-w6r-windows-seam"
fixture.unit_name = "teruisi-pandas-w6r-windows-seam.service"
fixture.unit = Path("/etc/systemd/user") / fixture.unit_name
private_state = MATERIALS / "windows-seam-state.json"
action = sys.argv[1]
if action == "setup":
    image = decode((MATERIALS / "frames.json").read_bytes())["image"]
    old_files, new_files = package_files(MATERIALS / "old"), package_files(MATERIALS / "new")
    old, key = fixture.install_original(old_files, image)
    try:
        wait_status(fixture, key, old)
    finally:
        fixture.ctl("stop", fixture.unit_name)
    binding = {"sourceCommit": "1" * 40, "preparedAppId": "2" * 32, "preparedAppSha256": "3" * 64,
               "preparedManifestSha256": sys.argv[2], "windowsConfigSha256": "4" * 64,
               "windowsKeySha256": "5" * 64, "channelKeySha256": sha(key), "image": image,
               "sourceSha256": source_digest(new_files), "operatorSha256": fixture.operator_sha}
    prepared = fixture.dispatch({"action": "prepare", "binding": binding, "predecessorSourceSha256": old,
                                 "files": {name: base64.b64encode(raw).decode() for name, raw in new_files.items()}})
    request = {"action": "switch", "binding": binding, "planSha256": prepared["registeredPlanSha256"],
               "owner": {"maintenanceId": "6" * 32, "publicationOwnerPid": 5432}}
    create_file(private_state, encode(request))
    result = fixture.dispatch(request)
else:
    request = decode(private_state.read_bytes())
    binding = request["binding"]
    if action in {"start", "stop"}:
        fixture.ctl(action, fixture.unit_name)
        if action == "start":
            wait_status(fixture, (fixture.config / "key").read_bytes(), binding["sourceSha256"])
        result = {"status": action}
    elif action in {"status-probe", "self-test"}:
        result = strict_probe(fixture.releases / binding["sourceSha256"] / "backend",
                              fixture.config / "key", binding["image"], action == "self-test")
    elif action in {"startup-check", "identity", "complete"}:
        request["action"] = action
        if action == "complete":
            raw = base64.b64decode(sys.argv[2], validate=True)
            request.update(startupReceipt=sys.argv[2], startupReceiptSha256=sha(raw))
        result = fixture.dispatch(request)
    else:
        raise ValueError("unknown test action")
print(encode(result).decode())
