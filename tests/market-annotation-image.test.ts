import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchAnnotationImage,
  resolveAnnotationImageCandidates,
  type AnnotationImageFetch,
} from "../lib/market/annotation-image";

const N5_URL = "https://img10.360buyimg.com/n5/jfs/t1/example.jpg?size=small";
const IMGZONE_URL = "https://img10.360buyimg.com/imgzone/jfs/t1/example.jpg?size=small";

test("resolves the safe imgzone-first candidate order without fetching", () => {
  assert.deepEqual(resolveAnnotationImageCandidates(N5_URL), [
    { source: "imgzone", url: IMGZONE_URL },
    { source: "n5", url: N5_URL },
  ]);
  assert.deepEqual(resolveAnnotationImageCandidates("https://evil.test/n5/x.jpg"), []);
});

test("prefers imgzone and returns bytes, base64, MIME, and actual source", async () => {
  const requested: Array<{ url: string; redirect: RequestRedirect | undefined }> = [];
  const fetcher: AnnotationImageFetch = async (input, init) => {
    requested.push({ url: String(input), redirect: init?.redirect });
    return imageResponse(new Uint8Array([0xff, 0xd8, 0xff]), "image/jpeg; charset=binary");
  };

  const result = await fetchAnnotationImage(N5_URL, { fetch: fetcher });

  assert.equal(result.kind, "image");
  if (result.kind !== "image") return;
  assert.equal(result.source, "imgzone");
  assert.equal(result.url, IMGZONE_URL);
  assert.equal(result.mimeType, "image/jpeg");
  assert.deepEqual([...result.bytes], [0xff, 0xd8, 0xff]);
  assert.equal(result.base64, "/9j/");
  assert.deepEqual(requested, [{ url: IMGZONE_URL, redirect: "manual" }]);
});

test("falls back to the original n5 URL when imgzone is unavailable", async () => {
  const requested: string[] = [];
  const fetcher: AnnotationImageFetch = async (input) => {
    requested.push(String(input));
    if (String(input).includes("/imgzone/")) return new Response("missing", { status: 404 });
    return imageResponse(new TextEncoder().encode("RIFF\u0004\u0000\u0000\u0000WEBP"), "image/webp");
  };

  const result = await fetchAnnotationImage(N5_URL, { fetch: fetcher });

  assert.equal(result.kind, "image");
  if (result.kind !== "image") return;
  assert.equal(result.source, "n5");
  assert.deepEqual(requested, [IMGZONE_URL, N5_URL]);
});

test("does not fabricate an n5 fallback for an imgzone input", async () => {
  let calls = 0;
  const result = await fetchAnnotationImage(IMGZONE_URL, {
    fetch: async () => {
      calls += 1;
      return new Response(null, { status: 404 });
    },
  });

  assert.deepEqual(result, {
    kind: "no-image",
    reason: "http_error",
    message: "imgzone image returned HTTP 404",
    attemptedSources: ["imgzone"],
  });
  assert.equal(calls, 1);
});

test("rejects unsafe URLs without invoking fetch", async (t) => {
  const cases: Array<[string, string]> = [
    ["http://img10.360buyimg.com/n5/x.jpg", "insecure_url"],
    ["https://user:secret@img10.360buyimg.com/n5/x.jpg", "credentials_not_allowed"],
    ["https://img10.360buyimg.com/n5/x.jpg#fragment", "fragment_not_allowed"],
    ["https://img10.360buyimg.com:444/n5/x.jpg", "port_not_allowed"],
    ["https://localhost/n5/x.jpg", "host_not_allowed"],
    ["https://127.0.0.1/n5/x.jpg", "host_not_allowed"],
    ["https://img10.360buyimg.com.evil.test/n5/x.jpg", "host_not_allowed"],
    ["https://evil-img10.360buyimg.com/n5/x.jpg", "host_not_allowed"],
    ["https://360buyimg.com/n5/x.jpg", "host_not_allowed"],
    ["https://img10.360buyimg.com/n1/x.jpg", "unsupported_source"],
    ["not-a-url", "invalid_url"],
  ];

  for (const [url, reason] of cases) {
    await t.test(reason + ": " + url, async () => {
      let called = false;
      const result = await fetchAnnotationImage(url, {
        fetch: async () => {
          called = true;
          throw new Error("must not run");
        },
      });
      assert.equal(result.kind, "no-image");
      if (result.kind === "no-image") assert.equal(result.reason, reason);
      assert.equal(called, false);
    });
  }
});

test("rejects redirects even when a Location header points at an allowed host", async () => {
  const result = await fetchAnnotationImage(IMGZONE_URL, {
    fetch: async (_input, init) => {
      assert.equal(init?.redirect, "manual");
      return new Response(null, {
        status: 302,
        headers: { location: "https://img11.360buyimg.com/imgzone/other.jpg" },
      });
    },
  });

  assert.equal(result.kind, "no-image");
  if (result.kind === "no-image") assert.equal(result.reason, "redirect_not_allowed");
});

test("requires image MIME and rejects oversized declared and actual bodies", async (t) => {
  await t.test("MIME", async () => {
    const result = await fetchAnnotationImage(IMGZONE_URL, {
      fetch: async () => new Response("<html></html>", { headers: { "content-type": "text/html" } }),
    });
    assert.equal(result.kind, "no-image");
    if (result.kind === "no-image") assert.equal(result.reason, "unsupported_mime");
  });

  await t.test("declared length", async () => {
    const result = await fetchAnnotationImage(IMGZONE_URL, {
      maxBytes: 3,
      fetch: async () => imageResponse(new Uint8Array([1]), "image/png", { "content-length": "4" }),
    });
    assert.equal(result.kind, "no-image");
    if (result.kind === "no-image") assert.equal(result.reason, "too_large");
  });

  await t.test("actual streaming length", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3, 4]));
        controller.close();
      },
    });
    const result = await fetchAnnotationImage(IMGZONE_URL, {
      maxBytes: 3,
      fetch: async () => new Response(stream, { headers: { "content-type": "image/png" } }),
    });
    assert.equal(result.kind, "no-image");
    if (result.kind === "no-image") assert.equal(result.reason, "too_large");
  });
});

test("rejects SVG and MIME-spoofed image bodies", async (t) => {
  await t.test("SVG", async () => {
    const result = await fetchAnnotationImage(IMGZONE_URL, { fetch: async () => new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } }) });
    assert.equal(result.kind, "no-image");
    if (result.kind === "no-image") assert.equal(result.reason, "unsupported_mime");
  });
  await t.test("spoofed JPEG", async () => {
    const result = await fetchAnnotationImage(IMGZONE_URL, { fetch: async () => imageResponse(new TextEncoder().encode("<html>"), "image/jpeg") });
    assert.equal(result.kind, "no-image");
    if (result.kind === "no-image") assert.equal(result.reason, "invalid_signature");
  });
});

test("aborts a stalled request at the injected timeout", async () => {
  let observedAbort = false;
  const fetcher: AnnotationImageFetch = async (_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => {
      observedAbort = true;
      reject(new DOMException("aborted", "AbortError"));
    }, { once: true });
  });

  const result = await fetchAnnotationImage(IMGZONE_URL, { fetch: fetcher, timeoutMs: 5 });

  assert.equal(result.kind, "no-image");
  if (result.kind === "no-image") assert.equal(result.reason, "timeout");
  assert.equal(observedAbort, true);
});

function imageResponse(bytes: Uint8Array, mimeType: string, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set("content-type", mimeType);
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  return new Response(body, { status: 200, headers });
}
