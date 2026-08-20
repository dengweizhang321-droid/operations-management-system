import { env } from "cloudflare:workers";
import { ensureSalesSchema, getSalesDatabase, type SalesDatabase } from "@/lib/sales/database";
import { PublicApiError } from "@/lib/http/api-error";

// Keep requests beneath conservative development-proxy body limits as well as
// production edge limits. The client uploads these sequentially and resumes by index.
export const SALES_UPLOAD_CHUNK_BYTES = 2 * 1024 * 1024;
export const MAX_CHUNKED_SALES_FILE_BYTES = 128 * 1024 * 1024;
const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;

function uploadRequestError(status: 400 | 404 | 409 | 413 | 422, message: string) {
  const code = status === 404 ? "not_found" : status === 409 ? "conflict" : status === 413 ? "payload_too_large" : "invalid_request";
  return new PublicApiError(status, code, message);
}

type UploadRow = {
  id: string;
  fingerprint: string;
  file_name: string;
  file_size_bytes: number;
  chunk_size_bytes: number;
  chunk_count: number;
  received_chunk_count: number;
  received_bytes: number;
  status: string;
  expires_at: string;
};

type ChunkRow = {
  chunk_index: number;
  object_key: string;
  size_bytes: number;
  sha256: string;
};

export type SalesUploadSession = {
  id: string;
  fingerprint: string;
  fileName: string;
  fileSizeBytes: number;
  chunkSizeBytes: number;
  chunkCount: number;
  receivedChunkIndexes: number[];
  receivedBytes: number;
  status: string;
  expiresAt: string;
};

export type SalesUploadClaim = { kind: "claimed"; session: SalesUploadSession };

function toHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sha256(bytes: Uint8Array) {
  const input = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return crypto.subtle.digest("SHA-256", input);
}

function bucket() {
  if (!env.SALES_IMPORT_FILES) {
    throw new Error("R2 binding `SALES_IMPORT_FILES` is unavailable.");
  }
  return env.SALES_IMPORT_FILES;
}

function safeFileName(name: string) {
  return (name.split(/[\\/]/).pop() ?? "sales-ledger.xlsx").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 255);
}

function expiresAt() {
  return new Date(Date.now() + UPLOAD_TTL_MS).toISOString();
}

function nowIso() {
  return new Date().toISOString();
}

async function getUpload(db: SalesDatabase, uploadId: string): Promise<UploadRow | null> {
  return db.prepare(`SELECT id, fingerprint, file_name, file_size_bytes, chunk_size_bytes, chunk_count,
    received_chunk_count, received_bytes, status, expires_at
    FROM sales_import_uploads WHERE id = ? LIMIT 1`).bind(uploadId).first<UploadRow>();
}

async function listChunks(db: SalesDatabase, uploadId: string): Promise<ChunkRow[]> {
  const result = await db.prepare(`SELECT chunk_index, object_key, size_bytes, sha256
    FROM sales_import_upload_chunks WHERE upload_id = ? ORDER BY chunk_index ASC`).bind(uploadId).all<ChunkRow>();
  return result.results as ChunkRow[];
}

async function getChunk(db: SalesDatabase, uploadId: string, chunkIndex: number) {
  return db.prepare(`SELECT chunk_index, object_key, size_bytes, sha256
    FROM sales_import_upload_chunks WHERE upload_id = ? AND chunk_index = ? LIMIT 1`)
    .bind(uploadId, chunkIndex)
    .first<ChunkRow>();
}

function toSession(upload: UploadRow, chunks: ChunkRow[]): SalesUploadSession {
  return {
    id: upload.id,
    fingerprint: upload.fingerprint,
    fileName: upload.file_name,
    fileSizeBytes: Number(upload.file_size_bytes),
    chunkSizeBytes: Number(upload.chunk_size_bytes),
    chunkCount: Number(upload.chunk_count),
    receivedChunkIndexes: chunks.map((chunk) => Number(chunk.chunk_index)),
    receivedBytes: Number(upload.received_bytes),
    status: upload.status,
    expiresAt: upload.expires_at,
  };
}

