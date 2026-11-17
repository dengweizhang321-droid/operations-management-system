import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { probeHelperIdleForStore } from "../tools/tmall-direct-promotion-admin-core";

import { getTmallStore, type TmallStore } from "../lib/netshop/tmall-store-registry";
import {
  abandonExpiredPromotion,
  classifyPromotionProbe,
  inspectPromotionAudit,
  localZipPath,
  probePromotionAudit,
  promotionProbeWindow,
  resolveSubmittingPromotion,
  type ProbeResult,
  type PromotionAdminOptions,
  type PromotionPlatformProbe,
} from "../tools/tmall-direct-promotion-admin-core";
import { activeAuditPath } from "../tools/tmall-direct-promotion-export";

const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const RUN = "0f3c2d1e-aaaa-4bbb-8ccc-123456789abc";
const NAME = "商品报表_20261116_ab12cd34";
const REASON = "建任务响应未决，已在平台下载列表核对";

type AuditFixture = Record<string, unknown> & { startDate: string; runId: string };
type View = {
  stage: string; outcome: string; resumed: boolean; sha256: string; notes: string[];
  availableActions: Array<{ action: string }>; probe: { verdict: string }; proposedAudit: { taskId?: string };
  active: { sha256: string; stage: string; resumeStage: string; file: { present: boolean }; localZip: { exists: boolean; path: string; sha256: string } };
};
const view = (value: unknown) => value as View;

type Env = { root: string; audits: string; downloads: string; store: TmallStore; activePath: string; audit: AuditFixture };

async function setup(mutate?: (audit: AuditFixture) => void): Promise<Env> {
  const root = await mkdtemp(path.join(tmpdir(), "tmall-promo-admin-"));
  const audits = path.join(root, "outputs", "tmall-direct-promotion-export");
  const downloads = path.join(root, "downloads");
  await mkdir(audits, { recursive: true });
  await mkdir(downloads, { recursive: true });
  const real = await getTmallStore("tmall-yijiu");
  const store: TmallStore = { ...real, browser: { ...real.browser, downloadDir: downloads } };
  const audit: AuditFixture = {
    version: 1, protocol: "alimama_item_promotion_direct_v1", runId: RUN, storeKey: store.storeKey, shopName: store.shopName,
    baseUrl: "http://localhost:3000", startDate: "2026-11-16", endDate: "2026-11-16",
    startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    stage: "failed", resumeStage: "report_submitting", reportName: NAME,
    error: "推广直连建任务响应未决，必须人工按活动清单核对 taskId，禁止自动重提",
  };
  mutate?.(audit);
  const activePath = activeAuditPath(store.storeKey, audits);
  await writeFile(activePath, JSON.stringify(audit, null, 2), "utf8");
  return { root, audits, downloads, store, activePath, audit };
}
const cleanup = (env: Env) => rm(env.root, { recursive: true, force: true });
const refusal = (reason: string) => (error: unknown) => (error as { reason?: string }).reason === reason;

async function snapshot(root: string) {
  const out: Record<string, string> = {};
  const walk = async (dir: string) => {
    for (const name of await readdir(dir)) {
      const full = path.join(dir, name);
      if ((await stat(full)).isDirectory()) { out[full] = "dir"; await walk(full); } else out[full] = sha(await readFile(full));
    }
  };
  await walk(root);
  return out;
}

const row = (id: string, status: string, fileName = NAME) => ({ id, status, ext: { fileName } });
const verdictProbe = (rows: unknown[], extra: { windowTruncated?: boolean } = {}): PromotionPlatformProbe =>
  async audit => classifyPromotionProbe([rows], audit, { complete: true, ...extra });
const fixedProbe = (result: ProbeResult): PromotionPlatformProbe => async () => result;
const idle = async () => "helper_store_idle";
const NOW = new Date("2026-11-17T09:40:00.000Z");

