import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { readJsonDurableOr, writeJsonDurable } from "../lib/jackyun/json-file";
import { withJackyunRunLock } from "../lib/jackyun/run-lock";
import { parseTmallWarehouseWorkbook } from "../lib/inventory/tmall-warehouse-workbook";
import { tmallWarehouseApiPath, tmallWarehouseSource, tmallWarehouseProtocol, tmallWarehouseMaxBytes, warehouseConfig, warehouseDay, warehouseHash, type WarehouseConfig } from "../lib/tmall-warehouse/policy";
import { exportTmallWarehouse, type WarehouseDownload } from "./tmall-warehouse-export";

type Receipt = { batchId: string; referenceBatchId?: string; owner: string; snapshotDate: string; rowCount: number; rawFileHash: string; contentHash: string; status: string };
export type WarehousePlan = { protocol: string; runId: string; executionId: string; configHash: string; owner: string; snapshotDate: string; expectedScopeRevision: number; stage: "planned" | "export_intent" | "downloaded" | "import_intent" | "executed" | "completed"; download?: WarehouseDownload; expectedRowCount?: number; receipt?: Receipt };
type Dependencies = { root: string; executionId: string; config?: WarehouseConfig; request?: typeof fetch };
function files(root: string) { return { directory: path.join(root, "outputs", "tmall-warehouse"), active: path.join(root, "outputs", "tmall-warehouse", "active.json"), lock: path.join(root, "outputs", "tmall-warehouse", "pipeline.lock") }; }
async function configFor(o: Dependencies) { return warehouseConfig(o.config ?? JSON.parse(await readFile(path.join(o.root, ".runtime", "tmall-warehouse.json"), "utf8").catch(() => { throw new Error("TMALL_WAREHOUSE_CONFIGURATION_REQUIRED_MANUAL_ACTION"); })), o.root); }
async function owned(o: Dependencies, runId: string) {
  const plan = await readJsonDurableOr<WarehousePlan | null>(files(o.root).active, null);
  if (!plan || plan.protocol !== tmallWarehouseProtocol || plan.runId !== runId || plan.executionId !== o.executionId) throw new Error("TMALL_WAREHOUSE_EXECUTION_OWNER_MISMATCH");
  if (warehouseHash(JSON.stringify(await configFor(o))) !== plan.configHash) throw new Error("TMALL_WAREHOUSE_POLICY_CHANGED_MANUAL_ACTION");
  return plan;
}
async function save(o: Dependencies, plan: WarehousePlan) {
  await owned(o, plan.runId);
  await writeJsonDurable(files(o.root).active, plan);
  await writeJsonDurable(path.join(files(o.root).directory, `${plan.runId}.json`), plan);
}
export function publicWarehousePlan(p: WarehousePlan) { return { ok: true, runId: p.runId, stage: p.stage, owner: p.owner, snapshotDate: p.snapshotDate, ...(p.receipt ? { batchId: p.receipt.batchId, rowCount: p.receipt.rowCount, status: p.receipt.status } : {}) }; }
export async function planTmallWarehouse(o: Dependencies & { now?: Date }) {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(o.executionId)) throw new Error("TMALL_WAREHOUSE_INVALID_EXECUTION_ID");
  const c = await configFor(o); await mkdir(files(o.root).directory, { recursive: true });
  return withJackyunRunLock({ runId: `tmw-${warehouseHash(o.executionId).slice(0,20)}`, purpose: "tmall-warehouse-plan", lockDirectory: files(o.root).lock }, async lock => {
    const old = await readJsonDurableOr<WarehousePlan | null>(files(o.root).active, null);
    if (old?.executionId === o.executionId) throw new Error("TMALL_WAREHOUSE_EXECUTION_REPLAY_MANUAL_ACTION");
    if (old && old.stage !== "completed") throw new Error("TMALL_WAREHOUSE_PREVIOUS_RUN_UNRESOLVED_MANUAL_ACTION");
    const options = await api(o, c, new URLSearchParams({ operation: "options", owner: c.owner }));
    const scopes = options.scopeRevisions as Record<string, unknown>;
    if (!scopes || typeof scopes !== "object" || Array.isArray(scopes) || options.truncated === true) throw new Error("TMALL_WAREHOUSE_SCOPE_REVISION_UNAVAILABLE");
    const expectedScopeRevision = Object.hasOwn(scopes, c.owner) ? scopes[c.owner] : 0;
    if (!Number.isSafeInteger(expectedScopeRevision) || Number(expectedScopeRevision) < 0) throw new Error("TMALL_WAREHOUSE_SCOPE_REVISION_INVALID");
    const p: WarehousePlan = { protocol: tmallWarehouseProtocol, runId: `tmw-${randomUUID()}`, executionId: o.executionId, configHash: warehouseHash(JSON.stringify(c)), owner: c.owner, snapshotDate: warehouseDay(o.now), expectedScopeRevision: Number(expectedScopeRevision), stage: "planned" };
    await lock.assertOwned();
    // Active first: interruption cannot leave an unindexed business effect.
    await writeJsonDurable(files(o.root).active, p);
    await writeJsonDurable(path.join(files(o.root).directory, `${p.runId}.json`), p, true);
    return p;
  });
}
async function api(o: Dependencies, config: WarehouseConfig, query: URLSearchParams, body?: unknown): Promise<Record<string, unknown>> {
  let response: Response;
  try { response = await (o.request ?? fetch)(`${config.baseUrl}${tmallWarehouseApiPath}?${query}`, { method: body ? "POST" : "GET", redirect: "manual", signal: AbortSignal.timeout(120_000), headers: { accept: "application/json", ...(body ? { "content-type": "application/json", origin: config.baseUrl } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); }
  catch { throw new Error(body ? "TMALL_WAREHOUSE_IMPORT_RESULT_UNKNOWN_MANUAL_ACTION" : "TMALL_WAREHOUSE_BATCH_READ_UNAVAILABLE"); }
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "TMALL_WAREHOUSE_API_ACCESS_DENIED_MANUAL_ACTION" : body ? "TMALL_WAREHOUSE_IMPORT_RESULT_UNKNOWN_MANUAL_ACTION" : "TMALL_WAREHOUSE_BATCH_READ_REJECTED");
  const reader = response.body?.getReader(); if (!reader) throw new Error("TMALL_WAREHOUSE_API_RESPONSE_INVALID_MANUAL_ACTION");
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; length += part.value.byteLength; if (length > 1024 * 1024) { await reader.cancel(); throw new Error(); } chunks.push(part.value); }
    const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (result.success !== true || !result.data || typeof result.data !== "object" || Array.isArray(result.data)) throw new Error();
    return result.data;
  } catch { throw new Error(body ? "TMALL_WAREHOUSE_IMPORT_RESULT_UNKNOWN_MANUAL_ACTION" : "TMALL_WAREHOUSE_API_RESPONSE_INVALID_MANUAL_ACTION"); }
  finally { reader.releaseLock(); }
}
async function signedBytes(o: Dependencies, p: WarehousePlan) {
  const d = p.download;
  if (!d || d.owner !== p.owner || d.snapshotDate !== p.snapshotDate || !Number.isFinite(Date.parse(d.collectedAt)) || warehouseDay(new Date(d.collectedAt)) !== p.snapshotDate) throw new Error("TMALL_WAREHOUSE_RECEIPT_IDENTITY_REJECTED");
  const expected = path.join(files(o.root).directory, "downloads", p.runId, "source.xlsx");
  if (path.resolve(d.filePath) !== expected || await realpath(expected) !== expected) throw new Error("TMALL_WAREHOUSE_DOWNLOAD_PATH_REJECTED");
  const info = await lstat(expected);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size !== d.bytes || info.size > tmallWarehouseMaxBytes) throw new Error("TMALL_WAREHOUSE_DOWNLOAD_CHANGED");
  const bytes = await readFile(expected);
  if (warehouseHash(bytes) !== d.rawFileHash) throw new Error("TMALL_WAREHOUSE_DOWNLOAD_CHANGED");
  return bytes;
}
export async function runTmallWarehouse(ref: Pick<WarehousePlan, "runId">, o: Dependencies & { exporter?: typeof exportTmallWarehouse }) {
  return withJackyunRunLock({ runId: ref.runId, purpose: "tmall-warehouse-run", lockDirectory: files(o.root).lock }, async lock => {
    const p = await owned(o, ref.runId), config = await configFor(o);
    if (p.stage !== "planned") throw new Error("TMALL_WAREHOUSE_REPLAY_REQUIRES_MANUAL_ACTION");
    if (warehouseDay() !== p.snapshotDate) throw new Error("TMALL_WAREHOUSE_SNAPSHOT_DAY_CHANGED_MANUAL_ACTION");
    const assertOwner = async () => { await lock.assertOwned(); await owned(o, p.runId); };
    p.download = await (o.exporter ?? exportTmallWarehouse)({ root: o.root, runId: p.runId, config, assertOwner, beforeClick: async count => { await assertOwner(); p.expectedRowCount = count; p.stage = "export_intent"; await save(o, p); } });
    p.stage = "downloaded"; await save(o, p);
    const bytes = await signedBytes(o, p), parsed = parseTmallWarehouseWorkbook(bytes);
    if (parsed.sheetName !== "导出数据" || parsed.rows.length !== p.expectedRowCount || parsed.rows.length !== p.download.expectedRowCount || parsed.sourceDate && parsed.sourceDate !== p.snapshotDate || parsed.rows.some(row => [row.availableQuantity, row.onHandQuantity, row.goodAvailableQuantity, row.goodOccupiedQuantity, row.salesOccupiedQuantity, row.defectiveQuantity, row.purchaseInTransitQuantity, row.transferInTransitQuantity].some(n => n === null || n === undefined))) throw new Error("TMALL_WAREHOUSE_COMPLETE_ROW_COUNT_OR_DATE_REJECTED");
    // Provenance remains in the private source manifest; the API receives only
    // its explicit import contract. Supplier fields never authorize the owner.
    const body = { owner: p.owner, snapshotDate: p.snapshotDate, expectedScopeRevision: p.expectedScopeRevision, fileName: p.download.fileName, rawFileHash: p.download.rawFileHash, rows: parsed.rows,
      collectedAt: p.download.collectedAt, sourceAsOf: "", sourceUrl: tmallWarehouseSource,
      collectorEvidence: { protocol: p.protocol, runId: p.runId, executionId: p.executionId, identity: "authenticated-account-panel", expectedRowCount: String(p.expectedRowCount), sheetName: parsed.sheetName } };
    if (Buffer.byteLength(JSON.stringify(body)) > 24 * 1024 * 1024) throw new Error("TMALL_WAREHOUSE_IMPORT_TOO_LARGE");
    await assertOwner(); p.stage = "import_intent"; await save(o, p);
    const result = await api(o, config, new URLSearchParams(), body);
    const batchId = result.batchId ?? result.id;
    if (typeof batchId !== "string" || !batchId || result.owner !== p.owner || result.snapshotDate !== p.snapshotDate || result.rowCount !== parsed.rows.length || result.rawFileHash !== p.download.rawFileHash || typeof result.contentHash !== "string" || !/^[a-f0-9]{64}$/.test(result.contentHash) || !["imported", "duplicate", "completed"].includes(String(result.status))) throw new Error("TMALL_WAREHOUSE_IMPORT_RECEIPT_UNKNOWN_MANUAL_ACTION");
    if (result.status === "duplicate" && (typeof result.referenceBatchId !== "string" || !result.referenceBatchId)) throw new Error("TMALL_WAREHOUSE_DUPLICATE_REFERENCE_MISSING_MANUAL_ACTION");
    p.receipt = { batchId, ...(typeof result.referenceBatchId === "string" ? { referenceBatchId: result.referenceBatchId } : {}), owner: p.owner, snapshotDate: p.snapshotDate, rowCount: parsed.rows.length, rawFileHash: p.download.rawFileHash, contentHash: result.contentHash, status: String(result.status) };
    p.stage = "executed"; await save(o, p); return publicWarehousePlan(p);
  });
}
export async function verifyTmallWarehouse(ref: Pick<WarehousePlan, "runId">, o: Dependencies) {
  return withJackyunRunLock({ runId: ref.runId, purpose: "tmall-warehouse-verify", lockDirectory: files(o.root).lock }, async lock => {
    const p = await owned(o, ref.runId), config = await configFor(o), r = p.receipt;
    if (!["executed", "completed"].includes(p.stage) || !r) throw new Error("TMALL_WAREHOUSE_VERIFY_STAGE_REJECTED");
    const parsed = parseTmallWarehouseWorkbook(await signedBytes(o, p));
    if (parsed.rows.length !== r.rowCount) throw new Error("TMALL_WAREHOUSE_VERIFY_ROW_COUNT_REJECTED");
    const data = await api(o, config, new URLSearchParams({ operation: "batches", batchId: r.batchId, owner: p.owner }));
    const items = data.items as Record<string, unknown>[];
    if (!Array.isArray(items) || items.length !== 1) throw new Error("TMALL_WAREHOUSE_EXACT_BATCH_NOT_FOUND");
    const b = items[0];
    if (b.id !== r.batchId || b.owner !== p.owner || b.snapshotDate !== p.snapshotDate || b.rowCount !== r.rowCount || b.rawFileHash !== r.rawFileHash || b.contentHash !== r.contentHash || (r.status === "duplicate" ? b.status !== "duplicate" || b.referenceBatchId !== r.referenceBatchId : !["completed", "imported"].includes(String(b.status)) || b.isCurrent !== true)) throw new Error("TMALL_WAREHOUSE_BATCH_VERIFICATION_FAILED");
    if (r.status === "duplicate") {
      const reference = await api(o, config, new URLSearchParams({ operation: "batches", batchId: r.referenceBatchId!, owner: p.owner }));
      const items = reference.items as Record<string, unknown>[];
      if (!Array.isArray(items) || items.length !== 1 || items[0].id !== r.referenceBatchId || items[0].owner !== p.owner || items[0].snapshotDate !== p.snapshotDate || items[0].rowCount !== r.rowCount || items[0].contentHash !== r.contentHash || items[0].status !== "completed" || items[0].isCurrent !== true) throw new Error("TMALL_WAREHOUSE_DUPLICATE_REFERENCE_NOT_CURRENT");
    }
    await lock.assertOwned(); p.stage = "completed"; await save(o, p); return publicWarehousePlan(p);
  });
}
