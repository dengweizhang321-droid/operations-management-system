"""Read-only PostgreSQL 17 catalogue baseline admission (stdlib, JSON and AST).

This is intentionally a finite reader for the catalogue forms registered below,
not a Python interpreter. A new catalogue or an unfamiliar source form fails
closed and needs an explicit registry/reader update. No catalogue is imported.
"""
from __future__ import annotations

import argparse
import ast
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import sys

VERSION = "teruisi-catalog-baselines-v1"
OWNER = "teruisi_sales_owner"
TABLE_PRIVILEGES = frozenset("SELECT INSERT UPDATE DELETE TRUNCATE REFERENCES TRIGGER MAINTAIN".split())
SEQUENCE_PRIVILEGES = frozenset("SELECT UPDATE USAGE".split())
JSON_CATALOGS = (
    "jd_logistics_catalog", "jd_monitor_preferences_catalog", "pi_agent_catalog",
    "pi_workspace_catalog", "tmall_warehouse_catalog", "workflow_automation_catalog",
)
OTHER_CATALOGS = (
    "ai_schedule_addition_catalog", "pi_business_catalog", "pi_native_catalog",
    "jd_product_monitoring_catalog", "jackyun_audit_catalog", "sales_preflight_catalog",
)
SEQUENCES = {
    "tmall_warehouse_catalog": ("inventory_tmall_warehouse_facts", "id", "public.inventory_tmall_warehouse_facts_id_seq"),
    "workflow_automation_catalog": ("automation_module_results", "id", "public.automation_module_results_id_seq"),
}
INHERITS = {"jd_monitor_preferences_catalog": "jd_logistics_catalog",
            "jd_product_monitoring_catalog": "jd_monitor_preferences_catalog"}
_NO_ROWS = object()


def _need(condition, message):
    if not condition:
        raise ValueError(message)


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        _need(key not in result, "duplicate JSON key: " + key)
        result[key] = value
    return result


def _dump(node):
    return ast.dump(node, include_attributes=False)


def _expr(text):
    return ast.parse(text, mode="eval").body


def _same(node, text):
    return _dump(node) == _dump(_expr(text))


def _assignment(body, name):
    found = [node for node in body if isinstance(node, ast.Assign)
             and any(isinstance(t, ast.Name) and t.id == name for t in node.targets)]
    _need(len(found) == 1 and len(found[0].targets) == 1, "expected one assignment to " + name)
    return found[0].value


def _function(tree, name):
    found = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == name]
    _need(len(found) == 1, "required source function missing/ambiguous: " + name)
    return found[0]


def _literal(node):
    # literal_eval does not detect duplicate dict keys; inspect those first.
    for child in ast.walk(node):
        if isinstance(child, ast.Dict):
            keys = [ast.literal_eval(key) for key in child.keys]
            _need(len(keys) == len(set(keys)), "duplicate Python literal dictionary key")
    return ast.literal_eval(node)


