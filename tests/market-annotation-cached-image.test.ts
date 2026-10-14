import assert from "node:assert/strict";
import test from "node:test";
import { loadAnnotationImage, type AnnotationImageCacheReference } from "../lib/market/annotation-cached-image";
import { digest, parseVisionAnnotation } from "../lib/market/annotation-types";

const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, ...Array(32).fill(0)]);
const url = "https://img1.360buyimg.com/imgzone/fixture.png";
const hash = digest(png);
const cache: AnnotationImageCacheReference = { objectKey: `market-images/v1/${hash}.png`, contentSha256: hash, mimeType: "image/png", sizeBytes: png.length };
const object = (bytes: Uint8Array, mimeType = "image/png", metadata = {}) => ({ size: bytes.length, body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } }), httpMetadata: { contentType: mimeType }, customMetadata: metadata });
const input = () => ({ imageUrl: url, imageContentSha256: hash, cache, deadlineAt: Date.now() + 10_000 });

test("hash-matched original cache avoids JD and invalid derivatives fall back to original", async () => {
  let fetched = 0;
  const result = await loadAnnotationImage({ ...input(), bucket: { get: async (key) => key.endsWith(".png") ? object(png) : object(Uint8Array.from([1, 2]), "image/webp", { sha256: hash }) }, fetchImage: async () => { fetched++; throw new Error("unexpected network"); } });
  assert.deepEqual(result.bytes, png);
  assert.equal(fetched, 0);
});

test("valid derivative uses same original identity and avoids repeat transform", async () => {
  const webp = Uint8Array.from([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]);
  const result = await loadAnnotationImage({ ...input(), bucket: { get: async () => object(webp, "image/webp", { sha256: hash, contentSha256: digest(webp) }) } });
  assert.equal(result.optimizedForModel, true);
  assert.equal(result.mimeType, "image/webp");
  assert.equal(cache.contentSha256, hash);
});

test("cache mismatch, missing objects and corrupted original safely fall back to JD", async () => {
  for (const mode of ["metadata", "missing", "corrupt"]) {
    let gets = 0;
    let fetched = 0;
    const result = await loadAnnotationImage({ ...input(), cache: mode === "metadata" ? { ...cache, contentSha256: "b".repeat(64) } : cache,
      bucket: { get: async () => { gets++; return mode === "corrupt" ? object(new Uint8Array(png.length)) : null; } },
      fetchImage: async () => { fetched++; return { kind: "image", source: "imgzone", url, mimeType: "image/png", bytes: png, base64: "fixture" }; },
    });
    assert.equal(fetched, 1);
    assert.equal(gets, mode === "metadata" ? 0 : 2);
    assert.deepEqual(result.bytes, png);
  }
});

test("changed external image and unsafe URL cannot become old-candidate model input", async () => {
  await assert.rejects(loadAnnotationImage({ ...input(), cache: null, fetchImage: async () => ({ kind: "image", source: "imgzone", url, mimeType: "image/png", bytes: Uint8Array.from([...png, 1]), base64: "changed" }) }), /哈希已变化/);
  await assert.rejects(loadAnnotationImage({ ...input(), imageUrl: "https://localhost/private", bucket: { get: async () => { throw new Error("must not read"); } } }), /安全规则/);
});

test("clear no-price is distinct from uncertainty and never zero", () => {
  const prediction = { segment: "A", image_price_yuan: null, price_low_yuan: null, price_high_yuan: null, price_type: "明确无标价", confidence: 0.95, reason: "完整清晰主图没有商品标价" };
  assert.equal(parseVisionAnnotation(prediction, ["A"]).imagePriceCents, null);
  assert.equal(parseVisionAnnotation({ ...prediction, price_type: "无法判断", confidence: 0.2 }, ["A"]).priceType, "无法判断");
  for (const bad of [{ confidence: 0.5 }, { image_price_yuan: 0 }, { reason: "" }]) assert.throws(() => parseVisionAnnotation({ ...prediction, ...bad }, ["A"]), /充分证据/);
});
