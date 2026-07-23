import type { MarketDatabase } from "@/lib/market/database";

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS market_annotation_prompt_versions (id TEXT PRIMARY KEY NOT NULL, category TEXT NOT NULL, version INTEGER NOT NULL, parent_id TEXT, source TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', segments_json TEXT NOT NULL, prompt_body TEXT NOT NULL, change_note TEXT NOT NULL DEFAULT '', metrics_json TEXT NOT NULL DEFAULT '{}', created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, activated_by TEXT, activated_at TEXT)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS market_annotation_prompts_category_version_uq ON market_annotation_prompt_versions(category, version)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS market_annotation_prompts_active_uq ON market_annotation_prompt_versions(category) WHERE status = 'active'`,
  `CREATE TABLE IF NOT EXISTS market_annotation_jobs (id TEXT PRIMARY KEY NOT NULL, category TEXT NOT NULL, prompt_version_id TEXT NOT NULL, executor TEXT NOT NULL, model_id TEXT, local_model_name TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'queued', total_count INTEGER NOT NULL DEFAULT 0, completed_count INTEGER NOT NULL DEFAULT 0, failed_count INTEGER NOT NULL DEFAULT 0, reviewed_count INTEGER NOT NULL DEFAULT 0, committed_count INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, started_at TEXT, completed_at TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, commit_token_hash TEXT NOT NULL DEFAULT '', commit_started_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS market_annotation_jobs_category_created_idx ON market_annotation_jobs(category, created_at)`,
  `CREATE TABLE IF NOT EXISTS market_annotation_items (id TEXT PRIMARY KEY NOT NULL, job_id TEXT NOT NULL, sku_code TEXT NOT NULL, product_name TEXT NOT NULL DEFAULT '', brand TEXT NOT NULL DEFAULT '', source_image_url TEXT NOT NULL DEFAULT '', resolved_image_url TEXT NOT NULL DEFAULT '', image_source TEXT NOT NULL DEFAULT 'none', status TEXT NOT NULL DEFAULT 'queued', ai_segment TEXT NOT NULL DEFAULT '', ai_image_price_cents INTEGER, ai_confidence_bps INTEGER, ai_reason TEXT NOT NULL DEFAULT '', ai_raw_digest TEXT NOT NULL DEFAULT '', reviewed_segment TEXT NOT NULL DEFAULT '', reviewed_image_price_cents INTEGER, selected INTEGER NOT NULL DEFAULT 0, reviewed_by TEXT NOT NULL DEFAULT '', reviewed_at TEXT, lease_token_hash TEXT NOT NULL DEFAULT '', lease_agent_id TEXT NOT NULL DEFAULT '', lease_expires_at TEXT, attempt_count INTEGER NOT NULL DEFAULT 0, error_message TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS market_annotation_items_job_sku_uq ON market_annotation_items(job_id, sku_code)`,
  `CREATE INDEX IF NOT EXISTS market_annotation_items_job_status_idx ON market_annotation_items(job_id, status, updated_at)`,
  `CREATE INDEX IF NOT EXISTS market_annotation_items_lease_idx ON market_annotation_items(lease_expires_at, status)`,
  `CREATE TABLE IF NOT EXISTS market_sku_annotations (id TEXT PRIMARY KEY NOT NULL, category TEXT NOT NULL, sku_code TEXT NOT NULL, segment TEXT NOT NULL, image_price_cents INTEGER, image_url TEXT NOT NULL DEFAULT '', image_source TEXT NOT NULL DEFAULT 'none', confidence_bps INTEGER, source_job_item_id TEXT NOT NULL, prompt_version_id TEXT NOT NULL, reviewed_by TEXT NOT NULL, reviewed_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS market_sku_annotations_category_sku_uq ON market_sku_annotations(category, sku_code)`,
  `CREATE INDEX IF NOT EXISTS market_sku_annotations_segment_idx ON market_sku_annotations(category, segment, updated_at)`,
  `CREATE TABLE IF NOT EXISTS market_annotation_commit_receipts (id TEXT PRIMARY KEY NOT NULL, job_item_id TEXT NOT NULL, annotation_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, before_json TEXT NOT NULL DEFAULT '{}', after_json TEXT NOT NULL, committed_by TEXT NOT NULL, committed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, batch_id TEXT NOT NULL DEFAULT '', request_digest TEXT NOT NULL DEFAULT '')`,
  `CREATE UNIQUE INDEX IF NOT EXISTS market_annotation_commits_item_uq ON market_annotation_commit_receipts(job_item_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS market_annotation_commits_idempotency_uq ON market_annotation_commit_receipts(idempotency_key)`,
  `CREATE INDEX IF NOT EXISTS market_annotation_commits_batch_idx ON market_annotation_commit_receipts(batch_id)`,
  `CREATE TABLE IF NOT EXISTS market_annotation_validation_samples (id TEXT PRIMARY KEY NOT NULL, category TEXT NOT NULL, sku_code TEXT NOT NULL, product_name TEXT NOT NULL DEFAULT '', brand TEXT NOT NULL DEFAULT '', image_url TEXT NOT NULL DEFAULT '', gold_segment TEXT NOT NULL, gold_image_price_cents INTEGER, source_annotation_id TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS market_annotation_samples_category_sku_uq ON market_annotation_validation_samples(category, sku_code)`,
  `CREATE TABLE IF NOT EXISTS market_annotation_validation_runs (id TEXT PRIMARY KEY NOT NULL, category TEXT NOT NULL, baseline_prompt_id TEXT, candidate_prompt_id TEXT NOT NULL, model_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', seed TEXT NOT NULL, requested_sample_count INTEGER NOT NULL DEFAULT 50, sample_count INTEGER NOT NULL DEFAULT 0, sample_hash TEXT NOT NULL DEFAULT '', metrics_json TEXT NOT NULL DEFAULT '{}', gate_json TEXT NOT NULL DEFAULT '{}', created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS market_annotation_validation_runs_prompt_idx ON market_annotation_validation_runs(candidate_prompt_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS market_annotation_validation_results (id TEXT PRIMARY KEY NOT NULL, run_id TEXT NOT NULL, sample_id TEXT NOT NULL, prompt_version_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', predicted_segment TEXT NOT NULL DEFAULT '', predicted_image_price_cents INTEGER, confidence_bps INTEGER, is_correct INTEGER NOT NULL DEFAULT 0, error_message TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, sample_snapshot_json TEXT NOT NULL DEFAULT '{}', claim_token_hash TEXT NOT NULL DEFAULT '', lease_expires_at TEXT, attempt_count INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS market_annotation_validation_result_uq ON market_annotation_validation_results(run_id, sample_id, prompt_version_id)`,
  `CREATE INDEX IF NOT EXISTS market_annotation_validation_result_lease_idx ON market_annotation_validation_results(run_id, status, lease_expires_at)`,
  `CREATE TABLE IF NOT EXISTS market_annotation_prompt_audits (id TEXT PRIMARY KEY NOT NULL, prompt_id TEXT NOT NULL, category TEXT NOT NULL, action TEXT NOT NULL, reason TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS market_annotation_prompt_audits_prompt_idx ON market_annotation_prompt_audits(prompt_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS market_annotation_local_agents (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, token_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'enabled', capabilities_json TEXT NOT NULL DEFAULT '{}', created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, last_seen_at TEXT, revoked_at TEXT)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS market_annotation_agents_token_uq ON market_annotation_local_agents(token_hash)`,
] as const;

const ready = new WeakMap<object, Promise<void>>();

export async function ensureAnnotationSchema(db: MarketDatabase) {
  const key = db as unknown as object;
  const previous = ready.get(key);
  if (previous) return previous;
  const setup = db.batch(schemaStatements.map((sql) => db.prepare(sql))).then(() => undefined).catch((error: unknown) => { ready.delete(key); throw error; });
  ready.set(key, setup);
  return setup;
}
