import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import * as XLSX from "xlsx";

import { getTmallStore, type TmallStore } from "../lib/netshop/tmall-store-registry";
import {
  TMALL_DIRECT_MASTER_CONTENT_MISMATCH_ERROR,
  abandonTmallDirectMasterBatchContentMismatch,
  activeAuditPath,
  directBatchFilePath,
  legacyAuditDirectories,
  probeHelperIdleForStore,
  safeSegment,
} from "../tools/tmall-direct-master-abandon";

const headers = [
  "商品Id", "类目id", "类目名称", "商品标题", "一口价", "导购标题", "商家编码", "发货时间",
  "最长发货时间", "销售属性", "属性对", "发货时间", "skuId", "价格（元）", "数量", "商家编码",
  "生产日期（年/月/日）", "保质期",
];
function workbook(productIds: string[], rowsPerProduct = 2) {
  const rows = productIds.flatMap(productId => Array.from({ length: rowsPerProduct }, (_, n) => [
    productId, "cat", "测试类目", `测试商品-${productId}`, "10.00", null, `ITEM-${productId}`, 2,
    15, "颜色:红", null, null, `${productId}${n}`, "9.90", 5, `CODE-${productId}-${n}`, null, null,
  ]));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["发布模板"], [null], headers, ...rows]), "发布模板");
  return new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }));
}
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const RUN = "9dc4c9e5-c341-46b2-9a70-3d13f95bbbbb";
const DATE = "2026-11-14";
const REASON = "拓丰第8批下载文件为其他店铺商品，作废整张快照后由 n8n 重导";

type Env = { root: string; audits: string; downloads: string; store: TmallStore; audit: any; activePath: string; ids: string[][] };

/** Tuofeng real shape: 143 products in 8 batches (7 x 20 + 3), batch k stuck in downloading. Data is synthetic. */
async function setup(options: { k?: number; mutate?: (audit: any, env: Env) => void; file?: "mismatch" | "match" | "garbage" | "missing" } = {}): Promise<Env> {
  const root = await mkdtemp(path.join(tmpdir(), "tmall-direct-abandon-"));
  const audits = path.join(root, "outputs", "tmall-direct-product-master-export");
  const downloads = path.join(root, "downloads");
  await mkdir(audits, { recursive: true });
  await mkdir(downloads, { recursive: true });
  const real = await getTmallStore("tmall-tuofeng");
  const store: TmallStore = { ...real, browser: { ...real.browser, downloadDir: downloads } };
  const k = options.k ?? 8;
  const ids: string[][] = Array.from({ length: 8 }, (_, b) => Array.from({ length: b === 7 ? 3 : 20 }, (_, n) => String(1_000_000_000_000 + b * 100 + n)));
  const batches = ids.map((itemIds, b) => {
    const index = b + 1;
    const base: any = { index, itemIds, itemDigest: sha(JSON.stringify(itemIds)), expectedRows: itemIds.length };
    if (index < k) {
      base.stage = "downloaded"; base.baselineRecordIds = ["1"]; base.submittedAt = "2026-11-14T03:21:17.563Z"; base.traceId = `t${index}`; base.recordId = `r${index}`;
      base.file = { fileName: `b${index}.xlsx`, filePath: path.join(downloads, `b${index}.xlsx`), fileSizeBytes: 1, sha256: sha(`b${index}`), rowCount: 2, uniqueProductCount: itemIds.length, uniqueSkuCount: 2, productIds: itemIds };
    } else if (index === k) {
      base.stage = "downloading"; base.baselineRecordIds = ["1"]; base.submittedAt = "2026-11-14T03:21:17.563Z"; base.traceId = `t${index}`; base.recordId = "352301881";
    } else base.stage = "planned";
    return base;
  });
  const audit = {
    version: 1, protocol: "tmall_mtop_batch_export_v1", runId: RUN, storeKey: store.storeKey, shopName: store.shopName,
    baseUrl: "http://localhost:3000", snapshotDate: DATE, startedAt: "2026-11-14T03:20:57.703Z", updatedAt: "2026-11-17T03:21:02.936Z",
    stage: "failed", resumeStage: "downloading", totalProducts: 143, itemDigest: "x", listTemplateDigest: "y", batches,
    error: TMALL_DIRECT_MASTER_CONTENT_MISMATCH_ERROR,
  };
  const env: Env = { root, audits, downloads, store, audit, activePath: activeAuditPath(store.storeKey, audits), ids };
  options.mutate?.(audit, env);
  await writeFile(env.activePath, JSON.stringify(audit, null, 1), "utf8");
  const file = options.file ?? "mismatch";
  const target = directBatchFilePath(store, DATE, RUN, k);
  if (file === "mismatch") await writeFile(target, workbook(["1077814899603"], 29));
  if (file === "match") await writeFile(target, workbook(ids[k - 1]!, 2));
  if (file === "garbage") await writeFile(target, Buffer.from("not an xlsx at all"));
  return env;
}
const abandon = (env: Env, extra: Record<string, unknown> = {}) => abandonTmallDirectMasterBatchContentMismatch({
  storeKey: env.store.storeKey, reason: REASON, operatorConfirmed: true, auditDirectory: env.audits, store: env.store,
  helperProbe: async () => "ok", now: new Date("2026-11-17T09:40:00.000Z"), ...extra,
});
const refusal = (reason: string) => (error: unknown) => (error as { reason?: string }).reason === reason;
const cleanup = (env: Env) => rm(env.root, { recursive: true, force: true });
async function snapshot(...dirs: string[]) {
  const out: Record<string, string> = {};
  for (const dir of dirs) for (const name of await readdir(dir)) {
    const full = path.join(dir, name);
    out[full] = (await stat(full)).isFile() ? sha(await readFile(full)) : "dir";
  }
  return out;
}

