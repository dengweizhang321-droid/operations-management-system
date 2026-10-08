import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import * as XLSX from "xlsx";
import { jdCustomerServiceStores } from "../lib/jd/customer-service-stores";

test("实际客服POST保持显式四店绑定并拒绝矛盾身份，无店铺绑定的旧交互请求拒绝", async () => {
  const state = globalThis as typeof globalThis & { __boundCsSaved?: { shopName: string }; __boundCsWrites?: number };
  state.__boundCsWrites = 0;
  const bundled = await build({ entryPoints: ["app/api/customer-service/import/route.ts"], bundle: true, write: false,
    platform: "node", format: "esm", banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(process.cwd() + '/package.json');" }, external: ["cloudflare:workers"], plugins: [{ name: "bound-cs-owning-seams", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/(auth\/authorization|customer-service\/database)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "js", contents: args.path.endsWith("authorization") ? `
        export async function requireAppPrincipal(){return {email:'synthetic@example.test',role:'admin',scope:null};}
        export function requireUnrestrictedDataScope(){};export function authorizationErrorResponse(){return null;}` : `
        export function planCustomerServiceImportPayloads(){};export async function recordRejectedCustomerServiceImport(){};
        export async function saveCustomerServiceImport(input){globalThis.__boundCsSaved=input;globalThis.__boundCsWrites++;return {status:'imported',batch:{shopName:input.shopName}};}` }));
    } }] });
  const route = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`) as { POST(request: Request): Promise<Response> };
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ["咨询时间", "客服", "顾客", "cid"], ["2026-10-07 10:00:00", "志高厨电-合成", "synthetic", "fixture"],
  ]), "会话");
  const bytes = new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }));
  const request = (shopName: string, storeKey?: string) => {
    const form = new FormData(); form.set("shopName", shopName);
    if (storeKey !== undefined) form.set("storeKey", storeKey);
    form.set("sessionFile", new File([bytes], "fixture.xlsx"));
    form.set("chatFile", new File(["/*****************以下为一通会话************************************/\nsynthetic 2026-10-07 10:00:00\n合成内容\n"], "fixture.log"));
    return new Request("http://localhost:3000/api/customer-service/import", { method: "POST", body: form });
  };
  try {
    for (const store of jdCustomerServiceStores) {
      assert.equal((await route.POST(request(store.shopName, store.storeKey))).status, 201);
      assert.equal(state.__boundCsSaved?.shopName, store.shopName);
      const writes: number = state.__boundCsWrites ?? 0;
      assert.equal((await route.POST(request("wrong shop", store.storeKey))).status, 422);
      assert.equal(state.__boundCsWrites, writes);
    }
    const writes: number = state.__boundCsWrites ?? 0;
    for (const key of ["", "unknown", "../other"]) assert.equal((await route.POST(request(jdCustomerServiceStores[0].shopName, key))).status, 422);
    assert.equal(state.__boundCsWrites, writes);
    assert.equal((await route.POST(request("旧交互店铺"))).status, 422);
    assert.equal(state.__boundCsWrites, writes);
    const repeated = request(jdCustomerServiceStores[0].shopName, jdCustomerServiceStores[0].storeKey);
    const repeatedForm = await repeated.formData();
    repeatedForm.append("storeKey", jdCustomerServiceStores[1].storeKey);
    assert.equal((await route.POST(new Request(repeated.url, {method:"POST", body:repeatedForm}))).status, 422);
    assert.equal(state.__boundCsWrites, writes);
  } finally { delete state.__boundCsSaved; delete state.__boundCsWrites; }
});
