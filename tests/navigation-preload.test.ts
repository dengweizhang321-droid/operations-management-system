import assert from "node:assert/strict";
import test from "node:test";
import { createNavigationPreloader } from "../app/shell/navigation-preload";

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
test("navigation intent downloads only allowed code, joins repeated intent and bounds pending work", async () => {
  const calls: string[] = [];
  const releases = new Map<string, () => void>();
  const loaders = Object.fromEntries(["sales", "inventory", "product", "market"].map(key => [key, () => {
    calls.push(key);
    return new Promise<void>(resolve => releases.set(key, resolve));
  }]));
  const preload = createNavigationPreloader(loaders);
  await tick();
  assert.deepEqual(calls, []);
  preload("unknown"); preload("toString"); preload("sales"); preload("sales"); preload("inventory"); preload("product");
  await tick();
  assert.deepEqual(calls, ["sales", "inventory"]);
  releases.get("sales")!(); await tick();
  preload("sales"); preload("product"); await tick();
  assert.deepEqual(calls, ["sales", "inventory", "product"]);
  releases.get("inventory")!(); releases.get("product")!(); await tick();
  preload("market"); await tick(); releases.get("market")!(); await tick();
  assert.deepEqual(calls, ["sales", "inventory", "product", "market"]);
});

test("failed code preloads release capacity without poisoning navigation or causing a retry storm", async () => {
  let failures = 0; let inventory = 0;
  const preload = createNavigationPreloader({ sales: async () => { failures++; throw Error("chunk unavailable"); }, inventory: async () => { inventory++; } }, 1);
  preload("sales"); await tick(); preload("sales"); preload("inventory"); await tick();
  assert.equal(failures, 1); assert.equal(inventory, 1);
});
