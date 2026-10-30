"""Static AI-writer privilege coverage gate; no database, no Django import.

2026-10-28 incident: a code path called ``AiWriteReceipt.objects...delete()``
(backend/ai_assistant/views.py, ``_prune_expired_receipts``) against a table
whose entry in ``database_contract.WRITER_PRIVILEGES`` only granted
``SELECT/INSERT/UPDATE``. The two existing drift checks (health.py,
pi_native_health.py) only compare *granted* privileges against the
*declared* contract — if both sides agree on too little, they pass. This
gate checks the missing direction: does the contract grant *at least* what
the code's own ORM calls require?

Why this cannot simply ``import database_contract`` and read
``WRITER_PRIVILEGES`` directly: every model-defining module in
``backend/ai_assistant/`` (models.py, pi_models.py, control_models.py,
dingtalk_models.py, and the many ``business_*_models.py`` files) does
``from django.db import models`` at module scope. Importing
``database_contract`` would transitively import all of them, which requires
``django.apps.apps`` to be ready — i.e. ``django.setup()`` with
``DJANGO_SETTINGS_MODULE`` configured — before a single class body
executes. This CI job runs on ubuntu-latest with no PostgreSQL and is
intentionally not wired to touch Django settings or any database, so this
script never imports Django or any ``ai_assistant`` module. Instead it:

1. Parses every non-test, non-migration ``.py`` file under
   ``backend/ai_assistant/`` with ``ast`` and collects every
   ``class X(models.Model): ... class Meta: db_table = "..."`` pair,
   building a {class name -> db_table} map. Class names are unique across
   the package (checked below), so this map is unambiguous.
2. Parses ``database_contract.py`` itself and ``exec()``s only the AST
   slice from the first ``WRITER_PRIVILEGES = ...`` assignment through the
   ``CLOSED_SQL_OWNED_TABLES`` pop loop (the same "extract and exec a
   trusted slice of real source" technique ``pi152-acl-catalog-boundary.py``
   uses), with ``MODELS`` and ``APPEND_ONLY`` injected as plain Python sets
   recovered from the same file via ``ast.literal_eval`` /
   name-resolution. This reconstructs the exact same
   ``WRITER_PRIVILEGES`` dict the real module builds, without ever
   importing Django.
3. Walks every other non-test ``.py`` file for calls of the shape
   ``<model_ref>.objects. ... .delete()`` or
   ``<model_ref>.objects. ... .update(...)``, where ``<model_ref>`` is a
   bare name (``PiSession.objects...``) or a one-level attribute access on
   an imported alias (``m.AiWriteReceipt.objects...``). Each resolved model
   is mapped to its table via step 1, and the required privilege
   (``DELETE`` or ``UPDATE``) is compared against what
   ``WRITER_PRIVILEGES`` actually grants that table.

Honest limitations (this is a coverage floor, not a closed proof):
- Only ORM calls of the exact shape above are recognised. Instance-level
  writes like ``row.delete()`` / ``entry.delete()`` / ``obj.save()`` are not
  attributed to a model, because that requires cross-function data-flow
  analysis this script does not do. These exist in the codebase today
  (chat.py, space.py, views.py) and are not covered.
- Raw SQL (``cursor.execute("DELETE FROM ...")``) and any dynamically
  computed table name are invisible to this check.
- A call through ``cls.objects...`` inside a classmethod, or a model
  reference that isn't a direct ``Name``/one-level ``Attribute``, is
  skipped rather than guessed at.
These gaps mean a passing run is evidence the *recognised* ORM call shapes
are covered, not that every write path in ``ai_assistant`` is privilege-safe.
"""
import ast
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP_DIR = ROOT / "backend/ai_assistant"
CONTRACT = APP_DIR / "database_contract.py"

WRITE_METHODS = {"delete": "DELETE", "update": "UPDATE"}


def app_source_files():
    for path in sorted(APP_DIR.glob("*.py")):
        if path.name.startswith("test_") or path.name == "tests.py":
            continue
        yield path


def collect_model_table_map():
    """{model class name -> db_table}, scanning every model-defining file."""
    mapping = {}
    collisions = []
    for path in app_source_files():
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.ClassDef):
                continue
            for item in node.body:
                if not (isinstance(item, ast.ClassDef) and item.name == "Meta"):
                    continue
                for stmt in item.body:
                    if not (
                        isinstance(stmt, ast.Assign)
                        and len(stmt.targets) == 1
                        and isinstance(stmt.targets[0], ast.Name)
                        and stmt.targets[0].id == "db_table"
                    ):
                        continue
                    table = ast.literal_eval(stmt.value)
                    if node.name in mapping and mapping[node.name] != table:
                        collisions.append((node.name, mapping[node.name], table))
                    mapping[node.name] = table
    if collisions:
        raise AssertionError(
            "Model class name maps to more than one db_table, name-based "
            f"lookup is unsafe: {collisions}"
        )
    return mapping


def top_level_value(tree, name):
    """ast.literal_eval of a single top-level `name = <literal>` assignment."""
    for node in tree.body:
        if (
            isinstance(node, ast.Assign)
            and len(node.targets) == 1
            and isinstance(node.targets[0], ast.Name)
            and node.targets[0].id == name
        ):
            return ast.literal_eval(node.value)
    raise AssertionError(f"Expected a top-level literal assignment to {name!r}")


