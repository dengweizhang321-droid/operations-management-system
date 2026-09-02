import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("new-product launch production paths are Django-only and expose no D1/R2 fallback", async () => {
  const [service, collection, operations, detail, activity, view, pageData, search, retirement, evidence] = await Promise.all([
    readFile(new URL("../lib/django/workflow-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/workflow/launch-projects/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/workflow/operations-records/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/workflow/operations-records/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/workflow/operations-records/[id]/activity/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/new-product-launch-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/ai/page-data-tools.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/search/global-search.ts", import.meta.url), "utf8"),
    readFile(new URL("../backend/workflow/management/commands/retire_workflow_launch_d1.py", import.meta.url), "utf8"),
    readFile(new URL("../tools/workflow-launch-r2-retirement-evidence.py", import.meta.url), "utf8"),
  ]);
  assert.match(service, /WorkflowBackendMode = "django"/);
  assert.doesNotMatch(service, /WorkflowBackendMode = "legacy" \| "django"|\?\? "legacy"/);
  assert.doesNotMatch(collection, /structured: false|backendMode: "legacy"/);
  assert.doesNotMatch(view, /legacyFallback|OperationsRecordWorkspace/);
  for (const source of [operations, detail, activity, pageData, search]) {
    assert.doesNotMatch(source, /workflowMode === "legacy"|backendMode !== "django"/);
  }
  assert.doesNotMatch(pageData, /structured\s*!==\s*true|backendMode.*legacy|旧新品记录仍可/);
  assert.doesNotMatch(search, /includeLegacyLaunch/);
  assert.match(search, /AND o\.record_type <> 'launch'/);
  for (const source of [service, collection, view]) {
    assert.doesNotMatch(source, /R2Bucket|SALES_IMPORT_FILES|workflow-attachments|getD1Database/);
  }
  assert.match(operations, /body as \{ type\?: unknown \}\)\.type === "launch"/);
  assert.match(retirement, /legacyD1Rejected/);
  assert.match(retirement, /legacyR2Rejected/);
  assert.match(retirement, /workflow_launch_retired_%_guard/);
  assert.match(evidence, /workflow launch R2 namespace is not empty/);
  for (const pattern of ["workflow-launch/%", "workflow-launch-%", "new-product/%", "new-product-%"]) {
    assert.match(evidence, new RegExp(pattern.replace(/[\/%\-]/g, "\\$&")));
  }
});
