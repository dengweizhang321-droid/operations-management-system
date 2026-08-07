export const OPERATION_RUNTIME_LIMITS = {
  identifierCharacters: 160,
  attributeCharacters: 8_000,
  listRuns: 100,
  listEvents: 300,
  metricSampleRuns: 1_000,
} as const;

export const operationRunStatuses = ["pending", "running", "succeeded", "failed", "cancelled"] as const;
export type OperationRunStatus = (typeof operationRunStatuses)[number];
export const operationStepStatuses = [...operationRunStatuses, "skipped"] as const;
export type OperationStepStatus = (typeof operationStepStatuses)[number];
export type OperationEventLevel = "debug" | "info" | "warning" | "error";

export type OperationDatabase = SalesDatabase;

export type OperationRunRecord = {
  id: string;
  traceId: string;
  parentRunId: string | null;
  runType: string;
  surface: string;
  actorEmail: string;
  actorRole: string;
  platform: string;
  shopName: string;
  dataset: string;
  scope: Record<string, unknown>;
  idempotencyKey: string;
  status: OperationRunStatus;
  errorCode: string;
  summary: Record<string, unknown>;
  startedAt: string;
  heartbeatAt: string;
  completedAt: string | null;
  durationMs: number | null;
};

export type OperationStepRecord = {
  id: string;
  runId: string;
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  stepType: string;
  stepKey: string;
  attemptNo: number;
  status: OperationStepStatus;
  errorCode: string;
  attributes: Record<string, unknown>;
  result: Record<string, unknown>;
  startedAt: string;
  heartbeatAt: string;
  completedAt: string | null;
  durationMs: number | null;
};

