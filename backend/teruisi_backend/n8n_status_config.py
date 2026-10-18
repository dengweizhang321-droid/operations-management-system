"""Resolve only the explicitly configured, non-secret n8n metadata path."""
from __future__ import annotations

import os
import sys

VARIABLE = "TERUISI_N8N_STATUS_DATABASE_PATH"


def configured_n8n_status_database_path():
    # An explicit process value (including an empty opt-out) takes precedence.
    # The fixed native publisher deliberately does not inherit application env.
    if VARIABLE in os.environ:
        return os.environ[VARIABLE]
    if sys.platform != "win32":
        return ""
    try:
        import winreg

        # This is the same current-user setting used by normal Windows logon,
        # not a guessed profile location or a lookup of n8n credentials.
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment", 0, winreg.KEY_READ) as key:
            value, kind = winreg.QueryValueEx(key, VARIABLE)
        if kind in (winreg.REG_SZ, winreg.REG_EXPAND_SZ) and isinstance(value, str):
            return value
    except (ImportError, OSError, ValueError):
        pass
    return ""
