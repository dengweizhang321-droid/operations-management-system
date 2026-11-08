"""Import the explicitly named rehearsal harness without running its entry."""
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location('native_control_entry', Path(__file__).with_name('native-control-entry.py'))
entry = importlib.util.module_from_spec(spec)
spec.loader.exec_module(entry)
