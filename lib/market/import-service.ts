import { createHash, randomUUID } from "node:crypto";
import {
  ensureMarketSchema,
  findMarketBatchByHash,
  getMarketDatabase,
  saveMarketImport,
} from "@/lib/market/database";
import { parseMarketRows } from "@/lib/market/parser";

export { parseMarketRows } from "@/lib/market/parser";

export async function importMarketFile(input: {
  bytes: Uint8Array;
  fileName: string;
  fileSizeBytes: number;
  sourceType: string;
  defaultStartDate: string;
  defaultEndDate: string;
  defaultCategory?: string;
  defaultScope?: string;
}) {
  const db = getMarketDatabase();
  await ensureMarketSchema(db);
  const fileHash = createHash("sha256").update(input.bytes).digest("hex");
  const existing = await findMarketBatchByHash(db, fileHash);
  if (existing?.status === "completed") {
    return { ok: true, status: "duplicate" as const, message: "该文件已经导入，无需重复操作", batch: existing };
  }
  if (existing?.status === "processing" && Date.now() - Date.parse(existing.createdAt) < 30 * 60 * 1000) {
    return { ok: true, status: "processing" as const, message: "该文件正在导入，请稍后刷新", batch: existing };
  }
  if (existing) {
    await db.prepare("DELETE FROM market_import_batches WHERE id = ? AND status <> 'completed'").bind(existing.id).run();
  }
  const parsed = parseMarketRows(input);
  const batch = await saveMarketImport({
    db,
    batchId: `market-${randomUUID()}`,
    sourceType: input.sourceType,
    fileName: input.fileName,
    fileSizeBytes: input.fileSizeBytes,
    fileHash,
    sheetName: parsed.sheetName,
    rows: parsed.rows,
    warnings: parsed.warnings,
  });
  return { ok: true, status: "imported" as const, message: `成功导入 ${batch.rowCount} 条市场商品数据`, batch };
}
