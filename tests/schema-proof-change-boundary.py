"""Only read-only proof data flow may change under this finite profile."""
import argparse
import ast
import hashlib
import json
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
names = ("bi_app_addition", "jackyun_audit_addition", "ai_schedule_addition", "jd_logistics_addition",
         "jd_monitor_preferences_addition", "jd_product_monitoring_addition", "tmall_warehouse_addition", "pi_agent_addition")
allowed = {"parent_proof", "load_plan", "verify_active", "complete_database", "_load_plan_with_base", "_verify_active_with_base"}
REVIEWED_HELPER_SHA256 = {'bi_app_addition': '5f427969008eff5592b233e781823a85535fded07e1fa7fb237ea26fbb82318e', 'jackyun_audit_addition': '3c0ab5102be93fba70a437f8bb54448907ec3c01dfd33e1a1f9ebc31db895ebd', 'ai_schedule_addition': '215598723299861a1d5d11d2eb2535afc96717ebc12d6c957f5ab91d2b904731', 'jd_logistics_addition': '0e595fe8ce482cfd694a6441df2f7de95f8c5c4beda645c8af4068c0165468a9', 'jd_monitor_preferences_addition': '0ce895d93727940f343197df9b6cf077d141ddfe7f250b557619b6135ca62524', 'jd_product_monitoring_addition': 'c6ef0ae19674bb116f4cb33a96052ac50bdd6b374a3e99f5d7f68503419b393a', 'tmall_warehouse_addition': '75b374919ed78b5495995d27940ea6f5ace9dff83ff22c9bf59721da6dec41ae', 'pi_agent_addition': '1f10da98978a3545ca23a086c36ea03d13d7417a2bb63248e73d056c8862d024'}


def projected(raw):
    module = ast.parse(raw.decode("utf-8-sig"))
    return [ast.dump(node, include_attributes=False) for node in module.body
            if not isinstance(node, ast.FunctionDef) or node.name not in allowed]


def helper_digest(module):
    helpers = sorted((node for node in module.body if isinstance(node, ast.FunctionDef) and node.name in allowed), key=lambda node: node.name)
    body = json.dumps([ast.dump(node, include_attributes=False) for node in helpers], separators=(",", ":")).encode("ascii")
    return [node.name for node in helpers], hashlib.sha256(body).hexdigest()


def verify(before, after, name):
    raw = after if isinstance(after, bytes) else ast.unparse(after).encode("utf8")
    if projected(before) != projected(raw):
        raise RuntimeError("Outside finite read-only proof helpers changed: " + name)
    module = ast.parse(raw.decode("utf-8-sig"))
    wanted = ["_verify_active_with_base", "complete_database", "verify_active"] if name == "bi_app_addition" else sorted(allowed)
    actual, digest = helper_digest(module)
    if actual != wanted or digest != REVIEWED_HELPER_SHA256[name]:
        raise RuntimeError("Unknown read-only proof helper body; qualification review required: " + name)
    return digest


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", required=True)
    args = parser.parse_args()
    evidence = []
    for name in names:
        relative = "tools/" + name + ".py"
        before = subprocess.check_output(["git", "-C", str(root), "show", args.base + ":" + relative])
        after = (root / relative).read_bytes()
        helper_sha = verify(before, after, name)
        verify(before, b"\n# comment-only qualification probe\n" + after, name)
        for statement in ("connection.cursor().execute('UPDATE private_test SET value=1')", "unexpected_extra_call()"):
            mutated = ast.parse(after.decode("utf-8-sig"))
            selected = next(node for node in mutated.body if isinstance(node, ast.FunctionDef) and node.name == "complete_database")
            selected.body.insert(0, ast.parse(statement).body[0])
            try:
                verify(before, mutated, name)
            except RuntimeError:
                pass
            else:
                raise RuntimeError("Write/extra-call qualification negative was accepted: " + name)
        evidence.append({"path": relative, "beforeSha256": hashlib.sha256(before).hexdigest(),
                         "afterSha256": hashlib.sha256(after).hexdigest(), "reviewedHelperAstSha256": helper_sha})
    print(json.dumps({"status": "passed", "negativeCases": ["complete_database SQL write", "complete_database extra call"], "commentAndWhitespaceAccepted": True, "unchanged": "module constants/imports and admission/install/reconcile/finalize/database catalogue functions", "files": evidence}))


if __name__ == "__main__":
    main()
