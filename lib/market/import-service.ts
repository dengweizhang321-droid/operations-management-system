import { createHash, randomUUID } from "node:crypto";
import {
  ensureMarketSchema,
  findMarketBatchByHash,
  getMarketDatabase,
  saveMarketImport,
} from "@/lib/market/database";
import { parseMarketRows } from "@/lib/market/parser";
import { cacheMarketImages } from "@/lib/market/image-cache";
import { matchImportedMarketBrands, refreshSystemMarketBrandSeeds } from "@/lib/market/brand-seeds";
import { refreshMarketSkuGmvTotals } from "@/lib/market/gmv-total";
import { refreshMarketMasterIdentities } from "@/lib/market/master-identity";

export { parseMarketRows } from "@/lib/market/parser";

async function cacheImagesAfterImport(db: ReturnType<typeof getMarketDatabase>, batchId: string) {
  try {
    return await cacheMarketImages({ db, batchId, limit: 4 });
  } catch {
    return { processed: 0, cachedThisRun: 0, failedThisRun: 0, total: 0, cached: 0, failed: 0, pending: 0, maintenanceFailed: true };
  }
}

async function refreshBrandSeedsAfterImport(db: ReturnType<typeof getMarketDatabase>, actorEmail: string) {
  try {
    return await refreshSystemMarketBrandSeeds(db, actorEmail);
  } catch {
    return { discovered: 0, inserted: 0, refreshed: 0, disabled: 0, manualPreserved: 0, maintenanceFailed: true };
  }
}

async function repairLegacyDerivedCaches(db: ReturnType<typeof getMarketDatabase>) {
  await Promise.allSettled([refreshMarketSkuGmvTotals(db), refreshMarketMasterIdentities(db)]);
}

export async function importMarketFile(input: {
  bytes: Uint8Array;
  fileName: string;
  fileSizeBytes: number;
  sourceType: string;
  defaultStartDate: string;
  defaultEndDate: string;
  defaultCategory?: string;
  defaultScope?: string;
  defaultPriceBandFilter?: string;
  actorEmail?: string;
}) {
  const db = getMarketDatabase();
  await ensureMarketSchema(db);
  const fileHash = createHash("sha256").update(input.bytes).digest("hex");
  const existing = await findMarketBatchByHash(db, fileHash);
  if (existing?.status === "completed") {
    await repairLegacyDerivedCaches(db);
    const imageCache = await cacheImagesAfterImport(db, existing.id);
    return { ok: true, status: "duplicate" as const, message: "该文件已经导入，已继续检查商品图片缓存", batch: existing, imageCache };
  }
  if (existing?.status === "processing" && Date.now() - Date.parse(existing.createdAt) < 30 * 60 * 1000) {
    return { ok: true, status: "processing" as const, message: "该文件正在导入，请稍后刷新", batch: existing };
  }
  if (existing) {
    await db.batch([
      db.prepare("DELETE FROM market_import_staging_rows WHERE batch_id=?").bind(existing.id),
      db.prepare("DELETE FROM market_import_range_claims WHERE batch_id=?").bind(existing.id),
      db.prepare("DELETE FROM market_import_batches WHERE id=? AND status<>'completed'").bind(existing.id),
    ]);
  }
  const parsed = parseMarketRows(input);
  const brandMatch = await matchImportedMarketBrands(db, parsed.rows);
  const batch = await saveMarketImport({
    db,
    batchId: `market-${randomUUID()}`,
    sourceType: input.sourceType,
    fileName: input.fileName,
    fileSizeBytes: input.fileSizeBytes,
    fileHash,
    sheetName: parsed.sheetName,
    rows: brandMatch.rows,
    warnings: parsed.warnings,
  });
  const [imageCache, brandSeedRefresh] = await Promise.all([
    cacheImagesAfterImport(db, batch.id),
    refreshBrandSeedsAfterImport(db, input.actorEmail?.trim() || "market-import"),
  ]);
  return {
    ok: true,
    status: "imported" as const,
    message: `成功导入 ${batch.rowCount} 条市场商品数据，系统品牌种子自动匹配 ${brandMatch.summary.matched} 条`,
    batch,
    imageCache,
    brandSeedRefresh,
    brandMatch: brandMatch.summary,
  };
}
