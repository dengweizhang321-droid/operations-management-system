import type { AppPrincipal } from "@/lib/auth/authorization";
import type { MarketDatabase } from "@/lib/market/database";
import { ensureMarketSchemaCore, officialPriceBandSql } from "@/lib/market/schema-core";

export type MarketPrincipal = Pick<AppPrincipal, "email" | "role">;
export type MarketDimension = "SKU" | "SPU";
export type MappingKind = "subcategory" | "brand_alias" | "operation_mode";
type MarketOverviewFilters = {
  query?: string;
  categories?: string[];
  rankingDimensions?: string[];
  operationModes?: string[];
  brands?: string[];
  subcategories?: string[];
  startDate?: string;
  endDate?: string;
};

const selfOperated = "\u81ea\u8425";
const unknownMode = "\u672a\u77e5";
const unknownPriceBand = "\u672a\u786e\u8ba4\u4ef7\u683c";
const validDimensions = new Set(["SKU", "SPU"]);
const validMappingKinds = new Set(["subcategory", "brand_alias", "operation_mode"]);

type CountRow = { count: number };

export async function ensureMarketAdminSchema(db: MarketDatabase) {
  await ensureMarketSchemaCore(db);
}

export async function listMarketMasterData(db: MarketDatabase, input: {
  q?: string; category?: string; rankingDimension?: string; operationMode?: string; brand?: string; subcategory?: string;
  priceStatus?: "confirmed" | "pending" | "missing"; page?: number; pageSize?: number;
} = {}) {
  await ensureMarketAdminSchema(db);
  const pageSize = integer(input.pageSize, 30, 1, 100);
  const page = integer(input.page, 1, 1, 10_000);
  const { where, values } = masterWhere(input);
  const total = await db.prepare(`SELECT COUNT(*) count FROM (${masterBaseSql()} WHERE ${where}) t`).bind(...values).first<CountRow>();
  const rows = await db.prepare(`${masterBaseSql()} WHERE ${where}
    ORDER BY m.period_end DESC, CASE WHEN m.rank IS NULL THEN 1 ELSE 0 END, m.rank, m.gmv_cents DESC
    LIMIT ? OFFSET ?`).bind(...values, pageSize, (page - 1) * pageSize).all<Record<string, string | number | null>>();
  return {
    items: (rows.results ?? []).map(mapMasterRow),
    pagination: { page, pageSize, total: Number(total?.count ?? 0), pageCount: Math.max(1, Math.ceil(Number(total?.count ?? 0) / pageSize)) },
  };
}

export async function listPendingMarketPrices(db: MarketDatabase, input: { q?: string; category?: string; page?: number; pageSize?: number } = {}) {
  return listMarketMasterData(db, { ...input, priceStatus: "pending" });
}

export async function confirmMarketPrice(db: MarketDatabase, input: {
  category: string; scope?: string; skuCode: string; rankingDimension: string; month: string; imageContentSha256?: string;
  priceCents: unknown; priceType?: string; priceLowCents?: unknown; priceHighCents?: unknown; note?: string;
}, actor: MarketPrincipal) {
  await ensureMarketAdminSchema(db);
  const category = requiredText(input.category, 120);
  const skuCode = requiredText(input.skuCode, 80);
  const rankingDimension = dimension(input.rankingDimension);
  const month = requiredMonth(input.month);
  const priceCents = nullableInteger(input.priceCents, 0, 100_000_000);
  if (priceCents === null) throw new Error("人工确认市场定位价不能为空");
  const priceType = optionalText(input.priceType, 40) ?? "";
  if (["\u5b9a\u91d1", "\u5206\u671f\u91d1\u989d", "\u65e0\u6cd5\u5224\u65ad"].includes(priceType)) throw new Error("invalid official market price type");
  const hash = optionalText(input.imageContentSha256, 128);
  const requestedScope = optionalText(input.scope, 120);
  const beforeRows = await db.prepare(`SELECT * FROM market_price_snapshots WHERE category=? AND sku_code=? AND ranking_dimension=? AND month=? ${requestedScope ? "AND scope=?" : ""} ORDER BY scope`)
    .bind(...[category, skuCode, rankingDimension, month, ...(requestedScope ? [requestedScope] : [])]).all<Record<string, unknown>>();
  if (!requestedScope && (beforeRows.results ?? []).length !== 1) throw new Error("scope is required when multiple snapshots match");
  const before = (beforeRows.results ?? [])[0] ?? null;
  if (!before) throw new Error("未找到对应月份价格快照");
  if (hash && String(before.image_content_sha256 ?? "") !== hash) throw new Error("图片哈希不匹配，不能跨图片确认价格");
  await db.prepare(`UPDATE market_price_snapshots
    SET confirmed_market_price_cents=?, price_low_cents=?, price_high_cents=?,
      ai_price_type=COALESCE(NULLIF(?, ''), ai_price_type), confirmation_status='confirmed',
      confirmed_by=?, confirmed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
    WHERE category=? AND scope=? AND sku_code=? AND ranking_dimension=? AND month=?`)
    .bind(priceCents, nullableInteger(input.priceLowCents, 0, 100_000_000), nullableInteger(input.priceHighCents, 0, 100_000_000),
      priceType, actor.email, category, String(before.scope ?? ""), skuCode, rankingDimension, month).run();
  const after = await db.prepare(`SELECT * FROM market_price_snapshots WHERE category=? AND scope=? AND sku_code=? AND ranking_dimension=? AND month=? LIMIT 1`)
    .bind(category, String(before.scope ?? ""), skuCode, rankingDimension, month).first<Record<string, unknown>>();
  await audit(db, actor, "confirm_market_price", "market_price_snapshot", `${category}|${String(before.scope ?? "")}|${rankingDimension}|${skuCode}|${month}`, before, { ...after, note: optionalText(input.note, 300) ?? "" });
  return { ok: true, snapshot: after };
}

