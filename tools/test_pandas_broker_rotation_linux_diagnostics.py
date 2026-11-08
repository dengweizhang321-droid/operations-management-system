"""Diagnostics for registered_plan_binding_changed, independent of the real
rootless Docker/systemd rehearsal in tests/pandas-broker-rotation-native.py.

pandas_broker_rotation_linux imports fcntl/pwd at module scope and nearly
every Rotation method requires real root ownership via same_file(path, 0,
...), so it is only ever meant to run inside the private Pandas WSL
distribution as root. This test is gated the same way and does not run on
Windows; it covers the two new, self-contained functions this diagnostic
change adds (mismatched_fields, replace_file) without needing root or a
real rootless Docker/systemd environment. checked_plan's wiring of these
two functions (see the comments at its call site) is covered by manual
review plus the existing real rehearsal in
tests/pandas-broker-rotation-native.py, which already asserts that a
mismatched field (e.g. preparedAppSha256) still raises exactly
Refused("registered_plan_binding_changed") -- unchanged by this diagnostic.
"""
import os
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parent))


@unittest.skipUnless(os.name == "posix", "pandas_broker_rotation_linux imports fcntl/pwd")
class MismatchedFieldsTests(unittest.TestCase):
    def setUp(self):
        import pandas_broker_rotation_linux as rotation
        self.rotation = rotation

    def test_equal_dicts_report_no_mismatch(self):
        value = {"a": "1", "b": "2"}
        self.assertEqual(self.rotation.mismatched_fields(value, dict(value)), [])

    def test_a_single_differing_field_is_reported_by_name_with_both_values(self):
        expected = {"sourceCommit": "a" * 40, "image": "sha256:" + "b" * 64}
        actual = {"sourceCommit": "a" * 40, "image": "sha256:" + "c" * 64}
        self.assertEqual(self.rotation.mismatched_fields(expected, actual),
                          [("image", "sha256:" + "b" * 64, "sha256:" + "c" * 64)])

    def test_multiple_differing_fields_are_all_reported_sorted_by_name(self):
        # "a" is unchanged (equal on both sides) and must be absent; only
        # the two genuinely differing fields are reported, in name order.
        expected = {"z": "1", "a": "2", "m": "3"}
        actual = {"z": "9", "a": "2", "m": "8"}
        self.assertEqual(self.rotation.mismatched_fields(expected, actual),
                          [("m", "3", "8"), ("z", "1", "9")])

    def test_a_key_present_on_only_one_side_is_reported_with_none_for_the_other(self):
        self.assertEqual(self.rotation.mismatched_fields({"onlyExpected": "1"}, {}),
                          [("onlyExpected", "1", None)])
        self.assertEqual(self.rotation.mismatched_fields({}, {"onlyActual": "1"}),
                          [("onlyActual", None, "1")])

    def test_the_real_19_binding_and_linux_identity_keys_round_trip(self):
        # Guards against BINDING or config_identity's return shape drifting
        # without this diagnostic's field names following along.
        binding_keys = sorted(self.rotation.BINDING)
        linux_keys = sorted(["configSha256", "keySha256", "ledgerDevice", "ledgerInode",
                              "uid", "socket", "state", "unit", "distribution"])
        self.assertEqual(len(binding_keys) + len(linux_keys), 19)
        expected = {key: "x" for key in binding_keys + linux_keys}
        actual = dict(expected, **{binding_keys[0]: "y"}, **{linux_keys[0]: "y"})
        reported = {field for field, _, _ in self.rotation.mismatched_fields(expected, actual)}
        self.assertEqual(reported, {binding_keys[0], linux_keys[0]})


@unittest.skipUnless(os.name == "posix", "pandas_broker_rotation_linux imports fcntl/pwd")
class ReplaceFileTests(unittest.TestCase):
    def setUp(self):
        import pandas_broker_rotation_linux as rotation
        self.rotation = rotation

    def test_creates_the_file_when_absent(self):
        with TemporaryDirectory() as temp:
            target = Path(temp) / "diagnostic.json"
            self.rotation.replace_file(target, b'{"a":1}', 0o600)
            self.assertEqual(target.read_bytes(), b'{"a":1}')

    def test_overwrites_an_existing_file_without_colliding_on_o_excl(self):
        # record_binding_mismatch may run more than once for the same plan
        # (e.g. prepare's own identity check followed by a later check
        # call hitting the same stale plan); this must not raise on a
        # second write the way create_file's O_EXCL would.
        with TemporaryDirectory() as temp:
            target = Path(temp) / "diagnostic.json"
            target.write_bytes(b"stale")
            self.rotation.replace_file(target, b"fresh", 0o600)
            self.assertEqual(target.read_bytes(), b"fresh")

    def test_leaves_no_staged_temp_file_behind(self):
        with TemporaryDirectory() as temp:
            target = Path(temp) / "diagnostic.json"
            self.rotation.replace_file(target, b"content", 0o600)
            self.assertEqual([p.name for p in Path(temp).iterdir()], ["diagnostic.json"])

    def test_writes_the_requested_mode(self):
        with TemporaryDirectory() as temp:
            target = Path(temp) / "diagnostic.json"
            self.rotation.replace_file(target, b"content", 0o600)
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)


if __name__ == "__main__":
    unittest.main()
