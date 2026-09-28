from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import shutil
import stat
import time
import uuid
import zipfile
from contextlib import contextmanager
from pathlib import Path

ID = re.compile(r"^[a-f0-9]{32}$")
BACKUP_ID = re.compile(r"^daily-\d{8}T\d{6}Z-[a-f0-9]{12}$")
SHA = re.compile(r"^[a-f0-9]{64}$")
FILES = ("backup-manifest.json", "backup-manifest.json.sha256", "teruisi-sales.dump")
UPLOAD_CHUNK = 128 * 1024
DOWNLOAD_CHUNK = 1024 * 1024
MAX_ARCHIVE = 8 * 1024**3
MAX_JSON = 4 * 1024**2


class BackupError(Exception):
    def __init__(self, message, code="invalid_request", status=400):
        super().__init__(message)
        self.code, self.status = code, status


def checked(path: Path, *, missing=False):
    path = path.absolute()
    for part in (path, *path.parents):
        try:
            info = part.lstat()
        except FileNotFoundError:
            if missing:
                continue
            raise BackupError("备份路径不存在", "not_found", 404)
        if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
            raise BackupError("备份路径不允许链接", "unsafe_path", 409)
        if not stat.S_ISDIR(info.st_mode) and (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1):
            raise BackupError("备份文件身份无效", "unsafe_path", 409)
    return path


def read_json(path: Path):
    checked(path)
    if path.stat().st_size > MAX_JSON:
        raise BackupError("元数据超过限制")
    try:
        value = json.loads(path.read_text(encoding="utf-8-sig"))
    except (ValueError, UnicodeError):
        raise BackupError("备份元数据损坏", "invalid_metadata", 409) from None
    if not isinstance(value, dict):
        raise BackupError("备份元数据格式无效")
    return value


def atomic_json(path: Path, value):
    checked(path, missing=True)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        with temporary.open("x", encoding="utf-8") as stream:
            json.dump(value, stream, ensure_ascii=False, separators=(",", ":"))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def digest_file(path):
    checked(path)
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def identifier(value, pattern=ID):
    if not isinstance(value, str) or not pattern.fullmatch(value):
        raise BackupError("备份编号格式无效")
    return value


def archive_metadata(directory: Path, *, full=False):
    checked(directory)
    if sorted(p.name for p in directory.iterdir()) != sorted(FILES):
        raise BackupError("备份须包含完整的三个文件")
    for name in FILES:
        checked(directory / name)
    manifest = read_json(directory / FILES[0])
    manifest_sha = digest_file(directory / FILES[0])
    if (directory / FILES[1]).stat().st_size > 128 or (directory / FILES[1]).read_text(encoding="utf-8-sig").strip() != manifest_sha:
        raise BackupError("备份清单校验不一致")
    backup_id = identifier(manifest.get("backupId"), BACKUP_ID)
    dump = manifest.get("dump", {})
    if (manifest.get("status") != "completed" or dump.get("fileName") != FILES[2]
            or not SHA.fullmatch(str(dump.get("sha256", "")))
            or type(dump.get("sizeBytes")) is not int or not 0 < dump["sizeBytes"] <= MAX_ARCHIVE
            or (directory / FILES[2]).stat().st_size != dump["sizeBytes"]):
        raise BackupError("备份文件长度或身份不一致")
    if full and digest_file(directory / FILES[2]) != dump["sha256"]:
        raise BackupError("数据库文件校验不一致")
    return {"backupId": backup_id, "manifestSha256": manifest_sha,
            "completedAt": manifest.get("completedAt"), "sizeBytes": dump["sizeBytes"],
            "dumpSha256": dump["sha256"]}


