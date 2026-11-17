import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { abandonActiveTmallProductMasterAudit } from "../tools/tmall-product-master-export";
import { parseAbandonArgs, runAbandonAdmin } from "../tools/tmall-admin-helper-probe";

const ACTION = "abandon-confirmed-export";
const REASON = "操作者确认旧任务已作废";

function fixture(overrides: Record<string, unknown> = {}) {
  return {
    version: 1, runId: "confirmed-run", storeKey: "tmall-yijiu", shopName: "天猫-志高亿玖专卖店", snapshotDate: "2026-08-19",
    targetUrl: "https://myseller.taobao.com/home.htm/SellManage/on_sale", prompt: "导出全部商品",
    startedAt: "2026-08-19T03:47:03.320Z", updatedAt: "2026-08-22T05:41:11.476Z", stage: "export_confirmed",
    exportSubmittedAt: "2026-08-19T03:47:10.645Z", lastError: "等待千牛生成全部商品 Excel 超时", ...overrides,
  };
}
async function setup(audit: Record<string, unknown>) {
  const root = await mkdtemp(path.join(tmpdir(), "tmall-master-admin-"));
  const activePath = path.join(root, "active-tmall-yijiu.json");
  const bytes = Buffer.from(`${JSON.stringify(audit, null, 1)}\r\n`, "utf8");
  await writeFile(activePath, bytes);
  return { root, activePath, bytes };
}
async function snapshot(root: string) {
  const out: Record<string, string> = {};
  for (const name of (await readdir(root)).sort()) out[name] = createHash("sha256").update(await readFile(path.join(root, name))).digest("hex");
  return out;
}
const dryRun = (root: string) => abandonActiveTmallProductMasterAudit({
  storeKey: "tmall-yijiu", reason: "", operatorConfirmed: false, dryRun: true, auditDirectory: root,
}) as Promise<{ stage: string; activeSha256: string; originalCopyFileName: string; wouldWrite: string[] }>;

test("dry-run 零写入并返回 sha 与拟写文件；export_submitted 与 export_confirmed 均可", async () => {
  for (const stage of ["export_submitted", "export_confirmed"]) {
    const { root, bytes } = await setup(fixture({ stage }));
    try {
      const before = await snapshot(root);
      const result = await dryRun(root);
      assert.equal(result.stage, "dry_run_abandonable");
      assert.equal(result.activeSha256, createHash("sha256").update(bytes).digest("hex"));
      assert.equal(result.wouldWrite.length, 2);
      assert.deepEqual(await snapshot(root), before);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test("不可作废阶段 dry-run 也拒绝且零写入（不得放宽）", async () => {
  for (const stage of ["export_submitting", "downloaded", "completed", "importing"]) {
    const { root } = await setup(fixture({ stage }));
    try {
      const before = await snapshot(root);
      await assert.rejects(() => dryRun(root), /不允许按已提交任务作废/);
      assert.deepEqual(await snapshot(root), before);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
  const { root } = await setup(fixture({ shopName: "别的店" }));
  try {
    await assert.rejects(() => dryRun(root), /店铺身份不一致/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("dry-run 与 confirmed 同时给出被拒绝", async () => {
  const { root } = await setup(fixture());
  try {
    await assert.rejects(() => abandonActiveTmallProductMasterAudit({
      storeKey: "tmall-yijiu", reason: REASON, operatorConfirmed: true, dryRun: true, auditDirectory: root,
    }), /不能同时/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("expect-sha256 不符拒绝且零写入", async () => {
  const { root } = await setup(fixture());
  try {
    const before = await snapshot(root);
    await assert.rejects(() => abandonActiveTmallProductMasterAudit({
      storeKey: "tmall-yijiu", reason: REASON, operatorConfirmed: true, expectSha256: "0".repeat(64), auditDirectory: root,
    }), (error: { reason?: string }) => error.reason === "expect_sha256_mismatch");
    assert.deepEqual(await snapshot(root), before);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("confirm 成功后归档与 -original.json 字节等于原清单且活动清单消失", async () => {
  const { root, activePath, bytes } = await setup(fixture());
  try {
    const dry = await dryRun(root);
    const result = await abandonActiveTmallProductMasterAudit({
      storeKey: "tmall-yijiu", reason: REASON, operatorConfirmed: true, expectSha256: dry.activeSha256, auditDirectory: root,
      now: new Date("2026-08-22T06:30:00.000Z"),
    });
    assert.equal(result.stage, "abandoned");
    await assert.rejects(() => stat(activePath), { code: "ENOENT" });
    assert.equal(Buffer.compare(await readFile(path.join(root, dry.originalCopyFileName)), bytes), 0);
    const archived = JSON.parse(await readFile(path.join(root, result.archiveFileName), "utf8"));
    assert.equal(archived.abandonment.previousStage, "export_confirmed");
    assert.equal(archived.abandonment.reason, REASON);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("原始副本已存在时拒绝覆盖且活动清单保留", async () => {
  const { root, activePath } = await setup(fixture());
  try {
    const dry = await dryRun(root);
    await writeFile(path.join(root, dry.originalCopyFileName), "x");
    await assert.rejects(() => dryRun(root), /副本已存在/);
    assert.equal((await stat(activePath)).isFile(), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("不带新参数的既有调用行为不变：无副本、无 sha 要求", async () => {
  const { root } = await setup(fixture());
  try {
    const result = await abandonActiveTmallProductMasterAudit({ storeKey: "tmall-yijiu", reason: REASON, operatorConfirmed: true, auditDirectory: root });
    assert.equal(result.stage, "abandoned");
    assert.deepEqual((await readdir(root)).filter(name => name.endsWith("-original.json")), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("CLI：参数互斥/缺参与 helper 活跃拒绝", async () => {
  const h = "b".repeat(64);
  const bad = (argv: string[]) => assert.throws(() => parseAbandonArgs(argv, ACTION), (e: { reason?: string }) => e.reason === "bad_arguments");
  bad(["--action", ACTION, "--store-key", "k"]);
  bad(["--action", ACTION, "--store-key", "k", "--dry-run", "--confirm", "--expect-sha256", h, "--reason", REASON]);
  bad(["--action", ACTION, "--store-key", "k", "--confirm", "--reason", REASON]);
  bad(["--action", ACTION, "--store-key", "k", "--confirm", "--expect-sha256", h]);
  bad(["--action", "abandon-invalid-downloaded", "--store-key", "k", "--dry-run"]);
  const parsed = parseAbandonArgs(["--action", ACTION, "--store-key", "k", "--confirm", "--expect-sha256", h, "--reason", ` ${REASON} `, "--audit-directory", "D:\\x"], ACTION);
  assert.deepEqual(parsed, { mode: "confirm", storeKey: "k", reason: REASON, expectSha256: h, auditDirectory: "D:\\x" });
  let called = false;
  await assert.rejects(() => runAbandonAdmin({
    argv: ["--action", ACTION, "--store-key", "k", "--confirm", "--expect-sha256", h, "--reason", REASON],
    action: ACTION,
    abandon: async () => { called = true; return {}; },
    probe: async () => { throw Object.assign(new Error("busy"), { reason: "helper_store_active" }); },
  }), (e: { reason?: string }) => e.reason === "helper_store_active");
  assert.equal(called, false);
});