class _Sources:
    def __init__(self, root, report):
        self.root = Path(root).absolute()
        _need(self.root.is_dir() and self.root.parent != self.root, "root must be a project directory")
        for path in (self.root, *self.root.parents):
            _need(not path.is_symlink() and not getattr(path, "is_junction", lambda: False)(), "linked root is unsupported")
        self.report, self.trees = report, {}

    def read(self, relative):
        path = self.root / relative
        for part in (path, *path.parents):
            if part == self.root.parent:
                break
            _need(not part.is_symlink() and not getattr(part, "is_junction", lambda: False)(), "linked source is unsupported: " + relative)
        _need(path.is_file() and path.stat().st_size <= 1_000_000, "source absent or too large: " + relative)
        data = path.read_bytes()
        _need(len(data) <= 1_000_000, "source too large: " + relative)
        self.report["sourceFiles"][relative] = hashlib.sha256(data).hexdigest()
        return data.decode("utf-8-sig")

    def tree(self, name):
        if name not in self.trees:
            self.trees[name] = ast.parse(self.read("tools/" + name + ".py"), filename=name)
        return self.trees[name]

    def strings(self, name, symbol="TABLES", seen=()):
        _need((name, symbol) not in seen, "cyclic catalogue constant")
        tree = self.tree(name)
        assigned = [node for node in tree.body if isinstance(node, ast.Assign)
                    and any(isinstance(t, ast.Name) and t.id == symbol for t in node.targets)]
        imported = [(node.module, alias.name) for node in tree.body if isinstance(node, ast.ImportFrom)
                    for alias in node.names if (alias.asname or alias.name) == symbol]
        _need(len(assigned) + len(imported) == 1, "constant missing/ambiguous: " + name + "." + symbol)
        if imported:
            module, original = imported[0]
            _need(module in JSON_CATALOGS + OTHER_CATALOGS and original == "TABLES", "unsupported catalogue constant import")
            return self.strings(module, original, (*seen, (name, symbol)))

        def sequence(node):
            if isinstance(node, (ast.Tuple, ast.List)):
                _need(all(isinstance(v, ast.Constant) and type(v.value) is str and v.value for v in node.elts), "expected nonempty literal strings")
                return [v.value for v in node.elts]
            if isinstance(node, ast.Name):
                return self.strings(name, node.id, (*seen, (name, symbol)))
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in {"tuple", "sorted"}:
                _need(len(node.args) == 1 and not node.keywords, "unsupported sequence wrapper")
                values = sequence(node.args[0])
                return sorted(values) if node.func.id == "sorted" else values
            if isinstance(node, ast.GeneratorExp):
                _need(len(node.generators) == 1, "unsupported table generator")
                gen = node.generators[0]
                _need(isinstance(gen.target, ast.Name) and not gen.ifs and not gen.is_async, "unsupported table generator")
                _need(isinstance(node.elt, ast.BinOp) and isinstance(node.elt.op, ast.Add)
                      and isinstance(node.elt.left, ast.Constant) and type(node.elt.left.value) is str
                      and isinstance(node.elt.right, ast.Name) and node.elt.right.id == gen.target.id, "unsupported table generator expression")
                return [node.elt.left.value + value for value in sequence(gen.iter)]
            raise ValueError("unsupported finite string sequence AST: " + type(node).__name__)

        values = sequence(assigned[0].value)
        _need(values and len(values) == len(set(values)), "empty or duplicate table membership")
        return values


def _execute(node):
    return (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
            and isinstance(node.func.value, ast.Name) and node.func.value.id == "cursor" and node.func.attr == "execute")


def _sql_calls(function):
    result = []
    for call in sorted((n for n in ast.walk(function) if _execute(n)), key=lambda n: n.lineno):
        _need(call.args and isinstance(call.args[0], ast.Constant) and type(call.args[0].value) is str,
              "nonliteral cursor.execute SQL in " + function.name)
        result.append((call, call.args[0].value))
    return result


def _acl_sql(function, kind):
    calls = _sql_calls(function)
    acl = [(node, text) for node, text in calls if re.search(r"\baclexplode\s*\(", text, re.I)
           and re.search(r"\bc\.relacl\b", text, re.I)]
    _need(len(acl) == 1, "required relation ACL query missing/ambiguous in " + function.name)
    call, text = acl[0]
    defaults = re.findall(r"\bacldefault\s*\(\s*'([^']*)'\s*,\s*c\.relowner\s*\)", text, re.I)
    _need(defaults == [kind] and len(re.findall(r"\bacldefault\s*\(", text, re.I)) == 1,
          "actual " + function.name + " ACL SQL requires acldefault('" + kind + "',c.relowner); found " + repr(defaults))
    _need("COALESCE(c.relacl," in re.sub(r"\s+", "", text)
          and "a.grantee=c.relowner" in re.sub(r"\s+", "", text)
          and "'OWNER'" in text, "unsupported ACL owner/default SQL")
    return call, calls


