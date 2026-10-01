import test from "node:test";
import assert from "node:assert/strict";
import { decodeStorePanorama, type PanoramaWorkflowData } from "../app/netshop/panorama/contract";
import { panoramaFixture, panoramaFixtureQuery } from "./netshop-panorama-fixture";

function fixture() {
  const value = panoramaFixture(), scope = { platform: "京东" as const, shopName: "合成店A", startDate: "2026-09-01", endDate: "2026-09-01" };
  const ref = { domain: "workflow" as const, kind: "owning_revision", scopeKey: JSON.stringify([scope.platform, scope.shopName, scope.startDate, scope.endDate, 1, 20]), revision: "3:bbbbbbbbbbbb" };
  const data: PanoramaWorkflowData = { schemaVersion: "netshop-panorama-workflow-v1", scope, sourceRevisions: [ref], items: [{ id: "test-operation-1", occurredAt: "2026-09-01T08:00:00.000Z", title: "隔离测试：检查记录", status: "completed", eventType: "inspection" }], pagination: { page: 1, pageSize: 20, total: 3, returned: 1, hasMore: true, truncated: true }, limitations: ["仅协议夹具，真实owning HTTP/数据库另验；不是n8n导入批次"] };
  value.sources.workflow = { state: "ready", data }; value.joinedSourceRevisions = [...value.joinedSourceRevisions, ref]; value.sections.targets.state = "partial"; value.sections.dataQuality.state = "partial";
  const cap = value.sections.targets.capabilities.find(c => c.id === "events")!; cap.status = "available"; cap.reasonCode = null;
  return value;
}
test("operation events carry an independent workflow revision and honest paging, without netshop scalar equality", () => {
  const value = decodeStorePanorama(fixture(), panoramaFixtureQuery(), "1:aaaaaaaaaaaa");
  assert.equal(value.sources.workflow.state, "ready");
  if (value.sources.workflow.state === "ready") { assert.equal(value.sources.workflow.data.pagination.truncated, true); assert.equal(value.sources.workflow.data.pagination.total, 3); }
});
test("cross-shop, wrong period, duplicate ID, bad timestamp and missing workflow revision are rejected", () => {
  for (const kind of ["shop", "period", "date", "duplicate", "revision"] as const) {
    const value = fixture(); if (value.sources.workflow.state !== "ready") throw new Error("fixture"); const data = value.sources.workflow.data;
    if (kind === "shop") data.scope.shopName = "别店";
    if (kind === "period") data.scope.startDate = "2026-08-31";
    if (kind === "date") data.items[0].occurredAt = "2026-09-01T16:00:00.000Z"; // Shanghai endExclusive, excluded.
    if (kind === "duplicate") { data.items.push({ ...data.items[0] }); data.pagination.returned = 2; }
    if (kind === "revision") value.joinedSourceRevisions = value.context.sourceRevisions;
    assert.throws(() => decodeStorePanorama(value, panoramaFixtureQuery(), "1:aaaaaaaaaaaa"));
  }
});
test("inspection/review events cannot prove a linked import batch or n8n execution", () => {
  const value = fixture(), cap = value.sections.dataQuality.capabilities.find(c => c.id === "import_records")!;
  cap.status = "available"; cap.reasonCode = null;
  assert.throws(() => decodeStorePanorama(value, panoramaFixtureQuery(), "1:aaaaaaaaaaaa"));
});