export async function listMarketMappings(db: MarketDatabase, input: { kind?: string; category?: string; status?: string } = {}) {
  await ensureMarketAdminSchema(db);
  const clauses = ["1=1"];
  const values: unknown[] = [];
  if (input.kind && validMappingKinds.has(input.kind)) { clauses.push("kind=?"); values.push(input.kind); }
  if (input.category?.trim()) { clauses.push("category=?"); values.push(input.category.trim().slice(0, 120)); }
  if (input.status?.trim()) { clauses.push("status=?"); values.push(input.status.trim().slice(0, 30)); }
  const rows = await db.prepare(`SELECT id, kind, category, source_value, target_value, status, version, effective_from, created_by, created_at, updated_at
    FROM market_master_mapping_rules WHERE ${clauses.join(" AND ")} ORDER BY kind, category, source_value LIMIT 300`).bind(...values).all<Record<string, string | number>>();
  return { items: rows.results ?? [] };
}

export async function upsertMarketMapping(db: MarketDatabase, input: {
  id?: string; kind: string; category?: string; sourceValue: string; targetValue: string; status?: string; effectiveFrom?: string;
}, actor: MarketPrincipal) {
  await ensureMarketAdminSchema(db);
  const kind = validMappingKinds.has(input.kind) ? input.kind : "";
  if (!kind) throw new Error("映射类型无效");
  const id = optionalText(input.id, 120) ?? `market-map-${crypto.randomUUID()}`;
  const before = await db.prepare("SELECT * FROM market_master_mapping_rules WHERE id=?").bind(id).first<Record<string, unknown>>();
  const version = before ? Number(before.version ?? 1) + 1 : 1;
  const after = {
    id, kind,
    category: optionalText(input.category, 120) ?? "",
    sourceValue: requiredText(input.sourceValue, 200),
    targetValue: normalizeMappingTarget(kind, input.targetValue),
    status: optionalText(input.status, 30) || "published",
    effectiveFrom: date(input.effectiveFrom) ?? "1970-01-01",
    version,
  };
  await db.prepare(`INSERT INTO market_master_mapping_rules
    (id, kind, category, source_value, target_value, status, version, effective_from, created_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET category=excluded.category, source_value=excluded.source_value,
      target_value=excluded.target_value, status=excluded.status, version=excluded.version,
      effective_from=excluded.effective_from, updated_at=CURRENT_TIMESTAMP`)
    .bind(after.id, after.kind, after.category, after.sourceValue, after.targetValue, after.status, after.version, after.effectiveFrom, actor.email).run();
  await audit(db, actor, "upsert_mapping", "market_mapping_rule", id, before, after);
  return after;
}

export async function applyPublishedMarketMappings(db: MarketDatabase, input: { category?: string } = {}, actor: MarketPrincipal) {
  await ensureMarketAdminSchema(db);
  const category = optionalText(input.category, 120) ?? "";
  const rules = await db.prepare(`SELECT id, kind, category, source_value, target_value, effective_from
    FROM market_master_mapping_rules
    WHERE status='published' AND (?='' OR category='' OR category=?)
    ORDER BY effective_from DESC, version DESC, id`).bind(category, category).all<{
      id: string; kind: string; category: string; source_value: string; target_value: string; effective_from: string;
    }>();
  let changed = 0;
  const applied: Array<{ id: string; kind: string; changes: number }> = [];
  for (const rule of rules.results ?? []) {
    const categoryClause = rule.category ? " AND category=?" : "";
    const categoryValues = rule.category ? [rule.category] : [];
    let result: { meta?: { changes?: number } };
    if (rule.kind === "brand_alias") {
      result = await db.prepare(`UPDATE market_ranking_entries SET brand=?, updated_at=CURRENT_TIMESTAMP
        WHERE brand=? AND period_end>=?${categoryClause}`)
        .bind(rule.target_value, rule.source_value, rule.effective_from, ...categoryValues).run() as { meta?: { changes?: number } };
    } else if (rule.kind === "operation_mode") {
      result = await db.prepare(`UPDATE market_ranking_entries SET operation_mode=?, updated_at=CURRENT_TIMESTAMP
        WHERE (operation_mode=? OR scope=?) AND period_end>=?${categoryClause}`)
        .bind(rule.target_value, rule.source_value, rule.source_value, rule.effective_from, ...categoryValues).run() as { meta?: { changes?: number } };
    } else {
      const like = `%${rule.source_value.replace(/[\\%_]/g, (value) => `\\${value}`)}%`;
      result = await db.prepare(`UPDATE market_ranking_entries SET subcategory=?, updated_at=CURRENT_TIMESTAMP
        WHERE (subcategory=? OR sku_code=? OR product_name LIKE ? ESCAPE '\\') AND period_end>=?${categoryClause}`)
        .bind(rule.target_value, rule.source_value, rule.source_value, like, rule.effective_from, ...categoryValues).run() as { meta?: { changes?: number } };
    }
    const changes = Number(result.meta?.changes ?? 0);
    changed += changes;
    applied.push({ id: rule.id, kind: rule.kind, changes });
  }
  await audit(db, actor, "apply_published_mappings", "market_ranking_entries", category || "*", null, { category, changed, applied });
  return { category, changed, applied };
}

