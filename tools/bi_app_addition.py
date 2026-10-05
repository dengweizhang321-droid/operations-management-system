"""Finite ERP-goal append, layered over the unchanged verified 139 generation.

Never rewrites the protected parent receipt or replays its migrations. Admission,
maintenance, exact source, backup/restore, database identity and finalization are
all required. Only finance.0007 is installable through this operator.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import sys

STEP = "finance.0007_finance_erp_targets"
FILE = "backend/finance/migrations/0007_finance_erp_targets.py"
FILE_SHA = "b854202c8896331f54cfa89029b48b755891b25a756edf41395def7eb418c9cd"
VERSION = "teruisi-bi-erp-goal-addition-v1"
ACTIVE = "bi-app-addition-active.json"
HEX = re.compile(r"[0-9a-f]{64}\Z")

def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def canonical(value): return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()
def digest(value): return hashlib.sha256(canonical(value)).hexdigest()
def read(path, expected=None):
    path=Path(path).absolute()
    if any(p.is_symlink() or getattr(p,"is_junction",lambda:False)() for p in (path,*path.parents)) or not path.is_file() or path.stat().st_nlink!=1 or path.stat().st_size>16*1024*1024: raise ValueError("Unsafe addition evidence")
    if expected is not None and (not HEX.fullmatch(expected) or sha(path)!=expected): raise ValueError("Addition evidence changed")
    def pairs(items):
        result={}
        for key,value in items:
            if key in result: raise ValueError("Duplicate evidence key")
            result[key]=value
        return result
    return json.loads(path.read_text(encoding="utf-8-sig"),object_pairs_hook=pairs)
def write(path,value):
    with Path(path).open("xb") as output: output.write(canonical(value))
def directory(runtime,operation):
    if not re.fullmatch(r"[0-9a-f]{32}",operation): raise ValueError("Invalid addition operation")
    return Path(runtime)/"bi-app-additions"/operation
def migrations(root):
    from integration_migration_plan import python_source_sha256
    return {p.relative_to(root).as_posix():python_source_sha256(p.read_bytes()) for p in (Path(root)/"backend").glob("*/migrations/[0-9][0-9][0-9][0-9]_*.py")}
def original_parent(runtime,root=None):
    import integration_release_gate as gate
    reference=gate.active_delta(runtime)
    if not reference: raise ValueError("BI append requires the published 139 parent")
    old=Path(root) if root else Path(runtime)/"integration-deltas"/reference["operationId"]/"source"
    parent=gate.verify_release(old,runtime,allow_addition=False)
    from integration_migration_plan import load_policy
    policy=load_policy(old/gate.DELTA_POLICY)
    if len(policy.baseline+policy.steps)!=139: raise ValueError("Parent catalogue is not 139")
    return parent,set(policy.baseline+policy.steps)
def source_delta(root,baseline):
    before=migrations(Path(baseline));after=migrations(Path(root))
    if set(after)!=set(before)|{FILE} or any(after[p]!=v for p,v in before.items()) or after[FILE]!=FILE_SHA: raise ValueError("BI append changes another migration or the reviewed step")
    return digest(after)
def maintenance(runtime,expected):
    data=read(Path(runtime)/"run/system-maintenance.json")
    if data.get("id")!=expected or data.get("keepPostgres") is not True: raise ValueError("Addition maintenance binding changed")
    return sha(Path(runtime)/"run/system-maintenance.json")
def admission(root,runtime,evidence,evidence_sha):
    data=read(evidence,evidence_sha)
    if data.get("version")!=VERSION or data.get("status")!="reviewed" or data.get("step")!=STEP or data.get("stepSha256")!=FILE_SHA or data.get("privatePostgresPassed") is not True: raise ValueError("Addition candidate not reviewed")
    original_parent(runtime)
    if data.get("predecessorSha256")!=sha(Path(runtime)/"app/deployment.json") or data.get("parentReferenceSha256")!=sha(Path(runtime)/"integration-active-generation.json"): raise ValueError("Candidate predecessor changed")
    if source_delta(root,Path(runtime)/"app")!=data.get("migrationSha256"): raise ValueError("Candidate migration inventory changed")
    return data
def verify_active(root,runtime,*,installed=False):
    pointer=read(Path(runtime)/ACTIVE)
    if set(pointer)!={"version","operationId","receiptSha256"} or pointer["version"]!=VERSION: raise ValueError("Invalid BI active pointer")
    folder=directory(runtime,pointer["operationId"])
    result=read(folder/("installed.json" if installed else "finalized.json"), None if installed else pointer["receiptSha256"])
    plan=read(folder/"plan.json",result["planSha256"])
    original_parent(runtime,folder/"baseline")
    if sha(Path(runtime)/"integration-active-generation.json")!=plan["parentReferenceSha256"] or source_delta(root,folder/"baseline")!=plan["migrationSha256"]: raise ValueError("BI parent or migration generation changed")
    if result["version"]!=VERSION or result["step"]!=STEP or result["migrationCount"]!=140: raise ValueError("BI installation record invalid")
    if not installed:
        if result.get("status")!="verified": raise ValueError("BI addition not finalized")
        checked_backup(folder/"after-backup.json",result["afterBackupSha256"],folder/"after-restore.json",result["afterRestoreSha256"],140)
    return result,plan,folder
def complete_database(root,runtime):
    result,plan,folder=verify_active(root,runtime)
    from django.db import connection
    from django.db.migrations.executor import MigrationExecutor
    from django.db.migrations.recorder import MigrationRecorder
    _,base=original_parent(runtime,folder/"baseline")
    with connection.cursor() as cursor:
        cursor.execute("SELECT current_database(),current_user,inet_server_port()")
        if cursor.fetchone()!=("teruisi_sales","teruisi_sales_owner",5432): raise ValueError("Addition database identity changed")
    actual={".".join(x) for x in MigrationRecorder(connection).applied_migrations()}
    if actual!=base|{STEP} or MigrationExecutor(connection).migration_plan(MigrationExecutor(connection).loader.graph.leaf_nodes()): raise ValueError("Ordinary startup has pending or unknown migrations")
    return {"status":"complete","migrationCount":140}
def checked_backup(manifest,manifest_sha,restore,restore_sha,count):
    from integration_release_gate import verify_backup_restore
    value=verify_backup_restore(manifest,manifest_sha,restore,restore_sha,protected=True)
    if value["profileEvidence"]["tables"]["django_migrations"]["rows"]!=count: raise ValueError("Addition backup catalogue differs")
    return value
def main(args):
    root=Path(args.root).absolute();runtime=Path(args.runtime).absolute()
    if runtime!=Path(r"D:\teruisi-runtime\django-sales"): raise ValueError("Addition fixed runtime required")
    if args.command=="admission": return admission(root,runtime,args.evidence,args.evidence_sha)
    if args.command in {"release","successor"}:
        return verify_active(root,runtime)[0]
    if args.command=="deployment":
        folder=directory(runtime,args.operation);plan=read(folder/"plan.json")
        maintenance(runtime,plan["maintenanceId"])
        original_parent(runtime,folder/"baseline")
        if source_delta(root,folder/"baseline")!=plan["migrationSha256"] or sha(root/"deployment.json")!=plan["candidateManifestSha256"] or sha(runtime/"app/deployment.json")!=plan["predecessorSha256"]: raise ValueError("Addition deployment binding changed")
        checked_backup(folder/"before-backup.json",plan["beforeBackupSha256"],folder/"before-restore.json",plan["beforeRestoreSha256"],139)
        return plan
    folder=directory(runtime,args.operation)
    if args.command=="plan":
        evidence=admission(root,runtime,args.evidence,args.evidence_sha)
        maintenance_sha=maintenance(runtime,args.maintenance)
        backup=checked_backup(args.backup,args.backup_sha,args.restore,args.restore_sha,139)
        if backup["software"]["deploymentManifestSha256"]!=evidence["predecessorSha256"]: raise ValueError("Pre-backup predecessor differs")
        from datetime import datetime
        window=read(runtime/"run/system-maintenance.json")
        if datetime.fromisoformat(backup["createdAt"].replace("Z","+00:00")) < datetime.fromisoformat(window["createdAt"].replace("Z","+00:00")): raise ValueError("Migration requires backup within this maintenance window")
        if folder.exists() or (runtime/ACTIVE).exists(): raise ValueError("Addition already exists")
        folder.mkdir(parents=True)
        shutil.copytree(runtime/"app",folder/"baseline",ignore=shutil.ignore_patterns(".wrangler","runtime-tools","__pycache__"))
        for filename,path in [("candidate.json",args.evidence),("before-backup.json",args.backup),("before-restore.json",args.restore)]: shutil.copyfile(path,folder/filename)
        plan={**evidence,"status":"prepared","operationId":args.operation,"maintenanceId":args.maintenance,"maintenanceSha256":maintenance_sha,"candidateManifestSha256":args.candidate_sha,"beforeBackupSha256":args.backup_sha,"beforeRestoreSha256":args.restore_sha,"candidateEvidenceSha256":args.evidence_sha}
        write(folder/"plan.json",plan);return {"status":"prepared","planSha256":sha(folder/"plan.json")}
    plan=read(folder/"plan.json")
    if maintenance(runtime,plan["maintenanceId"])!=plan["maintenanceSha256"] or source_delta(root,folder/"baseline")!=plan["migrationSha256"] or sha(runtime/"app/deployment.json")!=plan["candidateManifestSha256"]: raise ValueError("Addition adoption binding changed")
    if args.command=="install":
        import os
        sys.path.insert(0,str(root/"backend"));os.environ["DJANGO_SETTINGS_MODULE"]="teruisi_backend.settings"
        import django;django.setup()
        from django.db import connection,transaction
        from django.db.migrations.executor import MigrationExecutor
        from django.db.migrations.recorder import MigrationRecorder
        _,base=original_parent(runtime,folder/"baseline")
        with connection.cursor() as cursor:
            cursor.execute("SELECT current_database(),current_user,inet_server_port()")
            if cursor.fetchone()!=("teruisi_sales","teruisi_sales_owner",5432): raise ValueError("Migration owner identity changed")
        if {".".join(x) for x in MigrationRecorder(connection).applied_migrations()}!=base: raise ValueError("Baseline receipts changed; no replay")
        executor=MigrationExecutor(connection);step=tuple(STEP.split(".",1))
        if [(".".join((migration.app_label,migration.name)),backward) for migration,backward in executor.migration_plan([step])]!=[(STEP,False)]: raise ValueError("Only ERP-goal migration may execute")
        executor.migrate([step])
        actual={".".join(x) for x in MigrationRecorder(connection).applied_migrations()}
        if actual!=base|{STEP}: raise ValueError("Migration result differs")
        with transaction.atomic(),connection.cursor() as cursor:
            cursor.execute("GRANT SELECT ON public.finance_erp_targets TO teruisi_finance_reader")
            cursor.execute("GRANT SELECT, INSERT, UPDATE ON public.finance_erp_targets TO teruisi_finance_writer")
            cursor.execute("SELECT COUNT(*) FROM public.finance_erp_targets")
            if cursor.fetchone()[0]!=0: raise ValueError("New goals must start empty")
        result={"version":VERSION,"status":"schema_installed","step":STEP,"migrationCount":140,"planSha256":sha(folder/"plan.json")}
        write(folder/"installed.json",result)
        write(runtime/ACTIVE,{"version":VERSION,"operationId":args.operation,"receiptSha256":sha(folder/"installed.json")})
        return result
    if args.command=="finalize":
        installed=read(folder/"installed.json")
        if installed["status"]!="schema_installed" or installed["planSha256"]!=sha(folder/"plan.json"): raise ValueError("Addition installation incomplete")
        after=checked_backup(args.backup,args.backup_sha,args.restore,args.restore_sha,140)
        if after["software"]["deploymentManifestSha256"]!=plan["candidateManifestSha256"]: raise ValueError("Post-backup candidate differs")
        for name,path in [("after-backup.json",args.backup),("after-restore.json",args.restore)]: shutil.copyfile(path,folder/name)
        result={**installed,"status":"verified","afterBackupSha256":args.backup_sha,"afterRestoreSha256":args.restore_sha}
        write(folder/"finalized.json",result)
        pointer=runtime/ACTIVE
        # Atomic update of only this addition's own pointer; parent139 unchanged.
        temp=folder/"active-finalized.tmp";write(temp,{"version":VERSION,"operationId":args.operation,"receiptSha256":sha(folder/"finalized.json")});temp.replace(pointer)
        return result
    raise ValueError("Unknown addition command")

if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("command",choices=["admission","plan","deployment","install","finalize","release","successor"])
    for name in ["root","runtime","operation","maintenance","evidence","evidence-sha","candidate-sha","backup","backup-sha","restore","restore-sha"]: parser.add_argument("--"+name,default="")
    try: print(json.dumps({"status":"verified","result":main(parser.parse_args())},ensure_ascii=True))
    except Exception as error: print(json.dumps({"status":"blocked","reason":str(error)},ensure_ascii=True));sys.exit(1)
