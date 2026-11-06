"""Narrow AI159 ACL/guard contract, standard library only; no database.

Executes the real static database_contract grant definitions and the real
catalog comparison function against its reviewed PG17 snapshot. The independent
PG rehearsal proves collection SQL and real installation/provisioning.
"""
import ast
import copy
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
TABLES = ("ai_task_definitions", "ai_task_grants", "ai_task_incidents", "ai_task_revisions", "ai_task_runs")
OWNER = {("OWNER", name, False) for name in
         "SELECT INSERT UPDATE DELETE TRUNCATE REFERENCES TRIGGER MAINTAIN".split()}
WRITER = {("teruisi_ai_writer", name, False) for name in "SELECT INSERT UPDATE DELETE".split()}


def assignment(tree, name):
    nodes = [node.value for node in tree.body if isinstance(node, ast.Assign)
             and any(isinstance(target, ast.Name) and target.id == name for target in node.targets)]
    assert len(nodes) == 1, name
    return nodes[0]


def contract_grants():
    """The two models' literal keys plus the module's real grant statements."""
    path = ROOT / "backend/ai_assistant/database_contract.py"
    tree = ast.parse(path.read_text(encoding="utf8"))
    models = assignment(tree, "MODELS")
    assert isinstance(models, ast.Dict)
    # Expansions of PI/historical/control models do not introduce either table;
    # use explicit model keys so no Django model import or connection is needed.
    model_keys = {key.value for key in models.keys if isinstance(key, ast.Constant)} | set(TABLES)
    start = next(index for index, node in enumerate(tree.body)
                 if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name)
                 and target.id == "READ_TABLES" for target in node.targets))
    end = next(index for index, node in enumerate(tree.body)
               if isinstance(node, ast.FunctionDef) and node.name == "provision")
    namespace = {"MODELS": dict.fromkeys(model_keys)}
    exec(compile(ast.Module(body=tree.body[start:end], type_ignores=[]), str(path), "exec"), namespace)
    for table in TABLES:
        assert table in model_keys, table
        assert table not in namespace["READ_TABLES"], "AI reader must have zero grant: " + table
        assert tuple(namespace["WRITER_PRIVILEGES"][table]) == (("SELECT", "INSERT") if table == "ai_task_revisions" else ("SELECT", "INSERT", "UPDATE")), table


def catalog_gate():
    path = ROOT / "tools/ai_unified_tasks_catalog.py"
    tree = ast.parse(path.read_text(encoding="utf8"))
    function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "verify_tables")
    assert ast.literal_eval(assignment(tree, "TABLES")) == TABLES
    assert ast.literal_eval(assignment(tree, "FUNCTIONS")) == ("ai_unified_task_guard",)
    namespace = {"TABLES": TABLES, "json": json}
    exec(compile(ast.Module(body=[function], type_ignores=[]), str(path), "exec"), namespace)
    return namespace


reference = json.loads((ROOT / "tools/ai_unified_tasks_catalog.json").read_text(encoding="utf8"))
assert set(reference) == {"version", "migrationFiles", "tables", "functions"}
assert reference["version"] == "teruisi-ai-unified-tasks-catalog-v1"
assert set(reference["tables"]) == set(TABLES)
assert set(reference["functions"]) == {"public.ai_unified_task_guard()"}
contract_grants()
gate = catalog_gate()
checks = 0


class MembershipCursor:
    def execute(self, query, params):
        assert params == [list(TABLES)]
        assert "pg_class" in query
    def fetchall(self):
        return [(table,) for table in TABLES]


def run(actual, *, permissions=True):
    gate.update(expected=lambda: reference, capture=lambda cursor: actual,
                inspect_functions=lambda cursor: actual["functions"])
    gate["verify_tables"](MembershipCursor(), permissions=permissions)


def reject(actual, label, *, permissions=True):
    global checks
    try:
        run(actual, permissions=permissions)
    except ValueError:
        checks += 1
    else:
        raise AssertionError("AI159 ACL gate accepted: " + label)


run(copy.deepcopy(reference))
checks += 1
owner_only = copy.deepcopy(reference)
for table in TABLES:
    writer = {("teruisi_ai_writer", name, False) for name in (("SELECT", "INSERT") if table == "ai_task_revisions" else ("SELECT", "INSERT", "UPDATE"))}
    assert {tuple(row) for row in reference["tables"][table]["acl"]} == OWNER | writer
    assert reference["tables"][table]["columnAcl"] == []
    assert reference["tables"][table]["policies"] == []
    owner_only["tables"][table]["acl"] = [row for row in reference["tables"][table]["acl"] if row[0] == "OWNER"]
run(owner_only, permissions=False)
checks += 1
reject(owner_only, "finalize before provision")
reject(copy.deepcopy(reference), "early writer grant during owner-only install", permissions=False)

for table in TABLES:
    writer = {tuple(row) for row in reference["tables"][table]["acl"] if row[0] != "OWNER"}
    for row in sorted(OWNER | writer):
        changed = copy.deepcopy(reference)
        changed["tables"][table]["acl"].remove(list(row))
        reject(changed, table + " missing " + ":".join(map(str, row)))
    for row in [("teruisi_ai_reader", "SELECT", False), ("PUBLIC", "SELECT", False),
                ("teruisi_ai_writer", "TRUNCATE", False), ("teruisi_ai_writer", "INSERT", True)]:
        changed = copy.deepcopy(reference)
        changed["tables"][table]["acl"].append(list(row))
        reject(changed, table + " extra ACL " + ":".join(map(str, row)))
    changed = copy.deepcopy(owner_only)
    changed["tables"][table]["acl"].append(["teruisi_ai_reader", "SELECT", False])
    reject(changed, table + " install reader grant", permissions=False)


path = ROOT / "backend/ai_assistant/migrations/0090_unified_tasks.py"
tree = ast.parse(path.read_text(encoding="utf8"))
literal = ast.literal_eval(assignment(tree, "GUARD"))
assert not any(isinstance(node, ast.Constant) and isinstance(node.value, str)
    and re.search(r"\bGRANT\b", node.value, re.I) for node in ast.walk(tree)), "migration grants"
function = reference["functions"]["public.ai_unified_task_guard()"]
assert function["source"] == literal.split("$$", 2)[1]
assert function["owner"] == "teruisi_sales_owner" and function["securityDefiner"] is False
assert function["configuration"] == ["search_path=pg_catalog, public"]
for table in TABLES:
    triggers = {row[0]: row for row in reference["tables"][table]["triggers"]}
    assert triggers["ai_task_state"][3:5] == ["public", "ai_unified_task_guard"]
    assert triggers["ai_write_fence"][3:5] == ["public", "ai_runtime_write_fence"]
    assert ("ai_immutable_evidence" in triggers) == (table == "ai_task_revisions")
for key in ("source", "configuration", "securityDefiner", "acl"):
    changed = copy.deepcopy(reference)
    changed["functions"]["public.ai_unified_task_guard()"][key] = "tampered"
    reject(changed, "guard:" + key)
print(f"AI159_ACL_CATALOG_CONTRACT_PASSED tables=5 functions=1 checks={checks} no_database=True")
