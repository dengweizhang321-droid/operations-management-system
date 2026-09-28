import assert from "node:assert/strict";
import test from "node:test";
import { selectReleaseRetention, exactPayloadPath } from "../tools/release-payload-retention.mjs";

const release = (day) => ({ releaseId: `202609${String(day).padStart(2, "0")}T000000Z-${"a".repeat(16)}`, createdAt: `2026-09-${String(day).padStart(2, "0")}T00:00:00Z` });
test("seven-day boundary preserves current and two rollback predecessors", () => {
  const items = [1, 2, 3, 20, 21, 25, 28].map(release);
  const result = selectReleaseRetention(items, "2026-09-28T00:00:00Z");
  assert.deepEqual(result.retained.map(x => x.releaseId), [21, 25, 28].map(x => release(x).releaseId));
  assert.equal(result.candidates.length, 4);
  assert.equal(selectReleaseRetention(items.slice(0, 3), "2026-09-28T00:00:00Z").candidates.length, 0);
});
test("explicit protected release occupies no deletion candidate", () => {
  const items = [1, 2, 3, 4, 5].map(release);
  assert.deepEqual(selectReleaseRetention(items, "2026-09-28T00:00:00Z", [items[0].releaseId]).candidates, [items[1]]);
});
test("future, duplicate, missing protection, invalid path and invalid clocks fail closed", () => {
  assert.throws(() => selectReleaseRetention([release(28)], "2026-09-27T00:00:00Z"));
  assert.throws(() => selectReleaseRetention([release(1), release(1)], "2026-09-28T00:00:00Z"));
  assert.throws(() => selectReleaseRetention([release(1)], "invalid"));
  assert.throws(() => selectReleaseRetention([release(1)], "2026-09-28T00:00:00Z", [release(2).releaseId]));
  assert.throws(() => exactPayloadPath("D:/test", "../production", "dist"));
  assert.throws(() => exactPayloadPath("D:/test", release(1).releaseId, "tools"));
  assert.match(exactPayloadPath("D:/test", release(1).releaseId, "dist"), /dist$/);
});
