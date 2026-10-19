"""Private checks of the migration gate's exact ACL expectation; no database."""
import ast
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
file = root / 'tools/pi_business_catalog.py'
before = subprocess.check_output(['git', 'show', '69b38d1e523e636693d26e2f682b182088e475aa:tools/pi_business_catalog.py'], cwd=root).decode()
old = '        wanted_acl = owner | {( "teruisi_ai_writer", privilege, False) for privilege in ("INSERT","SELECT","UPDATE")}\n'
new = '        writer_privileges = ("INSERT","SELECT","UPDATE") if table == "ai_pi_business_actions" else ("INSERT","SELECT")\n        wanted_acl = owner | {( "teruisi_ai_writer", privilege, False) for privilege in writer_privileges}\n'
assert before.count(old) == 1
assert file.read_text(encoding='utf-8') == before.replace(old, new)
tree = ast.parse(file.read_text(encoding='utf-8'))
function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'verify_catalog')
body = next(n for n in function.body if isinstance(n, ast.For)).body
start = next(i for i, n in enumerate(body) if isinstance(n, ast.Assign) and isinstance(n.targets[0], ast.Name) and n.targets[0].id == 'owner')
code = compile(ast.Module(body=body[start:start+4], type_ignores=[]), str(file), 'exec')
owner = {('OWNER', p, False) for p in ('DELETE','INSERT','MAINTAIN','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE')}
count = 0
for table in ('ai_pi_business_actions','ai_pi_business_intents','ai_pi_business_audits'):
    grants = {'SELECT','INSERT','UPDATE'} if table.endswith('_actions') else {'SELECT','INSERT'}
    wanted = owner | {('teruisi_ai_writer', p, False) for p in grants}
    cases = [(wanted, True), (owner, False)]
    rejected = [wanted - {('teruisi_ai_writer', p, False)} for p in grants]
    rejected += [wanted | {('PUBLIC','SELECT',False)}, wanted | {('teruisi_ai_writer','DELETE',False)}, wanted | {('teruisi_ai_writer','INSERT',True)}]
    if not table.endswith('_actions'):
        rejected.append(wanted | {('teruisi_ai_writer','UPDATE',False)})
    for actual, permissions in cases:
        exec(code, {'table':table,'actual_acl':actual,'permissions':permissions})
        count += 1
    for actual in rejected:
        try:
            exec(code, {'table':table,'actual_acl':actual,'permissions':True})
        except ValueError:
            count += 1
        else:
            raise AssertionError('Migration gate accepted wrong ACL: ' + table)
print(f'PI152_ACL_BOUNDARIES_PASSED checks={count} exact_two_line_change=True no_database=True')