def _inspector(sources, name):
    tree = sources.tree(name)
    if name in {"jd_monitor_preferences_catalog", "jd_product_monitoring_catalog"}:
        imports = [n for n in tree.body if isinstance(n, ast.ImportFrom) and n.module == "jd_logistics_catalog"]
        _need(len(imports) == 1 and {a.name for a in imports[0].names} >= {"TABLES", "inspect_tables"}, "JD inheritance inspector import differs")
        tree = sources.tree("jd_logistics_catalog")
    fn = _function(tree, "inspect_tables")
    call, _ = _acl_sql(fn, "r")
    # The actual relation-ACL result must be the value returned under 'acl'.
    assignments = [n for n in ast.walk(fn) if isinstance(n, ast.Assign)
                   and any(isinstance(t, ast.Name) and t.id == "acl" for t in n.targets)]
    _need(len(assignments) == 1 and assignments[0].lineno == call.end_lineno + 1
          and _same(assignments[0].value, "cursor.fetchall()"), "ACL SQL result is not the captured acl")
    loops = [n for n in fn.body if isinstance(n, ast.For) and assignments[0] in n.body]
    _need(len(loops) == 1, "captured table ACL is outside the direct table loop")
    loop = loops[0]
    iterator = "COLUMNS" if name == "ai_schedule_addition_catalog" else "tables" if name == "pi_workspace_catalog" else "TABLES"
    _need(isinstance(loop.target, ast.Name) and loop.target.id == "table"
          and isinstance(loop.iter, ast.Name) and loop.iter.id == iterator and not loop.orelse,
          "captured table loop target/iterator differs")
    if iterator == "tables":
        _need([a.arg for a in fn.args.args] == ["cursor", "tables"]
              and len(fn.args.defaults) == 1 and _same(fn.args.defaults[0], "TABLES"), "workspace table iterator default differs")
    if iterator == "COLUMNS":
        columns = _assignment(tree.body, "COLUMNS")
        _need(isinstance(columns, ast.Dict) and {_literal(k) for k in columns.keys} == {"ai_dingtalk_schedules", "ai_dingtalk_schedule_runs"}, "AI142 column/table iterator membership differs")
    _need(any(isinstance(n, ast.Expr) and n.value is call for n in loop.body), "ACL SQL is conditional or outside table loop")
    allowed = {"target", "identity", "columns", "constraints", "indexes", "triggers", "acl", "column_acl"}
    for node in loop.body:
        if isinstance(node, ast.Expr):
            _need(_execute(node.value), "unknown expression can bypass table ACL capture")
        else:
            _need(isinstance(node, ast.Assign) and len(node.targets) == 1, "unknown control flow can bypass table ACL capture")
            target = node.targets[0]
            _need((isinstance(target, ast.Name) and target.id in allowed)
                  or (isinstance(target, ast.Subscript) and isinstance(target.value, ast.Name) and target.value.id == "result"
                      and isinstance(target.slice, ast.Name) and target.slice.id == "table"), "unknown assignment can bypass table ACL capture")
    captured = [n.value for n in loop.body if isinstance(n, ast.Assign) and isinstance(n.targets[0], ast.Subscript)]
    _need(len(captured) == 1 and isinstance(captured[0], ast.Dict)
          and any(isinstance(k, ast.Constant) and k.value == "acl" and isinstance(v, ast.Name) and v.id == "acl"
                  for k, v in zip(captured[0].keys, captured[0].values)), "captured table ACL return is unsupported")
    returns = [n for n in ast.walk(fn) if isinstance(n, ast.Return)]
    _need(len(returns) == 1 and returns[0] is fn.body[-1] and _same(returns[0].value, "result")
          and _same(_assignment(fn.body, "result"), "{}"), "table collector return bypasses captured ACL")


def _sequence_source(sources, name):
    table, column, _ = SEQUENCES[name]
    tree = sources.tree(name)
    fn = _function(tree, "sequence_catalog")
    acl, calls = _acl_sql(fn, "s")
    _need(len(calls) == 2 and calls[-1][0] is acl, "sequence collector requires serial lookup followed by ACL query")
    serial, text = calls[0]
    compact = re.sub(r"\s+", "", text)
    if name == "tmall_warehouse_catalog":
        _need(compact == "SELECTpg_get_serial_sequence('public." + table + "','" + column + "')" and len(serial.args) == 1,
              "serial lookup differs from registered table/column")
    else:
        _need(compact == "SELECTpg_get_serial_sequence(%s,'" + column + "')" and len(serial.args) == 2
              and _same(serial.args[1], '["public." + SEQUENCE_TABLE]')
              and _literal(_assignment(tree.body, "SEQUENCE_TABLE")) == table, "serial lookup differs from registered table/column")
    _need(len(acl.args) == 2 and _same(acl.args[1], "[sequence]"), "sequence ACL query does not consume serial lookup")
    sequence = [n for n in ast.walk(fn) if isinstance(n, ast.Assign)
                and any(isinstance(t, ast.Name) and t.id == "sequence" for t in n.targets)]
    _need(len(sequence) == 1 and sequence[0].lineno == serial.end_lineno + 1
          and _same(sequence[0].value, "cursor.fetchone()[0]"), "serial result is not uniquely consumed")
    returns = [n for n in ast.walk(fn) if isinstance(n, ast.Return)]
    _need(len(returns) == 1 and _same(returns[0].value, '{"name": sequence, "acl": cursor.fetchall()}'), "sequence return bypasses ACL query")