class BackupStore:
    """Filesystem operations ledger, separate from all business facts and DB credentials."""
    def __init__(self, runtime: Path, archive: Path):
        self.runtime, self.archive = runtime.absolute(), archive.absolute()
        self.root = self.runtime / "backups" / "console"
        self.imports = self.runtime / "backups" / "postgres-imports"

    @contextmanager
    def lock(self, name="state"):
        checked(self.root, missing=True)
        self.root.mkdir(parents=True, exist_ok=True)
        path = checked(self.root / f"{name}.lock", missing=True)
        with path.open("a+b") as stream:
            if stream.tell() == 0:
                stream.write(b"0")
                stream.flush()
            stream.seek(0)
            try:
                if os.name == "nt":
                    import msvcrt
                    msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                raise BackupError("另一个备份操作正在处理，请稍后重试", "busy", 409) from None
            try:
                yield
            finally:
                stream.seek(0)
                if os.name == "nt":
                    msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    fcntl.flock(stream.fileno(), fcntl.LOCK_UN)

    def audit(self, actor, action, resource):
        record = {"at": time.time(), "actorSha256": hashlib.sha256(actor.encode()).hexdigest(),
                  "action": action, "resource": resource}
        path = checked(self.root / "audit.jsonl", missing=True)
        with path.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(record, separators=(",", ":")) + "\n")
            stream.flush()
            os.fsync(stream.fileno())

    def policy(self):
        path = self.runtime / "run" / "backup-retention-v2.json"
        if not path.exists():
            return None
        policy = read_json(path)
        if (set(policy) != {"version", "maximumRecoveryPoints", "archiveRoot", "pins"}
                or policy["version"] != "teruisi-backup-retention-v2" or policy["maximumRecoveryPoints"] != 3
                or policy["archiveRoot"] != str(self.archive) or not isinstance(policy["pins"], list) or len(policy["pins"]) > 2):
            raise BackupError("备份保留策略无效", "invalid_policy", 409)
        seen = set()
        for pin in policy["pins"]:
            if not isinstance(pin, dict) or set(pin) != {"backupId", "manifestSha256"}:
                raise BackupError("备份保护绑定无效")
            identifier(pin["backupId"], BACKUP_ID)
            identifier(pin["manifestSha256"], SHA)
            if pin["backupId"] in seen:
                raise BackupError("备份保护绑定重复")
            seen.add(pin["backupId"])
        return policy

    def status(self, actor=None):
        policy = self.policy()
        pins = {p["backupId"]: p["manifestSha256"] for p in (policy or {}).get("pins", [])}
        items, errors = [], []
        if self.archive.exists():
            checked(self.archive)
            children = list(self.archive.iterdir())
            if len(children) > 4096:
                raise BackupError("备份目录数量超过上限")
            for directory in children:
                if not BACKUP_ID.fullmatch(directory.name):
                    continue
                try:
                    item = archive_metadata(directory)
                    if item["backupId"] != directory.name:
                        raise BackupError("备份目录与清单不一致")
                    item["protected"] = pins.get(item["backupId"]) == item["manifestSha256"]
                    items.append(item)
                except (BackupError, OSError):
                    errors.append(directory.name)
        jobs = []
        if self.root.exists():
            paths = sorted(self.root.glob("job-*.json"), key=lambda p: p.stat().st_mtime, reverse=True)[:20]
            jobs = [self.public_job(read_json(p)) for p in paths]
        uploads = []
        if self.root.exists() and actor:
            for path in self.root.glob("upload-*.json"):
                item = read_json(path)
                if item["actor"] == actor:
                    uploads.append({key: item[key] for key in ("id", "status", "sizeBytes", "offset", "createdAt")})
        return {"enabled": policy is not None, "uploads": uploads, "maximumRecoveryPoints": 3, "releaseRetentionDays": 7,
                "items": sorted(items, key=lambda item: item["completedAt"], reverse=True),
                "invalidBackupIds": errors, "jobs": jobs, "uploadChunkBytes": UPLOAD_CHUNK,
                "maximumArchiveBytes": MAX_ARCHIVE, "productionRestoreRequiresApproval": True}

    @staticmethod
    def public_job(job):
        return {key: job[key] for key in ("id", "action", "status", "createdAt", "updatedAt", "result", "error") if key in job}

    def submit(self, actor, payload):
        if set(payload) != {"id", "action", "target", "manifestSha256"}:
            raise BackupError("任务字段无效")
        job_id = identifier(payload["id"])
        action = payload["action"]
        if action not in {"backup", "export", "verify-import", "rehearse", "protect", "unprotect", "retention"}:
            raise BackupError("不支持的备份操作")
        if action in {"backup", "retention"}:
            if payload["target"] or payload["manifestSha256"]:
                raise BackupError("无效任务参数")
        elif action in {"verify-import", "rehearse"}:
            identifier(payload["target"])
            if payload["manifestSha256"]:
                raise BackupError("导入任务不接受外部清单摘要")
        else:
            identifier(payload["target"], BACKUP_ID)
            identifier(payload["manifestSha256"], SHA)
        with self.lock():
            path = self.root / f"job-{job_id}.json"
            if path.exists():
                old = read_json(path)
                if old["actor"] != actor or any(old[k] != payload[k] for k in payload):
                    raise BackupError("任务编号已绑定其他请求", "conflict", 409)
                return old, False
            if any((self.runtime / "run" / name).exists() for name in ("system-maintenance.json", "automation-drain.json")):
                raise BackupError("系统正在维护，暂不接受新的备份任务", "maintenance", 409)
            if self.policy() is None:
                raise BackupError("备份保留策略尚未上线启用", "not_enabled", 409)
            for old_path in self.root.glob("job-*.json"):
                old = read_json(old_path)
                if old["status"] in {"queued", "running", "unknown"}:
                    raise BackupError("已有备份任务未完成；未知结果须先核查", "busy", 409)
            if action in {"verify-import", "rehearse"}:
                self.upload(payload["target"], actor)
            job = {**payload, "actor": actor, "status": "queued", "createdAt": time.time(), "updatedAt": time.time()}
            self.audit(actor, "submit-" + action, job_id)
            atomic_json(path, job)
            return job, True

    def update_job(self, job_id, **changes):
        path = self.root / f"job-{identifier(job_id)}.json"
        with self.lock():
            job = read_json(path)
            job.update(changes, updatedAt=time.time())
            atomic_json(path, job)
            return job

    def upload(self, upload_id, actor, *, allow_expired=False):
        item = read_json(self.root / f"upload-{identifier(upload_id)}.json")
        if item["actor"] != actor:
            raise BackupError("导入任务不属于当前管理员", "access_denied", 403)
        if not allow_expired and time.time() - item["createdAt"] > 24 * 3600:
            raise BackupError("上传已过期，请清理后重新上传", "expired", 409)
        return item

    def begin_upload(self, actor, payload):
        if set(payload) != {"id", "sizeBytes"} or type(payload["sizeBytes"]) is not int or not 1 <= payload["sizeBytes"] <= MAX_ARCHIVE:
            raise BackupError("备份包大小无效，最大 8 GiB")
        upload_id = identifier(payload["id"])
        with self.lock():
            path = self.root / f"upload-{upload_id}.json"
            if path.exists():
                old = self.upload(upload_id, actor)
                if old["sizeBytes"] != payload["sizeBytes"]:
                    raise BackupError("上传编号已绑定其他文件", "conflict", 409)
                return old
            if len(list(self.root.glob("upload-*.json"))) >= 3:
                raise BackupError("请先清理已有导入文件", "capacity", 409)
            if shutil.disk_usage(self.root).free < payload["sizeBytes"] * 2 + 1024**3:
                raise BackupError("临时磁盘空间不足", "capacity", 409)
            item = {**payload, "actor": actor, "offset": 0, "createdAt": time.time(), "status": "uploading"}
            self.audit(actor, "upload-created", upload_id)
            atomic_json(path, item)
            return item

    def upload_chunk(self, actor, payload):
        if set(payload) != {"id", "offset", "data", "sha256"} or type(payload["offset"]) is not int:
            raise BackupError("上传分块字段无效")
        identifier(payload["sha256"], SHA)
        if not isinstance(payload["data"], str) or len(payload["data"]) > UPLOAD_CHUNK * 2:
            raise BackupError("上传分块超过上限")
        try:
            data = base64.b64decode(payload["data"], validate=True)
        except ValueError:
            raise BackupError("上传分块编码无效") from None
        if not 0 < len(data) <= UPLOAD_CHUNK or hashlib.sha256(data).hexdigest() != payload["sha256"]:
            raise BackupError("上传分块校验失败")
        with self.lock():
            item = self.upload(payload["id"], actor)
            if item["status"] != "uploading":
                raise BackupError("上传已封存", "conflict", 409)
            offset = payload["offset"]
            if offset < 0 or offset > item["offset"] or offset + len(data) > item["sizeBytes"]:
                raise BackupError("上传偏移不连续", "conflict", 409)
            path = checked(self.root / f"upload-{item['id']}.zip", missing=True)
            with path.open("r+b" if path.exists() else "x+b") as stream:
                stream.seek(offset)
                if offset < item["offset"]:
                    if offset + len(data) > item["offset"] or stream.read(len(data)) != data:
                        raise BackupError("重复分块内容不同", "conflict", 409)
                    return {"offset": item["offset"]}
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            item["offset"] += len(data)
            atomic_json(self.root / f"upload-{item['id']}.json", item)
            return {"offset": item["offset"]}

    def unpack(self, upload_id, actor):
        item = self.upload(upload_id, actor)
        if item["offset"] != item["sizeBytes"] or item["status"] != "uploading":
            raise BackupError("上传不完整或已封存")
        path = checked(self.root / f"upload-{upload_id}.zip")
        if path.stat().st_size != item["sizeBytes"]:
            raise BackupError("上传长度不一致")
        stage = checked(self.root / f"extract-{upload_id}", missing=True)
        stage.mkdir()
        with zipfile.ZipFile(path) as archive:
            infos = archive.infolist()
            if len(infos) != 3 or sorted(info.filename for info in infos) != sorted(FILES):
                raise BackupError("仅接受系统导出的完整三文件备份包")
            if sum(info.file_size for info in infos) > MAX_ARCHIVE:
                raise BackupError("解包体积超过上限")
            for info in infos:
                kind = (info.external_attr >> 16) & 0o170000
                if info.is_dir() or kind not in {0, stat.S_IFREG} or info.flag_bits & 1:
                    raise BackupError("备份包包含不支持的文件类型")
                if info.filename != FILES[2] and info.file_size > MAX_JSON:
                    raise BackupError("备份清单过大")
                written = 0
                with archive.open(info) as source, (stage / info.filename).open("xb") as target:
                    while chunk := source.read(1024**2):
                        written += len(chunk)
                        if written > info.file_size:
                            raise BackupError("备份解包长度不一致")
                        target.write(chunk)
        meta = archive_metadata(stage, full=True)
        checked(self.imports, missing=True)
        self.imports.mkdir(parents=True, exist_ok=True)
        destination = checked(self.imports / meta["backupId"], missing=True)
        if destination.exists():
            if archive_metadata(destination, full=True) != meta:
                raise BackupError("已有同名导入的内容不同", "conflict", 409)
            for name in FILES:
                (stage / name).unlink()
            stage.rmdir()
        else:
            stage.rename(destination)
        item.update(status="sealed", metadata=meta)
        atomic_json(self.root / f"upload-{upload_id}.json", item)
        return destination, meta

    def cleanup_expired_exports(self):
        with self.lock():
            for path in self.root.glob("job-*.json"):
                job = read_json(path)
                if job["action"] == "export" and job["status"] in {"completed", "failed"} and time.time() - job["updatedAt"] > 24 * 3600:
                    export = checked(self.root / f"export-{identifier(job['id'])}.zip", missing=True)
                    if export.exists():
                        self.audit(job["actor"], "expired-export-removed", job["id"])
                        export.unlink()

    def export_zip(self, job_id, backup_id, manifest_sha):
        directory = checked(self.archive / identifier(backup_id, BACKUP_ID))
        meta = archive_metadata(directory, full=True)
        if meta["manifestSha256"] != manifest_sha:
            raise BackupError("备份内容已变化", "conflict", 409)
        if shutil.disk_usage(self.root).free < meta["sizeBytes"] + 1024**3:
            raise BackupError("临时磁盘空间不足", "capacity", 409)
        target = checked(self.root / f"export-{identifier(job_id)}.zip", missing=True)
        with zipfile.ZipFile(target, "x", compression=zipfile.ZIP_STORED, allowZip64=True) as output:
            for name in FILES:
                output.write(checked(directory / name), name)
        if archive_metadata(directory, full=True) != meta:
            raise BackupError("导出期间备份内容变化", "conflict", 409)
        info = target.stat()
        return {"backupId": backup_id, "manifestSha256": manifest_sha,
                "sizeBytes": info.st_size, "sha256": digest_file(target), "downloadId": job_id,
                "fileIdentity": [info.st_dev, info.st_ino, str(info.st_mtime_ns)]}

    def download(self, actor, job_id, offset):
        job = read_json(self.root / f"job-{identifier(job_id)}.json")
        if job["actor"] != actor or job["action"] != "export" or job["status"] != "completed":
            raise BackupError("导出不可用", "access_denied", 403)
        if time.time() - job["updatedAt"] > 24 * 3600:
            raise BackupError("导出链接已过期，请重新导出", "expired", 409)
        path = checked(self.root / f"export-{job_id}.zip")
        if type(offset) is not int or not 0 <= offset < job["result"]["sizeBytes"] or offset % DOWNLOAD_CHUNK:
            raise BackupError("下载偏移无效")
        info = path.stat()
        identity = [info.st_dev, info.st_ino, str(info.st_mtime_ns)]
        if info.st_size != job["result"]["sizeBytes"] or identity != job["result"]["fileIdentity"]:
            raise BackupError("导出文件已变化", "conflict", 409)
        with path.open("rb") as stream:
            stream.seek(offset)
            data = stream.read(DOWNLOAD_CHUNK)
        after = checked(path).stat()
        if [after.st_dev, after.st_ino, str(after.st_mtime_ns)] != identity or after.st_size != info.st_size:
            raise BackupError("下载期间文件变化", "conflict", 409)
        return {"data": base64.b64encode(data).decode(), "offset": offset,
                "sha256": hashlib.sha256(data).hexdigest(), "nextOffset": offset + len(data),
                "sizeBytes": job["result"]["sizeBytes"]}

    def discard(self, actor, upload_id):
        with self.lock():
            item = self.upload(upload_id, actor, allow_expired=True)
            for path in self.root.glob("job-*.json"):
                job = read_json(path)
                if job["target"] == upload_id and job["status"] in {"queued", "running", "unknown"}:
                    raise BackupError("导入任务仍在执行", "busy", 409)
            self.audit(actor, "discard-upload", upload_id)
            stage = self.root / f"extract-{upload_id}"
            if stage.exists():
                checked(stage)
                for child in stage.iterdir():
                    if child.name not in FILES:
                        raise BackupError("暂存目录内容异常")
                    checked(child).unlink()
                stage.rmdir()
            # Imported backup is retained until no other upload refers to it.
            meta = item.get("metadata")
            if meta:
                directory = self.imports / identifier(meta["backupId"], BACKUP_ID)
                others = [read_json(p) for p in self.root.glob("upload-*.json") if p.name != f"upload-{upload_id}.json"]
                if directory.exists() and not any(p.get("metadata", {}).get("backupId") == meta["backupId"] for p in others):
                    if archive_metadata(directory, full=True)["manifestSha256"] != meta["manifestSha256"]:
                        raise BackupError("导入副本已变化")
                    for name in FILES:
                        checked(directory / name).unlink()
                    directory.rmdir()
            checked(self.root / f"upload-{upload_id}.zip", missing=True).unlink(missing_ok=True)
            checked(self.root / f"upload-{upload_id}.json").unlink()
