"""Fixed Windows-to-WSL transport for the protected Pandas release controller."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys


HERE = Path(__file__).resolve().parent
PROTECTED_RUNTIME = Path(r"D:\teruisi-runtime\django-sales")
MAX_OPERATOR = 64 * 1024
MAX_SOURCE = 256 * 1024
MAX_FILE = 96 * 1024
MAX_RESULT = 16 * 1024
SOURCE_NAME = re.compile(r"[a-z_][a-z0-9_]{0,63}\.py")
HEX64 = re.compile(r"[a-f0-9]{64}")
BOOTSTRAP = """import hashlib, sys
size = int.from_bytes(sys.stdin.buffer.read(4), 'big')
if not 0 < size <= 65536:
    raise SystemExit(1)
raw = sys.stdin.buffer.read(size)
digest = hashlib.sha256(raw).hexdigest()
if len(raw) != size or len(sys.argv) != 2 or sys.argv[1] != digest:
    raise SystemExit(1)
module = {'__name__': 'pandas_rotation_operator'}
exec(compile(raw, '<protected-pandas-rotation>', 'exec'), module)
module['main'](digest)
"""


def ordinary(path, maximum):
    info = path.lstat()
    if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
            or getattr(info, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
            or info.st_size > maximum):
        raise ValueError("unexpected_windows_rotation_file")
    with path.open("rb") as stream:
        raw = stream.read(maximum + 1)
    if len(raw) > maximum:
        raise ValueError("windows_rotation_file_limit")
    return raw


def source(root):
    package = root / "backend/pandas_runner"
    if package.is_symlink() or not package.is_dir():
        raise ValueError("invalid_windows_source_path")
    paths = sorted(path for path in package.glob("*.py") if not path.name.startswith("test_"))
    if not 1 <= len(paths) <= 32 or not all(SOURCE_NAME.fullmatch(path.name) for path in paths):
        raise ValueError("invalid_windows_source_inventory")
    files = {path.name: ordinary(path, MAX_FILE) for path in paths}
    if not 0 < sum(map(len, files.values())) <= MAX_SOURCE:
        raise ValueError("windows_source_limit")
    digest = hashlib.sha256()
    for name, raw in files.items():
        digest.update(name.encode() + b"\0" + raw)
    return digest.hexdigest(), files


def encode(value):
    return json.dumps(value, ensure_ascii=True, separators=(",", ":"), sort_keys=True, allow_nan=False).encode()


def channel_key_fingerprint(candidate, config_sha, encrypted_sha):
    config_path = PROTECTED_RUNTIME / "config/pandas-sandbox.json"
    key_path = PROTECTED_RUNTIME / "secrets/pandas-sandbox.dpapi.json"
    if hashlib.sha256(ordinary(config_path, 4096)).hexdigest() != config_sha:
        raise ValueError("windows_pandas_config_changed")
    if hashlib.sha256(ordinary(key_path, 4096)).hexdigest() != encrypted_sha:
        raise ValueError("windows_pandas_encrypted_key_changed")
    sys.path.insert(0, str(candidate / "backend"))
    try:
        from pandas_runner.key_file import read_key
        fingerprint = hashlib.sha256(read_key(key_path)).hexdigest()
    finally:
        sys.path.pop(0)
    if hashlib.sha256(ordinary(key_path, 4096)).hexdigest() != encrypted_sha:
        raise ValueError("windows_pandas_encrypted_key_changed")
    return fingerprint


def run(args):
    candidate = HERE.parent
    if os.name != "nt" or re.fullmatch(r"[a-f0-9]{32}", args.prepared_app_id) is None:
        raise ValueError("protected_windows_runtime_required")
    expected_name = "app.deploy-" + args.prepared_app_id if args.action in {"prepare", "check"} else "app"
    if candidate != PROTECTED_RUNTIME / expected_name:
        raise ValueError("protected_windows_runtime_required")
    operator = ordinary(HERE / "pandas_broker_rotation_linux.py", MAX_OPERATOR)
    operator_sha = hashlib.sha256(operator).hexdigest()
    source_sha, files = source(candidate)
    manifest_sha = hashlib.sha256(ordinary(candidate / "deployment.json", MAX_FILE)).hexdigest()
    receipt = ordinary(PROTECTED_RUNTIME / ("app.prepare-" + args.prepared_app_id + ".json"), 4096)
    if (hashlib.sha256(receipt).hexdigest() != args.prepared_app_sha256
            or json.loads(receipt)["candidateManifestSha256"] != manifest_sha):
        raise ValueError("windows_prepared_receipt_changed")
    binding = {
        "sourceCommit": args.source_commit, "preparedAppId": args.prepared_app_id,
        "preparedAppSha256": args.prepared_app_sha256, "preparedManifestSha256": manifest_sha,
        "windowsConfigSha256": args.windows_config_sha256, "windowsKeySha256": args.windows_key_sha256,
        "channelKeySha256": channel_key_fingerprint(candidate, args.windows_config_sha256, args.windows_key_sha256),
        "image": args.image, "sourceSha256": source_sha, "operatorSha256": operator_sha,
    }
    request = {"action": args.action, "binding": binding}
    if args.action == "prepare":
        old_sha, _ = source(PROTECTED_RUNTIME / "app")
        request.update(predecessorSourceSha256=old_sha,
                       files={name: base64.b64encode(raw).decode() for name, raw in files.items()})
    else:
        request["planSha256"] = args.plan_sha256
    if args.action not in {"prepare", "check"}:
        request["owner"] = {"maintenanceId": args.maintenance_id, "publicationOwnerPid": args.publication_owner_pid}
    if args.action == "complete":
        if not HEX64.fullmatch(args.plan_sha256):
            raise ValueError("invalid_registered_plan")
        startup_path = PROTECTED_RUNTIME / "run" / f"pandas-rotation-{args.plan_sha256}.startup.json"
        startup = ordinary(startup_path, 8192)
        request.update(startupReceipt=base64.b64encode(startup).decode(), startupReceiptSha256=hashlib.sha256(startup).hexdigest())

    wsl = str(Path(os.environ["SystemRoot"]) / "System32/wsl.exe")
    env = {key: value for key, value in os.environ.items() if key.upper() in {"SYSTEMROOT", "WINDIR", "TEMP", "TMP", "USERPROFILE", "PATH"}}
    raw = len(operator).to_bytes(4, "big") + operator + encode(request)
    process = subprocess.run(
        [wsl, "-d", "TERUISI-Pandas", "-u", "root", "--cd", "/root", "--exec", "/usr/bin/env", "-i",
         "PATH=/usr/bin:/bin", "HOME=/root", "/usr/bin/python3", "-I", "-B", "-c", BOOTSTRAP, operator_sha],
        input=raw, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env, cwd=candidate, timeout=55, check=False,
    )
    if len(process.stdout) > MAX_RESULT:
        raise ValueError("wsl_rotation_output_limit")
    value = json.loads(process.stdout)
    if type(value) is not dict:
        raise ValueError("invalid_wsl_rotation_result")
    if process.returncode != 0:
        reason = value.get("error")
        raise ValueError(reason if type(reason) is str and re.fullmatch(r"[a-z_]{1,80}", reason) else "wsl_rotation_failed")
    if "error" in value or value.get("sourceSha256") != source_sha or value.get("configured") is not True:
        raise ValueError("wsl_rotation_result_binding_mismatch")
    return value


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["prepare", "check", "switch", "startup-check", "identity", "complete"])
    for field in ("source-commit", "prepared-app-id", "prepared-app-sha256", "windows-config-sha256", "windows-key-sha256", "image"):
        parser.add_argument("--" + field, required=True)
    parser.add_argument("--plan-sha256", default="")
    parser.add_argument("--maintenance-id", default="")
    parser.add_argument("--publication-owner-pid", type=int, default=0)
    args = parser.parse_args()
    try:
        print(encode(run(args)).decode())
    except (ValueError, OSError, KeyError, subprocess.SubprocessError) as error:
        reason = str(error)
        if not re.fullmatch(r"[a-z_]{1,80}", reason):
            reason = "windows_rotation_dependency_or_state_unverified"
        print(encode({"error": reason}).decode())
        raise SystemExit(1)


if __name__ == "__main__":
    main()
