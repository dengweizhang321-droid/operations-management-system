"""Content-free stage records shared by the Django adapter and Linux broker."""

import hashlib
import time
from contextlib import contextmanager, nullcontext


def reference(value):
    return hashlib.sha256(value.encode()).hexdigest()


def no_stage(_name, **_scope):
    return nullcontext()


@contextmanager
def stage(emit, classify, name, **scope):
    started = time.monotonic()
    try:
        yield
    except Exception as error:
        emit({**scope, "stage": name, "status": "failed",
              "elapsedMs": round((time.monotonic() - started) * 1000), "code": classify(error)})
        raise
    else:
        emit({**scope, "stage": name, "status": "ok",
              "elapsedMs": round((time.monotonic() - started) * 1000)})