def _owner_expression(node):
    _need(isinstance(node, ast.SetComp) and len(node.generators) == 1, "owner ACL must be the registered set comprehension")
    gen = node.generators[0]
    _need(isinstance(gen.target, ast.Name) and not gen.ifs and not gen.is_async, "unknown owner ACL generator")
    var = gen.target.id
    _need(_same(node.elt, '("OWNER", ' + var + ', False)'), "owner ACL row must be OWNER, privilege, False")
    values = _literal(gen.iter)
    _need(type(values) in {tuple, list} and all(type(v) is str for v in values)
          and len(values) == len(set(values)), "owner privileges are malformed or duplicated")
    return values


def _pi_source(sources, name):
    fn = _function(sources.tree(name), "verify_catalog")
    call, _ = _acl_sql(fn, "r")
    owner_assignments = [n for n in ast.walk(fn) if isinstance(n, ast.Assign)
                         and any(isinstance(t, ast.Name) and t.id == "owner" for t in n.targets)]
    _need(len(owner_assignments) == 1, "owner assignment missing/reassigned")
    values = _owner_expression(owner_assignments[0].value)
    loops = [n for n in ast.walk(fn) if isinstance(n, ast.For) and owner_assignments[0] in n.body]
    _need(len(loops) == 1, "owner ACL is outside the actual table loop")
    loop = loops[0]
    target, iterable = ((("table", "definition"), "definitions().items()") if name == "pi_business_catalog"
                        else (("table", "model"), "models.items()"))
    _need(loop in fn.body and not loop.orelse and isinstance(loop.target, ast.Tuple)
          and all(isinstance(n, ast.Name) for n in loop.target.elts)
          and tuple(n.id for n in loop.target.elts) == target
          and _same(loop.iter, iterable), "Pi ACL table loop target/iterator differs or is conditional")
    returns = [n for n in ast.walk(fn) if isinstance(n, ast.Return)]
    installed_guards = [n for n in fn.body if isinstance(n, ast.If) and _same(n.test, "not installed")]
    _need(len(returns) == 1 and len(installed_guards) == 1
          and installed_guards[0].body == [returns[0]] and returns[0].value is None
          and not installed_guards[0].orelse, "Pi ACL can be bypassed by an unknown return")
    body = loop.body
    identities = [(node, text) for node, text in _sql_calls(fn)
                  if "pg_get_userbyid(relowner),relkind,relpersistence,relrowsecurity,relforcerowsecurity" in re.sub(r"\s+", "", text)]
    _need(len(identities) == 1, "Pi table identity query is missing/ambiguous")
    identity_call = identities[0][0]
    identity_index = next((i for i, n in enumerate(body) if isinstance(n, ast.Expr) and n.value is identity_call), -1)
    _need(identity_index >= 0 and identity_index + 1 < len(body)
          and isinstance(body[identity_index + 1], ast.If)
          and _same(body[identity_index + 1].test, 'cursor.fetchone() != ("teruisi_sales_owner", "r", "p", False, False)')
          and len(body[identity_index + 1].body) == 1 and isinstance(body[identity_index + 1].body[0], ast.Raise)
          and not body[identity_index + 1].orelse, "Pi owner/identity rejection is disconnected or differs")
    assignments = {key: [n for n in ast.walk(fn) if isinstance(n, (ast.Assign, ast.AnnAssign, ast.AugAssign))
                          and any(isinstance(t, ast.Name) and t.id == key for t in (n.targets if isinstance(n, ast.Assign) else [n.target]))]
                   for key in ("owner", "actual_acl", "wanted_acl", "expected_acl", "writer_privileges", "privileges")}
    if name == "pi_business_catalog":
        _need(all(len(assignments[key]) == 1 for key in ("actual_acl", "wanted_acl", "writer_privileges")), "business ACL variable missing/reassigned")
        _need(_same(_assignment(body, "actual_acl"), "set(cursor.fetchall())")
              and assignments["actual_acl"][0].lineno == call.end_lineno + 1, "business actual ACL is disconnected from query")
        _need(_same(_assignment(body, "writer_privileges"), '("INSERT","SELECT","UPDATE") if table == "ai_pi_business_actions" else ("INSERT","SELECT")'), "unknown business writer privilege derivation")
        _need(_same(_assignment(body, "wanted_acl"), 'owner | {("teruisi_ai_writer", privilege, False) for privilege in writer_privileges}'), "business expected ACL bypasses owner")
        comparison = 'actual_acl != (wanted_acl if permissions else owner)'
    else:
        _need(all(len(assignments[key]) == 1 for key in ("expected_acl", "privileges")), "native ACL variable missing/reassigned")
        _need(_same(_assignment(body, "privileges"), '("SELECT", "INSERT") if table in migration.APPEND_ONLY else ("SELECT", "INSERT", "UPDATE")'), "unknown native writer privilege derivation")
        _need(_same(_assignment(body, "expected_acl"), 'owner | ({("teruisi_ai_writer", name, False) for name in privileges} if permissions else set())'), "native expected ACL bypasses owner")
        comparison = 'set(cursor.fetchall()) != expected_acl'
    comparisons = [n for n in body if isinstance(n, ast.If) and _same(n.test, comparison)]
    _need(len(comparisons) == 1 and len(comparisons[0].body) == 1 and isinstance(comparisons[0].body[0], ast.Raise)
          and not comparisons[0].orelse, "final ACL comparison is missing/bypassed")
    # Only the recognized contiguous query -> assignments -> rejecting comparison
    # may consume this ACL. This also rejects an unused correct owner literal.
    start = next(i for i, n in enumerate(body) if isinstance(n, ast.Expr) and n.value is call)
    end = body.index(comparisons[0])
    _need(all(isinstance(n, ast.Assign) for n in body[start + 1:end]), "unrecognized control flow before final ACL comparison")
    names = [t.id for n in body[start + 1:end] for t in n.targets if isinstance(t, ast.Name)]
    _need(names == (["actual_acl", "owner", "writer_privileges", "wanted_acl"] if name == "pi_business_catalog" else ["owner", "privileges", "expected_acl"]), "ACL chain has unknown assignments")
    return values


