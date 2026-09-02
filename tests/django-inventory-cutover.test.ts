import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("inventory cutover is installed, live-D1-bound, and retires its R2 namespace", async () => {
  const [controller, base, retirement, r2Evidence] = await Promise.all([
    readFile(new URL("../tools/django-inventory-cutover.ps1", import.meta.url), "utf8"),
    readFile(new URL("../tools/django-local-service.ps1", import.meta.url), "utf8"),
    readFile(
      new URL("../backend/inventory/management/commands/retire_inventory_d1.py", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../tools/inventory-r2-retirement-evidence.py", import.meta.url), "utf8"),
  ]);
  assert.match(controller, /Resolve-LiveInventoryD1/);
  assert.match(controller, /Assert-InventoryWorkerStopped/);
  assert.match(controller, /migrate_inventory_from_d1/);
  assert.match(controller, /inventory_write_authority/);
  assert.match(controller, /retire_inventory_d1/);
  assert.match(controller, /inventory-r2-retirement-evidence\.py/);
  assert.match(base, /tools\\django-inventory-cutover\.ps1/);
  assert.match(base, /tools\\inventory-d1-authority-install\.py/);
  assert.match(base, /tools\\inventory-r2-retirement-evidence\.py/);
  assert.match(retirement, /legacyR2Rejected/);
  assert.match(retirement, /objectCount.*!= 0/s);
  assert.match(r2Evidence, /PREFIX = "inventory-upload\/"/);
  assert.match(r2Evidence, /inventory R2 namespace is not empty/);
});
