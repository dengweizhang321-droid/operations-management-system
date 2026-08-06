import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

import {
  acquireJackyunRunLock,
  resolveJackyunRunLockProjectRoot,
} from "../lib/jackyun/run-lock";

const execFileAsync = promisify(execFile);

test("Jackyun run lock falls back to the runtime cwd when a bundled Worker has no module URL", () => {
  const runtimeRoot = path.resolve("runtime-worker-root");
  assert.equal(
    resolveJackyunRunLockProjectRoot({ moduleUrl: undefined, cwd: runtimeRoot }),
    runtimeRoot,
  );
  assert.equal(
    resolveJackyunRunLockProjectRoot({ moduleUrl: "not-a-file-url", cwd: runtimeRoot }),
    runtimeRoot,
  );
  assert.equal(resolveJackyunRunLockProjectRoot({ moduleUrl: undefined }), ".");
});

test("Jackyun run lock admits only one owner and releases by owner token", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "jackyun-run-lock-"));
  const lockDirectory = path.join(root, "automation.lock");
  try {
    const first = await acquireJackyunRunLock({ runId: "run-first", purpose: "test", lockDirectory });
    await assert.rejects(
      acquireJackyunRunLock({ runId: "run-second", purpose: "test", lockDirectory }),
      /已有任务正在执行/,
    );
    const runLockUrl = pathToFileURL(path.resolve("lib/jackyun/run-lock.ts")).href;
    await assert.rejects(
      execFileAsync(process.execPath, [
        "--import", "tsx",
        "--input-type=module",
        "--eval",
        `import { acquireJackyunRunLock } from ${JSON.stringify(runLockUrl)}; await acquireJackyunRunLock(${JSON.stringify({ runId: "child-run", purpose: "test", lockDirectory })});`,
      ], { cwd: path.resolve("."), encoding: "utf8", timeout: 10_000 }),
      (error: unknown) => ((error as { stderr?: string }).stderr ?? "").includes("已有任务正在执行"),
    );
    const stored = JSON.parse(await readFile(path.join(lockDirectory, "owner.json"), "utf8"));
    assert.equal(stored.ownerToken, first.ownerToken);
    if (process.platform === "win32") {
      assert.equal(stored.version, 2);
      assert.match(stored.processIdentity, /^win32:\d+$/);
    }
    await first.release();

    const second = await acquireJackyunRunLock({ runId: "run-second", purpose: "test", lockDirectory });
    await second.release();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Jackyun run lock recovers a dead owner without deleting a live owner's lock", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "jackyun-stale-lock-"));
  const lockDirectory = path.join(root, "automation.lock");
  try {
    await mkdir(lockDirectory, { recursive: true });
    await writeFile(path.join(lockDirectory, "owner.json"), JSON.stringify({
      version: 1,
      ownerToken: "11111111-1111-4111-8111-111111111111",
      pid: 2_147_483_647,
      runId: "dead-run",
      purpose: "test",
      acquiredAt: "2026-08-06T00:00:00.000Z",
    }), "utf8");
    const recovered = await acquireJackyunRunLock({ runId: "recovered-run", purpose: "test", lockDirectory });
    const stored = JSON.parse(await readFile(path.join(lockDirectory, "owner.json"), "utf8"));
    assert.equal(stored.ownerToken, recovered.ownerToken);
    assert.notEqual(stored.ownerToken, "11111111-1111-4111-8111-111111111111");
    await recovered.release();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Jackyun run lock completes recovery after a process crashes with a stale-owner marker", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "jackyun-stale-marker-lock-"));
  const lockDirectory = path.join(root, "automation.lock");
  const ownerToken = "33333333-3333-4333-8333-333333333333";
  try {
    await mkdir(lockDirectory, { recursive: true });
    await writeFile(path.join(lockDirectory, `stale-owner-${ownerToken}.json`), JSON.stringify({
      version: 1,
      ownerToken,
      pid: 2_147_483_647,
      runId: "crashed-recovery",
      purpose: "test",
      acquiredAt: "2026-08-06T00:00:00.000Z",
    }), "utf8");

    const recovered = await acquireJackyunRunLock({ runId: "after-recovery-crash", purpose: "test", lockDirectory });
    const stored = JSON.parse(await readFile(path.join(lockDirectory, "owner.json"), "utf8"));
    assert.equal(stored.ownerToken, recovered.ownerToken);
    assert.notEqual(stored.ownerToken, ownerToken);
    await recovered.release();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("concurrent stale-lock recoverers never delete the newly published owner", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "jackyun-concurrent-recovery-lock-"));
  const lockDirectory = path.join(root, "automation.lock");
  const ownerToken = "44444444-4444-4444-8444-444444444444";
  try {
    await mkdir(lockDirectory, { recursive: true });
    await writeFile(path.join(lockDirectory, `stale-owner-${ownerToken}.json`), JSON.stringify({
      version: 1,
      ownerToken,
      pid: 2_147_483_647,
      runId: "dead-concurrent-run",
      purpose: "test",
      acquiredAt: "2026-08-06T00:00:00.000Z",
    }), "utf8");

    const attempts = await Promise.allSettled(Array.from({ length: 12 }, (_value, index) => (
      acquireJackyunRunLock({ runId: `recovery-${index}`, purpose: "test", lockDirectory })
    )));
    const acquired = attempts.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof acquireJackyunRunLock>>> => (
      result.status === "fulfilled"
    ));
    assert.equal(acquired.length, 1);
    const stored = JSON.parse(await readFile(path.join(lockDirectory, "owner.json"), "utf8"));
    assert.equal(stored.ownerToken, acquired[0]!.value.ownerToken);
    await acquired[0]!.value.release();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Jackyun run lock recovers an old empty legacy directory without deleting a later owner", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "jackyun-empty-legacy-lock-"));
  const lockDirectory = path.join(root, "automation.lock");
  try {
    await mkdir(lockDirectory, { recursive: true });
    const old = new Date(Date.now() - 10 * 60_000);
    await utimes(lockDirectory, old, old);
    const lock = await acquireJackyunRunLock({ runId: "after-empty-legacy", purpose: "test", lockDirectory });
    assert.equal((await stat(path.join(lockDirectory, "owner.json"))).isFile(), true);
    await lock.release();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Jackyun run lock does not confuse an ancient legacy owner with a reused live PID", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "jackyun-reused-pid-lock-"));
  const lockDirectory = path.join(root, "automation.lock");
  try {
    await mkdir(lockDirectory, { recursive: true });
    await writeFile(path.join(lockDirectory, "owner.json"), JSON.stringify({
      version: 1,
      ownerToken: "55555555-5555-4555-8555-555555555555",
      pid: process.pid,
      runId: "ancient-owner",
      purpose: "test",
      acquiredAt: "2000-01-01T00:00:00.000Z",
    }), "utf8");
    const lock = await acquireJackyunRunLock({ runId: "after-pid-reuse", purpose: "test", lockDirectory });
    assert.notEqual(lock.ownerToken, "55555555-5555-4555-8555-555555555555");
    await lock.release();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Jackyun run lock never releases a replacement owner's directory", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "jackyun-token-lock-"));
  const lockDirectory = path.join(root, "automation.lock");
  try {
    const lock = await acquireJackyunRunLock({ runId: "original-run", purpose: "test", lockDirectory });
    await writeFile(path.join(lockDirectory, "owner.json"), JSON.stringify({
      version: 1,
      ownerToken: "22222222-2222-4222-8222-222222222222",
      pid: process.pid,
      runId: "replacement-run",
      purpose: "test",
      acquiredAt: new Date().toISOString(),
    }), "utf8");
    await assert.rejects(lock.release(), /拒绝释放其他执行器的锁/);
    assert.equal((await stat(lockDirectory)).isDirectory(), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
