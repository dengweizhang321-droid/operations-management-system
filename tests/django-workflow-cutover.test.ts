import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";


const service = readFileSync(new URL("../tools/django-workflow-service.ps1", import.meta.url), "utf8");
const base = readFileSync(new URL("../tools/django-local-service.ps1", import.meta.url), "utf8");
const cutover = readFileSync(new URL("../tools/django-workflow-cutover.ps1", import.meta.url), "utf8");
const operationsCutover = readFileSync(
  new URL("../tools/django-workflow-operations-cutover.ps1", import.meta.url),
  "utf8",
);
const operationsProductionSmoke = readFileSync(
  new URL("../tools/workflow-operations-production-smoke.ps1", import.meta.url),
  "utf8",
);
const operationsProductionSmokePath = fileURLToPath(
  new URL("../tools/workflow-operations-production-smoke.ps1", import.meta.url),
);
const operationsConsumerSmoke = readFileSync(
  new URL("../tools/workflow-operations-consumer-smoke.ts", import.meta.url),
  "utf8",
);
const operationsD1RejectionSmoke = readFileSync(
  new URL("../tools/workflow-operations-d1-rejection-smoke.py", import.meta.url),
  "utf8",
);
const authoritySql = readFileSync(
  new URL("../drizzle/0103_workflow_launch_write_authority.sql", import.meta.url),
  "utf8",
);
const operationsAuthoritySql = readFileSync(
  new URL("../drizzle/0105_workflow_operations_write_authority.sql", import.meta.url),
  "utf8",
);
const operationsRetirementSql = readFileSync(
  new URL("../drizzle/0106_workflow_operations_domain_retirement.sql", import.meta.url),
  "utf8",
);
const writerFence = readFileSync(
  new URL("../backend/workflow/write_requests.py", import.meta.url),
  "utf8",
);
const operationsMigration = readFileSync(
  new URL("../backend/workflow/management/commands/migrate_workflow_operations_from_d1.py", import.meta.url),
  "utf8",
);
const operationsAuthority = readFileSync(
  new URL("../backend/workflow/management/commands/workflow_operations_write_authority.py", import.meta.url),
  "utf8",
);
const operationsRetirement = readFileSync(
  new URL("../backend/workflow/management/commands/retire_workflow_operations_d1.py", import.meta.url),
  "utf8",
);
const operationsDomain = readFileSync(
  new URL("../backend/workflow/operations.py", import.meta.url),
  "utf8",
);
const backup = readFileSync(new URL("../tools/postgres-consistent-backup.py", import.meta.url), "utf8");
const maintenance = readFileSync(new URL("../tools/django-postgres-maintenance.ps1", import.meta.url), "utf8");
const weeklyWorkflow = JSON.parse(readFileSync(
  new URL("../automation/n8n/new-product-weekly-dingtalk.workflow.json", import.meta.url),
  "utf8",
)) as { id: string; active: boolean; nodes: Array<{ type: string; parameters?: { command?: string } }> };


