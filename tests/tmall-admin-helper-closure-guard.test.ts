import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const entry = "tools/tmall-sycm-cookie-pipeline.ts";
const operatorOnly = [
  "tools/tmall-admin-helper-probe.ts",
  "tools/tmall-pagewise-audit-admin.ts",
  "tools/tmall-product-master-admin.ts",
];

async function exists(file: string) {
  return stat(file).then(info => info.isFile()).catch(() => false);
}
async function resolveRelative(from: string, spec: string) {
  const base = path.resolve(path.dirname(from), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.mjs`, `${base}.js`, path.join(base, "index.ts"), path.join(base, "index.mjs")]) {
    if (await exists(candidate)) return candidate;
  }
  return null;
}
async function closure() {
  const seen = new Set<string>();
  const queue = [path.resolve(root, entry)];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = await readFile(file, "utf8");
    const specs = [...text.matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)].map(match => match[1]);
    for (const spec of specs) {
      const resolved = await resolveRelative(file, spec);
      if (resolved) queue.push(resolved);
    }
  }
  return [...seen].map(file => path.relative(root, file).replaceAll("\\", "/")).sort();
}

test("helper 闭包包含被改的两个 tools 文件，但不含 operator CLI 与探测文件", async () => {
  const files = await closure();
  assert.ok(files.includes("tools/tmall-product-master-export.ts"), "闭包应包含 tmall-product-master-export.ts");
  assert.ok(files.includes("tools/tmall-pagewise-product-master-export.ts"), "闭包应包含 tmall-pagewise-product-master-export.ts");
  for (const file of operatorOnly) assert.equal(files.includes(file), false, `${file} 不得进入 helper 闭包`);
});

test("operator-only 新文件不含 import.meta，且 tools/ 内除自己外无人引用", async () => {
  for (const file of operatorOnly) {
    assert.equal(/import\s*\.\s*meta/.test(await readFile(path.join(root, file), "utf8")), false, `${file} 含 import.meta`);
  }
  const { readdir } = await import("node:fs/promises");
  const offenders: string[] = [];
  for (const dir of ["tools", "lib"]) {
    const walk = async (current: string): Promise<void> => {
      for (const entryInfo of await readdir(current, { withFileTypes: true })) {
        const full = path.join(current, entryInfo.name);
        if (entryInfo.isDirectory()) { await walk(full); continue; }
        if (!/\.(ts|tsx|mjs|js|cjs)$/.test(entryInfo.name)) continue;
        const rel = path.relative(root, full).replaceAll("\\", "/");
        if (operatorOnly.includes(rel)) continue;
        if (/tmall-admin-helper-probe|tmall-pagewise-audit-admin|tmall-product-master-admin/.test(await readFile(full, "utf8"))) offenders.push(rel);
      }
    };
    await walk(path.join(root, dir));
  }
  assert.deepEqual(offenders, []);
});
