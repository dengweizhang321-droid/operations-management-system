/** Replays genuine signed-PG legacy catalogue DTOs through the current UI adapter.
 * The source role is recorded; a reviewer's PG receipt is never relabelled lead PG. */
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { build } from "esbuild";
import type { checkCatalog as CatalogDecoder } from "../app/netshop/products/ProductsCatalog";

if (!process.argv[2]) throw new Error("Pass the real signed-PG catalog wire directory");
const source = resolve(process.argv[2]);
const runtime = resolve(".runtime", `products-catalog-wire-${randomUUID()}`);
await mkdir(runtime);
const compiled = await build({ entryPoints: ["app/netshop/products/ProductsCatalog.tsx"], bundle: true, write: false, platform: "node", format: "cjs", plugins: [{ name: "catalog-css-inert-for-decoder-replay", setup(builder) {
  builder.onResolve({ filter: /\.css$/ }, () => ({ path: "inert-style", namespace: "style" }));
  builder.onLoad({ filter: /.*/, namespace: "style" }, () => ({ contents: "export default {};", loader: "js" }));
} }] });
const modulePath = resolve(runtime, "decoder.cjs");
await writeFile(modulePath, compiled.outputFiles[0].contents, { flag: "wx" });
const { checkCatalog } = createRequire(import.meta.url)(modulePath) as { checkCatalog: typeof CatalogDecoder };
const wire = JSON.parse(await readFile(resolve(source, "wire-catalog-review.json"), "utf8"));
const results = [];
const full = wire.full;
const fullData = checkCatalog(full.payload, new URLSearchParams(full.query), full.revision);
for (const [name, entry] of Object.entries(wire)) {
  if (name !== "full" && name !== "page") continue;
  const item = entry as { payload: Record<string, unknown>; query: string; revision: string };
  const input = name === "full" ? item.payload : { ...fullData, ...item.payload };
  const data = checkCatalog(input, new URLSearchParams(item.query), item.revision);
  assert.equal(data.pagination.total, 6);
  assert.equal(data.items.length, name === "full" ? 5 : 1);
  assert.equal(data.batch?.completedAt, null);
  assert.throws(() => checkCatalog(input, new URLSearchParams(item.query), null));
  assert.throws(() => checkCatalog(input, new URLSearchParams(item.query), "99:ffffffffffff"));
  results.push({ name, decoded: true, total: data.pagination.total, returned: data.items.length, legacyTruncated: data.pagination.truncated, nullableCompletedAt: true, malformedHeadersRejected: 2 });
}
const evidence = resolve("E:/codex-artifacts/netshop-scheme2-20261001/products/lead", `catalog-wire-${randomUUID()}`);
await mkdir(evidence);
await writeFile(resolve(evidence, "result.json"), JSON.stringify({ source, sourceRole: "independent-review-private-PG", executionRole: "lead-decoder-replay", results }, null, 2), { flag: "wx" });
console.log(JSON.stringify({ evidence, results }, null, 2));
