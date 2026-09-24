"""Launch an isolated PostgreSQL cluster; production ports/data are never used."""

from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--all-backend-tests", action="store_true")
parser.add_argument("--tests-only", action="store_true", help="Run AI tests in an isolated cluster without historical migration rehearsal")
parser.add_argument("--test-label", action="append", default=[], help="Explicit Django test labels; only with --tests-only, without upgrade flags")
parser.add_argument("--test-timeout-seconds", type=int, default=300,
                    help="Bounded Django test duration for large isolated suites (60-1800)")
parser.add_argument("--test-verbosity", type=int, choices=(1, 2), default=1)
parser.add_argument("--generation-upgrade", action="store_true", help="Rehearse 0008 to 0009 in the fresh isolated database before testing")
parser.add_argument("--prompt-settings-upgrade", action="store_true", help="Rehearse 0010 to 0011, roles and backup restoration in the fresh isolated database")
parser.add_argument("--report-library-upgrade", action="store_true")
parser.add_argument("--business-evidence-upgrade", action="store_true")
parser.add_argument("--market-options-upgrade", action="store_true")
parser.add_argument("--sales-options-upgrade", action="store_true")
parser.add_argument("--business-file-opc-upgrade", action="store_true")
parser.add_argument("--business-promotion-profile-upgrade", action="store_true")
parser.add_argument("--business-promotion-file-guard-upgrade", action="store_true")
parser.add_argument("--business-finance-v3-upgrade", action="store_true")
parser.add_argument("--business-promotion-file-ready-upgrade", action="store_true")
parser.add_argument("--business-finance-v3-pages-upgrade", action="store_true")
parser.add_argument("--business-v3-daily-pages-upgrade", action="store_true")
parser.add_argument("--business-v3-tool-receipts-upgrade", action="store_true")
parser.add_argument("--business-v3-parent-seal-upgrade", action="store_true")
parser.add_argument("--business-v3-report-intent-upgrade", action="store_true")
parser.add_argument("--business-v4-ledger-upgrade", action="store_true")
parser.add_argument("--business-v4-validation-upgrade", action="store_true")
parser.add_argument("--business-v4-seal-admission-upgrade", action="store_true")
parser.add_argument("--business-v4-seal-writer-upgrade", action="store_true")
parser.add_argument("--business-v4-sealer-ledger-read-upgrade", action="store_true")
parser.add_argument("--business-v4-sealer-narrow-stream-upgrade", action="store_true")
parser.add_argument("--business-v4-seal-ticket-upgrade", action="store_true")
parser.add_argument("--business-v4-claimed-read-upgrade", action="store_true")
parser.add_argument("--business-v4-seal-consumption-upgrade", action="store_true")
parser.add_argument("--business-market-v2-parked-upgrade", action="store_true")
parser.add_argument("--business-market-v2-material-upgrade", action="store_true")
parser.add_argument("--business-promotion-trial-file-upgrade", action="store_true")
parser.add_argument("--business-v4-replay-progress-upgrade", action="store_true")
parser.add_argument("--business-v4-finance-replay-progress-upgrade", action="store_true")
parser.add_argument("--business-v4-sealer-source-bridge-upgrade", action="store_true")
parser.add_argument("--business-v4-replay-read-cast-upgrade", action="store_true")
parser.add_argument("--business-v4-prior-claim-qualification-upgrade", action="store_true")
parser.add_argument("--business-v4-commit-consumption-upgrade", action="store_true")
parser.add_argument("--business-market-v2-admitted-paused-upgrade", action="store_true")
parser.add_argument("--source-revision-guards-upgrade", action="store_true")
parser.add_argument("--upgrade-only", action="store_true", help="Run the full selected upgrade/restore rehearsal; run tests separately with --tests-only")
parser.add_argument("--port", type=int, default=55443, help="Independent rehearsal port (55440-55999)")
arguments = parser.parse_args()
if arguments.business_market_v2_admitted_paused_upgrade:
    if arguments.business_v4_commit_consumption_upgrade:
        parser.error("Choose only one fresh database upgrade rehearsal")
    # 0053 starts only from the independently restored 0052 function/catalog seed.
    arguments.business_v4_commit_consumption_upgrade = True
if arguments.business_v4_commit_consumption_upgrade:
    if arguments.business_v4_prior_claim_qualification_upgrade:
        parser.error("Choose only one fresh database upgrade rehearsal")
    # 0052 installs only after the exact 0051 prior-claim writer seed.
    arguments.business_v4_prior_claim_qualification_upgrade = True
if arguments.business_v4_prior_claim_qualification_upgrade:
    if arguments.business_v4_replay_read_cast_upgrade:
        parser.error("Choose only one fresh database upgrade rehearsal")
    # The 0051 writer fix requires the exact 0050 read-cast seed.
    arguments.business_v4_replay_read_cast_upgrade = True
if arguments.business_v4_replay_read_cast_upgrade:
    if arguments.business_v4_sealer_source_bridge_upgrade:
        parser.error("Choose only one fresh database upgrade rehearsal")
    # The 0050 reader fix requires the exact 0049 source bridge seed.
    arguments.business_v4_sealer_source_bridge_upgrade = True
