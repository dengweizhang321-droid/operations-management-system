import { randomBytes, randomUUID } from "node:crypto";

import { ensureAnnotationSchema } from "@/lib/market/annotation-schema";
import { AnnotationAgentError } from "@/lib/market/annotation-agent-errors";
import { resolveAnnotationImageCandidates } from "@/lib/market/annotation-image";
import { normalizeMarketAnnotationJobLimit } from "@/lib/market/annotation-limits";
import { listAnnotationModels, listPromptTextModels, runPromptTextCompletion, runVisionAnnotation } from "@/lib/market/annotation-model";
import { systemPriceRecognitionPrompt } from "@/lib/market/default-taxonomy";
import { listMarketSubcategoryTaxonomy } from "@/lib/market/subcategory-taxonomy";
import {
  activationGate, digest, normalizeImagePriceCents, normalizeSegments, parseVisionAnnotation,
  stableStratifiedSample, validationMetrics,
} from "@/lib/market/annotation-types";
import type { MarketDatabase } from "@/lib/market/database";
import { ensureMarketMasterIdentities } from "@/lib/market/master-identity";

type Actor = { email: string; role: string };
type PromptRow = { id: string; category: string; version: number; parent_id: string | null; source: string; status: string; segments_json: string; prompt_body: string; change_note: string; metrics_json: string; created_by: string; created_at: string; activated_by: string | null; activated_at: string | null };
type JobRow = { id: string; category: string; prompt_version_id: string; executor: string; model_id: string | null; local_model_name: string; status: string; total_count: number; completed_count: number; failed_count: number; reviewed_count: number; committed_count: number; created_by: string; created_at: string; started_at: string | null; completed_at: string | null; updated_at: string; commit_token_hash: string; commit_started_at: string | null };
type ItemRow = { id: string; job_id: string; category: string; scope: string; sku_code: string; ranking_dimension: string; month: string; image_content_sha256: string; product_name: string; brand: string; source_image_url: string; resolved_image_url: string; image_source: string; status: string; ai_segment: string; ai_image_price_cents: number | null; ai_price_type: string; ai_price_low_cents: number | null; ai_price_high_cents: number | null; ai_confidence_bps: number | null; ai_reason: string; reviewed_segment: string; reviewed_image_price_cents: number | null; reviewed_price_type: string; reviewed_price_low_cents: number | null; reviewed_price_high_cents: number | null; selected: number; reviewed_by: string; reviewed_at: string | null; lease_token_hash: string; lease_agent_id: string; lease_expires_at: string | null; attempt_count: number; error_message: string; version: number; created_at: string; updated_at: string };
type ValidationSampleRow = { id: string; category: string; sku_code: string; product_name: string; brand: string; image_url: string; gold_segment: string; gold_image_price_cents: number | null };
type ValidationSnapshot = { id: string; skuCode: string; productName: string; brand: string; imageUrl: string; goldSegment: string; goldImagePriceCents: number | null };
type ValidationResultRow = { id: string; run_id: string; sample_id: string; prompt_version_id: string; status: string; predicted_segment: string; predicted_image_price_cents: number | null; confidence_bps: number | null; is_correct: number; error_message: string; sample_snapshot_json: string; claim_token_hash: string; lease_expires_at: string | null; attempt_count: number; updated_at: string };
type ReusableCloudAnnotationRow = { id: string; category: string; scope: string; sku_code: string; ranking_dimension: string; month: string; image_content_sha256: string; ai_segment: string; ai_image_price_cents: number | null; ai_price_type: string; ai_price_low_cents: number | null; ai_price_high_cents: number | null; ai_confidence_bps: number | null; ai_reason: string; ai_raw_digest: string; resolved_image_url: string; image_source: string };

const promptColumns = "id, category, version, parent_id, source, status, segments_json, prompt_body, change_note, metrics_json, created_by, created_at, activated_by, activated_at";
const jobColumns = "id, category, prompt_version_id, executor, model_id, local_model_name, status, total_count, completed_count, failed_count, reviewed_count, committed_count, created_by, created_at, started_at, completed_at, updated_at, commit_token_hash, commit_started_at";
const itemColumns = "id, job_id, category, scope, sku_code, ranking_dimension, month, image_content_sha256, product_name, brand, source_image_url, resolved_image_url, image_source, status, ai_segment, ai_image_price_cents, ai_price_type, ai_price_low_cents, ai_price_high_cents, ai_confidence_bps, ai_reason, reviewed_segment, reviewed_image_price_cents, reviewed_price_type, reviewed_price_low_cents, reviewed_price_high_cents, selected, reviewed_by, reviewed_at, lease_token_hash, lease_agent_id, lease_expires_at, attempt_count, error_message, version, created_at, updated_at";
const HISTORY_SAME_IMAGE_REVIEWER = "system:history_same_image";

function json<T>(value: string, fallback: T): T { try { return JSON.parse(value) as T; } catch { return fallback; } }
async function assertPromptTaxonomyCurrent(db: MarketDatabase, category: string, segments: string[], message: string) {
  let taxonomy: string[];
  try { taxonomy = await listMarketSubcategoryTaxonomy(db, category); }
  catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (/no such table|does not exist/i.test(text)) return;
    throw error;
  }
  if (!taxonomy.length) return;
  const current = [...new Set(taxonomy)].sort();
  const prompt = [...new Set(segments)].sort();
  if (current.length !== prompt.length || current.some((value, index) => value !== prompt[index])) throw new Error(message);
}
function strictInteger(value: number | undefined, fallback: number, minimum: number, maximum: number, name: string) {
  const resolved = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) throw new Error(`${name} 必须是 ${minimum} 到 ${maximum} 的整数`);
  return resolved;
}
function snapshotView(value: string) {
  const snapshot = json<Partial<ValidationSnapshot>>(value, {});
  return { skuCode: snapshot.skuCode ?? "", productName: snapshot.productName ?? "", brand: snapshot.brand ?? "", goldSegment: snapshot.goldSegment ?? "", goldImagePriceCents: snapshot.goldImagePriceCents ?? null };
}
function safeOperationalError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  if (/API Key|模型调用|模型接口|模型响应|图片|没有返回|枚举|confidence|价格/.test(message)) return message.slice(0, 300);
  return fallback;
}
async function ensureMarketSchemaLazy(db: MarketDatabase) {
  try {
    const { ensureMarketSchema } = await import("@/lib/market/database");
    await ensureMarketSchema(db);
  } catch (error) {
    if (!(error instanceof Error) || !/cloudflare:/.test(error.message)) throw error;
    const { ensureMarketSchemaCore } = await import("@/lib/market/schema-core");
    await ensureMarketSchemaCore(db);
  }
}
function promptValue(row: PromptRow) { return { id: row.id, category: row.category, version: row.version, parentId: row.parent_id, source: row.source, status: row.status, segments: json<string[]>(row.segments_json, []), promptBody: row.prompt_body, changeNote: row.change_note, metrics: json(row.metrics_json, {}), createdBy: row.created_by, createdAt: row.created_at, activatedBy: row.activated_by, activatedAt: row.activated_at }; }
function jobValue(row: JobRow) { return { id: row.id, category: row.category, promptVersionId: row.prompt_version_id, executor: row.executor, modelId: row.model_id, localModelName: row.local_model_name, status: row.status, totalCount: row.total_count, completedCount: row.completed_count, failedCount: row.failed_count, reviewedCount: row.reviewed_count, committedCount: row.committed_count, createdBy: row.created_by, createdAt: row.created_at, startedAt: row.started_at, completedAt: row.completed_at, updatedAt: row.updated_at }; }
function itemValue(row: ItemRow) { return { id: row.id, candidateId: row.id, jobId: row.job_id, category: row.category, skuCode: row.sku_code, rankingDimension: row.ranking_dimension, month: row.month, imageContentSha256: row.image_content_sha256, productName: row.product_name, brand: row.brand, sourceImageUrl: row.source_image_url, resolvedImageUrl: row.resolved_image_url, imageSource: row.image_source, status: row.status, aiSegment: row.ai_segment, aiImagePriceCents: row.ai_image_price_cents, aiPriceType: row.ai_price_type, aiPriceLowCents: row.ai_price_low_cents, aiPriceHighCents: row.ai_price_high_cents, aiConfidenceBps: row.ai_confidence_bps, aiReason: row.ai_reason, reviewedSegment: row.reviewed_segment, reviewedImagePriceCents: row.reviewed_image_price_cents, reviewedPriceType: row.reviewed_price_type, reviewedPriceLowCents: row.reviewed_price_low_cents, reviewedPriceHighCents: row.reviewed_price_high_cents, reviewPriceSource: row.reviewed_by === HISTORY_SAME_IMAGE_REVIEWER ? "history_same_image" : (row.ai_segment || row.ai_image_price_cents !== null || row.ai_confidence_bps !== null || row.ai_reason) ? "ai" : "manual", selected: Boolean(row.selected), reviewedBy: row.reviewed_by, reviewedAt: row.reviewed_at, attemptCount: row.attempt_count, errorMessage: row.error_message, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at }; }
const aiRecognitionClause = "(COALESCE(ai_segment,'')<>'' OR ai_image_price_cents IS NOT NULL OR ai_confidence_bps IS NOT NULL OR COALESCE(ai_reason,'')<>'')";
const MAX_FILTERED_SELECTION = 5_000;
const COMMIT_SELECTION_BATCH_SIZE = 500;

function annotationImportableClause(alias = "market_annotation_items", jobStatuses = ["review_ready"]) {
  const statuses = jobStatuses.map((status) => `'${status}'`).join(",");
  return `${alias}.status IN ('review_pending','approved','rejected') AND EXISTS (
    SELECT 1 FROM market_annotation_jobs import_job
    JOIN market_annotation_prompt_versions import_prompt ON import_prompt.id=import_job.prompt_version_id
    JOIN json_each(import_prompt.segments_json) import_segment
    WHERE import_job.id=${alias}.job_id AND import_job.status IN (${statuses})
      AND CAST(import_segment.value AS TEXT)=COALESCE(NULLIF(${alias}.reviewed_segment,''),${alias}.ai_segment)
  )`;
}

function annotationCategoryList(values: string[] | undefined, legacy?: string) {
  const categories = [...new Set([...(values ?? []), legacy ?? ""].map((value) => value.trim().slice(0, 120)).filter(Boolean))];
  if (categories.length > 50) throw new Error("三级类目一次最多选择 50 个");
  return categories;
}

function annotationReviewScope(input: { jobId?: string; aggregateJobs?: boolean; itemCategory?: string; itemCategories?: string[] }) {
  const categories = annotationCategoryList(input.itemCategories, input.itemCategory);
  if (input.aggregateJobs) return categories.length ? { clause: `category IN (${categories.map(() => "?").join(",")})`, bindings: categories as unknown[] } : { clause: "1=1", bindings: [] as unknown[] };
  return { clause: "job_id=?", bindings: [input.jobId ?? ""] as unknown[] };
}

type AnnotationWorkspaceInput = {
  jobId?: string; q?: string; page?: number; pageSize?: number; itemPage?: number; itemPageSize?: number;
  aggregateJobs?: boolean; itemCategory?: string; itemCategories?: string[]; itemSegment?: string; storageStatus?: "pending" | "committed"; recognitionSource?: "ai" | "non_ai"; includeAgents?: boolean; includeCatalog?: boolean;
};

async function queryAnnotationReviewWorkspace(db: MarketDatabase, input: AnnotationWorkspaceInput = {}) {
  const itemPage = strictInteger(input.itemPage, 1, 1, 50_000, "itemPage");
  const itemPageSize = strictInteger(input.itemPageSize, 20, 10, 200, "itemPageSize");
  const reviewScope = annotationReviewScope(input);
  const itemClauses = [reviewScope.clause];
  const itemBindings: unknown[] = [...reviewScope.bindings];
  const itemSegment = input.itemSegment?.trim().slice(0, 120) ?? "";
  if (itemSegment) { itemClauses.push("COALESCE(NULLIF(reviewed_segment,''), ai_segment)=?"); itemBindings.push(itemSegment); }
  if (input.storageStatus === "committed") itemClauses.push("status='committed'");
  if (input.storageStatus === "pending") itemClauses.push("status<>'committed'");
  if (input.recognitionSource === "ai") itemClauses.push(aiRecognitionClause);
  if (input.recognitionSource === "non_ai") itemClauses.push(`NOT ${aiRecognitionClause}`);
  const itemWhere = itemClauses.join(" AND ");
  const hasReviewScope = Boolean(input.aggregateJobs || input.jobId);
  const [items, itemCount, reviewSummary, selection] = await Promise.all([
    hasReviewScope ? db.prepare(`SELECT ${itemColumns} FROM market_annotation_items WHERE ${itemWhere} ORDER BY created_at DESC, id LIMIT ? OFFSET ?`).bind(...itemBindings, itemPageSize, (itemPage - 1) * itemPageSize).all<ItemRow>() : Promise.resolve({ results: [] as ItemRow[] }),
    hasReviewScope ? db.prepare(`SELECT COUNT(*) count FROM market_annotation_items WHERE ${itemWhere}`).bind(...itemBindings).first<{ count: number }>() : Promise.resolve({ count: 0 }),
    hasReviewScope ? db.prepare(`SELECT COUNT(DISTINCT job_id) jobCount, COUNT(*) recordCount,
      COUNT(DISTINCT category || char(31) || scope || char(31) || sku_code || char(31) || ranking_dimension || char(31) || month || char(31) || image_content_sha256) uniqueCandidateCount
      FROM market_annotation_items WHERE ${reviewScope.clause}`).bind(...reviewScope.bindings).first<{ jobCount: number; recordCount: number; uniqueCandidateCount: number }>() : Promise.resolve({ jobCount: 0, recordCount: 0, uniqueCandidateCount: 0 }),
    hasReviewScope ? db.prepare(`SELECT
      SUM(CASE WHEN ${annotationImportableClause()} THEN 1 ELSE 0 END) filteredReviewableCount,
      SUM(CASE WHEN ${annotationImportableClause()} AND selected=1 THEN 1 ELSE 0 END) filteredSelectedCount,
      (SELECT COUNT(*) FROM market_annotation_items WHERE ${reviewScope.clause} AND selected=1 AND ${annotationImportableClause()}) scopeSelectedCount
      FROM market_annotation_items WHERE ${itemWhere}`).bind(...reviewScope.bindings, ...itemBindings).first<{ filteredReviewableCount: number | null; filteredSelectedCount: number | null; scopeSelectedCount: number }>() : Promise.resolve({ filteredReviewableCount: 0, filteredSelectedCount: 0, scopeSelectedCount: 0 }),
  ]);
  return {
    items: (items.results ?? []).map(itemValue), itemPagination: { page: itemPage, pageSize: itemPageSize, total: Number(itemCount?.count ?? 0), pageCount: Math.max(1, Math.ceil(Number(itemCount?.count ?? 0) / itemPageSize)) },
    reviewSummary: { jobCount: Number(reviewSummary?.jobCount ?? 0), recordCount: Number(reviewSummary?.recordCount ?? 0), uniqueCandidateCount: Number(reviewSummary?.uniqueCandidateCount ?? 0) },
    selection: { filteredReviewableCount: Number(selection?.filteredReviewableCount ?? 0), filteredSelectedCount: Number(selection?.filteredSelectedCount ?? 0), scopeSelectedCount: Number(selection?.scopeSelectedCount ?? 0) },
  };
}

