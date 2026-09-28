import os
from pathlib import Path
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch, Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "teruisi_backend.settings")
os.environ["TERUISI_DJANGO_ENVIRONMENT"] = "test"
import django
django.setup()
from django.test import RequestFactory, override_settings
from sales.auth import Principal, PrincipalEnvelopeError
from system_backups.views import backups


class BackupPermissions(unittest.TestCase):
    def setUp(self):
        self.factory = RequestFactory()

    @override_settings(DJANGO_PROCESS_ROLE="access_control_reader")
    def test_invalid_signature_cannot_touch_storage(self):
        with patch("access_control.views.verify_principal", side_effect=PrincipalEnvelopeError("bad")), patch("system_backups.views.production_store") as store:
            self.assertEqual(backups(self.factory.get("/api/access-control/backups")).status_code, 401)
            store.assert_not_called()

    @override_settings(DJANGO_PROCESS_ROLE="access_control_reader")
    def test_non_admin_scoped_and_revoked_admin_denied(self):
        for role, scope, current_role in (("operator", None, "operator"), ("admin", {}, "admin"), ("admin", None, "viewer")):
            principal = Principal("admin@example.test", "", role, scope)
            with patch("access_control.views.verify_principal", return_value=principal), patch("access_control.views.resolve_user", return_value=SimpleNamespace(role_id=current_role, scope=None)), patch("system_backups.views.production_store") as store:
                self.assertEqual(backups(self.factory.get("/api/access-control/backups")).status_code, 403)
                store.assert_not_called()

    @override_settings(DJANGO_PROCESS_ROLE="access_control_reader")
    def test_reader_never_accepts_write(self):
        with patch("system_backups.views.production_store") as store:
            response = backups(self.factory.post("/api/access-control/backups", data={}, content_type="application/json"))
            self.assertEqual(response.status_code, 403)
            store.assert_not_called()

    @override_settings(DJANGO_PROCESS_ROLE="access_control_writer")
    def test_job_replay_does_not_launch_twice(self):
        principal = Principal("admin@example.test", "", "admin", None)
        store = Mock()
        store.submit.return_value = ({"id": "a" * 32, "status": "queued"}, False)
        store.public_job.side_effect = lambda job: job
        with patch("system_backups.views._admin", return_value=principal), patch("system_backups.views.production_store", return_value=store), patch("system_backups.views.revision_header", return_value="1:aaaaaaaaaaaa"), patch("system_backups.views.launch") as launch:
            response = backups(self.factory.post("/api/access-control/backups", data={"operation": "job"}, content_type="application/json"))
            self.assertEqual(response.status_code, 200)
            launch.assert_not_called()


if __name__ == "__main__":
    unittest.main()
