"""Import the real settings in disposable app trees, without inherited config."""

import hashlib
import json
import os
from contextlib import closing
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
from tempfile import TemporaryDirectory

from django.test import SimpleTestCase


class DatabaseFallbackSettingsTests(SimpleTestCase):
    def setUp(self):
        temporary = TemporaryDirectory(prefix="teruisi-settings-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.app = self.root / "app"
        package = self.app / "backend" / "teruisi_backend"
        package.mkdir(parents=True)
        for name in ("__init__.py", "settings.py", "n8n_status_config.py"):
            shutil.copyfile(Path(__file__).with_name(name), package / name)
        self.marker = self.app / "deployment.json"
        self.default_database = self.app / ".runtime" / "django" / "teruisi.sqlite3"

    def snapshot(self):
        return {
            str(path.relative_to(self.root)): (
                hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None
            )
            for path in self.root.rglob("*")
        }

    def import_settings(self, **configuration):
        # Preserve only OS essentials; never inherit production DBs or secrets.
        environment = {
            key: value for key, value in os.environ.items()
            if key.upper() in {"SYSTEMROOT", "WINDIR", "PATH", "TEMP", "TMP"}
        }
        environment.update(TERUISI_N8N_STATUS_DATABASE_PATH="", **configuration)
        return subprocess.run(
            [sys.executable, "-I", "-B", "-X", "utf8", "-c", (
                "import json, sys; sys.path.insert(0, sys.argv[1]); "
                "from teruisi_backend import settings; "
                "print(json.dumps(settings.DATABASES['default'], default=str))"
            ), str(self.app / "backend")],
            cwd=self.root,
            env=environment,
            capture_output=True,
            encoding="utf-8",
            timeout=15,
        )

    def assert_managed_rejected(self, **configuration):
        before = self.snapshot()
        result = self.import_settings(**configuration)
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn("deployment.json", result.stderr)
        self.assertIn("TERUISI_DJANGO_DATABASE_URL", result.stderr)
        # Includes directories and all file bytes; -B suppresses interpreter
        # bytecode so the assertion detects every settings-created artifact.
        self.assertEqual(self.snapshot(), before)

    def test_managed_import_without_database_or_environment_creates_nothing(self):
        self.marker.write_text('{"version": 2, "fileCount": 3}', encoding="utf-8")
        self.assert_managed_rejected()

    def test_managed_development_and_test_cannot_enable_fallback(self):
        self.marker.touch()
        for environment in ("development", "test"):
            with self.subTest(environment=environment):
                self.assert_managed_rejected(TERUISI_DJANGO_ENVIRONMENT=environment)

    def test_managed_blank_database_url_is_rejected(self):
        self.marker.touch()
        self.assert_managed_rejected(TERUISI_DJANGO_DATABASE_URL=" \t ")

    def test_managed_sqlite_override_inside_or_outside_app_is_rejected(self):
        self.marker.touch()
        for target in (self.app / "custom" / "db.sqlite3", self.root / "outside" / "db.sqlite3"):
            with self.subTest(target=target):
                self.assert_managed_rejected(TERUISI_DJANGO_SQLITE_PATH=str(target))

    def test_malformed_marker_does_not_enable_fallback(self):
        self.marker.write_text("not-json", encoding="utf-8")
        self.assert_managed_rejected()

    def test_directory_marker_does_not_enable_fallback(self):
        self.marker.mkdir()
        self.assert_managed_rejected()

    def test_managed_postgres_configuration_imports_without_creating_files(self):
        self.marker.touch()
        before = self.snapshot()
        result = self.import_settings(
            TERUISI_DJANGO_DATABASE_URL="postgresql://reader:synthetic@127.0.0.1:5432/example",
            DJANGO_DEBUG="false",
            DJANGO_SECRET_KEY="aB3!" * 8,
            TERUISI_DJANGO_INTERNAL_SECRET="cD4!" * 8,
            TERUISI_DJANGO_ENVIRONMENT="production",
            DJANGO_ALLOWED_HOSTS="127.0.0.1,localhost",
            TERUISI_DJANGO_PROCESS_ROLE="migration_writer",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["ENGINE"], "django.db.backends.postgresql")
        self.assertEqual(self.snapshot(), before)

    def test_managed_sqlite_url_is_still_rejected(self):
        self.marker.touch()
        before = self.snapshot()
        result = self.import_settings(
            TERUISI_DJANGO_DATABASE_URL="sqlite:///unwanted.sqlite3", DJANGO_DEBUG="true"
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("仅支持 postgresql://", result.stderr)
        self.assertEqual(self.snapshot(), before)

    def test_development_default_path_and_existing_data_are_preserved(self):
        # First import keeps the historical path and creates only its parents.
        result = self.import_settings()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(Path(json.loads(result.stdout)["NAME"]), self.default_database)
        self.assertTrue(self.default_database.parent.is_dir())
        self.assertFalse(self.default_database.exists())
        with closing(sqlite3.connect(self.default_database)) as connection:
            with connection:
                connection.execute("CREATE TABLE sentinel (value TEXT)")
                connection.execute("INSERT INTO sentinel VALUES ('existing-development-data')")
        before = self.snapshot()
        result = self.import_settings()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(Path(json.loads(result.stdout)["NAME"]), self.default_database)
        self.assertEqual(self.snapshot(), before)

    def test_development_explicit_sqlite_path_is_preserved(self):
        target = self.root / "custom" / "existing.sqlite3"
        result = self.import_settings(TERUISI_DJANGO_SQLITE_PATH=str(target))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(Path(json.loads(result.stdout)["NAME"]), target)
        self.assertTrue(target.parent.is_dir())
        self.assertFalse(self.default_database.parent.exists())

    def test_unmanaged_production_still_rejects_missing_database(self):
        before = self.snapshot()
        result = self.import_settings(TERUISI_DJANGO_ENVIRONMENT="production")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("生产 Django 必须关闭 DEBUG 并显式配置 PostgreSQL", result.stderr)
        self.assertEqual(self.snapshot(), before)