export async function getAnnotationReviewWorkspace(db: MarketDatabase, input: AnnotationWorkspaceInput = {}) {
  await Promise.all([ensureMarketSchemaLazy(db), ensureAnnotationSchema(db)]);
  return queryAnnotationReviewWorkspace(db, input);
}

export async function getAnnotationCatalogWorkspace(db: MarketDatabase, input: { q?: string; page?: number; pageSize?: number } = {}) {
  await Promise.all([ensureMarketSchemaLazy(db), ensureAnnotationSchema(db)]);
  await ensureMarketMasterIdentities(db);
  return searchAnnotationCatalog(db, input);
}

export async function getAnnotationWorkspace(db: MarketDatabase, input: AnnotationWorkspaceInput = {}) {
  await Promise.all([ensureMarketSchemaLazy(db), ensureAnnotationSchema(db)]);
  await ensureMarketMasterIdentities(db);
  const page = Math.max(1, Math.trunc(input.page ?? 1));
  const pageSize = Math.max(10, Math.min(100, Math.trunc(input.pageSize ?? 30)));
  const q = input.q?.trim().slice(0, 120) ?? "";
  const [review, categoryRows, reviewCategoryRows, taxonomyRows, promptRows, jobRows, models, textModels, catalog, runRows, agentRows, validationRows] = await Promise.all([
    queryAnnotationReviewWorkspace(db, input),
    db.prepare("SELECT category value, COUNT(DISTINCT sku_code) count FROM market_ranking_entries WHERE category <> '' GROUP BY category ORDER BY count DESC, value LIMIT 200").all<{ value: string; count: number }>(),
    db.prepare("SELECT category value, COUNT(DISTINCT job_id) jobCount, COUNT(*) recordCount FROM market_annotation_items WHERE category<>'' GROUP BY category ORDER BY jobCount DESC, recordCount DESC, value LIMIT 200").all<{ value: string; jobCount: number; recordCount: number }>(),
    db.prepare("SELECT category, subcategory value FROM market_subcategory_taxonomy WHERE status='active' ORDER BY category, sort_order, subcategory LIMIT 2000").all<{ category: string; value: string }>(),
    db.prepare(`SELECT ${promptColumns} FROM market_annotation_prompt_versions WHERE status<>'deleted' ORDER BY category, version DESC LIMIT 300`).all<PromptRow>(),
    db.prepare(`SELECT ${jobColumns} FROM market_annotation_jobs ORDER BY created_at DESC LIMIT 50`).all<JobRow>(),
    listAnnotationModels(db), listPromptTextModels(db), input.includeCatalog === false
      ? Promise.resolve({ items: [], page, pageSize, total: 0, pageCount: 1, query: q })
      : searchAnnotationCatalog(db, { q, page, pageSize }),
    db.prepare("SELECT id, category, baseline_prompt_id baselinePromptId, candidate_prompt_id candidatePromptId, model_id modelId, status, seed, requested_sample_count requestedSampleCount, sample_count sampleCount, sample_hash sampleHash, metrics_json metricsJson, gate_json gateJson, created_by createdBy, created_at createdAt, completed_at completedAt FROM market_annotation_validation_runs ORDER BY created_at DESC LIMIT 30").all<Record<string, unknown>>(),
    input.includeAgents ? db.prepare("SELECT id, name, status, capabilities_json capabilitiesJson, created_by createdBy, created_at createdAt, last_seen_at lastSeenAt, revoked_at revokedAt FROM market_annotation_local_agents ORDER BY created_at DESC LIMIT 50").all<Record<string, unknown>>() : Promise.resolve({ results: [] as Record<string, unknown>[] }),
    db.prepare("SELECT id, run_id runId, prompt_version_id promptVersionId, status, predicted_segment predictedSegment, predicted_image_price_cents predictedImagePriceCents, confidence_bps confidenceBps, is_correct isCorrect, error_message errorMessage, sample_snapshot_json sampleSnapshotJson FROM market_annotation_validation_results ORDER BY created_at DESC LIMIT 500").all<Record<string, unknown>>(),
  ]);
  return {
    categories: categoryRows.results ?? [], reviewCategories: reviewCategoryRows.results ?? [], taxonomy: taxonomyRows.results ?? [], prompts: (promptRows.results ?? []).map(promptValue), jobs: (jobRows.results ?? []).map(jobValue),
    ...review,
    models, textModels, catalog,
    validationRuns: (runRows.results ?? []).map((row) => ({ ...row, metrics: json(String(row.metricsJson ?? "{}"), {}), gate: json(String(row.gateJson ?? "{}"), {}) })),
    validationResults: (validationRows.results ?? []).map((row) => ({ ...row, ...snapshotView(String(row.sampleSnapshotJson ?? "{}")) })),
    agents: (agentRows.results ?? []).map((row) => ({ ...row, capabilities: json(String(row.capabilitiesJson ?? "{}"), {}) })),
  };
}

export async function setFilteredAnnotationSelection(db: MarketDatabase, input: {
  jobId?: string; aggregateJobs?: boolean; category?: string; categories?: string[]; selected: boolean; itemSegment?: string; storageStatus?: "pending" | "committed"; recognitionSource?: "ai" | "non_ai";
}, actor: Actor) {
  await ensureAnnotationSchema(db);
  const jobId = input.jobId?.trim() ?? "";
  const categories = annotationCategoryList(input.categories, input.category);
  const clauses = ["status IN ('review_pending','approved','rejected')"];
  const bindings: unknown[] = [];
  if (input.aggregateJobs) {
    const allowedStatuses = input.selected ? "'review_ready'" : "'running','review_ready'";
    clauses.unshift(`job_id IN (SELECT id FROM market_annotation_jobs WHERE status IN (${allowedStatuses})${categories.length ? ` AND category IN (${categories.map(() => "?").join(",")})` : ""})`);
    bindings.push(...categories);
  } else {
    const job = await db.prepare(`SELECT ${jobColumns} FROM market_annotation_jobs WHERE id=? LIMIT 1`).bind(jobId).first<JobRow>();
    const allowedStatuses = input.selected ? ["review_ready"] : ["running", "review_ready"];
    if (!job || !allowedStatuses.includes(job.status)) throw new Error(input.selected ? "任务尚未完成识别，暂不可批量入库" : "任务当前不可清空选择");
    clauses.unshift("job_id=?");
    bindings.push(jobId);
  }
  if (input.selected) clauses.push(annotationImportableClause());
  const itemSegment = input.itemSegment?.trim().slice(0, 120) ?? "";
  if (itemSegment) { clauses.push("COALESCE(NULLIF(reviewed_segment,''), ai_segment)=?"); bindings.push(itemSegment); }
  if (input.storageStatus === "committed") clauses.push("status='committed'");
  if (input.storageStatus === "pending") clauses.push("status<>'committed'");
  if (input.recognitionSource === "ai") clauses.push(aiRecognitionClause);
  if (input.recognitionSource === "non_ai") clauses.push(`NOT ${aiRecognitionClause}`);
  const where = clauses.join(" AND ");
  const count = await db.prepare(`SELECT COUNT(*) count FROM market_annotation_items WHERE ${where}`).bind(...bindings).first<{ count: number }>();
  const total = Number(count?.count ?? 0);
  if (input.selected && total > MAX_FILTERED_SELECTION) throw new Error(`当前筛选结果超过 ${MAX_FILTERED_SELECTION} 条，请缩小筛选范围后再全选`);
  if (!total) return { ok: true, changed: 0, selected: input.selected };
  const affectedJobs = await db.prepare(`SELECT DISTINCT job_id jobId FROM market_annotation_items WHERE ${where}`).bind(...bindings).all<{ jobId: string }>();
  const result = await db.prepare(`UPDATE market_annotation_items SET selected=?, status=?, reviewed_by=?, reviewed_at=CURRENT_TIMESTAMP, version=version+1, updated_at=CURRENT_TIMESTAMP WHERE ${where}`)
    .bind(input.selected ? 1 : 0, input.selected ? "approved" : "review_pending", actor.email, ...bindings).run();
  await Promise.all((affectedJobs.results ?? []).map((row) => refreshJob(db, row.jobId)));
  return { ok: true, changed: Number(result.meta.changes ?? 0), selected: input.selected };
}

export async function commitSelectedAnnotationItems(db: MarketDatabase, input: { jobId?: string; aggregateJobs?: boolean; category?: string; categories?: string[]; idempotencyKey: string }, actor: Actor) {
  await ensureAnnotationSchema(db);
  if (input.aggregateJobs) {
    const categories = annotationCategoryList(input.categories, input.category);
    const rows = await db.prepare(`SELECT i.id, i.job_id jobId FROM market_annotation_items i
      JOIN market_annotation_jobs j ON j.id=i.job_id
      JOIN market_annotation_prompt_versions p ON p.id=j.prompt_version_id
      WHERE i.status='approved' AND i.selected=1 AND j.status IN ('review_ready','committing')
        AND EXISTS (SELECT 1 FROM json_each(p.segments_json) segment WHERE CAST(segment.value AS TEXT)=i.reviewed_segment)
        ${categories.length ? `AND i.category IN (${categories.map(() => "?").join(",")})` : ""}
      ORDER BY j.created_at ASC, i.created_at, i.id LIMIT ${COMMIT_SELECTION_BATCH_SIZE}`).bind(...categories).all<{ id: string; jobId: string }>();
    const selected = rows.results ?? [];
    if (!selected.length) return { ok: true, committed: 0, duplicates: 0, jobs: 0, remainingSelected: 0, hasMore: false };
    const groups = new Map<string, string[]>();
    for (const row of selected) groups.set(row.jobId, [...(groups.get(row.jobId) ?? []), row.id]);
    let committed = 0;
    let duplicates = 0;
    let completedJobs = 0;
    for (const [selectedJobId, ids] of groups) {
      try {
        const result = await commitAnnotationItems(db, { jobId: selectedJobId, candidateIds: ids, idempotencyKey: input.idempotencyKey }, actor);
        committed += Number(result.committed ?? 0);
        duplicates += Number(result.duplicates ?? 0);
        completedJobs += 1;
        if (!result.ok) return { ...result, partial: committed > 0 || Boolean(result.partial), committed, duplicates, jobs: completedJobs, hasMore: true };
      } catch (error) {
        if (!committed && !duplicates) throw error;
        return { ok: false, partial: true, committed, duplicates, jobs: completedJobs, error: safeOperationalError(error, "跨任务入库部分成功，请刷新后继续处理剩余项目"), hasMore: true };
      }
    }
    const remaining = await db.prepare(`SELECT COUNT(*) count FROM market_annotation_items i
      JOIN market_annotation_jobs j ON j.id=i.job_id
      JOIN market_annotation_prompt_versions p ON p.id=j.prompt_version_id
      WHERE i.status='approved' AND i.selected=1 AND j.status='review_ready'
        AND EXISTS (SELECT 1 FROM json_each(p.segments_json) segment WHERE CAST(segment.value AS TEXT)=i.reviewed_segment)
        ${categories.length ? `AND i.category IN (${categories.map(() => "?").join(",")})` : ""}`).bind(...categories).first<{ count: number }>();
    const remainingSelected = Number(remaining?.count ?? 0);
    return { ok: true, committed, duplicates, jobs: completedJobs, remainingSelected, hasMore: remainingSelected > 0 };
  }
  const rows = await db.prepare(`SELECT i.id FROM market_annotation_items i
    JOIN market_annotation_jobs j ON j.id=i.job_id
    JOIN market_annotation_prompt_versions p ON p.id=j.prompt_version_id
    WHERE i.job_id=? AND i.status='approved' AND i.selected=1 AND j.status IN ('review_ready','committing')
      AND EXISTS (SELECT 1 FROM json_each(p.segments_json) segment WHERE CAST(segment.value AS TEXT)=i.reviewed_segment)
    ORDER BY i.created_at,i.id LIMIT ${COMMIT_SELECTION_BATCH_SIZE}`)
    .bind(input.jobId?.trim() ?? "").all<{ id: string }>();
  const ids = (rows.results ?? []).map((row) => row.id);
  if (!ids.length) return { ok: true, committed: 0, duplicates: 0, remainingSelected: 0, hasMore: false };
  const result = await commitAnnotationItems(db, { jobId: input.jobId ?? "", candidateIds: ids, idempotencyKey: input.idempotencyKey }, actor);
  const remaining = await db.prepare(`SELECT COUNT(*) count FROM market_annotation_items i
    JOIN market_annotation_jobs j ON j.id=i.job_id
    JOIN market_annotation_prompt_versions p ON p.id=j.prompt_version_id
    WHERE i.job_id=? AND i.status='approved' AND i.selected=1 AND j.status='review_ready'
      AND EXISTS (SELECT 1 FROM json_each(p.segments_json) segment WHERE CAST(segment.value AS TEXT)=i.reviewed_segment)`)
    .bind(input.jobId?.trim() ?? "").first<{ count: number }>();
  const remainingSelected = Number(remaining?.count ?? 0);
  return { ...result, remainingSelected, hasMore: remainingSelected > 0 };
}