export async function listMarketPriceBandVersions(db: MarketDatabase, category = "") {
  await ensureMarketAdminSchema(db);
  const rows = await db.prepare(`SELECT v.id, v.category, v.version, v.status, v.effective_from, v.created_by, v.created_at,
      v.published_by, v.published_at, v.rolled_back_from_id, v.note,
      COALESCE((SELECT json_group_array(json_object('id', i.id, 'label', i.label, 'minCents', i.min_cents, 'maxCents', i.max_cents, 'sortOrder', i.sort_order))
        FROM market_price_band_items i WHERE i.version_id=v.id ORDER BY i.sort_order), '[]') items_json
    FROM market_price_band_versions v
    WHERE (?='' OR v.category IN ('*', ?))
    ORDER BY v.category, v.version DESC LIMIT 100`).bind(category.trim(), category.trim()).all<Record<string, string | number | null>>();
  return { items: (rows.results ?? []).map((row) => ({ ...row, items: parseJsonArray(row.items_json) })) };
}

export async function createMarketPriceBandVersion(db: MarketDatabase, input: {
  category?: string; effectiveFrom?: string; note?: string; items: Array<{ label: string; minCents?: number | null; maxCents?: number | null }>;
}, actor: MarketPrincipal) {
  await ensureMarketAdminSchema(db);
  const category = optionalText(input.category, 120) || "*";
  const next = await db.prepare("SELECT COALESCE(MAX(version), 0)+1 version FROM market_price_band_versions WHERE category=?").bind(category).first<{ version: number }>();
  const version = Number(next?.version ?? 1);
  const id = `market-price-band-${category.replace(/[^\w-]+/g, "_")}-v${version}-${crypto.randomUUID().slice(0, 8)}`;
  const items = normalizePriceBandItems(input.items);
  await db.prepare(`INSERT INTO market_price_band_versions (id, category, version, status, effective_from, created_by, note)
    VALUES (?, ?, ?, 'draft', ?, ?, ?)`).bind(id, category, version, date(input.effectiveFrom) ?? "1970-01-01", actor.email, optionalText(input.note, 300) ?? "").run();
  await db.batch(items.map((item, index) => db.prepare(`INSERT INTO market_price_band_items (id, version_id, label, min_cents, max_cents, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)`).bind(`${id}-${index + 1}`, id, item.label, item.minCents, item.maxCents, (index + 1) * 10)));
  await audit(db, actor, "create_price_band_version", "market_price_band_version", id, null, { id, category, version, items });
  return { id, category, version, status: "draft", items };
}

export async function publishMarketPriceBandVersion(db: MarketDatabase, id: string, actor: MarketPrincipal) {
  await ensureMarketAdminSchema(db);
  const before = await db.prepare("SELECT * FROM market_price_band_versions WHERE id=? LIMIT 1").bind(id).first<Record<string, unknown>>();
  if (!before) throw new Error("价格带版本不存在");
  await db.prepare("UPDATE market_price_band_versions SET status='archived' WHERE category=? AND status='published' AND id<>?")
    .bind(String(before.category), id).run();
  await db.prepare("UPDATE market_price_band_versions SET status='published', published_by=?, published_at=CURRENT_TIMESTAMP WHERE id=?")
    .bind(actor.email, id).run();
  const after = await db.prepare("SELECT * FROM market_price_band_versions WHERE id=? LIMIT 1").bind(id).first<Record<string, unknown>>();
  await audit(db, actor, "publish_price_band_version", "market_price_band_version", id, before, after);
  return after;
}

export async function rollbackMarketPriceBandVersion(db: MarketDatabase, input: { category?: string; targetVersionId: string }, actor: MarketPrincipal) {
  await ensureMarketAdminSchema(db);
  const target = await db.prepare("SELECT * FROM market_price_band_versions WHERE id=? LIMIT 1").bind(input.targetVersionId).first<Record<string, unknown>>();
  if (!target) throw new Error("回滚目标价格带版本不存在");
  await db.prepare("UPDATE market_price_band_versions SET status='archived' WHERE category=? AND status='published'").bind(String(target.category)).run();
  await db.prepare("UPDATE market_price_band_versions SET status='published', rolled_back_from_id=COALESCE(NULLIF(rolled_back_from_id,''), id), published_by=?, published_at=CURRENT_TIMESTAMP WHERE id=?")
    .bind(actor.email, input.targetVersionId).run();
  const after = await db.prepare("SELECT * FROM market_price_band_versions WHERE id=? LIMIT 1").bind(input.targetVersionId).first<Record<string, unknown>>();
  await audit(db, actor, "rollback_price_band_version", "market_price_band_version", input.targetVersionId, target, after);
  return after;
}

