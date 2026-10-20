"""Static Pi152 ACL contract check; no database, no Django import.

The migration declares which ledgers are append-only. The finite catalog's
Finalize gate must grant the AI writer UPDATE only on the mutable action ledger.
This test fails when either side drifts, so the contradiction that rejected the
2026-10-20 Finalize cannot be reintroduced silently.
"""
import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "tools/pi_business_catalog.py"
MIGRATION = ROOT / "backend/ai_assistant/migrations/0086_pi_business_actions.py"

# Reviewed contract. Keep these exact values: a deliberate contract change must
# update both the migration declaration and this reviewed expectation.
EXPECTED_TABLES = {
    "ai_pi_business_actions",
    "ai_pi_business_audits",
    "ai_pi_business_intents",
}
EXPECTED_APPEND_ONLY = {
    "ai_pi_business_audits",
    "ai_pi_business_intents",
}


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
    assert names[:3] == ["owner", "writer_privileges", "wanted_acl"], names
    assert isinstance(statements[3], ast.If) and "actual_acl" in ast.unparse(
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

catalog_tables = top_level_assignments(CATALOG, {"TABLES"})["TABLES"]
assert set(catalog_tables) == EXPECTED_TABLES, catalog_tables

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
checks = 0
for table in sorted(EXPECTED_TABLES):
    grants = {"SELECT", "INSERT"}
    if table not in EXPECTED_APPEND_ONLY:
        grants.add("UPDATE")
    wanted = owner | {("teruisi_ai_writer", privilege, False) for privilege in grants}

    for actual, permissions in ((wanted, True), (owner, False)):
        exec(block, {"table": table, "actual_acl": actual, "permissions": permissions})
        checks += 1

    rejected = [wanted - {("teruisi_ai_writer", privilege, False)} for privilege in grants]
    rejected += [
        wanted | {("PUBLIC", "SELECT", False)},
        wanted | {("teruisi_ai_writer", "DELETE", False)},
        wanted | {("teruisi_ai_writer", "INSERT", True)},
    ]
    if table in EXPECTED_APPEND_ONLY:
        rejected.append(wanted | {("teruisi_ai_writer", "UPDATE", False)})
    for actual in rejected:
        try:
            exec(
                block,
                {"table": table, "actual_acl": actual, "permissions": True},
            )
        except ValueError:
            checks += 1
        else:
            raise AssertionError("Finalize gate accepted wrong ACL: " + table)

print(
    "PI152_ACL_CONTRACT_PASSED "
    f"tables={len(EXPECTED_TABLES)} append_only={len(EXPECTED_APPEND_ONLY)} "
    f"checks={checks} no_database=True"
)
