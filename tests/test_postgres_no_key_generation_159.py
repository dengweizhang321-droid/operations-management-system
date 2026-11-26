"""无新增密钥备份闸（django-postgres-maintenance.ps1）的真实 PowerShell 行为测试。

从真实脚本里用 AST 取出 Assert-MaintenanceNoKeyGeneration，逐代际喂入由真实目录
（policy-v3 + 各 *_catalog.STEPS）累计出的迁移清单，断言准入/拒绝；
并断言 PS 闸接受的代际集合与 postgres_no_key_backup.py 的精确代际清单一致。
不连接任何数据库。
"""
import json
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

PS_SCRIPT = ROOT / "tools/django-postgres-maintenance.ps1"
BACKUP_PY = ROOT / "tools/postgres_no_key_backup.py"

HARNESS = r"""$ErrorActionPreference='Stop'
$source=$args[0];$fixture=$args[1]
$tokens=$null;$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Maintenance parse failed'}
$fn=$ast.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Assert-MaintenanceNoKeyGeneration'},$true)
Invoke-Expression $fn.Extent.Text
$cases=Get-Content -LiteralPath $fixture -Raw | ConvertFrom-Json
$results=@()
foreach($case in $cases){
 $accepted=$true;$generation=0
 try{$generation=Assert-MaintenanceNoKeyGeneration $case.evidence}catch{$accepted=$false}
 $results+=[pscustomobject]@{label=[string]$case.label;accepted=$accepted;generation=[int]$generation}
}
ConvertTo-Json -InputObject @($results) -Compress
"""

AI_TASK_HARNESS = r"""$ErrorActionPreference='Stop'
$source=$args[0];$fixture=$args[1]
$tokens=$null;$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Maintenance parse failed'}
$fn=$ast.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Get-MaintenanceAiTaskTables'},$true)
if($null -eq $fn){throw 'Get-MaintenanceAiTaskTables missing'}
Invoke-Expression $fn.Extent.Text
$cases=Get-Content -LiteralPath $fixture -Raw | ConvertFrom-Json
$results=@()
foreach($case in $cases){
 $accepted=$true;$tables=@();$count=-1
 try{
  $r=Get-MaintenanceAiTaskTables @($case.migrations) @($case.tables)
  $count=$r.Count;$tables=@($r)
 }catch{$accepted=$false}
 $results+=[pscustomobject]@{label=[string]$case.label;accepted=$accepted;count=$count;tables=@($tables)}
}
ConvertTo-Json -InputObject @($results) -Depth 5 -Compress
"""


