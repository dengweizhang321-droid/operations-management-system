"""Explicit synthetic 0073 snapshot -> encrypted stream -> fresh-cluster audit.

This is NOT a formal backup/restore entry point. It requires a running,
disposable source cluster with the exact 0073 seed. Its random archive key is
process-only; the resulting ciphertext is deliberately not a durable backup.
No service, scheduler, PrepareApp, or production helper imports this script.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "tools"))

from protected_ai_archive_v2_stream import (
    ArchiveInvalid, open_verified_stream, seal_process_stdout)
from protected_ai_cross_cluster_generation import contract, seed_matches


VERSION = "protected-ai-shadow-snapshot-0073-v1"
MIGRATIONS = contract("0073").migrations
BASE_MIGRATION = "0067_business_promotion_budget_v11_attestation"
PROTECTED_ROLES = contract("0073").roles
PROTECTED_TABLE_COUNT = contract("0073").table_count
KEY_TABLE = "public.protected_business_budget_v11_verifier_keys"
KEY_ID = "synthetic-shadow-0073"
ARCHIVE_KEY_ID = "synthetic-shadow-stream-0073"
BIN = Path(r"D:\teruisi-runtime\django-sales\postgresql-17.11\bin")
RUN_NAME = re.compile(r"ai-pg-[0-9a-f]{12}\Z")
MAX_FILE_CHUNKS = 100_000
MAX_FILE_BYTES = 512 * 1024 * 1024
MAX_PROTECTED_ROWS = 100_000
MAX_PROTECTED_JSON_BYTES = 128 * 1024 * 1024


class ShadowBlocked(RuntimeError):
    pass


def _canonical(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=True, sort_keys=True,
        separators=(",", ":"), allow_nan=False).encode("ascii")


def _sha(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def validate_isolation(root: Path, run_root: Path, database: dict,
                       seed: object, target_port: int, *, enabled: bool):
    """Refuse before a connection, file, key, or process is created."""
    source_port = database.get("PORT")
    if (enabled is not True or root.resolve() == Path(r"D:\运营管理系统").resolve()
            or run_root.resolve().parent != (root / ".runtime").resolve()
            or RUN_NAME.fullmatch(run_root.name) is None
            or not run_root.is_dir() or run_root.is_symlink()
            or getattr(run_root, "is_junction", lambda: False)()
            or database.get("HOST") != "127.0.0.1"
            or database.get("NAME") != "teruisi_ai_rehearsal"
            or database.get("USER") != "ai_rehearsal_admin"
            or not str(source_port).isdigit()
            or not 55440 <= int(source_port) <= 55999
            or type(target_port) is not int
            or not 55440 <= target_port <= 55999
            or target_port == int(source_port)
            or not seed_matches(seed, contract("0073"))
            or seed.get("productionWrites") is not False
            or type(seed.get("oldFileChunkCount")) is not int
            or seed["oldFileChunkCount"] < 2):
        raise ShadowBlocked("0073 shadow rehearsal requires pinned synthetic identity")
    return int(source_port)


def file_digest_rows(rows: list[tuple]) -> dict[str, object]:
    """Hash content, never include a byte of file content in evidence."""
    normalized = []
    formats = set()
    total_bytes = 0
    for run_id, attempt, volume, kind, sequence, content, saved in rows:
        if (not isinstance(run_id, str) or not isinstance(attempt, int)
                or not isinstance(volume, int) or not isinstance(kind, str)
                or not isinstance(sequence, int) or not isinstance(content,
                    (bytes, bytearray, memoryview))
                or not isinstance(saved, str)):
            raise ShadowBlocked("synthetic file chunk identity invalid")
        actual = _sha(bytes(content))
        if actual != saved or not content:
            raise ShadowBlocked("synthetic file chunk changed or empty")
        total_bytes += len(content)
        if (len(normalized) >= MAX_FILE_CHUNKS
                or total_bytes > MAX_FILE_BYTES):
            raise ShadowBlocked("synthetic file chunk inventory exceeds bound")
        formats.add(kind.lower())
        normalized.append((run_id, attempt, volume, kind, sequence,
            len(content), actual))
    normalized.sort()
    if (len(normalized) < 2 or not {"html", "xlsx"} <= formats
            or len(normalized) != len(set(row[:5] for row in normalized))):
        raise ShadowBlocked("nonempty HTML and XLSX file roots are required")
    return {"chunkCount": len(normalized), "formats": sorted(formats),
        "chunkRootSha256": _sha(_canonical(normalized))}


def protected_row_digest(rows_by_table: dict[str, list[object]]) -> dict:
    if (len(rows_by_table) != PROTECTED_TABLE_COUNT
            or KEY_TABLE.removeprefix("public.") not in rows_by_table):
        raise ShadowBlocked("protected table inventory is not 0073")
    result = {}
    total_rows = 0
    total_bytes = 0
    for table, rows in sorted(rows_by_table.items()):
        if not table.startswith("protected_business_") or not isinstance(
                rows, list):
            raise ShadowBlocked("protected row identity invalid")
        packed = []
        for row in rows:
            encoded = _canonical(row)
            total_rows += 1
            total_bytes += len(encoded)
            if (total_rows > MAX_PROTECTED_ROWS
                    or total_bytes > MAX_PROTECTED_JSON_BYTES):
                raise ShadowBlocked("protected row inventory exceeds bound")
            packed.append(encoded.decode("ascii"))
        packed.sort()
        result[table] = {"rowCount": len(rows),
            "rowsSha256": _sha(_canonical(packed))}
    if result[KEY_TABLE.removeprefix("public.")]["rowCount"] != 1:
        raise ShadowBlocked("one synthetic private verifier key is required")
    return result


def snapshot_manifest(snapshot_id: str, evidence: dict,
                      protected_rows: dict, files: dict, roles: list,
                      source_port: int, target_port: int) -> tuple[dict, str]:
    if (not isinstance(snapshot_id, str) or not snapshot_id
            or not isinstance(evidence, dict)
            or not re.fullmatch(r"[0-9a-f]{64}",
                str(evidence.get("contentSha256", "")))
            or type(source_port) is not int or type(target_port) is not int):
        raise ShadowBlocked("snapshot evidence is incomplete")
    manifest = {"schemaVersion": VERSION, "generation": "0073",
        "archiveLayout": "v2-stream-v1", "sourcePort": source_port,
        "targetPort": target_port,
        "snapshotIdSha256": _sha(snapshot_id.encode("utf-8")),
        "contentSha256": evidence["contentSha256"],
        "migrationRootSha256": _sha(_canonical(MIGRATIONS)),
        "protectedRowsRootSha256": _sha(_canonical(protected_rows)),
        "fileRootSha256": files["chunkRootSha256"],
        "fileChunkCount": files["chunkCount"],
        "roleRootSha256": _sha(_canonical(roles)),
        "syntheticKeyRows": protected_rows[
            KEY_TABLE.removeprefix("public.")]["rowCount"],
        "formalBackupPathVerified": False,
        "longTermKeyCustodyVerified": False,
        "productionWrites": False}
    return manifest, _sha(_canonical(manifest))


class SyntheticKeyProvider:
    def __init__(self, value: bytes):
        if type(value) is not bytes or len(value) != 32:
            raise ShadowBlocked("synthetic archive key size invalid")
        self._value = value

    def resolve_key(self, key_id: str, purpose: str) -> bytes:
        if key_id != ARCHIVE_KEY_ID or purpose not in {"seal", "open"}:
            raise ShadowBlocked("archive key purpose is unavailable")
        return self._value


def _native(command, env: dict[str, str], *, timeout=600):
    result = subprocess.run([str(item) for item in command], cwd=ROOT,
        env=env, capture_output=True, timeout=timeout,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    if result.returncode:
        raise ShadowBlocked("isolated native command failed; diagnosticSha256="
            + _sha(result.stderr[:16384]))


def _backup_helper():
    source = ROOT / "tools/postgres-consistent-backup.py"
    spec = importlib.util.spec_from_file_location(
        "protected_shadow_backup_helper", source)
    if spec is None or spec.loader is None:
        raise ShadowBlocked("backup evidence helper is unavailable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _roles(db):
    rows = db.execute("SELECT rolname,rolcanlogin,rolinherit,rolsuper,"
        "rolcreatedb,rolcreaterole,rolreplication,rolbypassrls "
        "FROM pg_catalog.pg_roles WHERE rolname LIKE 'teruisi_%' "
        "ORDER BY rolname").fetchall()
    names = {row[0] for row in rows}
    if not PROTECTED_ROLES <= names:
        raise ShadowBlocked("0073 protected global roles are missing")
    for row in rows:
        if (not re.fullmatch(r"teruisi_[a-z0-9_]{1,64}", row[0])
                or any(row[3:])
                or row[0] in PROTECTED_ROLES and (row[1] or row[2])):
            raise ShadowBlocked("0073 global role properties drifted")
    members = db.execute("SELECT count(*) FROM pg_catalog.pg_auth_members m "
        "JOIN pg_catalog.pg_roles p ON p.oid=m.roleid "
        "JOIN pg_catalog.pg_roles c ON c.oid=m.member "
        "WHERE p.rolname LIKE 'teruisi_%' OR c.rolname LIKE 'teruisi_%'"
        ).fetchone()
    if members != (0,):
        raise ShadowBlocked("0073 protected role membership drifted")
    protected_passwords = db.execute("SELECT rolname,rolpassword FROM "
        "pg_catalog.pg_authid WHERE rolname=ANY(%s)",
        [sorted(PROTECTED_ROLES)]).fetchall()
    if (len(protected_passwords) != len(PROTECTED_ROLES)
            or any(value is not None for _, value in protected_passwords)):
        raise ShadowBlocked("0073 protected role login or password drifted")
    return rows


def _protected_rows(db):
    from psycopg import sql
    names = [row[0] for row in db.execute("SELECT tablename FROM "
        "pg_catalog.pg_tables WHERE schemaname='public' "
        "AND tablename LIKE 'protected_business_%' ORDER BY tablename"
        ).fetchall()]
    if len(names) != PROTECTED_TABLE_COUNT:
        raise ShadowBlocked("0073 protected table count drifted")
    found = {}
    count = 0
    total_bytes = 0
    for name in names:
        found[name] = []
        with db.cursor() as cursor:
            cursor.execute(sql.SQL("SELECT row_to_json(t) FROM {} t").format(
                sql.Identifier("public", name)))
            for (row,) in cursor:
                encoded = _canonical(row)
                count += 1
                total_bytes += len(encoded)
                if (count > MAX_PROTECTED_ROWS
                        or total_bytes > MAX_PROTECTED_JSON_BYTES):
                    raise ShadowBlocked("protected row inventory exceeds bound")
                found[name].append(row)
    return found


def _files(db):
    size = db.execute("SELECT count(*),COALESCE(sum(octet_length(content)),0) "
        "FROM public.ai_business_volume_chunks").fetchone()
    if (size[0] > MAX_FILE_CHUNKS or size[1] > MAX_FILE_BYTES):
        raise ShadowBlocked("synthetic file chunk inventory exceeds bound")
    with db.cursor() as cursor:
        cursor.execute("SELECT run_id,attempt,volume_index,format,sequence,"
            "content,content_digest FROM public.ai_business_volume_chunks "
            "ORDER BY run_id,attempt,volume_index,format,sequence")
        return file_digest_rows(cursor)


def _verify_catalog(db):
    for name in (BASE_MIGRATION, *MIGRATIONS):
        module = importlib.import_module("ai_assistant.migrations." + name)
        with db.cursor() as cursor:
            module.verify_catalog(cursor)
    found = {row[0] for row in db.execute("SELECT name FROM "
        "django_migrations WHERE app='ai_assistant' AND name=ANY(%s)",
        [[BASE_MIGRATION, *MIGRATIONS]]).fetchall()}
    if found != {BASE_MIGRATION, *MIGRATIONS}:
        raise ShadowBlocked("0073 protected migration receipt drift")
    if db.execute("SELECT has_table_privilege('teruisi_ai_writer',%s,"
            "'SELECT')", [KEY_TABLE]).fetchone() != (False,):
        raise ShadowBlocked("ordinary AI writer can read private key")


def _source_state(db, helper, port):
    _verify_catalog(db)
    evidence = helper.collect_evidence(db,
        expected_database="teruisi_ai_rehearsal",
        expected_user="ai_rehearsal_admin")
    rows = protected_row_digest(_protected_rows(db))
    files = _files(db)
    roles = _roles(db)
    return evidence, rows, files, roles


def _formal_early_refusal(env, port, run_root: Path):
    output = run_root / "shadow-formal-unadmitted.dump"
    if output.exists():
        raise ShadowBlocked("formal negative target already exists")
    result = subprocess.run([sys.executable,
        ROOT / "tools/postgres-consistent-backup.py", "backup",
        "--pg-dump", BIN / "pg_dump.exe", "--output", output,
        "--expected-database", "teruisi_ai_rehearsal",
        "--expected-user", "ai_rehearsal_admin",
        "--port", str(port), "--timeout-seconds", "60"],
        cwd=ROOT, env=env, capture_output=True, timeout=90,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    try:
        refusal = json.loads(result.stderr)
    except (ValueError, UnicodeError) as error:
        raise ShadowBlocked("formal refusal is not structured") from error
    expected = _sha(b"protected AI daily backup is not admitted")
    if (result.returncode != 1 or output.exists()
            or refusal.get("status") != "failed"
            or refusal.get("errorSha256") != expected):
        raise ShadowBlocked("formal backup did not fail before archive")


def _free_loopback_port(port: int):
    with socket.socket() as probe:
        try:
            probe.bind(("127.0.0.1", port))
        except OSError as error:
            raise ShadowBlocked("synthetic target port is occupied") from error


def run_shadow(run_root: Path, source_port: int, target_port: int,
               password: str, *, helper) -> dict:
    """The only effectful path; caller must pass validate_isolation first."""
    import psycopg
    from psycopg import sql
    _free_loopback_port(target_port)
    target_root = run_root / "shadow-snapshot-0073"
    if (target_root.exists() or target_root.parent.resolve() !=
            run_root.resolve() or shutil.disk_usage(run_root).free <
            4 * 1024**3):
        raise ShadowBlocked("synthetic target path or space is unavailable")
    source_env = {**os.environ, "PGHOST": "127.0.0.1",
        "PGPORT": str(source_port), "PGDATABASE": "teruisi_ai_rehearsal",
        "PGUSER": "ai_rehearsal_admin", "PGPASSWORD": password}
    with psycopg.connect(host="127.0.0.1", port=source_port,
            dbname="teruisi_ai_rehearsal", user="ai_rehearsal_admin",
            password=password, autocommit=True) as source:
        _verify_catalog(source)
        # Refuse incomplete frozen fixtures before the one synthetic INSERT.
        _roles(source)
        _files(source)
        if source.execute("SELECT count(*) FROM " + KEY_TABLE
                ).fetchone() != (0,):
            raise ShadowBlocked("synthetic key table must start empty")
        # A random test key is a data fixture, not an archive key or key store.
        source.execute("INSERT INTO " + KEY_TABLE +
            " (key_id,secret,status,created_at) VALUES (%s,%s,'active',now())",
            [KEY_ID, secrets.token_bytes(32)])
    _formal_early_refusal(source_env, source_port, run_root)

    archive_key = SyntheticKeyProvider(secrets.token_bytes(32))
    target_root.mkdir()
    archive = target_root / "synthetic-source.dump.v2s1.aead"
    target_password = secrets.token_hex(32)
    password_file = target_root / ".synthetic-password.tmp"
    password_file.write_text(target_password + "\n", encoding="ascii")
    os.chmod(password_file, 0o600)
    target_env = {**source_env, "PGPORT": str(target_port),
        "PGPASSWORD": target_password}
    data_dir = target_root / "data"
    started = False
    try:
        _native([BIN / "initdb.exe", "-D", data_dir, "-U",
            "ai_rehearsal_admin", "--auth=scram-sha-256",
            "--encoding=UTF8", "--locale=C", "--pwfile", password_file],
            target_env)
        password_file.unlink()
        with (data_dir / "postgresql.conf").open("a", encoding="utf-8") as out:
            out.write(f"\nlisten_addresses='127.0.0.1'\nport={target_port}"
                "\nmax_connections=32\n")
        _native([BIN / "pg_ctl.exe", "-D", data_dir, "-l",
            target_root / "postgres.log", "-w", "-t", "30", "start"],
            target_env, timeout=60)
        started = True
        with psycopg.connect(host="127.0.0.1", port=target_port,
                dbname="postgres", user="ai_rehearsal_admin",
                password=target_password, autocommit=True) as admin:
            with psycopg.connect(host="127.0.0.1", port=source_port,
                    dbname="teruisi_ai_rehearsal", user="ai_rehearsal_admin",
                    password=password, autocommit=True) as source:
                source_roles = _roles(source)
            for name, login, inherit, *_ in source_roles:
                admin.execute(sql.SQL("CREATE ROLE {} {} {} NOSUPERUSER "
                    "NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS "
                    "PASSWORD NULL").format(sql.Identifier(name),
                    sql.SQL("LOGIN" if login else "NOLOGIN"),
                    sql.SQL("INHERIT" if inherit else "NOINHERIT")))

        with psycopg.connect(host="127.0.0.1", port=source_port,
                dbname="teruisi_ai_rehearsal", user="ai_rehearsal_admin",
                password=password, autocommit=True) as source:
            source.execute("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE "
                "READ READ ONLY")
            snapshot_id = source.execute("SELECT pg_export_snapshot()"
                ).fetchone()[0]
            evidence, rows, files, roles = _source_state(source, helper,
                source_port)
            manifest, context = snapshot_manifest(snapshot_id, evidence,
                rows, files, roles, source_port, target_port)
            dump = [BIN / "pg_dump.exe", "--format=custom", "--compress=6",
                "--host=127.0.0.1", f"--port={source_port}",
                "--username=ai_rehearsal_admin",
                "--dbname=teruisi_ai_rehearsal", "--lock-wait-timeout=5000",
                f"--snapshot={snapshot_id}"]
            sealed = seal_process_stdout(dump, archive,
                key_id=ARCHIVE_KEY_ID, context_sha256=context,
                key_provider=archive_key, env=source_env, timeout_seconds=600)
            source.execute("ROLLBACK")

        with psycopg.connect(host="127.0.0.1", port=source_port,
                dbname="teruisi_ai_rehearsal", user="ai_rehearsal_admin",
                password=password, autocommit=True) as fresh_source:
            if _roles(fresh_source) != roles:
                raise ShadowBlocked("global role inventory changed during snapshot")

        with archive.open("rb") as encrypted_file:
            prefix = encrypted_file.read(5)
        if (not archive.is_file() or any(target_root.glob("*.dump"))
                or prefix == b"PGDMP"):
            raise ShadowBlocked("encrypted archive was not exclusively published")
        try:
            with open_verified_stream(archive,
                    expected_key_id=ARCHIVE_KEY_ID,
                    expected_context_sha256=context,
                    key_provider=SyntheticKeyProvider(secrets.token_bytes(32))):
                pass
        except ArchiveInvalid:
            pass
        else:
            raise ShadowBlocked("wrong synthetic archive key was accepted")
        _native([BIN / "createdb.exe", "teruisi_ai_rehearsal"],
            target_env)
        with open_verified_stream(archive,
                expected_key_id=ARCHIVE_KEY_ID,
                expected_context_sha256=context,
                key_provider=archive_key) as verified:
            if verified.evidence != sealed:
                raise ShadowBlocked("first-pass archive evidence drifted")
            restored = verified.copy_to_transactional_process([
                BIN / "pg_restore.exe", "--single-transaction",
                "--exit-on-error", "--dbname", "teruisi_ai_rehearsal"],
                env=target_env, timeout_seconds=600)
            if restored != sealed:
                raise ShadowBlocked("second-pass archive evidence drifted")
        with psycopg.connect(host="127.0.0.1", port=target_port,
                dbname="teruisi_ai_rehearsal", user="ai_rehearsal_admin",
                password=target_password, autocommit=True) as target:
            target_evidence, target_rows, target_files, target_roles = (
                _source_state(target, helper, target_port))
            if (target_evidence["contentSha256"] != evidence["contentSha256"]
                    or target_rows != rows or target_files != files
                    or target_roles != roles):
                raise ShadowBlocked("restored snapshot rows, files or roles differ")
        if any(target_root.glob("*.dump")):
            raise ShadowBlocked("shadow target left a plaintext dump")
        with archive.open("rb") as encrypted_file:
            archive_sha = hashlib.file_digest(encrypted_file, "sha256").hexdigest()
        result = {"schemaVersion": VERSION, "status": "passed",
            "generation": "0073", "protectedRoles": len(PROTECTED_ROLES),
            "protectedTables": PROTECTED_TABLE_COUNT,
            "syntheticVerifierKeyRows": 1,
            "fileChunkCount": files["chunkCount"],
            "fileFormats": files["formats"],
            "fileRootSha256": files["chunkRootSha256"],
            "contentSha256": evidence["contentSha256"],
            "archiveContextSha256": context,
            "encryptedArchiveSha256": archive_sha,
            "archiveChunks": sealed.chunk_count,
            "ownerAclAndFilesRestored": True,
            "formalBackupEarlyRefusal": True,
            "archiveKeyPersisted": False,
            "longTermRestorePossible": False,
            "privilegedProductionIdentityVerified": False,
            "formalBackupPathVerified": False,
            "productionWrites": False}
        (target_root / "manifest.json").write_bytes(_canonical(manifest))
        (target_root / "evidence.json").write_bytes(_canonical(result))
        return result
    finally:
        if password_file.exists():
            password_file.unlink()
        if data_dir.exists():
            status = subprocess.run([str(BIN / "pg_ctl.exe"), "-D",
                str(data_dir), "status"], cwd=ROOT, env=target_env,
                capture_output=True, timeout=30,
                creationflags=subprocess.CREATE_NO_WINDOW
                if os.name == "nt" else 0)
            if status.returncode == 0:
                _native([BIN / "pg_ctl.exe", "-D", data_dir, "-m", "fast",
                    "-w", "-t", "30", "stop"], target_env, timeout=60)
            elif started:
                raise ShadowBlocked("synthetic target shutdown state is unknown")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-root", type=Path, required=True)
    parser.add_argument("--target-port", type=int, required=True)
    parser.add_argument("--enabled", action="store_true")
    options = parser.parse_args(argv)
    # Default refusal is before django.setup(), libpq, key material or output.
    if options.enabled is not True:
        raise ShadowBlocked("shadow snapshot is disabled by default")
    import django
    django.setup()
    from django.conf import settings
    if settings.DJANGO_ENVIRONMENT != "test":
        raise ShadowBlocked("shadow snapshot requires Django test environment")
    folder = options.run_root.resolve()
    database = settings.DATABASES["default"]
    seed_path = folder / contract("0073").seed_file
    seed = json.loads(seed_path.read_text(encoding="utf-8")) if seed_path.is_file() else {}
    source_port = validate_isolation(ROOT, folder, database, seed,
        options.target_port, enabled=True)
    if (str(source_port) != os.getenv("TERUISI_AI_REHEARSAL_PORT")
            or not database.get("PASSWORD") or not BIN.is_dir()):
        raise ShadowBlocked("isolated source port or binary runtime unavailable")
    helper = _backup_helper()
    run_shadow(folder, source_port, options.target_port,
        str(database["PASSWORD"]), helper=helper)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