test("拓丰真实形态：作废成功，原字节归档、记录齐全、活动清单移走、不删批次文件", async () => {
  const env = await setup();
  try {
    const originalBytes = await readFile(env.activePath);
    const batchFile = directBatchFilePath(env.store, DATE, RUN, 8);
    const batchBytes = await readFile(batchFile);
    const result = await abandon(env);
    assert.equal(result.stage, "abandoned");
    assert.equal(result.actualItemCount, 1);
    const base = `abandoned-batch-content-mismatch-tmall-tuofeng-${DATE}-${RUN}`;
    assert.equal(await stat(env.activePath).then(() => true, () => false), false); // readAudit() would now return null (ENOENT)
    assert.deepEqual(await readFile(path.join(env.audits, `${base}-original.json`)), originalBytes);
    const record = JSON.parse(await readFile(path.join(env.audits, `${base}.json`), "utf8"));
    const { abandonment, ...rest } = record;
    assert.deepEqual(rest, JSON.parse(originalBytes.toString("utf8")));
    assert.equal(abandonment.abandonedAt, "2026-11-17T09:40:00.000Z");
    assert.equal(abandonment.previousStage, "failed");
    assert.equal(abandonment.resumeStage, "downloading");
    assert.equal(abandonment.reason, REASON);
    assert.equal(abandonment.batchIndex, 8);
    assert.equal(abandonment.recordId, "352301881");
    assert.equal(abandonment.batchFile.sha256, sha(batchBytes));
    assert.equal(abandonment.batchFile.path, batchFile);
    assert.deepEqual(abandonment.expectedItemIds, [...env.ids[7]!].sort());
    assert.equal(abandonment.actualItemCount, 1);
    assert.deepEqual(abandonment.actualItemIdSamples, ["1077814899603"]);
    assert.match(abandonment.actualItemIdsSha256, /^[a-f0-9]{64}$/);
    assert.equal(abandonment.activeSha256, sha(originalBytes));
    assert.equal(abandonment.operatorConfirmed, true);
    assert.deepEqual(await readFile(batchFile), batchBytes); // evidence retained
    assert.equal((await readdir(env.audits)).some(name => name.startsWith("run-")), false);
  } finally { await cleanup(env); }
});