export async function upsertMarketDownloadConfig(db: MarketDatabase, input: { category: string; rankingDimension: string; monthStart: string; monthEnd: string; status?: string }, actor: MarketPrincipal) {
  await ensureMarketAdminSchema(db);
  const config = {
    id: `market-download-config-${crypto.randomUUID()}`,
    category: requiredText(input.category, 120),
    rankingDimension: dimension(input.rankingDimension),
    monthStart: requiredMonth(input.monthStart),
    monthEnd: requiredMonth(input.monthEnd),
    status: optionalText(input.status, 30) || "enabled",
  };
  if (config.monthStart > config.monthEnd) throw new Error("起始月份不能晚于结束月份");
  const existing = await db.prepare(`SELECT * FROM market_download_configs WHERE category=? AND ranking_dimension=? AND month_start=? AND month_end=? LIMIT 1`)
    .bind(config.category, config.rankingDimension, config.monthStart, config.monthEnd).first<Record<string, unknown>>();
  const id = String(existing?.id ?? config.id);
  await db.prepare(`INSERT INTO market_download_configs (id, category, ranking_dimension, month_start, month_end, status, created_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(category, ranking_dimension, month_start, month_end)
    DO UPDATE SET status=excluded.status, updated_at=CURRENT_TIMESTAMP`)
    .bind(id, config.category, config.rankingDimension, config.monthStart, config.monthEnd, config.status, actor.email).run();
  await audit(db, actor, "upsert_download_config", "market_download_config", id, existing, { ...config, id });
  return { ...config, id };
}

export async function planMissingMarketDownloads(db: MarketDatabase, input: { category?: string; rankingDimension?: string } = {}, actor: MarketPrincipal) {
  await ensureMarketAdminSchema(db);
  const configs = await db.prepare(`SELECT * FROM market_download_configs
    WHERE status='enabled' AND (?='' OR category=?) AND (?='' OR ranking_dimension=?)
    ORDER BY category, ranking_dimension, month_start`).bind(input.category ?? "", input.category ?? "", input.rankingDimension ?? "", input.rankingDimension ?? "")
    .all<Record<string, string>>();
  let created = 0;
  let reused = 0;
  for (const config of configs.results ?? []) {
    for (const month of monthsBetween(config.month_start, config.month_end)) {
      const hasData = await db.prepare(`SELECT 1 FROM market_ranking_entries
        WHERE category=? AND ranking_dimension=? AND substr(period_end,1,7)=? LIMIT 1`)
        .bind(config.category, config.ranking_dimension, month).first();
      if (hasData) continue;
      const taskId = `market-download-${config.category}-${config.ranking_dimension}-${month}`.replace(/[^\w-]+/g, "_");
      const result = await db.prepare(`INSERT INTO market_download_tasks (id, category, month, ranking_dimension, status, updated_at)
        VALUES (?, ?, ?, ?, 'planned', CURRENT_TIMESTAMP)
        ON CONFLICT(category, month, ranking_dimension) DO UPDATE SET
          status=CASE WHEN market_download_tasks.status IN ('failed','planned','waiting_login') AND market_download_tasks.attempt_count < 3 THEN 'planned' ELSE market_download_tasks.status END,
          next_retry_at=CASE WHEN market_download_tasks.attempt_count < 3 THEN NULL ELSE market_download_tasks.next_retry_at END,
          updated_at=CURRENT_TIMESTAMP`)
        .bind(taskId, config.category, month, config.ranking_dimension).run() as { meta?: { changes?: number } };
      if (Number(result.meta?.changes ?? 0) > 0) created += 1; else reused += 1;
    }
  }
  await audit(db, actor, "plan_missing_downloads", "market_download_task", "*", null, { created, reused, filters: input });
  return { created, reused };
}

export async function recordMarketDownloadAttempt(db: MarketDatabase, input: {
  taskId: string; status: "created" | "downloading" | "staged" | "imported" | "published" | "waiting_login" | "failed";
  jdTaskId?: string; sourceFileName?: string; fileHash?: string; rowCount?: number; validation?: Record<string, unknown>;
  importBatchId?: string; stagingBatchId?: string; errorCode?: string; errorMessage?: string;
}, actor: MarketPrincipal) {
  await ensureMarketAdminSchema(db);
  const before = await db.prepare("SELECT * FROM market_download_tasks WHERE id=? LIMIT 1").bind(input.taskId).first<Record<string, unknown>>();
  if (!before) throw new Error("下载任务不存在");
  const nextAttempt = input.status === "failed" || input.status === "waiting_login" ? Number(before.attempt_count ?? 0) + 1 : Number(before.attempt_count ?? 0);
  const terminalFailed = input.status === "failed" && nextAttempt >= 3;
  const status = terminalFailed ? "failed" : input.status;
  const nextRetryAt = input.status === "failed" && !terminalFailed ? new Date(Date.now() + 15 * 60_000).toISOString() : null;
  const validation = input.validation ?? {};
  await db.prepare(`UPDATE market_download_tasks SET status=?, attempt_count=?, jd_task_id=COALESCE(NULLIF(?,''), jd_task_id),
      source_file_name=COALESCE(NULLIF(?,''), source_file_name), file_hash=COALESCE(NULLIF(?,''), file_hash),
      row_count=COALESCE(?, row_count), header_valid=?, period_valid=?, category_valid=?, dimension_valid=?,
      staging_batch_id=COALESCE(NULLIF(?,''), staging_batch_id), import_batch_id=COALESCE(NULLIF(?,''), import_batch_id),
      validation_json=?, error_code=?, error_message=?, next_retry_at=?, last_attempt_at=CURRENT_TIMESTAMP,
      completed_at=CASE WHEN ? IN ('imported','published') THEN CURRENT_TIMESTAMP ELSE completed_at END,
      updated_at=CURRENT_TIMESTAMP
    WHERE id=?`)
    .bind(status, nextAttempt, input.jdTaskId ?? "", input.sourceFileName ?? "", input.fileHash ?? "", input.rowCount ?? null,
      truthy(validation.headerValid), truthy(validation.periodValid), truthy(validation.categoryValid), truthy(validation.dimensionValid),
      input.stagingBatchId ?? "", input.importBatchId ?? "", JSON.stringify(validation), input.errorCode ?? "", input.errorMessage ?? "",
      nextRetryAt, status, input.taskId).run();
  const after = await db.prepare("SELECT * FROM market_download_tasks WHERE id=? LIMIT 1").bind(input.taskId).first<Record<string, unknown>>();
  await audit(db, actor, "record_download_attempt", "market_download_task", input.taskId, before, after);
  return after;
}

