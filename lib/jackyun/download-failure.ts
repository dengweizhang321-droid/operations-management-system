const transientCodes = new Set([
  "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH",
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET",
  "HTTP_408", "HTTP_429", "HTTP_500", "HTTP_502", "HTTP_503", "HTTP_504",
]);
const terminalCodes = new Set([
  "ENOTFOUND", "CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "DEPTH_ZERO_SELF_SIGNED_CERT",
  "ERR_TLS_CERT_ALTNAME_INVALID", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "EACCES", "EPERM", "ENOSPC", "EIO",
  "HTTP_400", "HTTP_401", "HTTP_403", "HTTP_404", "EMPTY_FILE", "INVALID_XLSX", "SOURCE_REJECTED",
]);
export const isTransientDownloadCode = (code: string) => transientCodes.has(code);

// Only allowlisted machine codes leave the download boundary, never URLs,
// response bodies, raw causes or signed query parameters.
export function downloadFailureCode(error: unknown): string {
  const value = error as { code?: unknown; cause?: { code?: unknown }; name?: string } | null;
  for (const code of [value?.code, value?.cause?.code]) {
    if (typeof code === "string" && (transientCodes.has(code) || terminalCodes.has(code))) return code;
  }
  return value?.name === "TimeoutError" ? "ETIMEDOUT" : "NON_RETRYABLE";
}

export class JackyunDownloadFailure extends Error {
  constructor(readonly code: string, readonly attempts: number, readonly retryable: boolean) {
    super(`JACKYUN_OSS_DOWNLOAD_${retryable ? "RETRYABLE" : "MANUAL"} code=${code} attempts=${attempts}`);
  }
}

export function boundDownloadResumeMessage(error: JackyunDownloadFailure) {
  return `JACKYUN_BOUND_DOWNLOAD_RESUME_REQUIRED code=${error.code} attempts=${error.attempts}`;
}

export function isBoundDownloadResumeFailure(message: string) {
  const match = /^JACKYUN_BOUND_DOWNLOAD_RESUME_REQUIRED code=([A-Z0-9_]+) attempts=([1-3])$/.exec(message);
  return Boolean(match && transientCodes.has(match[1]));
}