const common = (env: Env, extra: Partial<PromotionAdminOptions> = {}): PromotionAdminOptions => ({
  storeKey: env.store.storeKey, store: env.store, auditDirectory: env.audits, helperProbe: idle, now: NOW, ...extra,
});
async function dry(kind: "resolve" | "abandon", env: Env, probe: PromotionPlatformProbe) {
  const fn = kind === "resolve" ? resolveSubmittingPromotion : abandonExpiredPromotion;
  return fn(common(env, { dryRun: true, probe }));
}
async function confirm(kind: "resolve" | "abandon", env: Env, probe: PromotionPlatformProbe, extra: Partial<PromotionAdminOptions> = {}) {
  const fn = kind === "resolve" ? resolveSubmittingPromotion : abandonExpiredPromotion;
  const sha256 = sha(await readFile(env.activePath));
  return fn(common(env, { operatorConfirmed: true, reason: REASON, expectSha256: sha256, probe, ...extra }));
}

// ---------------------------------------------------------------- classifyPromotionProbe
test("classify：ext.fileName 匹配 -> unique；excelName/name 不参与", () => {
  const audit = { reportName: NAME };
  const hit = classifyPromotionProbe([[row("11", "SUCCESS"), row("12", "SUCCESS", "other")]], audit, { complete: true });
  assert.equal(hit.verdict, "unique");
  assert.equal(hit.unique?.id, "11");
  assert.equal(hit.unique?.succeeded, true);
  const wrongField = classifyPromotionProbe([[{ id: "13", excelName: NAME, name: NAME, status: "SUCCESS" }]], audit, { complete: true });
  assert.equal(wrongField.verdict, "absent");
});

test("classify：absent、重名 ambiguous、taskId 指向不同行 ambiguous、无名称仅 taskId 命中 unique", () => {
  assert.equal(classifyPromotionProbe([[row("1", "SUCCESS", "x")]], { reportName: NAME }, { complete: true }).verdict, "absent");
  assert.equal(classifyPromotionProbe([[row("1", "SUCCESS"), row("2", "SUCCESS")]], { reportName: NAME }, { complete: true }).verdict, "ambiguous");
  const split = classifyPromotionProbe([[row("1", "SUCCESS"), row("2", "SUCCESS", "x")]], { reportName: NAME, taskId: "2" }, { complete: true });
  assert.equal(split.verdict, "ambiguous");
  const sameRow = classifyPromotionProbe([[row("1", "FAILED")]], { reportName: NAME, taskId: "1" }, { complete: true });
  assert.equal(sameRow.verdict, "unique");
  assert.equal(sameRow.unique?.failed, true);
  const byTaskOnly = classifyPromotionProbe([[row("9", "RUNNING", "renamed")]], { reportName: NAME, taskId: "9" }, { complete: true });
  assert.equal(byTaskOnly.verdict, "unique");
  const nameButTaskMissing = classifyPromotionProbe([[row("1", "SUCCESS")]], { reportName: NAME, taskId: "77" }, { complete: true });
  assert.equal(nameButTaskMissing.verdict, "ambiguous");
  const dupTask = classifyPromotionProbe([[row("5", "SUCCESS", "a"), row("5", "SUCCESS", "b")]], { reportName: NAME, taskId: "5" }, { complete: true });
  assert.equal(dupTask.verdict, "ambiguous");
});

test("classify：25 页扫满或调用方声明未完整 -> incomplete；末页满 20 行也不算完整", () => {
  const full = (page: number) => Array.from({ length: 20 }, (_, n) => row(`${page}-${n}`, "SUCCESS", "x"));
  const pages = Array.from({ length: 25 }, (_, p) => full(p));
  assert.equal(classifyPromotionProbe(pages, { reportName: NAME }, { complete: false }).verdict, "incomplete");
  assert.equal(classifyPromotionProbe(pages, { reportName: NAME }, { complete: true }).verdict, "incomplete");
  assert.equal(classifyPromotionProbe([[]], { reportName: NAME }, { complete: false }).verdict, "incomplete");
  const ok = classifyPromotionProbe([full(0), [row("z", "SUCCESS", "x")]], { reportName: NAME }, { complete: true });
  assert.equal(ok.verdict, "absent");
  assert.equal(ok.pagesScanned, 2);
  assert.equal(ok.rowsScanned, 21);
});