if arguments.business_v4_sealer_source_bridge_upgrade:
    if arguments.business_v4_finance_replay_progress_upgrade:
        parser.error("Choose only one fresh database upgrade rehearsal")
    arguments.business_v4_finance_replay_progress_upgrade = True
if arguments.business_v4_finance_replay_progress_upgrade:
    if arguments.business_v4_replay_progress_upgrade:
        parser.error("Choose only one fresh database upgrade rehearsal")
    arguments.business_v4_replay_progress_upgrade = True
if arguments.business_v4_replay_progress_upgrade:
    if arguments.business_promotion_trial_file_upgrade:
        parser.error("Choose only one fresh database upgrade rehearsal")
    # 0047 replays the complete 0046 predecessor before adding the closed ledger.
    arguments.business_promotion_trial_file_upgrade = True
if arguments.business_promotion_trial_file_upgrade:
    if arguments.business_market_v2_material_upgrade:
        parser.error("Choose only one fresh database upgrade rehearsal")
    # Renderer 9 must rehearse the complete 0045 predecessor first.
    arguments.business_market_v2_material_upgrade = True
if arguments.business_market_v2_material_upgrade:
    if arguments.business_market_v2_parked_upgrade:
        parser.error("Choose only one fresh database upgrade rehearsal")
    # The 0045 exercise must preserve and verify the entire 0044 lineage.
    arguments.business_market_v2_parked_upgrade = True
if arguments.business_market_v2_parked_upgrade:
    if arguments.business_v4_seal_consumption_upgrade:
        parser.error("Choose only one fresh database upgrade rehearsal")
    # The 0044 exercise replays the complete 0043 predecessor chain first.
    arguments.business_v4_seal_consumption_upgrade = True
if arguments.business_v4_seal_consumption_upgrade:
    if arguments.business_v4_claimed_read_upgrade:
        parser.error("Choose only one fresh database upgrade rehearsal")
    # The 0043 exercise must replay every frozen predecessor through 0042.
    arguments.business_v4_claimed_read_upgrade = True
if not 60 <= arguments.test_timeout_seconds <= 1800:
    parser.error("--test-timeout-seconds must stay within 60-1800")
if arguments.upgrade_only and (arguments.tests_only or arguments.test_label or arguments.all_backend_tests
        or not any((arguments.generation_upgrade, arguments.prompt_settings_upgrade, arguments.report_library_upgrade, arguments.business_evidence_upgrade, arguments.market_options_upgrade, arguments.sales_options_upgrade, arguments.business_file_opc_upgrade, arguments.business_promotion_profile_upgrade, arguments.business_promotion_file_guard_upgrade, arguments.business_finance_v3_upgrade, arguments.business_promotion_file_ready_upgrade, arguments.business_finance_v3_pages_upgrade, arguments.business_v3_daily_pages_upgrade, arguments.business_v3_tool_receipts_upgrade, arguments.business_v3_parent_seal_upgrade, arguments.business_v3_report_intent_upgrade, arguments.business_v4_ledger_upgrade, arguments.business_v4_validation_upgrade, arguments.business_v4_seal_admission_upgrade, arguments.business_v4_seal_writer_upgrade, arguments.business_v4_sealer_ledger_read_upgrade, arguments.business_v4_sealer_narrow_stream_upgrade, arguments.business_v4_seal_ticket_upgrade, arguments.business_v4_claimed_read_upgrade, arguments.source_revision_guards_upgrade))):
    parser.error("--upgrade-only requires one full upgrade rehearsal and cannot include test-selection options")
if arguments.test_label and (not arguments.tests_only or arguments.generation_upgrade or arguments.prompt_settings_upgrade or arguments.report_library_upgrade or arguments.business_evidence_upgrade or arguments.market_options_upgrade or arguments.sales_options_upgrade or arguments.business_file_opc_upgrade or arguments.business_promotion_profile_upgrade or arguments.business_promotion_file_guard_upgrade or arguments.business_finance_v3_pages_upgrade or arguments.business_v3_daily_pages_upgrade or arguments.business_v3_tool_receipts_upgrade or arguments.business_v3_parent_seal_upgrade or arguments.business_v3_report_intent_upgrade or arguments.business_v4_ledger_upgrade or arguments.business_v4_validation_upgrade or arguments.business_v4_seal_admission_upgrade or arguments.business_v4_seal_writer_upgrade or arguments.business_v4_sealer_ledger_read_upgrade or arguments.business_v4_sealer_narrow_stream_upgrade or arguments.business_v4_seal_ticket_upgrade or arguments.business_v4_claimed_read_upgrade or arguments.source_revision_guards_upgrade):
    parser.error("Explicit test labels require --tests-only and cannot narrow upgrade verification")
