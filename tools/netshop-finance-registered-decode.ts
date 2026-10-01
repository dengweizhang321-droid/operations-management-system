/** Decode external, immutable captures from this author's actual signed private-PG HTTP tests. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeFinanceNetshop } from "../lib/netshop/finance-netshop-contract";

const root = process.argv[2];
if (!root) throw new Error("Explicit private registered HTTP capture directory required");
const files = ["registered-viewer.json", "registered-analyst.json", "registered-operator.json",
  "registered-admin.json", "registered-python-rpc.json"];
for (const file of files) {
  const capture = JSON.parse(readFileSync(join(root, file), "utf8"));
  assert.equal(capture.syntheticPrivateOnly, true);
  const data = decodeFinanceNetshop(capture.response.data, capture.request, capture.owningRevision);
  assert.equal(data.monthly.currentMetricStates.netSalesCents.value, data.monthly.data!.current.netSalesCents);
  for (const mutate of [
    (body: typeof capture.response.data) => { body.monthly.currentMetricStates.netSalesCents.value = 999; },
    (body: typeof capture.response.data) => { body.monthly.comparisonMetricStates = null; },
    (body: typeof capture.response.data) => { body.monthly.data.shops.push({ ...body.monthly.data.shops[0], key: '["天猫","FOREIGN"]', groupName: "天猫", name: "FOREIGN" }); },
    (body: typeof capture.response.data) => { delete body.monthly.data.timeline; },
    (body: typeof capture.response.data) => { body.monthly.monthEvidence[0].status = ["completed"]; },
  ]) {
    const body = structuredClone(capture.response.data); mutate(body);
    assert.throws(() => decodeFinanceNetshop(body, capture.request, capture.owningRevision));
  }
}
process.stdout.write(JSON.stringify({ actualSignedRegisteredHttpCaptures: files.length,
  negativeMutationsRejected: files.length * 5, skipped: 0, syntheticPrivateOnly: true }) + "\n");
