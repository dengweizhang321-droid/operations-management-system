import {
  ensureNetshopSchema,
  getNetshopDatabase,
  type NetshopDatabase,
} from "@/lib/netshop/database";
import { PublicApiError } from "@/lib/http/api-error";

export const NETSHOP_ASSET_UPLOAD_CHUNK_BYTES = 2 * 1024 * 1024;
export const MAX_NETSHOP_ASSET_FILE_BYTES = 64 * 1024 * 1024;

const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
const OBJECT_PREFIX = "netshop-asset-upload/v1";

type UploadRow = {
  id: string;
  fingerprint: string;
  shop_name: string;
  snapshot_date: string;
  file_name: string;
  file_size_bytes: number;
  chunk_size_bytes: number;
  chunk_count: number;
  received_chunk_count: number;
  received_bytes: number;
  status: string;
  processing_owner: string | null;
  expires_at: string;
};

type ChunkRow = {
  chunk_index: number;
  object_key: string;
  size_bytes: number;
  sha256: string;
};

export type NetshopAssetUploadSession = {
  id: string;
  shopName: string;
  snapshotDate: string;
  fileName: string;
  fileSizeBytes: number;
  chunkSizeBytes: number;
  chunkCount: number;
  receivedChunkIndexes: number[];
  receivedBytes: number;
  status: string;
  expiresAt: string;
};

export type NetshopAssetUploadClaim =
  | { kind: "claimed"; ownerToken: string; session: NetshopAssetUploadSession }
  | { kind: "completed"; session: NetshopAssetUploadSession; result: unknown };

function requestError(status: 400 | 404 | 409 | 413 | 422, message: string) {
  const code = status === 404
    ? "not_found"
    : status === 409
      ? "conflict"
      : status === 413
        ? "payload_too_large"
        : "invalid_request";
  return new PublicApiError(status, code, message);
}

function nowIso() {
  return new Date().toISOString();
}

function expiresAt() {
  return new Date(Date.now() + UPLOAD_TTL_MS).toISOString();
}

function safeFileName(value: string) {
  return (value.split(/[\\/]/).pop() ?? "tmall-product-assets.xlsx")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, 255);
}

function bytesForDigest(bytes: Uint8Array) {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) return bytes.buffer as ArrayBuffer;
  return bytes.slice().buffer as ArrayBuffer;
}

function toHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(bytes: Uint8Array) {
  return toHex(await crypto.subtle.digest("SHA-256", bytesForDigest(bytes)));
}

async function fingerprint(shopName: string, snapshotDate: string, clientFingerprint: string) {
  return sha256(new TextEncoder().encode(`tmall-product-assets\u0000${shopName}\u0000${snapshotDate}\u0000${clientFingerprint}`));
}

async function uploadBucket() {
  const { env } = await import("cloudflare:workers");
  if (!env.SALES_IMPORT_FILES) throw new Error("R2 分片存储未配置");
  return env.SALES_IMPORT_FILES;
}

async function getUpload(db: NetshopDatabase, uploadId: string) {
  return db.prepare(`SELECT id, fingerprint, shop_name, snapshot_date, file_name, file_size_bytes,
    chunk_size_bytes, chunk_count, received_chunk_count, received_bytes, status,
    processing_owner, expires_at
    FROM netshop_asset_uploads WHERE id = ? LIMIT 1`)
    .bind(uploadId)
    .first<UploadRow>();
}

async function listChunks(db: NetshopDatabase, uploadId: string) {
  const result = await db.prepare(`SELECT chunk_index, object_key, size_bytes, sha256
    FROM netshop_asset_upload_chunks WHERE upload_id = ? ORDER BY chunk_index ASC`)
    .bind(uploadId)
    .all<ChunkRow>();
  return result.results as ChunkRow[];
}