test("probe 窗口：startedAt 前一天到今天；超 30 天截断到 30 天前并标 windowTruncated", () => {
  const recent = promotionProbeWindow({ startedAt: "2026-11-15T10:00:00.000Z" }, NOW);
  assert.deepEqual(recent, { startTime: "2026-11-14", endTime: "2026-11-17", windowTruncated: false });
  const old = promotionProbeWindow({ startedAt: "2026-09-01T10:00:00.000Z" }, NOW);
  assert.equal(old.windowTruncated, true);
  assert.equal(old.startTime, "2026-10-18");
  assert.equal(old.endTime, "2026-11-17");
});

// ---------------------------------------------------------------- inspect
test("inspect：无清单返回 active:null；有清单给出 sha、zip 证据与可用动作", async () => {
  const env = await setup();
  try {
    const sha256 = sha(await readFile(env.activePath));
    const r = view(await inspectPromotionAudit(common(env)));
    assert.equal(r.active.sha256, sha256);
    assert.equal(r.active.stage, "failed");
    assert.equal(r.active.resumeStage, "report_submitting");
    assert.equal(r.active.file.present, false);
    assert.equal(r.active.localZip.exists, false);
    assert.equal(r.active.localZip.path, localZipPath(env.store, env.audit));
    assert.ok(r.availableActions.some(a => a.action === "resolve-submitting"));
    assert.ok(!r.availableActions.some(a => a.action === "abandon-expired"));
    await writeFile(localZipPath(env.store, env.audit), "PKzip");
    const z = view(await inspectPromotionAudit(common(env)));
    assert.equal(z.active.localZip.exists, true);
    assert.equal(z.active.localZip.sha256, sha("PKzip"));
    await rm(env.activePath);
    assert.deepEqual(await inspectPromotionAudit(common(env)), { ok: true, action: "inspect", storeKey: env.store.storeKey, active: null });
  } finally { await cleanup(env); }
});

test("inspect：downloaded 带文件时不推荐作废；非直连店铺被拒", async () => {
  const env = await setup(a => { a.resumeStage = "downloaded"; a.taskId = "T1"; a.file = { filePath: "x.zip", sha256: "a".repeat(64), size: 1, rowCount: 1 }; });
  try {
    const r = view(await inspectPromotionAudit(common(env)));
    assert.deepEqual(r.availableActions.map(a => a.action), ["probe"]);
    assert.match(r.notes.join(" "), /禁止作废/);
    await assert.rejects(inspectPromotionAudit({ ...common(env), storeKey: "tmall-unknown", store: { ...env.store, storeKey: "tmall-unknown" } }));
  } finally { await cleanup(env); }
});

test("probe 动作：helper 活跃拒绝；使用注入探测且不改文件", async () => {
  const env = await setup();
  try {
    const before = await snapshot(env.root);
    await assert.rejects(probePromotionAudit(common(env, {
      probe: verdictProbe([]), helperProbe: async () => { throw Object.assign(new Error("busy"), { reason: "helper_store_active" }); },
    })), refusal("helper_store_active"));
    const r = view(await probePromotionAudit(common(env, { probe: verdictProbe([row("1", "SUCCESS")]) })));
    assert.equal(r.probe.verdict, "unique");
    assert.deepEqual(await snapshot(env.root), before);
  } finally { await cleanup(env); }
});

