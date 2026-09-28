"""One durable, non-replaying administrative job. No production restore verb."""
from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import uuid
from pathlib import Path

from .storage import BackupError, BackupStore, archive_metadata, checked, identifier, read_json

RUNTIME = Path(r"D:\teruisi-runtime\django-sales")
ARCHIVE = Path(r"E:\运营管理系统业务数据")


def operator_environment(source=None):
    source = os.environ if source is None else source
    removed = {"PSMODULEPATH", "PSMODULEANALYSISCACHEPATH", "TERUISI_DJANGO_SERVICE_LIBRARY_ONLY",
               "TERUISI_DJANGO_MAINTENANCE_LIBRARY_ONLY"}
    environment = {key: value for key, value in source.items() if key.upper() not in removed}
    system_root = next(value for key, value in source.items() if key.upper() == "SYSTEMROOT")
    # Windows PowerShell 5 cannot import PowerShell 7's Security module. The
    # installed operator only needs the inbox Windows modules, never user modules.
    environment["PSModulePath"] = str(Path(system_root) / "System32/WindowsPowerShell/v1.0/Modules")
    return environment


def production_store():
    expected = RUNTIME / "app" / "backend" / "system_backups" / "runner.py"
    if os.name != "nt" or Path(__file__).absolute() != expected:
        raise BackupError("备份管理只能由已部署的运维入口执行", "not_deployed", 503)
    checked(expected)
    return BackupStore(RUNTIME, ARCHIVE)


def launch(job_id):
    store = production_store()
    identifier(job_id)
    # The existing Django process supplies its own environment, never browser arguments.
    subprocess.Popen([sys.executable, "-m", "system_backups.runner", job_id],
                     cwd=store.runtime / "app" / "backend", stdin=subprocess.DEVNULL,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     creationflags=subprocess.CREATE_NO_WINDOW, close_fds=True)


def invoke_operator(store, job_id, action, directory=None, sha=None, *, rehearsal=False):
    script = checked(store.runtime / "app" / "tools" / "django-postgres-maintenance.ps1")
    executable = Path(os.environ["SystemRoot"]) / "System32/WindowsPowerShell/v1.0/powershell.exe"
    args = [str(executable), "-NoProfile", "-NonInteractive", "-File", str(script), "-Action", action]
    if directory is not None:
        args += ["-BackupDirectory", str(directory), "-ApprovedManifestSha256", sha]
    if action in {"Backup", "Retain", "Protect", "Unprotect"}:
        args += ["-Execute"]
    if action == "Retain":
        args += ["-ConfirmedPrune"]
    if rehearsal:
        port = None
        for candidate in range(55432, 56000):
            try:
                with socket.socket() as probe:
                    probe.bind(("127.0.0.1", candidate))
                port = candidate
                break
            except OSError:
                continue
        if port is None:
            raise BackupError("没有可用的隔离恢复端口", "busy", 409)
        args += ["-Execute", "-ConfirmedIsolatedRestore", "-RehearsalId", uuid.uuid4().hex[:12],
                 "-RehearsalPort", str(port), "-RehearsalDrive", "E"]
    log = checked(store.root / f"operator-{job_id}-{uuid.uuid4().hex}.log", missing=True)
    with log.open("xb") as output:
        process = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=output, stderr=output,
                                   creationflags=subprocess.CREATE_NO_WINDOW, close_fds=True,
                                   env=operator_environment())
        try:
            result = process.wait(timeout=7200)
        except subprocess.TimeoutExpired:
            # Do not kill a controller with an owned PG child or replay an uncertain effect.
            raise BackupError("运维操作结果未确认，请核查后处理", "unknown", 409) from None
    if result != 0 or log.stat().st_size > 1024**2:
        raise BackupError("原备份工具未通过校验，详见受保护运维日志", "operator_failed", 409)
    raw = log.read_bytes()
    for encoding in ("utf-8-sig", "gb18030"):
        try:
            lines = raw.decode(encoding).splitlines()
            value = json.loads(next(line for line in reversed(lines) if line.startswith("{")))
            if not isinstance(value, dict):
                break
            return value
        except (ValueError, StopIteration, UnicodeError):
            continue
    raise BackupError("运维回执无法核实", "unknown", 409)


def authorize_actor(actor):
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "teruisi_backend.settings")
    import django
    django.setup()
    from access_control.service import resolve_user
    if actor == "local-admin@teruisi.local":
        return  # Reserved identity already authenticated by the local edge, never a login user.
    user = resolve_user(actor)
    if user.role_id != "admin" or user.scope is not None:
        raise BackupError("管理员权限已变化", "access_denied", 403)


def execute(store, job, operator=invoke_operator):
    job_id, action = job["id"], job["action"]
    if action == "backup":
        result = operator(store, job_id, "Backup")
        return {**{key: result[key] for key in ("backupId", "manifestSha256", "completedAt")}, "releaseRetention": result.get("releaseRetention")}
    if action == "retention":
        result = operator(store, job_id, "Retain")
        return {key: result[key] for key in ("retained", "removed")}
    if action in {"export", "protect", "unprotect"}:
        directory = store.archive / job["target"]
        operator(store, job_id, "Verify", directory, job["manifestSha256"])
        if action == "export":
            return store.export_zip(job_id, job["target"], job["manifestSha256"])
        operator(store, job_id, "Protect" if action == "protect" else "Unprotect", directory, job["manifestSha256"])
        return {"backupId": job["target"], "protected": action == "protect"}
    if action == "verify-import":
        item = store.upload(job["target"], job["actor"])
        if item["status"] == "sealed":
            meta = item["metadata"]
            directory = store.imports / meta["backupId"]
            if archive_metadata(directory, full=True) != meta:
                raise BackupError("导入备份已变化")
        else:
            directory, meta = store.unpack(job["target"], job["actor"])
        operator(store, job_id, "Verify", directory, meta["manifestSha256"])
        return {**meta, "uploadId": job["target"], "verified": True, "isolatedRestoreVerified": False}
    item = store.upload(job["target"], job["actor"])
    if action != "rehearse" or item["status"] != "sealed":
        raise BackupError("导入文件尚未完成校验")
    meta = item["metadata"]
    directory = store.imports / meta["backupId"]
    if archive_metadata(directory, full=True) != meta:
        raise BackupError("导入备份已变化")
    result = operator(store, job_id, "RestoreRehearsal", directory, meta["manifestSha256"], rehearsal=True)
    if result.get("status") != "completed" or result.get("serviceStateChanged") is not False:
        raise BackupError("隔离恢复回执无效")
    return {**meta, "uploadId": job["target"], "isolatedRestoreVerified": True,
            "productionRestored": False, "productionRestoreRequiresApproval": True}


def run(job_id):
    store = production_store()
    with store.lock("runner"):
        job = read_json(store.root / f"job-{identifier(job_id)}.json")
        if job["status"] != "queued":
            return
        try:
            authorize_actor(job["actor"])
            store.update_job(job_id, status="running")
            store.cleanup_expired_exports()
            result = execute(store, job)
            with store.lock():
                store.audit(job["actor"], "completed-" + job["action"], job_id)
            store.update_job(job_id, status="completed", result=result)
        except Exception as error:
            uncertain = isinstance(error, BackupError) and error.code == "unknown"
            message = str(error) if isinstance(error, BackupError) else "备份处理失败；请查看受保护运维记录"
            store.update_job(job_id, status="unknown" if uncertain else "failed", error=message)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(2)
    run(identifier(sys.argv[1]))
