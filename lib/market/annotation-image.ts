const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const JD_IMAGE_HOSTNAME = /^img\d+\.360buyimg\.com$/i;

export type AnnotationImageSource = "imgzone" | "n5";

export type AnnotationImageNoImageReason =
  | "invalid_url"
  | "insecure_url"
  | "credentials_not_allowed"
  | "fragment_not_allowed"
  | "port_not_allowed"
  | "host_not_allowed"
  | "unsupported_source"
  | "redirect_not_allowed"
  | "http_error"
  | "unsupported_mime"
  | "invalid_signature"
  | "invalid_content_length"
  | "too_large"
  | "empty_body"
  | "timeout"
  | "fetch_failed";

export type AnnotationImageResult =
  | {
      kind: "image";
      source: AnnotationImageSource;
      url: string;
      mimeType: string;
      bytes: Uint8Array;
      base64: string;
    }
  | {
      kind: "no-image";
      reason: AnnotationImageNoImageReason;
      message: string;
      attemptedSources: AnnotationImageSource[];
    };

export type AnnotationImageFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface FetchAnnotationImageOptions {
  fetch?: AnnotationImageFetch;
  /** Maximum response body size. Defaults to 8 MiB and cannot exceed it. */
  maxBytes?: number;
  /** Per-candidate timeout. Defaults to 10 seconds. */
  timeoutMs?: number;
}

export interface AnnotationImageCandidate {
  source: AnnotationImageSource;
  url: string;
}

interface ImageCandidate {
  source: AnnotationImageSource;
  url: URL;
}

interface CandidateFailure {
  reason: AnnotationImageNoImageReason;
  message: string;
}

/**
 * Safely downloads a JD annotation image. An n5 URL is upgraded to imgzone
 * first, while retaining n5 as a compatibility fallback.
 */
export async function fetchAnnotationImage(
  input: string,
  options: FetchAnnotationImageOptions = {},
): Promise<AnnotationImageResult> {
  const prepared = prepareCandidates(input);
  if ("reason" in prepared) {
    return { kind: "no-image", ...prepared, attemptedSources: [] };
  }

  const fetcher = options.fetch ?? globalThis.fetch?.bind(globalThis);
  if (!fetcher) {
    return noImage("fetch_failed", "Fetch is not available in this runtime", []);
  }

  const maxBytes = normalizePositiveLimit(options.maxBytes, DEFAULT_MAX_BYTES, DEFAULT_MAX_BYTES);
  const timeoutMs = normalizePositiveLimit(options.timeoutMs, DEFAULT_TIMEOUT_MS);
  const attemptedSources: AnnotationImageSource[] = [];
  let lastFailure: CandidateFailure = {
    reason: "fetch_failed",
    message: "No image candidate could be fetched",
  };

  for (const candidate of prepared.candidates) {
    attemptedSources.push(candidate.source);
    const result = await fetchCandidate(candidate, fetcher, maxBytes, timeoutMs);
    if ("bytes" in result) return result;
    lastFailure = result;
  }

  return noImage(lastFailure.reason, lastFailure.message, attemptedSources);
}

/** Returns the validated request order without performing network I/O. */
export function resolveAnnotationImageCandidates(input: string): AnnotationImageCandidate[] {
  const prepared = prepareCandidates(input);
  if ("reason" in prepared) return [];
  return prepared.candidates.map(({ source, url }) => ({ source, url: url.toString() }));
}

function prepareCandidates(input: string): { candidates: ImageCandidate[] } | CandidateFailure {
  const trimmed = input.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { reason: "invalid_url", message: "Image URL is invalid" };
  }

  if (url.protocol !== "https:") {
    return { reason: "insecure_url", message: "Image URL must use HTTPS" };
  }
  if (url.username || url.password) {
    return { reason: "credentials_not_allowed", message: "Image URL must not contain credentials" };
  }
  if (url.hash || trimmed.includes("#")) {
    return { reason: "fragment_not_allowed", message: "Image URL must not contain a fragment" };
  }
  if (url.port) {
    return { reason: "port_not_allowed", message: "Image URL must not use a non-standard port" };
  }
  if (!JD_IMAGE_HOSTNAME.test(url.hostname)) {
    return { reason: "host_not_allowed", message: "Image URL host is not an approved JD image host" };
  }

  if (hasPathSegment(url.pathname, "n5")) {
    const imgzone = new URL(url.toString());
    imgzone.pathname = replacePathSegment(imgzone.pathname, "n5", "imgzone");
    return {
      candidates: [
        { source: "imgzone", url: imgzone },
        { source: "n5", url },
      ],
    };
  }
  if (hasPathSegment(url.pathname, "imgzone")) {
    return { candidates: [{ source: "imgzone", url }] };
  }
  return {
    reason: "unsupported_source",
    message: "Image URL must contain an imgzone or n5 path segment",
  };
}

