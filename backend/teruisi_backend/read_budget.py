"""Per-request owning-reader budget; no persistent database setting changes."""
from contextlib import contextmanager
import time
from django.db import connection, transaction


@contextmanager
def bounded_read(error_type, *, seconds=8):
    deadline = time.monotonic() + seconds
    def check():
        if time.monotonic() >= deadline:
            raise error_type("所属读取超过8秒预算", code="source_timeout", status=503)
    def execute(executor, sql, params, many, context):
        check()
        if connection.vendor == "postgresql" and not sql.lstrip().upper().startswith(("SAVEPOINT", "RELEASE", "ROLLBACK")):
            milliseconds = max(1, min(7000, int((deadline - time.monotonic()) * 1000)))
            executor("SELECT set_config('statement_timeout', %s, true)", [str(milliseconds)], False, context)
        result = executor(sql, params, many, context)
        check()
        return result
    with transaction.atomic(), connection.execute_wrapper(execute):
        yield
        check()
