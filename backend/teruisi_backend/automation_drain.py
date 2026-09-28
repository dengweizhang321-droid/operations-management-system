"""Host-local admission barrier; business receipts remain in their owning domains.

Shared byte locks protect admitted work. The lifecycle controller closes admission
before attempting an exclusive lock. A crashed process releases its lock, but its
business result is still unknown and must be reconciled by the existing ledger.
"""
from contextlib import contextmanager
import json
import os
from pathlib import Path

from system_backups.storage import checked

PROTOCOL = "teruisi-automation-drain-v1"
RUNTIME = Path(r"D:\teruisi-runtime\django-sales")


def windows_shared_lock(stream):
    # CRT LK_NBRLCK is exclusive on Windows. Use the native shared byte lock,
    # allowing concurrent requests while still excluding FileStream.Lock.
    import ctypes
    from ctypes import wintypes
    import msvcrt
    class Overlapped(ctypes.Structure):
        _fields_ = [("Internal", ctypes.c_size_t), ("InternalHigh", ctypes.c_size_t),
                    ("Offset", wintypes.DWORD), ("OffsetHigh", wintypes.DWORD), ("hEvent", wintypes.HANDLE)]
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.LockFileEx.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.DWORD, wintypes.DWORD, wintypes.DWORD, ctypes.POINTER(Overlapped)]
    kernel.UnlockFileEx.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.DWORD, wintypes.DWORD, ctypes.POINTER(Overlapped)]
    handle = msvcrt.get_osfhandle(stream.fileno())
    overlapped = Overlapped()
    if not kernel.LockFileEx(handle, 1, 0, 1, 0, ctypes.byref(overlapped)):
        raise ctypes.WinError(ctypes.get_last_error())
    def release():
        if not kernel.UnlockFileEx(handle, 0, 1, 0, ctypes.byref(overlapped)):
            raise ctypes.WinError(ctypes.get_last_error())
    return release


class AdmissionClosed(Exception):
    pass


def deployed_runtime():
    # Development/test imports must never touch the production runtime.
    return RUNTIME if Path(__file__).absolute() == RUNTIME / "app/backend/teruisi_backend/automation_drain.py" else None


def read_gate(runtime):
    path = checked(Path(runtime) / "run/automation-drain.json", missing=True)
    try:
        if path.stat().st_size > 4096:
            raise AdmissionClosed("invalid_drain_record")
        value = json.loads(path.read_text(encoding="utf-8-sig"))
    except FileNotFoundError:
        return None
    except (ValueError, OSError):
        raise AdmissionClosed("invalid_drain_record") from None
    if (not isinstance(value, dict) or value.get("version") != PROTOCOL
            or value.get("phase") not in {"helpers", "requests"}
            or not isinstance(value.get("id"), str) or len(value["id"]) != 32
            or any(c not in "0123456789abcdef" for c in value["id"])
            or Path(value.get("runtimeRoot", "")).absolute() != Path(runtime).absolute()):
        raise AdmissionClosed("invalid_drain_record")
    return value


@contextmanager
def protected_activity(runtime=None, *, background=False):
    runtime = deployed_runtime() if runtime is None else Path(runtime)
    if runtime is None:
        yield
        return
    path = checked(runtime / "run" / ("automation-background.lock" if background else "automation-activity.lock"), missing=True)
    with path.open("a+b") as stream:
        stream.seek(0)
        try:
            if os.name == "nt":
                release = windows_shared_lock(stream)
            else:
                import fcntl
                fcntl.flock(stream.fileno(), fcntl.LOCK_SH | fcntl.LOCK_NB)
        except OSError:
            raise AdmissionClosed("maintenance_wait") from None
        try:
            gate = read_gate(runtime)
            if (gate and (background or gate["phase"] == "requests")) or (runtime / "run/system-maintenance.json").exists():
                raise AdmissionClosed("maintenance_wait")
            yield
        finally:
            stream.seek(0)
            if os.name == "nt":
                release()
            else:
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


class AutomationDrainMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        from django.http import JsonResponse
        if request.path in {"/health/live", "/health/ready"}:
            return self.get_response(request)
        lease = protected_activity()
        try:
            lease.__enter__()
        except AdmissionClosed as error:
            response = JsonResponse({"error": str(error), "code": "maintenance_wait", "accepted": False}, status=503)
            response["Retry-After"] = "300"
            response["Cache-Control"] = "no-store"
            return response
        try:
            response = self.get_response(request)
        except BaseException:
            lease.__exit__(None, None, None)
            raise
        if response.streaming:
            # WSGI closes responses on exhaustion and client disconnect alike.
            response._resource_closers.append(lambda: lease.__exit__(None, None, None))
        else:
            lease.__exit__(None, None, None)
        return response