test("拒绝场景：每个放行条件单独失败都零写入", async () => {
  const cases: Array<{ name: string; reason: string; options?: Parameters<typeof setup>[0]; run?: Record<string, unknown> }> = [
    { name: "错误文案不同", reason: "error_text", options: { mutate: a => { a.error = "天猫导出记录行数不一致"; } } },
    { name: "resumeStage 不是 downloading", reason: "stage", options: { mutate: a => { a.resumeStage = "batch_submitted"; } } },
    { name: "stage 不是 failed", reason: "stage", options: { mutate: a => { a.stage = "downloading"; } } },
    { name: "第 k 批处于 submitting", reason: "batch_stage", options: { mutate: a => { a.batches[7].stage = "submitting"; } } },
    { name: "前面有批次处于 submitted", reason: "batch_stage", options: { mutate: a => { a.batches[2].stage = "submitted"; } } },
    { name: "第 k 批缺 recordId", reason: "batch_stage", options: { mutate: a => { delete a.batches[7].recordId; } } },
    { name: "后续批次带 traceId", reason: "later_batch_evidence", options: { k: 6, mutate: a => { a.batches[7].traceId = "t"; } } },
    { name: "后续批次处于 submitting", reason: "later_batch_evidence", options: { k: 6, mutate: a => { a.batches[7].stage = "submitting"; } } },
    { name: "后续批次带 baselineRecordIds", reason: "later_batch_evidence", options: { k: 6, mutate: a => { a.batches[6].baselineRecordIds = ["1"]; } } },
    { name: "前批 downloaded 缺文件证据", reason: "downloaded_without_file", options: { mutate: a => { delete a.batches[0].file; } } },
    { name: "已有合并文件", reason: "merged_or_imported", options: { mutate: a => { a.mergedFile = {}; } } },
    { name: "批次文件缺失", reason: "batch_file_missing", options: { file: "missing" } },
    { name: "文件内容其实与期望一致", reason: "batch_content_matches", options: { file: "match" } },
    { name: "文件解析失败", reason: "batch_file_unparseable", options: { file: "garbage" } },
    { name: "店铺身份不符", reason: "audit_identity", options: { mutate: a => { a.shopName = "天猫-别家店"; } } },
    { name: "协议不符", reason: "audit_identity", options: { mutate: a => { a.protocol = "other"; } } },
    { name: "没带 confirm", reason: "not_confirmed", run: { operatorConfirmed: false } },
    { name: "reason 过短", reason: "reason_length", run: { reason: "太短" } },
    { name: "reason 过长", reason: "reason_length", run: { reason: "长".repeat(301) } },
    { name: "helper 正在运行该店", reason: "helper_store_active", run: { helperProbe: async () => { const e = new Error("x") as Error & { reason: string }; e.reason = "helper_store_active"; throw e; } } },
  ];
  for (const item of cases) {
    const env = await setup(item.options);
    try {
      const before = await snapshot(env.audits, env.downloads);
      await assert.rejects(() => abandon(env, item.run), refusal(item.reason), item.name);
      assert.deepEqual(await snapshot(env.audits, env.downloads), before, `${item.name} 不得写入任何文件`);
    } finally { await cleanup(env); }
  }
});

test("记录文件已存在但不一致、归档目标已存在、原 M 活动清单存在都失败关闭", async () => {
  const base = `abandoned-batch-content-mismatch-tmall-tuofeng-${DATE}-${RUN}`;
  let env = await setup();
  try {
    await writeFile(path.join(env.audits, `${base}.json`), JSON.stringify({ other: true }));
    const before = await snapshot(env.audits);
    await assert.rejects(() => abandon(env), refusal("record_mismatch"));
    assert.deepEqual(await snapshot(env.audits), before);
  } finally { await cleanup(env); }
  env = await setup();
  try {
    await writeFile(path.join(env.audits, `${base}-original.json`), "squatter");
    const before = await snapshot(env.audits);
    await assert.rejects(() => abandon(env), refusal("archive_target_exists"));
    assert.deepEqual(await snapshot(env.audits), before); // no record was created either
  } finally { await cleanup(env); }
  env = await setup();
  try {
    const legacy = legacyAuditDirectories(env.audits)[0]!;
    await mkdir(legacy, { recursive: true });
    await writeFile(activeAuditPath("tmall-tuofeng", legacy), "{}");
    await assert.rejects(() => abandon(env), /原 M 节点活动清单/);
    assert.equal(await stat(env.activePath).then(() => true), true);
  } finally { await cleanup(env); }
});

