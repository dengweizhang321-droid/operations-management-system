// Synthetic gateway seam. The real pipeline, download runners, parsers,
// checkpoints and five exact batch verification paths run unchanged.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createXlsxWorkbookBytes } from "../../lib/imports/xlsx-write";
import { writeJsonAtomic } from "../../lib/jackyun/json-file";
import { importRecoveryScope } from "../../lib/jackyun/publication-baseline";
import { jackyunModuleOrder, type JackyunModule } from "../../lib/jackyun/post-download";
import { jackyunExportFirstPolicyVersion, jackyunExportOrder } from "../../lib/jackyun/run-contract";
import type { ExportFirstDependencies } from "../../tools/jackyun-export-first-pipeline";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const counts = { products: 5000, inventory: 20000, inventory_age: 4000, sales: 1, combos: 1000 };
function workbook(moduleKey: JackyunModule, salesDay: string) {
  if (moduleKey === "sales") return createXlsxWorkbookBytes([{ name: "合成销售", rows: [
    ["网店订单号", "销售渠道", "发货仓库", "货品编号", "货品名称", "数量", "下单时间", "发货时间", "货品成本", "分摊后单价", "分摊后金额", "费用分摊", "毛利"],
    ["SYNTHETIC-1", "京东-志高切肉机旗舰店（志高迈德豪）", "主仓", "SKU-0", "合成货品", 1, `${salesDay} 09:00:00`, `${salesDay} 10:00:00`, 0, 100, 100, 5, 0],
  ] }]);
  const rows = Array.from({ length: counts[moduleKey] }, (_, i) => moduleKey === "inventory" ? [`SKU-${i}`, "合成货品", "标准", "台", "主仓", 10, 2]
    : moduleKey === "inventory_age" ? ["主仓", `SKU-${i}`, "合成货品", 2, 7]
      : moduleKey === "products" ? [`SKU-${i}`, "合成货品", 10, "台"] : [`COMBO-${i}`, "合成组合装"]);
  const headers = { inventory: ["货品编号", "货品名称", "规格", "单位", "仓库", "固定成本价", "库存数量"],
    inventory_age: ["仓库", "货品编号", "货品名称", "库存数量", "库龄(天)"],
    products: ["货品编号", "货品名称", "固定成本价", "基础单位"], combos: ["货品编号", "货品名称"] };
  const sheets = [{ name: "数据", rows: [headers[moduleKey], ...rows] }];
  if (moduleKey === "combos") sheets.push({ name: "子件", rows: [["母件编号", "编号", "名称", "数量"],
    ...rows.flatMap((row, index) => [[row[0], `SKU-${index}`, "合成子件", 1], [row[0], `SKU-B-${index}`, "另一子件", 2]])] });
  return createXlsxWorkbookBytes(sheets);
}

type Batch = { id: string; status: string; sourceKey: string; rowCount: number; ownedRowCount: number; excludedCount: number;
  isCurrent: boolean; snapshotDate: string | null; totals: { rawFileHash: string; contentHash: string; systemCost?: { sourceBatchId: string } } };
