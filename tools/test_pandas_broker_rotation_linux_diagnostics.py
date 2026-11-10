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

StalePlanTakeoverTests below cover the later `existing_release_requires_
original_plan` narrow-takeover addition (stale_plan_for_takeover,
remove_stale_plan_directory, and prepare()'s wiring of both) the same way:
synthetic root-owned fixtures under a TemporaryDirectory, no real systemd
or Docker. They call Rotation.prepare() directly, so Rotation.account()
(the dispatch()-only pwd/UID-1000 gate) never runs and no dedicated
"teruisi-pandas" system account is required -- only root, for the 0o555/
0o700 root-owned directories same_file() checks everywhere else.
"""
import base64
import json
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


@unittest.skipUnless(os.name == "posix" and os.geteuid() == 0,
                      "pandas_broker_rotation_linux requires real root for same_file() ownership checks")
class StalePlanTakeoverTests(unittest.TestCase):
    """Synthetic root-owned fixture for the `existing_release_requires_
    original_plan` narrow takeover. No real systemd unit or Docker: Fixture
    overrides `effective()` (predecessor_process's only dependency, fixed
    "inactive"/"dead"/"0" so predecessor_process() is satisfied without a
    unit) and `config_identity()` (returns a fixed, self-consistent linux
    identity dict instead of touching Docker). Every directory this test
    creates is explicitly chowned to root so the module's pervasive
    `same_file(path, 0, ...)` checks pass the same way they would against
    the real root-owned /opt/teruisi-pandas layout.
    """

    IMAGE = "sha256:" + "a" * 64
    LINUX = {"configSha256": "b" * 64, "keySha256": "c" * 64, "ledgerDevice": 1, "ledgerInode": 2,
              "uid": 1000, "socket": "/run/user/1000/docker.sock", "state": "/fake/state",
              "unit": "/fake/unit", "distribution": "TERUISI-Pandas"}

    def setUp(self):
        import pandas_broker_rotation_linux as module
        self.module = module
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)

        class Fixture(module.Rotation):
            def effective(self):
                return {"ActiveState": "inactive", "SubState": "dead", "MainPID": "0"}

            def config_identity(self, image):
                return dict(StalePlanTakeoverTests.LINUX)

        fixture = Fixture(operator_sha="d" * 64)
        fixture.install = root / "install"
        fixture.releases = fixture.install / "releases"
        fixture.control = fixture.install / "rotation"
        fixture.unit = root / "unit.service"
        fixture.config = root / "config"
        self.fixture = fixture
        self.root = root

        fixture.install.mkdir(mode=0o555)
        fixture.releases.mkdir(mode=0o555)
        fixture.control.mkdir(mode=0o700)
        os.chown(fixture.install, 0, 0)
        os.chown(fixture.releases, 0, 0)
        os.chown(fixture.control, 0, 0)

    def source_files(self, extra=b""):
        return {"__init__.py": b"" + extra, "server.py": b"x", "protocol.py": b"x", "probe.py": b"x",
                "key_file.py": b"x", "wsl_control.py": b"x"}

    def install_release(self, digest, files):
        module = self.module
        package = self.fixture.releases / digest / "backend/pandas_runner"
        package.mkdir(parents=True, mode=0o755)
        for name, content in sorted(files.items()):
            module.create_file(package / name, content, 0o444)
        for directory in (package, package.parent, package.parent.parent):
            directory.chmod(0o555)
            os.chown(directory, 0, 0)
        for path in package.iterdir():
            os.chown(path, 0, 0)

    def write_unit(self, digest):
        module = self.module
        module.create_file(self.fixture.unit, self.fixture.unit_bytes(digest), 0o644)
        os.chown(self.fixture.unit, 0, 0)

    def binding(self, source_sha, prepared_app_id="1" * 32):
        return {"sourceCommit": "2" * 40, "preparedAppId": prepared_app_id, "preparedAppSha256": "3" * 64,
                "preparedManifestSha256": "4" * 64, "windowsConfigSha256": "5" * 64, "windowsKeySha256": "6" * 64,
                "channelKeySha256": self.LINUX["keySha256"], "image": self.IMAGE, "sourceSha256": source_sha,
                "operatorSha256": "7" * 64}

    def request(self, old_sha, files):
        return {"predecessorSourceSha256": old_sha,
                "files": {name: base64.b64encode(content).decode() for name, content in files.items()}}

    def make_stale_plan(self, old_sha, new_sha, old_files, new_files, *, prepared_app_id="8" * 32,
                         intent=False, result=False, switched=False, extra_file=None,
                         different_linux=False, different_predecessor_unit=False):
        """Write a plan directory shaped exactly like a never-finished
        `prepare()` round for (old_sha -> new_sha), independent of calling
        `prepare()` itself, so each eligibility condition can be broken one
        at a time without the other conditions interfering."""
        module = self.module
        inventory = module.source_files(new_files)
        before = self.fixture.unit_bytes(old_sha)
        linux = dict(self.LINUX)
        if different_linux:
            linux["configSha256"] = "9" * 64
        plan = {"version": 1, "binding": self.binding(new_sha, prepared_app_id), "linux": linux,
                "predecessorSourceSha256": old_sha, "predecessorFiles": module.source_files(old_files),
                "successorFiles": inventory, "predecessorUnitSha256": module.sha(before),
                "successorUnitSha256": module.sha(self.fixture.unit_bytes(new_sha))}
        raw = module.encode(plan)
        path = self.fixture.control / module.sha(raw)
        path.mkdir(mode=0o700)
        os.chown(path, 0, 0)
        stored_before = before if not different_predecessor_unit else before.replace(b"Restart=no", b"Restart=yes")
        module.create_file(path / "predecessor.unit", stored_before)
        module.create_file(path / "successor.unit", self.fixture.unit_bytes(new_sha))
        module.create_file(path / "plan.json", raw)
        for name in ("predecessor.unit", "successor.unit", "plan.json"):
            os.chown(path / name, 0, 0)
        if intent:
            module.create_file(path / "intent.json", b"{}")
            os.chown(path / "intent.json", 0, 0)
        if result:
            # no_unfinished() requires any plan directory with intent.json to
            # also carry a well-formed completed result.json (completed is
            # True, registeredPlanSha256 matches the directory name) or it
            # raises invalid_prior_result before the takeover check is ever
            # reached. Use a real completed receipt so this fixture exercises
            # the takeover's own "no result.json" condition, not that
            # earlier, unrelated gate.
            module.create_file(path / "result.json",
                                module.encode({"completed": True, "registeredPlanSha256": path.name}))
            os.chown(path / "result.json", 0, 0)
        if switched:
            module.create_file(path / "switched.json", b"{}")
            os.chown(path / "switched.json", 0, 0)
        if extra_file:
            (path / extra_file).write_bytes(b"x")
            os.chown(path / extra_file, 0, 0)
            (path / extra_file).chmod(0o400)
        return path, plan

    def prepare_round(self, old_sha, new_files, old_files=None):
        old_files = old_files or self.source_files()
        new_sha = self.module.source_digest(new_files)
        return self.fixture.prepare(self.binding(new_sha), self.request(old_sha, new_files)), new_sha

    def snapshot(self):
        """(set of all paths under install, each file's bytes) -- used to
        assert zero filesystem change on every refusal path."""
        paths = sorted(str(p.relative_to(self.root)) for p in self.root.rglob("*"))
        contents = {str(p.relative_to(self.root)): p.read_bytes() for p in self.root.rglob("*") if p.is_file()}
        return paths, contents

    def test_stale_plan_with_no_intent_result_or_switched_is_taken_over(self):
        old_files = self.source_files()
        old_sha = self.module.source_digest(old_files)
        self.install_release(old_sha, old_files)
        self.write_unit(old_sha)

        new_files = self.source_files(b"v1")
        new_sha = self.module.source_digest(new_files)
        self.install_release(new_sha, new_files)
        stale_path, _ = self.make_stale_plan(old_sha, new_sha, old_files, new_files, prepared_app_id="8" * 32)
        release_dir = self.fixture.releases / new_sha
        before_identity = {str(p.relative_to(release_dir)): (p.stat().st_ino, p.stat().st_dev, p.stat().st_mtime_ns)
                            for p in release_dir.rglob("*")}

        result = self.fixture.prepare(self.binding(new_sha, prepared_app_id="9" * 32),
                                       self.request(old_sha, new_files))

        self.assertTrue(result["prepared"])
        self.assertEqual(result["preparedAppId"], "9" * 32)
        self.assertFalse(stale_path.exists())
        self.assertIn("replacedStalePlan", result)
        self.assertEqual(result["replacedStalePlan"]["registeredPlanSha256"], stale_path.name)
        self.assertEqual(result["replacedStalePlan"]["preparedAppId"], "8" * 32)
        self.assertEqual(result["replacedStalePlan"]["planSha256"], stale_path.name)
        after_identity = {str(p.relative_to(release_dir)): (p.stat().st_ino, p.stat().st_dev, p.stat().st_mtime_ns)
                          for p in release_dir.rglob("*")}
        self.assertEqual(before_identity, after_identity, "release reused byte-for-byte, same inodes")
        # The new plan directory exists and is independently well formed;
        # rotation/ holds exactly that one plan directory, no orphan left.
        new_plan_path = self.fixture.control / result["registeredPlanSha256"]
        self.assertEqual({p.name for p in new_plan_path.iterdir()},
                          {"plan.json", "predecessor.unit", "successor.unit"})
        self.assertEqual({p.name for p in self.fixture.control.iterdir()}, {new_plan_path.name})

    def test_second_round_after_takeover_also_takes_over_cleanly(self):
        old_files = self.source_files()
        old_sha = self.module.source_digest(old_files)
        self.install_release(old_sha, old_files)
        self.write_unit(old_sha)
        new_files = self.source_files(b"v1")
        new_sha = self.module.source_digest(new_files)
        self.install_release(new_sha, new_files)
        self.make_stale_plan(old_sha, new_sha, old_files, new_files, prepared_app_id="8" * 32)

        first = self.fixture.prepare(self.binding(new_sha, prepared_app_id="9" * 32),
                                      self.request(old_sha, new_files))
        first_plan_path = self.fixture.control / first["registeredPlanSha256"]
        self.assertTrue(first_plan_path.exists())

        second = self.fixture.prepare(self.binding(new_sha, prepared_app_id="a" * 32),
                                       self.request(old_sha, new_files))
        self.assertTrue(second["prepared"])
        self.assertEqual(second.get("replacedStalePlan", {}).get("preparedAppId"), "9" * 32)
        self.assertFalse(first_plan_path.exists())
        self.assertEqual({p.name for p in (self.fixture.control / second["registeredPlanSha256"]).iterdir()},
                          {"plan.json", "predecessor.unit", "successor.unit"})

    def _blocked_takeover(self, **kwargs):
        old_files = self.source_files()
        old_sha = self.module.source_digest(old_files)
        self.install_release(old_sha, old_files)
        self.write_unit(old_sha)
        new_files = self.source_files(b"v1")
        new_sha = self.module.source_digest(new_files)
        self.install_release(new_sha, new_files)
        self.make_stale_plan(old_sha, new_sha, old_files, new_files, **kwargs)
        before = self.snapshot()
        with self.assertRaises(self.module.Refused) as caught:
            self.fixture.prepare(self.binding(new_sha, prepared_app_id="9" * 32), self.request(old_sha, new_files))
        self.assertEqual(str(caught.exception), "existing_release_requires_original_plan")
        self.assertEqual(before, self.snapshot())

    def test_stale_plan_with_intent_is_not_taken_over(self):
        self._blocked_takeover(intent=True, result=True)

    def test_stale_plan_with_result_is_not_taken_over(self):
        self._blocked_takeover(intent=True, result=True, switched=True)

    def test_stale_plan_with_switched_is_not_taken_over(self):
        self._blocked_takeover(switched=True)

    def test_stale_plan_with_mismatched_predecessor_unit_is_not_taken_over(self):
        self._blocked_takeover(different_predecessor_unit=True)

    def test_stale_plan_with_different_linux_identity_is_not_taken_over(self):
        self._blocked_takeover(different_linux=True)

    def test_stale_plan_with_extra_file_is_not_taken_over(self):
        self._blocked_takeover(extra_file="unexpected.json")

    def test_two_eligible_stale_candidates_block_takeover(self):
        old_files = self.source_files()
        old_sha = self.module.source_digest(old_files)
        self.install_release(old_sha, old_files)
        self.write_unit(old_sha)
        new_files = self.source_files(b"v1")
        new_sha = self.module.source_digest(new_files)
        self.install_release(new_sha, new_files)
        self.make_stale_plan(old_sha, new_sha, old_files, new_files, prepared_app_id="8" * 32)
        self.make_stale_plan(old_sha, new_sha, old_files, new_files, prepared_app_id="b" * 32)
        before = self.snapshot()
        with self.assertRaises(self.module.Refused) as caught:
            self.fixture.prepare(self.binding(new_sha, prepared_app_id="9" * 32), self.request(old_sha, new_files))
        self.assertEqual(str(caught.exception), "existing_release_requires_original_plan")
        self.assertEqual(before, self.snapshot())

    def test_release_content_different_from_inventory_blocks_takeover(self):
        old_files = self.source_files()
        old_sha = self.module.source_digest(old_files)
        self.install_release(old_sha, old_files)
        self.write_unit(old_sha)
        new_files = self.source_files(b"v1")
        new_sha = self.module.source_digest(new_files)
        self.install_release(new_sha, new_files)
        self.make_stale_plan(old_sha, new_sha, old_files, new_files, prepared_app_id="8" * 32)
        # Mutate the on-disk release after the stale plan recorded it as
        # successorFiles, exactly like read_release() would detect: a file
        # changed without the containing directory's digest-bearing name
        # changing (same `new_sha` leaf, different file bytes).
        target = self.fixture.releases / new_sha / "backend/pandas_runner/server.py"
        target.chmod(0o600)
        target.write_bytes(b"mutated")
        target.chmod(0o444)
        before = self.snapshot()
        with self.assertRaises(self.module.Refused) as caught:
            self.fixture.prepare(self.binding(new_sha, prepared_app_id="9" * 32), self.request(old_sha, new_files))
        self.assertEqual(str(caught.exception), "existing_release_requires_original_plan")
        self.assertEqual(before, self.snapshot())

    def test_release_with_extra_file_blocks_takeover(self):
        old_files = self.source_files()
        old_sha = self.module.source_digest(old_files)
        self.install_release(old_sha, old_files)
        self.write_unit(old_sha)
        new_files = self.source_files(b"v1")
        new_sha = self.module.source_digest(new_files)
        self.install_release(new_sha, new_files)
        self.make_stale_plan(old_sha, new_sha, old_files, new_files, prepared_app_id="8" * 32)
        package = self.fixture.releases / new_sha / "backend/pandas_runner"
        package.chmod(0o755)
        extra = package / "extra_module.py"
        extra.write_bytes(b"x")
        os.chown(extra, 0, 0)
        extra.chmod(0o444)
        package.chmod(0o555)
        before = self.snapshot()
        with self.assertRaises(self.module.Refused) as caught:
            self.fixture.prepare(self.binding(new_sha, prepared_app_id="9" * 32), self.request(old_sha, new_files))
        self.assertEqual(str(caught.exception), "existing_release_requires_original_plan")
        self.assertEqual(before, self.snapshot())

    def test_no_release_and_no_stale_plan_still_creates_normally(self):
        # Baseline: the ordinary, pre-existing creation path (no takeover
        # involved) is unaffected by this change.
        old_files = self.source_files()
        old_sha = self.module.source_digest(old_files)
        self.install_release(old_sha, old_files)
        self.write_unit(old_sha)
        new_files = self.source_files(b"v1")

        result, new_sha = self.prepare_round(old_sha, new_files)
        self.assertTrue(result["prepared"])
        self.assertNotIn("replacedStalePlan", result)
        self.assertTrue((self.fixture.releases / new_sha).exists())


if __name__ == "__main__":
    unittest.main()
