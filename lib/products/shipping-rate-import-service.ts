import {
  auditRejectedImportResult,
  buildImportAttemptHash,
  buildImportContentFingerprint,
  ensureImportFingerprintSchema,
  failImportFingerprint,
  nextImportScopeStateToken,
  readImportScopeStateToken,
  recordImportFingerprint,
  renewImportFingerprintReservation,
  reserveImportFingerprint,
} from "@/lib/imports/content-fingerprint";
import {
  countProductShippingRatesOwnedByBatch,
  ensureProductShippingRateSchema,
  findProductShippingRateBatchById,
  getProductShippingRateDatabase,
  readProductShippingRateOwnership,
  saveProductShippingRateImport,
  type ProductShippingRateImportBatch,
} from "@/lib/products/shipping-rate-database";
import {
  PRODUCT_SHIPPING_RATE_SHEET_NAME,
  ProductShippingRateWorkbookError,
  parseProductShippingRateXlsx,
  type ProductShippingRateIssue,
} from "@/lib/products/shipping-rate-xlsx";

const IMPORT_DOMAIN = "product-shipping-rates";

function toHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(bytes: Uint8Array) {
  const exactBuffer = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer as ArrayBuffer
    : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return crypto.subtle.digest("SHA-256", exactBuffer);
}

function safeFileName(name: string) {
  const baseName = name.split(/[\\/]/).pop() ?? "sku-shipping-rates.xlsx";
  return baseName.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 255);
}

export type ProductShippingRateImportExecution = {
  ok: boolean;
  status: "imported" | "duplicate" | "rejected";
  message: string;
  batch?: ProductShippingRateImportBatch | null;
  warnings: ProductShippingRateIssue[];
  errors?: ProductShippingRateIssue[];
  errorCount?: number;
  verification?: {
    verified: boolean;
    parsedRowCount: number;
    readbackRowCount: number;
  };
};