// ---------------------------------------------------------------- resolve-submitting
test("resolve：absent -> planned，删 error，其余字段不动，证据齐全", async () => {
  const env = await setup();
  try {
    const original = await readFile(env.activePath);
    const result = view(await confirm("resolve", env, verdictProbe([row("1", "SUCCESS", "other")])));
    assert.equal(result.stage, "resolved");
    assert.equal(result.outcome, "reset_to_planned");
    const now = JSON.parse(await readFile(env.activePath, "utf8"));
    const expected: AuditFixture = { ...env.audit, resumeStage: "planned" }; delete expected.error;
    assert.deepEqual(now, expected);
    assert.equal(now.stage, "failed");
    assert.equal(now.taskId, undefined);
    const dir = path.join(env.audits, "operator-resolutions", `${RUN}-${sha(original).slice(0, 16)}`);
    assert.deepEqual(await readFile(path.join(dir, "original.json")), original);
    const record = JSON.parse(await readFile(path.join(dir, "record.json"), "utf8"));
    assert.equal(record.action, "resolve-submitting");
    assert.equal(record.reason, REASON);
    assert.equal(record.originalSha256, sha(original));
    assert.deepEqual(record.newAudit, expected);
    assert.equal(record.newAuditSha256, sha(await readFile(env.activePath)));
    assert.equal(record.probe.verdict, "absent");
    assert.equal(record.operatorConfirmedAt, NOW.toISOString());
  } finally { await cleanup(env); }
});

test("resolve：unique 且任务未失败 -> 绑定 taskId、resumeStage=report_submitted", async () => {
  const env = await setup();
  try {
    const result = view(await confirm("resolve", env, verdictProbe([row("98765", "RUNNING")])));
    assert.equal(result.outcome, "bound_task");
    const now = JSON.parse(await readFile(env.activePath, "utf8"));
    assert.equal(now.taskId, "98765");
    assert.equal(now.resumeStage, "report_submitted");
    assert.equal(now.stage, "failed");
    assert.equal(now.error, undefined);
    assert.equal(now.reportName, NAME);
    assert.equal(now.runId, RUN);
    assert.equal(now.startedAt, env.audit.startedAt);
  } finally { await cleanup(env); }
});

test("resolve：unique 且任务失败 -> planned，不写 taskId", async () => {
  const env = await setup();
  try {
    const result = view(await confirm("resolve", env, verdictProbe([row("98765", "FAILED")])));
    assert.equal(result.outcome, "reset_to_planned_task_failed");
    const now = JSON.parse(await readFile(env.activePath, "utf8"));
    assert.equal(now.resumeStage, "planned");
    assert.equal(now.taskId, undefined);
    assert.equal(now.error, undefined);
  } finally { await cleanup(env); }
});

test("resolve：ambiguous / incomplete / 探测抛错 / absent+窗口截断 均拒绝且原文件不动", async () => {
  const env = await setup();
  try {
    const original = await readFile(env.activePath);
    const cases: Array<[PromotionPlatformProbe, string]> = [
      [verdictProbe([row("1", "SUCCESS"), row("2", "SUCCESS")]), "probe_ambiguous"],
      [async audit => classifyPromotionProbe([[]], audit, { complete: false }), "probe_incomplete"],
      [async () => { throw new Error("network down"); }, "probe_failed"],
      [verdictProbe([], { windowTruncated: true }), "window_truncated"],
    ];
    for (const [probe, reason] of cases) {
      await assert.rejects(confirm("resolve", env, probe), refusal(reason));
      assert.deepEqual(await readFile(env.activePath), original);
    }
    assert.equal(await stat(path.join(env.audits, "operator-resolutions")).then(() => true, () => false), false);
  } finally { await cleanup(env); }
});

test("dry-run 零写入：目录快照前后相同，输出 sha 与拟写入清单", async () => {
  for (const kind of ["resolve", "abandon"] as const) {
    const env = await setup(kind === "abandon" ? a => { a.resumeStage = "downloading"; a.taskId = "T9"; delete a.error; } : undefined);
    try {
      const before = await snapshot(env.root);
      const result = view(await dry(kind, env, verdictProbe(kind === "abandon" ? [] : [row("5", "RUNNING")])));
      assert.equal(result.stage, "dry_run");
      assert.equal(result.sha256, sha(await readFile(env.activePath)));
      if (kind === "resolve") assert.equal(result.proposedAudit.taskId, "5");
      assert.deepEqual(await snapshot(env.root), before);
    } finally { await cleanup(env); }
  }
});

