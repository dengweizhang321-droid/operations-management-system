from contextlib import contextmanager
from datetime import timedelta
from tempfile import TemporaryDirectory
from pathlib import Path
from unittest.mock import patch
import os
from unittest import skipUnless

from django.test import SimpleTestCase
from django.utils import timezone

from market import annotation_activity
from teruisi_backend.automation_drain import AdmissionClosed


class AnnotationActivityTests(SimpleTestCase):
    def test_shared_background_lock_survives_claim_return_and_releases_once_after_receipt(self):
        events = []
        @contextmanager
        def barrier(*_args, **kwargs):
            self.assertTrue(kwargs["background"])
            events.append("hold")
            try: yield
            finally: events.append("release")
        with patch.object(annotation_activity, "deployed_runtime", return_value=Path("synthetic")), patch.object(annotation_activity, "protected_activity", barrier):
            annotation_activity.hold("fixture", timezone.now() + timedelta(seconds=10))
            self.assertEqual(events, ["hold"])
            annotation_activity.release("fixture")
            annotation_activity.release("fixture")
            self.assertEqual(events, ["hold", "release"])

    def test_existing_native_barrier_rejects_both_drain_phases_before_model(self):
        import json
        from teruisi_backend.automation_drain import PROTOCOL
        for phase in ["helpers", "requests"]:
            with TemporaryDirectory(prefix="annotation-drain-") as directory:
                root = Path(directory)
                (root / "run").mkdir()
                (root / "run/automation-drain.json").write_text(json.dumps({"version": PROTOCOL, "id": "a" * 32, "phase": phase, "runtimeRoot": str(root)}))
                with patch.object(annotation_activity, "deployed_runtime", return_value=root):
                    with self.assertRaises(AdmissionClosed):
                        annotation_activity.hold("rejected", timezone.now() + timedelta(seconds=10))
                self.assertNotIn("rejected", annotation_activity._leases)

    @skipUnless(os.name == "nt", "Windows native maintenance lock")
    def test_actual_native_exclusive_drain_waits_until_single_image_receipt(self):
        import ctypes
        import msvcrt
        from ctypes import wintypes
        class Overlapped(ctypes.Structure):
            _fields_ = [("Internal", ctypes.c_size_t), ("InternalHigh", ctypes.c_size_t), ("Offset", wintypes.DWORD), ("OffsetHigh", wintypes.DWORD), ("hEvent", wintypes.HANDLE)]
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        signature = [wintypes.HANDLE, wintypes.DWORD, wintypes.DWORD, wintypes.DWORD, wintypes.DWORD, ctypes.POINTER(Overlapped)]
        kernel.LockFileEx.argtypes = signature
        kernel.UnlockFileEx.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.DWORD, wintypes.DWORD, ctypes.POINTER(Overlapped)]
        with TemporaryDirectory(prefix="annotation-native-lock-") as directory:
            root = Path(directory)
            (root / "run").mkdir()
            with patch.object(annotation_activity, "deployed_runtime", return_value=root):
                annotation_activity.hold("native", timezone.now() + timedelta(seconds=10))
                try:
                    with (root / "run/automation-background.lock").open("a+b") as stream:
                        handle = msvcrt.get_osfhandle(stream.fileno())
                        overlapped = Overlapped()
                        self.assertFalse(kernel.LockFileEx(handle, 3, 0, 1, 0, ctypes.byref(overlapped)))
                        annotation_activity.release("native")
                        self.assertTrue(kernel.LockFileEx(handle, 3, 0, 1, 0, ctypes.byref(overlapped)))
                        self.assertTrue(kernel.UnlockFileEx(handle, 0, 1, 0, ctypes.byref(overlapped)))
                finally:
                    annotation_activity.release("native")
