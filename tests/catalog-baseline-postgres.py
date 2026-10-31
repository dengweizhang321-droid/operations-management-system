"""Private PG17 collector regression: NULL ACL and explicit ACL, no app/database data.

Requires an explicit PostgreSQL binary directory. Owns one temporary cluster,
never loads project settings or reads production credentials. Not part of CI.
"""
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
EXPECTED = {"SELECT", "UPDATE", "USAGE"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pg-bin", type=Path, required=True)
    args = parser.parse_args()
    # Refuse production checkout/runtime as the scratch owner, even if invoked
    # manually. Merely reading installed immutable PostgreSQL executables is OK.
    forbidden = (Path("D:/\u8fd0\u8425\u7ba1\u7406\u7cfb\u7edf").resolve(), Path("D:/teruisi-runtime").resolve())
    if any(ROOT == path or path in ROOT.parents for path in forbidden):
        raise RuntimeError("Require isolated source worktree")
    from psycopg import connect
    bins = args.pg_bin.resolve()
    suffix = ".exe" if os.name == "nt" else ""
    for name in ("initdb", "pg_ctl"):
        if not (bins / (name + suffix)).is_file():
            raise RuntimeError("Missing explicit PostgreSQL binary")
    scratch = ROOT / ".runtime/catalog-pg"
    scratch.mkdir(parents=True, exist_ok=True)
    directory = Path(tempfile.mkdtemp(prefix="private-", dir=scratch))
    if os.name == "nt":
        # initdb drops the administrator group: grant only the current Windows
        # user on this newly owned private directory, never on runtime/binaries.
        import re
        shell = Path(os.environ["SystemRoot"]) / "System32/WindowsPowerShell/v1.0/powershell.exe"
        sid = subprocess.check_output([str(shell), "-NoProfile", "-NonInteractive", "-Command",
                                       "[Security.Principal.WindowsIdentity]::GetCurrent().User.Value"],
                                      timeout=15, creationflags=subprocess.CREATE_NO_WINDOW).decode().strip()
        if not re.fullmatch(r"S-1-[0-9-]+", sid):
            raise RuntimeError("Private user SID unavailable")
        subprocess.run(["icacls", str(directory), "/grant", "*" + sid + ":(OI)(CI)F"],
                       check=True, capture_output=True, timeout=15, creationflags=subprocess.CREATE_NO_WINDOW)
    port = None
    for candidate in range(55590, 55600):
        try:
            with socket.socket() as probe:
                probe.bind(("127.0.0.1", candidate))
            port = candidate
            break
        except OSError:
            pass
    if port is None:
        raise RuntimeError("No private collector-test port")
    password = secrets.token_hex(24)
    password_file = directory / "password"
    password_file.write_text(password, encoding="ascii")
    environment = {k: v for k, v in os.environ.items() if k.upper() in
                   {"PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA"}}
    environment["PGCONNECT_TIMEOUT"] = "5"
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0

    def command(name, *argv):
        # A Windows postgres descendant can retain a PIPE after pg_ctl exits.
        # Use private file handles so waiting observes the direct process exit.
        log = directory / (name + ("-" + str(argv[-1]) if name == "pg_ctl" else "") + ".log")
        with log.open("xb") as output:
            completed = subprocess.run([str(bins / (name + suffix)), *map(str, argv)], cwd=directory,
                                       env=environment, stdin=subprocess.DEVNULL, stdout=output, stderr=output,
                                       timeout=45, creationflags=flags)
        if completed.returncode:
            raise RuntimeError(name + " failed; private diagnostic: " + str(log))

    result = {"status": "failed", "scope": "synthetic-catalog-collector-only", "productionTouched": False,
              "businessValidationPerformed": False, "port": port, "cases": [], "sourceFiles": {},
              "executionScriptSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    started = False
    try:
        command("initdb", "-D", directory / "data", "-U", "catalog_fixture", "--auth=scram-sha-256",
                "--encoding=UTF8", "--locale=C", "--pwfile", password_file)
        with (directory / "data/postgresql.conf").open("a", encoding="ascii") as stream:
            stream.write("\nlisten_addresses='127.0.0.1'\nport=" + str(port) + "\nmax_connections=10\nshared_buffers=16MB\n")
        started = True
        command("pg_ctl", "-D", directory / "data", "-l", directory / "postgres.log", "-w", "-t", "30", "start")
        with connect(host="127.0.0.1", port=port, dbname="postgres", user="catalog_fixture",
                     password=password, connect_timeout=5, options="-c statement_timeout=5000") as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT current_user,host(inet_server_addr()),inet_server_port(),current_setting('server_version_num')::int")
                identity = cursor.fetchone()
                if identity[:3] != ("catalog_fixture", "127.0.0.1", port) or identity[3] // 10000 != 17:
                    raise RuntimeError("Unexpected private PG17 identity: " + repr(identity))
                result["postgresVersionNum"] = identity[3]
                cursor.execute("CREATE ROLE catalog_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE")
                cursor.execute("GRANT USAGE,CREATE ON SCHEMA public TO catalog_owner")
                cursor.execute("SET ROLE catalog_owner")
                for stem, table in (("tmall_warehouse", "inventory_tmall_warehouse_facts"),
                                    ("workflow_automation", "automation_module_results")):
                    path = ROOT / ("tools/" + stem + "_catalog.py")
                    raw = path.read_bytes()
                    result["sourceFiles"][path.relative_to(ROOT).as_posix()] = hashlib.sha256(raw).hexdigest()
                    tree = ast.parse(raw)
                    node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "sequence_catalog")
                    env = {"SEQUENCE_TABLE": table}
                    exec(compile(ast.Module(body=[node], type_ignores=[]), str(path), "exec"), env)
                    cursor.execute('CREATE TABLE public."' + table + '" (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY)')
                    for explicit in (False, True):
                        sequence = "public." + table + "_id_seq"
                        if explicit:
                            cursor.execute('GRANT ALL ON SEQUENCE ' + sequence + ' TO catalog_owner')
                        cursor.execute("SELECT relacl IS NULL,relkind FROM pg_class WHERE oid=%s::regclass", [sequence])
                        if cursor.fetchone() != (not explicit, "S"):
                            raise RuntimeError("Fixture ACL storage branch differs")
                        actual = env["sequence_catalog"](cursor)
                        privileges = {row[3] for row in actual["acl"] if row[5] == "OWNER"}
                        # An independent effective-permission inquiry, not the collector.
                        cursor.execute("SELECT has_sequence_privilege(current_user,%s,'SELECT'),"
                                       "has_sequence_privilege(current_user,%s,'UPDATE'),"
                                       "has_sequence_privilege(current_user,%s,'USAGE')", [sequence] * 3)
                        if privileges != EXPECTED or cursor.fetchone() != (True, True, True):
                            raise RuntimeError("Collector loses default owner privileges")
                        result["cases"].append({"catalog": stem, "explicitAcl": explicit,
                                                "ownerPrivileges": sorted(privileges), "status": "passed"})
                cursor.execute("SELECT privilege_type FROM aclexplode(acldefault('S',(SELECT oid FROM pg_roles WHERE rolname=current_user)))")
                if {row[0] for row in cursor.fetchall()} != {"USAGE"}:
                    raise RuntimeError("Historical wrong-type counterexample differs")
                result["historicalWrongTypeOwnerPrivileges"] = ["USAGE"]
        result["status"] = "passed"
    finally:
        try:
            if started and (directory / "data/postmaster.pid").exists():
                command("pg_ctl", "-D", directory / "data", "-m", "fast", "-w", "-t", "30", "stop")
        finally:
            # Preserve a stop failure while removing the temporary credential.
            password_file.unlink(missing_ok=True)
    result["privateClusterStopped"] = True
    result["passwordFileRemoved"] = not password_file.exists()
    print(json.dumps(result, ensure_ascii=True, indent=2))


if __name__ == "__main__":
    main()
