"""Check frozen PG17 OWNER privilege data before merge; no database or writes.

JSON and the three existing Python literal forms are supported. This does not
audit collector SQL, control flow, runtime grants or future catalogue formats.
"""
import argparse
import ast
import json
from pathlib import Path

TABLE = frozenset("SELECT INSERT UPDATE DELETE TRUNCATE REFERENCES TRIGGER MAINTAIN".split())
SEQUENCE = frozenset("SELECT UPDATE USAGE".split())
JSON_CATALOGS = {
    "jd_logistics": False, "jd_monitor_preferences": False,
    "pi_agent": False, "pi_workspace": False,
    "tmall_warehouse": True, "workflow_automation": True,
    "ai_task_feedback_candidates": False, "ai_unified_tasks": False,
}


def unique_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key: " + key)
        result[key] = value
    return result


def missing_owner(acl, sequence=False):
    if not isinstance(acl, list):
        raise ValueError("ACL must be a list")
    grantee, privilege, grantable = (5, 3, 4) if sequence else (0, 1, 2)
    for row in acl:
        if (not isinstance(row, (list, tuple)) or len(row) != (6 if sequence else 3)
                or type(row[grantee]) is not str or type(row[privilege]) is not str
                or type(row[grantable]) is not bool):
            raise ValueError("invalid ACL row")
    owner = {row[privilege] for row in acl if row[grantee] == "OWNER"}
    return sorted((SEQUENCE if sequence else TABLE) - owner)


def assignment(nodes, name):
    values = [node.value for node in nodes if isinstance(node, ast.Assign)
              and any(isinstance(target, ast.Name) and target.id == name for target in node.targets)]
    if len(values) != 1:
        raise ValueError("expected one readable " + name + " assignment")
    return values[0]


def check(root):
    root, errors = Path(root), []

    def inspect(file, object_name, acl, sequence=False):
        missing = missing_owner(acl, sequence)
        if missing:
            errors.append({"file": file, "object": object_name, "missing": missing})

    def tables(file, data, needs_sequence=False):
        if not isinstance(data, dict) or not data:
            raise ValueError("catalogue must be a nonempty object")
        if needs_sequence and "sequence" not in data:
            raise ValueError("sequence baseline is missing")
        for name, value in data.items():
            inspect(file, name, value["acl"], sequence=name == "sequence")

    def read(file, reader):
        try:
            reader((root / file).read_text(encoding="utf-8-sig"))
        except (OSError, UnicodeError, ValueError, SyntaxError, KeyError, TypeError, AttributeError) as error:
            errors.append({"file": file, "error": str(error)})

    for name, needs_sequence in JSON_CATALOGS.items():
        file = "tools/" + name + "_catalog.json"
        read(file, lambda text, name=name: tables(file, (lambda data: data["tables"] if name in {"ai_task_feedback_candidates", "ai_unified_tasks"} else data)(json.loads(text, object_pairs_hook=unique_keys)), needs_sequence))

    file = "tools/ai_schedule_addition_catalog.py"
    read(file, lambda text: tables(file, ast.literal_eval(assignment(ast.parse(text).body, "REFERENCE142"))))

    for name in ("pi_business", "pi_native"):
        file = "tools/" + name + "_catalog.py"

        def python_owner(text):
            functions = [node for node in ast.parse(text).body
                         if isinstance(node, ast.FunctionDef) and node.name == "verify_catalog"]
            if len(functions) != 1:
                raise ValueError("verify_catalog definition is unreadable")
            owner = assignment(ast.walk(functions[0]), "owner")
            if not isinstance(owner, ast.SetComp) or len(owner.generators) != 1:
                raise ValueError("owner privilege literal is unreadable")
            privileges = ast.literal_eval(owner.generators[0].iter)
            if not isinstance(privileges, (tuple, list)) or any(type(p) is not str for p in privileges):
                raise ValueError("owner privileges must be string literals")
            inspect(file, "owner", [["OWNER", privilege, False] for privilege in privileges])

        read(file, python_owner)
    return {"status": "failed" if errors else "passed", "scope": "frozen-owner-privileges", "errors": errors}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    result = check(args.root)
    print(json.dumps(result, ensure_ascii=True))
    return 1 if result["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
