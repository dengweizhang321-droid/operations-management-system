/** Independent Q rejects malformed successful wire envelopes using own PG output. */
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { decodeProductDetail, decodeProductInsights, ProductResponseError } from "../app/netshop/products/contract";
import { NetshopQueryError } from "../lib/netshop/query-contract";

const reviewRoot = resolve("E:/codex-artifacts/netshop-scheme2-20261001/products/review");
const source = resolve(process.argv[2] ?? "");
if (!process.argv[2] || !source.startsWith(reviewRoot + sep)) throw new Error("Use only Q-owned synthetic PostgreSQL wire output");
const wire = JSON.parse(await readFile(resolve(source, "wire-detail.json"), "utf8"));
const list = JSON.parse(await readFile(resolve(source, "wire-list.json"), "utf8"));
const query = new URLSearchParams(wire.query);
decodeProductDetail(wire.payload, query, wire.revision);
decodeProductInsights(list.payload, new URLSearchParams(list.query), list.revision);
const results: { name: string; rejected: boolean; controlledError?: boolean }[] = [];
function reject(name: string, mutation: (payload: typeof wire.payload) => void) {
  const payload = structuredClone(wire.payload);
  mutation(payload);
  try {
    decodeProductDetail(payload, query, wire.revision);
    results.push({ name, rejected: false });
  } catch (error) {
    results.push({ name, rejected: true, controlledError: error instanceof NetshopQueryError || error instanceof ProductResponseError });
  }
}
function rejectList(name: string, mutation: (payload: typeof list.payload) => void) {
  const payload = structuredClone(list.payload);
  mutation(payload);
  try {
    decodeProductInsights(payload, new URLSearchParams(list.query), list.revision);
    results.push({ name, rejected: false });
  } catch (error) {
    results.push({ name, rejected: true, controlledError: error instanceof NetshopQueryError || error instanceof ProductResponseError });
  }
}
reject("daily promotion money cannot become COUNT", p => { p.sections.daily.data.items[0].metrics.spend.unit = "COUNT"; });
reject("daily ROAS cannot become CNY_CENT", p => { p.sections.daily.data.items[0].metrics.roas = { ...p.sections.daily.data.items[0].metrics.spend, unit: "CNY_CENT", value: 200 }; });
reject("daily owning vector cannot be absent", p => { p.sections.daily.data.sourceRevisions = []; });
reject("daily owning vector cannot differ from context", p => { p.sections.daily.data.sourceRevisions[0].revision = "999:bbbbbbbbbbbb"; });
reject("embedded catalogue permission loss must fail the whole read", p => { p.sections.catalog = { state: "error", data: null, code: "access_denied", message: "Synthetic permission loss" }; });
reject("embedded catalogue revision loss must fail the whole read", p => { p.sections.catalog = { state: "error", data: null, code: "insights_revision_changed", message: "Synthetic revision loss" }; });
reject("catalogue evidence enum cannot be a JSON array", p => { p.sections.catalog.data.categoryEvidence.status = ["label_only"]; });
reject("comparison status cannot be a JSON array", p => { p.sections.performance.comparisons.payment.previous.status = ["available"]; });
reject("detail failed baseline cannot retain available row comparisons", p => { p.sections.baselineReads.previous = { state: "error", data: null, code: "service_unavailable", message: "Synthetic baseline failure" }; });
rejectList("list failed baseline cannot retain available row comparisons", p => {
  p.sections.baselineReads.previous = { state: "error", data: null, code: "service_unavailable", message: "Synthetic baseline failure" };
  for (const pair of Object.values(p.sections.comparisons) as { previous: { method: string; value: number | null; status: string; reasonCode: string | null } }[]) {
    pair.previous = { method: pair.previous.method, value: null, status: "unavailable", reasonCode: "incomplete_baseline" };
  }
});
const destination = resolve(reviewRoot, "products-review-wire-" + randomUUID());
await mkdir(destination, { recursive: false });
const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
await writeFile(resolve(destination, "result.json"), JSON.stringify({ sourceSha, source, validControls: 2, results }, null, 2), { flag: "wx" });
console.log(JSON.stringify({ evidence: destination, sourceSha, validControls: 2, results }, null, 2));
assert.ok(results.every(result => result.rejected && result.controlledError), "Malformed successful product DTOs must fail through the controlled contract protocol");
