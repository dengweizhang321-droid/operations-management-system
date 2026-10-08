import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import * as XLSX from "xlsx";
import { jdCustomerServiceStores } from "../lib/jd/customer-service-stores";

test("分片导入四店精确绑定；无绑定、跨店重放及旧回执均拒绝", async () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ["咨询时间", "客服", "顾客", "cid"], ["2026-10-07 10:00:00", "志高厨电-共用合成客服", "synthetic", "fixture"],
  ]), "会话");
  const bytes = new Uint8Array(XLSX.write(book, {type:"array", bookType:"xlsx"}));
  const log = new TextEncoder().encode("/*****************以下为一通会话************************************/\nsynthetic 2026-10-07 10:00:00\n合成内容\n");
  const fixture = { claims:0, writes:[] as string[], releases:[] as string[], status:"imported",
    deny:false, receipts:new Map<string, Record<string, unknown>>(), bytes, log };
  const state = globalThis as typeof globalThis & { __csBoundChunks?: typeof fixture };
  state.__csBoundChunks = fixture;
  const bundle = await build({entryPoints:["app/api/customer-service/import/chunks/route.ts"], bundle:true,
    write:false, platform:"node", format:"esm", external:["cloudflare:workers"],
    banner:{js:"import { createRequire } from 'node:module'; const require = createRequire(process.cwd() + '/package.json');"},
    plugins:[{name:"isolated-owning-seams", setup(builder) {
      builder.onResolve({filter:/^@\/lib\/(auth\/authorization|customer-service\/(database|chunked-upload))$/}, args=>({path:args.path,namespace:"fixture"}));
      builder.onLoad({filter:/.*/,namespace:"fixture"}, args=>({loader:"js",contents:args.path.endsWith("authorization") ? `
        export async function requireAppPrincipal(){if(globalThis.__csBoundChunks.deny)throw new Error('denied');return {email:'synthetic@example.invalid',role:'admin',scope:null};}
        export function requireUnrestrictedDataScope(){};export function authorizationErrorResponse(error){return error.message==='denied'?Response.json({ok:false},{status:403}):null;}`
        : args.path.endsWith("database") ? `
        export function planCustomerServiceImportPayloads(){};export async function recordRejectedCustomerServiceImport(){};
        export async function saveCustomerServiceImport(input){const s=globalThis.__csBoundChunks;s.writes.push(input.shopName);return {status:s.status,batch:{shopName:input.shopName}};}` : `
        export const CUSTOMER_SERVICE_UPLOAD_CHUNK_BYTES=1048576;
        export async function beginCustomerServiceUpload(){};export async function receiveCustomerServiceUploadChunk(){};
        export async function claimCustomerServiceUpload(principal,id){const s=globalThis.__csBoundChunks;s.claims++;const upload={id,kind:id.startsWith('session')?'session':'chat'};return s.receipts.has(id)?{kind:'completed',upload,result:s.receipts.get(id)}:{kind:'claimed',ownerToken:id,upload};}
        export async function assembleCustomerServiceUpload(principal,claim){const s=globalThis.__csBoundChunks;return claim.upload.kind==='session'?s.bytes:s.log;}
        export async function finishCustomerServiceUpload(principal,id,owner,result){globalThis.__csBoundChunks.receipts.set(id,result);}
        export async function releaseCustomerServiceUpload(principal,id){globalThis.__csBoundChunks.releases.push(id);}` }));
    }}]});
  const route = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`) as {POST(request:Request):Promise<Response>};
  const request = (body:Record<string, unknown>) => new Request("https://fixture.invalid/api/customer-service/import/chunks", {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"complete",sessionUploadId:"session-a",chatUploadId:"chat-a",sessionFileName:"fixture.xlsx",chatFileName:"fixture.log",...body})});
  try {
    const first=jdCustomerServiceStores[0];
    for(const storeKey of [undefined,null,"","unknown",[],first.storeKey]) {
      const response=await route.POST(request({shopName:storeKey===first.storeKey?"wrong":first.shopName,storeKey}));
      assert.equal(response.status,422);
    }
    assert.equal(fixture.claims,0); assert.equal(fixture.writes.length,0);
    fixture.deny=true;
    assert.equal((await route.POST(request({shopName:first.shopName,storeKey:first.storeKey}))).status,403);
    assert.equal(fixture.claims,0);fixture.deny=false;

    for(const [index,store] of jdCustomerServiceStores.entries()) {
      const body={shopName:store.shopName,storeKey:store.storeKey,sessionUploadId:`session-${index}`,chatUploadId:`chat-${index}`};
      const response=await route.POST(request(body));
      assert.equal(response.status,201);
      const receipt=await response.json();
      assert.equal(receipt.storeKey,store.storeKey);assert.equal(receipt.batch.shopName,store.shopName);
      assert.equal(fixture.writes.at(-1),store.shopName);
      const writes=fixture.writes.length;
      assert.deepEqual(await (await route.POST(request(body))).json(),receipt);
      assert.equal(fixture.writes.length,writes);
      for(const other of jdCustomerServiceStores.filter(item=>item!==store)) {
        assert.equal((await route.POST(request({...body,storeKey:other.storeKey,shopName:other.shopName}))).status,409);
        assert.equal(fixture.writes.length,writes);
      }
      const missingKey={...receipt};delete missingKey.storeKey;
      fixture.receipts.set(body.sessionUploadId,missingKey);fixture.receipts.set(body.chatUploadId,missingKey);
      assert.equal((await route.POST(request(body))).status,409);
      const wrongBatch={...receipt,batch:{shopName:jdCustomerServiceStores[(index+1)%4].shopName}};
      fixture.receipts.set(body.sessionUploadId,wrongBatch);fixture.receipts.set(body.chatUploadId,wrongBatch);
      assert.equal((await route.POST(request(body))).status,409);
      fixture.receipts.set(body.sessionUploadId,receipt);fixture.receipts.set(body.chatUploadId,receipt);
    }
    fixture.status="duplicate";
    const body={shopName:first.shopName,storeKey:first.storeKey,sessionUploadId:"session-duplicate",chatUploadId:"chat-duplicate"};
    const duplicate=await route.POST(request(body));assert.equal(duplicate.status,200);
    assert.equal((await duplicate.json()).status,"duplicate");
    const writes=fixture.writes.length;
    assert.equal((await route.POST(request(body))).status,200);assert.equal(fixture.writes.length,writes);
    assert.equal((await route.POST(request({...body,chatUploadId:"chat-new"}))).status,409);
    assert.ok(fixture.releases.includes("chat-new"));assert.equal(fixture.writes.length,writes);
  } finally {delete state.__csBoundChunks;}
});
