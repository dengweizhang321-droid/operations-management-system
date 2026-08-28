import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const migratedRoutes = [
  "app/api/sales/summary/route.ts",
  "app/api/sales/category-analysis/route.ts",
  "app/api/sales/category-analysis/detail/route.ts",
];

test("the three approved sales read routes share the signed, revision-fenced Django gateway", async () => {
  for (const route of migratedRoutes) {
    const source = await readFile(resolve(route), "utf8");
    assert.match(source, /requireAppPrincipal\(/, route);
    assert.match(source, /routeSalesReadRequest\(\{/, route);
    assert.match(source, /principal,/, route);
    assert.match(source, /expectedRevision,/, route);
    assert.match(source, /readCurrentRevision:\s*\(\)\s*=>\s*getSalesOverviewCacheRevision\(db\)/, route);
    assert.match(source, /legacy:\s*async\s*\(\)\s*=>/, route);
  }
});

test("sales writes and finance reads remain outside the Django sales read slice", async () => {
  const legacyOnlyRoutes = [
    "app/api/imports/sales/chunks/route.ts",
    "app/api/finance/analysis/route.ts",
    "app/api/finance/targets/route.ts",
  ];
  for (const route of legacyOnlyRoutes) {
    const source = await readFile(resolve(route), "utf8");
    assert.doesNotMatch(source, /routeSalesReadRequest/, route);
  }
});
