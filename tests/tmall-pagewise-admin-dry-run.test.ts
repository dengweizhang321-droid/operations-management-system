import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { abandonInvalidDownloadedTmallPagewiseAudit } from "../tools/tmall-pagewise-product-master-export";
import { parseAbandonArgs, probeHelperIdleForStore, runAbandonAdmin } from "../tools/tmall-admin-helper-probe";

const ACTION = "abandon-invalid-downloaded";
const REASON = "操作者确认该批分页文件跨页重复且快照不完整";

function fixture(overrides: Record<string, unknown> = {}) {
  const tasks = Array.from({ length: 6 }, (_, index) => ({ page: index + 1, itemCount: 20, submittedAt: `2026-08-24T06:1${index}:00.000Z` }));
  const files = tasks.map(task => ({
    page: task.page, taskCreatedAt: "2026-08-24 14:10:00", filePath: `page-${task.page}.xlsx`, fileName: `page-${task.page}.xlsx`,
    fileSizeBytes: 100, sha256: `${task.page}`.repeat(64), rowCount: 20, uniqueProductCount: 20, uniqueSkuCount: 20,
  }));
  return {
    version: 1, strategy: "on_sale_pagewise_excel", runId: "run-masitu-invalid", storeKey: "tmall-masitu", shopName: "天猫-志高马思图专卖店",
    snapshotDate: "2026-08-24", startedAt: "2026-08-24T06:10:00.000Z", updatedAt: "2026-08-24T06:14:00.000Z", stage: "downloaded",
    totalProducts: 120, totalPages: 6, tasks, files, lastError: "逐页货品文件合计 119 个唯一商品，与出售中总数 120 不一致", ...overrides,
  };
}
async function setup(audit: Record<string, unknown>) {
  const root = await mkdtemp(path.join(tmpdir(), "tmall-pagewise-dry-"));
  const activePath = path.join(root, "active-tmall-masitu.json");
  // Non-canonical bytes on purpose: the copy must be the original bytes, not a re-serialisation.
  const bytes = Buffer.from(`${JSON.stringify(audit, null, 1)}\r\n`, "utf8");
  await writeFile(activePath, bytes);
  return { root, activePath, bytes };
}
async function snapshot(root: string) {
  const out: Record<string, string> = {};
  for (const name of (await readdir(root)).sort()) out[name] = createHash("sha256").update(await readFile(path.join(root, name))).digest("hex");
  return out;
}
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const dryRun = (root: string) => abandonInvalidDownloadedTmallPagewiseAudit({
  storeKey: "tmall-masitu", reason: "", operatorConfirmed: false, dryRun: true, auditDirectory: root,
}) as Promise<{ stage: string; activeSha256: string; originalCopyFileName: string; wouldWrite: string[] }>;

