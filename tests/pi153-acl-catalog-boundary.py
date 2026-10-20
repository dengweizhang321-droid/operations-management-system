"""Static Pi153 ACL contract check; no database, no Django import.

Pi153 adds seven native tables. The migration declares which of them are
append-only; the native catalog must grant the AI writer UPDATE only on the
mutable tables. This is the 153 successor of the Pi152 boundary check.
"""
import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "tools/pi_native_catalog.py"
BUSINESS_CATALOG = ROOT / "tools/pi_business_catalog.py"
MIGRATION = ROOT / "backend/ai_assistant/migrations/0087_pi_native_capabilities.py"

EXPECTED_TABLES = {
    "ai_pi_agent_messages",
    "ai_pi_agent_waits",
    "ai_pi_agents",
    "ai_pi_business_delegations",
    "ai_pi_file_handoffs",
    "ai_pi_plan_revisions",
    "ai_pi_native_states",
}
EXPECTED_APPEND_ONLY = {
    "ai_pi_agent_messages",
    "ai_pi_file_handoffs",
    "ai_pi_plan_revisions",
}
# verify_catalog compares the SQL ORDER BY relname result with list(TABLES).
EXPECTED_CATALOG_ORDER = tuple(sorted(EXPECTED_TABLES))


def top_level_assignments(path, names):
    tree = ast.parse(path.read_text(encoding="utf-8"))
    values = {}
    for node in tree.body:
        if (
            isinstance(node, ast.Assign)
            and len(node.targets) == 1
            and isinstance(node.targets[0], ast.Name)
            and node.targets[0].id in names
        ):
            values[node.targets[0].id] = ast.literal_eval(node.value)
    return values


def catalog_table_order():
    tree = ast.parse(CATALOG.read_text(encoding="utf-8"))
    node = next(
        item
        for item in tree.body
        if isinstance(item, ast.Assign)
        and len(item.targets) == 1
        and isinstance(item.targets[0], ast.Name)
        and item.targets[0].id == "TABLES"
    )
    value = node.value
    if isinstance(value, ast.Tuple):
        return ast.literal_eval(value)
    if (
        isinstance(value, ast.Call)
        and isinstance(value.func, ast.Name)
        and value.func.id == "tuple"
        and value.args
        and isinstance(value.args[0], ast.Call)
        and isinstance(value.args[0].func, ast.Name)
        and value.args[0].func.id == "sorted"
        and value.args[0].args
    ):
        return tuple(sorted(ast.literal_eval(value.args[0].args[0])))
    raise AssertionError("Pi153 catalog TABLES must be a tuple or tuple(sorted(...))")


def acl_block():
    tree = ast.parse(CATALOG.read_text(encoding="utf-8"))
    function = next(
        node
        for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name == "verify_catalog"
    )
    body = next(node for node in function.body if isinstance(node, ast.For)).body
    start = next(
        index
        for index, node in enumerate(body)
        if isinstance(node, ast.Assign)
        and isinstance(node.targets[0], ast.Name)
        and node.targets[0].id == "owner"
    )
    statements = body[start : start + 4]
    names = [
        node.targets[0].id
        for node in statements
        if isinstance(node, ast.Assign)
        and len(node.targets) == 1
        and isinstance(node.targets[0], ast.Name)
    ]
    assert names[:3] == ["owner", "privileges", "expected_acl"], names
    assert isinstance(statements[3], ast.If) and "expected_acl" in ast.unparse(
        statements[3].test
    )
    return compile(
        ast.Module(body=statements, type_ignores=[]), str(CATALOG), "exec"
    )


migration = top_level_assignments(MIGRATION, {"TABLES", "APPEND_ONLY"})
assert set(migration["TABLES"]) == EXPECTED_TABLES, migration.get("TABLES")
assert set(migration["APPEND_ONLY"]) == EXPECTED_APPEND_ONLY, migration.get(
    "APPEND_ONLY"
)
assert set(migration["APPEND_ONLY"]) <= set(migration["TABLES"])

catalog_tables = catalog_table_order()
assert tuple(catalog_tables) == EXPECTED_CATALOG_ORDER, catalog_tables

# The delegation table is added by the Pi153 native branch, not by the unchanged
# Pi152 business table tuple.
business_tables = top_level_assignments(BUSINESS_CATALOG, {"TABLES"})["TABLES"]
assert "ai_pi_business_delegations" in EXPECTED_TABLES
assert "ai_pi_business_delegations" not in business_tables
assert "ai_pi_business_delegations" in BUSINESS_CATALOG.read_text(encoding="utf-8")

block = acl_block()
owner = {
    ("OWNER", privilege, False)
    for privilege in (
        "DELETE",
        "INSERT",
        "MAINTAIN",
        "REFERENCES",
        "SELECT",
        "TRIGGER",
        "TRUNCATE",
        "UPDATE",
    )
}
append_only = frozenset(EXPECTED_APPEND_ONLY)


class AclCursor:
    def __init__(self, rows):
        self.rows = set(rows)

    def fetchall(self):
        return self.rows


MIGRATION_STUB = type("M", (), {"APPEND_ONLY": append_only})


def run_acl(table, actual, permissions):
    exec(
        block,
        {
            "table": table,
            "cursor": AclCursor(actual),
            "permissions": permissions,
            "migration": MIGRATION_STUB,
        },
    )


checks = 0
for table in sorted(EXPECTED_TABLES):
    grants = {"SELECT", "INSERT"}
    if table not in append_only:
        grants.add("UPDATE")
    wanted = owner | {("teruisi_ai_writer", privilege, False) for privilege in grants}

    for actual, permissions in ((wanted, True), (owner, False)):
        run_acl(table, actual, permissions)
        checks += 1

    rejected = [wanted - {("teruisi_ai_writer", privilege, False)} for privilege in grants]
    rejected += [
        wanted | {("PUBLIC", "SELECT", False)},
        wanted | {("teruisi_ai_writer", "DELETE", False)},
        wanted | {("teruisi_ai_writer", "INSERT", True)},
    ]
    if table in append_only:
        rejected.append(wanted | {("teruisi_ai_writer", "UPDATE", False)})
    for actual in rejected:
        try:
            run_acl(table, actual, True)
        except ValueError:
            checks += 1
        else:
            raise AssertionError("Pi153 gate accepted wrong ACL: " + table)

    try:
        run_acl(table, wanted, False)
    except ValueError:
        checks += 1
    else:
        raise AssertionError("Pi153 gate accepted writer ACL without permissions: " + table)

print(
    "PI153_ACL_CONTRACT_PASSED "
    f"tables={len(EXPECTED_TABLES)} append_only={len(EXPECTED_APPEND_ONLY)} "
    f"checks={checks} no_database=True"
)
