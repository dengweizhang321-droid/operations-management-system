import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

test("finance cutover keeps the existing UI and public paths while defaulting to legacy", async () => {
  const [page, salesModule, importModule, analysis, targets, imports, service] = await Promise.all([
    readFile(path.join(root, "app", "page.tsx"), "utf8"),
    readFile(path.join(root, "app", "sales-module-view.tsx"), "utf8"),
    readFile(path.join(root, "app", "import-module-view.tsx"), "utf8"),
    readFile(path.join(root, "app", "api", "finance", "analysis", "route.ts"), "utf8"),
    readFile(path.join(root, "app", "api", "finance", "targets", "route.ts"), "utf8"),
    readFile(path.join(root, "app", "api", "imports", "finance", "route.ts"), "utf8"),
    readFile(path.join(root, "lib", "django", "finance-service.ts"), "utf8"),
  ]);
  assert.match(page, /createReloadableLazy\("sales", \(\) => import\("\.\/sales-module-view"\)\)/);
  assert.match(salesModule, /\/api\/finance\/analysis/);
  assert.match(salesModule, /\/api\/finance\/targets/);
  assert.match(importModule, /\/api\/imports\/finance/);
  assert.doesNotMatch(`${page}\n${salesModule}\n${importModule}`, /TERUISI_DJANGO_FINANCE_MODE|finance-normalized-v1/);
  for (const route of [analysis, targets, imports]) {
    assert.match(route, /getFinanceBackendMode/);
    assert.match(route, /mode === "django"/);
  }
  assert.match(service, /\?\? "legacy"/);
  assert.match(service, /"legacy" \| "shadow" \| "django"/);
  assert.doesNotMatch(service, /catch[\s\S]{0,120}return\s+["']legacy["']/i);
  assert.match(imports, /Shadow mode deliberately keeps D1 as the sole writer/);
});

test("Django mode branches before finance D1 access and shadow writes never call Django", async () => {
  const [analysis, targets, imports] = await Promise.all([
    readFile(path.join(root, "app", "api", "finance", "analysis", "route.ts"), "utf8"),
    readFile(path.join(root, "app", "api", "finance", "targets", "route.ts"), "utf8"),
    readFile(path.join(root, "app", "api", "imports", "finance", "route.ts"), "utf8"),
  ]);
  for (const source of [analysis, targets, imports]) {
    const djangoBranch = source.indexOf('if (mode === "django")');
    const databaseAccess = source.indexOf("getFinanceDatabase()", djangoBranch);
    assert.ok(djangoBranch >= 0 && databaseAccess > djangoBranch);
  }
  const importPost = imports.slice(imports.indexOf("export async function POST"));
  assert.equal((importPost.match(/createDjangoFinanceService\(\)/g) ?? []).length, 1);
  const targetPost = targets.slice(targets.indexOf("export async function POST"), targets.indexOf("export async function DELETE"));
  assert.equal((targetPost.match(/createDjangoFinanceService\(\)/g) ?? []).length, 1);
});
