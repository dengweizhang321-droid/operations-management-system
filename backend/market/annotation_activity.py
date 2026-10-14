"""Bridge finite image leases to the existing host maintenance activity barrier."""
from threading import Lock, Timer

from django.utils import timezone
from teruisi_backend.automation_drain import deployed_runtime, protected_activity

_lock = Lock()
_leases = {}


def hold(token_hash, expires_at):
    runtime = deployed_runtime()
    if runtime is None:
        return
    lease = protected_activity(runtime, background=True)
    lease.__enter__()  # Checks helper/request drain before admitting model work.
    timer = Timer(max(0, min(180, (expires_at - timezone.now()).total_seconds())), release, args=(token_hash,))
    timer.daemon = True
    with _lock:
        _leases[token_hash] = (lease, timer)
    timer.start()


def release(token_hash):
    with _lock:
        lease = _leases.pop(token_hash, None)
    if lease:
        context, timer = lease
        timer.cancel()
        context.__exit__(None, None, None)