def _name(value):
    _need(type(value) is str and value, "catalogue name must be nonempty text")
    if value.startswith("tools/"):
        value = value[6:]
    for suffix in (".json", ".py"):
        if value.endswith(suffix):
            value = value[:-len(suffix)]
    _need(value in JSON_CATALOGS, "capture/replacement must name a registered JSON catalogue")
    return value


def check_catalog_baselines(root, *, replacement=None, capture_target=None):
    """Return a full static admission report; never contact a database or write.

    replacement is {registered_name: decoded_capture} (exactly one entry), or a
    (registered_name, decoded_capture) pair. capture_target defers only that JSON
    payload for capture preflight; its Python collection contract still applies.
    """
    report = {"version": VERSION, "status": "failed", "scope": "catalog-baseline",
              "databaseContacted": False, "deferredCatalogs": [], "sourceFiles": {},
              "results": [], "diagnostics": []}

    def error(code, file, obj, message):
        report["diagnostics"].append({"code": code, "file": file, "object": obj, "message": str(message)})

    def attempt(code, file, obj, action):
        try:
            return action()
        except (ValueError, TypeError, KeyError, OSError, SyntaxError, UnicodeError, RecursionError) as exc:
            error(code, file, obj, exc)
            return None

    def result(catalog, obj, kind, rows=_NO_ROWS, *, applicable=True, **extra):
        entry = {"catalog": catalog, "object": obj, "kind": kind,
                 "status": "passed" if applicable else "not-applicable", **extra}
        report["results"].append(entry)
        if rows is _NO_ROWS:
            return entry
        privileges = TABLE_PRIVILEGES if kind == "table" else SEQUENCE_PRIVILEGES
        valid = []
        _need(type(rows) is list, "ACL must be an array")
        for row in rows:
            _need(type(row) in {list, tuple} and len(row) == (3 if kind == "table" else 6), "malformed ACL row")
            if kind == "sequence":
                _need(list(row[:3]) == [OWNER, "S", "p"], "sequence owner/relkind/persistence differs")
                grant, privilege, grantable = row[5], row[3], row[4]
            else:
                grant, privilege, grantable = row
            _need(type(grant) is str and grant and grant != OWNER, "invalid/unnormalized ACL grantee")
            _need(type(privilege) is str and privilege in privileges, "invalid ACL privilege: " + repr(privilege))
            _need(type(grantable) is bool and grantable is False, "ACL grantable must be boolean false")
            valid.append((grant, privilege, grantable))
        _need(len(valid) == len(set(valid)), "duplicate ACL row")
        actual = {p for g, p, _ in valid if g == "OWNER"}
        # Independent scan over the original rows, deliberately not the set.
        raw_counts = {p: sum(1 for row in rows if (row[0] if kind == "table" else row[5]) == "OWNER"
                            and (row[1] if kind == "table" else row[3]) == p) for p in sorted(privileges)}
        entry.update(expectedOwnerPrivileges=sorted(privileges), actualOwnerPrivileges=sorted(actual),
                     missingOwnerPrivileges=sorted(privileges - actual), unexpectedOwnerPrivileges=sorted(actual - privileges),
                     rawOwnerPrivilegeCounts=raw_counts, rawOwnerRows=sum(raw_counts.values()), ownerPrivilegeCount=len(actual))
        if actual != privileges or any(count != 1 for count in raw_counts.values()):
            error("owner-privileges", "tools/" + catalog, obj,
                  "OWNER missing " + repr(sorted(privileges - actual)) + "; unexpected " + repr(sorted(actual - privileges))
                  + "; raw OWNER privilege counts " + repr(raw_counts))
            entry["status"] = "failed"
        return entry

    sources = attempt("root", "", "", lambda: _Sources(root, report))
    if sources is not None:
        def run():
            _need(not (replacement is not None and capture_target is not None), "replacement and capture_target are mutually exclusive")
            replaced = {}
            if replacement is not None:
                if type(replacement) in {tuple, list} and len(replacement) == 2:
                    replacement_map = {replacement[0]: replacement[1]}
                else:
                    replacement_map = replacement
                _need(type(replacement_map) is dict and len(replacement_map) == 1, "replacement requires exactly one registered catalogue")
                replaced = {_name(key): value for key, value in replacement_map.items()}
            deferred = _name(capture_target) if capture_target is not None else None
            if deferred:
                report.update(scope="capture-preflight", deferredCatalogs=[deferred + ".json"])
            # Bind the running checker, not an unrelated file at the target root.
            report["sourceFiles"]["tools/check_catalog_baselines.py"] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
            expected = {name + ".py" for name in JSON_CATALOGS + OTHER_CATALOGS} | {name + ".json" for name in JSON_CATALOGS}
            actual = {p.name for p in (sources.root / "tools").glob("*_catalog.*") if p.suffix in {".py", ".json"}}
            allowed_missing = ({deferred + ".json"} if deferred else set()) | {name + ".json" for name in replaced}
            _need(not (expected - actual - allowed_missing) and not (actual - expected),
                  "catalogue registry/discovery mismatch; missing=" + repr(sorted(expected - actual - allowed_missing))
                  + "; unregistered=" + repr(sorted(actual - expected)))
            documents = {}
            for name in JSON_CATALOGS + OTHER_CATALOGS:
                attempt("python-source", "tools/" + name + ".py", name, lambda name=name: sources.tree(name))
            for name in JSON_CATALOGS:
                def check_source(name=name):
                    tables = sources.strings(name)
                    _inspector(sources, name)
                    if name in SEQUENCES:
                        _sequence_source(sources, name)
                    return tables
                tables = attempt("collection-contract", "tools/" + name + ".py", name, check_source)
                if name == deferred:
                    result(name, name, "deferred", applicable=False, reason="capture target JSON content deliberately deferred")
                    continue
                file = "tools/" + name + ".json"
                def load(name=name, file=file):
                    if name in replaced:
                        # Bind existing bytes where present, while testing the candidate in memory.
                        if (sources.root / file).exists():
                            sources.read(file)
                        value = replaced[name]
                        report["replacement"] = {"catalog": name + ".json", "sha256": hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False).encode()).hexdigest()}
                    else:
                        value = json.loads(sources.read(file), object_pairs_hook=_pairs,
                                           parse_constant=lambda v: (_ for _ in ()).throw(ValueError("invalid JSON constant: " + v)))
                    _need(type(value) is dict, "catalogue JSON must be an object")
                    return value
                document = attempt("json-format", file, name, load)
                if document is None:
                    continue
                documents[name] = document
                if tables is not None:
                    attempt("table-membership", file, name, lambda: _need(type(document) is dict and set(document) == set(tables) | ({"sequence"} if name in SEQUENCES else set()), "top-level members differ from actual TABLES and registered sequence"))
                if type(document) is not dict:
                    continue
                for table in tables or []:
                    def check_table(table=table):
                        value = document[table]
                        _need(type(value) is dict and {"identity", "columns", "acl"} <= set(value), "required table nodes identity/columns/acl absent")
                        _need(value["identity"] == [OWNER, "r", "p", False, False]
                              and all(type(v) is bool for v in value["identity"][3:]), "table owner/identity differs")
                        return result(name + ".json", table, "table", value["acl"])
                    attempt("table-format", file, table, check_table)
                def check_sequence_inventory():
                    identities = []
                    for table in tables or []:
                        cols = document[table]["columns"]
                        _need(type(cols) is list and cols, "columns must be a nonempty array")
                        names = []
                        for column in cols:
                            _need(type(column) is list and len(column) == 7 and type(column[0]) is str and column[0], "malformed column metadata")
                            _need(type(column[5]) is str and column[5] in {"", "a", "d"}, "unknown attidentity form")
                            names.append(column[0])
                            default = column[3]
                            _need(default is None or type(default) is str, "column default must be null or text")
                            if column[5]:
                                _need(default is None, "identity column cannot also declare nextval/default")
                                identities.append((table, column[0], None))
                            elif default is not None and re.search(r"\bnextval\b", default, re.I):
                                match = re.fullmatch(r"nextval\('((?:public\.)?[a-z_][a-z0-9_]*)'::regclass\)", default)
                                _need(match is not None, "unknown sequence default expression")
                                seq = match.group(1)
                                identities.append((table, column[0], seq if "." in seq else "public." + seq))
                        _need(len(names) == len(set(names)), "duplicate column metadata")
                    inventory = SEQUENCES.get(name)
                    expected_pairs = [(inventory[0], inventory[1])] if inventory else []
                    _need([(t, c) for t, c, _ in identities] == expected_pairs, "column identity/nextval inventory differs from registered sequence table/column")
                    if inventory:
                        _need(all(seq in {None, inventory[2]} for _, _, seq in identities), "nextval sequence name differs from registered name")
                        seq = document["sequence"]
                        _need(type(seq) is dict and set(seq) == {"name", "acl"} and seq["name"] == inventory[2], "required sequence name/ACL differs")
                        result(name + ".json", seq["name"], "sequence", seq["acl"], table=inventory[0], column=inventory[1])
                attempt("sequence-inventory", file, name, check_sequence_inventory)
            # The remaining six Python catalogues have explicit, different scopes.
            name = "ai_schedule_addition_catalog"
            def schedule():
                tree = sources.tree(name)
                reference = _literal(_assignment(tree.body, "REFERENCE142"))
                _need(type(reference) is dict and set(reference) == {"ai_dingtalk_schedules", "ai_dingtalk_schedule_runs"}, "AI142 literal table membership differs")
                _inspector(sources, name)
                for table, value in reference.items():
                    _need(type(value) is dict and value.get("identity") == [OWNER, "r", "p", False, False]
                          and all(type(v) is bool for v in value["identity"][3:]), "AI142 literal owner/identity differs")
                    result(name + ".py", table, "table", value["acl"], representation="REFERENCE142 literal")
            attempt("literal-catalogue", "tools/" + name + ".py", name, schedule)
            for name in ("pi_business_catalog", "pi_native_catalog"):
                def derived(name=name):
                    tables = sources.strings(name)
                    values = _pi_source(sources, name)
                    for table in tables:
                        result(name + ".py", table, "table", [["OWNER", p, False] for p in values], representation="connected owner set comprehension")
                attempt("derived-catalogue", "tools/" + name + ".py", name, derived)
            name = "jd_product_monitoring_catalog"
            def inherited():
                tree = sources.tree(name)
                tables = sources.strings(name)
                _inspector(sources, name)
                fn = _function(tree, "reference_catalog")
                body = ast.parse('reference = json.loads(Path(__file__).with_name("jd_monitor_preferences_catalog.json").read_text(encoding="utf8"))\nreference[TABLE]["columns"].append([FIELDS[0], "jsonb", True, None, "", "", None])\nreturn reference').body
                _need([_dump(n) for n in fn.body] == [_dump(n) for n in body], "unknown inherited catalogue projection")
                _need(_literal(_assignment(tree.body, "TABLE")) == "inventory_jd_logistics_departments"
                      and _literal(_assignment(tree.body, "FIELDS")) == ("unmonitored_product_codes",), "unknown JD148 inherited column addition")
                for table in tables:
                    result(name + ".py", table, "inherited-table", applicable=False,
                           inherits="jd_monitor_preferences_catalog.json", reason="ACL inherited unchanged; ancestor checked separately")
            attempt("inherited-catalogue", "tools/" + name + ".py", name, inherited)
            for name, reason in (("jackyun_audit_catalog", "adds columns/indexes to existing tables; no new table ACL baseline"),
                                 ("sales_preflight_catalog", "adds one index to an existing table; no new table ACL baseline")):
                def non_acl(name=name, reason=reason):
                    tree = sources.tree(name)
                    _need(not any(isinstance(n, ast.Name) and isinstance(n.ctx, ast.Store) and n.id in {"TABLES", "REFERENCE142", "owner", "wanted_acl", "expected_acl"} for n in ast.walk(tree)), "N/A catalogue acquired an unregistered ACL/table expectation")
                    _need(not any(isinstance(n, ast.Constant) and type(n.value) is str and re.search(r"\bacldefault\s*\(", n.value) for n in ast.walk(tree)), "N/A catalogue acquired an ACL SQL contract")
                    _function(tree, "verify_catalog")
                    if name == "jackyun_audit_catalog":
                        columns = _literal(_assignment(tree.body, "COLUMNS"))
                        _need(type(columns) is dict and columns, "audit addition column inventory missing")
                        objects = sorted(columns)
                    else:
                        objects = [_literal(_assignment(tree.body, "INDEX"))]
                    for obj in objects:
                        result(name + ".py", obj, "addition", applicable=False, reason=reason)
                attempt("not-applicable-contract", "tools/" + name + ".py", name, non_acl)
        attempt("admission", "", "", run)
    # Mark all detail rows belonging to an object with a diagnostic as failed.
    for entry in report["results"]:
        if any(d["object"] in {entry["object"], entry["catalog"].removesuffix(".py").removesuffix(".json")}
               for d in report["diagnostics"]):
            entry["status"] = "failed"
    tables = [r for r in report["results"] if r["kind"] == "table" and "ownerPrivilegeCount" in r]
    sequences = [r for r in report["results"] if r["kind"] == "sequence" and "ownerPrivilegeCount" in r]
    report["summary"] = {"results": len(report["results"]), "tables": len(tables), "sequences": len(sequences),
                         "notApplicable": sum(r["status"] == "not-applicable" for r in report["results"]),
                         "ownerPrivilegeMemberships": sum(r["ownerPrivilegeCount"] for r in tables + sequences),
                         "rawOwnerRows": sum(r["rawOwnerRows"] for r in tables + sequences),
                         "diagnostics": len(report["diagnostics"])}
    report["status"] = "failed" if report["diagnostics"] else "passed"
    report["sourceFiles"] = dict(sorted(report["sourceFiles"].items()))
    return report