test("中断续做：记录已写而活动清单未移走时可从第 2 步完成；字节变化则失败关闭", async () => {
  const base = `abandoned-batch-content-mismatch-tmall-tuofeng-${DATE}-${RUN}`;
  let env = await setup();
  try {
    const originalBytes = await readFile(env.activePath);
    await assert.rejects(() => abandon(env, { hooks: { afterRecord: async () => { throw new Error("crash"); } } }), /crash/);
    assert.equal(await stat(env.activePath).then(() => true), true);
    assert.equal(await stat(path.join(env.audits, `${base}.json`)).then(() => true), true);
    // Even if the batch file vanished afterwards, resume relies on the recorded evidence.
    const result = await abandon(env, { hooks: {} });
    assert.equal(result.stage, "abandoned");
    assert.equal(result.resumed, true);
    assert.deepEqual(await readFile(path.join(env.audits, `${base}-original.json`)), originalBytes);
    assert.equal(await stat(env.activePath).then(() => true, () => false), false);
  } finally { await cleanup(env); }
  env = await setup();
  try {
    await assert.rejects(() => abandon(env, { hooks: { afterRecord: async () => { throw new Error("crash"); } } }), /crash/);
    const audit = JSON.parse(await readFile(env.activePath, "utf8"));
    audit.updatedAt = "2026-11-17T09:41:00.000Z";
    await writeFile(env.activePath, JSON.stringify(audit));
    await assert.rejects(() => abandon(env), refusal("record_mismatch"));
    assert.equal(await stat(env.activePath).then(() => true), true);
    assert.equal(await stat(path.join(env.audits, `${base}-original.json`)).then(() => true, () => false), false);
  } finally { await cleanup(env); }
  env = await setup();
  try {
    await assert.rejects(() => abandon(env, { hooks: { beforeMove: async () => { await writeFile(env.activePath, "{\"changed\":true}"); } } }), refusal("active_changed"));
    assert.equal(await stat(path.join(env.audits, `${base}-original.json`)).then(() => true, () => false), false);
  } finally { await cleanup(env); }
});

test("dry-run 只读：前后目录快照一致且不调用 helper 探测", async () => {
  const env = await setup();
  try {
    const before = await snapshot(env.audits, env.downloads);
    let probed = false;
    const result = await abandonTmallDirectMasterBatchContentMismatch({
      storeKey: env.store.storeKey, reason: REASON, operatorConfirmed: false, dryRun: true, auditDirectory: env.audits, store: env.store,
      helperProbe: async () => { probed = true; },
    });
    assert.equal(result.stage, "dry_run_abandonable");
    assert.equal((result as any).actualItemCount, 1);
    assert.equal(probed, false);
    assert.deepEqual(await snapshot(env.audits, env.downloads), before);
  } finally { await cleanup(env); }
});

test("helper 探测：只读 /health，同店执行或无法确认都拒绝，未启动视为空闲", async () => {
  const json = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status });
  assert.equal(await probeHelperIdleForStore("tmall-tuofeng", json({ storeExecutions: [] }) as any), "helper_store_idle");
  assert.equal(await probeHelperIdleForStore("tmall-tuofeng", json({ storeExecutions: [{ workflow: "tmall", storeKey: "tmall-lili" }] }) as any), "helper_store_idle");
  await assert.rejects(() => probeHelperIdleForStore("tmall-tuofeng", json({ storeExecutions: [{ workflow: "tmall", storeKey: "tmall-tuofeng" }] }) as any), refusal("helper_store_active"));
  await assert.rejects(() => probeHelperIdleForStore("tmall-tuofeng", json({}, 500) as any), refusal("helper_probe_failed"));
  await assert.rejects(() => probeHelperIdleForStore("tmall-tuofeng", json({ ok: true }) as any), refusal("helper_probe_failed"));
  await assert.rejects(() => probeHelperIdleForStore("tmall-tuofeng", (async () => { throw new Error("timeout"); }) as any), refusal("helper_probe_failed"));
  const refused = async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }); };
  assert.equal(await probeHelperIdleForStore("tmall-tuofeng", refused as any), "helper_not_running");
});

