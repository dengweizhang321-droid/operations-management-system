"""Check the two assumptions under which the frozen migration policy stays dormant."""
import ast
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REHEARSAL = Path("tools/integration-migration-role-rehearsal.py")
MONITOR = Path(__file__).resolve().relative_to(ROOT)
CODE = {".py", ".ps1", ".psm1", ".cmd", ".bat", ".sh", ".mjs", ".js", ".ts", ".yml", ".yaml", ".tsx", ".jsx", ".bash", ".zsh", ".fish", ".psd1", ".cts", ".cjs", ".mts"}


OPTION = "--use-reviewed-policy"
PREFIXES = {OPTION[:n] for n in range(3, len(OPTION) + 1)}


def external_callers(root):
    tracked = subprocess.check_output(["git", "ls-files", "-z"], cwd=root).decode().split("\0")
    for name in filter(None, tracked):
        path = Path(name)
        if path in {REHEARSAL, MONITOR}:
            continue
        if path.suffix.lower() not in CODE and path.name != "package.json" and path.suffix:
            continue
        source = root / path
        if not source.is_file():
            continue
        data = source.read_bytes()
        if not path.suffix and not data.startswith(b"#!"):
            continue
        if data.startswith((b"\xff\xfe", b"\xfe\xff")):
            code = data.decode("utf-16")
        else:
            code = data.decode("utf-8-sig", errors="replace")
        if path.name == "package.json":
            code = "\n".join(json.loads(code).get("scripts", {}).values())
        # argparse accepts any unambiguous prefix starting at "--u".
        # Report a possible invocation for human review, not proof of execution.
        if any(match.group(0) in PREFIXES for match in re.finditer(r"(?<![\w-])--[\w-]+", code)):
            yield name
        # One wrapper loads the rehearsal Python module directly. A changed
        # reviewed_policy argument must be reviewed even without a CLI flag.
        elif path.suffix == ".py" and REHEARSAL.name.encode() in data:
            tree = ast.parse(data)
            local_functions = {node.name for node in tree.body if isinstance(node, ast.FunctionDef)}
            for call in ast.walk(tree):
                if not isinstance(call, ast.Call):
                    continue
                func = call.func
                attr = getattr(func, "attr", getattr(func, "id", ""))
                if isinstance(func, ast.Name) and attr in local_functions:
                    continue
                position = {"worker": 3, "run_probe": 4}.get(attr)
                if position is None:
                    continue
                arg = next((kw.value for kw in call.keywords if kw.arg == "reviewed_policy"), None)
                if arg is None and len(call.args) > position:
                    arg = call.args[position]
                if not isinstance(arg, ast.Constant) or arg.value is not False:
                    yield f"{name}:{call.lineno}"


def check_installer(root):
    path = root / "tools/integration_install.py"
    module = ast.parse(path.read_bytes())
    context = next(node for node in module.body if isinstance(node, ast.FunctionDef) and node.name == "context")
    # Execute the real context function with in-memory plan reads and no
    # database or filesystem access beyond Path.resolve(). Deployment checks
    # must be reached only when running from the protected source snapshot.
    class Blocked(Exception):
        pass

    runtime = root / "synthetic-runtime"
    operation_id = "1" * 32
    baseline = runtime / "integration-installs" / "example"
    delta = runtime / "integration-deltas" / operation_id
    plan = {"operationId": "example"}
    env = {"Path": Path, "RUNTIME": runtime, "PlanBlocked": Blocked,
           "read_json": lambda _: (plan, "hash"), "verify_deployment": lambda *a, **kw: plan,
           "delta_directory": lambda runtime, key: runtime / "integration-deltas" / key,
           "verify_delta_deployment": lambda *a, **kw: plan}
    root_binding = [n for n in module.body if isinstance(n, ast.Assign)
                    and any(isinstance(t, ast.Name) and t.id == "ROOT" for t in n.targets)]
    if len(root_binding) != 1:
        raise SystemExit("Review the installer's ROOT binding")
    exec(compile(ast.Module(body=[context], type_ignores=[]), str(path), "exec"), env)
    for operation, target in ((None, baseline), (operation_id, delta)):
        protected = (target / "source").resolve()
        for tree in (protected, root, runtime / "app", (baseline if operation else delta) / "source",
                     target.parent / "sibling" / "source"):
            env["__file__"] = str(tree / "tools" / "integration_install.py")
            exec(compile(ast.Module(body=root_binding, type_ignores=[]), str(path), "exec"), env)
            if env["ROOT"] != tree.resolve():
                raise SystemExit("Installer ROOT is not bound to the executing source tree")
            try:
                result = env["context"](runtime, operation)
            except Blocked:
                if tree.resolve() == protected:
                    raise
            else:
                if tree.resolve() != protected or result[0] != target:
                    raise SystemExit("Installer accepted a source outside the protected snapshot")

    # Call the actual entrypoint functions with the guard replaced by a
    # sentinel. No database, environment mutation or command may precede it.
    class GuardReached(Exception):
        pass

    def guard(observed_root, operation_id=None):
        if (observed_root, operation_id) != (runtime, expected):
            raise SystemExit("Installer guard received a different runtime or operation")
        raise GuardReached

    env["context"] = guard
    for name in ("install", "finalize"):
        node = next(n for n in module.body if isinstance(n, ast.FunctionDef) and n.name == name)
        exec(compile(ast.Module(body=[node], type_ignores=[]), str(path), "exec"), env)
        for expected in (None, operation_id, "2" * 32):
            try:
                env[name](runtime, expected)
            except GuardReached:
                continue
            raise SystemExit(f"Installer {name} did not call the protected-source guard")


if __name__ == "__main__":
    callers = list(external_callers(ROOT))
    if callers:
        raise SystemExit("Review the frozen policy callers: " + ", ".join(callers))
    check_installer(ROOT)
    print("Reviewed-policy caller and protected-source checks passed")