function toSession(upload: UploadRow, chunks: readonly ChunkRow[]): NetshopAssetUploadSession {
  return {
    id: upload.id,
    shopName: upload.shop_name,
    snapshotDate: upload.snapshot_date,
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

async function deleteSession(db: NetshopDatabase, upload: UploadRow) {
  const chunks = await listChunks(db, upload.id);
  if (chunks.length > 0) {
    await (await uploadBucket()).delete(chunks.map((chunk) => chunk.object_key));
  }
  await db.batch([
    db.prepare("DELETE FROM netshop_asset_upload_chunks WHERE upload_id = ?").bind(upload.id),
    db.prepare("DELETE FROM netshop_asset_upload_results WHERE upload_id = ?").bind(upload.id),
    db.prepare("DELETE FROM netshop_asset_uploads WHERE id = ?").bind(upload.id),
  ]);
}

async function cleanupExpiredUploads(db: NetshopDatabase) {
  const expired = await db.prepare(`SELECT id, fingerprint, shop_name, snapshot_date, file_name,
    file_size_bytes, chunk_size_bytes, chunk_count, received_chunk_count, received_bytes,
    status, processing_owner, expires_at
    FROM netshop_asset_uploads WHERE expires_at <= ? ORDER BY expires_at ASC LIMIT 20`)
    .bind(nowIso())
    .all<UploadRow>();
  for (const upload of expired.results) {
    try {
      await deleteSession(db, upload);
    } catch {
      // Keep metadata when R2 cleanup fails so a later sweep can retry safely.
    }
  }
}

export async function beginNetshopAssetUpload(input: {
  fileName: string;
  fileSizeBytes: number;
  chunkCount: number;
  clientFingerprint: string;
  shopName: string;
  snapshotDate: string;
}) {
  if (!input.fileName.toLowerCase().endsWith(".xlsx")) throw requestError(422, "天猫 SPU 商品图只接受 .xlsx 文件");
  if (!Number.isSafeInteger(input.fileSizeBytes) || input.fileSizeBytes <= 0) throw requestError(400, "文件大小无效");
  if (input.fileSizeBytes > MAX_NETSHOP_ASSET_FILE_BYTES) throw requestError(413, "天猫 SPU 商品图文件最大支持 64MB");
  const expectedChunkCount = Math.ceil(input.fileSizeBytes / NETSHOP_ASSET_UPLOAD_CHUNK_BYTES);
  if (!Number.isSafeInteger(input.chunkCount) || input.chunkCount !== expectedChunkCount) throw requestError(400, "分片数量与文件大小不一致");
  if (!input.clientFingerprint || input.clientFingerprint.length > 512) throw requestError(400, "上传指纹无效");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.snapshotDate) || !input.shopName.trim()) throw requestError(400, "上传会话缺少有效店铺或快照日期");

  const db = getNetshopDatabase();
  await ensureNetshopSchema(db);
  await cleanupExpiredUploads(db);
  const uploadFingerprint = await fingerprint(input.shopName, input.snapshotDate, input.clientFingerprint);
  const existing = await db.prepare(`SELECT id, fingerprint, shop_name, snapshot_date, file_name,
    file_size_bytes, chunk_size_bytes, chunk_count, received_chunk_count, received_bytes,
    status, processing_owner, expires_at
    FROM netshop_asset_uploads
    WHERE fingerprint = ? AND expires_at > ? AND status IN ('uploading', 'ready', 'processing')
    LIMIT 1`)
    .bind(uploadFingerprint, nowIso())
    .first<UploadRow>();
  if (existing) {
    if (existing.shop_name !== input.shopName || existing.snapshot_date !== input.snapshotDate
      || Number(existing.file_size_bytes) !== input.fileSizeBytes || existing.file_name !== safeFileName(input.fileName)) {
      throw requestError(409, "上传指纹已绑定其他文件、店铺或快照日期");
    }
    return toSession(existing, await listChunks(db, existing.id));
  }

  const stale = await db.prepare(`SELECT id, fingerprint, shop_name, snapshot_date, file_name,
    file_size_bytes, chunk_size_bytes, chunk_count, received_chunk_count, received_bytes,
    status, processing_owner, expires_at
    FROM netshop_asset_uploads WHERE fingerprint = ? LIMIT 1`)
    .bind(uploadFingerprint)
    .first<UploadRow>();
  if (stale) await deleteSession(db, stale);

  const id = crypto.randomUUID();
  await db.prepare(`INSERT INTO netshop_asset_uploads (
    id, fingerprint, shop_name, snapshot_date, file_name, file_size_bytes,
    chunk_size_bytes, chunk_count, expires_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      id,
      uploadFingerprint,
      input.shopName,
      input.snapshotDate,
      safeFileName(input.fileName),
      input.fileSizeBytes,
      NETSHOP_ASSET_UPLOAD_CHUNK_BYTES,
      input.chunkCount,
      expiresAt(),
    )
    .run();
  const created = await getUpload(db, id);
  if (!created) throw new Error("无法创建天猫 SPU 商品图上传会话");
  return toSession(created, []);
}

export async function receiveNetshopAssetUploadChunk(input: {
  uploadId: string;
  chunkIndex: number;
  bytes: Uint8Array;
}) {
  const db = getNetshopDatabase();
  await ensureNetshopSchema(db);
  const upload = await getUpload(db, input.uploadId);
  if (!upload || upload.expires_at <= nowIso()) throw requestError(404, "上传会话已过期，请重新选择文件");
  if (!['uploading', 'ready'].includes(upload.status)) throw requestError(409, "上传会话已进入处理或完成状态");
  if (!Number.isSafeInteger(input.chunkIndex) || input.chunkIndex < 0 || input.chunkIndex >= upload.chunk_count) throw requestError(400, "分片序号无效");
  const expectedBytes = input.chunkIndex === upload.chunk_count - 1
    ? upload.file_size_bytes - upload.chunk_size_bytes * (upload.chunk_count - 1)
    : upload.chunk_size_bytes;
  if (input.bytes.byteLength !== expectedBytes) throw requestError(422, "分片大小与预期不一致");

  const checksum = await sha256(input.bytes);
  const objectKey = `${OBJECT_PREFIX}/${upload.id}/${input.chunkIndex.toString().padStart(6, "0")}-${checksum}`;
  const storage = await uploadBucket();
  await storage.put(objectKey, input.bytes, {
    httpMetadata: { contentType: "application/octet-stream" },
    customMetadata: { sha256: checksum, uploadId: upload.id },
  });
  const previous = await db.prepare(`SELECT chunk_index, object_key, size_bytes, sha256
    FROM netshop_asset_upload_chunks WHERE upload_id = ? AND chunk_index = ? LIMIT 1`)
    .bind(upload.id, input.chunkIndex)
    .first<ChunkRow>();
  const results = await db.batch([
    db.prepare(`INSERT INTO netshop_asset_upload_chunks (upload_id, chunk_index, object_key, size_bytes, sha256)
      SELECT ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM netshop_asset_uploads
        WHERE id = ? AND status IN ('uploading', 'ready') AND expires_at > ?
      )
      ON CONFLICT(upload_id, chunk_index) DO UPDATE SET
        object_key = excluded.object_key, size_bytes = excluded.size_bytes, sha256 = excluded.sha256`)
      .bind(upload.id, input.chunkIndex, objectKey, input.bytes.byteLength, checksum, upload.id, nowIso()),
    db.prepare(`UPDATE netshop_asset_uploads
      SET received_chunk_count = (SELECT COUNT(*) FROM netshop_asset_upload_chunks WHERE upload_id = ?),
          received_bytes = (SELECT COALESCE(SUM(size_bytes), 0) FROM netshop_asset_upload_chunks WHERE upload_id = ?),
          status = CASE WHEN (SELECT COUNT(*) FROM netshop_asset_upload_chunks WHERE upload_id = ?) = chunk_count THEN 'ready' ELSE 'uploading' END,
          updated_at = CURRENT_TIMESTAMP, expires_at = ?
      WHERE id = ? AND status IN ('uploading', 'ready')`)
      .bind(upload.id, upload.id, upload.id, expiresAt(), upload.id),
  ]);
  if (Number(results[0]?.meta?.changes ?? 0) === 0) {
    await storage.delete(objectKey).catch(() => undefined);
    throw requestError(409, "文件已开始合并，当前分片未被接收");
  }
  if (previous && previous.object_key !== objectKey) await storage.delete(previous.object_key).catch(() => undefined);
  const refreshed = await getUpload(db, upload.id);
  if (!refreshed) throw new Error("分片写入后无法读取上传会话");
  return toSession(refreshed, await listChunks(db, upload.id));
}

async function storedResult(db: NetshopDatabase, uploadId: string) {
  const row = await db.prepare("SELECT result_json FROM netshop_asset_upload_results WHERE upload_id = ? LIMIT 1")
    .bind(uploadId)
    .first<{ result_json: string }>();
  if (!row) return null;
  try {
    return JSON.parse(row.result_json) as unknown;
  } catch {
    return null;
  }
}

export async function claimNetshopAssetUpload(uploadId: string): Promise<NetshopAssetUploadClaim> {
  const db = getNetshopDatabase();
  await ensureNetshopSchema(db);
  let upload = await getUpload(db, uploadId);
  if (!upload || upload.expires_at <= nowIso()) throw requestError(404, "上传会话已过期，请重新选择文件");
  if (upload.status === "completed") {
    const result = await storedResult(db, uploadId);
    if (!result) throw new Error("已完成上传会话缺少导入结果");
    return { kind: "completed", session: toSession(upload, await listChunks(db, upload.id)), result };
  }
  if (upload.status === "uploading") throw requestError(409, "仍有分片尚未上传完成");
  if (upload.status === "processing") throw requestError(409, "文件正在合并导入，请稍后重试");
  if (upload.status !== "ready") throw requestError(409, "上传会话状态无效");

  const ownerToken = crypto.randomUUID();
  const claimed = await db.prepare(`UPDATE netshop_asset_uploads
    SET status = 'processing', processing_owner = ?, updated_at = CURRENT_TIMESTAMP, expires_at = ?
    WHERE id = ? AND status = 'ready' AND expires_at > ?`)
    .bind(ownerToken, expiresAt(), uploadId, nowIso())
    .run();
  if (Number(claimed.meta?.changes ?? 0) === 0) {
    upload = await getUpload(db, uploadId);
    if (upload?.status === "completed") {
      const result = await storedResult(db, uploadId);
      if (result) return { kind: "completed", session: toSession(upload, await listChunks(db, upload.id)), result };
    }
    throw requestError(409, "文件已由其他请求接管处理");
  }
  const refreshed = await getUpload(db, uploadId);
  if (!refreshed) throw new Error("无法读取已接管的上传会话");
  return { kind: "claimed", ownerToken, session: toSession(refreshed, await listChunks(db, uploadId)) };
}

export async function assembleNetshopAssetUpload(uploadId: string, ownerToken: string) {
  const db = getNetshopDatabase();
  await ensureNetshopSchema(db);
  const upload = await getUpload(db, uploadId);
  if (!upload || upload.expires_at <= nowIso()) throw requestError(404, "上传会话已过期，请重新选择文件");
  if (upload.status !== "processing" || upload.processing_owner !== ownerToken) throw requestError(409, "上传会话所有权已变化");
  const chunks = await listChunks(db, uploadId);
  if (chunks.length !== upload.chunk_count || chunks.some((chunk, index) => Number(chunk.chunk_index) !== index)) {
    throw requestError(409, "仍有分片尚未上传完成");
  }

  const bytes = new Uint8Array(upload.file_size_bytes);
  const storage = await uploadBucket();
  let offset = 0;
  for (const chunk of chunks) {
    const object = await storage.get(chunk.object_key);
    if (!object) throw requestError(422, "部分上传分片已丢失，请重新上传文件");
    const part = new Uint8Array(await object.arrayBuffer());
    if (part.byteLength !== Number(chunk.size_bytes) || await sha256(part) !== chunk.sha256) {
      throw requestError(422, "上传分片完整性校验失败");
    }
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  if (offset !== bytes.byteLength) throw requestError(422, "合并后的文件大小不正确");
  return {
    session: toSession(upload, chunks),
    bytes,
    objectKeys: chunks.map((chunk) => chunk.object_key),
  };
}

export async function finishNetshopAssetUpload(
  uploadId: string,
  ownerToken: string,
  objectKeys: readonly string[],
  result: unknown,
) {
  const db = getNetshopDatabase();
  const changes = await db.batch([
    db.prepare(`INSERT INTO netshop_asset_upload_results (upload_id, result_json)
      SELECT ?, ? WHERE EXISTS (
        SELECT 1 FROM netshop_asset_uploads
        WHERE id = ? AND status = 'processing' AND processing_owner = ?
      )
      ON CONFLICT(upload_id) DO UPDATE SET result_json = excluded.result_json`)
      .bind(uploadId, JSON.stringify(result), uploadId, ownerToken),
    db.prepare(`UPDATE netshop_asset_uploads
      SET status = 'completed', processing_owner = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'processing' AND processing_owner = ?`)
      .bind(uploadId, ownerToken),
  ]);
  if (Number(changes[0]?.meta?.changes ?? 0) === 0 || Number(changes[1]?.meta?.changes ?? 0) === 0) {
    throw requestError(409, "上传会话提交所有权已变化，未清理分片");
  }
  try {
    if (objectKeys.length > 0) await (await uploadBucket()).delete([...objectKeys]);
    await db.prepare("DELETE FROM netshop_asset_upload_chunks WHERE upload_id = ?").bind(uploadId).run();
  } catch {
    // The durable completed result is authoritative; expiry cleanup will retry orphan cleanup.
  }
}

export async function releaseNetshopAssetUpload(uploadId: string, ownerToken: string) {
  const db = getNetshopDatabase();
  await db.prepare(`UPDATE netshop_asset_uploads
    SET status = 'ready', processing_owner = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'processing' AND processing_owner = ?`)
    .bind(uploadId, ownerToken)
    .run();
}