export async function getMarketMasterWorkspace(db: MarketDatabase, input: { q?: string; page?: number; pageSize?: number } = {}) {
  await ensureMarketAdminSchema(db);
  const [masterData, pendingPrices, mappings, priceBands, tasks, configs, coverage, imageCache, audits] = await Promise.all([
    listMarketMasterData(db, input),
    listPendingMarketPrices(db, { page: 1, pageSize: 20 }),
    listMarketMappings(db),
    listMarketPriceBandVersions(db),
    db.prepare("SELECT * FROM market_download_tasks ORDER BY updated_at DESC LIMIT 100").all<Record<string, unknown>>(),
    db.prepare("SELECT * FROM market_download_configs ORDER BY updated_at DESC LIMIT 100").all<Record<string, unknown>>(),
    db.prepare(`SELECT category, ranking_dimension, MIN(substr(period_end,1,7)) month_min, MAX(substr(period_end,1,7)) month_max, COUNT(DISTINCT substr(period_end,1,7)) month_count, COUNT(DISTINCT sku_code) sku_count
      FROM market_ranking_entries GROUP BY category, ranking_dimension ORDER BY category, ranking_dimension LIMIT 200`).all<Record<string, unknown>>(),
    db.prepare(`SELECT COUNT(*) total, SUM(CASE WHEN status='ready' THEN 1 ELSE 0 END) cached, SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed,
      SUM(CASE WHEN status NOT IN ('ready','failed') THEN 1 ELSE 0 END) pending FROM market_image_cache`).first<Record<string, number | null>>(),
    db.prepare("SELECT * FROM market_master_audit_logs ORDER BY created_at DESC LIMIT 100").all<Record<string, unknown>>(),
  ]);
  return {
    masterData,
    pendingPrices,
    mappings,
    priceBands,
    downloadTasks: tasks.results ?? [],
    downloadConfigs: configs.results ?? [],
    coverage: coverage.results ?? [],
    imageCache: {
      total: Number(imageCache?.total ?? 0),
      cached: Number(imageCache?.cached ?? 0),
      failed: Number(imageCache?.failed ?? 0),
      pending: Number(imageCache?.pending ?? 0),
    },
    audits: audits.results ?? [],
  };
}

export async function getMarketSkuComparison(db: MarketDatabase, input: {
  skuCodes: string[]; category?: string; rankingDimension?: string; startDate?: string; endDate?: string;
}) {
  await ensureMarketAdminSchema(db);
  const skuCodes = [...new Set(input.skuCodes.map((sku) => sku.trim()).filter(Boolean))].slice(0, 5);
  if (skuCodes.length < 2 || skuCodes.length > 5) throw new Error("商品对比必须选择 2 到 5 个 SKU");
  const filters: MarketOverviewFilters = {
    query: undefined,
    categories: input.category ? [input.category] : undefined,
    rankingDimensions: input.rankingDimension ? [dimension(input.rankingDimension)] : undefined,
    startDate: date(input.startDate),
    endDate: date(input.endDate),
  };
  const placeholders = skuCodes.map(() => "?").join(",");
  const clauses = [`m.sku_code IN (${placeholders})`];
  const values: unknown[] = [...skuCodes];
  if (filters.categories?.[0]) { clauses.push("m.category=?"); values.push(filters.categories[0]); }
  if (filters.rankingDimensions?.[0]) { clauses.push("m.ranking_dimension=?"); values.push(filters.rankingDimensions[0]); }
  if (filters.startDate) { clauses.push("m.period_end>=?"); values.push(filters.startDate); }
  if (filters.endDate) { clauses.push("m.period_start<=?"); values.push(filters.endDate); }
  const rows = await db.prepare(`
    SELECT m.sku_code, m.product_name, m.brand, m.category, m.ranking_dimension,
      SUM(m.gmv_cents) gmv_cents, SUM(m.quantity) quantity, SUM(m.visitors) visitors,
      CASE WHEN SUM(m.visitors)>0 THEN CAST(ROUND(SUM(m.quantity)*10000.0/SUM(m.visitors)) AS INTEGER) ELSE NULL END conversion_bps,
      MIN(m.rank) best_rank,
      MAX(ps.confirmed_market_price_cents) market_price_cents,
      CASE WHEN SUM(m.quantity)>0 THEN CAST(ROUND(SUM(m.gmv_cents)*1.0/SUM(m.quantity)) AS INTEGER) ELSE NULL END average_transaction_price_cents
    FROM market_ranking_entries m
    LEFT JOIN market_price_snapshots ps ON ps.category=m.category AND ps.scope=m.scope AND ps.sku_code=m.sku_code AND ps.ranking_dimension=m.ranking_dimension AND ps.month=substr(m.period_end,1,7)
    WHERE ${clauses.join(" AND ")}
    GROUP BY m.sku_code, m.product_name, m.brand, m.category, m.ranking_dimension
    ORDER BY gmv_cents DESC`).bind(...values).all<Record<string, string | number | null>>();
  const trends = await Promise.all(skuCodes.map((skuCode) => getMarketItemTrendLite(db, {
    skuCode,
    category: input.category,
    rankingDimension: input.rankingDimension === "SKU" || input.rankingDimension === "SPU" ? input.rankingDimension : undefined,
  })));
  return {
    items: (rows.results ?? []).map((row) => ({
      skuCode: String(row.sku_code ?? ""),
      productName: String(row.product_name ?? ""),
      brand: String(row.brand ?? ""),
      category: String(row.category ?? ""),
      rankingDimension: String(row.ranking_dimension ?? "SKU"),
      gmvCents: Number(row.gmv_cents ?? 0),
      quantity: Number(row.quantity ?? 0),
      visitors: Number(row.visitors ?? 0),
      conversionBps: row.conversion_bps === null ? null : Number(row.conversion_bps),
      bestRank: row.best_rank === null ? null : Number(row.best_rank),
      marketPriceCents: row.market_price_cents === null ? null : Number(row.market_price_cents),
      averageTransactionPriceCents: row.average_transaction_price_cents === null ? null : Number(row.average_transaction_price_cents),
      trend: trends.find((trend) => trend.skuCode === row.sku_code)?.items ?? [],
    })),
  };
}

