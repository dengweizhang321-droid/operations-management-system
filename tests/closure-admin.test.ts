import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { sha256 } from "../lib/closure/kernel";
import { getTmallStore, type TmallStore } from "../lib/netshop/tmall-store-registry";
import { CLOSURE_ADAPTERS, parseClosureArgv, runClosureAdmin } from "../tools/closure-adapters";
import { inspectJdLogisticsZeroEffect } from "../tools/jd-logistics-zero-effect-closure";
import { activeAuditPath } from "../tools/tmall-direct-master-abandon";
import type { ProbeResult } from "../tools/tmall-direct-promotion-admin-core";

const RUN = "0f3c2d1e-aaaa-4bbb-8ccc-123456789abc";
const REASON = "建任务响应未决，已在平台下载列表核对";
const HEX = "b".repeat(64);

async function setupPromotion() {
  const root = await mkdtemp(path.join(tmpdir(), "closure-admin-"));
  const audits = path.join(root, "audits");
  const downloads = path.join(root, "downloads");
  await mkdir(audits, { recursive: true });
  await mkdir(downloads, { recursive: true });
  const real = await getTmallStore("tmall-yijiu");
  const store: TmallStore = { ...real, browser: { ...real.browser, downloadDir: downloads } };
  const audit = {
    version: 1, protocol: "alimama_item_promotion_direct_v1", runId: RUN, storeKey: store.storeKey, shopName: store.shopName,
    baseUrl: "http://localhost:3000", startDate: "2026-11-16", endDate: "2026-11-16",
    startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    stage: "failed", resumeStage: "report_submitting", reportName: "商品报表_20261116_ab12cd34", error: "推广直连建任务响应未决",
  };
  const activePath = activeAuditPath(store.storeKey, audits);
  await writeFile(activePath, JSON.stringify(audit, null, 2), "utf8");
  const absent: ProbeResult = { verdict: "absent", windowTruncated: false, pagesScanned: 1, rowsScanned: 0, complete: true, window: null, byName: [], byTask: [], unique: null };
  return { root, audits, store, activePath, promotion: { store, probe: async () => absent, helperProbe: async () => "helper_store_idle" } };
}

test("参数解析：值参数、布尔开关、缺值/重复/未知参数", () => {
  const parsed = parseClosureArgv(["--pipeline", "p", "--action", "a", "--store-key", "k", "--dry-run"]);
  assert.deepEqual([parsed.pipeline, parsed.action, parsed.args.storeKey, parsed.args.dryRun, parsed.args.confirmed], ["p", "a", "k", true, false]);
  assert.throws(() => parseClosureArgv(["--pipeline"]), { reason: "argument_missing_value" });
  assert.throws(() => parseClosureArgv(["--pipeline", "--action"]), { reason: "argument_missing_value" });
  assert.throws(() => parseClosureArgv(["--pipeline", "a", "--pipeline", "b"]), { reason: "duplicate_argument" });
  assert.throws(() => parseClosureArgv(["--confirm", "--confirm"]), { reason: "duplicate_argument" });
  assert.throws(() => parseClosureArgv(["--bogus", "1"]), { reason: "unknown_argument" });
});

test("注册表：三条线、mutating 动作集合与动作表一致", () => {
  assert.deepEqual(CLOSURE_ADAPTERS.map(adapter => adapter.name), ["jd-logistics", "tmall-direct-master", "tmall-direct-promotion"]);
  for (const adapter of CLOSURE_ADAPTERS) for (const action of adapter.mutating) assert.ok(action in adapter.actions, `${adapter.name}/${action}`);
  assert.equal(CLOSURE_ADAPTERS[0]!.mutating.size, 0);
});

