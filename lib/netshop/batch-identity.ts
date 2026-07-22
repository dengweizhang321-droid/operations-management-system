export type NetshopBatchIdentity = { source: string; platform: string; shopName: string; fileHash: string };

export function netshopBatchId(input: NetshopBatchIdentity) {
  return `${input.source}:${encodeURIComponent(input.platform)}:${encodeURIComponent(input.shopName)}:${input.fileHash}`;
}

export function sameNetshopBatchIdentity(
  batch: Pick<NetshopBatchIdentity, "source" | "platform" | "shopName">,
  identity: Pick<NetshopBatchIdentity, "source" | "platform" | "shopName">,
) {
  return batch.source === identity.source && batch.platform === identity.platform && batch.shopName === identity.shopName;
}

/** Product-master rows are snapshots, so scope their immutable file-row key to the shop. */
export function netshopMasterRowKey(input: NetshopBatchIdentity & { rowNumber: number; rowHash: string }) {
  return `${input.source}:${encodeURIComponent(input.platform)}:${encodeURIComponent(input.shopName)}:${input.fileHash}:${input.rowNumber}:${input.rowHash.slice(0, 16)}`;
}
