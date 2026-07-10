import { env } from "cloudflare:workers";
import { ensureSalesSchema, getSalesDatabase, type SalesDatabase } from "@/lib/sales/database";

export const SALES_UPLOAD_CHUNK_BYTES = 5 * 1024 * 1024;
export const MAX_CHUNKED_SALES_FILE_BYTES = 60 * 1024 * 1024;
const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;

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
  fileName: string;
  fileSizeBytes: number;
  chunkSizeBytes: number;
  chunkCount: number;
  receivedChunkIndexes: number[];
  receivedBytes: number;
  status: string;
  expiresAt: string;
};

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

function toSession(upload: UploadRow, chunks: ChunkRow[]): SalesUploadSession {
  return {
    id: upload.id,
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
  if (!input.fileName.toLowerCase().endsWith(".xlsx")) throw new Error("仅支持 .xlsx 格式的销售单明细账");
  if (!Number.isSafeInteger(input.fileSizeBytes) || input.fileSizeBytes <= 0) throw new Error("文件大小无效");
  if (input.fileSizeBytes > MAX_CHUNKED_SALES_FILE_BYTES) throw new Error("单个报表最大支持 60MB");
  const expectedCount = Math.ceil(input.fileSizeBytes / SALES_UPLOAD_CHUNK_BYTES);
  if (!Number.isSafeInteger(input.chunkCount) || input.chunkCount !== expectedCount) throw new Error("分片数量与文件大小不一致");
  if (!input.fingerprint || input.fingerprint.length > 255) throw new Error("上传指纹无效");

  const db = getSalesDatabase();
  await ensureSalesSchema(db);
  const existing = await db.prepare(`SELECT id, fingerprint, file_name, file_size_bytes, chunk_size_bytes, chunk_count,
    received_chunk_count, received_bytes, status, expires_at
    FROM sales_import_uploads WHERE fingerprint = ? AND expires_at > CURRENT_TIMESTAMP
    AND status IN ('uploading', 'ready', 'processing') LIMIT 1`).bind(input.fingerprint).first<UploadRow>();
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
  if (!upload || upload.expires_at <= new Date().toISOString()) throw new Error("上传会话已过期，请重新选择文件");
  if (upload.status === "completed") throw new Error("该上传会话已完成");
  if (!Number.isSafeInteger(input.chunkIndex) || input.chunkIndex < 0 || input.chunkIndex >= upload.chunk_count) throw new Error("分片序号无效");
  const isLast = input.chunkIndex === upload.chunk_count - 1;
  const expectedBytes = isLast
    ? upload.file_size_bytes - upload.chunk_size_bytes * (upload.chunk_count - 1)
    : upload.chunk_size_bytes;
  if (input.bytes.byteLength !== expectedBytes) throw new Error("分片大小与预期不一致");

  const checksum = toHex(await sha256(input.bytes));
  const objectKey = `sales-upload/${upload.id}/${input.chunkIndex.toString().padStart(6, "0")}`;
  await bucket().put(objectKey, input.bytes, { httpMetadata: { contentType: "application/octet-stream" } });
  await db.batch([
    db.prepare(`INSERT INTO sales_import_upload_chunks (upload_id, chunk_index, object_key, size_bytes, sha256)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(upload_id, chunk_index) DO UPDATE SET object_key = excluded.object_key, size_bytes = excluded.size_bytes, sha256 = excluded.sha256`)
      .bind(upload.id, input.chunkIndex, objectKey, input.bytes.byteLength, checksum),
    db.prepare(`UPDATE sales_import_uploads
      SET received_chunk_count = (SELECT COUNT(*) FROM sales_import_upload_chunks WHERE upload_id = ?),
          received_bytes = (SELECT COALESCE(SUM(size_bytes), 0) FROM sales_import_upload_chunks WHERE upload_id = ?),
          status = CASE WHEN (SELECT COUNT(*) FROM sales_import_upload_chunks WHERE upload_id = ?) = chunk_count THEN 'ready' ELSE 'uploading' END,
          updated_at = CURRENT_TIMESTAMP, expires_at = ?
      WHERE id = ?`).bind(upload.id, upload.id, upload.id, expiresAt(), upload.id),
  ]);
  const refreshed = await getUpload(db, upload.id);
  if (!refreshed) throw new Error("分片写入后无法读取上传会话");
  return toSession(refreshed, await listChunks(db, upload.id));
}

export async function assembleSalesUpload(uploadId: string): Promise<{ session: SalesUploadSession; bytes: Uint8Array; objectKeys: string[] }> {
  const db = getSalesDatabase();
  await ensureSalesSchema(db);
  const upload = await getUpload(db, uploadId);
  if (!upload || upload.expires_at <= new Date().toISOString()) throw new Error("上传会话已过期，请重新选择文件");
  const chunks = await listChunks(db, uploadId);
  if (chunks.length !== upload.chunk_count || chunks.some((chunk, index) => chunk.chunk_index !== index)) {
    throw new Error("仍有分片尚未上传完成");
  }
  const bytes = new Uint8Array(upload.file_size_bytes);
  let offset = 0;
  for (const chunk of chunks) {
    const object = await bucket().get(chunk.object_key);
    if (!object) throw new Error("部分上传分片已丢失，请重新上传该文件");
    const part = new Uint8Array(await object.arrayBuffer());
    if (part.byteLength !== chunk.size_bytes) throw new Error("分片完整性校验失败，请重新上传该文件");
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  if (offset !== bytes.byteLength) throw new Error("合并后的文件大小不正确");
  const session = toSession(upload, chunks);
  return { session, bytes, objectKeys: chunks.map((chunk) => chunk.object_key) };
}

export async function finishSalesUpload(uploadId: string, objectKeys: string[], completed: boolean) {
  const db = getSalesDatabase();
  if (completed) {
    await bucket().delete(objectKeys);
    await db.batch([
      db.prepare("DELETE FROM sales_import_upload_chunks WHERE upload_id = ?").bind(uploadId),
      db.prepare("UPDATE sales_import_uploads SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(uploadId),
    ]);
  } else {
    await db.prepare("UPDATE sales_import_uploads SET status = 'ready', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(uploadId).run();
  }
}