test("统一错误形态：缺参数、未知 pipeline、未知 action 都是 ok:false 且 exitCode=1", async () => {
  const none = await runClosureAdmin([]);
  assert.equal(none.exitCode, 1);
  assert.deepEqual(none.output, { ok: false, pipeline: null, action: null, reason: "missing_argument", error: "必须提供 --pipeline 与 --action" });
  const noAction = await runClosureAdmin(["--pipeline", "jd-logistics"]);
  assert.equal(noAction.output.reason, "missing_argument");
  assert.equal(noAction.output.pipeline, "jd-logistics");
  const unknownPipeline = await runClosureAdmin(["--pipeline", "nope", "--action", "inspect"]);
  assert.deepEqual([unknownPipeline.exitCode, unknownPipeline.output.ok, unknownPipeline.output.reason, unknownPipeline.output.pipeline, unknownPipeline.output.action], [1, false, "unknown_pipeline", "nope", "inspect"]);
  const unknownAction = await runClosureAdmin(["--pipeline", "jd-logistics", "--action", "close"]);
  assert.deepEqual([unknownAction.exitCode, unknownAction.output.reason], [1, "unknown_action"]);
  const proto = await runClosureAdmin(["--pipeline", "jd-logistics", "--action", "toString"]);
  assert.equal(proto.output.reason, "unknown_action");
  const badArgs = await runClosureAdmin(["--pipeline", "jd-logistics", "--action", "inspect", "--wat"]);
  assert.equal(badArgs.output.reason, "unknown_argument");
});

