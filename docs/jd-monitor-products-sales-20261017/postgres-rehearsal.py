"""New private PostgreSQL cluster; synthetic schema and targeted monitor tests only."""
import json, os, secrets, socket, subprocess, sys, time
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
BIN = Path("D:/teruisi-runtime/django-sales/postgresql-17.11/bin")

def verify():
    import django
    django.setup()
    from django.core.management import call_command
    from django.db import connection
    from django.db.migrations.executor import MigrationExecutor
    import unittest
    assert connection.settings_dict["NAME"] == "jd_logistics_fixture"
    assert connection.settings_dict["HOST"] == "127.0.0.1" and connection.settings_dict["PORT"] != "5432"
    previous = [("inventory", "0015_jd_monitor_preferences")]
    following = [("inventory", "0016_jd_product_monitoring")]
    executor = MigrationExecutor(connection)
    executor.migrate(previous)
    Department = executor.loader.project_state(previous).apps.get_model("inventory", "JdLogisticsDepartment")
    Department.objects.create(id="EXISTING", name="synthetic", business_unit_code="EXISTING", warehouse_preferences=[{"warehouseKey":"code:KEEP", "displayName":"keep", "enabled":False}], product_order=["KEEP"], revision=7, updated_by="fixture")
    call_command("migrate", "inventory", "0016", plan=True, verbosity=1)
    MigrationExecutor(connection).migrate(following)
    from inventory.jd_logistics_models import JdLogisticsDepartment
    row = JdLogisticsDepartment.objects.get(id="EXISTING")
    assert row.unmonitored_product_codes == [] and row.product_order == ["KEEP"] and row.revision == 7
    assert row.warehouse_preferences[0]["displayName"] == "keep"
    MigrationExecutor(connection).migrate(previous)
    assert Department.objects.get(id="EXISTING").product_order == ["KEEP"]
    MigrationExecutor(connection).migrate(following)
    assert JdLogisticsDepartment.objects.get(id="EXISTING").unmonitored_product_codes == []
    call_command("makemigrations", "inventory", check=True, dry_run=True, verbosity=1)
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromName("inventory.tests.test_jd_product_monitoring"))
    assert result.wasSuccessful()
    print(json.dumps({"isolatedPostgresql": True, "forwardReverseForward": True, "existingPreferencesPreserved": True, "schemaOnly": True, "productionTouched": False, "tests": result.testsRun}))


def main():
    if "--verify" in sys.argv:
        return verify()
    run_directory = ROOT / ".runtime" / ("jd-product-monitoring-pg-" + secrets.token_hex(8))
    run_directory.mkdir(parents=True, exist_ok=False)
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    if port == 5432:
        raise RuntimeError("Refusing production port")
    password = secrets.token_hex(40)
    password_file = run_directory / "password.txt"
    password_file.write_text(password, encoding="ascii")
    allowed = {"SYSTEMROOT", "WINDIR", "TEMP", "TMP", "PATH", "COMSPEC", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "PROGRAMFILES"}
    environment = {key: value for key, value in os.environ.items() if key.upper() in allowed}
    environment.update(PGPASSWORD=password, PYTHONUTF8="1", PYTHONDONTWRITEBYTECODE="1", PYTHONPATH=str(ROOT / "backend"), DJANGO_SETTINGS_MODULE="teruisi_backend.settings", TERUISI_DJANGO_ENVIRONMENT="test", TERUISI_DJANGO_PROCESS_ROLE="development", DJANGO_DEBUG="true", TERUISI_DJANGO_DATABASE_URL=f"postgresql://jd_fixture:{password}@127.0.0.1:{port}/jd_logistics_fixture")
    steps = []
    def run(arguments, label, timeout=300):
        started = time.monotonic()
        with (run_directory / (label + ".log")).open("x", encoding="utf-8") as output:
            result = subprocess.run([str(value) for value in arguments], cwd=ROOT, env=environment, stdout=output, stderr=subprocess.STDOUT, timeout=timeout, creationflags=subprocess.CREATE_NO_WINDOW)
        steps.append({"step": label, "exitCode": result.returncode, "seconds": round(time.monotonic() - started, 3)})
        if result.returncode:
            raise RuntimeError(label + " failed; see retained fixture log")
    started = stopped = False
    try:
        run([BIN / "initdb.exe", "-D", run_directory / "data", "-U", "jd_fixture", "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C", "--pwfile", password_file], "initdb", 60)
        password_file.unlink()
        with (run_directory / "data/postgresql.conf").open("a", encoding="utf-8") as configuration:
            configuration.write(f"\nport={port}\nlisten_addresses='127.0.0.1'\nmax_connections=16\nshared_buffers='32MB'\n")
        run([BIN / "pg_ctl.exe", "-D", run_directory / "data", "-l", run_directory / "postgres.log", "-w", "-t", "30", "start"], "start", 45)
        started = True
        run([BIN / "createdb.exe", "-h", "127.0.0.1", "-p", port, "-U", "jd_fixture", "jd_logistics_fixture"], "database", 30)
        run([sys.executable, Path(__file__), "--verify"], "verify", 300)
    finally:
        if password_file.exists():
            password_file.unlink()
        if started:
            run([BIN / "pg_ctl.exe", "-D", run_directory / "data", "-m", "fast", "-w", "-t", "30", "stop"], "stop", 45)
            stopped = True
        evidence = {"productionTouched": False, "started": started, "stopped": stopped, "port": port, "steps": steps}
        (run_directory / "evidence.json").write_text(json.dumps(evidence, indent=2), encoding="utf-8")
        print(json.dumps({"evidence": str(run_directory / "evidence.json"), **evidence}, ensure_ascii=True))


if __name__ == "__main__":
    main()