def rebuild_writer_privileges(model_tables):
    """Reconstruct database_contract.WRITER_PRIVILEGES without importing Django.

    MODELS is rebuilt here as just its key set (table names): every value in
    the real MODELS dict is a model class used only as a dict key source
    there (`for table in MODELS`), so the keys alone are sufficient to
    reproduce WRITER_PRIVILEGES's control flow.
    """
    tree = ast.parse(CONTRACT.read_text(encoding="utf-8"), filename=str(CONTRACT))
    append_only = top_level_value(tree, "APPEND_ONLY")

    start = next(
        i
        for i, node in enumerate(tree.body)
        if isinstance(node, ast.Assign)
        and len(node.targets) == 1
        and isinstance(node.targets[0], ast.Name)
        and node.targets[0].id == "WRITER_PRIVILEGES"
    )
    end = next(
        i
        for i, node in enumerate(tree.body)
        if isinstance(node, ast.For)
        and isinstance(node.target, ast.Name)
        and node.target.id == "table"
        and isinstance(node.iter, ast.Name)
        and node.iter.id == "CLOSED_SQL_OWNED_TABLES"
    )
    statements = tree.body[start : end + 1]
    # Sanity: the slice really starts with the dict comprehension keyed by
    # MODELS and ends with the CLOSED_SQL_OWNED_TABLES pop loop, so a future
    # reordering of database_contract.py fails loudly here instead of
    # silently reconstructing the wrong dict.
    assert isinstance(statements[0], ast.Assign) and isinstance(
        statements[0].value, ast.DictComp
    ), "Expected WRITER_PRIVILEGES = {...} dict comprehension first"
    assert (
        isinstance(statements[-1], ast.For)
        and ast.unparse(statements[-1].body[0]).strip() == "WRITER_PRIVILEGES.pop(table)"
    ), "Expected the CLOSED_SQL_OWNED_TABLES pop loop last"

    # CLOSED_SQL_OWNED_TABLES is defined via a starred-tuple expression
    # (*CLOSED_SEAL_TICKET_TABLES, "...", ...) a few statements above
    # WRITER_PRIVILEGES, so it can't be ast.literal_eval'd directly.
    # Evaluate the whole expression instead, with CLOSED_SEAL_TICKET_TABLES
    # resolved by name the same way APPEND_ONLY was.
    seal_tickets = top_level_value(tree, "CLOSED_SEAL_TICKET_TABLES")
    closed_tables = eval(
        compile(ast.Expression(body=next(
            node.value for node in tree.body
            if isinstance(node, ast.Assign)
            and len(node.targets) == 1
            and isinstance(node.targets[0], ast.Name)
            and node.targets[0].id == "CLOSED_SQL_OWNED_TABLES"
        )), str(CONTRACT), "eval"),
        {"CLOSED_SEAL_TICKET_TABLES": seal_tickets},
    )

    module = ast.Module(body=list(statements), type_ignores=[])
    ast.fix_missing_locations(module)
    code = compile(module, str(CONTRACT), "exec")
    scope = {
        "MODELS": set(model_tables.values()),
        "APPEND_ONLY": append_only,
        "CLOSED_SQL_OWNED_TABLES": closed_tables,
    }
    exec(code, scope)
    return scope["WRITER_PRIVILEGES"]


def model_ref_name(call_base):
    """Resolve the left side of `<ref>.objects` to a bare class-like name.

    Accepts `Name` (direct import, e.g. PiSession) and one-level `Attribute`
    on a Name (e.g. m.AiWriteReceipt). Anything else (cls, self, deeper
    chains, subscripts) is left unresolved — see module docstring.
    """
    if isinstance(call_base, ast.Name):
        return call_base.id
    if isinstance(call_base, ast.Attribute) and isinstance(call_base.value, ast.Name):
        return call_base.attr
    return None


def find_orm_write_calls(path):
    """Yield (lineno, model_name, required_privilege) for recognised writes."""
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    for node in ast.walk(tree):
        if not (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr in WRITE_METHODS
        ):
            continue
        cur = node.func.value
        while isinstance(cur, ast.Call):
            cur = cur.func
        base = None
        while isinstance(cur, ast.Attribute):
            if cur.attr == "objects":
                base = cur.value
                break
            cur = cur.value
        if base is None:
            continue
        name = model_ref_name(base)
        if name is None:
            continue
        yield node.lineno, name, WRITE_METHODS[node.func.attr]


def main():
    model_tables = collect_model_table_map()
    writer_privileges = rebuild_writer_privileges(model_tables)

    violations = []
    unresolved = []
    checked = 0
    for path in app_source_files():
        if path == CONTRACT:
            continue
        for lineno, model_name, required in find_orm_write_calls(path):
            checked += 1
            table = model_tables.get(model_name)
            if table is None:
                unresolved.append((path.name, lineno, model_name))
                continue
            granted = writer_privileges.get(table, ())
            if required not in granted:
                violations.append(
                    (path.name, lineno, model_name, table, required, granted)
                )

    if unresolved:
        print(
            "AI_WRITER_PRIVILEGE_COVERAGE: "
            f"{len(unresolved)} ORM write call(s) reference a model name "
            "with no known db_table (not a failure by itself, but check "
            "these were not meant to resolve):"
        )
        for name, lineno, model_name in unresolved:
            print(f"  {name}:{lineno} -> {model_name}")

    if violations:
        print(
            "AI_WRITER_PRIVILEGE_COVERAGE_FAILED: code calls an ORM write "
            "that database_contract.WRITER_PRIVILEGES does not grant:"
        )
        for name, lineno, model_name, table, required, granted in violations:
            print(
                f"  {name}:{lineno} {model_name}.objects... requires "
                f"{required} on table '{table}', but WRITER_PRIVILEGES"
                f"['{table}'] = {granted!r}"
            )
        sys.exit(1)

    print(
        "AI_WRITER_PRIVILEGE_COVERAGE_PASSED "
        f"checked={checked} tables_in_contract={len(writer_privileges)} "
        "no_database=True no_django_import=True"
    )


if __name__ == "__main__":
    main()
