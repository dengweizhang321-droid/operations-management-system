import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

// The helper bundle is built from tools/tmall-sycm-cookie-pipeline.ts (see tools/build-worker-helper.mjs).
// Operator-only CLIs must stay outside that import closure, otherwise they ship in the helper and
// import.meta / child_process use there breaks the bundle.
const root = path.resolve(import.meta.dirname, "..");
const entry = path.join(root, "tools", "tmall-sycm-cookie-pipeline.ts");
const forbidden = [
  "tools/jd-market-ranking-admin.ts",
  "tools/jd-market-ranking-admin-core.ts",
  "tools/retry-reservation-archive.ts",
  "tools/retry-reservation-archive-core.ts",
].map((file) => path.join(root, file));

function resolveSpecifier(from: string, specifier: string) {
  const base = specifier.startsWith("@/") ? path.join(root, specifier.slice(2)) : path.resolve(path.dirname(from), specifier);
  const candidates = [base, ...[".ts", ".tsx", ".mts", ".mjs", ".js"].map((ext) => base + ext), ...["index.ts", "index.js"].map((name) => path.join(base, name))];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null;
}

function closure(start: string) {
  const seen = new Set<string>();
  const queue = [start];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (!/\.(ts|tsx|mts|mjs|js)$/.test(file)) continue;
    const text = readFileSync(file, "utf8");
    const specifiers = [...text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+|require\(\s*)["']((?:\.{1,2}\/|@\/)[^"']+)["']/g)].map((match) => match[1]!);
    for (const specifier of specifiers) {
      const resolved = resolveSpecifier(file, specifier);
      if (resolved) queue.push(resolved);
    }
  }
  return seen;
}

test("operator CLIs for JD market abandon and retry reservation archive are outside the helper import closure", () => {
  for (const file of forbidden) assert.equal(existsSync(file), true, `${file} exists`);
  const files = closure(entry);
  assert.ok(files.size > 20, "closure walker found the helper graph");
  for (const file of forbidden) assert.equal(files.has(file), false, `${path.relative(root, file)} must not be imported by the helper closure`);
});

test("the reservation module (in the helper closure) has no import.meta", () => {
  const text = readFileSync(path.join(root, "lib", "jackyun", "retry-dispatch-reservation.ts"), "utf8");
  assert.equal(text.includes("import.meta"), false);
});
