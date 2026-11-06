"""Check the two assumptions under which the frozen migration policy stays dormant."""
import ast
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REHEARSAL = Path("tools/integration-migration-role-rehearsal.py")
MONITOR = Path(__file__).resolve().relative_to(ROOT)
CODE = {".py", ".ps1", ".psm1", ".cmd", ".bat", ".sh", ".mjs", ".js", ".ts", ".yml", ".yaml"}


def external_callers(root):
    tracked = subprocess.check_output(["git", "ls-files", "-z"], cwd=root).decode().split("\0")
    for name in filter(None, tracked):
        path = Path(name)
        if path in {REHEARSAL, MONITOR} or path.suffix.lower() not in CODE:
            continue
        data = (root / path).read_bytes()
        if b"--use-reviewed-policy" in data:
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
    protected = (runtime / "integration-installs" / "example" / "source").resolve()
    plan = {"operationId": "example"}
    env = {"Path": Path, "RUNTIME": runtime, "ROOT": protected, "PlanBlocked": Blocked,
           "read_json": lambda _: (plan, "hash"), "verify_deployment": lambda *a, **kw: plan,
           "delta_directory": lambda *a: protected.parent, "verify_delta_deployment": lambda *a, **kw: plan}
    exec(compile(ast.Module(body=[context], type_ignores=[]), str(path), "exec"), env)
    for operation in (None, "example"):
        env["ROOT"] = protected
        env["context"](runtime, operation)
        env["ROOT"] = root
        try:
            env["context"](runtime, operation)
        except Blocked:
            continue
        raise SystemExit("Installer accepted a source outside the protected snapshot")


if __name__ == "__main__":
    callers = list(external_callers(ROOT))
    if callers:
        raise SystemExit("Review the frozen policy callers: " + ", ".join(callers))
    check_installer(ROOT)
    print("Reviewed-policy caller and protected-source checks passed")
