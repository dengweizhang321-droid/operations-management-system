import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { JackyunBrowserStateMachine } from "../lib/jackyun/browser-state-machine";
import { jackyunModuleOrder } from "../lib/jackyun/post-download";

test("daily module order puts sales fourth and combos last", () => {
  assert.deepEqual(jackyunModuleOrder, ["products", "inventory", "inventory_age", "sales", "combos"]);
});

test("browser state machine rejects skipped and out-of-order module states", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jackyun-state-test-"));
  try {
    const machine = await JackyunBrowserStateMachine.create({
      statePath: path.join(directory, "state.json"),
      runId: "state-test",
      policyVersion: "test",
    });
    await assert.rejects(machine.transition("inventory", "ENTER_MODULE", {}), /当前模块是 products/);
    await machine.transition("products", "ENTER_MODULE", {});
    await assert.rejects(machine.transition("products", "EXPORT_ONCE", {}), /非法状态转换/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("combo export supports one explicit confirmation state before waiting for download", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jackyun-combo-confirm-state-test-"));
  try {
    const machine = await JackyunBrowserStateMachine.create({
      statePath: path.join(directory, "state.json"),
      runId: "combo-confirm-state-test",
      policyVersion: "test",
    });
    const snapshot = machine.snapshot();
    snapshot.currentModule = "combos";
    snapshot.currentState = "EXPORT_ONCE";
    await rm(path.join(directory, "state.json"), { force: true });
    const statePath = path.join(directory, "combo-state.json");
    await writeFile(statePath, JSON.stringify(snapshot), "utf8");
    const comboMachine = await JackyunBrowserStateMachine.load(statePath);
    await comboMachine.transition("combos", "CONFIRM_EXPORT_DIALOG", {
      prompt: "导出列中存在图片列，最多只能导出2000条，确定导出？",
      button: "确定",
    });
    await comboMachine.transition("combos", "WAIT_EVENT_AND_FILE", { confirmedAt: new Date().toISOString() });
    assert.equal(comboMachine.snapshot().currentState, "WAIT_EVENT_AND_FILE");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("blocked or interrupted state can reconcile to the manifest's next module", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jackyun-state-resume-test-"));
  try {
    const statePath = path.join(directory, "state.json");
    const machine = await JackyunBrowserStateMachine.create({ statePath, runId: "resume-test", policyVersion: "test" });
    await machine.transition("products", "ENTER_MODULE", {});
    await machine.block("CONNECTION_LOST", "test");
    await machine.reconcileForResume("inventory_age", { manifestVerified: true });
    assert.equal(machine.snapshot().status, "running");
    assert.equal(machine.snapshot().currentModule, "inventory_age");
    assert.equal(machine.snapshot().currentState, "ENTER_MODULE");
    assert.equal(machine.snapshot().failureCode, undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
