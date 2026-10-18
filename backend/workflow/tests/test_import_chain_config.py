import os
import sys
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import MagicMock, patch

from teruisi_backend.n8n_status_config import VARIABLE, configured_n8n_status_database_path


class ImportChainConfigTests(TestCase):
    def registry(self, value="C:/explicit/n8n.sqlite", kind=1):
        return SimpleNamespace(HKEY_CURRENT_USER=object(), KEY_READ=1, REG_SZ=1, REG_EXPAND_SZ=2,
                               OpenKey=MagicMock(), QueryValueEx=MagicMock(return_value=(value, kind)))

    def test_explicit_process_value_and_empty_opt_out_never_read_registry(self):
        registry = self.registry()
        for value in ("", "D:/isolated/test.sqlite"):
            with self.subTest(value=value), patch.dict(os.environ, {VARIABLE: value}), patch.dict(sys.modules, winreg=registry):
                self.assertEqual(configured_n8n_status_database_path(), value)
        registry.OpenKey.assert_not_called()

    def test_missing_process_value_reads_only_exact_current_user_configuration(self):
        registry = self.registry()
        with patch.dict(os.environ, {}, clear=True), patch.object(sys, "platform", "win32"), patch.dict(sys.modules, winreg=registry):
            self.assertEqual(configured_n8n_status_database_path(), "C:/explicit/n8n.sqlite")
        registry.OpenKey.assert_called_once_with(registry.HKEY_CURRENT_USER, "Environment", 0, registry.KEY_READ)
        registry.QueryValueEx.assert_called_once_with(registry.OpenKey.return_value.__enter__.return_value, VARIABLE)

    def test_non_windows_and_absent_denied_or_invalid_registry_fail_closed(self):
        registry = self.registry()
        with patch.dict(os.environ, {}, clear=True), patch.object(sys, "platform", "linux"), patch.dict(sys.modules, winreg=registry):
            self.assertEqual(configured_n8n_status_database_path(), "")
        registry.OpenKey.assert_not_called()
        for result in (([], 1), ("D:/explicit.sqlite", 7), ("", 1)):
            registry = self.registry(*result)
            with patch.dict(os.environ, {}, clear=True), patch.object(sys, "platform", "win32"), patch.dict(sys.modules, winreg=registry):
                self.assertEqual(configured_n8n_status_database_path(), "")
        for error in (FileNotFoundError(), PermissionError()):
            registry = self.registry()
            registry.OpenKey.side_effect = error
            with patch.dict(os.environ, {}, clear=True), patch.object(sys, "platform", "win32"), patch.dict(sys.modules, winreg=registry):
                self.assertEqual(configured_n8n_status_database_path(), "")
