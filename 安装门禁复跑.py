"""Read-only: find which database gate the failed Sales154 Install step tripped.

Install died inside install_schema before writing install-intent.json, so the
database never changed. The gate's own error text was reduced to a sha256 by the
release harness, so this replays the same reads and prints the reason in full.

Reads the gate bytes from the release source tree, which are byte-identical to
the ones that actually ran (verified). The rolled-back app/tools no longer has
them at all.

Skips parent_proof on purpose: it compares against app.previous/deployment.json,
which the rollback swapped, so it would now report a mismatch caused by the
recovery rather than by the original failure.

Connects as teruisi_sales_owner with default_transaction_read_only=on, so
PostgreSQL itself refuses any write. Publishes nothing, writes no runtime file,
never prints the password.

Run with the runtime venv python (the system one has no psycopg):

  D:\\teruisi-runtime\\django-sales\\venv\\Scripts\\python.exe -I 安装门禁复跑.py
"""
import os
import subprocess
import sys
import traceback

RUNTIME = r"D:\teruisi-runtime\django-sales"
SOURCE = r"D:\codex-isolated\main-release-packages\930509cc3918-bfb340f8-7948e85c\source"
GATE_TOOLS = os.path.join(SOURCE, "tools")
SECRETS = os.path.join(RUNTIME, "secrets", "credentials.dpapi.json")
OPERATION = "feae967b0bed4d8ab14bcb8d8cc3f9d4"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "install-gate-output.txt")

lines = []


def log(text):
    print(text)
    lines.append(str(text))


def owner_password():
    """Decrypt only the owner password via DPAPI; never logged."""
    script = (
        "$ErrorActionPreference='Stop';"
        "$c=Get-Content -LiteralPath '" + SECRETS + "' -Raw -Encoding UTF8 | ConvertFrom-Json;"
        "$s=ConvertTo-SecureString $c.databaseOwner;"
        "[System.Management.Automation.PSCredential]::new('x',$s).GetNetworkCredential().Password"
    )
    powershell = os.path.join(os.environ["SystemRoot"], "System32",
                              "WindowsPowerShell", "v1.0", "powershell.exe")
    result = subprocess.run([powershell, "-NoProfile", "-NonInteractive", "-Command", script],
                            capture_output=True, encoding="utf-8")
    if result.returncode != 0:
        log("DPAPI decrypt failed: " + (result.stderr or "").strip()[:400])
        return None
    return result.stdout.strip()


def main():
    log("=== Sales154 install gate replay (read-only) ===")
    log("gate bytes from: " + GATE_TOOLS)
    sys.path.insert(0, GATE_TOOLS)

    folder = os.path.join(RUNTIME, "sales-preflight-index-additions", OPERATION)
    import sales_preflight_addition as gate

    log("\n--- replay guard files (install refuses a replay if either exists) ---")
    for path in (os.path.join(folder, "install-intent.json"),
                 os.path.join(RUNTIME, gate.ACTIVE)):
        log(("EXISTS  " if os.path.exists(path) else "absent  ") + path)

    password = owner_password()
    if not password:
        return 2

    import psycopg
    conninfo = psycopg.conninfo.make_conninfo(
        host="127.0.0.1", port=5432, dbname="teruisi_sales",
        user="teruisi_sales_owner", password=password,
        application_name="teruisi_install_gate_readonly",
        options="-c default_transaction_read_only=on -c statement_timeout=180000",
    )
    del password

    failures = 0
    with psycopg.connect(conninfo, autocommit=False) as connection:
        with connection.cursor() as cursor:
            log("\n--- database identity ---")
            cursor.execute("SELECT current_database(),current_user,"
                           "host(inet_server_addr()),inet_server_port()")
            row = cursor.fetchone()
            log("actual  : %r" % (row,))
            log("expected: ('teruisi_sales', 'teruisi_sales_owner', '127.0.0.1', 5432)")
            if row != ("teruisi_sales", "teruisi_sales_owner", "127.0.0.1", 5432):
                log(">>> identity differs; the real step ran as the same role, so"
                    " treat this as a probe artefact, not the original failure")

            # The prime suspect: the 11-layer catalogue sweep that also blocks
            # the PG backup. Its ValueError text is what the harness hashed away.
            log("\n--- verify_receipt_generation (the catalogue sweep) ---")
            from postgres_no_key_backup import verify_receipt_generation
            try:
                log("OK: generation=%s" % verify_receipt_generation(cursor))
            except Exception as error:
                log(">>> RAISED %s: %s" % (type(error).__name__, error))
                log(traceback.format_exc().strip())
                failures += 1

            log("\n--- preservation snapshot (rows/permissions the intent pins) ---")
            from sales_preflight_catalog import preservation
            try:
                state = preservation(cursor)
                log("rows=%s" % state.get("rows"))
            except Exception as error:
                log(">>> RAISED %s: %s" % (type(error).__name__, error))
                log(traceback.format_exc().strip())
                failures += 1

            log("\n--- verify_index (expects the index absent at generation 153) ---")
            from sales_preflight_catalog import verify_index
            try:
                verify_index(cursor, installed=False)
                log("OK: index absent as a pre-install state requires")
            except Exception as error:
                log(">>> RAISED %s: %s" % (type(error).__name__, error))
                failures += 1
        connection.rollback()

    log("\nreplayed gates that raised: %d" % failures)
    if not failures:
        log("all replayed gates pass now, so the original failure was either"
            " transient or in a check this probe skipped")
    return 1 if failures else 0


try:
    code = main()
except Exception:
    log("\n=== PROBE FAILED ===")
    log(traceback.format_exc())
    code = 3
finally:
    with open(OUT, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")
    print("\noutput saved: " + OUT)
    try:
        input("Press Enter to close")
    except EOFError:
        pass
sys.exit(code)