test("confirm 前置：expect-sha 不符、缺失、缺 reason、helper 店铺活跃均拒绝且无写入", async () => {
  const env = await setup();
  try {
    const before = await snapshot(env.root);
    const probe = verdictProbe([]);
    await assert.rejects(resolveSubmittingPromotion(common(env, { operatorConfirmed: true, reason: REASON, expectSha256: "0".repeat(64), probe })), refusal("sha256_mismatch"));
    await assert.rejects(resolveSubmittingPromotion(common(env, { operatorConfirmed: true, reason: REASON, probe })), refusal("expect_sha256_missing"));
    await assert.rejects(confirm("resolve", env, probe, { reason: "短" }), refusal("reason_length"));
    await assert.rejects(resolveSubmittingPromotion(common(env, { probe })), refusal("not_confirmed"));
    await assert.rejects(confirm("resolve", env, probe, {
      helperProbe: async () => { throw Object.assign(new Error("active"), { reason: "helper_store_active" }); },
    }), refusal("helper_store_active"));
    assert.deepEqual(await snapshot(env.root), before);
  } finally { await cleanup(env); }
});

test("阶段错误：resolve 拒绝 downloaded / report_submitted；abandon 拒绝 report_submitting / downloaded", async () => {
  const cases: Array<[(a: AuditFixture) => void, "resolve" | "abandon"]> = [
    [a => { a.resumeStage = "downloaded"; a.taskId = "T1"; a.file = { filePath: "f", sha256: "a".repeat(64), size: 1, rowCount: 1 }; }, "resolve"],
    [a => { a.resumeStage = "report_submitted"; a.taskId = "T1"; }, "resolve"],
    [a => { a.stage = "report_submitting"; delete a.resumeStage; }, "resolve"],
    [a => { a.resumeStage = "report_submitting"; }, "abandon"],
    [a => { a.resumeStage = "downloaded"; a.taskId = "T1"; a.file = { filePath: "f", sha256: "a".repeat(64), size: 1, rowCount: 1 }; }, "abandon"],
    [a => { a.resumeStage = "importing"; a.taskId = "T1"; a.file = { filePath: "f", sha256: "a".repeat(64), size: 1, rowCount: 1 }; }, "abandon"],
    [a => { a.resumeStage = "downloading"; delete a.taskId; }, "abandon"],
  ];
  for (const [mutate, kind] of cases) {
    const env = await setup(mutate);
    try {
      const before = await snapshot(env.root);
      await assert.rejects(dry(kind, env, verdictProbe([])), refusal("stage"));
      await assert.rejects(confirm(kind, env, verdictProbe([])), refusal("stage"));
      assert.deepEqual(await snapshot(env.root), before);
    } finally { await cleanup(env); }
  }
});

test("证据已存在：内容不同拒绝；相同（含 original 与决定）可续做", async () => {
  const env = await setup();
  try {
    const original = await readFile(env.activePath);
    const dir = path.join(env.audits, "operator-resolutions", `${RUN}-${sha(original).slice(0, 16)}`);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "original.json"), "tampered");
    await assert.rejects(confirm("resolve", env, verdictProbe([])), refusal("evidence_conflict"));
    assert.deepEqual(await readFile(env.activePath), original);
    await rm(path.join(dir, "original.json"));

    // First run stops after writing evidence (simulated crash), the second run resumes with the same decision.
    await assert.rejects(confirm("resolve", env, verdictProbe([]), { hooks: { afterEvidence: async () => { throw new Error("crash"); } } }), /crash/);
    assert.deepEqual(await readFile(env.activePath), original);
    // A different decision against the same evidence refuses.
    await assert.rejects(confirm("resolve", env, verdictProbe([row("7", "RUNNING")])), refusal("evidence_conflict"));
    const resumed = view(await confirm("resolve", env, verdictProbe([]), { now: new Date("2026-11-17T10:00:00.000Z") }));
    assert.equal(resumed.resumed, true);
    assert.equal(JSON.parse(await readFile(env.activePath, "utf8")).resumeStage, "planned");
    const record = JSON.parse(await readFile(path.join(dir, "record.json"), "utf8"));
    assert.equal(record.operatorConfirmedAt, NOW.toISOString()); // original record kept
  } finally { await cleanup(env); }
});

