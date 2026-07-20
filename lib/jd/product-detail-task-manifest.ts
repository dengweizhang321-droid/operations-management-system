export type JdProductDetailTaskRow = {
  fingerprint: string;
  taskId?: string;
  createdAt?: string;
};

export type JdProductDetailTaskManifest = {
  version: 1;
  status: "submitting" | "pending";
  dimension: "SKU" | "SPU";
  shopId: string;
  startDate: string;
  endDate: string;
  baseline: string[];
  rowFingerprint?: string;
  taskId?: string;
  createdAt: string;
};

export function jdProductDetailTaskFingerprint(rowText: string, expectedPrefix: string, taskId?: string) {
  const timestamp = rowText.match(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/)?.[0];
  if (taskId) return `task:${taskId}`;
  if (!timestamp || !rowText.includes(expectedPrefix)) return null;
  // The report title and creation timestamp are stable while its status changes.
  return `title:${expectedPrefix}|created:${timestamp}`;
}

export function selectManifestTaskRow(
  manifest: JdProductDetailTaskManifest,
  rows: JdProductDetailTaskRow[],
): JdProductDetailTaskRow | null {
  const matches = manifest.rowFingerprint
    ? rows.filter((row) => row.fingerprint === manifest.rowFingerprint)
    : rows.filter((row) => !manifest.baseline.includes(row.fingerprint));
  if (matches.length > 1) throw new Error("Ambiguous JD product-detail download task rows; refusing to choose one.");
  return matches[0] ?? null;
}

export function assertJdProductDetailTaskManifest(manifest: JdProductDetailTaskManifest, input: Pick<JdProductDetailTaskManifest, "dimension" | "shopId" | "startDate" | "endDate">) {
  if (manifest.version !== 1 || manifest.dimension !== input.dimension
    || manifest.shopId !== input.shopId || manifest.startDate !== input.startDate || manifest.endDate !== input.endDate) {
    throw new Error("JD product-detail task manifest does not match this requested export.");
  }
}
