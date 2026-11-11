"""Root operator for one installed Pandas broker. The CLI uses only fixed paths."""
import base64
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import secrets
import stat
import subprocess
import sys


MAX_REQUEST = 512 * 1024
MAX_SOURCE = 256 * 1024
MAX_FILE = 96 * 1024
USER = "teruisi-pandas"
UID = 1000
HOME = Path("/home/teruisi-pandas")
SOCKET = Path("/run/user/1000/docker.sock")
UNIT_NAME = "teruisi-pandas.service"
SOURCE_NAME = re.compile(r"[a-z_][a-z0-9_]{0,63}\.py")
SHA = re.compile(r"[a-f0-9]{64}")
BINDING = {"sourceCommit", "preparedAppId", "preparedAppSha256", "preparedManifestSha256",
           "windowsConfigSha256", "windowsKeySha256", "channelKeySha256", "image", "sourceSha256", "operatorSha256"}
OWNER = {"maintenanceId", "publicationOwnerPid"}


class Refused(ValueError):
    pass


def need(condition, code):
    if not condition:
        raise Refused(code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encode(value):
    return json.dumps(value, ensure_ascii=True, separators=(",", ":"), sort_keys=True, allow_nan=False).encode()


def decode(raw):
    def pairs(items):
        result = dict(items)
        need(len(result) == len(items), "duplicate_json_key")
        return result
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=lambda _: fail("invalid_json_constant"))


def fail(code):
    raise Refused(code)


def exact(value, keys):
    need(type(value) is dict and value.keys() == keys, "invalid_request_shape")


def fields(value, patterns):
    for key, pattern in patterns.items():
        need(type(value[key]) is str and re.fullmatch(pattern, value[key]) is not None, "invalid_binding")


def same_file(path, uid, mode, *, directory=False):
    info = path.lstat()
    need(info.st_uid == uid and stat.S_IMODE(info.st_mode) == mode
         and (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode) and info.st_nlink == 1),
         "unexpected_owner_mode_or_file_type")
    return info


def read_file(path, uid, mode, maximum=MAX_FILE):
    expected = same_file(path, uid, mode)
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), "rb") as stream:
        current = os.fstat(stream.fileno())
        need((current.st_dev, current.st_ino, current.st_ctime_ns) ==
             (expected.st_dev, expected.st_ino, expected.st_ctime_ns), "file_changed_during_read")
        raw = stream.read(maximum + 1)
    need(len(raw) <= maximum, "file_too_large")
    return raw


def sync_dir(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def create_file(path, raw, mode=0o400):
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode), "wb") as stream:
        os.fchmod(stream.fileno(), mode)
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())
    sync_dir(path.parent)


def replace_file(path, raw, mode=0o600):
    # Stage-then-replace, matching the one existing atomic-overwrite
    # precedent in this module (Rotation.replace_unit below): safe to call
    # repeatedly (e.g. a plan rechecked across several failing attempts)
    # without O_EXCL colliding with a stale previous diagnostic.
    stage = path.with_name("." + path.name + "." + secrets.token_hex(8) + ".pending")
    create_file(stage, raw, mode)
    os.replace(stage, path)
    sync_dir(path.parent)


def mismatched_fields(expected, actual):
    """Field-level diff for a diagnostic, independent of the pass/fail check.

    Both arguments are plain dicts of sha256 digests, uids, inode numbers,
    fixed paths or an image id -- none are credentials. Returns a sorted
    list of (field, expected, actual) triples; an empty list means the two
    dicts are equal, matching plain `==`.
    """
    keys = sorted(set(expected) | set(actual))
    return [(key, expected.get(key), actual.get(key)) for key in keys if expected.get(key) != actual.get(key)]


def create_dir(path, mode):
    path.mkdir(mode=mode)
    sync_dir(path.parent)


def source_digest(files):
    return sha(b"".join(name.encode() + b"\0" + raw for name, raw in sorted(files.items())))