test("CAS：写入前活动清单字节变化 -> 拒绝且不覆盖", async () => {
  const env = await setup();
  try {
    let changed = "";
    await assert.rejects(confirm("resolve", env, verdictProbe([]), {
      hooks: { afterEvidence: async () => { changed = JSON.stringify({ ...env.audit, updatedAt: "2099-01-01T00:00:00.000Z" }); await writeFile(env.activePath, changed); } },
    }), refusal("active_changed"));
    assert.equal(await readFile(env.activePath, "utf8"), changed);
  } finally { await cleanup(env); }
});

// ---------------------------------------------------------------- abandon-expired
const downloading = (a: AuditFixture) => { a.resumeStage = "downloading"; a.taskId = "T9"; delete a.error; a.error = "阿里妈妈商品报表任务 T9 在 7 分钟内未完成"; };

test("abandon：absent 作废；active 消失、original 字节一致、zip 原地保留并入证据", async () => {
  const env = await setup(downloading);
  try {
    const original = await readFile(env.activePath);
    const zip = localZipPath(env.store, env.audit);
    await writeFile(zip, "PKkeepme");
    const result = view(await confirm("abandon", env, verdictProbe([row("1", "SUCCESS", "other")])));
    assert.equal(result.stage, "abandoned");
    assert.equal(await stat(env.activePath).then(() => true, () => false), false);
    const dir = path.join(env.audits, "operator-abandons", `${RUN}-${sha(original).slice(0, 16)}`);
    assert.deepEqual(await readFile(path.join(dir, "original.json")), original);
    assert.deepEqual(await readFile(path.join(dir, `abandoned-${RUN}-original.json`)), original);
    const record = JSON.parse(await readFile(path.join(dir, "record.json"), "utf8"));
    assert.equal(record.action, "abandon-expired");
    assert.equal(record.localZip.exists, true);
    assert.equal(record.localZip.sha256, sha("PKkeepme"));
    assert.equal(record.localZip.sizeBytes, 8);
    assert.equal(await readFile(zip, "utf8"), "PKkeepme");
  } finally { await cleanup(env); }
});

test("abandon：unique 且失败 允许；windowTruncated 的 absent 允许（resolve 不允许）", async () => {
  const failed = await setup(a => { downloading(a); a.resumeStage = "report_submitted"; });
  try {
    const r = view(await confirm("abandon", failed, verdictProbe([row("T9", "FAILED")])));
    assert.equal(r.outcome, "task_failed");
  } finally { await cleanup(failed); }
  const truncated = await setup(downloading);
  try {
    const r = view(await confirm("abandon", truncated, verdictProbe([], { windowTruncated: true })));
    assert.equal(r.outcome, "task_absent_window_truncated");
  } finally { await cleanup(truncated); }
});