export async function beginSalesUpload(input: {
  fileName: string;
  fileSizeBytes: number;
  chunkCount: number;
  fingerprint: string;
}): Promise<SalesUploadSession> {
  if (!input.fileName.toLowerCase().endsWith(".xlsx")) throw uploadRequestError(422, "仅支持 .xlsx 格式的销售单明细账");
  if (!Number.isSafeInteger(input.fileSizeBytes) || input.fileSizeBytes <= 0) throw uploadRequestError(400, "文件大小无效");
  if (input.fileSizeBytes > MAX_CHUNKED_SALES_FILE_BYTES) throw uploadRequestError(413, "单个报表最大支持 128MB");
  const expectedCount = Math.ceil(input.fileSizeBytes / SALES_UPLOAD_CHUNK_BYTES);
  if (!Number.isSafeInteger(input.chunkCount) || input.chunkCount !== expectedCount) throw uploadRequestError(400, "分片数量与文件大小不一致");
  if (!input.fingerprint || input.fingerprint.length > 255) throw uploadRequestError(400, "上传指纹无效");

  const db = getSalesDatabase();
  await ensureSalesSchema(db);
  const existing = await db.prepare(`SELECT id, fingerprint, file_name, file_size_bytes, chunk_size_bytes, chunk_count,
    received_chunk_count, received_bytes, status, expires_at
    FROM sales_import_uploads WHERE fingerprint = ? AND expires_at > ?
    AND status IN ('uploading', 'ready', 'processing') LIMIT 1`).bind(input.fingerprint, nowIso()).first<UploadRow>();
  if (existing) return toSession(existing, await listChunks(db, existing.id));

  // A completed or expired fingerprint may be reused by a later retry. Remove
  // its short-lived blobs before creating the new authoritative session.
  const stale = await db.prepare(`SELECT id, fingerprint, file_name, file_size_bytes, chunk_size_bytes, chunk_count,
    received_chunk_count, received_bytes, status, expires_at
    FROM sales_import_uploads WHERE fingerprint = ? LIMIT 1`).bind(input.fingerprint).first<UploadRow>();
  if (stale) {
    const staleChunks = await listChunks(db, stale.id);
    if (staleChunks.length > 0) await bucket().delete(staleChunks.map((chunk) => chunk.object_key));
    await db.batch([
      db.prepare("DELETE FROM sales_import_upload_chunks WHERE upload_id = ?").bind(stale.id),
      db.prepare("DELETE FROM sales_import_uploads WHERE id = ?").bind(stale.id),
    ]);
  }

  const id = crypto.randomUUID();
  await db.prepare(`INSERT INTO sales_import_uploads (
    id, fingerprint, file_name, file_size_bytes, chunk_size_bytes, chunk_count, expires_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, input.fingerprint, safeFileName(input.fileName), input.fileSizeBytes, SALES_UPLOAD_CHUNK_BYTES, input.chunkCount, expiresAt())
    .run();
  const created = await getUpload(db, id);
  if (!created) throw new Error("无法创建分片上传会话");
  return toSession(created, []);
}

export async function receiveSalesUploadChunk(input: {
  uploadId: string;
  chunkIndex: number;
  bytes: Uint8Array;
}): Promise<SalesUploadSession> {
  const db = getSalesDatabase();
  await ensureSalesSchema(db);
  const upload = await getUpload(db, input.uploadId);
  if (!upload || upload.expires_at <= nowIso()) throw uploadRequestError(404, "上传会话已过期，请重新选择文件");
  if (upload.status === "completed") throw uploadRequestError(409, "该上传会话已完成");
  if (upload.status === "processing") throw uploadRequestError(409, "销售文件正在合并处理，不能继续覆盖分片");
  if (upload.status !== "uploading" && upload.status !== "ready") throw uploadRequestError(409, "上传会话状态无效，请重新选择文件");
  if (!Number.isSafeInteger(input.chunkIndex) || input.chunkIndex < 0 || input.chunkIndex >= upload.chunk_count) throw uploadRequestError(400, "分片序号无效");
  const isLast = input.chunkIndex === upload.chunk_count - 1;
  const expectedBytes = isLast
    ? upload.file_size_bytes - upload.chunk_size_bytes * (upload.chunk_count - 1)
    : upload.chunk_size_bytes;
  if (input.bytes.byteLength !== expectedBytes) throw uploadRequestError(422, "分片大小与预期不一致");

  const checksum = toHex(await sha256(input.bytes));
  const previous = await getChunk(db, upload.id, input.chunkIndex);
  // Every PUT gets a unique object. A rejected concurrent retry can therefore
  // delete only its own unreferenced attempt, never an object already adopted
  // by the authoritative D1 chunk row.
  const objectKey = `sales-upload/${upload.id}/${input.chunkIndex.toString().padStart(6, "0")}-${checksum}-${crypto.randomUUID()}`;
  await bucket().put(objectKey, input.bytes, { httpMetadata: { contentType: "application/octet-stream" } });
  const results = await db.batch([
    db.prepare(`INSERT INTO sales_import_upload_chunks (upload_id, chunk_index, object_key, size_bytes, sha256)
      SELECT ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM sales_import_uploads
        WHERE id = ? AND status IN ('uploading', 'ready') AND expires_at > ?
      )
      ON CONFLICT(upload_id, chunk_index) DO UPDATE SET object_key = excluded.object_key, size_bytes = excluded.size_bytes, sha256 = excluded.sha256`)
      .bind(upload.id, input.chunkIndex, objectKey, input.bytes.byteLength, checksum, upload.id, nowIso()),
    db.prepare(`UPDATE sales_import_uploads
      SET received_chunk_count = (SELECT COUNT(*) FROM sales_import_upload_chunks WHERE upload_id = ?),
          received_bytes = (SELECT COALESCE(SUM(size_bytes), 0) FROM sales_import_upload_chunks WHERE upload_id = ?),
          status = CASE WHEN (SELECT COUNT(*) FROM sales_import_upload_chunks WHERE upload_id = ?) = chunk_count THEN 'ready' ELSE 'uploading' END,
          updated_at = CURRENT_TIMESTAMP, expires_at = ?
      WHERE id = ? AND status IN ('uploading', 'ready')`).bind(upload.id, upload.id, upload.id, expiresAt(), upload.id),
  ]);
  if (Number(results[0]?.meta?.changes ?? 0) === 0) {
    await bucket().delete(objectKey).catch(() => undefined);
    throw uploadRequestError(409, "销售文件已开始合并，当前分片未被接收");
  }
  if (previous && previous.object_key !== objectKey) {
    const current = await getChunk(db, upload.id, input.chunkIndex);
    if (current?.object_key !== previous.object_key) {
      await bucket().delete(previous.object_key).catch(() => undefined);
    }
  }
  const refreshed = await getUpload(db, upload.id);
  if (!refreshed) throw new Error("分片写入后无法读取上传会话");
  return toSession(refreshed, await listChunks(db, upload.id));
}

export async function claimSalesUpload(uploadId: string): Promise<SalesUploadClaim> {
  const db = getSalesDatabase();
  await ensureSalesSchema(db);
  let upload = await getUpload(db, uploadId);
  if (!upload || upload.expires_at <= nowIso()) throw uploadRequestError(404, "上传会话已过期，请重新选择文件");
  if (upload.status === "uploading") throw uploadRequestError(409, "仍有分片尚未上传完成");
  if (upload.status === "processing") throw uploadRequestError(409, "销售文件正在被另一个请求处理，请稍后重试");
  if (upload.status === "completed") throw uploadRequestError(409, "该上传会话已完成，请重新初始化以核验重复导入");
  if (upload.status !== "ready") throw uploadRequestError(409, "上传会话状态无效，请重新选择文件");

  const claimed = await db.prepare(`UPDATE sales_import_uploads
    SET status = 'processing', updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'ready' AND expires_at > ?`)
    .bind(uploadId, nowIso())
    .run();
  if (Number(claimed.meta?.changes ?? 0) === 0) {
    upload = await getUpload(db, uploadId);
    throw uploadRequestError(409, upload?.status === "processing"
      ? "销售文件已被另一个请求接管处理，请稍后重试"
      : "销售上传会话接管失败，请重新检查会话状态");
  }
  const refreshed = await getUpload(db, uploadId);
  if (!refreshed) throw new Error("无法读取已接管的销售上传会话");
  return { kind: "claimed", session: toSession(refreshed, await listChunks(db, uploadId)) };
}

export async function assembleSalesUpload(uploadId: string): Promise<{ session: SalesUploadSession; bytes: Uint8Array; objectKeys: string[] }> {
  const db = getSalesDatabase();
  await ensureSalesSchema(db);
  const upload = await getUpload(db, uploadId);
  if (!upload || upload.expires_at <= nowIso()) throw uploadRequestError(404, "上传会话已过期，请重新选择文件");
  if (upload.status !== "processing") throw uploadRequestError(409, "销售上传会话尚未进入处理状态");
  const chunks = await listChunks(db, uploadId);
  if (chunks.length !== upload.chunk_count || chunks.some((chunk, index) => chunk.chunk_index !== index)) {
    throw uploadRequestError(409, "仍有分片尚未上传完成");
  }
  const bytes = new Uint8Array(upload.file_size_bytes);
  let offset = 0;
  for (const chunk of chunks) {
    const object = await bucket().get(chunk.object_key);
    if (!object) throw uploadRequestError(422, "部分上传分片已丢失，请重新上传该文件");
    const part = new Uint8Array(await object.arrayBuffer());
    if (part.byteLength !== chunk.size_bytes) throw uploadRequestError(422, "分片完整性校验失败，请重新上传该文件");
    if (toHex(await sha256(part)) !== chunk.sha256) throw uploadRequestError(422, "分片校验码不一致，请重新上传该文件");
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  if (offset !== bytes.byteLength) throw uploadRequestError(422, "合并后的文件大小不正确");
  const session = toSession(upload, chunks);
  return { session, bytes, objectKeys: chunks.map((chunk) => chunk.object_key) };
}

export async function finishSalesUpload(uploadId: string, objectKeys: string[], completed: boolean) {
  const db = getSalesDatabase();
  if (completed) {
    const updated = await db.prepare(`UPDATE sales_import_uploads
      SET status = 'completed', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'processing'`).bind(uploadId).run();
    if (Number(updated.meta?.changes ?? 0) === 0) throw new Error("销售上传会话完成状态写入失败");
    try {
      if (objectKeys.length > 0) await bucket().delete(objectKeys);
      await db.prepare("DELETE FROM sales_import_upload_chunks WHERE upload_id = ?").bind(uploadId).run();
    } catch {
      // Completion is durable. Expired-session cleanup or a later retry can
      // remove short-lived R2 objects without changing the imported facts.
    }
  } else {
    await db.prepare(`UPDATE sales_import_uploads SET status = 'ready', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'processing'`).bind(uploadId).run();
  }
}
