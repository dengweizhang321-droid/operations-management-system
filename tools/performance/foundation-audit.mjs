/** Reproducible source/production-build inventory, no runtime/service operations. */
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const baseline = "bab42d8ce836b4ee9acd82e80de085ff71f9f494";
const gitBytes = path => execFileSync("git", ["show", `${baseline}:${path}`], { maxBuffer: 8 * 1024 * 1024 });
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const domains = ["app/sales-module-view.tsx", "app/inventory-module-view.tsx", "app/product-module-view.tsx", "app/market-view.tsx", "lib/auth/authorization.ts", "backend/teruisi_backend/settings.py"];
const unchanged = [];
for (const path of domains) {
  const bytes = await readFile(path), before = gitBytes(path);
  if (!bytes.equals(before)) throw new Error(`unexpected domain/auth/settings change: ${path}`);
  unchanged.push({ path, bytes: bytes.length, sha256: sha(bytes), baselineEqual: true });
}
const manifest = JSON.parse(await readFile("dist/client/.vite/manifest.json", "utf8"));
const assets = [];
for (const [key, entry] of Object.entries(manifest)) {
  if (/page\.tsx|framework|xlsx|module-view|market-view|api-client|shared/i.test(key)) {
    const bytes = await readFile("dist/client/" + entry.file);
    assets.push({ key, file: entry.file, bytes: bytes.length, gzipBytes: gzipSync(bytes).length, isEntry: !!entry.isEntry, isDynamicEntry: !!entry.isDynamicEntry, imports: entry.imports ?? [], dynamicImports: entry.dynamicImports ?? [] });
  }
}
// Exactly the legacy client and dependencies, equal minifier/configuration.
const apiBefore = gitBytes("lib/http/api-client.ts").toString("utf8");
const apiAfter = await readFile("lib/http/api-client.ts", "utf8");
const clientBundles = [];
for (const [name, source] of [["baseline", apiBefore], ["candidate", apiAfter]]) {
  const result = await build({ stdin: { contents: source + "\nexport default requestJson;", sourcefile: "api-client.ts", resolveDir: process.cwd() + "/lib/http", loader: "ts" }, bundle: true, write: false, format: "esm", platform: "browser", minify: true, treeShaking: true, tsconfig: "tsconfig.json" });
  const bytes = result.outputFiles[0].contents;
  clientBundles.push({ name, bytes: bytes.length, gzipBytes: gzipSync(bytes).length });
}
const pageStaticKeys = new Set();
function visitStatic(key) { if (pageStaticKeys.has(key)) return; pageStaticKeys.add(key); for (const dependency of manifest[key]?.imports ?? []) visitStatic(dependency); }
visitStatic("app/page.tsx");
const typeLog = await readFile("docs/performance/foundation/types-final.log", "utf8");
const typeErrorFiles = [...new Set([...typeLog.matchAll(/^([^\r\n(]+)\(\d+,\d+\): error /gm)].map(match => match[1]))];
const typeErrors = [];
for (const path of typeErrorFiles) {
  const current = await readFile(path), before = gitBytes(path);
  typeErrors.push({ path, baselineEqual: current.equals(before), sha256: sha(current) });
}
await writeFile("docs/performance/foundation/audit.json", JSON.stringify({ schema: "foundation-source-build-v1", baseline, unchanged, assets, clientBundles,
  pageStaticKeys: [...pageStaticKeys], typeErrors: { count: [...typeLog.matchAll(/: error TS\d+/g)].length, files: typeErrors },
  limitations: "Local production-mode build inventory only, not release candidate preparation; standalone client comparison exports all client public APIs, so added optional capability is included. Type error file equality is not a baseline tsc diagnostic replay. No before/after production asset comparison, bundle-wide reduction, runtime bottleneck attribution or task contention claim.",
}, null, 2) + "\n");
console.log("docs/performance/foundation/audit.json");