test("workflow runtime has isolated ports, roles, authority and a strict DML allowlist", () => {
  assert.match(service, /127\.0\.0\.1:8061/);
  assert.match(service, /127\.0\.0\.1:8062/);
  assert.match(service, /teruisi_workflow_reader/);
  assert.match(service, /teruisi_workflow_writer/);
  assert.match(service, /WorkflowWriteAuthority/);
  assert.match(service, /workflow_new_product_projects/);
  assert.match(service, /workflow_write_request_receipts/);
  assert.match(service, /workflow writer DML escaped allowlist/);
  assert.match(service, /"workflow_write_authority": \("SELECT",\)/);
  assert.match(writerFence, /WorkflowWriteAuthority\.objects\.get\(id=1\)/);
  assert.doesNotMatch(writerFence, /WorkflowWriteAuthority\.objects\.select_for_update/);
  assert.doesNotMatch(service, /product_shipping_rates/);
  assert.match(service, /"sales_order_lines": \("SELECT",\)/);
  assert.match(service, /"sales_import_batches": \("SELECT",\)/);
  assert.match(service, /"erp_product_master": \("SELECT",\)/);
  assert.doesNotMatch(service, /"(?:sales_order_lines|sales_import_batches|erp_product_master)": \([^\n]*(?:INSERT|UPDATE|DELETE|TRUNCATE)/);
  assert.match(service, /\^workflow-\[0-9a-f\]\{32\}\$/);
});


test("base runtime deploy, environment isolation and startup chain include workflow", () => {
  for (const required of [
    "tools\\django-workflow-service.ps1",
    "tools\\django-workflow-cutover.ps1",
    "tools\\workflow-d1-authority-install.py",
    "tools\\workflow-d1-snapshot.py",
    "tools\\workflow-launch-r2-retirement-evidence.py",
    "drizzle\\0103_workflow_launch_write_authority.sql",
    "drizzle\\0104_workflow_launch_domain_retirement.sql",
  ]) {
    assert.ok(base.includes(required), `missing controlled runtime file: ${required}`);
  }
  assert.match(base, /TERUISI_DJANGO_WORKFLOW_AUTHORITY_EPOCH/);
  assert.match(base, /TERUISI_DJANGO_WORKFLOW_CUTOVER_ID/);
  assert.match(base, /ProcessRole -eq "workflow_writer"/);
  assert.match(base, /WorkflowStartupEnabledPath/);
  assert.match(base, /Get-PortListeners 8061/);
  assert.match(base, /Get-PortListeners 8062/);
});

test("new-product weekly DingTalk scheduler is inactive and uses the protected local-time gate", () => {
  assert.equal(weeklyWorkflow.id, "NewProductWeeklyDingTalk2026");
  assert.equal(weeklyWorkflow.active, false);
  assert.ok(weeklyWorkflow.nodes.some((node) => node.type === "n8n-nodes-base.scheduleTrigger"));
  const command = weeklyWorkflow.nodes.find((node) => node.type === "n8n-nodes-base.executeCommand")?.parameters?.command ?? "";
  assert.match(command, /django-workflow-service\.ps1/);
  assert.match(command, /-Action RunWeeklyReport/);
  assert.match(service, /"RunWeeklyReport"/);
  assert.match(service, /"ForceWeeklyReport"/);
  assert.match(service, /if \(\$Force\) \{ \$arguments \+= "--force" \}/);
  assert.match(service, /"EnableWeeklyReport"/);
  assert.match(service, /configure_new_product_weekly_report/);
  assert.match(service, /new_product_weekly_report/);
});

test("terminal workflow retirement is stopped, evidence-bound and Django-only", () => {
  assert.match(cutover, /R2RetirementEvidence/);
  assert.match(cutover, /RetirePlan/);
  assert.match(cutover, /RetireApply/);
  assert.match(cutover, /retire_workflow_launch_d1/);
  assert.match(cutover, /workflow-launch-r2-retirement-evidence\.py/);
  assert.match(cutover, /\$CutoverApprovedPlanId = \$ApprovedPlanId/);
  assert.match(cutover, /\$ApprovedPlanId = \$CutoverApprovedPlanId/);
  assert.match(cutover, /Assert-WorkflowStackStopped "终态退役 D1\/R2 新品子域"/);
  assert.match(cutover, /Assert-WorkflowWorkerStopped "终态退役 D1\/R2 新品子域"/);
});


test("cutover operator binds a sealed snapshot, exact migration run and stopped Worker", () => {
  assert.match(cutover, /workflow-launch-d1-snapshot-v1/);
  assert.match(cutover, /migrate_workflow_launch_from_d1/);
  assert.match(cutover, /--approved-run-id/);
  assert.match(cutover, /\^workflow-\[0-9a-f\]\{32\}\$/);
  assert.match(cutover, /Get-PortListeners 3000/);
  assert.match(cutover, /0103_workflow_launch_write_authority\.sql/);
  assert.doesNotMatch(cutover, /0093_workflow|workflow_d1_rehearsal|--verify-run-id/);
});


test("D1 launch authority freezes only launch records and becomes irreversible after activation", () => {
  const triggers = [...authoritySql.matchAll(/CREATE TRIGGER IF NOT EXISTS/g)];
  assert.equal(triggers.length, 9);
  assert.match(authoritySql, /OLD\.owner='legacy' AND NEW\.owner='pending'/);
  assert.match(authoritySql, /OLD\.owner='pending' AND NEW\.owner='postgresql'/);
  assert.doesNotMatch(authoritySql, /OLD\.owner='postgresql' AND NEW\.owner=/);
  assert.match(authoritySql, /NEW\.record_type='launch'/);
  assert.match(authoritySql, /OLD\.record_type='launch'/);
  assert.doesNotMatch(authoritySql, /DELETE FROM workflow_operation_records/);
});


test("full workflow runtime grants only bounded operations-table privileges and requires both authorities", () => {
  for (const table of [
    "workflow_tasks",
    "workflow_task_comments",
    "workflow_task_activity_logs",
    "workflow_task_reminders",
    "workflow_task_templates",
    "workflow_task_entity_links",
    "workflow_task_attachments",
    "workflow_attachment_cleanup_queue",
    "workflow_operation_records",
    "workflow_operation_activities",
  ]) {
    assert.match(service, new RegExp(`"${table}"`), `missing runtime privilege contract for ${table}`);
  }
  assert.match(service, /"workflow_operations_write_authority": \("SELECT",\)/);
  assert.match(service, /WorkflowOperationsWriteAuthority/);
  assert.match(service, /operationsStatus/);
  assert.match(service, /operationsAuthorityEpoch/);
  assert.match(service, /operationsCutoverId/);
  assert.match(service, /operationsMigrationRunId/);
  assert.match(service, /WorkflowOperationsAuthorityEpoch/);
  assert.match(service, /WorkflowOperationsCutoverId/);
  assert.match(writerFence, /WorkflowOperationsWriteAuthority\.objects\.get\(id=1\)/);
  assert.match(writerFence, /authority_scope == "operations"/);
  assert.doesNotMatch(writerFence, /WorkflowOperationsWriteAuthority\.objects\.select_for_update/);
});


test("base runtime deploys the complete workflow-operations migration surface", () => {
  for (const required of [
    "tools\\django-workflow-operations-cutover.ps1",
    "tools\\workflow-operations-d1-authority-install.py",
    "tools\\workflow-operations-d1-snapshot.py",
    "tools\\workflow-operations-production-smoke.ps1",
    "tools\\workflow-operations-consumer-smoke.ts",
    "tools\\workflow-operations-d1-rejection-smoke.py",
    "drizzle\\0105_workflow_operations_write_authority.sql",
    "drizzle\\0106_workflow_operations_domain_retirement.sql",
  ]) {
    assert.ok(base.includes(required), `missing complete-board runtime file: ${required}`);
  }
  assert.match(base, /TERUISI_DJANGO_WORKFLOW_OPERATIONS_AUTHORITY_EPOCH/);
  assert.match(base, /TERUISI_DJANGO_WORKFLOW_OPERATIONS_CUTOVER_ID/);
});


test("workflow operations production smoke creates the exact fresh terminal receipt without positive writes", () => {
  assert.match(operationsProductionSmoke, /workflow-operations-system-test-receipt-v1/);
  assert.match(operationsProductionSmoke, /workflow-operations-production-smoke-details-v1/);
  for (const check of [
    "djangoReader", "djangoWriterNegative", "publicTasks", "publicTaskCollaboration",
    "publicTaskAttachmentsMetadata", "publicTemplates", "publicOperationRecords",
    "scopedOperationRecords", "inventoryWorkItemBridge", "globalSearchConsumer",
    "aiConsumer", "legacyD1Rejected", "attachmentR2Preserved", "otherWorkflowDomainsPreserved",
  ]) {
    assert.match(operationsProductionSmoke, new RegExp(`${check} = "passed"`));
  }
  assert.match(operationsProductionSmoke, /workflowSmokeUnknownField/);
  assert.doesNotMatch(operationsProductionSmoke, /"title"\s*:\s*"workflow.*smoke/i);
  assert.match(operationsProductionSmoke, /workflow-operations-consumer-smoke\.ts/);
  assert.match(operationsProductionSmoke, /workflow-operations-d1-rejection-smoke\.py/);
  assert.match(operationsProductionSmoke, /attachment\.sha256/);
  assert.match(operationsProductionSmoke, /Get-FileHash/);
  assert.match(operationsProductionSmoke, /function Test-FullyQualifiedPath/);
  assert.doesNotMatch(operationsProductionSmoke, /IsPathFullyQualified/);
  assert.match(operationsConsumerSmoke, /operation: "workflow_search"/);
  assert.match(operationsConsumerSmoke, /scopedOperationReturned !== 0/);
  assert.match(operationsD1RejectionSmoke, /workflow_operations_authority_not_legacy/);
  assert.match(operationsD1RejectionSmoke, /connection\.rollback\(\)/);
});

test("workflow operations production smoke path gate works in Windows PowerShell 5.1", (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows PowerShell 5.1 is Windows-only");
    return;
  }
  const result = spawnSync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy", "Bypass",
    "-File", operationsProductionSmokePath,
    "-ReleaseRoot", "C:relative\\release",
  ], { encoding: "utf8", windowsHide: true });
  if (result.error && "code" in result.error && result.error.code === "ENOENT") {
    t.skip("Windows PowerShell 5.1 is unavailable");
    return;
  }
  const diagnostic = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.status, 0);
  assert.match(diagnostic, /Worker release root/);
  assert.doesNotMatch(diagnostic, /IsPathFullyQualified/);
});