def require_catalog_baselines(root, *, replacement=None, capture_target=None):
    report = check_catalog_baselines(root, replacement=replacement, capture_target=capture_target)
    if report["status"] != "passed":
        raise ValueError("catalogue baseline admission failed: " + json.dumps(report, ensure_ascii=True, separators=(",", ":")))
    return report


def check_captured_catalog(root, name, value):
    return check_catalog_baselines(root, replacement=(name, value))


def compact_report(report):
    """Small native-process transport; fullReportSha256 binds the full report."""
    compact = {key: report[key] for key in ("version", "status", "scope", "databaseContacted", "deferredCatalogs", "summary")}
    compact["fullReportSha256"] = hashlib.sha256(json.dumps(report, sort_keys=True, ensure_ascii=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()
    compact["totalDiagnostics"] = len(report["diagnostics"])
    compact["diagnostics"] = [{"code": str(d["code"])[:60], "message": str(d["message"])[:240]} for d in report["diagnostics"][:3]]
    return compact


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--compact", action="store_true", help="bounded native-process transport; checks are unchanged")
    args = parser.parse_args(argv)
    report = check_catalog_baselines(args.root)
    print(json.dumps(compact_report(report) if args.compact else report, ensure_ascii=True, separators=(",", ":"), allow_nan=False))
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    sys.exit(main())