test("与原模块规则一致的钉子：路径、命名、错误文案、ID 集合比较与旧清单目录", async () => {
  const source = await readFile(new URL("../tools/tmall-direct-product-master-export.ts", import.meta.url), "utf8");
  for (const snippet of [
    'value.replace(/[<>:"/\\\\|?*\\u0000-\\u001f]/g, "_").replace(/\\s+/g, "-").slice(0, 80)',
    "path.join(directory, `active-${safeSegment(storeKey)}.json`)",
    "`${safeSegment(store.shopName)}-出售中-MTOP-${snapshotDate}-${safeSegment(audit.runId)}-batch-${saved.index}.xlsx`",
    `throw new Error("${TMALL_DIRECT_MASTER_CONTENT_MISMATCH_ERROR}")`,
    "evidence.uniqueProductCount !== expected.length",
    "JSON.stringify(actual) !== JSON.stringify(expected)",
    'String((row.raw as JsonRecord)["商品ID"] ?? "").trim()',
    "left.localeCompare(right, \"en\")",
    'path.join(tmallAutomationProjectRoot, "outputs", "tmall-direct-product-master-export")',
    'path.join(tmallAutomationProjectRoot, "outputs", "tmall-pagewise-product-master-export")',
    'path.join(tmallAutomationProjectRoot, "outputs", "tmall-product-master-export")',
    "[pagewiseAuditDirectory, productManagerAuditDirectory]",
    'saved.stage === "downloading" && await stat(targetPath)',
  ]) assert.ok(source.includes(snippet), `原模块不再包含：${snippet}`);
  // Behaviour pins on the mirrored helpers.
  assert.equal(safeSegment('a<b>:"c/d\\e|f?g*h i'), "a_b___c_d_e_f_g_h-i");
  assert.equal(safeSegment("x".repeat(100)).length, 80);
  assert.equal(activeAuditPath("tmall-tuofeng", "D:/x"), path.join("D:/x", "active-tmall-tuofeng.json"));
  const outputs = path.join("D:", "p", "outputs");
  assert.deepEqual(legacyAuditDirectories(path.join(outputs, "tmall-direct-product-master-export")),
    [path.join(outputs, "tmall-pagewise-product-master-export"), path.join(outputs, "tmall-product-master-export")]);
  const store = { shopName: "天猫-志高拓丰专卖店", browser: { downloadDir: "D:\\x" } } as TmallStore;
  assert.equal(path.basename(directBatchFilePath(store, DATE, RUN, 8)), `天猫-志高拓丰专卖店-出售中-MTOP-${DATE}-${RUN}-batch-8.xlsx`);
});

test("新模块与 CLI 不含 import.meta，且 tools/、lib/ 下没有其他文件 import 它们", async () => {
  const modules = ["tools/tmall-direct-master-abandon.ts", "tools/tmall-direct-master-admin.ts"];
  for (const file of modules) {
    const text = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.equal(/import\s*\.\s*meta/.test(text), false, `${file} 含 import.meta`);
  }
  const offenders: string[] = [];
  const walk = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { await walk(full); continue; }
      if (!/\.(ts|tsx|mjs|js|cjs|ps1|json)$/.test(entry.name)) continue;
      const rel = path.relative(process.cwd(), full).replaceAll("\\", "/");
      if (modules.includes(rel)) continue;
      if (/tmall-direct-master-(abandon|admin)/.test(await readFile(full, "utf8"))) offenders.push(rel);
    }
  };
  await walk(path.join(process.cwd(), "tools"));
  await walk(path.join(process.cwd(), "lib"));
  assert.deepEqual(offenders, []);
});