test("jd-logistics：只读动作拒绝 confirm 等参数；inspect 对临时根目录与直接调用结果一致", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "closure-admin-jd-"));
  try {
    for (const extra of [["--confirm"], ["--dry-run"], ["--expect-sha256", HEX], ["--reason", REASON]]) {
      const refused = await runClosureAdmin(["--pipeline", "jd-logistics", "--action", "inspect", "--root", root, ...extra]);
      assert.equal(refused.output.reason, "readonly_action_flags");
    }
    const empty = await runClosureAdmin(["--pipeline", "jd-logistics", "--action", "inspect", "--root", root]);
    assert.equal(empty.exitCode, 0);
    const direct = await inspectJdLogisticsZeroEffect(root);
    assert.deepEqual({ ...empty.output, ok: undefined, pipeline: undefined, action: undefined, root: undefined, note: undefined }, { ...direct, ok: undefined, pipeline: undefined, action: undefined, root: undefined, note: undefined });
    assert.equal(empty.output.ok, true);
    assert.equal(empty.output.root, root);
    assert.deepEqual(direct.reasons, ["no_active_pointer"]);
    // A malformed pointer is reported the same way by both paths.
    const directory = path.join(root, "outputs", "jd-logistics-pipeline");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "active.json"), "{not json");
    const broken = await runClosureAdmin(["--pipeline", "jd-logistics", "--action", "inspect", "--root", root]);
    const brokenDirect = await inspectJdLogisticsZeroEffect(root);
    assert.deepEqual([broken.output.verdict, broken.output.reasons], [brokenDirect.verdict, brokenDirect.reasons]);
    assert.deepEqual(brokenDirect.reasons, ["control_file_not_json"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("mutating 动作：必须 dry-run 或 confirm；confirm 必须带 expect-sha256 与 reason；二者互斥", async () => {
  const base = ["--pipeline", "tmall-direct-promotion", "--action", "abandon-expired", "--store-key", "tmall-yijiu"];
  assert.equal((await runClosureAdmin(base)).output.reason, "not_confirmed");
  assert.equal((await runClosureAdmin([...base, "--dry-run", "--confirm", "--expect-sha256", HEX, "--reason", REASON])).output.reason, "mode_conflict");
  assert.equal((await runClosureAdmin([...base, "--confirm", "--reason", REASON])).output.reason, "expect_sha256_missing");
  assert.equal((await runClosureAdmin([...base, "--confirm", "--expect-sha256", "xyz", "--reason", REASON])).output.reason, "expect_sha256_missing");
  assert.equal((await runClosureAdmin([...base, "--confirm", "--expect-sha256", HEX, "--reason", "短"])).output.reason, "reason_length");
  const master = ["--pipeline", "tmall-direct-master", "--action", "abandon-batch-content-mismatch", "--store-key", "tmall-yijiu"];
  assert.equal((await runClosureAdmin(master)).output.reason, "not_confirmed");
  assert.equal((await runClosureAdmin([...master, "--confirm", "--reason", REASON])).output.reason, "expect_sha256_missing");
  const noStore = await runClosureAdmin(["--pipeline", "tmall-direct-master", "--action", "abandon-batch-content-mismatch", "--dry-run", "--reason", REASON]);
  assert.equal(noStore.output.reason, "store_key_required");
});

test("tmall-direct-master：confirm 前比对活动清单摘要，不符拒绝且文件不动；无清单拒绝", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "closure-admin-master-"));
  try {
    const args = ["--pipeline", "tmall-direct-master", "--action", "abandon-batch-content-mismatch", "--store-key", "tmall-yijiu", "--audit-directory", dir];
    const missing = await runClosureAdmin([...args, "--confirm", "--expect-sha256", HEX, "--reason", REASON]);
    assert.equal(missing.output.reason, "no_active_audit");
    const active = activeAuditPath("tmall-yijiu", dir);
    await writeFile(active, "{\"anything\":1}");
    const mismatch = await runClosureAdmin([...args, "--confirm", "--expect-sha256", HEX, "--reason", REASON]);
    assert.deepEqual([mismatch.exitCode, mismatch.output.ok, mismatch.output.reason], [1, false, "sha256_mismatch"]);
    assert.equal(await readFile(active, "utf8"), "{\"anything\":1}");
    assert.deepEqual((await stat(dir)).isDirectory(), true);
    // With the right digest the call reaches the (unchanged) master tool, which refuses on its own judgement.
    const reached = await runClosureAdmin([...args, "--confirm", "--expect-sha256", sha256("{\"anything\":1}"), "--reason", REASON]);
    assert.equal(reached.output.reason, "audit_identity");
    assert.equal(await readFile(active, "utf8"), "{\"anything\":1}");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("tmall-direct-promotion：inspect、dry-run 给出摘要、错误摘要拒绝、正确摘要执行并留证据", async () => {
  const env = await setupPromotion();
  try {
    const common = ["--store-key", "tmall-yijiu", "--audit-directory", env.audits];
    const inspect = await runClosureAdmin(["--pipeline", "tmall-direct-promotion", "--action", "inspect", ...common], { promotion: env.promotion });
    assert.equal(inspect.exitCode, 0);
    assert.deepEqual([inspect.output.ok, inspect.output.pipeline, inspect.output.action], [true, "tmall-direct-promotion", "inspect"]);
    const digest = (inspect.output.active as { sha256: string }).sha256;
    assert.equal(digest, sha256(await readFile(env.activePath)));

    const resolve = ["--pipeline", "tmall-direct-promotion", "--action", "resolve-submitting", ...common];
    const dry = await runClosureAdmin([...resolve, "--dry-run"], { promotion: env.promotion });
    assert.equal(dry.exitCode, 0);
    assert.equal(dry.output.stage, "dry_run");
    assert.equal(dry.output.sha256, digest);
    assert.equal(await readFile(env.activePath, "utf8").then(text => sha256(text)), digest);

    const wrong = await runClosureAdmin([...resolve, "--confirm", "--expect-sha256", HEX, "--reason", REASON], { promotion: env.promotion });
    assert.deepEqual([wrong.exitCode, wrong.output.reason], [1, "sha256_mismatch"]);
    assert.equal(sha256(await readFile(env.activePath)), digest);

    const done = await runClosureAdmin([...resolve, "--confirm", "--expect-sha256", digest, "--reason", REASON], { promotion: env.promotion });
    assert.equal(done.exitCode, 0);
    assert.deepEqual([done.output.ok, done.output.stage, done.output.outcome], [true, "resolved", "reset_to_planned"]);
    assert.notEqual(sha256(await readFile(env.activePath)), digest);
  } finally { await rm(env.root, { recursive: true, force: true }); }
});