export async function searchAnnotationCatalog(db: MarketDatabase, input: { q?: string; page?: number; pageSize?: number }) {
  const page = strictInteger(input.page, 1, 1, 50_000, "page");
  const pageSize = strictInteger(input.pageSize, 30, 10, 100, "pageSize");
  const q = input.q?.trim().slice(0, 120) ?? "";
  const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  const base = `WITH identity_market AS MATERIALIZED (
    SELECT m.* FROM market_master_identities identity
    JOIN market_ranking_entries m ON m.id=identity.latest_entry_id
  ), latest_market AS MATERIALIZED (
    SELECT * FROM (SELECT m.*, ROW_NUMBER() OVER (PARTITION BY m.category, m.sku_code ORDER BY m.period_end DESC, m.updated_at DESC, m.id DESC) rn FROM identity_market m) WHERE rn = 1
  ), latest_review AS (
    SELECT * FROM (SELECT i.*, j.category item_category, ROW_NUMBER() OVER (PARTITION BY j.category, i.sku_code ORDER BY i.updated_at DESC, i.id DESC) rn FROM market_annotation_items i JOIN market_annotation_jobs j ON j.id = i.job_id) WHERE rn = 1
  )`;
  const where = q ? "WHERE (m.sku_code LIKE ? ESCAPE '\\' OR m.product_name LIKE ? ESCAPE '\\' OR m.brand LIKE ? ESCAPE '\\' OR m.category LIKE ? ESCAPE '\\' OR a.segment LIKE ? ESCAPE '\\')" : "";
  const bindings = q ? [like, like, like, like, like] : [];
  const rows = await db.prepare(`${base} SELECT m.sku_code skuCode, m.product_name productName, m.brand, m.category,
      CASE WHEN mic.status='ready' THEN '/api/market/images/' || mic.content_sha256 ELSE m.image_url END imageUrl,
      COALESCE(mic.status, CASE WHEN m.image_url='' THEN 'missing' ELSE 'pending' END) imageCacheStatus,
      m.price_cents rankingPriceCents, a.id annotationId, a.segment finalSegment, a.image_price_cents finalImagePriceCents,
      COALESCE(r.status, CASE WHEN a.id IS NOT NULL THEN 'committed' ELSE 'unreviewed' END) reviewStatus,
      COUNT(*) OVER() fullCount
      FROM latest_market m LEFT JOIN market_image_cache mic ON mic.source_url=m.image_url
      LEFT JOIN market_sku_annotations a ON a.category=m.category AND a.sku_code=m.sku_code
      LEFT JOIN latest_review r ON r.item_category=m.category AND r.sku_code=m.sku_code ${where}
      ORDER BY m.category, m.sku_code LIMIT ? OFFSET ?`).bind(...bindings, pageSize, (page - 1) * pageSize).all<Record<string, unknown>>();
  const rawItems = rows.results ?? [];
  let total = Number(rawItems[0]?.fullCount ?? 0);
  if (!rawItems.length && page > 1) {
    const countRow = await db.prepare(`${base} SELECT COUNT(*) total FROM latest_market m
      LEFT JOIN market_sku_annotations a ON a.category=m.category AND a.sku_code=m.sku_code ${where}`).bind(...bindings).first<{ total: number }>();
    total = Number(countRow?.total ?? 0);
  }
  const items = rawItems.map((row) => {
    const item = { ...row };
    delete item.fullCount;
    return item;
  });
  return { items, page, pageSize, total, pageCount: Math.max(1, Math.ceil(total / pageSize)), query: q };
}

export async function createPromptVersion(db: MarketDatabase, input: { category: string; segments: unknown; promptBody: string; parentId?: string; source?: string; changeNote?: string }, actor: Actor) {
  await Promise.all([ensureMarketSchemaLazy(db), ensureAnnotationSchema(db)]);
  const category = input.category.trim().slice(0, 120);
  const requestedSegments = normalizeSegments(input.segments);
  const segments = await listMarketSubcategoryTaxonomy(db, category);
  if (segments.length < 2) throw new Error("该三级类目尚未配置细分品类，请先到细分品类设置中维护");
  if (requestedSegments.join("\u0000") !== segments.join("\u0000")) throw new Error("细分品类字典已更新，请刷新后再创建 Prompt");
  const promptBody = input.promptBody.trim();
  if (!category || promptBody.length < 40 || promptBody.length > 12_000) throw new Error("类目不能为空，Prompt 正文需在 40 到 12000 字符之间");
  let parent: PromptRow | null = null;
  if (input.parentId) {
    parent = await db.prepare(`SELECT ${promptColumns} FROM market_annotation_prompt_versions WHERE id = ? LIMIT 1`).bind(input.parentId).first<PromptRow>();
    if (!parent || parent.category !== category || parent.status === "deleted") throw new Error("父 Prompt 版本无效");
  }
  const last = await db.prepare("SELECT MAX(version) version FROM market_annotation_prompt_versions WHERE category = ?").bind(category).first<{ version: number | null }>();
  const id = `market-prompt-${randomUUID()}`;
  await db.prepare("INSERT INTO market_annotation_prompt_versions (id, category, version, parent_id, source, status, segments_json, prompt_body, change_note, created_by) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)")
    .bind(id, category, Number(last?.version ?? 0) + 1, parent?.id ?? null, input.source ?? "manual", JSON.stringify(segments), promptBody, input.changeNote?.trim().slice(0, 500) ?? "", actor.email).run();
  const row = await db.prepare(`SELECT ${promptColumns} FROM market_annotation_prompt_versions WHERE id = ?`).bind(id).first<PromptRow>();
  if (!row) throw new Error("Prompt 版本创建失败");
  return promptValue(row);
}

export async function generatePromptVersion(db: MarketDatabase, input: { textModelId: string; category: string; segments: unknown; parentId?: string; mode: "generate" | "evolve"; changeNote?: string }, actor: Actor) {
  await ensureMarketSchemaLazy(db);
  const requestedSegments = normalizeSegments(input.segments);
  const segments = await listMarketSubcategoryTaxonomy(db, input.category);
  if (segments.length < 2) throw new Error("该三级类目尚未配置细分品类，请先到细分品类设置中维护");
  if (requestedSegments.join("\u0000") !== segments.join("\u0000")) throw new Error("细分品类字典已更新，请刷新后再生成 Prompt");
  const parent = input.parentId ? await db.prepare(`SELECT ${promptColumns} FROM market_annotation_prompt_versions WHERE id = ?`).bind(input.parentId).first<PromptRow>() : null;
  const instruction = input.mode === "evolve"
    ? `你是视觉分类 Prompt 工程师。请仅根据通用品类规则改进下面的 Prompt，保持可审计、可复用，只输出完整新 Prompt 正文，不要代码围栏。不得请求、推断或复述冻结 holdout 的金标、预测或错误信息。\n三级类目：${input.category}\n固定枚举：${segments.join("、")}\n旧 Prompt：\n${parent?.prompt_body ?? ""}`
    : `你是电商视觉分类 Prompt 工程师。为三级类目“${input.category}”编写完整 Prompt。固定枚举：${segments.join("、")}。要求结合商品名与京东大图判断、提取主图明确展示的人民币价格、输出 segment/image_price_cents/confidence/reason 严格 JSON，只输出 Prompt 正文。`;
  const body = await runPromptTextCompletion(db, input.textModelId, instruction);
  if (!body) throw new Error("文本模型没有生成 Prompt");
  return createPromptVersion(db, { category: input.category, segments, promptBody: body, parentId: parent?.id, source: input.mode === "evolve" ? "evolved" : "ai_generated", changeNote: input.changeNote || (input.mode === "evolve" ? "AI 在不读取 holdout 的前提下生成候选" : "AI 生成初始候选") }, actor);
}