def source_files(files):
    need(type(files) is dict and 1 <= len(files) <= 32 and all(
        SOURCE_NAME.fullmatch(name) and not name.startswith("test_") for name in files), "invalid_source_inventory")
    need({"__init__.py", "server.py", "protocol.py", "probe.py", "key_file.py", "wsl_control.py"} <= files.keys(),
         "missing_source_file")
    need(all(len(raw) <= MAX_FILE for raw in files.values()) and 0 < sum(map(len, files.values())) <= MAX_SOURCE,
         "source_limit")
    return {name: sha(raw) for name, raw in sorted(files.items())}


class Rotation:
    def __init__(self, *, operator_sha):
        # Test entry points may subclass these layout properties. No request can
        # select a WSL distribution, systemd unit, pathname, user, or command.
        self.operator_sha = operator_sha
        self.install = Path("/opt/teruisi-pandas")
        self.releases = self.install / "releases"
        self.control = self.install / "rotation"
        self.unit = Path("/etc/systemd/user") / UNIT_NAME
        self.config = HOME / ".config/teruisi-pandas"
        self.port = 8121
        self.distribution = "TERUISI-Pandas"
        self.unit_name = UNIT_NAME

    @property
    def state(self):
        return self.config / "state"

    def account(self):
        account = pwd.getpwnam(USER)
        need(os.geteuid() == 0 and account.pw_uid == UID and account.pw_dir == str(HOME), "dedicated_root_operator_required")
        for path in (self.install.parent, self.unit.parent, self.config.parent, HOME):
            info = path.lstat()
            need(stat.S_ISDIR(info.st_mode) and info.st_uid in {0, UID} and not info.st_mode & 0o022,
                 "unsafe_layout_parent")
        for path in (self.install.parent, self.unit.parent):
            need(path.lstat().st_uid == 0, "unsafe_root_layout_parent")
        same_file(self.install, 0, 0o555, directory=True)
        same_file(self.releases, 0, 0o555, directory=True)

    def user(self, *args):
        return self.command("/usr/sbin/runuser", "-u", USER, "--", "/usr/bin/env", "-i",
                            "PATH=/usr/bin:/bin", f"HOME={HOME}", "XDG_RUNTIME_DIR=/run/user/1000",
                            "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus", *args)

    def command(self, *args):
        result = subprocess.run(args, env={"PATH": "/usr/bin:/bin"}, stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=8, check=False)
        need(result.returncode == 0 and len(result.stdout) <= MAX_FILE, "native_dependency_failed")
        return result.stdout

    def docker(self, *args):
        return self.user("/usr/bin/docker", f"--host=unix://{SOCKET}", *args)

    def effective(self):
        properties = {"ActiveState", "SubState", "MainPID", "InvocationID", "FragmentPath", "DropInPaths",
                      "NeedDaemonReload", "Names", "LoadState"}
        raw = self.user("/usr/bin/systemctl", "--user", "show", "--no-pager",
                        "--property=" + ",".join(sorted(properties)), self.unit_name)
        values = dict(line.split("=", 1) for line in raw.decode().splitlines())
        fragment = Path(values.get("FragmentPath", ""))
        # Ubuntu can report its root-owned XDG compatibility directory. Only
        # that fixed alias of the very same installed file is accepted.
        alias = Path("/etc/xdg/systemd/user")
        if fragment == alias / self.unit_name:
            link = alias.lstat()
            for parent in (alias.parent, alias.parent.parent):
                info = parent.lstat()
                need(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022,
                     "unsafe_effective_unit_alias_parent")
            need(stat.S_ISLNK(link.st_mode) and link.st_uid == 0 and alias.resolve(strict=True) == self.unit.parent,
                 "effective_unit_alias_changed")
        need(values.keys() == properties and fragment in {self.unit, alias / self.unit_name}
             and fragment.resolve(strict=True) == self.unit
             and values["Names"] == self.unit_name and values["DropInPaths"] == ""
             and values["NeedDaemonReload"] == "no" and values["LoadState"] == "loaded"
             and values["MainPID"].isdigit(), "effective_unit_binding_changed")
        return values

    def config_identity(self, image):
        same_file(self.config, UID, 0o700, directory=True)
        same_file(self.state, UID, 0o700, directory=True)
        config = read_file(self.config / "broker.json", UID, 0o600, 4096)
        key = read_file(self.config / "key", UID, 0o600, 128)
        need(32 <= len(key) <= 128 and decode(config) == {
            "docker": "/usr/bin/docker", "socket": str(SOCKET), "image": image,
            "keyFile": str(self.config / "key"), "stateDirectory": str(self.state),
        }, "linux_config_binding_changed")
        socket = SOCKET.lstat()
        need(stat.S_ISSOCK(socket.st_mode) and socket.st_uid == UID, "rootless_socket_changed")
        info = decode(self.docker("info", "--format", "{{json .}}"))
        security = " ".join(info.get("SecurityOptions", []))
        need(info.get("OSType") == "linux" and info.get("CgroupVersion") == "2"
             and info.get("CgroupDriver") == "systemd" and "rootless" in security and "seccomp" in security
             and all(info.get(key) is True for key in ("MemoryLimit", "SwapLimit", "PidsLimit", "CpuCfsQuota")),
             "container_isolation_unavailable")
        images = decode(self.docker("image", "inspect", image))
        need(len(images) == 1 and images[0]["Id"] == image and images[0]["Os"] == "linux"
             and not images[0]["Config"].get("Volumes")
             and images[0]["Config"].get("Entrypoint") == ["python", "-I", "-B", "/opt/entrypoint.py"],
             "linux_image_binding_changed")
        ledger = same_file(self.state / "requests.sqlite3", UID, 0o600)
        # The nonce ledger can be written by the original service during prepare.
        # Its persistent identity, rather than volatile contents, is fenced.
        return {"configSha256": sha(config), "keySha256": sha(key), "ledgerDevice": ledger.st_dev,
                "ledgerInode": ledger.st_ino, "uid": UID, "socket": str(SOCKET), "state": str(self.state),
                "unit": str(self.unit), "distribution": self.distribution}

    def unit_bytes(self, digest):
        return f"""[Unit]
Description=TERUISI pandas controlled container broker
Requires=docker.service
After=docker.service

[Service]
Type=exec
WorkingDirectory={self.releases / digest}/backend
ExecStart=/usr/bin/python3 -B -m pandas_runner.server --config {self.config}/broker.json
Environment=PYTHONUTF8=1
UMask=0077
NoNewPrivileges=yes
PrivateTmp=yes
KillMode=mixed
TimeoutStopSec=35
Restart=no
StandardOutput=null
StandardError=null
""".encode()

    def read_release(self, digest):
        release = self.releases / digest
        backend = release / "backend"
        package = backend / "pandas_runner"
        for path in (release, backend, package):
            same_file(path, 0, 0o555, directory=True)
        need({p.name for p in release.iterdir()} == {"backend"}
             and {p.name for p in backend.iterdir()} == {"pandas_runner"}, "unexpected_release_entries")
        entries = list(package.iterdir())
        need(1 <= len(entries) <= 32, "invalid_source_inventory")
        files = {path.name: read_file(path, 0, 0o444) for path in entries}
        inventory = source_files(files)
        need(source_digest(files) == digest, "release_digest_changed")
        return inventory

    @contextmanager
    def lock(self, prepare=False):
        if prepare:
            try:
                create_dir(self.control, 0o700)
            except FileExistsError:
                pass
        same_file(self.control, 0, 0o700, directory=True)
        path = self.control / "rotation.lock"
        flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
        if prepare:
            flags |= os.O_CREAT
        descriptor = os.open(path, flags, 0o600)
        try:
            info = os.fstat(descriptor)
            need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == 0
                 and stat.S_IMODE(info.st_mode) == 0o600, "unsafe_rotation_lock")
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            yield
        finally:
            os.close(descriptor)

    def no_unfinished(self):
        paths = list(self.control.iterdir())
        need(len(paths) <= 128, "rotation_control_inventory_limit")
        for path in paths:
            if path.name == "rotation.lock":
                continue
            need(SHA.fullmatch(path.name) is not None, "unexpected_rotation_control_entry")
            same_file(path, 0, 0o700, directory=True)
            need((path / "plan.json").exists(), "unresolved_preparation")
            if (path / "intent.json").exists():
                need((path / "result.json").exists(), "original_switch_outcome_unresolved")
                result = decode(read_file(path / "result.json", 0, 0o400))
                need(result.get("completed") is True and result.get("registeredPlanSha256") == path.name,
                     "invalid_prior_result")

    def checked_plan(self, path, binding, *, successor):
        same_file(path, 0, 0o700, directory=True)
        raw = read_file(path / "plan.json", 0, 0o400)
        need(sha(raw) == path.name, "registered_plan_digest_changed")
        plan = decode(raw)
        # Unchanged decision: the exact same expression, in the exact same
        # short-circuit order (config_identity() is still only ever called
        # when plan["binding"] == binding), still a plain `==` comparison.
        verdict = plan["binding"] == binding and plan["linux"] == self.config_identity(binding["image"])
        if not verdict:
            # Diagnostics only, strictly after the real decision above is
            # already final. A second, separately-guarded config_identity()
            # call here is for the diagnostic alone; if it raises (e.g. the
            # container moved under us between the two calls), that must not
            # change or suppress the registered_plan_binding_changed below.
            self.record_binding_mismatch(path, plan, binding)
        need(verdict, "registered_plan_binding_changed")
        old = plan["predecessorSourceSha256"]
        new = binding["sourceSha256"]
        need(self.read_release(old) == plan["predecessorFiles"] and self.read_release(new) == plan["successorFiles"],
             "registered_release_changed")
        for name, digest in (("predecessor", old), ("successor", new)):
            unit = read_file(path / (name + ".unit"), 0, 0o400)
            need(unit == self.unit_bytes(digest) and sha(unit) == plan[name + "UnitSha256"], "registered_unit_changed")
        need(read_file(self.unit, 0, 0o644) == self.unit_bytes(new if successor else old), "unit_compare_and_swap_conflict")
        if successor:
            self.effective()
        else:
            self.predecessor_process(old)
        return plan

    def record_binding_mismatch(self, path, plan, binding):
        """Best-effort diagnostic for a registered_plan_binding_changed
        failure: write which of the 19 binding+linux fields differ, and
        both sides' values, into the failing plan's own control directory.

        None of these fields are credentials (sha256 digests, a uid, inode
        numbers, fixed paths, a systemd unit name, a WSL distribution name
        or an image id), so recording both sides is safe. Never allowed to
        change, widen or suppress the real pass/fail decision in
        checked_plan: any exception here is swallowed, because a failure to
        write a diagnostic must not replace or mask the real Refused.
        """
        try:
            mismatches = mismatched_fields(plan["binding"], binding)
            try:
                live_linux = self.config_identity(binding["image"])
            except Exception as error:
                live_linux = None
                mismatches.append(("linux", None, "config_identity_unavailable: " + type(error).__name__))
            else:
                mismatches += [("linux." + field, expected, actual)
                               for field, expected, actual in mismatched_fields(plan["linux"], live_linux)]
            payload = encode({
                "version": 1, "registeredPlanSha256": path.name,
                "mismatchedFields": [{"field": field, "registered": registered, "live": live}
                                     for field, registered, live in mismatches],
            })
            replace_file(path / "binding-mismatch-diagnostic.json", payload, 0o600)
        except Exception:
            pass

    def public(self, path, plan):
        keys = {"preparedAppId", "preparedAppSha256", "sourceCommit", "sourceSha256", "image"}
        return {key: plan["binding"][key] for key in keys} | {
            "configured": True, "registeredPlanSha256": path.name, "predecessorSourceSha256": plan["predecessorSourceSha256"]}

    def stale_plan_for_takeover(self, exclude, old, new, inventory, before, linux):
        """Narrow exception to `existing_release_requires_original_plan`.

        Every round of `prepare()` embeds a fresh `preparedAppId` (and the
        rest of `binding`) into `plan.json`, so the plan directory name (its
        own sha256) changes even when the source tree does not. If a prior
        round got as far as creating `releases/<new>` and then failed, or
        never switched, before this round's new plan directory name, the
        normal path at the `existing_release_requires_original_plan` check
        wedges forever: the new plan directory never existed to begin with.

        Returns the single eligible stale plan directory (a Path under
        `self.control`) to take over, or None if zero or more than one
        candidate qualifies, or any field disagrees -- callers must keep
        raising `existing_release_requires_original_plan` on None. Never
        mutates anything; the caller performs the actual takeover.

        Caller must already know `releases/<new>` exists; this re-verifies
        its content, ownership and mode match `inventory` exactly (the same
        full check `read_release` does when a fresh release is created) as
        one of the required conditions, not as a separate later step.
        """
        try:
            release_matches = self.read_release(new) == inventory
        except (Refused, OSError, ValueError, TypeError, KeyError):
            release_matches = False
        if not release_matches:
            return None
        candidates = []
        for path in self.control.iterdir():
            if path.name in {"rotation.lock", exclude.name}:
                continue
            if SHA.fullmatch(path.name) is None:
                continue
            try:
                same_file(path, 0, 0o700, directory=True)
                raw = read_file(path / "plan.json", 0, 0o400)
                need(sha(raw) == path.name, "stale_plan_digest_changed")
                plan = decode(raw)
            except (Refused, OSError, ValueError, TypeError, KeyError):
                continue
            if (path / "intent.json").exists() or (path / "result.json").exists() or (path / "switched.json").exists():
                continue
            if (plan.get("binding") or {}).get("sourceSha256") != new:
                continue
            if plan.get("predecessorSourceSha256") != old or plan.get("successorFiles") != inventory:
                continue
            if plan.get("predecessorUnitSha256") != sha(before):
                continue
            try:
                predecessor_unit = read_file(path / "predecessor.unit", 0, 0o400)
            except (OSError, ValueError):
                continue
            if predecessor_unit != before:
                continue
            if plan.get("linux") != linux:
                continue
            candidates.append((path, plan))
        if len(candidates) != 1:
            return None
        path, plan = candidates[0]
        entries = {p.name for p in path.iterdir()}
        if not entries <= {"plan.json", "predecessor.unit", "successor.unit", "binding-mismatch-diagnostic.json"}:
            return None
        if not {"plan.json", "predecessor.unit", "successor.unit"} <= entries:
            return None
        return path

    def create_plan_directory(self, path, raw, before, after):
        create_dir(path, 0o700)
        create_file(path / "predecessor.unit", before)
        create_file(path / "successor.unit", after)
        create_file(path / "plan.json", raw)

    def remove_stale_plan_directory(self, path):
        """Delete exactly the files a never-dispatched `prepare()` round can
        have left in a stale plan directory, then the now-empty directory
        itself. Refuses (raises, leaving the directory as-is) if any other
        entry is present -- callers must have already confirmed the entry
        set is a subset of the expected names before calling this."""
        entries = {p.name for p in path.iterdir()}
        allowed = {"plan.json", "predecessor.unit", "successor.unit", "binding-mismatch-diagnostic.json"}
        need(entries <= allowed, "stale_plan_unexpected_entries")
        for name in ("binding-mismatch-diagnostic.json", "predecessor.unit", "successor.unit", "plan.json"):
            target = path / name
            if target.exists():
                same_file(target, 0, 0o600 if name == "binding-mismatch-diagnostic.json" else 0o400)
                os.remove(target)
        sync_dir(path)
        path.rmdir()
        sync_dir(path.parent)

    def prepare(self, binding, request):
        old, new = request["predecessorSourceSha256"], binding["sourceSha256"]
        need(type(old) is str and SHA.fullmatch(old) is not None and old != new, "invalid_predecessor")
        raw_files = request["files"]
        need(type(raw_files) is dict and 1 <= len(raw_files) <= 32
             and all(type(value) is str for value in raw_files.values()), "invalid_source_inventory")
        files = {name: base64.b64decode(value, validate=True) for name, value in raw_files.items()}
        inventory = source_files(files)
        need(source_digest(files) == new, "candidate_source_digest_mismatch")
        self.no_unfinished()
        before, after = self.unit_bytes(old), self.unit_bytes(new)
        need(read_file(self.unit, 0, 0o644) == before, "unit_compare_and_swap_conflict")
        self.predecessor_process(old)
        plan = {"version": 1, "binding": binding, "linux": self.config_identity(binding["image"]),
                "predecessorSourceSha256": old, "predecessorFiles": self.read_release(old), "successorFiles": inventory,
                "predecessorUnitSha256": sha(before), "successorUnitSha256": sha(after)}
        need(plan["linux"]["keySha256"] == binding["channelKeySha256"], "channel_key_identity_mismatch")
        raw = encode(plan)
        path = self.control / sha(raw)
        replaced_stale_plan = None
        if path.exists():
            plan = self.checked_plan(path, binding, successor=False)
        else:
            release = self.releases / new
            if os.path.lexists(release):
                stale = self.stale_plan_for_takeover(path, old, new, inventory, before, plan["linux"])
                need(stale is not None, "existing_release_requires_original_plan")
                # Fix the discarded plan's identity (for the result only, never
                # written to disk) before the destructive step below, so a
                # later failure in this same takeover can never lose it.
                stale_raw = read_file(stale / "plan.json", 0, 0o400)
                stale_plan = decode(stale_raw)
                replaced_stale_plan = {"registeredPlanSha256": stale.name, "planSha256": sha(stale_raw),
                    "preparedAppId": stale_plan["binding"]["preparedAppId"],
                    "sourceCommit": stale_plan["binding"]["sourceCommit"]}
                self.remove_stale_plan_directory(stale)
                self.create_plan_directory(path, raw, before, after)
            else:
                package = release / "backend/pandas_runner"
                for directory in (release, package.parent, package):
                    create_dir(directory, 0o755)
                for name, content in sorted(files.items()):
                    create_file(package / name, content, 0o444)
                for directory in (package, package.parent, release):
                    directory.chmod(0o555)
                    sync_dir(directory)
                need(self.read_release(new) == inventory, "candidate_source_verification_failed")
                self.create_plan_directory(path, raw, before, after)
        result = self.public(path, plan) | {"prepared": True, "started": False}
        if replaced_stale_plan is not None:
            result["replacedStalePlan"] = replaced_stale_plan
        return result

    def stopped(self):
        effective = self.effective()
        need(effective["ActiveState"] == "inactive" and effective["SubState"] == "dead" and effective["MainPID"] == "0",
             "predecessor_unit_not_stopped")
        for process in Path("/proc").glob("[0-9]*"):
            try:
                if process.stat().st_uid != UID:
                    continue
                with (process / "cmdline").open("rb") as command:
                    argv = command.read(8193).split(b"\0")
                need(not (b"pandas_runner.server" in argv and str(self.config / "broker.json").encode() in argv),
                     "predecessor_process_still_running")
            except (FileNotFoundError, ProcessLookupError):
                continue
        need(not self.command("/usr/bin/ss", "-H", "-ltn", f"sport = :{self.port}").strip(), "pandas_port_still_bound")
        need(not self.docker("ps", "-aq", "--filter", "label=teruisi.pandas-broker=v1").strip()
             and not self.docker("ps", "-aq", "--filter", "name=^/teruisi-pandas-[a-f0-9]{32}$").strip(),
             "unresolved_pandas_container")

    def switch(self, path, binding, owner):
        self.no_unfinished()
        plan = self.checked_plan(path, binding, successor=False)
        ledger_lock = self.state / "broker.lock"
        expected = same_file(ledger_lock, UID, 0o600)
        with os.fdopen(os.open(ledger_lock, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), "rb") as stream:
            actual = os.fstat(stream.fileno())
            need((actual.st_dev, actual.st_ino) == (expected.st_dev, expected.st_ino), "broker_lock_changed")
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.stopped()
            intent = encode(self.public(path, plan) | owner | {
                "predecessorUnitSha256": plan["predecessorUnitSha256"], "successorUnitSha256": plan["successorUnitSha256"]})
            create_file(path / "intent.json", intent)
            self.replace_unit(path, plan)
            self.user("/usr/bin/systemctl", "--user", "daemon-reload")
            need(sha(read_file(self.unit, 0, 0o644)) == plan["successorUnitSha256"], "unit_cas_unverified")
            self.stopped()
            result = self.public(path, plan) | owner | {"status": "switched_stopped", "switched": True,
                                                        "started": False, "intentSha256": sha(intent)}
            create_file(path / "switched.json", encode(result))
            return result

    def replace_unit(self, path, plan):
        stage = self.unit.with_name("." + self.unit_name + "." + secrets.token_hex(8) + ".pending")
        create_file(stage, read_file(path / "successor.unit", 0, 0o400), 0o644)
        need(sha(read_file(self.unit, 0, 0o644)) == plan["predecessorUnitSha256"], "unit_compare_and_swap_conflict")
        os.replace(stage, self.unit)
        sync_dir(self.unit.parent)

    def switched(self, path, binding, owner):
        plan = self.checked_plan(path, binding, successor=True)
        intent = read_file(path / "intent.json", 0, 0o400)
        record = decode(read_file(path / "switched.json", 0, 0o400))
        expected = self.public(path, plan) | owner | {"status": "switched_stopped", "switched": True,
                                                       "started": False, "intentSha256": sha(intent)}
        need(record == expected, "original_switch_receipt_changed")
        return record

    def predecessor_process(self, source):
        unit = self.effective()
        if unit["ActiveState"] == "active":
            self.identity(source, unit)
        else:
            need(unit["ActiveState"] == "inactive" and unit["SubState"] == "dead" and unit["MainPID"] == "0",
                 "predecessor_process_state_unknown")

    def identity(self, source, unit=None):
        unit = self.effective() if unit is None else unit
        pid = int(unit["MainPID"])
        need(unit["ActiveState"] == "active" and unit["SubState"] == "running" and pid > 0
             and re.fullmatch(r"[a-f0-9]{32}", unit["InvocationID"]) is not None, "successor_process_unavailable")
        proc = Path("/proc") / str(pid)
        need(proc.stat().st_uid == UID and Path(os.readlink(proc / "exe")) == Path("/usr/bin/python3").resolve()
             and os.readlink(proc / "cwd") == str(self.releases / source / "backend")
             and (proc / "cmdline").read_bytes().split(b"\0") == [
                 b"/usr/bin/python3", b"-B", b"-m", b"pandas_runner.server", b"--config",
                 str(self.config / "broker.json").encode(), b""], "successor_process_identity_mismatch")
        return {"pid": pid, "invocationId": unit["InvocationID"],
                "startTicks": (proc / "stat").read_text().rsplit(")", 1)[1].split()[19]}

    def dispatch(self, request):
        self.account()
        need(type(request) is dict and request.get("action") in
             {"prepare", "check", "switch", "startup-check", "identity", "complete"}, "invalid_rotation_action")
        action = request["action"]
        need(request.keys() == {"action", "binding"} | ({"predecessorSourceSha256", "files"} if action == "prepare" else
            {"planSha256"} | ({"owner"} if action != "check" else set()) |
            ({"startupReceipt", "startupReceiptSha256"} if action == "complete" else set())), "invalid_request_shape")
        binding = request["binding"]
        exact(binding, BINDING)
        fields(binding, {key: (r"[a-f0-9]{40}" if key == "sourceCommit" else r"[a-f0-9]{32}" if key == "preparedAppId"
                               else r"sha256:[a-f0-9]{64}" if key == "image" else SHA) for key in BINDING})
        need(binding["operatorSha256"] == self.operator_sha, "operator_digest_changed")
        with self.lock(prepare=action == "prepare"):
            if action == "prepare":
                return self.prepare(binding, request)
            fields(request, {"planSha256": SHA})
            path = self.control / request["planSha256"]
            if action == "check":
                self.no_unfinished()
                return self.public(path, self.checked_plan(path, binding, successor=False)) | {
                    "prepared": True, "started": False, "checked": True}
            owner = request["owner"]
            exact(owner, OWNER)
            fields(owner, {"maintenanceId": r"[a-f0-9]{32}"})
            need(type(owner["publicationOwnerPid"]) is int and owner["publicationOwnerPid"] > 0, "invalid_publication_owner")
            if action == "switch":
                return self.switch(path, binding, owner)
            switched = self.switched(path, binding, owner)
            if action == "startup-check":
                need(not (path / "result.json").exists(), "original_switch_already_completed")
                self.stopped()
                return switched
            if action == "identity":
                return switched | {"processIdentity": self.identity(binding["sourceSha256"])}
            return self.complete(path, binding, switched, request)

    def complete(self, path, binding, switched, request):
        fields(request, {"startupReceiptSha256": SHA})
        raw = base64.b64decode(request["startupReceipt"], validate=True)
        need(0 < len(raw) <= 8192 and sha(raw) == request["startupReceiptSha256"], "startup_receipt_digest_changed")
        receipt = decode(raw)
        exact(receipt, {"version", "switch", "processIdentity", "signedStatus", "signedSelfTest", "applicationManifestSha256"})
        probe = {"status": "ready", "image": binding["image"], "cleanupVerified": True}
        need(receipt["version"] == 1 and receipt["switch"] == switched
             and receipt["applicationManifestSha256"] == binding["preparedManifestSha256"]
             and receipt["signedStatus"] == probe | {"selfTest": False}
             and receipt["signedSelfTest"] == probe | {"selfTest": True}, "original_signed_startup_unproved")
        result = {key: value for key, value in switched.items() if key not in {"status", "started", "switched"}} | {
            "status": "ready_verified", "completed": True, "postconditionsVerified": True,
            "startupReceiptSha256": request["startupReceiptSha256"]}
        result_path = path / "result.json"
        if result_path.exists():
            need(decode(read_file(result_path, 0, 0o400)) == result, "original_completion_binding_changed")
            return result
        need(receipt["processIdentity"] == self.identity(binding["sourceSha256"]), "original_startup_process_changed")
        create_file(result_path, encode(result))
        return result


def main(operator_sha):
    os.umask(0o077)
    try:
        raw = sys.stdin.buffer.read(MAX_REQUEST + 1)
        need(0 < len(raw) <= MAX_REQUEST, "invalid_request_length")
        result = Rotation(operator_sha=operator_sha).dispatch(decode(raw))
        print(encode(result).decode())
    except Refused as error:
        print(encode({"error": str(error)}).decode())
        raise SystemExit(1)
    except (OSError, ValueError, TypeError, KeyError, subprocess.SubprocessError):
        print('{"error":"rotation_dependency_or_state_unverified"}')
        raise SystemExit(1)
