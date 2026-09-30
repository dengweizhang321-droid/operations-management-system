/** Independent Q consumes actual signed directory wires from own PostgreSQL. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { resolve, sep } from "node:path";

// Styling is exercised by the independent browser replay; only this DTO guard
// is imported here, with Node's documented hook excluding CSS module loading.
registerHooks({ load(url, context, nextLoad) { return url.endsWith(".css") ? { format: "module", source: "export default {};", shortCircuit: true } : nextLoad(url, context); } });
const { checkCatalog } = await import("../app/netshop/products/ProductsCatalog");

const root = resolve("E:/codex-artifacts/netshop-scheme2-20261001/products/review");
const input = resolve(process.argv[2] ?? "");
assert.ok(process.argv[2] && input.startsWith(root + sep), "Use only Q-owned synthetic signed directory output");
const wire = JSON.parse(await readFile(resolve(input, "wire-catalog-review.json"), "utf8"));
const controls: { name: string; passed: boolean; error?: string }[] = [];
for (const kind of ["full", "page"] as const) {
  const section = wire[kind];
  try {
    checkCatalog(kind === "full" ? section.payload : { ...wire.full.payload, ...section.payload }, new URLSearchParams(section.query), section.revision);
    controls.push({ name: kind, passed: true });
  } catch (error) { controls.push({ name: kind, passed: false, error: error instanceof Error ? error.message : String(error) }); }
}
const results: { name: string; rejected: boolean }[] = [];
function reject(name: string, mutate: (body: typeof wire.full.payload) => void, revision = wire.full.revision) {
  const body = structuredClone(wire.full.payload);
  mutate(body);
  try {
    checkCatalog(body, new URLSearchParams(wire.full.query), revision);
    results.push({ name, rejected: false });
  } catch { results.push({ name, rejected: true }); }
}
reject("missing owning header is invalid", () => {}, null);
reject("snapshot token is not an owning header", () => {}, wire.full.payload.snapshotToken);
reject("changed header cannot retain old full metadata", () => {}, "999:bbbbbbbbbbbb");
reject("opt-in filter metadata cannot be absent", body => { delete body.catalogFilters; });
reject("null shop cannot reach React consumers", body => { body.shops = [null]; });
reject("string mapping flag cannot claim ERP association", body => { body.items[0].salesMatched = "false"; });
reject("string ratio cannot reach number formatting", body => { body.items[0].grossMarginRate = "broken"; });
reject("unsafe currency integer cannot render as valid money", body => { body.items[0].priceCents = Number.MAX_SAFE_INTEGER + 1; });
reject("legacy page flag remains a strict boolean", body => { body.pagination.truncated = "true"; });
reject("page rows cannot exceed declared total", body => { body.pagination.total = 0; });
const output = resolve(root, "products-review-catalog-wire-" + randomUUID());
await mkdir(output);
await writeFile(resolve(output, "result.json"), JSON.stringify({ sourceSha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), syntheticPrivatePostgres: true, input, controls, results }, null, 2), { flag: "wx" });
assert.ok(controls.every(control => control.passed), JSON.stringify({ evidence: output, controls }));
assert.ok(results.every(result => result.rejected), JSON.stringify(results));
process.stdout.write(JSON.stringify({ evidence: output, controls: 2, rejected: results.length }) + "\n");