if sum([arguments.generation_upgrade, arguments.prompt_settings_upgrade, arguments.report_library_upgrade, arguments.business_evidence_upgrade, arguments.market_options_upgrade, arguments.business_file_opc_upgrade, arguments.business_promotion_profile_upgrade, arguments.business_promotion_file_ready_upgrade, arguments.business_finance_v3_pages_upgrade, arguments.business_v3_daily_pages_upgrade, arguments.business_v3_tool_receipts_upgrade, arguments.business_v3_parent_seal_upgrade, arguments.business_v3_report_intent_upgrade, arguments.business_v4_ledger_upgrade, arguments.business_v4_validation_upgrade, arguments.business_v4_seal_admission_upgrade, arguments.business_v4_seal_writer_upgrade, arguments.business_v4_sealer_ledger_read_upgrade, arguments.business_v4_sealer_narrow_stream_upgrade, arguments.business_v4_seal_ticket_upgrade, arguments.business_v4_claimed_read_upgrade, arguments.source_revision_guards_upgrade]) > 1:
    parser.error("Choose only one fresh database upgrade rehearsal")
BIN = Path(r"D:\teruisi-runtime\django-sales\postgresql-17.11\bin")
PORT = arguments.port
if not 55440 <= PORT <= 55999:
    raise RuntimeError("Rehearsal port must stay in the isolated range")
RUN = ROOT / ".runtime" / ("ai-pg-" + secrets.token_hex(6))
RUN.mkdir(parents=True)
RUN = RUN.resolve()
if (
    not RUN.is_relative_to((ROOT / ".runtime").resolve())
    or ROOT.resolve() == Path(r"D:\运营管理系统").resolve()
):
    raise RuntimeError("This rehearsal requires an isolated worktree.")
with socket.socket() as probe:
    probe.bind(("127.0.0.1", PORT))
password = secrets.token_hex(32)
password_file = RUN / "password.txt"
password_file.write_text(password, encoding="ascii")
os.chmod(password_file, 0o600)
environment = {
    **os.environ,
    "PGPASSWORD": password,
    "PGHOST": "127.0.0.1",
    "PGPORT": str(PORT),
    "PGUSER": "ai_rehearsal_admin",
    "PGDATABASE": "postgres",
}


