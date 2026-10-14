import { digest } from "./annotation-types";
import { encodeAnnotationImageBase64, fetchAnnotationImage, hasExpectedMagic, resolveAnnotationImageCandidates } from "./annotation-image";
import { annotationModelImageObjectKey, type AnnotationImageForModel } from "./annotation-model-image";

export type AnnotationImageCacheReference = { objectKey: string; contentSha256: string; mimeType: string; sizeBytes: number };
type CachedObject = { size: number; body: ReadableStream<Uint8Array>; httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> };
export type AnnotationImageBucket = { get(key: string): Promise<CachedObject | null> };

export async function loadAnnotationImage(input: {
  imageUrl: string; imageContentSha256?: string; cache?: AnnotationImageCacheReference | null;
  bucket?: AnnotationImageBucket; deadlineAt: number;
  fetchImage?: typeof fetchAnnotationImage;
}): Promise<AnnotationImageForModel> {
  const remaining = () => {
    const ms = input.deadlineAt - Date.now();
    if (ms <= 0) throw new Error("主图获取失败：图片处理期限已到");
    return ms;
  };
  const candidate = resolveAnnotationImageCandidates(input.imageUrl)[0];
  if (!candidate) throw new Error("主图获取失败：图片地址不符合安全规则");
  const expected = input.imageContentSha256 ?? "";
  const cache = input.cache;
  const validCache = cache && /^[a-f0-9]{64}$/.test(expected) && cache.contentSha256 === expected
    && Number.isSafeInteger(cache.sizeBytes) && cache.sizeBytes > 0 && cache.sizeBytes <= 8 * 1024 * 1024
    && ["image/jpeg", "image/png", "image/webp"].includes(cache.mimeType)
    && cache.objectKey === `market-images/v1/${expected}.${cache.mimeType === "image/png" ? "png" : cache.mimeType === "image/webp" ? "webp" : "jpg"}`;
  if (validCache && input.bucket) {
    for (const optimized of [true, false]) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const cached = await Promise.race([
          (async () => {
            const object = await input.bucket!.get(optimized ? annotationModelImageObjectKey(expected) : cache.objectKey);
            if (!object || object.size <= 0 || object.size > cache.sizeBytes || (optimized && object.size >= cache.sizeBytes)) return null;
            const mimeType = optimized ? "image/webp" : cache.mimeType;
            if (object.httpMetadata?.contentType !== mimeType || (optimized && object.customMetadata?.sha256 !== expected)) return null;
            const reader = object.body.getReader();
            const chunks: Uint8Array[] = [];
            let size = 0;
            try {
              while (true) {
                const part = await reader.read();
                if (part.done) break;
                size += part.value.byteLength;
                if (size > object.size) return null;
                chunks.push(part.value);
              }
            } finally { await reader.cancel().catch(() => undefined); }
            if (size !== object.size) return null;
            const bytes = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
            if (!hasExpectedMagic(bytes, mimeType)) return null;
            const hash = digest(bytes);
            if ((!optimized && hash !== expected) || (object.customMetadata?.contentSha256 && hash !== object.customMetadata.contentSha256)) return null;
            remaining();
            return { kind: "image" as const, ...candidate, mimeType, bytes, base64: encodeAnnotationImageBase64(bytes), optimizedForModel: optimized };
          })(),
          new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), Math.min(5_000, remaining())); }),
        ]);
        if (cached) return cached;
      } catch { remaining(); } finally { if (timer) clearTimeout(timer); }
    }
  }
  const image = await (input.fetchImage ?? fetchAnnotationImage)(input.imageUrl, { timeoutMs: Math.max(1, Math.min(10_000, Math.floor(remaining() / 2))) });
  remaining();
  if (image.kind !== "image") throw new Error(`主图获取失败：${image.message}`);
  if (expected && digest(image.bytes) !== expected) throw new Error("主图获取失败：图片哈希已变化，请基于当前图片创建候选");
  return image;
}