async function fetchCandidate(
  candidate: ImageCandidate,
  fetcher: AnnotationImageFetch,
  maxBytes: number,
  timeoutMs: number,
): Promise<Extract<AnnotationImageResult, { kind: "image" }> | CandidateFailure> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetcher(candidate.url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
    });

    if (response.status >= 300 && response.status < 400) {
      return { reason: "redirect_not_allowed", message: `${candidate.source} image returned a redirect` };
    }
    if (!response.ok) {
      return { reason: "http_error", message: `${candidate.source} image returned HTTP ${response.status}` };
    }

    const mimeType = normalizeMimeType(response.headers.get("content-type"));
    if (!mimeType || !["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
      return { reason: "unsupported_mime", message: `${candidate.source} response must be JPEG, PNG, or WebP` };
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength !== null) {
      const normalizedLength = contentLength.trim();
      if (!/^\d+$/.test(normalizedLength)) {
        return { reason: "invalid_content_length", message: `${candidate.source} response has an invalid Content-Length` };
      }
      if (Number(normalizedLength) > maxBytes) {
        return { reason: "too_large", message: `${candidate.source} image exceeds the ${maxBytes}-byte limit` };
      }
    }

    const bytes = await readBodyWithLimit(response, maxBytes);
    if (bytes === null) {
      return { reason: "too_large", message: `${candidate.source} image exceeds the ${maxBytes}-byte limit` };
    }
    if (bytes.byteLength === 0) {
      return { reason: "empty_body", message: `${candidate.source} image body is empty` };
    }
    if (!hasExpectedMagic(bytes, mimeType)) {
      return { reason: "invalid_signature", message: `${candidate.source} image signature does not match its MIME type` };
    }

    return {
      kind: "image",
      source: candidate.source,
      url: candidate.url.toString(),
      mimeType,
      bytes,
      base64: encodeAnnotationImageBase64(bytes),
    };
  } catch (error) {
    if (controller.signal.aborted) {
      return { reason: "timeout", message: `${candidate.source} image request timed out` };
    }
    const detail = error instanceof Error && error.message ? `: ${error.message}` : "";
    return { reason: "fetch_failed", message: `${candidate.source} image request failed${detail}` };
  } finally {
    clearTimeout(timer);
  }
}

function hasExpectedMagic(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === "image/jpeg") return bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/png") return bytes.byteLength >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value);
  return bytes.byteLength >= 12
    && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP";
}

async function readBodyWithLimit(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.byteLength <= maxBytes ? bytes : null;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

function normalizeMimeType(value: string | null): string | null {
  if (!value) return null;
  const mimeType = value.split(";", 1)[0]?.trim().toLowerCase();
  return mimeType || null;
}

function hasPathSegment(pathname: string, segment: AnnotationImageSource): boolean {
  return pathname.split("/").includes(segment);
}

function replacePathSegment(pathname: string, from: AnnotationImageSource, to: AnnotationImageSource): string {
  const parts = pathname.split("/");
  const index = parts.indexOf(from);
  if (index >= 0) parts[index] = to;
  return parts.join("/");
}

function normalizePositiveLimit(value: number | undefined, fallback: number, ceiling?: number): number {
  if (!Number.isFinite(value) || value === undefined || value <= 0) return fallback;
  const integer = Math.floor(value);
  return ceiling === undefined ? integer : Math.min(integer, ceiling);
}

export function encodeAnnotationImageBase64(bytes: Uint8Array): string {
  const chunkSize = 3 * 8_192;
  let encoded = "";
  for (let start = 0; start < bytes.byteLength; start += chunkSize) {
    const chunk = bytes.subarray(start, Math.min(start + chunkSize, bytes.byteLength));
    let binary = "";
    for (const byte of chunk) binary += String.fromCharCode(byte);
    encoded += btoa(binary);
  }
  return encoded;
}

function noImage(
  reason: AnnotationImageNoImageReason,
  message: string,
  attemptedSources: AnnotationImageSource[],
): Extract<AnnotationImageResult, { kind: "no-image" }> {
  return { kind: "no-image", reason, message, attemptedSources };
}