test("operations cutover binds a sealed snapshot, exact verified run, stopped services and smoke evidence", () => {
  assert.match(operationsCutover, /workflow-operations-d1-snapshot-v1/);
  assert.match(operationsCutover, /migrate_workflow_operations_from_d1/);
  assert.match(operationsCutover, /workflow_operations_write_authority/);
  assert.match(operationsCutover, /retire_workflow_operations_d1/);
  assert.match(operationsCutover, /\^workflow-ops-\[0-9a-f\]\{32\}\$/);
  assert.match(operationsCutover, /--approved-run-id/);
  assert.match(operationsCutover, /--approved-plan-id/);
  assert.match(operationsCutover, /--smoke-receipt/);
  assert.match(operationsCutover, /0105_workflow_operations_write_authority\.sql/);
  assert.match(operationsCutover, /Assert-WorkflowStackStopped/);
  assert.match(operationsCutover, /Assert-WorkflowWorkerStopped/);
  assert.match(operationsCutover, /Get-PortListeners 3000/);
  assert.match(operationsCutover, /Get-PortListeners 8061/);
  assert.match(operationsCutover, /Get-PortListeners 8062/);
  assert.match(operationsCutover, /Workflow operations cutover must run from the protected runtime app after DeployApp/);
});


test("D1 operations authority fences every legacy table and cannot return after PostgreSQL activation", () => {
  const triggers = [...operationsAuthoritySql.matchAll(/CREATE TRIGGER IF NOT EXISTS/g)];
  assert.equal(triggers.length, 42);
  assert.match(operationsAuthoritySql, /OLD\.owner='legacy' AND NEW\.owner='pending'/);
  assert.match(operationsAuthoritySql, /OLD\.owner='pending' AND NEW\.owner='legacy'/);
  assert.match(operationsAuthoritySql, /OLD\.owner='pending' AND NEW\.owner='postgresql'/);
  assert.doesNotMatch(operationsAuthoritySql, /OLD\.owner='postgresql' AND NEW\.owner=/);
  for (const table of [
    "workflow_tasks",
    "workflow_task_bootstrap",
    "workflow_task_states",
    "workflow_task_comments",
    "workflow_task_activity_logs",
    "workflow_task_reminders",
    "workflow_task_templates",
    "workflow_task_template_states",
    "workflow_task_entity_links",
    "workflow_task_attachments",
    "workflow_attachment_cleanup_queue",
    "workflow_operation_records",
    "workflow_operation_activities",
  ]) {
    assert.match(operationsAuthoritySql, new RegExp("BEFORE INSERT ON `" + table + "`"));
    assert.match(operationsAuthoritySql, new RegExp("BEFORE UPDATE ON `" + table + "`"));
    assert.match(operationsAuthoritySql, new RegExp("BEFORE DELETE ON `" + table + "`"));
  }
});