export async function getMarketOverviewForAi(db: MarketDatabase, args: Record<string, unknown>) {
  const { getMarketOverview } = await import("@/lib/market/database");
  const overview = await getMarketOverview(db, aiFilters(args));
  return {
    filtersApplied: aiFilters(args),
    dataRange: overview.dataRange,
    summary: overview.summary,
    returned: 1,
    truncated: false,
    currency: "CNY",
    monetaryUnit: "cents",
    basis: "current_top_ranking_coverage",
  };
}

export async function getMarketBrandAnalysisForAi(db: MarketDatabase, args: Record<string, unknown>) {
  const { getMarketOverview } = await import("@/lib/market/database");
  const overview = await getMarketOverview(db, aiFilters(args));
  return {
    filtersApplied: aiFilters(args),
    dataRange: overview.dataRange,
    brandAnalysis: overview.brandAnalysis,
    returned: overview.brandAnalysis.items.length,
    truncated: overview.brandAnalysis.items.length >= 30,
    currency: "CNY",
    monetaryUnit: "cents",
    basis: "current_top_ranking_coverage",
  };
}

export async function getMarketPriceBandAnalysisForAi(db: MarketDatabase, args: Record<string, unknown>) {
  const { getMarketOverview } = await import("@/lib/market/database");
  const overview = await getMarketOverview(db, aiFilters(args));
  return {
    filtersApplied: aiFilters(args),
    dataRange: overview.dataRange,
    priceBands: overview.priceBandSummary.slice(0, integer(args.limit, 20, 1, 50)),
    returned: Math.min(overview.priceBandSummary.length, integer(args.limit, 20, 1, 50)),
    truncated: overview.priceBandSummary.length > integer(args.limit, 20, 1, 50),
    currency: "CNY",
    monetaryUnit: "cents",
    basis: "confirmed_market_position_price_only",
  };
}

export async function getMarketPendingReviewSummaryForAi(db: MarketDatabase, args: Record<string, unknown>) {
  const pending = await listPendingMarketPrices(db, { category: optionalText(args.category, 120), page: 1, pageSize: integer(args.limit, 20, 1, 50) });
  return {
    filtersApplied: { category: optionalText(args.category, 120) ?? null },
    totalMatched: pending.pagination.total,
    returned: pending.items.length,
    truncated: pending.pagination.total > pending.items.length,
    items: pending.items.map((item) => ({
      category: item.category, skuCode: item.skuCode, rankingDimension: item.rankingDimension, month: item.month,
      productName: item.productName, brand: item.brand, candidatePriceCents: item.candidatePriceCents,
      candidatePriceSource: item.candidatePriceSource, imageContentSha256: item.imageContentSha256,
    })),
  };
}

function masterBaseSql() {
  return `SELECT m.id, m.period_start, m.period_end, substr(m.period_end,1,7) month, m.category, m.scope, m.ranking_dimension, m.operation_mode,
      m.subcategory, m.rank, m.sku_code, m.product_name, m.brand, m.gmv_cents, m.quantity, m.visitors, m.conversion_bps,
      m.image_url, COALESCE(c.status, CASE WHEN m.image_url='' THEN 'missing' ELSE 'pending' END) image_cache_status,
      COALESCE(c.content_sha256, ps.image_content_sha256, '') image_content_sha256,
      ps.source_price_cents, ps.ai_image_price_cents, ps.ai_price_type, ps.ai_confidence_bps, ps.ai_reason,
      ps.confirmed_market_price_cents official_market_price_cents,
      COALESCE(ps.source_price_cents, ps.average_transaction_price_cents, ps.ai_image_price_cents) candidate_price_cents,
      CASE WHEN ps.source_price_cents IS NOT NULL THEN 'source_table'
        WHEN ps.average_transaction_price_cents IS NOT NULL THEN 'average_transaction'
        WHEN ps.ai_image_price_cents IS NOT NULL THEN 'ai_suggestion'
        ELSE 'missing' END candidate_price_source,
      ps.average_transaction_price_cents, ps.price_low_cents, ps.price_high_cents, COALESCE(ps.confirmation_status,'missing') confirmation_status,
      ${officialPriceBandSql("ps.confirmed_market_price_cents")} price_band
    FROM market_ranking_entries m
    LEFT JOIN market_price_snapshots ps ON ps.category=m.category AND ps.scope=m.scope AND ps.sku_code=m.sku_code AND ps.ranking_dimension=m.ranking_dimension AND ps.month=substr(m.period_end,1,7)
    LEFT JOIN market_image_cache c ON c.source_url=m.image_url`;
}

