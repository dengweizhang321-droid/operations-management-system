import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";


const service = readFileSync(new URL("../tools/django-workflow-service.ps1", import.meta.url), "utf8");
const base = readFileSync(new URL("../tools/django-local-service.ps1", import.meta.url), "utf8");
const cutover = readFileSync(new URL("../tools/django-workflow-cutover.ps1", import.meta.url), "utf8");
const authoritySql = readFileSync(
  new URL("../drizzle/0103_workflow_launch_write_authority.sql", import.meta.url),
  "utf8",
);
const writerFence = readFileSync(
  new URL("../backend/workflow/write_requests.py", import.meta.url),
  "utf8",
);
const weeklyWorkflow = JSON.parse(readFileSync(
  new URL("../automation/n8n/new-product-weekly-dingtalk.workflow.json", import.meta.url),
  "utf8",
)) as { active: boolean; nodes: Array<{ type: string; parameters?: { command?: string } }> };


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
  assert.equal(weeklyWorkflow.active, false);
  assert.ok(weeklyWorkflow.nodes.some((node) => node.type === "n8n-nodes-base.scheduleTrigger"));
  const command = weeklyWorkflow.nodes.find((node) => node.type === "n8n-nodes-base.executeCommand")?.parameters?.command ?? "";
  assert.match(command, /django-workflow-service\.ps1/);
  assert.match(command, /-Action RunWeeklyReport/);
  assert.match(service, /"RunWeeklyReport"/);
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
