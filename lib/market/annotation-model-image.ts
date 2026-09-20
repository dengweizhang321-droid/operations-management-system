import { encodeAnnotationImageBase64 } from "@/lib/market/annotation-image";

export const ANNOTATION_MODEL_IMAGE_LIMITS = {
  maxDimension: 1_600,
  reencodeThresholdBytes: 1024 * 1024,
  quality: 88,
} as const;

export type AnnotationImageForModel = {
  kind: "image";
  source: "imgzone" | "n5";
  url: string;
  mimeType: string;
  bytes: Uint8Array;
  base64: string;
  optimizedForModel?: boolean;
};

export interface AnnotationImagesBinding {
  info?(stream: ReadableStream): Promise<{ width?: number; height?: number }>;
  input(stream: ReadableStream): {
    transform(options: { width: number; height: number; fit: "scale-down" }): {
      output(options: { format: "image/webp"; quality: number; anim: false }): Promise<{ response(): Response }>;
    };
  };
}

export function annotationModelImageObjectKey(contentHash: string) {
  return `market-images/model-v1/${contentHash}.webp`;
}

export async function optimizeAnnotationImageForModel<T extends AnnotationImageForModel>(
  image: T,
  binding?: AnnotationImagesBinding,
): Promise<T & AnnotationImageForModel> {
  if (image.optimizedForModel || !binding?.input) return image;

  let width = 0;
  let height = 0;
  if (binding.info) {
    try {
      const info = await binding.info(streamFor(image.bytes));
      width = positiveInteger(info.width);
      height = positiveInteger(info.height);
    } catch {
      // Size alone can still justify a safe re-encode when metadata probing is unavailable.
    }
  }

  const shouldTransform = Math.max(width, height) > ANNOTATION_MODEL_IMAGE_LIMITS.maxDimension
    || image.bytes.byteLength > ANNOTATION_MODEL_IMAGE_LIMITS.reencodeThresholdBytes;
  if (!shouldTransform) return image;

  try {
    const output = await binding.input(streamFor(image.bytes))
      .transform({
        width: ANNOTATION_MODEL_IMAGE_LIMITS.maxDimension,
        height: ANNOTATION_MODEL_IMAGE_LIMITS.maxDimension,
        fit: "scale-down",
      })
      .output({ format: "image/webp", quality: ANNOTATION_MODEL_IMAGE_LIMITS.quality, anim: false });
    const response = output.response();
    if (!response.ok || normalizeMimeType(response.headers.get("content-type")) !== "image/webp") return image;
    const bytes = await readBodySmallerThan(response, image.bytes.byteLength);
    if (!bytes || !isWebp(bytes)) return image;
    return {
      ...image,
      mimeType: "image/webp",
      bytes,
      base64: encodeAnnotationImageBase64(bytes),
      optimizedForModel: true,
    };
  } catch {
    return image;
  }
}

export function cachedAnnotationModelImage<T extends Omit<AnnotationImageForModel, "mimeType" | "bytes" | "base64" | "optimizedForModel">>(
  image: T,
  bytes: Uint8Array,
): (T & AnnotationImageForModel) | null {
  if (!bytes.byteLength || !isWebp(bytes)) return null;
  return {
    ...image,
    kind: "image",
    mimeType: "image/webp",
    bytes,
    base64: encodeAnnotationImageBase64(bytes),
    optimizedForModel: true,
  };
}

export async function repairAnnotationModelImageVariant<T extends AnnotationImageForModel>(
  image: T,
  existingBytes: Uint8Array | null,
  optimize: (source: T) => Promise<T & AnnotationImageForModel>,
  persist: (bytes: Uint8Array) => Promise<void>,
): Promise<T & AnnotationImageForModel> {
  if (existingBytes && existingBytes.byteLength < image.bytes.byteLength) {
    const cached = cachedAnnotationModelImage({ kind: image.kind, source: image.source, url: image.url }, existingBytes);
    if (cached) return { ...image, ...cached };
  }
  const optimized = await optimize(image);
  if (optimized.optimizedForModel && optimized.mimeType === "image/webp" && optimized.bytes.byteLength < image.bytes.byteLength) {
    await persist(optimized.bytes).catch(() => undefined);
  }
  return optimized;
}

function streamFor(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function positiveInteger(value: unknown) {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized > 0 ? Math.trunc(normalized) : 0;
}

function normalizeMimeType(value: string | null) {
  return value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function isWebp(bytes: Uint8Array) {
  return bytes.byteLength >= 12
    && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP";
}

async function readBodySmallerThan(response: Response, originalBytes: number) {
  if (originalBytes <= 1) return null;
  const maximum = originalBytes - 1;
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.byteLength <= maximum ? bytes : null;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    size += value.byteLength;
    if (size > maximum) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
