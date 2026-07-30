import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertLocalWorkerPortAvailable,
  ensureRuntimeDevVarsLink,
  getLocalWorkerBuildCommand,
  parseLocalWorkerArguments,
} from "../tools/start-local-worker.mjs";

test("local Worker build always enables the local-only build flag", () => {
  const command = getLocalWorkerBuildCommand("D:/example-project");

  assert.equal(command.args.at(-1), "build");
  assert.match(command.args[0] ?? "", /example-project[\\/]node_modules[\\/]vinext[\\/]dist[\\/]cli\.js$/);
  assert.equal(command.env.VITE_TERUISI_LOCAL_BUILD, "true");
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