test("operations migration, authority and retirement form an evidence-bound terminal sequence", () => {
  assert.match(operationsMigration, /source_hash = digest\(source_data\)/);
  assert.match(operationsMigration, /--approved-run-id/);
  assert.match(operationsMigration, /target_snapshot/);
  assert.match(operationsMigration, /transaction\.atomic/);
  assert.match(operationsMigration, /bulk_create/);
  assert.match(operationsAuthority, /source_hash = digest\(source_data\)/);
  assert.match(operationsAuthority, /migration_verify_run_id/);
  assert.match(operationsAuthority, /select_for_update/);
  assert.match(operationsRetirement, /smoke_receipt/);
  assert.match(operationsRetirement, /approved_plan_id/);
  assert.match(operationsRetirement, /workflow-operations-domain-retirement-receipt-v1/);
  assert.equal([...operationsRetirementSql.matchAll(/CREATE VIEW `/g)].length, 14);
  assert.equal([...operationsRetirementSql.matchAll(/INSTEAD OF (?:INSERT|UPDATE|DELETE)/g)].length, 42);
  assert.match(operationsRetirementSql, /workflow_operations_retired_/);
  assert.match(operationsRetirementSql, /workflow_operations_write_authority/);
});


test("inventory work-item idempotency is serialized by exact identity on PostgreSQL", () => {
  assert.match(operationsDomain, /workflow-inventory-work-item:\{entity_id\}/);
  assert.match(operationsDomain, /pg_advisory_xact_lock/);
  assert.match(operationsDomain, /_lock_inventory_work_item_identity\(entity_id\)/);
  assert.match(operationsDomain, /select_for_update\(\)[\s\S]*entity_type="product"/);
});

test("workflow write receipt claims serialize the absent-row race on PostgreSQL", () => {
  assert.match(writerFence, /workflow-write-request:\{request_id\}/);
  assert.match(writerFence, /pg_advisory_xact_lock/);
  assert.match(writerFence, /_lock_request_identity\(request_id\)/);
  assert.match(writerFence, /select_for_update\(\)[\s\S]*request_id=request_id/);
});


test("backup and maintenance evidence include the complete workflow authority and table set", () => {
  for (const source of [backup, maintenance]) {
    assert.match(source, /workflow_operations_write_authority/);
    assert.match(source, /workflow_tasks/);
    assert.match(source, /workflow_task_attachments/);
    assert.match(source, /workflow_operation_records/);
  }
  assert.match(backup, /workflowOperationsWriteAuthority/);
  assert.match(backup, /"authorityEpoch"/);
  assert.match(backup, /"cutoverId"/);
  assert.match(maintenance, /workflowOperationsEpoch/);
  assert.match(maintenance, /workflowOperationsCutoverId/);
});
