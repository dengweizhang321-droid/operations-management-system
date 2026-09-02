import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const productionEntryPoints = [
  "app/api/inventory/overview/route.ts",
  "app/api/inventory/age-analysis/route.ts",
  "app/api/inventory/inbound-monitor/route.ts",
  "app/api/inventory/replenishment/route.ts",
  "app/api/inventory/work-items/route.ts",
  "app/api/imports/inventory/route.ts",
  "app/api/imports/inventory/chunks/route.ts",
  "app/api/settings/route.ts",
  "lib/products/inventory-projection-sync.ts",
  "lib/inventory/system-cost-reference.ts",
  "lib/ai/operations-tools.ts",
  "lib/ai/page-data-tools.ts",
  "lib/search/global-search.ts",
] as const;

const retiredImports = /@\/lib\/inventory\/(?:overview|age-analysis|inbound-monitor|database|import-service|chunked-upload)/;

async function source(path: string) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("reachable inventory entry points use Django and cannot fall back to D1", async () => {
  const entries = await Promise.all(productionEntryPoints.map(async (path) => ({
    path,
    text: await source(path),
  })));
  for (const entry of entries) {
    assert.doesNotMatch(entry.text, retiredImports, `${entry.path} still reaches a retired D1 inventory module`);
  }

  const djangoInventoryEndpoints = productionEntryPoints.slice(0, 8).filter(
    (path) => path !== "app/api/inventory/work-items/route.ts",
  );
  for (const path of djangoInventoryEndpoints) {
    const entry = entries.find((candidate) => candidate.path === path)!;
    assert.match(entry.text, /django|Django/, `${path} is not visibly bound to the Django inventory path`);
  }
  assert.match(
    await source("lib/inventory/work-items.ts"),
    /createDjangoInventoryConsumerReader/,
    "inventory work items must validate their Django inventory source before writing the separate operations domain",
  );
  assert.match(await source("lib/products/inventory-projection-sync.ts"), /inventory-consumer-reader/);
  assert.match(await source("lib/inventory/system-cost-reference.ts"), /inventory-consumer-reader/);
  assert.match(await source("lib/search/global-search.ts"), /createDjangoInventoryConsumerReader/);
});

test("shared ERP endpoints route inventory_age to Django while keeping other ERP sources isolated", async () => {
  const direct = await source("app/api/imports/erp/route.ts");
  const chunks = await source("app/api/imports/erp/chunks/route.ts");
  assert.match(direct, /source === "inventory_age"[\s\S]*?importInventoryAgeToDjango/);
  assert.match(direct, /source === "inventory_age"[\s\S]*?INVENTORY_IMPORTS_PATH/);
  assert.match(direct, /listErpReferenceBatches\(db, "products", \{ page: 1, pageSize: combinedLimit \}\)/);
  assert.match(direct, /listErpReferenceBatches\(db, "combos", \{ page: 1, pageSize: combinedLimit \}\)/);
  assert.match(direct, /combinedLimit > 100/);
  assert.match(chunks, /body\.source === "inventory_age"[\s\S]*?beginDjangoInventoryUpload/);
  assert.match(chunks, /body\.source === "inventory_age"[\s\S]*?importInventoryAgeToDjango/);
});