export async function importProductShippingRateBytes(input: {
  bytes: Uint8Array;
  fileName: string;
  fileSizeBytes: number;
  actor: string;
}): Promise<ProductShippingRateImportExecution> {
  const db = getProductShippingRateDatabase();
  await Promise.all([ensureProductShippingRateSchema(db), ensureImportFingerprintSchema(db)]);
  const rawFileHash = toHex(await sha256(input.bytes));
  const fileName = safeFileName(input.fileName);
  const actor = input.actor.trim().toLowerCase().slice(0, 320);
  const reject = (result: ProductShippingRateImportExecution) => auditRejectedImportResult(db, {
    domain: IMPORT_DOMAIN,
    rawFileHash,
    scopeHint: { dataset: "sku_cumulative", sheetName: PRODUCT_SHIPPING_RATE_SHEET_NAME },
    metadata: { fileName, fileSizeBytes: input.fileSizeBytes, actor },
  }, result);

  if (!fileName.toLowerCase().endsWith(".xlsx")) {
    return reject({
      ok: false,
      status: "rejected",
      message: "仅支持 .xlsx 格式的 SKU 快递费率报表",
      warnings: [],
      errors: [{ code: "INVALID_FILE_EXTENSION", message: "文件扩展名必须为 .xlsx" }],
      errorCount: 1,
    });
  }
  if (input.bytes.byteLength === 0 || input.fileSizeBytes !== input.bytes.byteLength) {
    return reject({
      ok: false,
      status: "rejected",
      message: "上传文件大小与签收记录不一致",
      warnings: [],
      errors: [{ code: "FILE_SIZE_MISMATCH", message: "请重新选择并完整上传文件" }],
      errorCount: 1,
    });
  }

  let parsed;
  try {
    parsed = parseProductShippingRateXlsx(input.bytes);
  } catch (error) {
    const issues = error instanceof ProductShippingRateWorkbookError
      ? error.issues
      : [{ code: "XLSX_PARSE_ERROR", message: "SKU 快递费率工作簿解析失败，请确认文件未损坏" }];
    return reject({
      ok: false,
      status: "rejected",
      message: error instanceof ProductShippingRateWorkbookError ? error.message : "SKU 快递费率工作簿解析失败",
      warnings: [],
      errors: issues.slice(0, 200),
      errorCount: issues.length,
    });
  }

  const fingerprint = await buildImportContentFingerprint({
    domain: IMPORT_DOMAIN,
    scope: { dataset: "sku_cumulative", sheetName: parsed.sheetName },
    lockScope: { dataset: "sku_cumulative" },
    rows: parsed.rows,
    ignoredTopLevelKeys: ["sourceRowNumber"],
  });
  const ownership = await readProductShippingRateOwnership(db);
  const currentStateToken = await readImportScopeStateToken(db, fingerprint);
  const currentBatchId = ownership.length === 1 && ownership[0]?.rowCount === parsed.rows.length
    ? ownership[0].batchId
    : null;
  const currentBatch = currentBatchId ? await findProductShippingRateBatchById(db, currentBatchId) : null;
  if (currentBatch?.status === "completed" && currentBatch.contentHash === fingerprint.contentHash) {
    await recordImportFingerprint(db, {
      ...fingerprint,
      batchId: currentBatch.id,
      importHash: currentBatch.fileHash,
      rawFileHash,
      publishedStateToken: currentStateToken,
      metadata: {
        fileName,
        fileSizeBytes: input.fileSizeBytes,
        actor,
        warnings: parsed.warnings,
      },
      outcome: "duplicate",
    });
    return {
      ok: true,
      status: "duplicate",
      message: "全部规格代码及快递费率与当前已发布数据一致，无需重复导入",
      batch: currentBatch,
      warnings: parsed.warnings,
      verification: {
        verified: true,
        parsedRowCount: parsed.rows.length,
        readbackRowCount: parsed.rows.length,
      },
    };
  }

  const fileHash = await buildImportAttemptHash({ fingerprint, currentStateToken });
  const batchId = `sku-shipping-rates:${fileHash}`;
  const reservation = await reserveImportFingerprint(db, {
    ...fingerprint,
    batchId,
    importHash: fileHash,
    rawFileHash,
    currentStateToken,
    metadata: {
      fileName,
      fileSizeBytes: input.fileSizeBytes,
      actor,
      warnings: parsed.warnings,
    },
  });
  if (!reservation.claimed) {
    return {
      ok: false,
      status: "rejected",
      message: "同一 SKU 快递费率范围正在导入或已被更新，请刷新后重试",
      warnings: parsed.warnings,
      errors: [{ code: "IMPORT_SCOPE_BUSY_OR_CHANGED", message: "未取得当前全量费率范围的写入所有权" }],
      errorCount: 1,
    };
  }
  await renewImportFingerprintReservation(db, {
    ...fingerprint,
    batchId,
    attemptId: reservation.attemptId,
  });

  try {
    const result = await saveProductShippingRateImport(db, {
      id: batchId,
      fileName,
      fileSizeBytes: input.fileSizeBytes,
      fileHash,
      rawFileHash,
      contentHash: fingerprint.contentHash,
      sheetName: parsed.sheetName,
      actor,
      sourceRowCount: parsed.sourceRowCount,
      duplicateCount: parsed.duplicateProductCodeCount,
      rows: parsed.rows,
      warnings: parsed.warnings,
      totals: {
        ...parsed.totals,
        rawFileHash,
        contentHash: fingerprint.contentHash,
      },
      reservationFence: {
        domain: fingerprint.domain,
        scopeKey: fingerprint.scopeKey,
        batchId,
        attemptId: reservation.attemptId,
      },
    });
    if (result.batch.status !== "completed") throw new Error("快递费率导入批次未完成");
    const readbackRowCount = await countProductShippingRatesOwnedByBatch(db, result.batch.id);
    const publishedOwnership = await readProductShippingRateOwnership(db);
    if (readbackRowCount !== parsed.rows.length
      || publishedOwnership.length !== 1
      || publishedOwnership[0]?.batchId !== result.batch.id
      || publishedOwnership[0]?.rowCount !== parsed.rows.length) {
      throw new Error("SKU 快递费率导入后的落库回查不一致");
    }
    const publishedStateToken = await nextImportScopeStateToken({
      previousStateToken: currentStateToken,
      batchId: result.batch.id,
      contentHash: fingerprint.contentHash,
      rowCount: fingerprint.rowCount,
    });
    await recordImportFingerprint(db, {
      ...fingerprint,
      batchId: result.batch.id,
      importHash: fileHash,
      rawFileHash,
      attemptId: reservation.attemptId,
      publishedStateToken,
      metadata: {
        fileName,
        fileSizeBytes: input.fileSizeBytes,
        actor,
        warnings: parsed.warnings,
      },
      outcome: result.created ? "imported" : "duplicate",
    });
    return {
      ok: true,
      status: result.created ? "imported" : "duplicate",
      message: result.created
        ? `SKU 快递费率导入成功，共发布 ${parsed.rows.length} 个规格`
        : "全部规格代码及快递费率与当前已发布数据一致，无需重复导入",
      batch: result.batch,
      warnings: parsed.warnings,
      verification: {
        verified: true,
        parsedRowCount: parsed.rows.length,
        readbackRowCount,
      },
    };
  } catch (error) {
    await failImportFingerprint(db, {
      ...fingerprint,
      batchId,
      importHash: fileHash,
      rawFileHash,
      attemptId: reservation.attemptId,
      metadata: {
        fileName,
        fileSizeBytes: input.fileSizeBytes,
        actor,
        warnings: parsed.warnings,
      },
      errorCode: "PRODUCT_SHIPPING_RATE_IMPORT_FAILED",
    }).catch(() => undefined);
    throw error;
  }
}