test("abandon：unique 且成功/进行中、ambiguous、incomplete 拒绝，active 不动", async () => {
  const env = await setup(downloading);
  try {
    const original = await readFile(env.activePath);
    const cases: Array<[PromotionPlatformProbe, string]> = [
      [verdictProbe([row("T9", "SUCCESS")]), "task_still_valid"],
      [verdictProbe([row("T9", "RUNNING")]), "task_still_valid"],
      [verdictProbe([row("T9", "SUCCESS"), row("T9", "SUCCESS")]), "probe_ambiguous"],
      [async audit => classifyPromotionProbe([[]], audit, { complete: false }), "probe_incomplete"],
    ];
    for (const [probe, reason] of cases) {
      await assert.rejects(confirm("abandon", env, probe), refusal(reason));
      assert.deepEqual(await readFile(env.activePath), original);
    }
    assert.equal(await stat(path.join(env.audits, "operator-abandons")).then(() => true, () => false), false);
  } finally { await cleanup(env); }
});

test("abandon：归档目标已存在拒绝覆盖，active 保留", async () => {
  const env = await setup(downloading);
  try {
    const original = await readFile(env.activePath);
    const dir = path.join(env.audits, "operator-abandons", `${RUN}-${sha(original).slice(0, 16)}`);
    await mkdir(dir, { recursive: true });
    const target = path.join(dir, `abandoned-${RUN}-original.json`);
    await writeFile(target, "pre-existing");
    await assert.rejects(confirm("abandon", env, verdictProbe([])), refusal("archive_target_exists"));
    assert.deepEqual(await readFile(env.activePath), original);
    assert.equal(await readFile(target, "utf8"), "pre-existing");
  } finally { await cleanup(env); }
});

test("abandon：移动前 helper 活跃拒绝，active 保留", async () => {
  const env = await setup(downloading);
  try {
    const original = await readFile(env.activePath);
    let calls = 0;
    await assert.rejects(confirm("abandon", env, verdictProbe([]), {
      helperProbe: async () => { calls += 1; if (calls >= 2) throw Object.assign(new Error("active"), { reason: "helper_store_active" }); },
    }), refusal("helper_store_active"));
    assert.deepEqual(await readFile(env.activePath), original);
  } finally { await cleanup(env); }
});

test("helper 探测：ECONNREFUSED 视为未运行；本店天猫执行在跑拒绝；他店在跑放行", async () => {
  const refused = async () => { throw Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } }); };
  assert.equal(await probeHelperIdleForStore("tmall-yijiu", refused), "helper_not_running");
  const health = (slots: unknown[]) => (async () => new Response(JSON.stringify({ storeExecutions: slots }))) as unknown as typeof fetch;
  await assert.rejects(probeHelperIdleForStore("tmall-yijiu", health([{ workflow: "tmall", storeKey: "tmall-yijiu" }])), refusal("helper_store_active"));
  assert.equal(await probeHelperIdleForStore("tmall-yijiu", health([{ workflow: "tmall", storeKey: "tmall-lili" }])), "helper_store_idle");
  await assert.rejects(probeHelperIdleForStore("tmall-yijiu", (async () => new Response("{}"))), refusal("helper_probe_failed"));
});

test("新模块与 CLI 不含 import.meta，且 tools/、lib/ 下没有其他文件 import 它们", async () => {
  const modules = ["tools/tmall-direct-promotion-admin-core.ts", "tools/tmall-direct-promotion-admin.ts"];
  // The unified operator CLI and its adapter registry wrap this tool on purpose (closure-admin.test.ts pins the helper closure).
  const allowed = [...modules, "tools/closure-admin.ts", "tools/closure-adapters.ts"];
  for (const file of modules) {
    const text = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.equal(/imports*.s*meta/.test(text), false, `${file} 含 import.meta`);
  }
  const offenders: string[] = [];
  const walk = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { await walk(full); continue; }
      if (!/.(ts|tsx|mjs|js|cjs|ps1|json)$/.test(entry.name)) continue;
      const rel = path.relative(process.cwd(), full).replaceAll("\\", "/");
      if (allowed.includes(rel)) continue;
      if (/tmall-direct-promotion-admin/.test(await readFile(full, "utf8"))) offenders.push(rel);
    }
  };
  await walk(path.join(process.cwd(), "tools"));
  await walk(path.join(process.cwd(), "lib"));
  assert.deepEqual(offenders, []);
});