type Upload = { id: string; module: JackyunModule; fileName: string; size: number; fingerprint: string; received: Set<number> };
export async function unifiedFixture(root: string, options: { captureDate?: string; asOfDate?: string; salesStartDate?: string; eventStart?: string } = {}) {
  const captureDate = options.captureDate ?? "2026-10-13", asOfDate = options.asOfDate ?? "2026-10-12", salesStartDate = options.salesStartDate ?? "2026-08-29";
  const eventStart = Date.parse(options.eventStart ?? "2026-10-13T00:00:00.000Z");
  const at = (seconds: number) => new Date(eventStart + seconds * (options.eventStart ? 10 : 1000)).toISOString();
  const policy = JSON.parse(await readFile(path.resolve("config/sales-import-policy.json"), "utf8")) as { version: string };
  const batches = new Map<JackyunModule, Batch>(), uploads = new Map<string, Upload>();
  const completes = Object.fromEntries(jackyunModuleOrder.map(m => [m, 0])) as Record<JackyunModule, number>;
  const finishCounts = { products: 0, inventory: 0, inventory_age: 0, sales: 0, combos: 0 };
  const verified = new Set<JackyunModule>(); let failureModule: JackyunModule | undefined, exports = 0;
  const downloads = path.join(root, "downloads");
  await mkdir(path.join(root, "config"), { recursive: true });
  // These are public rule files, copied into the synthetic mutable root used
  // by the real bundled helper. No credentials or production state are copied.
  for (const name of ["sales-import-policy.json", "inventory-warehouse-mapping.json"]) {
    await writeFile(path.join(root, "config", name), await readFile(path.resolve("config", name)));
  }
  await writeJsonAtomic(path.join(root, "config/jackyun-export-first-policy.json"), {
    version: jackyunExportFirstPolicyVersion, browser: { downloadDirectory: downloads, allowedDownloadHosts: [], controller: { profileDirectory: path.join(root, "profile") } },
  });
  const request: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    assert.equal(url.origin, "http://localhost:3000", "synthetic gateway forbids all real network");
    if (url.pathname === "/api/sales/data-health") return Response.json({ ok: true });
    if (url.pathname === "/api/imports/recovery") {
      const moduleKey = url.searchParams.get("module") as JackyunModule;
      const scope = importRecoveryScope(moduleKey, { runDate: captureDate, asOfDate, salesStartDate });
      if (url.searchParams.get("recovery") === "scope") return Response.json({ ok: true, version: "import-recovery-query-v1", scope, status: "ready", stateToken: "initial", rulesDigest: "9".repeat(64) });
      const batch = batches.get(moduleKey);
      const upload = [...uploads.values()].find(u => u.module === moduleKey && u.fileName === url.searchParams.get("fileName")
        && u.size === Number(url.searchParams.get("fileSizeBytes")) && (url.searchParams.get("uploadId") ?? u.id) === u.id);
      assert.ok(upload, "recovery must identify the original durable upload");
      const storedFingerprint = moduleKey === "inventory" || moduleKey === "inventory_age"
        ? `inventory:${moduleKey === "inventory" ? "stock" : "age"}:${captureDate}:${upload.fingerprint}`
        : moduleKey === "products" || moduleKey === "combos" ? `erp:${moduleKey}:${upload.fingerprint}` : upload.fingerprint;
      assert.equal(url.searchParams.get("fingerprint"), storedFingerprint);
      assert.equal(url.searchParams.get("rawFileHash"), /:([a-f0-9]{64}):(initial|[a-f0-9]{64})$/.exec(upload.fingerprint)?.[1]);
      return Response.json({ ok: true, version: "import-recovery-query-v1", scope, status: batch ? "committed_current" : "uncommitted_upload", batch, uploadId: upload.id });
    }
    if (url.pathname === "/api/imports/recovery/finish") {
      const query = new URLSearchParams(JSON.parse(String(init?.body)).query);
      const moduleKey = query.get("module") as JackyunModule; finishCounts[moduleKey]++;
      return Response.json({ ok: true, status: "duplicate", batch: batches.get(moduleKey) });
    }
    if (url.pathname.endsWith("/chunks")) {
      if (init?.method === "PUT") {
        const headers = new Headers(init.headers), upload = uploads.get(headers.get("x-upload-id")!);
        assert.ok(upload); upload.received.add(Number(headers.get("x-chunk-index"))); return Response.json({ ok: true });
      }
      const body = JSON.parse(String(init?.body));
      if (body.action === "init") {
        const moduleKey: JackyunModule = url.pathname.includes("/sales/") ? "sales" : url.pathname.includes("/inventory/") ? "inventory" : body.source;
        const prior = [...uploads.values()].find(u => u.module === moduleKey && u.fingerprint === body.fingerprint);
        const upload: Upload = prior ?? { id: randomUUID(), module: moduleKey, fileName: body.fileName, size: body.fileSizeBytes, fingerprint: body.fingerprint, received: new Set() };
        uploads.set(upload.id, upload); return Response.json({ ok: true, upload: { id: upload.id, receivedChunkIndexes: [...upload.received] } });
      }
      assert.equal(body.action, "complete"); const upload = uploads.get(body.uploadId); assert.ok(upload);
      const moduleKey = upload.module; completes[moduleKey]++;
      const rawHash = /:([a-f0-9]{64}):(initial|[a-f0-9]{64})$/.exec(upload.fingerprint)?.[1]; assert.ok(rawHash);
      const count = moduleKey === "combos" ? 2000 : counts[moduleKey];
      const batch: Batch = { id: `synthetic-${moduleKey}`, status: "completed", sourceKey: moduleKey === "inventory" ? "inventory_stock" : moduleKey,
        rowCount: count, ownedRowCount: count, excludedCount: 0, isCurrent: true,
        snapshotDate: moduleKey === "inventory" || moduleKey === "inventory_age" ? captureDate : null,
        totals: { rawFileHash: rawHash, contentHash: "d".repeat(64), ...(moduleKey === "sales" ? { systemCost: { sourceBatchId: batches.get("inventory")!.id } } : {}) } };
      batches.set(moduleKey, batch);
      if (moduleKey === failureModule) { failureModule = undefined; throw new Error(`synthetic ${moduleKey} response lost after commit`); }
      return Response.json({ ok: true, status: "imported", batch });
    }
    if (url.pathname === "/api/imports/sales/verify") {
      if (url.searchParams.get("policyOnly") === "1") return Response.json({ policyVersion: policy.version });
      if (!url.searchParams.has("batchId")) return Response.json({ shops: [] });
      const batch = batches.get("sales"); assert.equal(url.searchParams.get("batchId"), batch?.id); verified.add("sales");
      return Response.json({ policyVersion: policy.version, period: { startDate: salesStartDate, endDate: asOfDate, endExclusive: captureDate }, batch,
        stats: { rowCount: 1, minShipTime: `${asOfDate} 10:00:00`, maxShipTime: `${asOfDate} 10:00:00`, excludedWarehouseRows: 0, rowsNotOwnedByBatch: 0 }, nonWhitelistChannels: [] });
    }
    if (url.pathname === "/api/imports/erp" || url.pathname === "/api/imports/inventory") {
      const moduleKey: JackyunModule = url.pathname.endsWith("inventory") ? "inventory" : url.searchParams.get("source") as JackyunModule;
      const batch = batches.get(moduleKey);
      if (url.searchParams.has("batchId")) { assert.equal(url.searchParams.get("batchId"), batch?.id); verified.add(moduleKey); }
      return Response.json({ items: batch ? [batch] : moduleKey === "combos" && !url.searchParams.has("batchId")
        ? [{ id: "synthetic-combo-baseline", status: "completed", rowCount: 2000 }] : [] });
    }
    throw new Error(`unexpected synthetic backend route ${url.pathname}`);
  };
  const deps: ExportFirstDependencies = { root, lockDirectory: path.join(root, ".runtime/test.lock"),
    now: () => new Date(at(0)), profileReady: async () => true, request,
    recoveryRequest: { version: "jackyun-recovery-control-v1", kind: "new" },
    runApi: async options => {
      exports++;
      for (const moduleKey of jackyunExportOrder) {
        await options.beforeModule?.(moduleKey);
        const bytes = workbook(moduleKey, asOfDate), file = path.join(downloads, "jackyun", options.runId, moduleKey, "synthetic.xlsx");
        await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, bytes);
        const event = path.join(options.eventRoot, options.runId, `${String(jackyunModuleOrder.indexOf(moduleKey) + 1).padStart(2, "0")}-${moduleKey}.json`);
        const serverDate = new Date(Math.floor(Date.parse(at(5)) / 1000) * 1000).toISOString();
        const observedAt = new Date(Date.parse(at(6)) + Date.parse(serverDate) - Date.parse(at(4.099))).toISOString();
        await writeJsonAtomic(event, { schemaVersion: 2, runId: options.runId, policyVersion: jackyunExportFirstPolicyVersion, module: moduleKey,
          filePath: file, navigationIntentAt: at(1), queryIntentAt: at(2), tableStableAt: at(4), exportIntentAt: at(5), downloadEventAt: at(6), expectedSourceRows: counts[moduleKey],
          fieldChecks: moduleKey === "products" ? [{ field: "模式", value: "规格模式(SKU)", verifiedAt: at(2) }]
            : moduleKey === "sales" ? [{ field: "统计时间类型", value: "发货时间", verifiedAt: at(2) }, { field: "日期区间", value: `${salesStartDate} 00:00:00 至 ${asOfDate} 23:59:59`, verifiedAt: at(2) }] : [],
          snapshotEvidence: moduleKey === "inventory" || moduleKey === "inventory_age" ? { version: 1, module: moduleKey, runId: options.runId, source: "current_query", targetDate: captureDate,
            queryIntentAt: at(2), queryRefreshSource: "module_network_request", queryRefreshCompletedAt: at(3), tableStableAt: at(4) } : undefined,
          downloadProvenance: { runId: options.runId, module: moduleKey, policyVersion: jackyunExportFirstPolicyVersion, method: "browser_event", downloadId: `synthetic-${moduleKey}`,
            originalFileName: "synthetic.xlsx", completedAt: at(6), sha256: hash(bytes), bytes: bytes.length, sourceUrlHash: "a".repeat(64) },
          evidence: { controller: "authenticated_http_api", exportTransport: "session_api_v1", taskQuerySource: "direct_http_api", directPayloadSha256: "b".repeat(64),
            apiPreflightStartedAt: at(1), apiQueryCompletedAt: at(4), apiQuerySha256: "a".repeat(64), permissionSha256: "b".repeat(64), templateSha256: "c".repeat(64),
            serverClock: { requestStartedAt: at(3.891), receivedAt: at(4.099), serverDate },
            exportTaskBinding: { version: 1, taskId: `sys-${100 + jackyunModuleOrder.indexOf(moduleKey)}`, module: moduleKey, label: "synthetic", sourceRows: counts[moduleKey], sourceUrlHash: "a".repeat(64),
              createdAt: serverDate, observedAt } } });
        await options.afterModule?.(moduleKey);
      }
      return { status: "exported", runId: options.runId, transport: "session_api_v1", statePath: "synthetic-gateway" };
    } };
  return { deps, request, batches, completes, finishCounts, verified, failAfterCommit: (moduleKey: JackyunModule) => { failureModule = moduleKey; }, exportCount: () => exports };
}