def powershell_hosts():
    hosts = [r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"]
    if shutil.which("pwsh"):
        hosts.append(shutil.which("pwsh"))
    return hosts


def build_generations():
    from integration_migration_plan import load_policy, DELTA_STEP
    import jackyun_audit_catalog, ai_schedule_addition_catalog, jd_logistics_catalog
    import jd_monitor_preferences_catalog, jd_product_monitoring_catalog, tmall_warehouse_catalog
    import pi_agent_catalog, pi_workspace_catalog, pi_business_catalog, pi_native_catalog
    import sales_preflight_catalog, workflow_automation_catalog
    import ai_task_feedback_candidates_catalog, ai_unified_tasks_catalog, ops_query_index_catalog
    import sales_subdivision_edits_catalog
    policy = load_policy(ROOT / "config/integration-migration-policy-v3.json")
    generations = {138: list(policy.baseline + policy.steps)}
    stages = [
        (139, [DELTA_STEP]), (140, ["finance.0007_finance_erp_targets"]),
        (142, jackyun_audit_catalog.STEPS), (143, ai_schedule_addition_catalog.STEPS),
        (146, jd_logistics_catalog.STEPS), (147, jd_monitor_preferences_catalog.STEPS),
        (148, jd_product_monitoring_catalog.STEPS), (149, tmall_warehouse_catalog.STEPS),
        (150, pi_agent_catalog.STEPS), (151, pi_workspace_catalog.STEPS),
        (152, pi_business_catalog.STEPS), (153, pi_native_catalog.STEPS),
        (154, sales_preflight_catalog.STEPS), (156, workflow_automation_catalog.STEPS),
        (158, ai_task_feedback_candidates_catalog.STEPS), (159, ai_unified_tasks_catalog.STEPS), (162, ops_query_index_catalog.STEPS),
        (163, sales_subdivision_edits_catalog.STEPS),
    ]
    previous = 138
    for generation, steps in stages:
        generations[generation] = generations[previous] + list(steps)
        previous = generation
    return generations


def evidence(steps, count=None):
    return {"migrations": [{"app": item.split(".", 1)[0], "name": item.split(".", 1)[1]} for item in steps],
            "tables": {"django_migrations": len(steps) if count is None else count}}


class NoKeyGeneration159Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.generations = build_generations()

    def test_catalog_steps_match_documented_generation_deltas(self):
        g = self.generations
        self.assertEqual(sorted(g), [138, 139, 140, 142, 143, 146, 147, 148, 149, 150, 151, 152, 153, 154, 156, 158, 159, 162, 163])
        for generation, steps in g.items():
            self.assertEqual(len(steps), generation, generation)
            self.assertEqual(len(set(steps)), len(steps), generation)
        self.assertEqual(g[156][154:], ["workflow.0009_automation_projection_b1", "workflow.0010_customer_service_chain_modules"])
        self.assertEqual(g[158][156:], ["ai_assistant.0088_task_feedback", "ai_assistant.0089_skill_candidates"])
        self.assertEqual(g[159][158:], ["ai_assistant.0090_unified_tasks"])
        self.assertEqual(g[162][159:], ["sales.0013_customer_service_online_spec_index",
                                        "netshop.0005_market_projection_page_index",
                                        "customer_service.0003_ai_analyzed_at_index"])
        self.assertEqual(g[163][162:], ["sales.0014_product_subdivision_edits"])

    def test_real_powershell_accepts_exact_generations_and_rejects_the_rest(self):
        g = self.generations
        cases = [{"label": str(n), "accepted": True, "evidence": evidence(steps)} for n, steps in sorted(g.items())]
        g159 = g[159]
        wf09 = g[156][154]
        bad = {
            "155-only-workflow-0009": g[154] + [wf09],
            "157-only-0088": g[156] + ["ai_assistant.0088_task_feedback"],
            "154-plus-0090-only": g[154] + ["ai_assistant.0090_unified_tasks"],
            "159-duplicate-migration": g159[:-1] + [g159[-2], g159[-1]],
            "159-unknown-0091": g159 + ["ai_assistant.0091_unknown"],
            "159-without-workflow-0010": [x for x in g159 if x != "workflow.0010_customer_service_chain_modules"] + ["ai_assistant.0091_unknown"],
            "158-without-workflow-0010-count157": [x for x in g159 if x != "workflow.0010_customer_service_chain_modules"],
        }
        for label, steps in bad.items():
            cases.append({"label": label, "accepted": False, "evidence": evidence(steps)})
        cases.append({"label": "159-table-count-158", "accepted": False, "evidence": evidence(g159, 158)})
        g162 = g[162]
        for label, steps in {
            "160-only-sales0013": g159 + [g162[159]],
            "161-sales0013-netshop0005": g159 + g162[159:161],
            "162-without-netshop0005": [x for x in g162 if x != "netshop.0005_market_projection_page_index"] + ["ai_assistant.0091_unknown"],
            "162-duplicate-cs0003": g162 + [g162[-1]],
            "162-unknown-0091": g162 + ["ai_assistant.0091_unknown"],
            "158-plus-index-steps-without-0090": g[158] + g162[159:],
        }.items():
            cases.append({"label": label, "accepted": False, "evidence": evidence(steps)})
        cases.append({"label": "162-table-count-159", "accepted": False, "evidence": evidence(g162, 159)})
        g163 = g[163]
        for label, steps in {
            "163-without-sales0014": g162 + ["ai_assistant.0091_unknown"],
            "163-duplicate-sales0014": g163 + [g163[-1]],
            "163-unknown-0091": g163 + ["ai_assistant.0091_unknown"],
            "159-plus-sales0014-without-index-steps": g159 + [g163[162]],
            "163-without-netshop0005": [x for x in g163 if x != "netshop.0005_market_projection_page_index"] + ["ai_assistant.0091_unknown"],
        }.items():
            cases.append({"label": label, "accepted": False, "evidence": evidence(steps)})
        cases.append({"label": "163-table-count-162", "accepted": False, "evidence": evidence(g163, 162)})
        expected = {c["label"]: c["accepted"] for c in cases}
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            fixture = folder / "cases.json"; harness = folder / "harness.ps1"
            fixture.write_text(json.dumps(cases), encoding="utf-8")
            harness.write_text(HARNESS, encoding="utf-8-sig")
            for host in powershell_hosts():
                result = subprocess.run([host, "-NoProfile", "-NonInteractive", "-File", str(harness), str(PS_SCRIPT), str(fixture)],
                                        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60)
                self.assertEqual(result.returncode, 0, host + "\n" + result.stdout + result.stderr)
                rows = json.loads(result.stdout.strip().splitlines()[-1])
                self.assertEqual(len(rows), len(cases), host)
                for row in rows:
                    self.assertEqual(row["accepted"], expected[row["label"]], host + " " + row["label"])
                    if row["accepted"]:
                        self.assertEqual(row["generation"], int(row["label"]), host + " " + row["label"])

    def test_powershell_allowed_set_equals_python_exact_generations(self):
        py = BACKUP_PY.read_text(encoding="utf-8")
        found = {int(n) for n in re.findall(r"^\s*(?:generation|parent)(\d+)\s*=\s*sorted\(", py, re.M)}
        self.assertGreaterEqual(len(found), 17, "提取器失效：只找到 " + str(sorted(found)))
        expected = found | {138, 139}
        ps = PS_SCRIPT.read_text(encoding="utf-8-sig")
        m = re.search(r"\(\$generation -cnotin @\(((?:\d+,)*\d+)\)\)", ps)
        self.assertIsNotNone(m, "找不到 PS 允许代际清单")
        allowed = {int(n) for n in m.group(1).split(",")}
        self.assertEqual(allowed, expected)
        self.assertNotIn(155, allowed)
        self.assertNotIn(157, allowed)


    def test_ai_task_tables_function_on_real_powershell(self):
        manifest = (ROOT / "backend/ai_assistant/table_manifest.py").read_text(encoding="utf-8")

        def tuple_of(name):
            m = re.search(r"^" + name + r" = \(([^)]*)\)", manifest, re.M)
            self.assertIsNotNone(m, name)
            items = re.findall(r'"(ai_[a-z0-9_]+)"', m.group(1))
            self.assertTrue(items, name)
            return items
        feedback = tuple_of("TASK_FEEDBACK_TABLES")
        candidates = tuple_of("SKILL_CANDIDATE_TABLES")
        unified = tuple_of("UNIFIED_TASK_TABLES")
        self.assertEqual(len(unified), 5)
        m88 = {"app": "ai_assistant", "name": "0088_task_feedback"}
        m89 = {"app": "ai_assistant", "name": "0089_skill_candidates"}
        m90 = {"app": "ai_assistant", "name": "0090_unified_tasks"}
        cases = [
            {"label": "none", "migrations": [], "tables": [], "expect": []},
            {"label": "only88", "migrations": [m88], "tables": feedback, "expect": feedback},
            {"label": "88+89", "migrations": [m88, m89], "tables": [], "expect": feedback + candidates},
            {"label": "88+89+90", "migrations": [m88, m89, m90], "tables": [], "expect": feedback + candidates + unified},
            {"label": "bad-90-without-89", "migrations": [m88, m90], "tables": [], "expect": None},
            {"label": "bad-89-without-88", "migrations": [m89], "tables": [], "expect": None},
            {"label": "bad-duplicate-90", "migrations": [m88, m89, m90, m90], "tables": [], "expect": None},
            {"label": "bad-runs-table-without-90", "migrations": [m88, m89], "tables": ["ai_task_runs"], "expect": None},
            {"label": "bad-feedback-table-without-88", "migrations": [], "tables": ["ai_task_feedback"], "expect": None},
        ]
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            fixture = folder / "cases.json"; harness = folder / "harness.ps1"
            fixture.write_text(json.dumps(cases), encoding="utf-8")
            harness.write_text(AI_TASK_HARNESS, encoding="utf-8-sig")
            for host in powershell_hosts():
                result = subprocess.run([host, "-NoProfile", "-NonInteractive", "-File", str(harness), str(PS_SCRIPT), str(fixture)],
                                        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60)
                self.assertEqual(result.returncode, 0, host + "\n" + result.stdout + result.stderr)
                rows = {r["label"]: r for r in json.loads(result.stdout.strip().splitlines()[-1])}
                self.assertEqual(len(rows), len(cases), host)
                for case in cases:
                    row = rows[case["label"]]
                    where = host + " " + case["label"]
                    if case["expect"] is None:
                        self.assertFalse(row["accepted"], where)
                    else:
                        self.assertTrue(row["accepted"], where)
                        self.assertEqual(row["count"], len(case["expect"]), where)
                        self.assertEqual(sorted(row["tables"] if isinstance(row["tables"], list) else [row["tables"]]), sorted(case["expect"]), where)

    def test_evidence_calls_ai_task_tables_before_inventory_check(self):
        ps = PS_SCRIPT.read_text(encoding="utf-8-sig")
        start = ps.index("function Assert-MaintenanceEvidence(")
        end = ps.find("\nfunction ", start + 1)
        body = ps[start:end if end >= 0 else len(ps)]
        call = body.find("Get-MaintenanceAiTaskTables")
        self.assertGreaterEqual(call, 0, "Assert-MaintenanceEvidence 没有调用 Get-MaintenanceAiTaskTables")
        inventory = body.find("-cnotin $requiredTables")
        self.assertGreaterEqual(inventory, 0, "找不到 ai_* 清单检查")
        self.assertLess(call, inventory)
        self.assertLess(call, body.find("foreach ($required in $requiredTables)"))


if __name__ == "__main__":
    unittest.main()
