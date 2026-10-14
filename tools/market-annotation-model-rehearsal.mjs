/** Execute the actual vision adapter with isolated model/image boundaries. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const folder = resolve(".runtime/annotation-model");
await mkdir(folder, { recursive: true });
const mocks = {
  authorization: 'export async function requireAppPrincipal(){return {email:"fixture@example.invalid",role:"admin",scope:null}}',
  "ai-service": 'export async function aiConsumer(){return {model:{id:"fixture",protocol:"openai_compatible",model_name:"fixture-vision",base_url:"https://api.synthetic.invalid/v1",api_key_encrypted:"synthetic",timeout_ms:60000}}}',
  crypto: 'export async function decryptSecret(){return "synthetic-not-a-key"}',
  "endpoint-security": 'export async function loadAiEndpointSecurityContext(){return {}}; export function resolveAiModelEndpointUrl(){return "https://api.synthetic.invalid/v1/chat/completions"}',
  "model-gateway": 'export async function completeText(){throw new Error("text model must not run")}',
  "annotation-image-runtime": 'export async function loadAnnotationImageWithRuntime(){return {kind:"image",source:"imgzone",url:"https://img1.360buyimg.com/imgzone/synthetic.png",mimeType:"image/png",bytes:new Uint8Array(32),base64:"synthetic"}}; export async function optimizeAnnotationImageWithRuntime(image){return image}',
};
const output = resolve(folder, "model.mjs");
await build({ entryPoints: [resolve("lib/market/annotation-model.ts")], bundle: true, platform: "node", format: "esm", outfile: output, alias: { "@": resolve(".") }, plugins: [{ name: "isolated-model-boundaries", setup(plugin) {
  plugin.onResolve({ filter: /(?:authorization|ai-service|crypto|endpoint-security|model-gateway|annotation-image-runtime)$/ }, (args) => {
    const name = args.path.split("/").pop();
    return mocks[name] && args.path !== "node:crypto" ? { path: name, namespace: "synthetic" } : null;
  });
  plugin.onLoad({ filter: /.*/, namespace: "synthetic" }, (args) => ({ contents: mocks[args.path], loader: "js" }));
} }] });
const { runVisionAnnotation } = await import(pathToFileURL(output).href);
const original = globalThis.fetch;
const requests = [];
let segment = "A";
globalThis.fetch = async (url, init) => {
  assert.equal(url, "https://api.synthetic.invalid/v1/chat/completions");
  assert.equal(init.method, "POST");
  requests.push(JSON.parse(init.body));
  return Response.json({ choices: [{ message: { content: JSON.stringify({ segment, image_price_yuan: 123.45, price_type: "标准售价", price_low_yuan: null, price_high_yuan: null, confidence: 0.95, reason: "合成主图价格" }) } }] });
};
try {
  const input = { modelId: "fixture", promptBody: "合成分类规则", segments: ["A", "B"], skuCode: "fixture", productName: "合成商品", brand: "Fixture", imageUrl: "https://img1.360buyimg.com/imgzone/synthetic.png" };
  const a = await runVisionAnnotation(input);
  assert.equal(a.segment, "A");
  assert.equal(a.imagePriceCents, 12345);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].messages[0].content.filter((part) => part.type === "image_url").length, 1);
  segment = "B";
  const b = await runVisionAnnotation({ ...input, fixedSegment: "B" });
  assert.equal(b.segment, "B");
  assert.equal(requests.length, 2);
  assert.equal(requests[1].max_tokens, 320);
  assert.deepEqual(requests[1].response_format.json_schema.schema.properties.segment.enum, ["B"]);
  segment = "A";
  await assert.rejects(runVisionAnnotation({ ...input, fixedSegment: "B" }), /枚举/);
  assert.equal(requests.length, 3);
  const report = { status: "passed", actualVisionAdapter: true, syntheticModelPosts: requests.length, realModelCalls: 0, checks: ["A one image/one POST/two results", "B fixed classification/price prompt", "invalid B response fails without second inference"] };
  await writeFile(resolve(folder, "result.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { globalThis.fetch = original; }