def run(arguments, timeout=300, env=None):
    # pg_ctl's descendant cmd.exe can retain PIPE handles after pg_ctl exits.
    # File handles keep subprocess.wait bounded without waiting for child EOF.
    output = RUN / ("command-" + secrets.token_hex(4) + ".log")
    with output.open("wb") as stream:
        result = subprocess.run(
            [str(v) for v in arguments],
            env=env or environment,
            cwd=ROOT,
            stdout=stream,
            stderr=stream,
            timeout=timeout,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
    data = output.read_bytes()
    if result.returncode:
        # All subprocess arguments are fixed paths/options. Credentials stay in
        # environment and a private temporary file; no URL is printed.
        (RUN / "failure.log").write_bytes(data)
        raise RuntimeError("Isolated command failed; see " + str(RUN / "failure.log"))
    return data.decode("utf-8", errors="replace")


started = False
try:
    run(
        [
            BIN / "initdb.exe",
            "-D",
            RUN / "data",
            "-U",
            "ai_rehearsal_admin",
            "--auth=scram-sha-256",
            "--encoding=UTF8",
            "--locale=C",
            "--pwfile",
            password_file,
        ]
    )
    with (RUN / "data/postgresql.conf").open("a", encoding="utf-8") as config:
        config.write(
            f"\nlisten_addresses='127.0.0.1'\nport={PORT}\nmax_connections=128\n"
        )
    run(
        [
            BIN / "pg_ctl.exe",
            "-D",
            RUN / "data",
            "-l",
            RUN / "postgres.log",
            "-w",
            "-t",
            "30",
            "start",
        ],
        60,
    )
    started = True
    run([BIN / "createdb.exe", "teruisi_ai_rehearsal"])
    # 0038 deliberately never creates database roles: production must
    # pre-provision this exact, non-login identity through the protected
    # controller. Only this verified isolated cluster gets a synthetic role.
    run([BIN / "psql.exe", "-d", "teruisi_ai_rehearsal", "-v", "ON_ERROR_STOP=1",
        "-c", "CREATE ROLE teruisi_ai_seal_writer NOLOGIN NOINHERIT "
        "NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS"])
    django_env = {
        **environment,
        "DJANGO_SECRET_KEY": secrets.token_hex(32),
        "TERUISI_DJANGO_INTERNAL_SECRET": secrets.token_hex(32),
        "TERUISI_DJANGO_DATABASE_URL": f"postgresql://ai_rehearsal_admin:{quote(password)}@127.0.0.1:{PORT}/teruisi_ai_rehearsal",
        "TERUISI_DJANGO_ENVIRONMENT": "test",
        "TERUISI_DJANGO_PROCESS_ROLE": "development",
        "DJANGO_SETTINGS_MODULE": "teruisi_backend.settings",
        "PYTHONUTF8": "1",
        "TERUISI_AI_REHEARSAL_PORT": str(PORT),
    }
    print(
        json.dumps(
            {
                "stage": "isolated_cluster_started",
                "port": PORT,
                "productionWrites": False,
            }
        ),
        flush=True,
    )
    if arguments.generation_upgrade:
        upgrade = run([sys.executable, ROOT / "tools/ai-generation-upgrade-rehearsal.py"], env=django_env)
        (RUN / "generation-upgrade.json").write_text(upgrade, encoding="utf-8")
        print(upgrade.strip(), flush=True)
    if arguments.prompt_settings_upgrade:
        upgrade = run([sys.executable, ROOT / "tools/ai-prompt-settings-upgrade-rehearsal.py", "--run-root", RUN], env=django_env)
        (RUN / "prompt-settings-upgrade.json").write_text(upgrade, encoding="utf-8")
        print(upgrade.strip(), flush=True)
    if arguments.report_library_upgrade:
        upgrade = run([sys.executable, ROOT / "tools/ai-report-library-upgrade-rehearsal.py", "--run-root", RUN], env=django_env)
        (RUN / "report-library-upgrade.json").write_text(upgrade, encoding="utf-8")
        print(upgrade.strip(), flush=True)
    if arguments.business_evidence_upgrade:
        upgrade = run([sys.executable, ROOT / "tools/ai-business-evidence-upgrade-rehearsal.py", "--run-root", RUN], env=django_env)
        (RUN / "business-evidence-upgrade.json").write_text(upgrade, encoding="utf-8")
        print(upgrade.strip(), flush=True)
    if arguments.market_options_upgrade:
        upgrade = run([sys.executable, ROOT / "tools/market-options-upgrade-rehearsal.py", "--run-root", RUN], env=django_env)
        (RUN / "market-options-upgrade.json").write_text(upgrade, encoding="utf-8")
        print(upgrade.strip(), flush=True)
    if arguments.sales_options_upgrade:
        upgrade = run([sys.executable, ROOT / "tools/sales-options-upgrade-rehearsal.py", "--run-root", RUN], env=django_env)
        (RUN / "sales-options-upgrade.json").write_text(upgrade, encoding="utf-8")
        print(upgrade.strip(), flush=True)
    if arguments.business_file_opc_upgrade:
        upgrade = run([sys.executable, ROOT / "tools/business-file-opc-upgrade-rehearsal.py", "--run-root", RUN], env=django_env)
        (RUN / "business-file-opc-upgrade.json").write_text(upgrade, encoding="utf-8")
        print(upgrade.strip(), flush=True)
    if arguments.business_promotion_profile_upgrade:
        upgrade = run([sys.executable, ROOT / "tools/business-promotion-profile-upgrade-rehearsal.py", "--run-root", RUN], env=django_env)
        (RUN / "business-promotion-profile-upgrade.json").write_text(upgrade, encoding="utf-8")
        print(upgrade.strip(), flush=True)
    if arguments.business_promotion_file_guard_upgrade:
        predecessor = run([sys.executable, ROOT / "tools/business-promotion-profile-upgrade-rehearsal.py", "--run-root", RUN], env=django_env)
        (RUN / "business-promotion-profile-upgrade.json").write_text(predecessor, encoding="utf-8")
        upgrade = run([sys.executable, ROOT / "tools/business-promotion-file-guard-upgrade-rehearsal.py", "--run-root", RUN], env=django_env)
        (RUN / "business-promotion-file-guard-upgrade.json").write_text(upgrade, encoding="utf-8")
        print(upgrade.strip(), flush=True)
    if arguments.business_finance_v3_upgrade:
        upgrade = run([sys.executable, ROOT / "tools/business-finance-v3-upgrade-rehearsal.py", "--run-root", RUN], env=django_env)
        (RUN / "business-finance-v3-upgrade.json").write_text(upgrade, encoding="utf-8")
        print(upgrade.strip(), flush=True)
    if arguments.business_promotion_file_ready_upgrade:
        predecessor = run([sys.executable, ROOT / "tools/business-promotion-profile-upgrade-rehearsal.py", "--run-root", RUN], env=django_env)
        (RUN / "business-promotion-profile-upgrade.json").write_text(predecessor, encoding="utf-8")
        predecessor = run([sys.executable, ROOT / "tools/business-promotion-file-guard-upgrade-rehearsal.py", "--run-root", RUN], env=django_env)
        (RUN / "business-promotion-file-guard-upgrade.json").write_text(predecessor, encoding="utf-8")
        upgrade = run([sys.executable, ROOT / "tools/business-promotion-file-ready-upgrade-rehearsal.py", "--run-root", RUN], env=django_env)
        (RUN / "business-promotion-file-ready-upgrade.json").write_text(upgrade, encoding="utf-8")
        print(upgrade.strip(), flush=True)
    if arguments.business_finance_v3_pages_upgrade:
        for script, name in (
            ("business-promotion-profile-upgrade-rehearsal.py", "business-promotion-profile-upgrade.json"),
            ("business-promotion-file-guard-upgrade-rehearsal.py", "business-promotion-file-guard-upgrade.json"),
            ("business-promotion-file-ready-upgrade-rehearsal.py", "business-promotion-file-ready-upgrade.json"),
            ("business-finance-v3-pages-upgrade-rehearsal.py", "business-finance-v3-pages-upgrade.json"),
        ):
            upgrade = run([sys.executable, ROOT / "tools" / script, "--run-root", RUN], env=django_env)
            (RUN / name).write_text(upgrade, encoding="utf-8")
        print(upgrade.strip(), flush=True)
    if arguments.business_v3_daily_pages_upgrade:
        for script, name in (
            ("business-promotion-profile-upgrade-rehearsal.py", "business-promotion-profile-upgrade.json"),
            ("business-promotion-file-guard-upgrade-rehearsal.py", "business-promotion-file-guard-upgrade.json"),
            ("business-promotion-file-ready-upgrade-rehearsal.py", "business-promotion-file-ready-upgrade.json"),
            ("business-finance-v3-pages-upgrade-rehearsal.py", "business-finance-v3-pages-upgrade.json"),
            ("business-v3-daily-pages-upgrade-rehearsal.py", "business-v3-daily-pages-upgrade.json"),
        ):
            upgrade = run([sys.executable, ROOT / "tools" / script, "--run-root", RUN], env=django_env)
            (RUN / name).write_text(upgrade, encoding="utf-8")
        print(upgrade.strip(), flush=True)
    if arguments.business_v3_tool_receipts_upgrade:
        for script, name in (
            ("business-promotion-profile-upgrade-rehearsal.py", "business-promotion-profile-upgrade.json"),
            ("business-promotion-file-guard-upgrade-rehearsal.py", "business-promotion-file-guard-upgrade.json"),
            ("business-promotion-file-ready-upgrade-rehearsal.py", "business-promotion-file-ready-upgrade.json"),
            ("business-finance-v3-pages-upgrade-rehearsal.py", "business-finance-v3-pages-upgrade.json"),
            ("business-v3-daily-pages-upgrade-rehearsal.py", "business-v3-daily-pages-upgrade.json"),
            ("business-v3-tool-receipts-upgrade-rehearsal.py", "business-v3-tool-receipts-upgrade.json"),
        ):
            upgrade = run([sys.executable, ROOT / "tools" / script, "--run-root", RUN], env=django_env)
            (RUN / name).write_text(upgrade, encoding="utf-8")
        print(upgrade.strip(), flush=True)
    if arguments.business_v3_parent_seal_upgrade:
        for script, name in (
            ("business-promotion-profile-upgrade-rehearsal.py", "business-promotion-profile-upgrade.json"),
            ("business-promotion-file-guard-upgrade-rehearsal.py", "business-promotion-file-guard-upgrade.json"),
            ("business-promotion-file-ready-upgrade-rehearsal.py", "business-promotion-file-ready-upgrade.json"),
            ("business-finance-v3-pages-upgrade-rehearsal.py", "business-finance-v3-pages-upgrade.json"),
            ("business-v3-daily-pages-upgrade-rehearsal.py", "business-v3-daily-pages-upgrade.json"),
            ("business-v3-tool-receipts-upgrade-rehearsal.py", "business-v3-tool-receipts-upgrade.json"),
            ("business-v3-parent-seal-upgrade-rehearsal.py", "business-v3-parent-seal-upgrade.json"),
        ):
            upgrade = run([sys.executable, ROOT / "tools" / script, "--run-root", RUN], env=django_env)
            (RUN / name).write_text(upgrade, encoding="utf-8")
        print(upgrade.strip(), flush=True)
    if arguments.business_v3_report_intent_upgrade:
        for script, name in (
            ("business-promotion-profile-upgrade-rehearsal.py", "business-promotion-profile-upgrade.json"),
            ("business-promotion-file-guard-upgrade-rehearsal.py", "business-promotion-file-guard-upgrade.json"),
            ("business-promotion-file-ready-upgrade-rehearsal.py", "business-promotion-file-ready-upgrade.json"),
            ("business-finance-v3-pages-upgrade-rehearsal.py", "business-finance-v3-pages-upgrade.json"),
            ("business-v3-daily-pages-upgrade-rehearsal.py", "business-v3-daily-pages-upgrade.json"),
            ("business-v3-tool-receipts-upgrade-rehearsal.py", "business-v3-tool-receipts-upgrade.json"),
            ("business-v3-parent-seal-upgrade-rehearsal.py", "business-v3-parent-seal-upgrade.json"),
            ("business-v3-report-intent-upgrade-rehearsal.py", "business-v3-report-intent-upgrade.json"),
        ):
            upgrade = run([sys.executable, ROOT / "tools" / script, "--run-root", RUN], env=django_env)
            (RUN / name).write_text(upgrade, encoding="utf-8")
        print(upgrade.strip(), flush=True)
    if arguments.business_v4_ledger_upgrade:
        for script, name in (
            ("business-promotion-profile-upgrade-rehearsal.py", "business-promotion-profile-upgrade.json"),
            ("business-promotion-file-guard-upgrade-rehearsal.py", "business-promotion-file-guard-upgrade.json"),
            ("business-promotion-file-ready-upgrade-rehearsal.py", "business-promotion-file-ready-upgrade.json"),
            ("business-finance-v3-pages-upgrade-rehearsal.py", "business-finance-v3-pages-upgrade.json"),
            ("business-v3-daily-pages-upgrade-rehearsal.py", "business-v3-daily-pages-upgrade.json"),
            ("business-v3-tool-receipts-upgrade-rehearsal.py", "business-v3-tool-receipts-upgrade.json"),
            ("business-v3-parent-seal-upgrade-rehearsal.py", "business-v3-parent-seal-upgrade.json"),
            ("business-v3-report-intent-upgrade-rehearsal.py", "business-v3-report-intent-upgrade.json"),
            ("business-v4-ledger-upgrade-rehearsal.py", "business-v4-ledger-upgrade.json"),
        ):
            upgrade = run([sys.executable, ROOT / "tools" / script, "--run-root", RUN], env=django_env)
            (RUN / name).write_text(upgrade, encoding="utf-8")
        print(upgrade.strip(), flush=True)
    if arguments.business_v4_validation_upgrade:
        for script, name in (
            ("business-promotion-profile-upgrade-rehearsal.py", "business-promotion-profile-upgrade.json"),
            ("business-promotion-file-guard-upgrade-rehearsal.py", "business-promotion-file-guard-upgrade.json"),
            ("business-promotion-file-ready-upgrade-rehearsal.py", "business-promotion-file-ready-upgrade.json"),
            ("business-finance-v3-pages-upgrade-rehearsal.py", "business-finance-v3-pages-upgrade.json"),
            ("business-v3-daily-pages-upgrade-rehearsal.py", "business-v3-daily-pages-upgrade.json"),
            ("business-v3-tool-receipts-upgrade-rehearsal.py", "business-v3-tool-receipts-upgrade.json"),
            ("business-v3-parent-seal-upgrade-rehearsal.py", "business-v3-parent-seal-upgrade.json"),
            ("business-v3-report-intent-upgrade-rehearsal.py", "business-v3-report-intent-upgrade.json"),
            ("business-v4-ledger-upgrade-rehearsal.py", "business-v4-ledger-upgrade.json"),
            ("business-v4-validation-upgrade-rehearsal.py", "business-v4-validation-upgrade.json"),
        ):
            upgrade = run([sys.executable, ROOT / "tools" / script, "--run-root", RUN], env=django_env)
            (RUN / name).write_text(upgrade, encoding="utf-8")
        print(upgrade.strip(), flush=True)
    if (arguments.business_v4_seal_admission_upgrade or
            arguments.business_v4_seal_writer_upgrade or
            arguments.business_v4_sealer_ledger_read_upgrade or
            arguments.business_v4_sealer_narrow_stream_upgrade or
            arguments.business_v4_seal_ticket_upgrade or
            arguments.business_v4_claimed_read_upgrade):
        rehearsals = (
            ("business-promotion-profile-upgrade-rehearsal.py", "business-promotion-profile-upgrade.json"),
            ("business-promotion-file-guard-upgrade-rehearsal.py", "business-promotion-file-guard-upgrade.json"),
            ("business-promotion-file-ready-upgrade-rehearsal.py", "business-promotion-file-ready-upgrade.json"),
            ("business-finance-v3-pages-upgrade-rehearsal.py", "business-finance-v3-pages-upgrade.json"),
            ("business-v3-daily-pages-upgrade-rehearsal.py", "business-v3-daily-pages-upgrade.json"),
            ("business-v3-tool-receipts-upgrade-rehearsal.py", "business-v3-tool-receipts-upgrade.json"),
            ("business-v3-parent-seal-upgrade-rehearsal.py", "business-v3-parent-seal-upgrade.json"),
            ("business-v3-report-intent-upgrade-rehearsal.py", "business-v3-report-intent-upgrade.json"),
            ("business-v4-seal-admission-upgrade-rehearsal.py", "business-v4-seal-admission-upgrade.json"),
        )
        if (arguments.business_v4_seal_writer_upgrade or
                arguments.business_v4_sealer_ledger_read_upgrade or
                arguments.business_v4_sealer_narrow_stream_upgrade or
                arguments.business_v4_seal_ticket_upgrade or
                arguments.business_v4_claimed_read_upgrade):
            rehearsals += (("business-v4-seal-writer-upgrade-rehearsal.py",
                "business-v4-seal-writer-upgrade.json"),)
        if (arguments.business_v4_sealer_ledger_read_upgrade or
                arguments.business_v4_sealer_narrow_stream_upgrade or
                arguments.business_v4_seal_ticket_upgrade or
                arguments.business_v4_claimed_read_upgrade):
            rehearsals += (("business-v4-sealer-ledger-read-upgrade-rehearsal.py",
                "business-v4-sealer-ledger-read-upgrade.json"),)
        if (arguments.business_v4_sealer_narrow_stream_upgrade or
                arguments.business_v4_seal_ticket_upgrade or
                arguments.business_v4_claimed_read_upgrade):
            rehearsals += (("business-v4-sealer-narrow-stream-upgrade-rehearsal.py",
                "business-v4-sealer-narrow-stream-upgrade.json"),)
        if arguments.business_v4_seal_ticket_upgrade or arguments.business_v4_claimed_read_upgrade:
            rehearsals += (("business-v4-seal-ticket-upgrade-rehearsal.py",
                "business-v4-seal-ticket-upgrade.json"),)
        if arguments.business_v4_claimed_read_upgrade:
            rehearsals += (("business-v4-claimed-read-upgrade-rehearsal.py",
                "business-v4-claimed-read-upgrade.json"),)
        if arguments.business_v4_seal_consumption_upgrade:
            rehearsals += (("business-v4-seal-consumption-upgrade-rehearsal.py",
                "business-v4-seal-consumption-upgrade.json"),)
        if arguments.business_market_v2_parked_upgrade:
            rehearsals += (("business-market-v2-parked-upgrade-rehearsal.py",
                "business-market-v2-parked-upgrade.json"),)
        if arguments.business_market_v2_material_upgrade:
            rehearsals += (("business-market-v2-material-upgrade-rehearsal.py",
                "business-market-v2-material-upgrade.json"),)
        if arguments.business_promotion_trial_file_upgrade:
            rehearsals += (("business-promotion-trial-file-upgrade-rehearsal.py",
                "business-promotion-trial-file-upgrade.json"),)
        if arguments.business_v4_replay_progress_upgrade:
            rehearsals += (("business-v4-replay-progress-upgrade-rehearsal.py",
                "business-v4-replay-progress-upgrade.json"),)
        if arguments.business_v4_finance_replay_progress_upgrade:
            rehearsals += (("business-v4-finance-replay-progress-upgrade-rehearsal.py",
                "business-v4-finance-replay-progress-upgrade.json"),)
        if arguments.business_v4_sealer_source_bridge_upgrade:
            rehearsals += (("business-v4-sealer-source-bridge-upgrade-rehearsal.py",
                "business-v4-sealer-source-bridge-upgrade.json"),)
        if arguments.business_v4_replay_read_cast_upgrade:
            rehearsals += (("business-v4-replay-read-cast-upgrade-rehearsal.py",
                "business-v4-replay-read-cast-upgrade.json"),)
        if arguments.business_v4_prior_claim_qualification_upgrade:
            rehearsals += (("business-v4-prior-claim-qualification-upgrade-rehearsal.py",
                "business-v4-prior-claim-qualification-upgrade.json"),)
        if arguments.business_v4_commit_consumption_upgrade:
            rehearsals += (("business-v4-commit-consumption-upgrade-rehearsal.py",
                "business-v4-commit-consumption-upgrade.json"),)
        if arguments.business_market_v2_admitted_paused_upgrade:
            rehearsals += (("business-market-v2-admitted-paused-upgrade-rehearsal.py",
                "business-market-v2-admitted-paused-upgrade.json"),)
        for script, name in rehearsals:
            upgrade = run([sys.executable, ROOT / "tools" / script, "--run-root", RUN], env=django_env)
            (RUN / name).write_text(upgrade, encoding="utf-8")
        print(upgrade.strip(), flush=True)
    if arguments.source_revision_guards_upgrade:
        upgrade = run([sys.executable, ROOT / "tools" /
            "source-revision-guards-upgrade-rehearsal.py", "--run-root", RUN],
            env=django_env)
        (RUN / "source-revision-guards-upgrade.json").write_text(
            upgrade, encoding="utf-8")
        print(upgrade.strip(), flush=True)
    if arguments.upgrade_only:
        print(json.dumps({"status":"passed", "mode":"upgrade-only", "testSuitesRun":False,
            "runRoot":str(RUN), "productionWrites":False}),flush=True)
        sys.exit(0)  # The same finally stops only this isolated cluster.
    tests = run(
        [
            sys.executable,
            ROOT / "backend/manage.py",
            "test",
            *(arguments.test_label or ["ai_assistant"]),
            *(["system_datasets"] if arguments.prompt_settings_upgrade or arguments.report_library_upgrade else []),
            "--noinput",
            "--verbosity",
            str(arguments.test_verbosity),
        ],
        timeout=arguments.test_timeout_seconds,
        env=django_env,
    )
    (RUN / "tests.log").write_text(tests, encoding="utf-8")
    if arguments.tests_only:
        print(json.dumps({"status": "passed", "mode": "tests-only", "tests": str(RUN / "tests.log"), "productionWrites": False}), flush=True)
        sys.exit(0)  # finally still stops this exact isolated cluster.
    if arguments.all_backend_tests:
        # Existing domain unit suites include SQLite-specific fixtures. Exercise
        # their supported unit environment separately from AI's PostgreSQL gates.
        unit_env = {
            **django_env,
            "TERUISI_DJANGO_SQLITE_PATH": str(RUN / "backend-unit.sqlite3"),
        }
        unit_env.pop("TERUISI_DJANGO_DATABASE_URL", None)
        unit_tests = run(
            [
                sys.executable,
                ROOT / "backend/manage.py",
                "test",
                "ai_assistant",
                "access_control",
                "sales",
                "erp_reference",
                "finance",
                "netshop",
                "market",
                "products",
                "inventory",
                "workflow",
                "customer_service",
                "bi",
                "teruisi_backend",
                "--noinput",
                "--verbosity",
                "1",
            ],
            env=unit_env,
        )
        (RUN / "backend-regression.log").write_text(unit_tests, encoding="utf-8")
    run(
        [
            sys.executable,
            ROOT / "backend/manage.py",
            "migrate",
            "--noinput",
            "--verbosity",
            "0",
        ],
        env=django_env,
    )
    source = ROOT / ".runtime/ai-source-rehearsal.sqlite"
    dry = json.loads(
        run(
            [
                sys.executable,
                ROOT / "backend/manage.py",
                "migrate_ai_from_d1",
                "--source",
                source,
                "--mode",
                "dry-run",
            ],
            env=django_env,
        )
    )
    applied = json.loads(
        run(
            [
                sys.executable,
                ROOT / "backend/manage.py",
                "migrate_ai_from_d1",
                "--source",
                source,
                "--mode",
                "apply",
                "--approve-run-id",
                dry["runId"],
            ],
            env=django_env,
        )
    )
    verified = json.loads(
        run(
            [
                sys.executable,
                ROOT / "backend/manage.py",
                "migrate_ai_from_d1",
                "--source",
                source,
                "--mode",
                "verify-only",
            ],
            env=django_env,
        )
    )
    # Restore the complete isolated database before runtime traffic can change it.
    archive = RUN / "isolated-preactivation.dump"
    run(
        [
            BIN / "pg_dump.exe",
            "--format=custom",
            "--file",
            archive,
            "teruisi_ai_rehearsal",
        ]
    )
    run([BIN / "createdb.exe", "teruisi_ai_restore"])
    run(
        [
            BIN / "pg_restore.exe",
            "--exit-on-error",
            "--dbname",
            "teruisi_ai_restore",
            archive,
        ]
    )
    restore_env = {
        **django_env,
        "TERUISI_DJANGO_DATABASE_URL": django_env[
            "TERUISI_DJANGO_DATABASE_URL"
        ].replace("/teruisi_ai_rehearsal", "/teruisi_ai_restore"),
    }
    restored = json.loads(
        run(
            [
                sys.executable,
                ROOT / "backend/manage.py",
                "migrate_ai_from_d1",
                "--source",
                source,
                "--mode",
                "verify-only",
            ],
            env=restore_env,
        )
    )
    if restored["targetDigest"] != verified["targetDigest"]:
        raise RuntimeError("Isolated backup restoration digest mismatch")
    run(
        [
            sys.executable,
            ROOT / "tools/ai-runtime-rehearsal.py",
            "--run-root",
            RUN,
            "--apply-run",
            applied["runId"],
        ],
        env=django_env,
    )
    # A post-activation archive must retain the terminal authority and runtime
    # mutations too; a pre-activation restore alone cannot prove PNR recovery.
    run(
        [
            BIN / "pg_dump.exe",
            "--format=custom",
            "--file",
            RUN / "isolated-postactivation.dump",
            "teruisi_ai_rehearsal",
        ]
    )
    run([BIN / "createdb.exe", "teruisi_ai_terminal_restore"])
    run(
        [
            BIN / "pg_restore.exe",
            "--exit-on-error",
            "--dbname",
            "teruisi_ai_terminal_restore",
            RUN / "isolated-postactivation.dump",
        ]
    )
    import hashlib
    import psycopg

    sys.path.insert(0, str(ROOT / "backend"))
    from ai_assistant.table_manifest import AI_TABLES

    def restored_tables(database):
        with psycopg.connect(
            django_env["TERUISI_DJANGO_DATABASE_URL"].replace(
                "/teruisi_ai_rehearsal", "/" + database
            )
        ) as restored_connection:
            evidence = {}
            for table in AI_TABLES:
                rows = restored_connection.execute(
                    f'SELECT row_to_json(t)::text FROM "{table}" t'
                ).fetchall()
                normalized = sorted(
                    json.dumps(
                        json.loads(row[0]), sort_keys=True, separators=(",", ":")
                    )
                    for row in rows
                )
                evidence[table] = hashlib.sha256(
                    "\n".join(normalized).encode()
                ).hexdigest()
            status = restored_connection.execute(
                "SELECT status FROM ai_write_authority WHERE id=1"
            ).fetchone()[0]
            if status != "postgres":
                raise RuntimeError("Restored AI terminal authority is missing")
            return evidence

    terminal = restored_tables("teruisi_ai_rehearsal")
    if restored_tables("teruisi_ai_terminal_restore") != terminal:
        raise RuntimeError("Post-activation AI restore differs from the source")
    report = {
        "status": "passed",
        "port": PORT,
        "productionWrites": False,
        "dryRun": dry,
        "apply": applied,
        "verify": verified,
        "restored": restored,
        "terminalRestore": {
            "status": "passed",
            "tables": len(AI_TABLES),
            "authority": "postgres",
            "productionDatabaseTouched": False,
        },
        "system": json.loads((RUN / "system-result.json").read_text(encoding="utf-8")),
    }
    (RUN / "result.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "status": "passed",
                "sourceDigest": verified["sourceDigest"],
                "targetDigest": verified["targetDigest"],
                "totalRows": sum(verified["counts"].values()),
                "result": str(RUN / "result.json"),
            },
            ensure_ascii=False,
        ),
        flush=True,
    )
finally:
    if started:
        run(
            [
                BIN / "pg_ctl.exe",
                "-D",
                RUN / "data",
                "-m",
                "fast",
                "-w",
                "-t",
                "90",
                "stop",
            ],
            120,
        )
    password_file.unlink(missing_ok=True)
