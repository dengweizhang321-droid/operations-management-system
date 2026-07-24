import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ensureRuntimeDevVarsLink } from "../tools/start-local-worker.mjs";

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