async function getMarketItemTrendLite(db: MarketDatabase, input: { skuCode: string; category?: string; rankingDimension?: "SKU" | "SPU" }) {
  const skuCode = input.skuCode.trim().slice(0, 80);
  const clauses = ["m.sku_code = ?"];
  const values: unknown[] = [skuCode];
  if (input.category?.trim()) { clauses.push("m.category = ?"); values.push(input.category.trim().slice(0, 120)); }
  if (input.rankingDimension === "SKU" || input.rankingDimension === "SPU") { clauses.push("m.ranking_dimension = ?"); values.push(input.rankingDimension); }
  const rows = await db.prepare(`
    SELECT substr(m.period_end, 1, 7) month, m.period_start, m.period_end, m.rank, m.operation_mode,
      m.gmv_cents, m.quantity, m.visitors, m.conversion_bps,
      ps.confirmed_market_price_cents market_price_cents,
      ps.average_transaction_price_cents average_transaction_price_cents,
      COALESCE(ps.confirmation_status, 'missing') confirmation_status
    FROM market_ranking_entries m
    LEFT JOIN market_price_snapshots ps ON ps.category=m.category AND ps.scope=m.scope AND ps.sku_code=m.sku_code AND ps.ranking_dimension=m.ranking_dimension AND ps.month=substr(m.period_end,1,7)
    WHERE ${clauses.join(" AND ")}
    ORDER BY m.period_end ASC, m.id ASC
    LIMIT 120
  `).bind(...values).all<Record<string, string | number | null>>();
  return {
    skuCode,
    items: (rows.results ?? []).map((row) => ({
      month: String(row.month ?? ""),
      periodStart: String(row.period_start ?? ""),
      periodEnd: String(row.period_end ?? ""),
      rank: row.rank === null ? null : Number(row.rank),
      operationMode: String(row.operation_mode ?? unknownMode),
      gmvCents: Number(row.gmv_cents ?? 0),
      quantity: Number(row.quantity ?? 0),
      visitors: Number(row.visitors ?? 0),
      conversionBps: row.conversion_bps === null ? null : Number(row.conversion_bps),
      marketPriceCents: row.market_price_cents === null ? null : Number(row.market_price_cents),
      averageTransactionPriceCents: row.average_transaction_price_cents === null ? null : Number(row.average_transaction_price_cents),
      confirmationStatus: String(row.confirmation_status ?? "missing"),
    })),
  };
}