export async function createAnnotationJob(db: MarketDatabase, input: { category: string; promptVersionId: string; executor?: string; modelId?: string; localModelName?: string; limit?: number; allowInactivePrompt?: boolean }, actor: Actor) {
  await Promise.all([ensureMarketSchemaLazy(db), ensureAnnotationSchema(db)]);
  const category = input.category.trim().slice(0, 120);
  const prompt = await db.prepare("SELECT " + promptColumns + " FROM market_annotation_prompt_versions WHERE id=? LIMIT 1").bind(input.promptVersionId).first<PromptRow>();
  if (!prompt || prompt.category !== category || (!input.allowInactivePrompt && prompt.status !== "active")) throw new Error("只能使用该类目当前已激活的 Prompt 创建正式任务");
  await assertPromptTaxonomyCurrent(db, category, json<string[]>(prompt.segments_json, []), "Prompt 的细分品类枚举已过期，请使用当前字典创建并激活新版本");
  const executor = input.executor === "local" ? "local" : "cloud";
  if (executor === "cloud") {
    if (!input.modelId) throw new Error("云端任务必须选择视觉模型");
    const model = await db.prepare("SELECT id FROM ai_models WHERE id=? AND status='enabled' AND model_type IN ('vision','image')").bind(input.modelId).first<{ id: string }>();
    if (!model) throw new Error("所选云端视觉模型不存在或未启用");
  } else if (!input.localModelName?.trim()) throw new Error("本地任务必须填写 Ollama 模型名");
  const limit = normalizeMarketAnnotationJobLimit(input.limit);
  const promptSegments = json<string[]>(prompt.segments_json, []);
  const rows = await db.prepare(`
    WITH latest_market AS (
      SELECT * FROM (
        SELECT m.*, ROW_NUMBER() OVER (
          PARTITION BY m.category, m.scope, m.sku_code, m.ranking_dimension, substr(m.period_end, 1, 7)
          ORDER BY m.period_end DESC, m.updated_at DESC, m.id DESC
        ) rn
        FROM market_ranking_entries m
        WHERE m.category = ?
      ) WHERE rn = 1
    ), latest_standard_history AS (
      SELECT * FROM (
        SELECT history.category, history.scope, history.sku_code, history.ranking_dimension,
          history.image_content_sha256, history.confirmed_market_price_cents historical_price_cents,
          COALESCE(history.price_low_cents, history.confirmed_market_price_cents) historical_price_low_cents,
          COALESCE(history.price_high_cents, history.confirmed_market_price_cents) historical_price_high_cents,
          history.source_job_item_id,
          ROW_NUMBER() OVER (
            PARTITION BY history.category, history.scope, history.sku_code, history.ranking_dimension, history.image_content_sha256
            ORDER BY datetime(history.confirmed_at) DESC, datetime(history.updated_at) DESC, history.id DESC
          ) rn
        FROM market_price_snapshots history
        WHERE history.confirmed_market_price_cents IS NOT NULL
          AND history.ai_price_type='标准售价'
          AND history.image_content_sha256<>''
      ) WHERE rn=1
    ), latest_ai_history AS (
      SELECT * FROM (
        SELECT history.category, history.scope, history.sku_code, history.ranking_dimension,
          history.image_content_sha256, history.ai_segment, history.ai_image_price_cents,
          history.ai_price_type, history.ai_price_low_cents, history.ai_price_high_cents,
          history.ai_confidence_bps, history.ai_reason, history.ai_raw_digest,
          history.resolved_image_url, history.image_source,
          history_job.prompt_version_id, history_job.model_id,
          ROW_NUMBER() OVER (
            PARTITION BY history.category, history.scope, history.sku_code, history.ranking_dimension,
              history.image_content_sha256, history_job.prompt_version_id, history_job.model_id
            ORDER BY datetime(history.updated_at) DESC, history.id DESC
          ) rn
        FROM market_annotation_items history
        JOIN market_annotation_jobs history_job ON history_job.id=history.job_id
        WHERE history.status IN ('review_pending','approved','committed')
          AND history.ai_segment<>''
          AND history.image_content_sha256<>''
          AND history_job.executor='cloud'
      ) WHERE rn=1
    )
    SELECT ps.category, ps.scope, ps.sku_code, ps.ranking_dimension, ps.month,
      COALESCE(NULLIF(ps.image_content_sha256, ''), mic.content_sha256, '') image_content_sha256,
      lm.product_name, lm.brand, COALESCE(NULLIF(ps.image_url, ''), lm.image_url) image_url,
      history.historical_price_cents, history.historical_price_low_cents, history.historical_price_high_cents,
      history_item.category historical_item_category, history_item.reviewed_segment historical_segment,
      history_item.image_source historical_image_source,
      ai_history.ai_segment historical_ai_segment, ai_history.ai_image_price_cents historical_ai_image_price_cents,
      ai_history.ai_price_type historical_ai_price_type, ai_history.ai_price_low_cents historical_ai_price_low_cents,
      ai_history.ai_price_high_cents historical_ai_price_high_cents, ai_history.ai_confidence_bps historical_ai_confidence_bps,
      ai_history.ai_reason historical_ai_reason, ai_history.ai_raw_digest historical_ai_raw_digest,
      ai_history.resolved_image_url historical_ai_resolved_image_url, ai_history.image_source historical_ai_image_source
    FROM market_price_snapshots ps
    JOIN latest_market lm ON lm.category=ps.category AND lm.scope=ps.scope AND lm.sku_code=ps.sku_code
      AND lm.ranking_dimension=ps.ranking_dimension AND substr(lm.period_end, 1, 7)=ps.month
    LEFT JOIN market_image_cache mic ON mic.source_url=COALESCE(NULLIF(ps.image_url, ''), lm.image_url) AND mic.status='ready'
    LEFT JOIN latest_standard_history history ON history.category=ps.category AND history.scope=ps.scope
      AND history.sku_code=ps.sku_code AND history.ranking_dimension=ps.ranking_dimension
      AND history.image_content_sha256=COALESCE(NULLIF(ps.image_content_sha256, ''), mic.content_sha256, '')
    LEFT JOIN market_annotation_items history_item ON history_item.id=history.source_job_item_id
    LEFT JOIN latest_ai_history ai_history ON ai_history.category=ps.category AND ai_history.scope=ps.scope
      AND ai_history.sku_code=ps.sku_code AND ai_history.ranking_dimension=ps.ranking_dimension
      AND ai_history.image_content_sha256=COALESCE(NULLIF(ps.image_content_sha256, ''), mic.content_sha256, '')
      AND ai_history.prompt_version_id=? AND ai_history.model_id=?
    WHERE ps.category=?
      AND ps.confirmed_market_price_cents IS NULL
      AND COALESCE(NULLIF(ps.image_content_sha256, ''), mic.content_sha256, '') <> ''
    ORDER BY ps.month, ps.ranking_dimension, ps.sku_code
    LIMIT ?`)
    .bind(category, prompt.id, executor === "cloud" ? input.modelId : null, category, limit).all<{ category: string; scope: string; sku_code: string; ranking_dimension: string; month: string; image_content_sha256: string; product_name: string; brand: string; image_url: string; historical_price_cents: number | null; historical_price_low_cents: number | null; historical_price_high_cents: number | null; historical_item_category: string | null; historical_segment: string | null; historical_image_source: string | null; historical_ai_segment: string | null; historical_ai_image_price_cents: number | null; historical_ai_price_type: string | null; historical_ai_price_low_cents: number | null; historical_ai_price_high_cents: number | null; historical_ai_confidence_bps: number | null; historical_ai_reason: string | null; historical_ai_raw_digest: string | null; historical_ai_resolved_image_url: string | null; historical_ai_image_source: string | null }>();
  if (!rows.results.length) throw new Error("该三级类目没有已缓存图片且待确认的月度市场价格快照");
  const id = "market-job-" + randomUUID();
  const insertedJob = await db.prepare(`INSERT INTO market_annotation_jobs
      (id, category, prompt_version_id, executor, model_id, local_model_name, status, total_count, created_by)
    SELECT ?, ?, current_prompt.id, ?, ?, ?, 'queued', ?, ?
    FROM market_annotation_prompt_versions current_prompt
    WHERE current_prompt.id=? AND current_prompt.category=? AND current_prompt.status ${input.allowInactivePrompt ? "<>'deleted'" : "='active'"}
      AND (NOT EXISTS (SELECT 1 FROM market_subcategory_taxonomy taxonomy WHERE taxonomy.category=? AND taxonomy.status='active') OR (
        NOT EXISTS (SELECT 1 FROM market_subcategory_taxonomy taxonomy WHERE taxonomy.category=? AND taxonomy.status='active'
          AND NOT EXISTS (SELECT 1 FROM json_each(current_prompt.segments_json) segment WHERE CAST(segment.value AS TEXT)=taxonomy.subcategory))
        AND NOT EXISTS (SELECT 1 FROM json_each(current_prompt.segments_json) segment
          WHERE NOT EXISTS (SELECT 1 FROM market_subcategory_taxonomy taxonomy
            WHERE taxonomy.category=? AND taxonomy.status='active' AND taxonomy.subcategory=CAST(segment.value AS TEXT)))
      ))`)
    .bind(id, category, executor, executor === "cloud" ? input.modelId : null,
      executor === "local" ? input.localModelName!.trim().slice(0, 160) : "", rows.results.length, actor.email,
      prompt.id, category, category, category, category).run() as { meta?: { changes?: number } };
  if (!Number(insertedJob.meta?.changes ?? 0)) throw new Error("Prompt 或细分品类字典已变化，请刷新后重建任务");
  let insertedItems = 0;
  for (let offset = 0; offset < rows.results.length; offset += 80) {
    const inserted = await db.batch(rows.results.slice(offset, offset + 80).map((row) => {
      const inheritedPrice = row.historical_price_cents;
      const inheritedSegment = row.historical_item_category === row.category && row.historical_segment && promptSegments.includes(row.historical_segment) ? row.historical_segment : "";
      const reusedAi = inheritedPrice === null && Boolean(row.historical_ai_segment) && promptSegments.includes(row.historical_ai_segment!);
      return db.prepare(`INSERT INTO market_annotation_items
        (id, job_id, category, scope, sku_code, ranking_dimension, month, image_content_sha256, product_name, brand,
          source_image_url, resolved_image_url, image_source, status, ai_segment, ai_image_price_cents, ai_price_type,
          ai_price_low_cents, ai_price_high_cents, ai_confidence_bps, ai_reason, ai_raw_digest,
          reviewed_segment, reviewed_image_price_cents, reviewed_price_type, reviewed_price_low_cents,
          reviewed_price_high_cents, reviewed_by, reviewed_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?, ?,
          CASE WHEN ? IS NULL THEN NULL ELSE CURRENT_TIMESTAMP END
        WHERE EXISTS (SELECT 1 FROM market_price_snapshots snapshot
          JOIN market_ranking_entries ranking ON ranking.category=snapshot.category AND ranking.scope=snapshot.scope
            AND ranking.sku_code=snapshot.sku_code AND ranking.ranking_dimension=snapshot.ranking_dimension
            AND substr(ranking.period_end,1,7)=snapshot.month
          WHERE snapshot.category=? AND snapshot.scope=? AND snapshot.sku_code=? AND snapshot.ranking_dimension=?
            AND snapshot.month=? AND snapshot.image_content_sha256=? AND ranking.category=?)`)
        .bind("market-item-" + randomUUID(), id, row.category, row.scope, row.sku_code, row.ranking_dimension, row.month, row.image_content_sha256, row.product_name, row.brand,
          row.image_url,
          inheritedPrice !== null ? row.image_url : reusedAi ? (row.historical_ai_resolved_image_url || row.image_url) : "",
          inheritedPrice !== null ? (row.historical_image_source || "history_same_image") : reusedAi ? (row.historical_ai_image_source || "history_same_image") : "none",
          inheritedPrice !== null || reusedAi ? "review_pending" : "queued",
          reusedAi ? row.historical_ai_segment : "", reusedAi ? row.historical_ai_image_price_cents : null,
          reusedAi ? row.historical_ai_price_type : "", reusedAi ? row.historical_ai_price_low_cents : null,
          reusedAi ? row.historical_ai_price_high_cents : null, reusedAi ? row.historical_ai_confidence_bps : null,
          reusedAi ? row.historical_ai_reason : "", reusedAi ? row.historical_ai_raw_digest : "",
          inheritedPrice !== null ? inheritedSegment : reusedAi ? row.historical_ai_segment : "",
          inheritedPrice !== null ? inheritedPrice : reusedAi ? row.historical_ai_image_price_cents : null,
          inheritedPrice !== null ? "标准售价" : reusedAi ? row.historical_ai_price_type : "",
          inheritedPrice !== null ? row.historical_price_low_cents : reusedAi ? row.historical_ai_price_low_cents : null,
          inheritedPrice !== null ? row.historical_price_high_cents : reusedAi ? row.historical_ai_price_high_cents : null,
          inheritedPrice === null ? "" : HISTORY_SAME_IMAGE_REVIEWER, inheritedPrice,
          row.category, row.scope, row.sku_code, row.ranking_dimension, row.month, row.image_content_sha256, row.category);
    })) as Array<{ meta?: { changes?: number } }>;
    insertedItems += inserted.reduce((sum, result) => sum + Number(result.meta?.changes ?? 0), 0);
  }
  if (!insertedItems) {
    await db.prepare("DELETE FROM market_annotation_jobs WHERE id=? AND status='queued'").bind(id).run();
    throw new Error("候选价格快照已变化，请刷新后重建任务");
  }
  await refreshJob(db, id);
  const job = await db.prepare("SELECT " + jobColumns + " FROM market_annotation_jobs WHERE id=?").bind(id).first<JobRow>();
  if (!job) throw new Error("标注任务创建失败");
  return jobValue(job);
}

export async function createPriceRecognitionJob(db: MarketDatabase, input: { category: string; modelId: string; limit?: number }, actor: Actor) {
  await Promise.all([ensureMarketSchemaLazy(db), ensureAnnotationSchema(db)]);
  const category = input.category.trim().slice(0, 120);
  if (!category) throw new Error("请选择需要识别价格的类目");
  const categoryExists = await db.prepare("SELECT category FROM market_ranking_entries WHERE category=? LIMIT 1").bind(category).first<{ category: string }>();
  if (!categoryExists) throw new Error("所选类目不存在或尚未导入商品数据");

  let prompt = await db.prepare(`SELECT ${promptColumns} FROM market_annotation_prompt_versions WHERE category=? AND status='active' ORDER BY version DESC LIMIT 1`).bind(category).first<PromptRow>();
  if (!prompt) {
    prompt = await db.prepare(`SELECT ${promptColumns} FROM market_annotation_prompt_versions WHERE category=? AND source='system_price' ORDER BY version DESC LIMIT 1`).bind(category).first<PromptRow>();
  }
  if (!prompt) {
    const taxonomySegments = await listMarketSubcategoryTaxonomy(db, category);
    if (taxonomySegments.length < 2) throw new Error("该三级类目尚未配置细分品类，请先到细分品类设置中维护");
    const created = await createPromptVersion(db, {
      category,
      segments: taxonomySegments,
      promptBody: systemPriceRecognitionPrompt(category),
      source: "system_price",
      changeNote: "SKU 数据库一键识别价格使用的系统 Prompt；不替代人工验证后的细分类目 Prompt",
    }, actor);
    prompt = await db.prepare(`SELECT ${promptColumns} FROM market_annotation_prompt_versions WHERE id=?`).bind(created.id).first<PromptRow>();
  }
  if (!prompt) throw new Error("系统价格识别 Prompt 创建失败");
  return createAnnotationJob(db, {
    category,
    promptVersionId: prompt.id,
    executor: "cloud",
    modelId: input.modelId,
    limit: input.limit,
    allowInactivePrompt: true,
  }, actor);
}

async function reuseCloudAnnotationHistory(db: MarketDatabase, job: JobRow, limit = 40) {
  if (!job.model_id) return 0;
  const rows = await db.prepare(`
    SELECT * FROM (
      SELECT current.id, current.category, current.scope, current.sku_code, current.ranking_dimension,
        current.month, current.image_content_sha256,
        history.ai_segment, history.ai_image_price_cents, history.ai_price_type,
        history.ai_price_low_cents, history.ai_price_high_cents, history.ai_confidence_bps,
        history.ai_reason, history.ai_raw_digest, history.resolved_image_url, history.image_source,
        ROW_NUMBER() OVER (PARTITION BY current.id ORDER BY datetime(history.updated_at) DESC, history.id DESC) rn
      FROM market_annotation_items current
      JOIN market_annotation_items history ON history.job_id<>current.job_id
        AND history.category=current.category AND history.scope=current.scope
        AND history.sku_code=current.sku_code AND history.ranking_dimension=current.ranking_dimension
        AND history.image_content_sha256=current.image_content_sha256
      JOIN market_annotation_jobs history_job ON history_job.id=history.job_id
      WHERE current.job_id=? AND current.status IN ('queued','failed') AND current.attempt_count<3
        AND current.image_content_sha256<>''
        AND history.status IN ('review_pending','approved','committed')
        AND history.ai_segment<>''
        AND history_job.executor='cloud' AND history_job.prompt_version_id=? AND history_job.model_id=?
    ) WHERE rn=1 LIMIT ?`)
    .bind(job.id, job.prompt_version_id, job.model_id, limit).all<ReusableCloudAnnotationRow & { rn: number }>();
  if (!rows.results.length) return 0;
  const statements = rows.results.flatMap((row) => [
    db.prepare(`UPDATE market_annotation_items SET
        status='review_pending', ai_segment=?, ai_image_price_cents=?, ai_price_type=?,
        ai_price_low_cents=?, ai_price_high_cents=?, ai_confidence_bps=?, ai_reason=?, ai_raw_digest=?,
        reviewed_segment=?, reviewed_image_price_cents=?, reviewed_price_type=?,
        reviewed_price_low_cents=?, reviewed_price_high_cents=?, resolved_image_url=?, image_source=?,
        error_message='', lease_token_hash='', lease_agent_id='', lease_expires_at=NULL,
        version=version+1, updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND job_id=? AND status IN ('queued','failed') AND attempt_count<3`)
      .bind(row.ai_segment, row.ai_image_price_cents, row.ai_price_type,
        row.ai_price_low_cents, row.ai_price_high_cents, row.ai_confidence_bps, row.ai_reason, row.ai_raw_digest,
        row.ai_segment, row.ai_image_price_cents, row.ai_price_type,
        row.ai_price_low_cents, row.ai_price_high_cents, row.resolved_image_url, row.image_source,
        row.id, job.id),
    db.prepare(`UPDATE market_price_snapshots SET
        ai_image_price_cents=?, ai_price_type=?, ai_confidence_bps=?, ai_reason=?,
        price_low_cents=COALESCE(?, price_low_cents), price_high_cents=COALESCE(?, price_high_cents),
        confirmation_status='ai_pending', source_job_item_id=?, prompt_version_id=?, updated_at=CURRENT_TIMESTAMP
      WHERE category=? AND scope=? AND sku_code=? AND ranking_dimension=? AND month=?
        AND image_content_sha256=? AND confirmed_market_price_cents IS NULL`)
      .bind(row.ai_image_price_cents, row.ai_price_type, row.ai_confidence_bps, row.ai_reason,
        row.ai_price_low_cents, row.ai_price_high_cents, row.id, job.prompt_version_id,
        row.category, row.scope, row.sku_code, row.ranking_dimension, row.month, row.image_content_sha256),
  ]);
  await db.batch(statements);
  return rows.results.length;
}

function cloudFailureKind(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/状态码\s*429|rate limit|限流|额度不足/i.test(message)) return { failureKind: "rate_limit", retryAfterMs: 60_000 } as const;
  if (/网络错误|调用超时|timeout|fetch failed/i.test(message)) return { failureKind: "transient", retryAfterMs: 5_000 } as const;
  return { failureKind: "permanent", retryAfterMs: 0 } as const;
}

