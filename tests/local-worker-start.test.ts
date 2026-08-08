import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertLocalWorkerPortAvailable,
  assertTmallWorkflowHelperPortAvailable,
  createLocalScheduledTriggerSupervisor,
  createTmallWorkflowHelperSupervisor,
  ensureRuntimeDevVarsLink,
  getLocalWorkerBuildCommand,
  getLocalWorkerRuntimeCommand,
  getTmallWorkflowHelperCommand,
  getTmallWorkflowHelperRestartDelay,
  parseLocalWorkerArguments,
  triggerLocalScheduledEvent,
} from "../tools/start-local-worker.mjs";

test("local Worker build always enables the local-only build flag", () => {
  const command = getLocalWorkerBuildCommand("D:/example-project");

  assert.equal(command.args.at(-1), "build");
  assert.match(command.args[0] ?? "", /example-project[\\/]node_modules[\\/]vinext[\\/]dist[\\/]cli\.js$/);
  assert.equal(command.env.VITE_TERUISI_LOCAL_BUILD, "true");
});

test("local Worker keeps runtime arguments bounded without test-only middleware", () => {
  const command = getLocalWorkerRuntimeCommand("D:/example-project", ["--log-level", "warn"]);

  assert.match(command.args[0] ?? "", /example-project[\\/]node_modules[\\/]wrangler[\\/]bin[\\/]wrangler\.js$/);
  assert.equal(command.args.includes("--test-scheduled"), false);
  assert.deepEqual(command.args.slice(-2), ["--log-level", "warn"]);
});

test("local Worker starts the loopback-only Tmall workflow helper without passing credentials", () => {
  const command = getTmallWorkflowHelperCommand("D:/example-project", 5791);

  assert.equal(command.command, process.execPath);
  assert.deepEqual(command.args.slice(0, 2), ["--import", "tsx"]);
  assert.match(command.args[2] ?? "", /example-project[\\/]tools[\\/]tmall-sycm-cookie-pipeline\.ts$/);
  assert.deepEqual(command.args.slice(3), ["serve", "--port", "5791"]);
  assert.equal(command.args.some((argument) => /--(?:cookie|password|token)|(?:cookie|password|token)=/i.test(argument)), false);
});

test("control-only build flag is consumed before arguments reach Wrangler", () => {
  const parsed = parseLocalWorkerArguments(["--build", "--ip", "127.0.0.1"]);

  assert.equal(parsed.shouldBuild, true);
  assert.deepEqual(parsed.wranglerArgs, ["--ip", "127.0.0.1"]);
  assert.equal(parseLocalWorkerArguments(["--log-level", "debug"]).shouldBuild, false);
});

test("local Worker refuses to build or start while port 3000 is occupied", async () => {
  await assert.rejects(
    assertLocalWorkerPortAvailable(async () => true),
    /端口 3000 已有服务运行/,
  );
  await assert.doesNotReject(assertLocalWorkerPortAvailable(async () => false));
});

test("local Worker refuses an unknown listener on the Tmall helper port", async () => {
  await assert.rejects(
    assertTmallWorkflowHelperPortAvailable(async (port) => {
      assert.equal(port, 5791);
      return true;
    }),
    /端口 5791 已有服务运行/,
  );
  await assert.doesNotReject(assertTmallWorkflowHelperPortAvailable(async () => false));
});

test("Tmall helper supervisor restarts a completed one-shot process and stops its owned child", () => {
  class FakeChild extends EventEmitter {
    exitCode: number | null = null;
    signalCode: string | null = null;
    killed = false;

    kill() {
      this.killed = true;
      this.exitCode = 0;
      this.emit("exit", 0, null);
      return true;
    }
  }

  const children: FakeChild[] = [];
  const timers: Array<{ callback: () => void; delay: number; cancelled?: boolean }> = [];
  const supervisor = createTmallWorkflowHelperSupervisor({
    root: "D:/example-project",
    spawnProcess: () => {
      const child = new FakeChild();
      children.push(child);
      return child;
    },
    scheduleRestart: (callback, delay) => {
      const timer = { callback, delay };
      timers.push(timer);
      return timer;
    },
    cancelRestart: (timer) => {
      timer.cancelled = true;
    },
    now: () => 1_000,
  });

  supervisor.start();
  assert.equal(children.length, 1);
  children[0]!.emit("exit", 0, null);
  assert.equal(timers.length, 1);
  assert.equal(timers[0]!.delay, 500);
  timers[0]!.callback();
  assert.equal(children.length, 2);

  supervisor.stop();
  assert.equal(children[1]!.killed, true);
  assert.equal(timers.length, 1);
  assert.deepEqual([0, 1, 2, 99].map(getTmallWorkflowHelperRestartDelay), [500, 1_000, 2_000, 5_000]);
});

test("local Worker triggers the loopback Cloudflare scheduled handler without credentials", async () => {
  let request: { url: string; init: RequestInit } | null = null;
  const status = await triggerLocalScheduledEvent({
    fetchImpl: async (url, init) => {
      request = { url: String(url), init: init ?? {} };
      return new Response("ok", { status: 200 });
    },
  });

  assert.equal(status, 200);
  assert.equal(request?.url, "http://127.0.0.1:3000/_teruisi/local/market-annotation-scheduled");
  assert.equal(request?.init.method, "POST");
  assert.deepEqual(request?.init.headers, { "x-teruisi-local-scheduled": "1" });
});

test("local scheduled trigger retries startup failures and never overlaps its own timer", async () => {
  const timers: Array<{ callback: () => void; delay: number; cancelled?: boolean }> = [];
  let attempts = 0;
  const supervisor = createLocalScheduledTriggerSupervisor({
    trigger: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("worker not ready");
    },
    scheduleTrigger: (callback, delay) => {
      const timer = { callback, delay };
      timers.push(timer);
      return timer;
    },
    cancelTrigger: (timer) => { timer.cancelled = true; },
    initialDelayMs: 10,
    intervalMs: 60,
    retryDelayMs: 5,
  });

  supervisor.start();
  supervisor.start();
  assert.equal(timers.length, 1);
  assert.equal(timers[0]?.delay, 10);

  timers[0]!.callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(attempts, 1);
  assert.equal(timers[1]?.delay, 5);

  timers[1]!.callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(attempts, 2);
  assert.equal(timers[2]?.delay, 60);

  supervisor.stop();
  assert.equal(timers[2]?.cancelled, true);
});

test("prebuilt local Worker receives the ignored root .dev.vars through a hard link", async () => {
  const root = await mkdtemp(join(tmpdir(), "teruisi-local-worker-"));
  try {
    await mkdir(join(root, "dist", "server"), { recursive: true });
    await writeFile(join(root, ".dev.vars"), "AI_SECRET_ENCRYPTION_KEY=test-only-key\n", "utf8");

    const first = await ensureRuntimeDevVarsLink(root);
    const second = await ensureRuntimeDevVarsLink(root);

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(await readFile(first.runtimePath, "utf8"), "AI_SECRET_ENCRYPTION_KEY=test-only-key\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