function masterWhere(input: {
  q?: string; category?: string; rankingDimension?: string; operationMode?: string; brand?: string; subcategory?: string; priceStatus?: string;
}) {
  const clauses = ["1=1"];
  const values: unknown[] = [];
  const q = optionalText(input.q, 100);
  if (q) { clauses.push("(m.sku_code LIKE ? OR m.product_name LIKE ? OR m.brand LIKE ?)"); values.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (input.category?.trim()) { clauses.push("m.category=?"); values.push(input.category.trim().slice(0, 120)); }
  if (input.rankingDimension && validDimensions.has(input.rankingDimension)) { clauses.push("m.ranking_dimension=?"); values.push(input.rankingDimension); }
  if (input.operationMode?.trim()) { clauses.push("m.operation_mode=?"); values.push(input.operationMode.trim().slice(0, 20)); }
  if (input.brand?.trim()) { clauses.push("m.brand=?"); values.push(input.brand.trim().slice(0, 120)); }
  if (input.subcategory?.trim()) { clauses.push("m.subcategory=?"); values.push(input.subcategory.trim().slice(0, 120)); }
  if (input.priceStatus === "confirmed") clauses.push("ps.confirmed_market_price_cents IS NOT NULL");
  if (input.priceStatus === "pending") clauses.push("ps.confirmed_market_price_cents IS NULL AND (ps.source_price_cents IS NOT NULL OR ps.ai_image_price_cents IS NOT NULL OR ps.average_transaction_price_cents IS NOT NULL OR ps.confirmation_status IN ('missing','ai_pending','review_pending','source_table'))");
  if (input.priceStatus === "missing") clauses.push("ps.confirmed_market_price_cents IS NULL AND ps.source_price_cents IS NULL AND ps.ai_image_price_cents IS NULL AND ps.average_transaction_price_cents IS NULL");
  return { where: clauses.join(" AND "), values };
}

function mapMasterRow(row: Record<string, string | number | null>) {
  return {
    id: Number(row.id),
    periodStart: String(row.period_start ?? ""),
    periodEnd: String(row.period_end ?? ""),
    month: String(row.month ?? ""),
    category: String(row.category ?? ""),
    scope: String(row.scope ?? ""),
    rankingDimension: String(row.ranking_dimension ?? "SKU"),
    operationMode: String(row.operation_mode ?? unknownMode),
    subcategory: String(row.subcategory ?? ""),
    rank: row.rank === null ? null : Number(row.rank),
    skuCode: String(row.sku_code ?? ""),
    productName: String(row.product_name ?? ""),
    brand: String(row.brand ?? ""),
    gmvCents: Number(row.gmv_cents ?? 0),
    quantity: Number(row.quantity ?? 0),
    visitors: Number(row.visitors ?? 0),
    conversionBps: row.conversion_bps === null ? null : Number(row.conversion_bps),
    imageUrl: String(row.image_url ?? ""),
    imageCacheStatus: String(row.image_cache_status ?? "missing"),
    imageContentSha256: String(row.image_content_sha256 ?? ""),
    officialMarketPriceCents: row.official_market_price_cents === null ? null : Number(row.official_market_price_cents),
    candidatePriceCents: row.candidate_price_cents === null ? null : Number(row.candidate_price_cents),
    candidatePriceSource: String(row.candidate_price_source ?? "missing"),
    averageTransactionPriceCents: row.average_transaction_price_cents === null ? null : Number(row.average_transaction_price_cents),
    priceLowCents: row.price_low_cents === null ? null : Number(row.price_low_cents),
    priceHighCents: row.price_high_cents === null ? null : Number(row.price_high_cents),
    aiImagePriceCents: row.ai_image_price_cents === null ? null : Number(row.ai_image_price_cents),
    aiPriceType: String(row.ai_price_type ?? ""),
    aiConfidenceBps: row.ai_confidence_bps === null ? null : Number(row.ai_confidence_bps),
    aiReason: String(row.ai_reason ?? ""),
    confirmationStatus: String(row.confirmation_status ?? "missing"),
    priceBand: String(row.price_band ?? unknownPriceBand),
  };
}

function aiFilters(args: Record<string, unknown>): MarketOverviewFilters {
  return {
    query: optionalText(args.query, 100),
    categories: optionalText(args.category, 120) ? [String(args.category).trim()] : undefined,
    rankingDimensions: optionalText(args.rankingDimension, 10) ? [dimension(String(args.rankingDimension))] : undefined,
    operationModes: optionalText(args.operationMode, 20) ? [normalizeOperationMode(String(args.operationMode))] : undefined,
    brands: optionalText(args.brand, 120) ? [String(args.brand).trim()] : undefined,
    subcategories: optionalText(args.subcategory, 120) ? [String(args.subcategory).trim()] : undefined,
    startDate: date(args.startDate),
    endDate: date(args.endDate),
  };
}

async function audit(db: MarketDatabase, actor: MarketPrincipal, action: string, entityType: string, entityId: string, before: unknown, after: unknown) {
  await db.prepare(`INSERT INTO market_master_audit_logs (id, actor_email, actor_role, action, entity_type, entity_id, before_json, after_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(`market-audit-${crypto.randomUUID()}`, actor.email, actor.role, action, entityType, entityId, JSON.stringify(before ?? null), JSON.stringify(after ?? null)).run();
}

function normalizeMappingTarget(kind: string, value: string) {
  const normalized = requiredText(value, 200);
  if (kind === "operation_mode") return normalizeOperationMode(normalized);
  return normalized;
}

function normalizeOperationMode(value: string) {
  if (/^pop$/i.test(value.trim())) return "POP";
  if (value.includes(selfOperated)) return selfOperated;
  return unknownMode;
}

function normalizePriceBandItems(items: Array<{ label: string; minCents?: number | null; maxCents?: number | null }>) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 30) throw new Error("价格带配置必须包含 1 到 30 条");
  const normalized = items.map((item) => ({
    label: requiredText(item.label, 60),
    minCents: nullableInteger(item.minCents ?? null, 0, 100_000_000),
    maxCents: nullableInteger(item.maxCents ?? null, 0, 100_000_000),
  }));
  for (const item of normalized) if (item.minCents !== null && item.maxCents !== null && item.minCents >= item.maxCents) throw new Error("价格带下限必须小于上限");
  return normalized;
}

function monthsBetween(start: string, end: string) {
  const result: string[] = [];
  let year = Number(start.slice(0, 4));
  let month = Number(start.slice(5, 7));
  const endKey = Number(end.slice(0, 4)) * 12 + Number(end.slice(5, 7));
  for (let key = year * 12 + month; key <= endKey && result.length < 120; key += 1) {
    result.push(`${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}`);
    month += 1;
    if (month === 13) { month = 1; year += 1; }
  }
  return result;
}

function requiredText(value: unknown, maxLength: number) {
  const normalized = optionalText(value, maxLength);
  if (!normalized) throw new Error("必填字段不能为空");
  return normalized;
}

function optionalText(value: unknown, maxLength: number) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error("文本字段格式无效");
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (Array.from(normalized).length > maxLength) throw new Error("文本字段过长");
  return normalized;
}

function date(value: unknown) {
  const text = optionalText(value, 10);
  if (!text) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error("日期格式必须为 YYYY-MM-DD");
  return text;
}

function requiredMonth(value: unknown) {
  const text = requiredText(value, 7);
  if (!/^\d{4}-\d{2}$/.test(text)) throw new Error("月份格式必须为 YYYY-MM");
  return text;
}

function dimension(value: unknown): MarketDimension {
  const text = requiredText(value, 3);
  if (!validDimensions.has(text)) throw new Error("榜单维度必须是 SKU 或 SPU");
  return text as MarketDimension;
}

function integer(value: unknown, fallback: number, min: number, max: number) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error(`整数必须在 ${min} 到 ${max} 之间`);
  return number;
}

function nullableInteger(value: unknown, min: number, max: number) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error(`整数必须在 ${min} 到 ${max} 之间`);
  return number;
}

function truthy(value: unknown) {
  return value === true || value === 1 || value === "true" ? 1 : 0;
}

function parseJsonArray(value: unknown) {
  try {
    const parsed = JSON.parse(String(value ?? "[]")) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