export async function runNextCloudAnnotation(db: MarketDatabase, jobId: string) {
  await ensureAnnotationSchema(db);
  const job = await db.prepare("SELECT " + jobColumns + " FROM market_annotation_jobs WHERE id=? LIMIT 1").bind(jobId).first<JobRow>();
  if (!job || job.executor !== "cloud" || !job.model_id) throw new Error("云端标注任务不存在");
  if (["cancelled", "committed"].includes(job.status)) throw new Error("该任务当前不能继续执行");
  const prompt = await db.prepare("SELECT " + promptColumns + " FROM market_annotation_prompt_versions WHERE id=?").bind(job.prompt_version_id).first<PromptRow>();
  if (!prompt) throw new Error("任务绑定的 Prompt 版本不存在");
  await db.prepare("UPDATE market_annotation_items SET status=CASE WHEN attempt_count>=3 THEN 'failed' ELSE 'queued' END, lease_token_hash='', lease_agent_id='', lease_expires_at=NULL, error_message=CASE WHEN attempt_count>=3 THEN '推理租约连续超时，已达到最大尝试次数' ELSE error_message END, version=version+1, updated_at=CURRENT_TIMESTAMP WHERE job_id=? AND status='inferencing' AND lease_expires_at IS NOT NULL AND datetime(lease_expires_at)<=datetime('now')")
    .bind(jobId).run();
  const reusedCount = await reuseCloudAnnotationHistory(db, job);
  if (reusedCount) {
    await refreshJob(db, jobId);
    return { done: false, reusedCount, job: await getJob(db, jobId) };
  }
  const candidate = await db.prepare("SELECT " + itemColumns + " FROM market_annotation_items WHERE job_id=? AND status IN ('queued','failed') AND attempt_count < 3 ORDER BY CASE status WHEN 'queued' THEN 0 ELSE 1 END, updated_at LIMIT 1").bind(jobId).first<ItemRow>();
  if (!candidate) {
    await refreshJob(db, jobId);
    const active = await db.prepare("SELECT COUNT(*) count FROM market_annotation_items WHERE job_id=? AND status='inferencing'").bind(jobId).first<{ count: number }>();
    return { done: Number(active?.count ?? 0) === 0, waiting: Number(active?.count ?? 0) > 0, job: await getJob(db, jobId) };
  }
  const claimToken = randomBytes(24).toString("hex");
  const claimHash = digest(claimToken);
  const claimed = await db.prepare("UPDATE market_annotation_items SET status='inferencing', lease_token_hash=?, lease_agent_id='cloud', lease_expires_at=datetime('now','+2 minutes'), attempt_count=attempt_count+1, error_message='', version=version+1, updated_at=CURRENT_TIMESTAMP WHERE id=? AND version=? AND status IN ('queued','failed') AND attempt_count<3")
    .bind(claimHash, candidate.id, candidate.version).run();
  if (!Number(claimed.meta.changes ?? 0)) return { done: false, raced: true };
  await db.prepare("UPDATE market_annotation_jobs SET status='running', started_at=COALESCE(started_at,CURRENT_TIMESTAMP), updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('queued','failed','running')").bind(jobId).run();
  let failure: ReturnType<typeof cloudFailureKind> | null = null;
  try {
    const result = await runVisionAnnotation({ db, modelId: job.model_id, promptBody: prompt.prompt_body, segments: json(prompt.segments_json, []), skuCode: candidate.sku_code, productName: candidate.product_name, brand: candidate.brand, imageUrl: candidate.source_image_url });
    await db.prepare("UPDATE market_annotation_items SET status='review_pending', ai_segment=?, ai_image_price_cents=?, ai_price_type=?, ai_price_low_cents=?, ai_price_high_cents=?, ai_confidence_bps=?, ai_reason=?, ai_raw_digest=?, reviewed_segment=?, reviewed_image_price_cents=?, reviewed_price_type=?, reviewed_price_low_cents=?, reviewed_price_high_cents=?, resolved_image_url=?, image_source=?, lease_token_hash='', lease_agent_id='', lease_expires_at=NULL, version=version+1, updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='inferencing' AND lease_token_hash=? AND datetime(lease_expires_at)>datetime('now')")
      .bind(result.segment, result.imagePriceCents, result.priceType, result.priceLowCents, result.priceHighCents, result.confidenceBps, result.reason, result.rawDigest, result.segment, result.imagePriceCents, result.priceType, result.priceLowCents, result.priceHighCents, result.resolvedImageUrl, result.imageSource, candidate.id, claimHash).run();
    await db.prepare(`UPDATE market_price_snapshots SET
        ai_image_price_cents=?, ai_price_type=?, ai_confidence_bps=?, ai_reason=?,
        price_low_cents=COALESCE(?, price_low_cents), price_high_cents=COALESCE(?, price_high_cents),
        confirmation_status='ai_pending', source_job_item_id=?, prompt_version_id=?, updated_at=CURRENT_TIMESTAMP
      WHERE category=? AND scope=? AND sku_code=? AND ranking_dimension=? AND month=?
        AND image_content_sha256=? AND confirmed_market_price_cents IS NULL`)
      .bind(result.imagePriceCents, result.priceType, result.confidenceBps, result.reason,
        result.priceLowCents, result.priceHighCents, candidate.id, job.prompt_version_id,
        candidate.category, candidate.scope, candidate.sku_code, candidate.ranking_dimension, candidate.month, candidate.image_content_sha256).run();
  } catch (error) {
    failure = cloudFailureKind(error);
    await db.prepare("UPDATE market_annotation_items SET status='failed', error_message=?, lease_token_hash='', lease_agent_id='', lease_expires_at=NULL, version=version+1, updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='inferencing' AND lease_token_hash=? AND datetime(lease_expires_at)>datetime('now')")
      .bind(safeOperationalError(error, "识别失败"), candidate.id, claimHash).run();
  }
  await refreshJob(db, jobId);
  return { done: false, itemId: candidate.id, ...(failure ?? {}), job: await getJob(db, jobId) };
}

export async function updateAnnotationItems(db: MarketDatabase, jobId: string, updates: Array<{ id: string; version: number; segment: string; imagePriceCents: unknown; priceType?: string; priceLowCents?: unknown; priceHighCents?: unknown; selected: boolean }>, actor: Actor) {
  if (!updates.length || updates.length > 500) throw new Error("每次必须更新 1 到 500 个明确候选项");
  const job = await db.prepare("SELECT " + jobColumns + " FROM market_annotation_jobs WHERE id=?").bind(jobId).first<JobRow>();
  if (!job) throw new Error("任务不存在");
  if (!["running", "review_ready"].includes(job.status)) throw new Error("任务当前不可复核");
  const prompt = await db.prepare("SELECT " + promptColumns + " FROM market_annotation_prompt_versions WHERE id=?").bind(job.prompt_version_id).first<PromptRow>();
  if (!prompt) throw new Error("Prompt 版本不存在");
  const segments = json<string[]>(prompt.segments_json, []);
  const seen = new Set<string>();
  const mutex = await acquireJobMutex(db, jobId, false);
  try {
    const statements = [];
    for (const update of updates) {
      if (!update.id || seen.has(update.id) || !Number.isSafeInteger(update.version)) throw new Error("候选项 ID 为空、重复或版本无效");
      seen.add(update.id);
      const segment = update.segment.trim();
      if (!segments.includes(segment)) throw new Error("细分品类不在 Prompt 枚举中：" + segment);
      const price = normalizeImagePriceCents(update.imagePriceCents);
      const priceType = typeof update.priceType === "string" && update.priceType.trim() ? update.priceType.trim().slice(0, 40) : "";
      const priceLow = normalizeImagePriceCents(update.priceLowCents);
      const priceHigh = normalizeImagePriceCents(update.priceHighCents);
      const current = await db.prepare("SELECT status, version, COALESCE(NULLIF(reviewed_segment,''), ai_segment) effectiveSegment, reviewed_image_price_cents reviewedImagePriceCents FROM market_annotation_items WHERE id=? AND job_id=?")
        .bind(update.id, jobId).first<{ status: string; version: number; effectiveSegment: string; reviewedImagePriceCents: number | null }>();
      if (!current || !["review_pending", "approved", "rejected"].includes(current.status)) throw new Error("候选项 " + update.id + " 当前不可复核，请刷新后重试");
      const reviewContentUnchanged = current.effectiveSegment === segment && current.reviewedImagePriceCents === price;
      if (current.version !== update.version && !reviewContentUnchanged) throw new Error("候选项 " + update.id + " 的复核内容已被他人修改，系统已停止覆盖，请刷新后核对");
      const effectiveVersion = current.version;
      statements.push(db.prepare("UPDATE market_annotation_items SET reviewed_segment=?, reviewed_image_price_cents=?, reviewed_price_type=COALESCE(NULLIF(?, ''), reviewed_price_type), reviewed_price_low_cents=COALESCE(?, reviewed_price_low_cents), reviewed_price_high_cents=COALESCE(?, reviewed_price_high_cents), selected=?, status=?, reviewed_by=?, reviewed_at=CURRENT_TIMESTAMP, version=version+1, updated_at=CURRENT_TIMESTAMP WHERE id=? AND job_id=? AND version=? AND status IN ('review_pending','approved','rejected')")
        .bind(segment, price, priceType, priceLow, priceHigh, update.selected ? 1 : 0, update.selected ? "approved" : "review_pending", actor.email, update.id, jobId, effectiveVersion));
    }
    await db.batch(statements);
    await releaseJobMutex(db, jobId, mutex, false);
    await refreshJob(db, jobId);
    return { ok: true, changed: updates.length };
  } catch (error) {
    await releaseJobMutex(db, jobId, mutex, false).catch(() => undefined);
    throw error;
  }
}