test("dry-run 零写入并返回 activeSha256 与拟写文件", async () => {
  const { root, bytes } = await setup(fixture());
  try {
    const before = await snapshot(root);
    const result = await dryRun(root);
    assert.equal(result.stage, "dry_run_abandonable");
    assert.equal(result.activeSha256, sha(bytes));
    assert.equal(result.wouldWrite.length, 2);
    assert.deepEqual(await snapshot(root), before);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("dry-run 与 confirmed 同时给出被拒绝", async () => {
  const { root } = await setup(fixture());
  try {
    await assert.rejects(() => abandonInvalidDownloadedTmallPagewiseAudit({
      storeKey: "tmall-masitu", reason: REASON, operatorConfirmed: true, dryRun: true, auditDirectory: root,
    }), /不能同时/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("不可作废状态 dry-run 同样拒绝且零写入", async () => {
  const cases: Array<[Record<string, unknown>, RegExp]> = [
    [{ stage: "downloading" }, /不允许按无效下载作废/],
    [{ stage: "export_submitting" }, /不允许按无效下载作废/],
    [{ lastError: "别的错误" }, /没有可核验/],
    [{ shopName: "别的店" }, /店铺身份不一致/],
  ];
  for (const [override, pattern] of cases) {
    const { root } = await setup(fixture(override));
    try {
      const before = await snapshot(root);
      await assert.rejects(() => dryRun(root), pattern);
      assert.deepEqual(await snapshot(root), before);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test("expect-sha256 不符拒绝且零写入", async () => {
  const { root } = await setup(fixture());
  try {
    const before = await snapshot(root);
    await assert.rejects(() => abandonInvalidDownloadedTmallPagewiseAudit({
      storeKey: "tmall-masitu", reason: REASON, operatorConfirmed: true, expectSha256: "0".repeat(64), auditDirectory: root,
    }), (error: { reason?: string }) => error.reason === "expect_sha256_mismatch");
    assert.deepEqual(await snapshot(root), before);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("confirm 成功后归档与 -original.json 字节等于原清单且活动清单消失", async () => {
  const { root, activePath, bytes } = await setup(fixture());
  try {
    const dry = await dryRun(root);
    const result = await abandonInvalidDownloadedTmallPagewiseAudit({
      storeKey: "tmall-masitu", reason: REASON, operatorConfirmed: true, expectSha256: dry.activeSha256, auditDirectory: root,
      now: new Date("2026-08-24T07:00:00.000Z"),
    });
    assert.equal(result.stage, "abandoned");
    await assert.rejects(() => stat(activePath), { code: "ENOENT" });
    const copy = await readFile(path.join(root, dry.originalCopyFileName));
    assert.equal(Buffer.compare(copy, bytes), 0);
    const archived = JSON.parse(await readFile(path.join(root, result.archiveFileName), "utf8"));
    assert.equal(archived.abandonment.reason, REASON);
    assert.equal(archived.runId, "run-masitu-invalid");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("原始副本已存在时拒绝覆盖且不动活动清单", async () => {
  const { root, activePath } = await setup(fixture());
  try {
    const dry = await dryRun(root);
    await writeFile(path.join(root, dry.originalCopyFileName), "x");
    await assert.rejects(() => dryRun(root), /副本已存在/);
    assert.equal((await stat(activePath)).isFile(), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("helper 探测：该店 tmall 执行活跃拒绝，其他情形按规则", async () => {
  const ok = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  const reasonOf = (value: string) => (e: { reason?: string }) => e.reason === value;
  await assert.rejects(() => probeHelperIdleForStore("tmall-masitu", ok({ storeExecutions: [{ storeKey: "tmall-masitu", workflow: "tmall" }] })), reasonOf("helper_store_active"));
  assert.equal(await probeHelperIdleForStore("tmall-masitu", ok({ storeExecutions: [{ storeKey: "tmall-masitu", workflow: "jd" }, { storeKey: "other", workflow: "tmall" }] })), "helper_store_idle");
  await assert.rejects(() => probeHelperIdleForStore("tmall-masitu", ok({}, 200)), reasonOf("helper_probe_failed"));
  await assert.rejects(() => probeHelperIdleForStore("tmall-masitu", ok({}, 500)), reasonOf("helper_probe_failed"));
  const refused = (async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }); }) as unknown as typeof fetch;
  assert.equal(await probeHelperIdleForStore("tmall-masitu", refused), "helper_not_running");
  const timeout = (async () => { throw Object.assign(new Error("timeout"), { name: "TimeoutError" }); }) as unknown as typeof fetch;
  await assert.rejects(() => probeHelperIdleForStore("tmall-masitu", timeout), reasonOf("helper_probe_failed"));
});

test("CLI：helper 活跃时 confirm 在调用 abandon 之前被拒绝", async () => {
  let called = false;
  const busy = (async () => new Response(JSON.stringify({ storeExecutions: [{ storeKey: "tmall-masitu", workflow: "tmall" }] }))) as unknown as typeof fetch;
  await assert.rejects(() => runAbandonAdmin({
    argv: ["--action", ACTION, "--store-key", "tmall-masitu", "--confirm", "--expect-sha256", "a".repeat(64), "--reason", REASON],
    action: ACTION,
    abandon: async () => { called = true; return {}; },
    probe: key => probeHelperIdleForStore(key, busy),
  }), (e: { reason?: string }) => e.reason === "helper_store_active");
  assert.equal(called, false);
});

test("CLI：dry-run 不探测 helper 也不带 confirmed；参数互斥与缺参", async () => {
  let probed = false;
  let seen: Record<string, unknown> = {};
  await runAbandonAdmin({
    argv: ["--action", ACTION, "--store-key", "tmall-masitu", "--dry-run"], action: ACTION,
    abandon: async o => { seen = o; return {}; }, probe: async () => { probed = true; },
  });
  assert.equal(probed, false);
  assert.equal(seen.dryRun, true);
  assert.equal(seen.operatorConfirmed, false);
  const bad = (argv: string[]) => assert.throws(() => parseAbandonArgs(argv, ACTION), (e: { reason?: string }) => e.reason === "bad_arguments");
  const h = "a".repeat(64);
  bad(["--action", ACTION, "--store-key", "k"]);
  bad(["--action", ACTION, "--store-key", "k", "--dry-run", "--confirm", "--expect-sha256", h, "--reason", REASON]);
  bad(["--action", ACTION, "--store-key", "k", "--confirm", "--reason", REASON]);
  bad(["--action", ACTION, "--store-key", "k", "--confirm", "--expect-sha256", h]);
  bad(["--action", ACTION, "--store-key", "k", "--confirm", "--expect-sha256", h, "--reason", "短"]);
  bad(["--action", ACTION, "--store-key", "k", "--confirm", "--expect-sha256", "ABC", "--reason", REASON]);
  bad(["--action", ACTION, "--store-key", "k", "--confirm", "--expect-sha256", h, "--reason", "字".repeat(301)]);
  bad(["--action", ACTION, "--store-key", "k", "--dry-run", "--expect-sha256", h]);
  bad(["--action", "other", "--store-key", "k", "--dry-run"]);
  bad(["--action", ACTION, "--dry-run"]);
  bad(["--action", ACTION, "--store-key", "--dry-run"]);
  bad(["--action", ACTION, "--store-key", "k", "--dry-run", "--bogus"]);
});
