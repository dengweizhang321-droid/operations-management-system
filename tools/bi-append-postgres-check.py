"""Synthetic unprivileged-owner append and no-key restore, never port5432."""
import argparse
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location("role_rehearsal",ROOT/"tools/integration-migration-role-rehearsal.py")
role=importlib.util.module_from_spec(spec);spec.loader.exec_module(role)

def worker(stage,port,privileged):
    output=io.StringIO()
    with contextlib.redirect_stdout(output):role.worker(stage,port,privileged,False)
    result=json.loads(output.getvalue())
    if stage=="probe":
        if result.get("status")!="mixed_completed" or result.get("finalReceiptCount")!=140:raise RuntimeError("Synthetic full generation did not complete")
        from django.db import connection
        from django.db.migrations.executor import MigrationExecutor
        from django.db.migrations.recorder import MigrationRecorder
        from bi_app_addition import apply_goal_step,STEP
        # Fixture-only rollback establishes the exact real 139 catalogue.
        MigrationExecutor(connection).migrate([("finance","0006_raw_workbook_bytes_v2")])
        base={".".join(x) for x in MigrationRecorder(connection).applied_migrations()}
        if len(base)!=139 or STEP in base:raise RuntimeError("Synthetic 139 baseline differs")
        with patch("postgres_no_key_backup.verify_receipt_generation",side_effect=RuntimeError("synthetic catalogue refusal")):
            try:apply_goal_step(connection,base)
            except RuntimeError as error:
                if str(error)!="synthetic catalogue refusal":raise
            else:raise RuntimeError("Catalogue refusal did not reject installation")
        with connection.cursor() as cursor:
            cursor.execute("SELECT to_regclass('public.finance_erp_targets') IS NULL")
            if cursor.fetchone()!=(True,):raise RuntimeError("Failed append left DDL")
        if {".".join(x) for x in MigrationRecorder(connection).applied_migrations()}!=base:raise RuntimeError("Failed append left receipt")
        apply_goal_step(connection,base)
        try:apply_goal_step(connection,base)
        except ValueError:pass
        else:raise RuntimeError("Append replay accepted")
        with connection.cursor() as cursor:
            cursor.execute("SELECT has_table_privilege('teruisi_finance_reader','public.finance_erp_targets','SELECT'),has_table_privilege('teruisi_finance_reader','public.finance_erp_targets','INSERT'),has_table_privilege('teruisi_finance_writer','public.finance_erp_targets','UPDATE'),has_table_privilege('teruisi_finance_writer','public.finance_erp_targets','DELETE')")
            if cursor.fetchone()!=(True,False,True,False):raise RuntimeError("ERP-goal role permissions differ")
            from postgres_no_key_backup import verify_receipt_generation
            if verify_receipt_generation(cursor)!=140:raise RuntimeError("140 catalogue rejected")
        result["erpGoalAppend"]={"atomicFailureRollback":True,"replayRejected":True,"minimalExistingRoleGrants":True,"exactGeneration":140}
    print(json.dumps(result))

if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--worker",choices=("baseline","probe","files","runtime"))
    parser.add_argument("--port",type=int,default=55886)
    parser.add_argument("--restore-port",type=int,default=55887)
    parser.add_argument("--privileged-ai-step",action="append",default=[])
    args=parser.parse_args()
    if args.worker:
        worker(args.worker,args.port,args.privileged_ai_step)
    else:
        from integration_migration_plan import PRIVILEGED_STEPS
        privileged=sorted(x.split(".")[1][:4] for x in PRIVILEGED_STEPS)
        role.run_probe(args.port,True,privileged,args.restore_port,False,True,
            baseline_runtime_grants=True,worker_script=Path(__file__),expected_generation=140)