export async function commitAnnotationItems(db: MarketDatabase, input: { jobId: string; candidateIds: string[]; idempotencyKey: string }, actor: Actor) {
  await ensureMarketSchemaLazy(db);
  await ensureAnnotationSchema(db);
  const ids = [...new Set(input.candidateIds.map((id) => id.trim()).filter(Boolean))];
  if (!ids.length || ids.length > 500 || ids.length !== input.candidateIds.length) throw new Error("必须提交 1 到 500 个不重复的明确 candidate/item ID");
  const idempotencyKey = input.idempotencyKey.trim();
  if (!/^[A-Za-z0-9:_-]{12,160}$/.test(idempotencyKey)) throw new Error("批量入库幂等键无效");
  const job = await db.prepare("SELECT " + jobColumns + " FROM market_annotation_jobs WHERE id=?").bind(input.jobId).first<JobRow>();
  if (!job) throw new Error("任务不存在");
  const prompt = await db.prepare("SELECT " + promptColumns + " FROM market_annotation_prompt_versions WHERE id=?").bind(job.prompt_version_id).first<PromptRow>();
  const segments = prompt ? json<string[]>(prompt.segments_json, []) : [];
  await assertPromptTaxonomyCurrent(db, job.category, segments, "任务绑定的 Prompt 枚举已不是当前细分品类字典，禁止继续入库");
  const requestDigest = digest(JSON.stringify({ jobId: job.id, ids: [...ids].sort(), idempotencyKey }));
  const batchId = "market-commit-batch-" + digest(`${job.id}:${idempotencyKey}`).slice(0, 32);
  const priorBatch = await db.prepare("SELECT request_digest requestDigest, COUNT(*) count FROM market_annotation_commit_receipts WHERE batch_id=? GROUP BY request_digest LIMIT 1").bind(batchId).first<{ requestDigest: string; count: number }>();
  if (priorBatch && priorBatch.requestDigest !== requestDigest) throw new Error("幂等键已用于不同的提交请求");
  if (priorBatch && Number(priorBatch.count) === ids.length) return { ok: true, committed: 0, duplicates: ids.length, batchId, job: await getJob(db, job.id) };
  if (!["review_ready", "committing"].includes(job.status)) throw new Error("任务必须完成识别并进入待复核状态后才能入库");

  const mutex = await acquireJobMutex(db, job.id, true);
  try {
    const prepared: Array<{ item: ItemRow; old: Record<string, unknown> | null; annotationId: string; after: Record<string, unknown>; receiptKey: string }> = [];
    const committedAt = new Date().toISOString();
    let duplicates = 0;
    for (const itemId of ids) {
      const receiptKey = idempotencyKey + ":" + itemId;
      const receipt = await db.prepare("SELECT request_digest requestDigest FROM market_annotation_commit_receipts WHERE job_item_id=? OR idempotency_key=? LIMIT 1").bind(itemId, receiptKey).first<{ requestDigest: string }>();
      if (receipt) {
        if (receipt.requestDigest !== requestDigest) throw new Error("候选项已由不同请求入库：" + itemId);
        duplicates += 1;
        continue;
      }
      const item = await db.prepare("SELECT " + itemColumns + " FROM market_annotation_items WHERE id=? AND job_id=?").bind(itemId, job.id).first<ItemRow>();
      if (!item) throw new Error("候选项不存在：" + itemId);
      if (item.status !== "approved" || !item.selected || !segments.includes(item.reviewed_segment)) throw new Error("候选项 " + itemId + " 未经勾选批准或品类无效");
      const targetSnapshot = await db.prepare(`SELECT snapshot.id FROM market_price_snapshots snapshot
        WHERE snapshot.category=? AND snapshot.scope=? AND snapshot.sku_code=? AND snapshot.ranking_dimension=?
          AND snapshot.month=? AND snapshot.image_content_sha256=?
          AND EXISTS (SELECT 1 FROM market_ranking_entries ranking WHERE ranking.category=snapshot.category
            AND ranking.scope=snapshot.scope AND ranking.sku_code=snapshot.sku_code
            AND ranking.ranking_dimension=snapshot.ranking_dimension) LIMIT 1`)
        .bind(item.category || job.category, item.scope, item.sku_code, item.ranking_dimension, item.month, item.image_content_sha256).first<{ id: string }>();
      if (!targetSnapshot) throw new Error("候选项 " + itemId + " 对应的榜单身份、价格快照或图片版本已变化，请重建任务后再入库");
      const old = await db.prepare("SELECT id, category, sku_code skuCode, segment, image_price_cents imagePriceCents, image_url imageUrl, image_source imageSource, confidence_bps confidenceBps, source_job_item_id sourceJobItemId, prompt_version_id promptVersionId, reviewed_by reviewedBy, reviewed_at reviewedAt, version, created_at createdAt, updated_at updatedAt FROM market_sku_annotations WHERE category=? AND sku_code=?")
        .bind(job.category, item.sku_code).first<Record<string, unknown>>();
      const annotationId = String(old?.id ?? ("market-annotation-" + randomUUID()));
      const after = { id: annotationId, category: job.category, skuCode: item.sku_code, rankingDimension: item.ranking_dimension, month: item.month, imageContentSha256: item.image_content_sha256, segment: item.reviewed_segment, imagePriceCents: item.reviewed_image_price_cents, priceType: item.reviewed_price_type || item.ai_price_type, priceLowCents: item.reviewed_price_low_cents, priceHighCents: item.reviewed_price_high_cents, imageUrl: item.resolved_image_url || item.source_image_url, imageSource: item.image_source, confidenceBps: item.ai_confidence_bps, sourceJobItemId: item.id, promptVersionId: job.prompt_version_id, reviewedBy: actor.email, reviewedAt: committedAt, version: Number(old?.version ?? 0) + 1, createdAt: old?.createdAt ?? committedAt, updatedAt: committedAt, batchId, requestDigest };
      prepared.push({ item, old, annotationId, after, receiptKey });
    }
    let committed = 0;
    for (let offset = 0; offset < prepared.length; offset += 25) {
      const chunk = prepared.slice(offset, offset + 25);
      const statements = chunk.flatMap(({ item, old, annotationId, after, receiptKey }) => {
        const priceType = item.reviewed_price_type || item.ai_price_type || "无法判断";
        const formalPrice = ["定金", "分期金额", "无法判断"].includes(priceType) ? null : item.reviewed_image_price_cents;
        const status = formalPrice === null ? "review_pending" : "confirmed";
        const snapshotGuardId = "market-snapshot-guard-" + randomUUID();
        return [
          db.prepare(`INSERT INTO market_master_audit_logs
            (id, actor_email, actor_role, action, entity_type, entity_id, before_json, after_json)
            SELECT CASE WHEN EXISTS (SELECT 1 FROM market_price_snapshots
              WHERE category=? AND scope=? AND sku_code=? AND ranking_dimension=? AND month=? AND image_content_sha256=?
                AND EXISTS (SELECT 1 FROM market_ranking_entries ranking
                  WHERE ranking.category=market_price_snapshots.category AND ranking.scope=market_price_snapshots.scope
                    AND ranking.sku_code=market_price_snapshots.sku_code
                    AND ranking.ranking_dimension=market_price_snapshots.ranking_dimension)
            ) THEN ? ELSE NULL END, ?, ?, 'market_annotation_snapshot_guard', 'market_price_snapshot', ?, '{}', '{}'`)
            .bind(item.category || job.category, item.scope, item.sku_code, item.ranking_dimension, item.month, item.image_content_sha256,
              snapshotGuardId, actor.email, actor.role, `${item.category || job.category}|${item.scope}|${item.ranking_dimension}|${item.sku_code}|${item.month}`),
          db.prepare("INSERT INTO market_sku_annotations (id, category, sku_code, segment, image_price_cents, image_url, image_source, confidence_bps, source_job_item_id, prompt_version_id, reviewed_by, reviewed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(category, sku_code) DO UPDATE SET segment=excluded.segment, image_price_cents=excluded.image_price_cents, image_url=excluded.image_url, image_source=excluded.image_source, confidence_bps=excluded.confidence_bps, source_job_item_id=excluded.source_job_item_id, prompt_version_id=excluded.prompt_version_id, reviewed_by=excluded.reviewed_by, reviewed_at=CURRENT_TIMESTAMP, version=market_sku_annotations.version+1, updated_at=CURRENT_TIMESTAMP")
            .bind(annotationId, job.category, item.sku_code, item.reviewed_segment, item.reviewed_image_price_cents, after.imageUrl, item.image_source, item.ai_confidence_bps, item.id, job.prompt_version_id, actor.email),
          db.prepare(`UPDATE market_price_snapshots SET
            ai_image_price_cents=?, ai_price_type=?, ai_confidence_bps=?, ai_reason=?,
            price_low_cents=COALESCE(?, price_low_cents), price_high_cents=COALESCE(?, price_high_cents),
            confirmed_market_price_cents=?, image_content_sha256=?,
            image_url=CASE WHEN ? <> '' THEN ? ELSE image_url END,
            confirmation_status=?, confirmed_by=?, confirmed_at=CASE WHEN ? IS NULL THEN confirmed_at ELSE CURRENT_TIMESTAMP END,
            source_job_item_id=?, prompt_version_id=?, updated_at=CURRENT_TIMESTAMP
            WHERE category=? AND scope=? AND sku_code=? AND ranking_dimension=? AND month=?
              AND image_content_sha256=?`)
            .bind(item.ai_image_price_cents, priceType, item.ai_confidence_bps, item.ai_reason, item.reviewed_price_low_cents, item.reviewed_price_high_cents, formalPrice, item.image_content_sha256, after.imageUrl, after.imageUrl, status, actor.email, formalPrice, item.id, job.prompt_version_id, item.category || job.category, item.scope, item.sku_code, item.ranking_dimension, item.month, item.image_content_sha256),
          db.prepare(`UPDATE market_price_snapshots SET
            confirmed_market_price_cents=?, confirmation_status='confirmed', confirmed_by=?, confirmed_at=CURRENT_TIMESTAMP,
            source_job_item_id=?, prompt_version_id=?, updated_at=CURRENT_TIMESTAMP
            WHERE category=? AND scope=? AND sku_code=? AND ranking_dimension=? AND image_content_sha256=?
              AND month IN (strftime('%Y-%m', date(? || '-01', '-1 month')), strftime('%Y-%m', date(? || '-01', '+1 month')))
              AND confirmed_market_price_cents IS NULL AND ? IS NOT NULL`)
            .bind(formalPrice, actor.email, item.id, job.prompt_version_id, item.category || job.category, item.scope, item.sku_code, item.ranking_dimension, item.image_content_sha256, item.month, item.month, formalPrice),
          db.prepare("UPDATE market_ranking_entries SET subcategory=?, source_subcategory=?, updated_at=CURRENT_TIMESTAMP WHERE category=? AND scope=? AND sku_code=? AND ranking_dimension=?")
            .bind(item.reviewed_segment, item.reviewed_segment, item.category || job.category, item.scope, item.sku_code, item.ranking_dimension),
          db.prepare("INSERT INTO market_annotation_commit_receipts (id, job_item_id, annotation_id, idempotency_key, before_json, after_json, committed_by, batch_id, request_digest) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .bind("market-commit-" + randomUUID(), item.id, annotationId, receiptKey, JSON.stringify(old ?? {}), JSON.stringify(after), actor.email, batchId, requestDigest),
          db.prepare("UPDATE market_annotation_items SET status='committed', selected=0, version=version+1, updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='approved' AND selected=1 AND version=?").bind(item.id, item.version),
          db.prepare("DELETE FROM market_master_audit_logs WHERE id=? AND action='market_annotation_snapshot_guard'").bind(snapshotGuardId),
        ];
      });
      try { await db.batch(statements); committed += chunk.length; }
      catch (error) {
        await releaseJobMutex(db, job.id, mutex, true);
        await refreshJob(db, job.id);
        return { ok: false, partial: committed > 0, committed, duplicates, failed: prepared.length - committed, batchId, requestDigest, error: safeOperationalError(error, "入库批次执行失败，可使用相同幂等键安全续跑"), job: await getJob(db, job.id) };
      }
    }
    await releaseJobMutex(db, job.id, mutex, true);
    await refreshJob(db, job.id);
    return { ok: true, committed, duplicates, batchId, requestDigest, job: await getJob(db, job.id) };
  } catch (error) {
    await releaseJobMutex(db, job.id, mutex, true).catch(() => undefined);
    throw error;
  }
}

export async function markAnnotationsAsGold(db: MarketDatabase, annotationIds: string[], actor: Actor) {
  const ids = [...new Set(annotationIds.map((id) => id.trim()).filter(Boolean))];
  if (!ids.length || ids.length > 500) throw new Error("请选择 1 到 500 条已复核细分品类数据");
  let saved = 0;
  for (const id of ids) {
    const row = await db.prepare("SELECT id, category, sku_code, segment, image_price_cents, image_url FROM market_sku_annotations WHERE id=?").bind(id).first<{ id: string; category: string; sku_code: string; segment: string; image_price_cents: number | null; image_url: string }>();
    if (!row) throw new Error("细分品类记录不存在：" + id);
    const market = await db.prepare("SELECT product_name, brand FROM market_ranking_entries WHERE category=? AND sku_code=? ORDER BY period_end DESC, updated_at DESC LIMIT 1").bind(row.category, row.sku_code).first<{ product_name: string; brand: string }>();
    await db.prepare("INSERT INTO market_annotation_validation_samples (id, category, sku_code, product_name, brand, image_url, gold_segment, gold_image_price_cents, source_annotation_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(category, sku_code) DO UPDATE SET product_name=excluded.product_name, brand=excluded.brand, image_url=excluded.image_url, gold_segment=excluded.gold_segment, gold_image_price_cents=excluded.gold_image_price_cents, source_annotation_id=excluded.source_annotation_id, created_by=excluded.created_by, created_at=CURRENT_TIMESTAMP")
      .bind("market-gold-" + randomUUID(), row.category, row.sku_code, market?.product_name ?? "", market?.brand ?? "", row.image_url, row.segment, row.image_price_cents, row.id, actor.email).run();
    saved += 1;
  }
  return { ok: true, saved };
}

async function acquireJobMutex(db: MarketDatabase, jobId: string, forCommit: boolean) {
  await db.prepare("UPDATE market_annotation_jobs SET status=CASE WHEN status='committing' THEN 'review_ready' ELSE status END, commit_token_hash='', commit_started_at=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=? AND commit_token_hash<>'' AND datetime(commit_started_at)<=datetime('now','-5 minutes')")
    .bind(jobId).run();
  const token = randomBytes(24).toString("hex");
  const tokenHash = digest(token);
  const result = forCommit
    ? await db.prepare("UPDATE market_annotation_jobs SET status='committing', commit_token_hash=?, commit_started_at=datetime('now'), updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='review_ready' AND commit_token_hash=''").bind(tokenHash, jobId).run()
    : await db.prepare("UPDATE market_annotation_jobs SET commit_token_hash=?, commit_started_at=datetime('now'), updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('running','review_ready') AND commit_token_hash=''").bind(tokenHash, jobId).run();
  if (!Number(result.meta.changes ?? 0)) throw new Error(forCommit ? "任务正在复核或入库，请稍后重试" : "任务正在执行入库，请刷新后重试");
  return tokenHash;
}

async function releaseJobMutex(db: MarketDatabase, jobId: string, tokenHash: string, forCommit: boolean) {
  await db.prepare(`UPDATE market_annotation_jobs SET status=CASE WHEN ?=1 AND status='committing' THEN 'review_ready' ELSE status END, commit_token_hash='', commit_started_at=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=? AND commit_token_hash=?`)
    .bind(forCommit ? 1 : 0, jobId, tokenHash).run();
}

async function getJob(db: MarketDatabase, id: string) {
  const row = await db.prepare("SELECT " + jobColumns + " FROM market_annotation_jobs WHERE id=?").bind(id).first<JobRow>();
  return row ? jobValue(row) : null;
}

async function refreshJob(db: MarketDatabase, jobId: string) {
  const counts = await db.prepare("SELECT COUNT(*) total, SUM(CASE WHEN status IN ('review_pending','approved','rejected','committed') THEN 1 ELSE 0 END) completed, SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed, SUM(CASE WHEN status IN ('approved','rejected','committed') THEN 1 ELSE 0 END) reviewed, SUM(CASE WHEN status='committed' THEN 1 ELSE 0 END) committed, SUM(CASE WHEN status IN ('queued','claimed','inferencing') THEN 1 ELSE 0 END) remaining FROM market_annotation_items WHERE job_id=?")
    .bind(jobId).first<Record<string, number>>();
  if (!counts) return;
  const current = await db.prepare("SELECT status FROM market_annotation_jobs WHERE id=?").bind(jobId).first<{ status: string }>();
  let status = current?.status ?? "running";
  if (!["cancelled", "committed"].includes(status)) {
    if (Number(counts.committed) === Number(counts.total) && Number(counts.total) > 0) status = "committed";
    else if (Number(counts.remaining) === 0) status = "review_ready";
    else status = "running";
  }
  await db.prepare("UPDATE market_annotation_jobs SET status=?, total_count=?, completed_count=?, failed_count=?, reviewed_count=?, committed_count=?, completed_at=CASE WHEN ? IN ('review_ready','committed') THEN CURRENT_TIMESTAMP ELSE completed_at END, updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .bind(status, Number(counts.total), Number(counts.completed), Number(counts.failed), Number(counts.reviewed), Number(counts.committed), status, jobId).run();
}

export async function createValidationRun(db: MarketDatabase, input: { candidatePromptId: string; modelId: string; sampleCount?: number; seed?: string }, actor: Actor) {
  await ensureAnnotationSchema(db);
  await ensureMarketSchemaLazy(db);
  const candidate = await db.prepare("SELECT " + promptColumns + " FROM market_annotation_prompt_versions WHERE id=?").bind(input.candidatePromptId).first<PromptRow>();
  if (!candidate) throw new Error("候选 Prompt 不存在");
  await assertPromptTaxonomyCurrent(db, candidate.category, json<string[]>(candidate.segments_json, []), "候选 Prompt 的细分品类枚举已过期，不能创建冻结验证");
  const baseline = await db.prepare("SELECT " + promptColumns + " FROM market_annotation_prompt_versions WHERE category=? AND status='active' LIMIT 1").bind(candidate.category).first<PromptRow>();
  if (baseline) await assertPromptTaxonomyCurrent(db, baseline.category, json<string[]>(baseline.segments_json, []), "基线 Prompt 的细分品类枚举已过期，不能创建冻结验证");
  const model = await db.prepare("SELECT id FROM ai_models WHERE id=? AND status='enabled' AND model_type IN ('vision','image')").bind(input.modelId).first<{ id: string }>();
  if (!model) throw new Error("冻结验证必须选择已启用的视觉模型");
  const samples = await db.prepare("SELECT id, category, sku_code, product_name, brand, image_url, gold_segment, gold_image_price_cents FROM market_annotation_validation_samples WHERE category=? ORDER BY id").bind(candidate.category).all<ValidationSampleRow>();
  const requestedCount = strictInteger(input.sampleCount, 50, 50, 500, "sampleCount");
  if (samples.results.length < requestedCount) throw new Error(`冻结验证至少需要 ${requestedCount} 条金标，当前只有 ${samples.results.length} 条`);
  const seed = (input.seed?.trim() || "market-annotation-v1").slice(0, 120);
  const selected = stableStratifiedSample(samples.results.map((row) => ({ ...row, goldSegment: row.gold_segment })), requestedCount, seed);
  if (selected.length !== requestedCount) throw new Error(`冻结验证未能生成 ${requestedCount} 条完整样本`);
  const snapshots: ValidationSnapshot[] = selected.map((row) => ({ id: row.id, skuCode: row.sku_code, productName: row.product_name, brand: row.brand, imageUrl: row.image_url, goldSegment: row.gold_segment, goldImagePriceCents: row.gold_image_price_cents }));
  const runId = "market-validation-" + randomUUID();
  const sampleHash = digest(JSON.stringify({ seed, modelId: input.modelId, samples: [...snapshots].sort((a, b) => a.id.localeCompare(b.id)) }));
  const insertedRun = await db.prepare(`INSERT INTO market_annotation_validation_runs
      (id, category, baseline_prompt_id, candidate_prompt_id, model_id, status, seed, requested_sample_count, sample_count, sample_hash, created_by)
    SELECT ?, current_prompt.category, ?, current_prompt.id, ?, 'queued', ?, ?, ?, ?, ?
    FROM market_annotation_prompt_versions current_prompt
    WHERE current_prompt.id=? AND (NOT EXISTS (SELECT 1 FROM market_subcategory_taxonomy taxonomy
      WHERE taxonomy.category=current_prompt.category AND taxonomy.status='active') OR (
        NOT EXISTS (SELECT 1 FROM market_subcategory_taxonomy taxonomy
          WHERE taxonomy.category=current_prompt.category AND taxonomy.status='active'
            AND NOT EXISTS (SELECT 1 FROM json_each(current_prompt.segments_json) segment
              WHERE CAST(segment.value AS TEXT)=taxonomy.subcategory))
        AND NOT EXISTS (SELECT 1 FROM json_each(current_prompt.segments_json) segment WHERE NOT EXISTS (
          SELECT 1 FROM market_subcategory_taxonomy taxonomy WHERE taxonomy.category=current_prompt.category
            AND taxonomy.status='active' AND taxonomy.subcategory=CAST(segment.value AS TEXT)))
      ))`)
    .bind(runId, baseline && baseline.id !== candidate.id ? baseline.id : null, input.modelId, seed, requestedCount,
      selected.length, sampleHash, actor.email, candidate.id).run() as { meta?: { changes?: number } };
  if (!Number(insertedRun.meta?.changes ?? 0)) throw new Error("候选 Prompt 或细分品类字典已变化，请刷新后重建冻结验证");
  const promptIds = [...new Set([candidate.id, baseline && baseline.id !== candidate.id ? baseline.id : null].filter(Boolean) as string[])];
  for (let offset = 0; offset < snapshots.length; offset += 50) {
    const statements = snapshots.slice(offset, offset + 50).flatMap((sample) => promptIds.map((promptId) =>
      db.prepare("INSERT INTO market_annotation_validation_results (id, run_id, sample_id, prompt_version_id, status, sample_snapshot_json, updated_at) VALUES (?, ?, ?, ?, 'queued', ?, CURRENT_TIMESTAMP)")
        .bind("market-validation-result-" + randomUUID(), runId, sample.id, promptId, JSON.stringify(sample))));
    await db.batch(statements);
  }
  return { id: runId, category: candidate.category, candidatePromptId: candidate.id, baselinePromptId: baseline && baseline.id !== candidate.id ? baseline.id : null, modelId: input.modelId, status: "queued", seed, sampleCount: selected.length, sampleHash };
}

export async function runNextValidation(db: MarketDatabase, runId: string) {
  const run = await db.prepare("SELECT id, category, baseline_prompt_id, candidate_prompt_id, model_id, status, metrics_json, gate_json FROM market_annotation_validation_runs WHERE id=?").bind(runId).first<{ id: string; category: string; baseline_prompt_id: string | null; candidate_prompt_id: string; model_id: string; status: string; metrics_json: string; gate_json: string }>();
  if (!run) throw new Error("冻结验证运行不存在");
  if (run.status === "completed") return { done: true, runId, metrics: json(run.metrics_json, {}), gate: json(run.gate_json, {}) };
  await db.prepare("UPDATE market_annotation_validation_results SET status=CASE WHEN attempt_count>=3 THEN 'failed' ELSE 'queued' END, claim_token_hash='', lease_expires_at=NULL, error_message=CASE WHEN attempt_count>=3 THEN '验证租约连续超时，已达到最大尝试次数' ELSE error_message END, updated_at=CURRENT_TIMESTAMP WHERE run_id=? AND status='inferencing' AND lease_expires_at IS NOT NULL AND datetime(lease_expires_at)<=datetime('now')")
    .bind(runId).run();
  const result = await db.prepare("SELECT id, run_id, sample_id, prompt_version_id, status, predicted_segment, predicted_image_price_cents, confidence_bps, is_correct, error_message, sample_snapshot_json, claim_token_hash, lease_expires_at, attempt_count, updated_at FROM market_annotation_validation_results WHERE run_id=? AND status IN ('queued','failed') AND attempt_count<3 ORDER BY CASE status WHEN 'queued' THEN 0 ELSE 1 END, sample_id, prompt_version_id LIMIT 1").bind(runId).first<ValidationResultRow>();
  if (!result) {
    const pending = await db.prepare("SELECT COUNT(*) count FROM market_annotation_validation_results WHERE run_id=? AND status IN ('queued','inferencing')").bind(runId).first<{ count: number }>();
    if (!Number(pending?.count ?? 0)) return { done: true, ...(await finalizeValidationRun(db, runId)) };
    return { done: false, waiting: true };
  }
  const claimHash = digest(randomBytes(24).toString("hex"));
  const claimed = await db.prepare("UPDATE market_annotation_validation_results SET status='inferencing', claim_token_hash=?, lease_expires_at=datetime('now','+2 minutes'), attempt_count=attempt_count+1, error_message='', updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('queued','failed') AND attempt_count<3")
    .bind(claimHash, result.id).run();
  if (!Number(claimed.meta.changes ?? 0)) return { done: false, raced: true };
  await db.prepare("UPDATE market_annotation_validation_runs SET status='running' WHERE id=? AND status='queued'").bind(runId).run();
  const snapshot = json<ValidationSnapshot | null>(result.sample_snapshot_json, null);
  const prompt = await db.prepare("SELECT " + promptColumns + " FROM market_annotation_prompt_versions WHERE id=?").bind(result.prompt_version_id).first<PromptRow>();
  if (!snapshot?.skuCode || !snapshot.goldSegment || !prompt) throw new Error("冻结样本快照或 Prompt 版本已丢失");
  try {
    const prediction = await runVisionAnnotation({ db, modelId: run.model_id, promptBody: prompt.prompt_body, segments: json(prompt.segments_json, []), skuCode: snapshot.skuCode, productName: snapshot.productName, brand: snapshot.brand, imageUrl: snapshot.imageUrl });
    await db.prepare("UPDATE market_annotation_validation_results SET status='completed', predicted_segment=?, predicted_image_price_cents=?, confidence_bps=?, is_correct=?, error_message='', claim_token_hash='', lease_expires_at=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='inferencing' AND claim_token_hash=? AND datetime(lease_expires_at)>datetime('now')")
      .bind(prediction.segment, prediction.imagePriceCents, prediction.confidenceBps, prediction.segment === snapshot.goldSegment ? 1 : 0, result.id, claimHash).run();
  } catch (error) {
    await db.prepare("UPDATE market_annotation_validation_results SET status='failed', error_message=?, claim_token_hash='', lease_expires_at=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='inferencing' AND claim_token_hash=? AND datetime(lease_expires_at)>datetime('now')")
      .bind(safeOperationalError(error, "验证识别失败"), result.id, claimHash).run();
  }
  return { done: false, resultId: result.id };
}

async function finalizeValidationRun(db: MarketDatabase, runId: string) {
  const run = await db.prepare("SELECT candidate_prompt_id candidatePromptId, baseline_prompt_id baselinePromptId, status, metrics_json metricsJson, gate_json gateJson FROM market_annotation_validation_runs WHERE id=?").bind(runId).first<{ candidatePromptId: string; baselinePromptId: string | null; status: string; metricsJson: string; gateJson: string }>();
  if (!run) throw new Error("冻结验证运行不存在");
  if (run.status === "completed") return { runId, metrics: json(run.metricsJson, {}), gate: json(run.gateJson, {}) };
  const pending = await db.prepare("SELECT COUNT(*) count FROM market_annotation_validation_results WHERE run_id=? AND status IN ('queued','inferencing')").bind(runId).first<{ count: number }>();
  if (Number(pending?.count ?? 0)) throw new Error("冻结验证仍有未完成结果，不能结算");
  const resultRows = await db.prepare("SELECT prompt_version_id promptVersionId, predicted_segment predictedSegment, predicted_image_price_cents predictedImagePriceCents, sample_snapshot_json sampleSnapshotJson FROM market_annotation_validation_results WHERE run_id=?").bind(runId).all<Record<string, string | number | null>>();
  const rows = (resultRows.results ?? []).map((row) => ({
    promptVersionId: String(row.promptVersionId ?? ""), predictedSegment: String(row.predictedSegment ?? ""),
    predictedImagePriceCents: row.predictedImagePriceCents === null ? null : Number(row.predictedImagePriceCents),
    snapshot: json<ValidationSnapshot>(String(row.sampleSnapshotJson ?? "{}"), { id: "", skuCode: "", productName: "", brand: "", imageUrl: "", goldSegment: "", goldImagePriceCents: null }),
  }));
  const metricsFor = (promptId: string | null) => promptId ? validationMetrics(rows.filter((row) => row.promptVersionId === promptId).map((row) => ({
    goldSegment: row.snapshot.goldSegment, predictedSegment: String(row.predictedSegment ?? ""), goldImagePriceCents: row.snapshot.goldImagePriceCents, predictedImagePriceCents: row.predictedImagePriceCents === null ? null : Number(row.predictedImagePriceCents),
  }))) : null;
  const candidate = metricsFor(run.candidatePromptId)!;
  const baseline = metricsFor(run.baselinePromptId);
  const gate = activationGate(baseline, candidate, 50);
  await db.batch([
    db.prepare("UPDATE market_annotation_validation_runs SET status='completed', metrics_json=?, gate_json=?, completed_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('queued','running')").bind(JSON.stringify({ candidate, baseline }), JSON.stringify(gate), runId),
    db.prepare("UPDATE market_annotation_prompt_versions SET metrics_json=? WHERE id=?").bind(JSON.stringify({ runId, candidate, baseline, gate }), run.candidatePromptId),
  ]);
  return { runId, metrics: { candidate, baseline }, gate };
}

export async function activatePromptVersion(db: MarketDatabase, input: { promptId: string; explicitOverride?: boolean; reason?: string; rollback?: boolean }, actor: Actor) {
  await ensureAnnotationSchema(db);
  await ensureMarketSchemaLazy(db);
  const prompt = await db.prepare("SELECT " + promptColumns + " FROM market_annotation_prompt_versions WHERE id=?").bind(input.promptId).first<PromptRow>();
  if (!prompt) throw new Error("Prompt 版本不存在");
  await assertPromptTaxonomyCurrent(db, prompt.category, json<string[]>(prompt.segments_json, []), "该 Prompt 的细分品类枚举已过期，不能激活或回滚");
  if (input.rollback && prompt.status !== "archived") throw new Error("只能回滚到曾经激活后归档的历史版本");
  if (!input.rollback && !["draft", "archived"].includes(prompt.status)) throw new Error("该 Prompt 当前不能激活");
  const run = await db.prepare("SELECT status, gate_json FROM market_annotation_validation_runs WHERE candidate_prompt_id=? ORDER BY created_at DESC LIMIT 1").bind(prompt.id).first<{ status: string; gate_json: string }>();
  const gate = run ? json<{ passed?: boolean; reasons?: string[] }>(run.gate_json, {}) : {};
  if ((!run || run.status !== "completed" || !gate.passed) && !input.explicitOverride) throw new Error("该 Prompt 尚未通过冻结样本门禁；管理员可填写原因后显式确认");
  if ((input.explicitOverride || input.rollback) && (input.reason?.trim().length ?? 0) < 6) throw new Error("显式确认或回滚必须填写至少 6 个字符的审计原因");
  const activationGuardId = "market-prompt-activation-guard-" + randomUUID();
  await db.batch([
    db.prepare(`INSERT INTO market_master_audit_logs
      (id, actor_email, actor_role, action, entity_type, entity_id, before_json, after_json)
      SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM market_annotation_prompt_versions WHERE id=? AND status=?) THEN NULL
      WHEN NOT EXISTS (SELECT 1 FROM market_subcategory_taxonomy taxonomy
          WHERE taxonomy.category=? AND taxonomy.status='active') OR (
        NOT EXISTS (SELECT 1 FROM market_subcategory_taxonomy taxonomy WHERE taxonomy.category=? AND taxonomy.status='active'
          AND NOT EXISTS (SELECT 1 FROM json_each(?) segment WHERE CAST(segment.value AS TEXT)=taxonomy.subcategory))
        AND NOT EXISTS (SELECT 1 FROM json_each(?) segment WHERE NOT EXISTS (
          SELECT 1 FROM market_subcategory_taxonomy taxonomy WHERE taxonomy.category=? AND taxonomy.status='active'
            AND taxonomy.subcategory=CAST(segment.value AS TEXT)))
      ) THEN ? ELSE NULL END, ?, ?, 'market_prompt_activation_guard', 'market_annotation_prompt', ?, '{}', '{}'`)
      .bind(prompt.id, prompt.status, prompt.category, prompt.category, prompt.segments_json, prompt.segments_json, prompt.category,
        activationGuardId, actor.email, actor.role, prompt.id),
    db.prepare("UPDATE market_annotation_prompt_versions SET status='archived' WHERE category=? AND status='active' AND id<>?").bind(prompt.category, prompt.id),
    db.prepare("UPDATE market_annotation_prompt_versions SET status='active', activated_by=?, activated_at=CURRENT_TIMESTAMP, change_note=CASE WHEN ?<>'' THEN change_note || ' | 激活说明：' || ? ELSE change_note END WHERE id=?").bind(actor.email, input.reason?.trim() ?? "", input.reason?.trim() ?? "", prompt.id),
    db.prepare("INSERT INTO market_annotation_prompt_audits (id, prompt_id, category, action, reason, actor) VALUES (?, ?, ?, ?, ?, ?)").bind("market-prompt-audit-" + randomUUID(), prompt.id, prompt.category, input.rollback ? "rollback" : input.explicitOverride ? "activate_override" : "activate", input.reason?.trim() || "validation_gate_passed", actor.email),
    db.prepare("DELETE FROM market_master_audit_logs WHERE id=? AND action='market_prompt_activation_guard'").bind(activationGuardId),
  ]);
  const activated = await db.prepare("SELECT status FROM market_annotation_prompt_versions WHERE id=?").bind(prompt.id).first<{ status: string }>();
  if (activated?.status !== "active") throw new Error("Prompt 激活写入未生效，请刷新后重试");
  return { ok: true, promptId: prompt.id, category: prompt.category, gate, explicitOverride: Boolean(input.explicitOverride), rollback: Boolean(input.rollback) };
}

export async function deletePromptVersion(db: MarketDatabase, promptIdValue: string, actor: Actor) {
  const promptId = promptIdValue.trim();
  const prompt = await db.prepare("SELECT " + promptColumns + " FROM market_annotation_prompt_versions WHERE id=?").bind(promptId).first<PromptRow>();
  if (!prompt) throw new Error("Prompt 版本不存在");
  if (prompt.status !== "draft") throw new Error("只能删除尚未激活的草稿版本；激活或归档版本必须保留审计记录");
  const references = await db.prepare(`SELECT
      (SELECT COUNT(*) FROM market_annotation_jobs WHERE prompt_version_id=?) job_count,
      (SELECT COUNT(*) FROM market_annotation_validation_runs WHERE candidate_prompt_id=? OR baseline_prompt_id=?) validation_count,
      (SELECT COUNT(*) FROM market_annotation_validation_results WHERE prompt_version_id=?) validation_result_count,
      (SELECT COUNT(*) FROM market_sku_annotations WHERE prompt_version_id=?) annotation_count`)
    .bind(promptId, promptId, promptId, promptId, promptId)
    .first<{ job_count: number; validation_count: number; validation_result_count: number; annotation_count: number }>();
  const referenceCount = Number(references?.job_count ?? 0) + Number(references?.validation_count ?? 0)
    + Number(references?.validation_result_count ?? 0) + Number(references?.annotation_count ?? 0);
  if (referenceCount > 0) throw new Error("该草稿已被任务、冻结验证或正式标注引用，不能删除");
  const reason = "管理员删除未使用的 Prompt 草稿";
  await db.batch([
    db.prepare("UPDATE market_annotation_prompt_versions SET status='deleted', change_note=CASE WHEN change_note='' THEN ? ELSE change_note || ' | ' || ? END WHERE id=? AND status='draft'").bind(reason, reason, promptId),
    db.prepare("INSERT INTO market_annotation_prompt_audits (id, prompt_id, category, action, reason, actor) VALUES (?, ?, ?, 'delete_draft', ?, ?)").bind("market-prompt-audit-" + randomUUID(), promptId, prompt.category, reason, actor.email),
  ]);
  const deleted = await db.prepare("SELECT status FROM market_annotation_prompt_versions WHERE id=?").bind(promptId).first<{ status: string }>();
  if (deleted?.status !== "deleted") throw new Error("Prompt 草稿删除未生效，请刷新后重试");
  return { ok: true, promptId, category: prompt.category, version: prompt.version };
}

export async function createLocalAgent(db: MarketDatabase, nameValue: string, actor: Actor) {
  const name = nameValue.trim().slice(0, 120);
  if (name.length < 2) throw new Error("本地 agent 名称至少需要 2 个字符");
  const id = "market-agent-" + randomUUID();
  const token = "teruisi_ma_" + randomBytes(32).toString("hex");
  await db.prepare("INSERT INTO market_annotation_local_agents (id, name, token_hash, status, capabilities_json, created_by) VALUES (?, ?, ?, 'enabled', ?, ?)")
    .bind(id, name, digest(token), JSON.stringify({ scope: "market_annotation_worker", protocols: ["ollama"] }), actor.email).run();
  return { id, name, token, status: "enabled", note: "token 只在本次响应显示，请立即复制到本机环境变量" };
}

export async function revokeLocalAgent(db: MarketDatabase, agentId: string) {
  const result = await db.prepare("UPDATE market_annotation_local_agents SET status='revoked', revoked_at=CURRENT_TIMESTAMP WHERE id=? AND status='enabled'").bind(agentId.trim()).run();
  return { ok: true, revoked: Number(result.meta.changes ?? 0) > 0 };
}

export async function authenticateLocalAgent(db: MarketDatabase, authorization: string | null) {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) throw new AnnotationAgentError("authentication");
  const tokenHash = digest(match[1]);
  const agent = await db.prepare("SELECT id, name, status FROM market_annotation_local_agents WHERE token_hash=? AND status='enabled' LIMIT 1").bind(tokenHash).first<{ id: string; name: string; status: string }>();
  if (!agent) throw new AnnotationAgentError("authentication");
  await db.prepare("UPDATE market_annotation_local_agents SET last_seen_at=CURRENT_TIMESTAMP WHERE id=?").bind(agent.id).run();
  return agent;
}

export async function claimLocalAnnotation(db: MarketDatabase, agent: { id: string }) {
  await ensureAnnotationSchema(db);
  await db.prepare("UPDATE market_annotation_items SET status=CASE WHEN attempt_count>=3 THEN 'failed' ELSE 'queued' END, lease_token_hash='', lease_agent_id='', lease_expires_at=NULL, error_message=CASE WHEN attempt_count>=3 THEN '本地执行租约连续超时，已达到最大尝试次数' ELSE error_message END, version=version+1, updated_at=CURRENT_TIMESTAMP WHERE status='claimed' AND lease_expires_at IS NOT NULL AND datetime(lease_expires_at)<=datetime('now')").run();
  const item = await db.prepare("SELECT i.id, i.job_id jobId, i.category, i.sku_code skuCode, i.ranking_dimension rankingDimension, i.month, i.image_content_sha256 imageContentSha256, i.product_name productName, i.brand, i.source_image_url sourceImageUrl, i.version, j.prompt_version_id promptVersionId, j.local_model_name localModelName FROM market_annotation_items i JOIN market_annotation_jobs j ON j.id=i.job_id WHERE j.executor='local' AND j.status IN ('queued','running','failed') AND i.status IN ('queued','failed') AND i.attempt_count<3 ORDER BY j.created_at, i.updated_at LIMIT 1")
    .first<{ id: string; jobId: string; category: string; skuCode: string; rankingDimension: string; month: string; imageContentSha256: string; productName: string; brand: string; sourceImageUrl: string; version: number; promptVersionId: string; localModelName: string }>();
  if (!item) return { task: null };
  const leaseToken = randomBytes(24).toString("hex");
  const claimed = await db.prepare("UPDATE market_annotation_items SET status='claimed', lease_token_hash=?, lease_agent_id=?, lease_expires_at=datetime('now','+5 minutes'), attempt_count=attempt_count+1, error_message='', version=version+1, updated_at=CURRENT_TIMESTAMP WHERE id=? AND version=? AND status IN ('queued','failed') AND attempt_count<3")
    .bind(digest(leaseToken), agent.id, item.id, item.version).run();
  if (!Number(claimed.meta.changes ?? 0)) return { task: null, raced: true };
  const prompt = await db.prepare("SELECT " + promptColumns + " FROM market_annotation_prompt_versions WHERE id=?").bind(item.promptVersionId).first<PromptRow>();
  if (!prompt) throw new Error("本地任务绑定的 Prompt 不存在");
  const lease = await db.prepare("SELECT lease_expires_at leaseExpiresAt FROM market_annotation_items WHERE id=?").bind(item.id).first<{ leaseExpiresAt: string }>();
  await db.prepare("UPDATE market_annotation_jobs SET status='running', started_at=COALESCE(started_at,CURRENT_TIMESTAMP), updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(item.jobId).run();
  return { task: { itemId: item.id, candidateId: item.id, jobId: item.jobId, category: item.category, skuCode: item.skuCode, rankingDimension: item.rankingDimension, month: item.month, imageContentSha256: item.imageContentSha256, productName: item.productName, brand: item.brand, sourceImageUrl: item.sourceImageUrl, imageCandidates: resolveAnnotationImageCandidates(item.sourceImageUrl), promptVersionId: prompt.id, promptBody: prompt.prompt_body, segments: json<string[]>(prompt.segments_json, []), localModelName: item.localModelName, leaseToken, leaseExpiresAt: lease?.leaseExpiresAt ?? "" } };
}

export async function completeLocalAnnotation(db: MarketDatabase, agent: { id: string }, input: {
  itemId: string; leaseToken: string; result?: unknown; error?: string; imageSource?: string; resolvedImageUrl?: string;
}) {
  await ensureAnnotationSchema(db);
  const item = await db.prepare("SELECT " + itemColumns + " FROM market_annotation_items WHERE id=?").bind(input.itemId).first<ItemRow>();
  if (!item) throw new AnnotationAgentError("bad_request");
  if (item.status === "review_pending" || item.status === "approved" || item.status === "committed") return { ok: true, duplicate: true, itemId: item.id };
  if (item.status !== "claimed" || item.lease_agent_id !== agent.id || item.lease_token_hash !== digest(input.leaseToken) || !item.lease_expires_at) {
    throw new AnnotationAgentError("lease_conflict");
  }
  if (input.error) {
    const failed = await db.prepare("UPDATE market_annotation_items SET status='failed', error_message=?, lease_token_hash='', lease_agent_id='', lease_expires_at=NULL, version=version+1, updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='claimed' AND lease_agent_id=? AND lease_token_hash=? AND datetime(lease_expires_at)>datetime('now')")
      .bind(input.error.slice(0, 800), item.id, agent.id, digest(input.leaseToken)).run();
    if (!Number(failed.meta.changes ?? 0)) throw new AnnotationAgentError("lease_conflict");
    await refreshJob(db, item.job_id);
    return { ok: true, failed: true };
  }
  const job = await db.prepare("SELECT " + jobColumns + " FROM market_annotation_jobs WHERE id=?").bind(item.job_id).first<JobRow>();
  const prompt = job ? await db.prepare("SELECT " + promptColumns + " FROM market_annotation_prompt_versions WHERE id=?").bind(job.prompt_version_id).first<PromptRow>() : null;
  if (!prompt) throw new Error("本地任务 Prompt 不存在");
  let prediction: ReturnType<typeof parseVisionAnnotation>;
  try { prediction = parseVisionAnnotation(input.result, json<string[]>(prompt.segments_json, [])); }
  catch { throw new AnnotationAgentError("bad_request"); }
  const candidates = resolveAnnotationImageCandidates(item.source_image_url);
  const selectedImage = input.resolvedImageUrl ? candidates.find((candidate) => candidate.url === input.resolvedImageUrl && candidate.source === input.imageSource) : null;
  if (input.resolvedImageUrl && !selectedImage) throw new AnnotationAgentError("bad_request");
  const result = await db.prepare("UPDATE market_annotation_items SET status='review_pending', ai_segment=?, ai_image_price_cents=?, ai_price_type=?, ai_price_low_cents=?, ai_price_high_cents=?, ai_confidence_bps=?, ai_reason=?, ai_raw_digest=?, reviewed_segment=?, reviewed_image_price_cents=?, reviewed_price_type=?, reviewed_price_low_cents=?, reviewed_price_high_cents=?, resolved_image_url=?, image_source=?, lease_token_hash='', lease_agent_id='', lease_expires_at=NULL, version=version+1, updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='claimed' AND lease_agent_id=? AND lease_token_hash=? AND datetime(lease_expires_at)>datetime('now')")
    .bind(prediction.segment, prediction.imagePriceCents, prediction.priceType, prediction.priceLowCents, prediction.priceHighCents, prediction.confidenceBps, prediction.reason, digest(prediction.rawText), prediction.segment, prediction.imagePriceCents, prediction.priceType, prediction.priceLowCents, prediction.priceHighCents, selectedImage?.url ?? "", selectedImage?.source ?? "none", item.id, agent.id, digest(input.leaseToken)).run();
  if (!Number(result.meta.changes ?? 0)) throw new AnnotationAgentError("lease_conflict");
  await refreshJob(db, item.job_id);
  return { ok: true, itemId: item.id };
}