export type OperationEventRecord = {
  sequence: number;
  id: string;
  runId: string;
  stepId: string | null;
  traceId: string;
  spanId: string | null;
  parentSpanId: string | null;
  eventType: string;
  level: OperationEventLevel;
  stage: string;
  attributes: Record<string, unknown>;
  occurredAt: string;
};

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS operation_runs (
    id TEXT PRIMARY KEY NOT NULL, trace_id TEXT NOT NULL, parent_run_id TEXT,
    run_type TEXT NOT NULL, surface TEXT NOT NULL, actor_email TEXT NOT NULL DEFAULT '',
    actor_role TEXT NOT NULL DEFAULT '', platform TEXT NOT NULL DEFAULT '', shop_name TEXT NOT NULL DEFAULT '',
    dataset TEXT NOT NULL DEFAULT '', scope_json TEXT NOT NULL DEFAULT '{}', idempotency_key TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK (status IN ('pending','running','succeeded','failed','cancelled')),
    error_code TEXT NOT NULL DEFAULT '', summary_json TEXT NOT NULL DEFAULT '{}',
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, heartbeat_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT, duration_ms INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS operation_runs_idempotency_uq
    ON operation_runs (run_type, idempotency_key) WHERE idempotency_key <> ''`,
  `CREATE INDEX IF NOT EXISTS operation_runs_status_updated_idx ON operation_runs (status, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS operation_runs_trace_idx ON operation_runs (trace_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS operation_runs_scope_idx ON operation_runs (platform, shop_name, dataset, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS operation_steps (
    id TEXT PRIMARY KEY NOT NULL, run_id TEXT NOT NULL, trace_id TEXT NOT NULL, span_id TEXT NOT NULL UNIQUE,
    parent_span_id TEXT, step_type TEXT NOT NULL, step_key TEXT NOT NULL, attempt_no INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL CHECK (status IN ('pending','running','succeeded','failed','cancelled','skipped')),
    error_code TEXT NOT NULL DEFAULT '', attributes_json TEXT NOT NULL DEFAULT '{}', result_json TEXT NOT NULL DEFAULT '{}',
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, heartbeat_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT, duration_ms INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE (run_id, step_key, attempt_no),
    FOREIGN KEY (run_id) REFERENCES operation_runs(id))`,
  `CREATE INDEX IF NOT EXISTS operation_steps_run_created_idx ON operation_steps (run_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS operation_steps_type_status_idx ON operation_steps (step_type, status, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS operation_events (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, run_id TEXT NOT NULL, step_id TEXT,
    trace_id TEXT NOT NULL, span_id TEXT, parent_span_id TEXT, event_type TEXT NOT NULL,
    level TEXT NOT NULL CHECK (level IN ('debug','info','warning','error')), stage TEXT NOT NULL DEFAULT '',
    attributes_json TEXT NOT NULL DEFAULT '{}', occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (run_id) REFERENCES operation_runs(id), FOREIGN KEY (step_id) REFERENCES operation_steps(id))`,
  `CREATE INDEX IF NOT EXISTS operation_events_run_sequence_idx ON operation_events (run_id, sequence)`,
  `CREATE INDEX IF NOT EXISTS operation_events_trace_sequence_idx ON operation_events (trace_id, sequence)`,
  `CREATE TABLE IF NOT EXISTS ai_model_runtime_health (
    model_id TEXT PRIMARY KEY NOT NULL, consecutive_failures INTEGER NOT NULL DEFAULT 0,
    circuit_open_until TEXT, last_failure_code TEXT NOT NULL DEFAULT '', last_failure_at TEXT,
    last_success_at TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS ai_model_runtime_health_circuit_idx
    ON ai_model_runtime_health (circuit_open_until, updated_at)`,
] as const;

const schemaReady = new WeakMap<object, Promise<void>>();

export function ensureOperationRuntimeSchema(db: OperationDatabase): Promise<void> {
  const key = db as object;
  const existing = schemaReady.get(key);
  if (existing) return existing;
  const setup = db.batch(schemaStatements.map((sql) => db.prepare(sql)))
    .then(() => undefined)
    .catch((error: unknown) => {
      schemaReady.delete(key);
      throw error;
    });
  schemaReady.set(key, setup);
  return setup;
}

export async function startOperationRun(db: OperationDatabase, input: {
  id?: string;
  traceId?: string;
  parentRunId?: string | null;
  runType: string;
  surface: string;
  actorEmail?: string;
  actorRole?: string;
  platform?: string;
  shopName?: string;
  dataset?: string;
  scope?: unknown;
  idempotencyKey?: string;
}): Promise<OperationRunRecord> {
  await ensureOperationRuntimeSchema(db);
  const runType = identifier(input.runType, "operation");
  const idempotencyKey = optionalIdentifier(input.idempotencyKey);
  if (idempotencyKey) {
    const existing = await findRunByIdempotency(db, runType, idempotencyKey);
    if (existing) return existing;
  }
  const id = input.id ? identifier(input.id, `op-run-${crypto.randomUUID()}`) : `op-run-${crypto.randomUUID()}`;
  const traceId = identifier(input.traceId, id);
  try {
    await db.prepare(`INSERT INTO operation_runs (
      id, trace_id, parent_run_id, run_type, surface, actor_email, actor_role,
      platform, shop_name, dataset, scope_json, idempotency_key, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running')`).bind(
      id,
      traceId,
      optionalIdentifier(input.parentRunId) || null,
      runType,
      identifier(input.surface, "system"),
      boundedText(input.actorEmail, 240),
      boundedText(input.actorRole, 40),
      boundedText(input.platform, 80),
      boundedText(input.shopName, 160),
      boundedText(input.dataset, 120),
      safeJson(input.scope),
      idempotencyKey,
    ).run();
  } catch (error) {
    const existing = idempotencyKey ? await findRunByIdempotency(db, runType, idempotencyKey) : null;
    if (existing) return existing;
    throw error;
  }
  await recordOperationEvent(db, {
    runId: id,
    traceId,
    eventType: "run.started",
    level: "info",
    stage: "started",
    attributes: { runType, surface: input.surface },
  });
  return requireOperationRun(db, id);
}

export async function startOperationStep(db: OperationDatabase, input: {
  runId: string;
  traceId: string;
  parentSpanId?: string | null;
  stepType: string;
  stepKey: string;
  attemptNo?: number;
  attributes?: unknown;
}): Promise<OperationStepRecord> {
  await ensureOperationRuntimeSchema(db);
  const runId = identifier(input.runId, "");
  if (!runId) throw new Error("operation run id is required");
  const stepKey = identifier(input.stepKey, "step");
  const attemptNo = boundedInteger(input.attemptNo, 1, 1, 100);
  const existing = await findOperationStep(db, runId, stepKey, attemptNo);
  if (existing) return existing;
  const id = `op-step-${crypto.randomUUID()}`;
  const spanId = crypto.randomUUID();
  await db.prepare(`INSERT INTO operation_steps (
    id, run_id, trace_id, span_id, parent_span_id, step_type, step_key,
    attempt_no, status, attributes_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', ?)
  ON CONFLICT(run_id, step_key, attempt_no) DO NOTHING`).bind(
    id,
    runId,
    identifier(input.traceId, runId),
    spanId,
    optionalIdentifier(input.parentSpanId) || null,
    identifier(input.stepType, "step"),
    stepKey,
    attemptNo,
    safeJson(input.attributes),
  ).run();
  const step = await findOperationStep(db, runId, stepKey, attemptNo);
  if (!step) throw new Error("operation step could not be created");
  await recordOperationEvent(db, {
    runId,
    stepId: step.id,
    traceId: step.traceId,
    spanId: step.spanId,
    parentSpanId: step.parentSpanId,
    eventType: "step.started",
    level: "info",
    stage: step.stepType,
    attributes: { stepKey, attemptNo },
  });
  return step;
}

export async function finishOperationStep(db: OperationDatabase, input: {
  stepId: string;
  status: Exclude<OperationStepStatus, "pending" | "running">;
  errorCode?: string;
  result?: unknown;
}): Promise<OperationStepRecord> {
  await ensureOperationRuntimeSchema(db);
  const update = await db.prepare(`UPDATE operation_steps SET
    status=?, error_code=?, result_json=?, completed_at=CURRENT_TIMESTAMP,
    duration_ms=MAX(0, CAST((julianday(CURRENT_TIMESTAMP)-julianday(started_at))*86400000 AS INTEGER)),
    heartbeat_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND status IN ('pending','running')`).bind(
    input.status,
    boundedText(input.errorCode, 120),
    safeJson(input.result),
    identifier(input.stepId, ""),
  ).run();
  const step = await requireOperationStep(db, input.stepId);
  if (Number(update.meta.changes ?? 0) === 0) return step;
  await recordOperationEvent(db, {
    runId: step.runId,
    stepId: step.id,
    traceId: step.traceId,
    spanId: step.spanId,
    parentSpanId: step.parentSpanId,
    eventType: `step.${step.status}`,
    level: step.status === "failed" ? "error" : step.status === "cancelled" ? "warning" : "info",
    stage: step.stepType,
    attributes: { errorCode: step.errorCode, durationMs: step.durationMs },
  });
  return step;
}

export async function finishOperationRun(db: OperationDatabase, input: {
  runId: string;
  status: Exclude<OperationRunStatus, "pending" | "running">;
  errorCode?: string;
  summary?: unknown;
}): Promise<OperationRunRecord> {
  await ensureOperationRuntimeSchema(db);
  const update = await db.prepare(`UPDATE operation_runs SET
    status=?, error_code=?, summary_json=?, completed_at=CURRENT_TIMESTAMP,
    duration_ms=MAX(0, CAST((julianday(CURRENT_TIMESTAMP)-julianday(started_at))*86400000 AS INTEGER)),
    heartbeat_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND status IN ('pending','running')`).bind(
    input.status,
    boundedText(input.errorCode, 120),
    safeJson(input.summary),
    identifier(input.runId, ""),
  ).run();
  const run = await requireOperationRun(db, input.runId);
  if (Number(update.meta.changes ?? 0) === 0) return run;
  await recordOperationEvent(db, {
    runId: run.id,
    traceId: run.traceId,
    eventType: `run.${run.status}`,
    level: run.status === "failed" ? "error" : run.status === "cancelled" ? "warning" : "info",
    stage: "completed",
    attributes: { errorCode: run.errorCode, durationMs: run.durationMs },
  });
  return run;
}

export async function heartbeatOperation(db: OperationDatabase, input: { runId: string; stepId?: string }): Promise<void> {
  await ensureOperationRuntimeSchema(db);
  await db.prepare(`UPDATE operation_runs SET heartbeat_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND status='running'`).bind(identifier(input.runId, "")).run();
  if (input.stepId) {
    await db.prepare(`UPDATE operation_steps SET heartbeat_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND run_id=? AND status='running'`).bind(identifier(input.stepId, ""), identifier(input.runId, "")).run();
  }
}

export async function recordOperationEvent(db: OperationDatabase, input: {
  runId: string;
  stepId?: string | null;
  traceId: string;
  spanId?: string | null;
  parentSpanId?: string | null;
  eventType: string;
  level?: OperationEventLevel;
  stage?: string;
  attributes?: unknown;
}): Promise<void> {
  await ensureOperationRuntimeSchema(db);
  await db.prepare(`INSERT INTO operation_events (
    id, run_id, step_id, trace_id, span_id, parent_span_id, event_type, level, stage, attributes_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    `op-event-${crypto.randomUUID()}`,
    identifier(input.runId, ""),
    optionalIdentifier(input.stepId) || null,
    identifier(input.traceId, input.runId),
    optionalIdentifier(input.spanId) || null,
    optionalIdentifier(input.parentSpanId) || null,
    identifier(input.eventType, "event"),
    input.level ?? "info",
    boundedText(input.stage, 120),
    safeJson(input.attributes),
  ).run();
}

export async function getOperationRunDetails(db: OperationDatabase, runId: string): Promise<{
  run: OperationRunRecord;
  steps: OperationStepRecord[];
  events: OperationEventRecord[];
}> {
  await ensureOperationRuntimeSchema(db);
  const run = await requireOperationRun(db, runId);
  const steps = await db.prepare(`${stepSelectSql} WHERE run_id=? ORDER BY created_at, id LIMIT 300`)
    .bind(run.id).all<OperationStepRow>();
  const events = await db.prepare(`${eventSelectSql} WHERE run_id=? ORDER BY sequence LIMIT ?`)
    .bind(run.id, OPERATION_RUNTIME_LIMITS.listEvents).all<OperationEventRow>();
  return {
    run,
    steps: (steps.results ?? []).map(mapStep),
    events: (events.results ?? []).map(mapEvent),
  };
}

export async function listOperationRuns(db: OperationDatabase, input: {
  runType?: string;
  status?: OperationRunStatus;
  platform?: string;
  shopName?: string;
  dataset?: string;
  limit?: number;
} = {}): Promise<{ items: OperationRunRecord[]; returned: number; truncated: boolean }> {
  await ensureOperationRuntimeSchema(db);
  const conditions: string[] = [];
  const values: unknown[] = [];
  for (const [column, value] of [
    ["run_type", input.runType], ["status", input.status], ["platform", input.platform],
    ["shop_name", input.shopName], ["dataset", input.dataset],
  ] as const) {
    if (!value) continue;
    conditions.push(`${column}=?`);
    values.push(boundedText(value, 160));
  }
  const limit = boundedInteger(input.limit, 50, 1, OPERATION_RUNTIME_LIMITS.listRuns);
  const rows = await db.prepare(`${runSelectSql}${conditions.length ? ` WHERE ${conditions.join(" AND ")}` : ""}
    ORDER BY created_at DESC, id DESC LIMIT ?`).bind(...values, limit + 1).all<OperationRunRow>();
  const all = rows.results ?? [];
  return { items: all.slice(0, limit).map(mapRun), returned: Math.min(limit, all.length), truncated: all.length > limit };
}

export async function getOperationMetrics(db: OperationDatabase, input: { runType?: string; since?: string } = {}) {
  await ensureOperationRuntimeSchema(db);
  const conditions = ["status IN ('succeeded','failed','cancelled')", "duration_ms IS NOT NULL"];
  const values: unknown[] = [];
  if (input.runType) { conditions.push("run_type=?"); values.push(boundedText(input.runType, 160)); }
  if (input.since) { conditions.push("started_at>=?"); values.push(normalizeDateTime(input.since)); }
  const rows = await db.prepare(`SELECT run_type, status, duration_ms FROM operation_runs
    WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT ?`)
    .bind(...values, OPERATION_RUNTIME_LIMITS.metricSampleRuns).all<{ run_type: string; status: OperationRunStatus; duration_ms: number }>();
  const samples = rows.results ?? [];
  const durations = samples.map((row) => Number(row.duration_ms)).filter(Number.isFinite).sort((a, b) => a - b);
  const succeeded = samples.filter((row) => row.status === "succeeded").length;
  const failed = samples.filter((row) => row.status === "failed").length;
  const cancelled = samples.filter((row) => row.status === "cancelled").length;
  const byRunType = new Map<string, { total: number; succeeded: number; failed: number; cancelled: number }>();
  for (const row of samples) {
    const item = byRunType.get(row.run_type) ?? { total: 0, succeeded: 0, failed: 0, cancelled: 0 };
    item.total += 1;
    item[row.status as "succeeded" | "failed" | "cancelled"] += 1;
    byRunType.set(row.run_type, item);
  }
  return {
    sampleSize: samples.length,
    truncated: samples.length >= OPERATION_RUNTIME_LIMITS.metricSampleRuns,
    succeeded,
    failed,
    cancelled,
    successRate: samples.length ? succeeded / samples.length : null,
    durationMs: {
      average: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null,
      p50: percentile(durations, 0.5),
      p95: percentile(durations, 0.95),
      maximum: durations.at(-1) ?? null,
    },
    byRunType: Object.fromEntries(byRunType),
  };
}

type OperationRunRow = {
  id: string; trace_id: string; parent_run_id: string | null; run_type: string; surface: string;
  actor_email: string; actor_role: string; platform: string; shop_name: string; dataset: string;
  scope_json: string; idempotency_key: string; status: OperationRunStatus; error_code: string;
  summary_json: string; started_at: string; heartbeat_at: string; completed_at: string | null; duration_ms: number | null;
};
type OperationStepRow = {
  id: string; run_id: string; trace_id: string; span_id: string; parent_span_id: string | null;
  step_type: string; step_key: string; attempt_no: number; status: OperationStepStatus; error_code: string;
  attributes_json: string; result_json: string; started_at: string; heartbeat_at: string;
  completed_at: string | null; duration_ms: number | null;
};
type OperationEventRow = {
  sequence: number; id: string; run_id: string; step_id: string | null; trace_id: string;
  span_id: string | null; parent_span_id: string | null; event_type: string; level: OperationEventLevel;
  stage: string; attributes_json: string; occurred_at: string;
};

const runSelectSql = `SELECT id, trace_id, parent_run_id, run_type, surface, actor_email, actor_role,
  platform, shop_name, dataset, scope_json, idempotency_key, status, error_code, summary_json,
  started_at, heartbeat_at, completed_at, duration_ms FROM operation_runs`;
const stepSelectSql = `SELECT id, run_id, trace_id, span_id, parent_span_id, step_type, step_key,
  attempt_no, status, error_code, attributes_json, result_json, started_at, heartbeat_at,
  completed_at, duration_ms FROM operation_steps`;
const eventSelectSql = `SELECT sequence, id, run_id, step_id, trace_id, span_id, parent_span_id,
  event_type, level, stage, attributes_json, occurred_at FROM operation_events`;

async function requireOperationRun(db: OperationDatabase, runId: string) {
  const row = await db.prepare(`${runSelectSql} WHERE id=? LIMIT 1`).bind(identifier(runId, "")).first<OperationRunRow>();
  if (!row) throw new Error("operation run not found");
  return mapRun(row);
}

async function requireOperationStep(db: OperationDatabase, stepId: string) {
  const row = await db.prepare(`${stepSelectSql} WHERE id=? LIMIT 1`).bind(identifier(stepId, "")).first<OperationStepRow>();
  if (!row) throw new Error("operation step not found");
  return mapStep(row);
}

async function findRunByIdempotency(db: OperationDatabase, runType: string, key: string) {
  const row = await db.prepare(`${runSelectSql} WHERE run_type=? AND idempotency_key=? LIMIT 1`)
    .bind(runType, key).first<OperationRunRow>();
  return row ? mapRun(row) : null;
}

async function findOperationStep(db: OperationDatabase, runId: string, stepKey: string, attemptNo: number) {
  const row = await db.prepare(`${stepSelectSql} WHERE run_id=? AND step_key=? AND attempt_no=? LIMIT 1`)
    .bind(runId, stepKey, attemptNo).first<OperationStepRow>();
  return row ? mapStep(row) : null;
}

function mapRun(row: OperationRunRow): OperationRunRecord {
  return {
    id: row.id, traceId: row.trace_id, parentRunId: row.parent_run_id, runType: row.run_type,
    surface: row.surface, actorEmail: row.actor_email, actorRole: row.actor_role,
    platform: row.platform, shopName: row.shop_name, dataset: row.dataset,
    scope: parsedObject(row.scope_json), idempotencyKey: row.idempotency_key, status: row.status,
    errorCode: row.error_code, summary: parsedObject(row.summary_json), startedAt: row.started_at,
    heartbeatAt: row.heartbeat_at, completedAt: row.completed_at,
    durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
  };
}

function mapStep(row: OperationStepRow): OperationStepRecord {
  return {
    id: row.id, runId: row.run_id, traceId: row.trace_id, spanId: row.span_id,
    parentSpanId: row.parent_span_id, stepType: row.step_type, stepKey: row.step_key,
    attemptNo: Number(row.attempt_no), status: row.status, errorCode: row.error_code,
    attributes: parsedObject(row.attributes_json), result: parsedObject(row.result_json),
    startedAt: row.started_at, heartbeatAt: row.heartbeat_at, completedAt: row.completed_at,
    durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
  };
}

function mapEvent(row: OperationEventRow): OperationEventRecord {
  return {
    sequence: Number(row.sequence), id: row.id, runId: row.run_id, stepId: row.step_id,
    traceId: row.trace_id, spanId: row.span_id, parentSpanId: row.parent_span_id,
    eventType: row.event_type, level: row.level, stage: row.stage,
    attributes: parsedObject(row.attributes_json), occurredAt: row.occurred_at,
  };
}

function identifier(value: unknown, fallback: string): string {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/.test(candidate)) return candidate;
  return fallback;
}

function optionalIdentifier(value: unknown): string {
  return identifier(value, "");
}

function boundedText(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maximum) : "";
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const candidate = Number.isSafeInteger(value) ? Number(value) : fallback;
  return Math.min(maximum, Math.max(minimum, candidate));
}

function safeJson(value: unknown): string {
  const sanitized = sanitize(value, 0);
  const serialized = JSON.stringify(sanitized ?? {});
  return serialized.length <= OPERATION_RUNTIME_LIMITS.attributeCharacters
    ? serialized
    : JSON.stringify({ truncated: true, originalCharacters: serialized.length });
}

function sanitize(value: unknown, depth: number): unknown {
  if (depth > 4 || value === undefined) return null;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return boundedText(value, 500);
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitize(item, depth + 1));
  if (typeof value !== "object") return null;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 64)) {
    if (/secret|password|token|cookie|authorization|api.?key|raw|content|message|chat|transcript/i.test(key)) continue;
    result[boundedText(key, 80)] = sanitize(item, depth + 1);
  }
  return result;
}

function parsedObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function percentile(values: number[], ratio: number): number | null {
  if (!values.length) return null;
  return values[Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * ratio) - 1))];
}

function normalizeDateTime(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error("since must be a valid date-time");
  return parsed.toISOString();
}
import type { SalesDatabase } from "@/lib/sales/database";
