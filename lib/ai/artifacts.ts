import type { AppPrincipal } from "@/lib/auth/authorization";
import type { SalesDatabase } from "@/lib/sales/database";

export const AI_ARTIFACT_LIMITS = {
  artifactsPerMessage: 3,
  rowsPerTable: 50,
  columnsPerTable: 12,
  cellCharacters: 240,
  payloadBytes: 64 * 1024,
} as const;

export type AiArtifactCell = string | number | boolean | null;

export type AiTableArtifactCandidate = {
  kind: "table";
  title: string;
  sourceTool: string;
  columns: string[];
  rows: AiArtifactCell[][];
  rowCount: number;
  truncated: boolean;
};

export type AiTableArtifact = AiTableArtifactCandidate & {
  id: string;
  fileName: string;
  mimeType: "text/csv; charset=utf-8";
  contentDigest: string;
  downloadUrl: string;
  createdAt: string;
};

type AiArtifactRow = {
  id: string;
  conversation_id: string;
  message_id: string;
  owner_email: string;
  kind: string;
  title: string;
  file_name: string;
  mime_type: string;
  source_tool: string;
  columns_json: string;
  rows_json: string;
  row_count: number;
  truncated: number;
  content_digest: string;
  created_at: string;
};

const artifactSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS ai_artifacts (
    id TEXT PRIMARY KEY NOT NULL,
    conversation_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    owner_email TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('table')),
    title TEXT NOT NULL,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    source_tool TEXT NOT NULL,
    columns_json TEXT NOT NULL DEFAULT '[]',
    rows_json TEXT NOT NULL DEFAULT '[]',
    row_count INTEGER NOT NULL DEFAULT 0,
    truncated INTEGER NOT NULL DEFAULT 0,
    content_digest TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS ai_artifacts_conversation_message_idx
    ON ai_artifacts (conversation_id, message_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS ai_artifacts_owner_created_idx
    ON ai_artifacts (owner_email, created_at)`,
  `CREATE TABLE IF NOT EXISTS ai_artifact_deliveries (
    id TEXT PRIMARY KEY NOT NULL,
    artifact_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    actor_email TEXT NOT NULL,
    actor_role TEXT NOT NULL,
    surface TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed')),
    byte_size INTEGER,
    content_digest TEXT,
    error_code TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS ai_artifact_deliveries_artifact_created_idx
    ON ai_artifact_deliveries (artifact_id, created_at)`,
] as const;

const artifactReadyByDatabase = new WeakMap<object, Promise<void>>();
const unsafeColumnPattern = /secret|password|token|api.?key|authorization|raw|content|message|chat|transcript/i;
const artifactIdPattern = /^ai-artifact-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isAiArtifactId(value: string) {
  return artifactIdPattern.test(value);
}

export async function ensureAiArtifactSchema(
  db: SalesDatabase,
): Promise<void> {
  const key = db as unknown as object;
  const existing = artifactReadyByDatabase.get(key);
  if (existing) return existing;
  const setup = db.batch(artifactSchemaStatements.map((statement) => db.prepare(statement)))
    .then(() => undefined)
    .catch((error: unknown) => {
      artifactReadyByDatabase.delete(key);
      throw error;
    });
  artifactReadyByDatabase.set(key, setup);
  return setup;
}

export function extractAiTableArtifactCandidates(input: {
  toolName: string;
  toolTitle: string;
  data: Record<string, unknown>;
}): AiTableArtifactCandidate[] {
  const candidates: AiTableArtifactCandidate[] = [];
  for (const collectionKey of ["items", "daily"] as const) {
    const collection = input.data[collectionKey];
    if (!Array.isArray(collection) || collection.length === 0) continue;
    const records = collection.filter(isRecord);
    if (records.length === 0) continue;
    const candidate = tableCandidate({
      records,
      collectionLength: collection.length,
      collectionKey,
      toolName: input.toolName,
      toolTitle: input.toolTitle,
      totalMatched: input.data.totalMatched,
      declaredTruncated: input.data.truncated,
    });
    if (candidate) candidates.push(candidate);
    if (candidates.length >= AI_ARTIFACT_LIMITS.artifactsPerMessage) break;
  }
  return candidates;
}

export async function persistAiTableArtifacts(input: {
  conversationId: string;
  messageId: string;
  ownerEmail: string;
  candidates: readonly AiTableArtifactCandidate[];
  database: SalesDatabase;
}): Promise<AiTableArtifact[]> {
  const db = input.database;
  await ensureAiArtifactSchema(db);
  const candidates = boundAiTableArtifactCandidates(input.candidates);
  const rows = await Promise.all(candidates.map(async (candidate) => {
    const id = `ai-artifact-${crypto.randomUUID()}`;
    const fileName = `teruisi-ai-table-${id.slice(-12)}.csv`;
    const canonical = JSON.stringify({
      kind: candidate.kind,
      title: candidate.title,
      sourceTool: candidate.sourceTool,
      columns: candidate.columns,
      rows: candidate.rows,
      rowCount: candidate.rowCount,
      truncated: candidate.truncated,
    });
    return {
      id,
      fileName,
      candidate,
      contentDigest: await sha256Hex(canonical),
    };
  }));
  if (rows.length > 0) {
    await db.batch(rows.map((row) => db.prepare(
      `INSERT INTO ai_artifacts (
        id, conversation_id, message_id, owner_email, kind, title, file_name, mime_type,
        source_tool, columns_json, rows_json, row_count, truncated, content_digest
      ) VALUES (?, ?, ?, ?, 'table', ?, ?, 'text/csv; charset=utf-8', ?, ?, ?, ?, ?, ?)`,
    ).bind(
      row.id,
      input.conversationId,
      input.messageId,
      input.ownerEmail,
      row.candidate.title,
      row.fileName,
      row.candidate.sourceTool,
      JSON.stringify(row.candidate.columns),
      JSON.stringify(row.candidate.rows),
      row.candidate.rowCount,
      row.candidate.truncated ? 1 : 0,
      row.contentDigest,
    )));
  }
  return rows.map((row) => ({
    id: row.id,
    ...row.candidate,
    fileName: row.fileName,
    mimeType: "text/csv; charset=utf-8",
    contentDigest: row.contentDigest,
    downloadUrl: `/api/ai/artifacts/${encodeURIComponent(row.id)}`,
    createdAt: new Date().toISOString(),
  }));
}

export function boundAiTableArtifactCandidates(
  input: readonly AiTableArtifactCandidate[],
): AiTableArtifactCandidate[] {
  const bounded: AiTableArtifactCandidate[] = [];
  let usedBytes = 0;
  for (const source of input.slice(0, AI_ARTIFACT_LIMITS.artifactsPerMessage)) {
    let candidate: AiTableArtifactCandidate = {
      ...source,
      columns: source.columns.slice(0, AI_ARTIFACT_LIMITS.columnsPerTable),
      rows: source.rows.slice(0, AI_ARTIFACT_LIMITS.rowsPerTable).map((row) =>
        row.slice(0, AI_ARTIFACT_LIMITS.columnsPerTable)),
    };
    while (candidate.rows.length > 0
      && usedBytes + artifactPayloadBytes(candidate) > AI_ARTIFACT_LIMITS.payloadBytes) {
      candidate = { ...candidate, rows: candidate.rows.slice(0, -1), truncated: true };
    }
    if (candidate.rows.length === 0) break;
    usedBytes += artifactPayloadBytes(candidate);
    bounded.push(candidate);
  }
  return bounded;
}

export async function listAiArtifactsForConversation(
  conversationId: string,
  principal: AppPrincipal,
  db: SalesDatabase,
): Promise<Map<string, AiTableArtifact[]>> {
  await ensureAiArtifactSchema(db);
  const rows = await db.prepare(
    `SELECT id, conversation_id, message_id, owner_email, kind, title, file_name,
      mime_type, source_tool, columns_json, rows_json, row_count, truncated,
      content_digest, created_at
     FROM ai_artifacts
     WHERE conversation_id = ?
       AND (? = 'admin' OR owner_email = ?)
     ORDER BY created_at ASC, id ASC
     LIMIT 300`,
  ).bind(conversationId, principal.role, principal.email).all<AiArtifactRow>();
  const byMessage = new Map<string, AiTableArtifact[]>();
  for (const row of rows.results ?? []) {
    const artifact = mapArtifactRow(row);
    if (!artifact) continue;
    const current = byMessage.get(row.message_id) ?? [];
    if (current.length < AI_ARTIFACT_LIMITS.artifactsPerMessage) current.push(artifact);
    byMessage.set(row.message_id, current);
  }
  return byMessage;
}

export async function getAiArtifactDownload(
  artifactId: string,
  principal: AppPrincipal,
  db: SalesDatabase,
): Promise<{ artifact: AiTableArtifact; bytes: Uint8Array; contentDigest: string } | null> {
  if (!isAiArtifactId(artifactId)) return null;
  await ensureAiArtifactSchema(db);
  const row = await db.prepare(
    `SELECT id, conversation_id, message_id, owner_email, kind, title, file_name,
      mime_type, source_tool, columns_json, rows_json, row_count, truncated,
      content_digest, created_at
     FROM ai_artifacts
     WHERE id = ? AND (? = 'admin' OR owner_email = ?)
     LIMIT 1`,
  ).bind(artifactId, principal.role, principal.email).first<AiArtifactRow>();
  if (!row) return null;
  const artifact = mapArtifactRow(row);
  if (!artifact) return null;
  const csv = toSafeCsv(artifact.columns, artifact.rows);
  const bytes = new TextEncoder().encode(`\uFEFF${csv}`);
  const contentDigest = await sha256HexBytes(bytes);
  return { artifact, bytes, contentDigest };
}

export async function recordAiArtifactDelivery(input: {
  artifactId: string;
  requestId: string;
  principal: AppPrincipal;
  status: "succeeded" | "failed";
  byteSize?: number;
  contentDigest?: string;
  errorCode?: string;
  database: SalesDatabase;
}): Promise<void> {
  const db = input.database;
  await ensureAiArtifactSchema(db);
  await db.prepare(
    `INSERT INTO ai_artifact_deliveries (
      id, artifact_id, request_id, actor_email, actor_role, surface, status,
      byte_size, content_digest, error_code
    ) VALUES (?, ?, ?, ?, ?, 'web_download', ?, ?, ?, ?)`,
  ).bind(
    `ai-delivery-${crypto.randomUUID()}`,
    input.artifactId,
    input.requestId.slice(0, 200),
    input.principal.email,
    input.principal.role,
    input.status,
    input.byteSize ?? null,
    input.contentDigest?.slice(0, 128) ?? null,
    input.errorCode?.slice(0, 80) ?? null,
  ).run();
}

export function toSafeCsv(columns: readonly string[], rows: readonly (readonly AiArtifactCell[])[]) {
  return [columns.map(csvCell).join(","), ...rows.map((row) => columns.map((_, index) => csvCell(row[index] ?? null)).join(","))].join("\r\n");
}

function tableCandidate(input: {
  records: Record<string, unknown>[];
  collectionLength: number;
  collectionKey: "items" | "daily";
  toolName: string;
  toolTitle: string;
  totalMatched: unknown;
  declaredTruncated: unknown;
}): AiTableArtifactCandidate | null {
  const allColumns: string[] = [];
  let cellTruncated = false;
  for (const record of input.records.slice(0, AI_ARTIFACT_LIMITS.rowsPerTable)) {
    for (const [key, value] of Object.entries(record)) {
      if (!safeColumnName(key) || !isScalar(value) || allColumns.includes(key)) continue;
      allColumns.push(key);
    }
  }
  const columns = allColumns.slice(0, AI_ARTIFACT_LIMITS.columnsPerTable);
  if (columns.length === 0) return null;
  let rows = input.records.slice(0, AI_ARTIFACT_LIMITS.rowsPerTable).map((record) => columns.map((column) => {
    const normalized = normalizeCell(record[column]);
    if (normalized.truncated) cellTruncated = true;
    return normalized.value;
  }));
  let payloadTruncated = false;
  while (rows.length > 1 && artifactPayloadBytes({
    kind: "table",
    title: `${input.toolTitle} · ${input.collectionKey === "daily" ? "每日明细" : "结果明细"}`.slice(0, 160),
    sourceTool: input.toolName,
    columns,
    rows,
    rowCount: input.collectionLength,
    truncated: true,
  }) > AI_ARTIFACT_LIMITS.payloadBytes) {
    rows = rows.slice(0, -1);
    payloadTruncated = true;
  }
  const rowCount = typeof input.totalMatched === "number" && Number.isSafeInteger(input.totalMatched) && input.totalMatched >= input.collectionLength
    ? input.totalMatched
    : input.collectionLength;
  return {
    kind: "table",
    title: `${input.toolTitle} · ${input.collectionKey === "daily" ? "每日明细" : "结果明细"}`.slice(0, 160),
    sourceTool: input.toolName,
    columns,
    rows,
    rowCount,
    truncated: Boolean(input.declaredTruncated)
      || input.records.length > rows.length
      || allColumns.length > columns.length
      || cellTruncated
      || payloadTruncated,
  };
}

function mapArtifactRow(row: AiArtifactRow): AiTableArtifact | null {
  if (row.kind !== "table") return null;
  const columns = parseColumns(row.columns_json);
  const rows = parseRows(row.rows_json, columns.length);
  if (columns.length === 0) return null;
  return {
    id: row.id,
    kind: "table",
    title: row.title.slice(0, 160),
    sourceTool: row.source_tool.slice(0, 64),
    columns,
    rows,
    rowCount: Math.max(rows.length, Math.trunc(row.row_count)),
    truncated: Boolean(row.truncated),
    fileName: row.file_name,
    mimeType: "text/csv; charset=utf-8",
    contentDigest: row.content_digest,
    downloadUrl: `/api/ai/artifacts/${encodeURIComponent(row.id)}`,
    createdAt: row.created_at,
  };
}

function parseColumns(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && safeColumnName(item))
      .slice(0, AI_ARTIFACT_LIMITS.columnsPerTable);
  } catch {
    return [];
  }
}

function parseRows(value: string, columnCount: number): AiArtifactCell[][] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(Array.isArray).slice(0, AI_ARTIFACT_LIMITS.rowsPerTable).map((row) =>
      Array.from({ length: columnCount }, (_, index) => normalizeCell(row[index]).value));
  } catch {
    return [];
  }
}

function safeColumnName(value: string) {
  return Array.from(value).length <= 64
    && /^[\p{L}_][\p{L}\p{N}_-]*$/u.test(value)
    && !unsafeColumnPattern.test(value);
}

function normalizeCell(value: unknown): { value: AiArtifactCell; truncated: boolean } {
  if (!isScalar(value)) return { value: null, truncated: value !== undefined && value !== null };
  if (typeof value !== "string") return { value, truncated: false };
  const normalized = value.replace(/\u0000/g, "");
  const characters = Array.from(normalized);
  return characters.length > AI_ARTIFACT_LIMITS.cellCharacters
    ? { value: `${characters.slice(0, AI_ARTIFACT_LIMITS.cellCharacters - 1).join("")}…`, truncated: true }
    : { value: normalized, truncated: false };
}

function csvCell(value: AiArtifactCell) {
  if (value === null) return "";
  let text = String(value).replace(/\u0000/g, "");
  if (typeof value === "string" && /^[\u0001-\u0020]*[=+\-@]/u.test(text)) text = `'${text}`;
  return /[",\r\n]/u.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function isScalar(value: unknown): value is AiArtifactCell {
  return value === null || typeof value === "string" || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function utf8Length(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function artifactPayloadBytes(candidate: AiTableArtifactCandidate) {
  return utf8Length(JSON.stringify(candidate));
}

async function sha256Hex(value: string) {
  return sha256HexBytes(new TextEncoder().encode(value));
}

async function sha256HexBytes(value: Uint8Array) {
  const digestInput = new Uint8Array(value.byteLength);
  digestInput.set(value);
  const digest = await crypto.subtle.digest("SHA-256", digestInput.buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
