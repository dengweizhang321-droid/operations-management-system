import { createHash } from "node:crypto";
import type { JackyunModule } from "./post-download";

export type JackyunInputContract = {
  module: JackyunModule;
  rawSha256: string;
  snapshotDate?: string;
  asOfDate?: string;
  expectedSourceRows: number;
  previousComboRows?: number;
  costOutputSha256?: string;
  costSourcePath?: string;
  baseUrl: string;
};

export type JackyunSourceRowCountCorrection = {
  reason: "exact_total_after_approximate_count";
  previousExpectedSourceRows: number;
  exactExpectedSourceRows: number;
  observedAt: string;
};

export function isValidJackyunSourceRowCountCorrection(
  value: unknown,
  expectedSourceRows?: number,
): value is JackyunSourceRowCountCorrection {
  if (!value || typeof value !== "object") return false;
  const correction = value as Partial<JackyunSourceRowCountCorrection>;
  return correction.reason === "exact_total_after_approximate_count"
    && Number.isSafeInteger(correction.previousExpectedSourceRows)
    && Number(correction.previousExpectedSourceRows) > 0
    && Number.isSafeInteger(correction.exactExpectedSourceRows)
    && Number(correction.exactExpectedSourceRows) > 0
    && correction.previousExpectedSourceRows !== correction.exactExpectedSourceRows
    && (expectedSourceRows === undefined || correction.exactExpectedSourceRows === expectedSourceRows)
    && typeof correction.observedAt === "string"
    && Number.isFinite(Date.parse(correction.observedAt));
}

export function createJackyunInputContractHash(contract: JackyunInputContract) {
  const stableContract = {
    version: 1,
    module: contract.module,
    rawSha256: contract.rawSha256,
    snapshotDate: contract.snapshotDate ?? null,
    asOfDate: contract.asOfDate ?? null,
    expectedSourceRows: contract.expectedSourceRows,
    previousComboRows: contract.previousComboRows ?? null,
    costOutputSha256: contract.costOutputSha256 ?? null,
    costSourcePath: contract.costSourcePath ?? null,
    baseUrl: contract.baseUrl,
  };
  return createHash("sha256").update(JSON.stringify(stableContract), "utf8").digest("hex");
}
