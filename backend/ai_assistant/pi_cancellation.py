"""One owned watcher connection per transport, admitted before any HTTP request."""
from contextlib import contextmanager
from copy import deepcopy
import math
import re
import threading

from django.db import DEFAULT_DB_ALIAS, close_old_connections, connections

from . import transport
from .pi_models import PiOperation
from .policy import AiError


def _milliseconds(value):
    match = re.fullmatch(r"(\d+)\s*(us|ms|s|min|h|d)?", str(value))
    if not match:
        raise ValueError("unsupported_statement_timeout")
    return int(match[1]) * {None: 1, "us": .001, "ms": 1, "s": 1000,
        "min": 60000, "h": 3600000, "d": 86400000}[match[2]]


def model_checks(operation, parent_check):
    """Capture primitives on the owner; never pass its DB wrapper to a thread."""
    owner_thread = threading.get_ident()
    try:
        # This is the single ageing boundary, before the transport. Neither
        # owner nor watcher checks close connections during the live request.
        if not connections[DEFAULT_DB_ALIAS].in_atomic_block:
            close_old_connections()
        owner = connections[DEFAULT_DB_ALIAS]
        configuration = deepcopy(owner.settings_dict)
        wrapper_type = type(owner)
        statement_ms = None
        if owner.vendor == "postgresql":
            with owner.cursor() as cursor:
                cursor.execute("SHOW statement_timeout")
                statement_ms = _milliseconds(cursor.fetchone()[0])
    except AiError:
        raise
    except Exception as error:
        raise transport.CancellationCheckError(error, stage="cancel_preflight") from error

    def check():
        if parent_check:
            parent_check()
        latest = PiOperation.objects.only("cancel_requested", "status").get(pk=operation.pk)
        if latest.cancel_requested or latest.status not in {"running", "canceling"}:
            raise AiError("Pi 执行已停止，模型结果禁止自动重发", "pi_canceled_during_dispatch", 503)

    @contextmanager
    def watcher_scope(seconds):
        if threading.get_ident() == owner_thread:
            raise RuntimeError("watcher_scope_requires_its_own_thread")
        settings = deepcopy(configuration)
        options = settings.setdefault("OPTIONS", {})
        if statement_ms is not None:
            connect_budget = max(1, math.ceil(seconds))
            configured = int(options.get("connect_timeout", connect_budget))
            options["connect_timeout"] = min(configured, connect_budget) if configured > 0 else connect_budget
            budget_ms = max(1, math.floor(seconds * 1000))
            bounded_ms = min(budget_ms, statement_ms) if statement_ms else budget_ms
            # Startup cap also bounds the very first check. The owner's actual
            # role/session timeout was captured above, preserving shorter caps.
            options["options"] = (str(options.get("options", "")) +
                " -c statement_timeout=" + str(max(1, math.floor(bounded_ms)))).strip()
        elif settings["ENGINE"].endswith("sqlite3"):
            options["timeout"] = min(float(options.get("timeout", seconds)), max(.001, seconds))
        owned = wrapper_type(settings, alias=DEFAULT_DB_ALIAS)
        previous = connections[DEFAULT_DB_ALIAS]
        connections[DEFAULT_DB_ALIAS] = owned  # ConnectionHandler storage is thread-local.
        try:
            owned.ensure_connection()
            if not owned.get_autocommit():
                raise RuntimeError("watcher_connection_requires_autocommit")
            yield
        finally:
            try:
                owned.close()
            finally:
                connections[DEFAULT_DB_ALIAS] = previous

    return check, watcher_scope
