"""Finite JD boundaries; fixtures own their paths and never use production DSNs."""
import copy
import json
import os
from pathlib import Path
import sys
import tempfile
import subprocess
import unittest
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import jd_logistics_addition as addition
import jd_logistics_catalog as catalog
import bi_app_addition as common


class JdSchemaTests(unittest.TestCase):
    def test_database_identity_accepts_only_exact_production_identity(self):
        connection=MagicMock()
        cursor=connection.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value=("teruisi_sales","teruisi_sales_owner","127.0.0.1",5432)
        addition.database_identity(connection)
        cursor.execute.assert_called_once_with("SELECT current_database(),current_user,host(inet_server_addr()),inet_server_port()")

    def test_database_identity_rejects_wrong_database_role_host_and_port(self):
        expected=("teruisi_sales","teruisi_sales_owner","127.0.0.1",5432)
        changes={0:["postgres",None],1:["postgres","teruisi_inventory_writer",None],
                 2:["127.0.0.1/32","127.0.0.2","::1","192.0.2.1",None],3:[55969,"5432",None]}
        for index,values in changes.items():
            for value in values:
                actual=list(expected);actual[index]=value
                connection=MagicMock()
                connection.cursor.return_value.__enter__.return_value.fetchone.return_value=tuple(actual)
                with self.subTest(field=index,value=value),self.assertRaises(ValueError):
                    addition.database_identity(connection)

    @unittest.skipUnless(os.environ.get("JD_SCHEMA_REHEARSAL_DIR"),"Requires the owned private PostgreSQL rehearsal")
    def test_postgres_identity_expression_returns_host_without_mask(self):
        from django.db import connection
        params=connection.settings_dict
        self.assertEqual(params["HOST"],"127.0.0.1")
        self.assertEqual(params["NAME"],"teruisi_jd_schema_rehearsal")
        self.assertTrue(55960<=int(params["PORT"])<55970)
        # Execute the production function's actual SQL against the private DB;
        # do not pretend this fixture has the production name/role/5432 port.
        queries=[value for value in addition.database_identity.__code__.co_consts
                 if isinstance(value,str) and value.startswith("SELECT ")]
        self.assertEqual(len(queries),1)
        with connection.cursor() as cursor:
            cursor.execute(queries[0]);identity=cursor.fetchone()
            self.assertEqual(identity,(params["NAME"],params["USER"],"127.0.0.1",int(params["PORT"])))
            cursor.execute("SELECT inet_server_addr()::text,host(inet_server_addr())")
            self.assertEqual(cursor.fetchone(),("127.0.0.1/32","127.0.0.1"))
        with self.assertRaises(ValueError):
            addition.database_identity(connection)

    def test_exact_delta_and_each_parent_addition_mutation(self):
        before = {"backend/old/migrations/0001.py": "a" * 64}
        after = {**before, **catalog.FILES}
        with patch.object(common, "migrations", side_effect=[before, after]):
            self.assertEqual(addition.source_delta("candidate", "parent"), common.digest(after))
        bad = [{**after, next(iter(before)): "b" * 64}, {**after, "backend/x/migrations/9999.py": "b" * 64},
               {k: v for k, v in after.items() if k != next(iter(catalog.FILES))},
               {**after, next(iter(catalog.FILES)): "b" * 64}]
        for candidate in bad:
            with self.subTest(candidate=candidate), patch.object(common, "migrations", side_effect=[before, candidate]), self.assertRaises(ValueError):
                addition.source_delta("candidate", "parent")

    def test_parent_uses_captured143_and_preserves_original_chain(self):
        base = {"old." + str(i) for i in range(142)}
        with patch.object(addition.parent, "verify_active", return_value=({"migrationCount":143}, {}, Path("original-ai"))) as verify, patch.object(addition.parent, "parent_proof", return_value=(base,"x")), patch.object(common,"sha",return_value="a"*64):
            result, _ = addition.parent_proof("runtime", "captured143")
            verify.assert_called_once_with("captured143", "runtime")
            self.assertEqual(len(result),143)

    def test_parent_rejects_wrong_count(self):
        with patch.object(addition.parent, "verify_active", return_value=({"migrationCount":142}, {}, Path("original-ai"))), patch.object(addition.parent, "parent_proof", return_value=(set(),"x")), self.assertRaises(ValueError):
            addition.parent_proof("runtime", "captured143")

    def test_catalog_rejects_extra_and_missing_table_even_with_count(self):
        for names in [list(catalog.TABLES)[:-1], [*catalog.TABLES,"inventory_jd_logistics_unknown"]]:
            cursor=MagicMock(); cursor.fetchall.return_value=[(name,) for name in names]
            with self.assertRaises(ValueError): catalog.verify_catalog(cursor,installed=True)

    def test_old_generations_reject_unrecorded_jd_table(self):
        cursor=MagicMock(); cursor.fetchall.return_value=[(catalog.TABLES[0],)]
        with self.assertRaises(ValueError): catalog.verify_catalog(cursor,installed=False)

    def test_catalog_rejects_index_and_column_drift(self):
        reference=json.loads((ROOT/"tools/jd_logistics_catalog.json").read_text(encoding="utf8"))
        for field in ["columns","indexes","triggers","policies","identity","columnAcl"]:
            value=copy.deepcopy(reference); value[catalog.TABLES[0]][field]=[]
            if field in {"triggers","policies","columnAcl"}: value[catalog.TABLES[0]][field]=[["unexpected"]]
            cursor=MagicMock(); cursor.fetchall.return_value=[(name,) for name in catalog.TABLES]
            with patch.object(catalog,"inspect_tables",return_value=value), self.assertRaises(ValueError):
                catalog.verify_catalog(cursor,installed=True,permissions=True)

    def test_prepared_receipt_binds_exact_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            runtime=Path(tmp); operation="a"*32
            value={"version":"teruisi-django-prepared-app-v1","id":operation,"runtimeRoot":str(runtime),"predecessorManifestSha256":"b"*64,"candidateManifestSha256":"c"*64}
            path=runtime/('app.prepare-'+operation+'.json');common.write(path,value)
            addition.prepared_binding(runtime,operation,common.sha(path),"c"*64)
            with self.assertRaises(ValueError):addition.prepared_binding(runtime,operation,common.sha(path),"d"*64)

    def test_intent_blocks_replay_even_if_database_rolled_back143(self):
        with tempfile.TemporaryDirectory() as tmp:
            runtime=Path(tmp);folder=runtime/'owned';folder.mkdir()
            common.write(folder/'plan.json',{})
            common.write(folder/'install-intent.json',{})
            connection=MagicMock()
            with patch('postgres_no_key_backup.verify_receipt_generation',return_value=143), patch.object(addition,'apply_steps') as apply, self.assertRaises(ValueError):
                addition.install_schema('install',connection,runtime,'a'*32,folder,{},set())
            apply.assert_not_called()

    def test_reconcile_cannot_migrate_or_replay(self):
        with tempfile.TemporaryDirectory() as tmp:
            runtime=Path(tmp);folder=runtime/'owned';folder.mkdir();common.write(folder/'plan.json',{})
            common.write(folder/'install-intent.json',{'version':addition.VERSION,'planSha256':common.sha(folder/'plan.json')})
            with patch.object(addition,'check_database',side_effect=ValueError('unknown146')) as check, patch.object(addition,'apply_steps') as apply, self.assertRaises(ValueError):
                addition.install_schema('reconcile',MagicMock(),runtime,'a'*32,folder,{},set())
            check.assert_called_once();apply.assert_not_called()

    def test_reconcile_exact146_publishes_same_result_idempotently(self):
        with tempfile.TemporaryDirectory() as tmp:
            runtime=Path(tmp);folder=runtime/'owned';folder.mkdir();common.write(folder/'plan.json',{})
            common.write(folder/'install-intent.json',{'version':addition.VERSION,'planSha256':common.sha(folder/'plan.json')})
            plan={'migrationSha256':'b'*64,'parentReferenceSha256':'c'*64}
            with patch.object(addition,'check_database'),patch.object(addition,'apply_steps') as apply:
                first=addition.install_schema('reconcile',MagicMock(),runtime,'a'*32,folder,plan,set())
                second=addition.install_schema('reconcile',MagicMock(),runtime,'a'*32,folder,plan,set())
            self.assertEqual(first,second);apply.assert_not_called()

    def test_pending_or_unknown_migration_blocks_database_complete(self):
        connection=MagicMock()
        for applied,pending in [([],[]),([tuple(x.split('.',1)) for x in catalog.STEPS],[('unexpected',False)])]:
            with patch('postgres_no_key_backup.verify_receipt_generation',return_value=146),patch.object(addition,'verify_catalog'),patch('django.db.migrations.recorder.MigrationRecorder') as recorder,patch('django.db.migrations.executor.MigrationExecutor') as executor,self.assertRaises(ValueError):
                recorder.return_value.applied_migrations.return_value=applied
                executor.return_value.migration_plan.return_value=pending
                addition.check_database(connection,set())

    def test_original_windows_powershell_backup_generation_consumer(self):
        import integration_migration_plan as migrations
        policy=migrations.load_policy(ROOT/'config/integration-migration-policy-v3.json')
        baseline=sorted(policy.baseline+policy.steps)
        extras=[migrations.DELTA_STEP,'finance.0007_finance_erp_targets',
                'erp_reference.0003_jackyun_upload_audit_binding','sales.0011_jackyun_upload_audit_binding',
                'ai_assistant.0083_schedule_execution_profile',*catalog.STEPS]
        cases=[(138,baseline),(139,baseline+extras[:1]),(140,baseline+extras[:2]),
               (142,baseline+extras[:4]),(143,baseline+extras[:5]),(146,baseline+extras),(147,baseline+extras+["inventory.0015_jd_monitor_preferences"])]
        cases += [(0,baseline+extras[:-1]),(0,baseline+extras[:-1]+['inventory.9999_unknown']),
                  (0,baseline+extras+[catalog.STEPS[0]])]
        source=(ROOT/'tools/django-postgres-maintenance.ps1').as_posix()
        script=f"""$ErrorActionPreference='Stop'
$ast=[System.Management.Automation.Language.Parser]::ParseFile('{source}',[ref]$null,[ref]$null)
$fn=$ast.Find({{param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Assert-MaintenanceNoKeyGeneration'}},$true)
Invoke-Expression $fn.Extent.Text
$cases=Get-Content -LiteralPath $args[0] -Raw|ConvertFrom-Json
foreach($case in $cases){{
 $identities=@($case[1]);$rows=@($identities|ForEach-Object {{$pair=$_ -split '\\.',2;[pscustomobject]@{{app=$pair[0];name=$pair[1]}}}})
 $evidence=[pscustomobject]@{{migrations=$rows;tables=[pscustomobject]@{{django_migrations=$rows.Count}}}}
 $accepted=0
 try{{$accepted=Assert-MaintenanceNoKeyGeneration $evidence}}catch{{if([int]$case[0] -ne 0){{throw}}}}
 if([int]$accepted -ne [int]$case[0]){{throw 'Generation admitted an unknown or wrong catalogue'}}
}}
'BACKUP_GENERATIONS_OK'
"""
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'catalogue.ps1';path.write_text(script,encoding='utf-8-sig')
            fixture=Path(tmp)/'cases.json';fixture.write_text(json.dumps(cases),encoding='ascii')
            result=subprocess.run([r'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe','-NoProfile','-NonInteractive','-File',str(path),str(fixture)],capture_output=True,text=True,timeout=30)
            self.assertEqual(result.returncode,0,result.stdout+result.stderr)
            self.assertIn('BACKUP_GENERATIONS_OK',result.stdout)


if __name__=='__main__':unittest.main()
