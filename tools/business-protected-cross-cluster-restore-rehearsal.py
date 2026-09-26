"""Test-only 0072 archive restoration into a SECOND fresh PostgreSQL cluster.

Uses synthetic cluster credentials, a synthetic verifier key and the isolated
source created by ai-postgres-rehearsal.py. Never reads a production archive.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib
import json
import os
from pathlib import Path
import re
import secrets
import socket
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
import django
django.setup()
import psycopg
from psycopg import sql
from django.conf import settings
from protected_ai_synthetic_archive import (
    MAX_PLAINTEXT_BYTES, decrypt as decrypt_synthetic_archive,
    encrypt as encrypt_synthetic_archive,
)


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--run-root", type=Path, required=True)
folder = parser.parse_args().run_root.resolve()
database = settings.DATABASES["default"]
seed_path = folder / "business-market-v2-authority-upgrade-evidence.json"
seed = json.loads(seed_path.read_text(encoding="utf-8")) if seed_path.is_file() else {}
if (ROOT.resolve() == Path(r"D:\运营管理系统").resolve()
        or folder.parent != (ROOT / ".runtime").resolve()
        or settings.DJANGO_ENVIRONMENT != "test"
        or database["HOST"] != "127.0.0.1"
        or database["NAME"] != "teruisi_ai_rehearsal"
        or database["USER"] != "ai_rehearsal_admin"
        or str(database["PORT"]) != os.getenv("TERUISI_AI_REHEARSAL_PORT")
        or not 55440 <= int(database["PORT"]) <= 55999
        or seed.get("upgrade") != "0071->0072"
        or seed.get("afterBackupRestored") is not True
        or seed.get("emptyReverseAndReapply") is not True):
    raise RuntimeError("cross-cluster restore requires exact isolated 0072 seed")

BIN = Path(r"D:\teruisi-runtime\django-sales\postgresql-17.11\bin")
PROTECTED_ROLES = {
    "teruisi_ai_budget_v11_attestor",
    "teruisi_ai_budget_v11_key_owner",
    "teruisi_ai_budget_v11_publisher",
    "teruisi_ai_market_paid_adopter",
    "teruisi_ai_market_paid_reserver",
    "teruisi_ai_market_paid_starter",
    "teruisi_ai_budget_v11_attest_login",
    "teruisi_ai_budget_v11_sign_login",
    "teruisi_ai_budget_v11_publish_login",
    "teruisi_ai_market_rate_proposer",
    "teruisi_ai_market_cap_proposer",
    "teruisi_ai_market_proposal_revoker",
}
MIGRATIONS = (
    "0068_business_promotion_budget_v11_verifier_receipt",
    "0069_business_market_v2_paid_round_rehearsal",
    "0070_business_promotion_budget_v11_limited_identity",
    "0071_business_v4_report_source_link",
    "0072_business_market_v2_authority_proposals",
)
modules = [importlib.import_module("ai_assistant.migrations." + name)
           for name in MIGRATIONS]
key_table = modules[0].KEY_TABLE


def run(command: list[object], *, env: dict[str, str], timeout: int = 300) -> None:
    log = folder / ("cross-cluster-command-" + secrets.token_hex(4) + ".log")
    with log.open("wb") as stream:
        completed = subprocess.run([str(part) for part in command], cwd=ROOT,
            env=env, stdout=stream, stderr=subprocess.STDOUT, timeout=timeout,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    if completed.returncode:
        raise RuntimeError("isolated cross-cluster command failed: " + str(log))


def run_sensitive(command: list[object], *, env: dict[str, str],
        input_bytes: bytes | None = None, timeout: int = 600) -> bytes:
    """Keep synthetic custom archive bytes out of command logs and disk files."""
    completed = subprocess.run([str(part) for part in command], cwd=ROOT,
        env=env, input=input_bytes, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, timeout=timeout,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    if completed.returncode:
        raise RuntimeError("isolated protected archive command failed; diagnosticSha256="
            + hashlib.sha256(completed.stderr[:16384]).hexdigest())
    return completed.stdout


def open_db(port: int, password: str) -> psycopg.Connection:
    return psycopg.connect(host="127.0.0.1", port=port,
        dbname="teruisi_ai_rehearsal", user="ai_rehearsal_admin",
        password=password, autocommit=True)


def verify_catalog(db: psycopg.Connection) -> None:
    with db.cursor() as cursor:
        for module in modules:
            module.verify_catalog(cursor)
        cursor.execute("SELECT name FROM django_migrations WHERE "
            "app='ai_assistant' AND name=ANY(%s)", [list(MIGRATIONS)])
        if {row[0] for row in cursor.fetchall()} != set(MIGRATIONS):
            raise AssertionError("protected migration receipts missing")
        cursor.execute("SELECT has_table_privilege(%s,%s,'SELECT')",
            ["teruisi_ai_writer", key_table])
        if cursor.fetchone() != (False,):
            raise AssertionError("ordinary AI writer can read verifier key")


def protected_rows(db: psycopg.Connection) -> dict[str, tuple[int, str]]:
    """Hash full synthetic rows in memory; never print private key bytes."""
    tables = [row[0] for row in db.execute(
        "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' "
        "AND tablename LIKE 'protected_business_%' ORDER BY tablename")]
    if len(tables) != 8 or key_table.removeprefix("public.") not in tables:
        raise AssertionError("protected table inventory incomplete")
    result = {}
    for table in tables:
        rows = db.execute(sql.SQL("SELECT row_to_json(t) FROM {} t").format(
            sql.Identifier("public", table))).fetchall()
        normalized = sorted(json.dumps(row[0], ensure_ascii=True,
            sort_keys=True, separators=(",", ":")) for row in rows)
        payload = json.dumps(normalized, ensure_ascii=True,
            separators=(",", ":")).encode("ascii")
        result[table] = (len(rows), hashlib.sha256(payload).hexdigest())
    return result


def role_inventory(db: psycopg.Connection) -> list[tuple]:
    rows = db.execute("SELECT rolname,rolcanlogin,rolinherit,rolsuper,"
        "rolcreatedb,rolcreaterole,rolreplication,rolbypassrls "
        "FROM pg_catalog.pg_roles WHERE rolname LIKE 'teruisi_%' "
        "ORDER BY rolname").fetchall()
    if not PROTECTED_ROLES <= {row[0] for row in rows}:
        raise AssertionError("protected role inventory incomplete")
    for name, can_login, inherit, superuser, createdb, createrole, replication, bypass in rows:
        if not re.fullmatch(r"teruisi_[a-z0-9_]{1,64}", name):
            raise AssertionError("unapproved test role name")
        if superuser or createdb or createrole or replication or bypass:
            raise AssertionError("unexpected powerful test role")
        if name in PROTECTED_ROLES and (can_login or inherit):
            raise AssertionError("protected role became login or inheriting")
    members = db.execute("SELECT count(*) FROM pg_catalog.pg_auth_members m "
        "JOIN pg_catalog.pg_roles a ON a.oid=m.roleid "
        "JOIN pg_catalog.pg_roles b ON b.oid=m.member "
        "WHERE a.rolname LIKE 'teruisi_%' OR b.rolname LIKE 'teruisi_%'").fetchone()
    if members != (0,):
        raise AssertionError("test role membership requires separate review")
    return rows


class _RollbackProbe(Exception):
    pass


def assert_catalog_rejects(db: psycopg.Connection, mutation: str) -> None:
    """Prove isolated target drift is rejected, then roll it back."""
    try:
        with db.transaction():
            db.execute(mutation)
            try:
                verify_catalog(db)
            except (AssertionError, RuntimeError, ValueError):
                pass
            else:
                raise AssertionError("protected catalog accepted deliberately mutated target")
            raise _RollbackProbe()
    except _RollbackProbe:
        verify_catalog(db)


source_port = int(database["PORT"])
source_password = str(database["PASSWORD"])
with open_db(source_port, source_password) as source:
    verify_catalog(source)
    if source.execute("SELECT count(*) FROM " + key_table).fetchone() != (0,):
        raise AssertionError("synthetic source key table must start empty")
    source.execute("INSERT INTO " + key_table + " "
        "(key_id,secret,status,created_at) VALUES "
        "('isolated_synthetic_key',%s,'active',now())", [secrets.token_bytes(32)])
    verify_catalog(source)
    before_rows = protected_rows(source)
    if before_rows[key_table.removeprefix("public.")][0] != 1:
        raise AssertionError("synthetic private key fixture missing")
    source_roles = role_inventory(source)
    archive_context = hashlib.sha256(json.dumps({
        "migrations": MIGRATIONS,
        "protectedRows": before_rows,
        "roles": source_roles,
    }, ensure_ascii=True, sort_keys=True, separators=(",", ":")).encode(
        "ascii")).digest()

target_port = None
for candidate_port in range(55440, 56000):
    if candidate_port == source_port:
        continue
    try:
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", candidate_port))
        target_port = candidate_port
        break
    except OSError:
        pass
if target_port is None:
    raise RuntimeError("no free isolated restore port")

target_root = folder / "protected-cross-cluster"
if target_root.exists() or target_root.parent.resolve() != folder:
    raise RuntimeError("cross-cluster target already exists or escaped run root")
target_root.mkdir()
data = target_root / "data"
password_file = target_root / ".synthetic-password.tmp"
target_password = secrets.token_hex(32)
password_file.write_text(target_password + "\n", encoding="ascii")
os.chmod(password_file, 0o600)
source_env = {**os.environ, "PGHOST": "127.0.0.1", "PGPORT": str(source_port),
    "PGUSER": "ai_rehearsal_admin", "PGPASSWORD": source_password,
    "PGDATABASE": "teruisi_ai_rehearsal"}
target_env = {**source_env, "PGPORT": str(target_port),
    "PGPASSWORD": target_password}
started = False
try:
    run([BIN / "initdb.exe", "-D", data, "-U", "ai_rehearsal_admin",
        "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C",
        "--pwfile", password_file], env=target_env)
    password_file.unlink()
    with (data / "postgresql.conf").open("a", encoding="utf-8") as config:
        config.write("\nlisten_addresses='127.0.0.1'\n"
            f"port={target_port}\nmax_connections=32\n")
    run([BIN / "pg_ctl.exe", "-D", data, "-l", target_root / "postgres.log",
        "-w", "-t", "30", "start"], env=target_env, timeout=60)
    started = True
    with psycopg.connect(host="127.0.0.1", port=target_port,
            dbname="postgres", user="ai_rehearsal_admin",
            password=target_password, autocommit=True) as admin:
        for name, can_login, inherit, *_ in source_roles:
            admin.execute(sql.SQL("CREATE ROLE {} {} {} NOSUPERUSER NOCREATEDB "
                "NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD NULL").format(
                sql.Identifier(name),
                sql.SQL("LOGIN" if can_login else "NOLOGIN"),
                sql.SQL("INHERIT" if inherit else "NOINHERIT")))
    # The synthetic key exists only in this process. No custom dump is ever
    # written as a plaintext file; the formal backup/restore path stays closed.
    plaintext = run_sensitive([BIN / "pg_dump.exe", "--format=custom",
        "teruisi_ai_rehearsal"], env=source_env)
    if not 5 <= len(plaintext) <= MAX_PLAINTEXT_BYTES:
        raise AssertionError("synthetic archive exceeded the bounded test format")
    test_key = secrets.token_bytes(32)
    archive = target_root / "synthetic-source.dump.aead"
    archive.write_bytes(encrypt_synthetic_archive(
        plaintext, test_key, archive_context))
    os.chmod(archive, 0o600)
    del plaintext
    encrypted = archive.read_bytes()
    if encrypted.startswith(b"PGDMP") or any(target_root.glob("*.dump")):
        raise AssertionError("synthetic protected archive persisted in plaintext")
    for damaged_key, damaged_archive in (
            (secrets.token_bytes(32), encrypted),
            (test_key, encrypted[:-1]),
            (test_key, encrypted[:-17] + bytes((encrypted[-17] ^ 1,))
             + encrypted[-16:])):
        try:
            decrypt_synthetic_archive(damaged_archive, damaged_key,
                archive_context)
        except ValueError:
            pass
        else:
            raise AssertionError("tampered synthetic archive authenticated")
    plaintext = decrypt_synthetic_archive(encrypted, test_key, archive_context)
    toc = run_sensitive([BIN / "pg_restore.exe", "--list"],
        env=target_env, input_bytes=plaintext)
    if b"protected_business_" not in toc or b"ACL" not in toc:
        raise AssertionError("synthetic archive TOC lacks protected owner/ACL entries")
    run([BIN / "createdb.exe", "teruisi_ai_rehearsal"], env=target_env)
    # Exact opposite of the formal restore's current owner/ACL suppression.
    run_sensitive([BIN / "pg_restore.exe", "--single-transaction",
        "--exit-on-error", "--dbname", "teruisi_ai_rehearsal"],
        env=target_env, input_bytes=plaintext)
    del plaintext
    with open_db(target_port, target_password) as target:
        verify_catalog(target)
        after_rows = protected_rows(target)
        target_roles = role_inventory(target)
        assert_catalog_rejects(target, "ALTER TABLE " + key_table +
            " OWNER TO ai_rehearsal_admin")
        assert_catalog_rejects(target, "REVOKE EXECUTE ON FUNCTION " +
            modules[0].VERIFY_SIGNATURE + " FROM " + modules[0].PUBLISHER)
    if before_rows != after_rows or source_roles != target_roles:
        raise AssertionError("protected rows or global role attributes differ")
    result = {"status": "passed", "scope": "isolated synthetic cross-cluster only",
        "protectedMigrationsVerified": list(MIGRATIONS),
        "protectedRoles": len(PROTECTED_ROLES),
        "protectedTables": len(before_rows),
        "syntheticVerifierKeyRows": 1, "ownersAndAclPreserved": True,
        "ownerAndAclTamperRejected": True,
        "ordinaryAiKeyReadDenied": True, "productionWrites": False,
        "formalBackupPathVerified": False,
        "privilegedMigrationPathVerified": False,
        "archiveEncryptionVerified": True,
        "archiveCipher": "AES-256-GCM-synthetic-only",
        "encryptedArchiveSha256": hashlib.sha256(encrypted).hexdigest(),
        "plaintextDumpFiles": 0,
        "wrongKeyTamperAndTruncationRejected": True}
    (target_root / "evidence.json").write_text(json.dumps(result,
        ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))
finally:
    if started:
        run([BIN / "pg_ctl.exe", "-D", data, "-m", "fast", "-w",
            "-t", "60", "stop"], env=target_env, timeout=90)
    password_file.unlink(missing_ok=True)
