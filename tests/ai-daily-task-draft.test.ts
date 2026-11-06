import assert from "node:assert/strict";
import test from "node:test";
import { dailyDraft } from "../app/ai-daily-task-drafts";

test("the JD daily draft binds exact local revisions, separate sources and no delivery authorization", () => {
  const method = { id: "method", name: "日报", kind: "library_guidance" as const, version: 5, digest: "a".repeat(64) };
  const model = { id: "model", name: "示例", version: 3 };
  const opts = { models: [model], methods: [method], firstScenario: { platform: "京东", shop: "志高商用设备旗舰店" } };
  const draft = dailyDraft(opts, method, model, "21:07", "same-id");
  assert.equal(draft.clientRequestId, "same-id");
  assert.deepEqual([draft.spec.trigger.hour, draft.spec.trigger.minute], [21, 7]);
  assert.deepEqual(draft.spec.skill, { id: "method", kind: "library_guidance", version: 5, digest: method.digest });
  assert.deepEqual(draft.spec.dataDependencies.map(d => d.dataset), ["erp_shop_sales", "inventory_included_warehouses"]);
  assert.deepEqual(draft.spec.deliveryTargets, []);
  assert.equal(draft.spec.shopSelection.shop, "志高商用设备旗舰店");
});
