import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  ANNOTATION_MODEL_IMAGE_LIMITS,
  annotationModelImageObjectKey,
  cachedAnnotationModelImage,
  optimizeAnnotationImageForModel,
  type AnnotationImagesBinding,
} from "../lib/market/annotation-model-image";

test("the Cloudflare Images binding is wired for model input resizing", async () => {
  const [viteConfig, runtime, cache, model] = await Promise.all([
    readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/market/annotation-image-runtime.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/market/image-cache.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/market/annotation-model.ts", import.meta.url), "utf8"),
  ]);
  assert.match(viteConfig, /images:\s*\{[\s\S]*?binding:\s*"IMAGES"/);
  assert.match(runtime, /env\.IMAGES/);
  assert.match(cache, /cacheAnnotationModelVariant/);
  assert.match(model, /prepareAnnotationModelImage\(sourceImage\)/);
});

test("large model images are scale-down encoded as a smaller WebP", async () => {
  const image = sourceImage(ANNOTATION_MODEL_IMAGE_LIMITS.reencodeThresholdBytes + 100);
  let transformOptions: unknown;
  let outputOptions: unknown;
  const binding: AnnotationImagesBinding = {
    info: async () => ({ width: 3_000, height: 2_400 }),
    input: () => ({
      transform: (options) => {
        transformOptions = options;
        return {
          output: async (output) => {
            outputOptions = output;
            return { response: () => webpResponse(webpBytes()) };
          },
        };
      },
    }),
  };

  const result = await optimizeAnnotationImageForModel(image, binding);

  assert.notEqual(result, image);
  assert.equal(result.mimeType, "image/webp");
  assert.equal(result.optimizedForModel, true);
  assert.deepEqual(transformOptions, { width: 1_600, height: 1_600, fit: "scale-down" });
  assert.deepEqual(outputOptions, { format: "image/webp", quality: 88, anim: false });
  assert.equal(result.base64, Buffer.from(webpBytes()).toString("base64"));
});

test("small images skip transformation without spending an encode", async () => {
  const image = sourceImage(200);
  let inputCalls = 0;
  const binding: AnnotationImagesBinding = {
    info: async () => ({ width: 800, height: 800 }),
    input: () => {
      inputCalls += 1;
      throw new Error("must not transform");
    },
  };

  const result = await optimizeAnnotationImageForModel(image, binding);

  assert.equal(result, image);
  assert.equal(inputCalls, 0);
});

test("failed, invalid, or non-smaller transforms fall back to the original", async (t) => {
  const image = sourceImage(100);
  const cases: Array<[string, AnnotationImagesBinding]> = [
    ["binding failure", transformingBinding(() => { throw new Error("unavailable"); })],
    ["invalid MIME", transformingBinding(() => binaryResponse(webpBytes(), "image/jpeg"))],
    ["invalid signature", transformingBinding(() => binaryResponse(new Uint8Array(12), "image/webp"))],
    ["not smaller", transformingBinding(() => webpResponse(webpBytes(100)))],
  ];

  for (const [name, binding] of cases) {
    await t.test(name, async () => {
      assert.equal(await optimizeAnnotationImageForModel(image, binding), image);
    });
  }
  assert.equal(await optimizeAnnotationImageForModel(image, undefined), image);
});

test("cached model variants require WebP and retain the original business identity", () => {
  const input = { kind: "image" as const, source: "imgzone" as const, url: "https://img10.360buyimg.com/imgzone/a.jpg" };
  const prepared = cachedAnnotationModelImage(input, webpBytes());
  assert.ok(prepared);
  assert.equal(prepared.url, input.url);
  assert.equal(prepared.source, input.source);
  assert.equal(prepared.optimizedForModel, true);
  assert.equal(cachedAnnotationModelImage(input, new Uint8Array(12)), null);
  assert.equal(annotationModelImageObjectKey("abc"), "market-images/model-v1/abc.webp");
});

function sourceImage(size: number) {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff]);
  return {
    kind: "image" as const,
    source: "imgzone" as const,
    url: "https://img10.360buyimg.com/imgzone/a.jpg",
    mimeType: "image/jpeg",
    bytes,
    base64: "original",
  };
}

function webpBytes(size = 12) {
  const bytes = new Uint8Array(Math.max(12, size));
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  bytes.set(new TextEncoder().encode("WEBP"), 8);
  return bytes;
}

function webpResponse(bytes: Uint8Array) {
  return binaryResponse(bytes, "image/webp; charset=binary");
}

function binaryResponse(bytes: Uint8Array, mimeType: string) {
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Response(body, { headers: { "content-type": mimeType } });
}

function transformingBinding(response: () => Response): AnnotationImagesBinding {
  return {
    info: async () => ({ width: 2_000, height: 2_000 }),
    input: () => ({
      transform: () => ({
        output: async () => ({ response }),
      }),
    }),
  };
}
