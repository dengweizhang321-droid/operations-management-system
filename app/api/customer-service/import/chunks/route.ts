import { authorizationErrorResponse, requireAppPrincipal } from "@/lib/auth/authorization";
import { parseCustomerServiceImport } from "@/lib/customer-service/import-service";
import { saveCustomerServiceImport } from "@/lib/customer-service/database";
import {
  INVENTORY_UPLOAD_CHUNK_BYTES,
  assembleInventoryUpload,
  beginInventoryUpload,
  claimInventoryUpload,
  finishInventoryUpload,
  receiveInventoryUploadChunk,
  releaseInventoryUpload,
} from "@/lib/inventory/chunked-upload";

const MAX_FILE_BYTES = 25 * 1024 * 1024;

function reject(status: number, message: string) {
  return Response.json({ ok: false, message }, { status });
}

async function digest(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes);
  const hash = await crypto.subtle.digest("SHA-256", copy.buffer as ArrayBuffer);
  return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function POST(request: Request) {
  try {
    await requireAppPrincipal(["admin"]);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return reject(400, "Invalid upload request");

    if (body.action === "init") {
      const fileName = typeof body.fileName === "string" ? body.fileName : "";
      const fileSizeBytes = Number(body.fileSizeBytes);
      const chunkCount = Number(body.chunkCount);
      const fingerprint = typeof body.fingerprint === "string" ? body.fingerprint : "";
      if (!/\.(xlsx|log|txt)$/i.test(fileName) || fileSizeBytes <= 0 || fileSizeBytes > MAX_FILE_BYTES) {
        return reject(422, "Unsupported customer-service source file");
      }
      const upload = await beginInventoryUpload({
        fileName: `${fileName}.xlsx`,
        fileSizeBytes,
        chunkCount,
        fingerprint: `customer-service:${fingerprint}`,
      });
      return Response.json({ ok: true, upload, limits: { chunkSizeBytes: INVENTORY_UPLOAD_CHUNK_BYTES, maxFileSizeBytes: MAX_FILE_BYTES } });
    }

    if (body.action === "complete") {
      const sessionUploadId = typeof body.sessionUploadId === "string" ? body.sessionUploadId : "";
      const chatUploadId = typeof body.chatUploadId === "string" ? body.chatUploadId : "";
      const sessionFileName = typeof body.sessionFileName === "string" ? body.sessionFileName : "";
      const chatFileName = typeof body.chatFileName === "string" ? body.chatFileName : "";
      const shopName = typeof body.shopName === "string" ? body.shopName.trim() : "";
      if (!sessionUploadId || !chatUploadId || !shopName || shopName.length > 100 || !/\.xlsx$/i.test(sessionFileName) || !/\.(log|txt)$/i.test(chatFileName)) return reject(400, "Missing shop or paired upload files");
      const sessionClaim = await claimInventoryUpload(sessionUploadId);
      if (sessionClaim.kind === "completed") return Response.json(sessionClaim.result);
      let chatClaim;
      try { chatClaim = await claimInventoryUpload(chatUploadId); }
      catch (error) { await releaseInventoryUpload(sessionUploadId); throw error; }
      if (chatClaim.kind === "completed") { await releaseInventoryUpload(sessionUploadId); return Response.json(chatClaim.result); }
      try {
        const [session, chat] = await Promise.all([assembleInventoryUpload(sessionUploadId), assembleInventoryUpload(chatUploadId)]);
        const parsed = parseCustomerServiceImport(session.bytes, new TextDecoder("utf-8", { fatal: true }).decode(chat.bytes));
        const resolvedShopName = parsed.conversations.some((item) => item.agent.startsWith("志高厨电")) ? "志高厨电" : shopName;
        const fileHash = await digest(new TextEncoder().encode(`${await digest(session.bytes)}:${await digest(chat.bytes)}`));
        const saved = await saveCustomerServiceImport({ shopName: resolvedShopName, sessionFileName, chatFileName, fileHash, parsed });
        const result = { ok: true, status: saved.status, batch: saved.batch, summary: parsed.summary, warnings: parsed.warnings, message: saved.status === "duplicate" ? "Source files were already imported" : `Imported ${parsed.conversations.length} customer-service conversations` };
        await Promise.all([finishInventoryUpload(sessionUploadId, session.objectKeys, result), finishInventoryUpload(chatUploadId, chat.objectKeys, result)]);
        return Response.json(result, { status: saved.status === "imported" ? 201 : 200 });
      } catch (error) {
        await Promise.all([releaseInventoryUpload(sessionUploadId), releaseInventoryUpload(chatUploadId)]);
        throw error;
      }
    }
    return reject(400, "Unknown upload action");
  } catch (error) {
    const auth = authorizationErrorResponse(error); if (auth) return auth;
    return reject(422, error instanceof Error ? error.message : "Customer-service upload failed");
  }
}

export async function PUT(request: Request) {
  try {
    await requireAppPrincipal(["admin"]);
    const uploadId = request.headers.get("x-upload-id") ?? "";
    const chunkIndex = Number(request.headers.get("x-chunk-index"));
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (!uploadId || !Number.isSafeInteger(chunkIndex) || bytes.byteLength === 0 || bytes.byteLength > INVENTORY_UPLOAD_CHUNK_BYTES) return reject(400, "Invalid upload chunk");
    const upload = await receiveInventoryUploadChunk({ uploadId, chunkIndex, bytes });
    return Response.json({ ok: true, upload });
  } catch (error) {
    const auth = authorizationErrorResponse(error); if (auth) return auth;
    return reject(422, error instanceof Error ? error.message : "Customer-service chunk upload failed");
  }
}
