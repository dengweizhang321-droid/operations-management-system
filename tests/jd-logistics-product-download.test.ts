import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium, type BrowserContext, type Response } from "playwright-core";
import { parseProductLogisticsTaskPage, productLogisticsDownloadAck, productLogisticsDownloadAttachment, productLogisticsTaskCompleted, selectProductLogisticsTask } from "../lib/jd/logistics-source-tasks";
import { productDownloadProof, productDownloadWatch } from "../tools/jd-logistics-export";

const unit = "EBU4418046540089", taskId = "4418061014417", otherId = "4418061014418";
const scope = { sourceKind: "shop_products" as const, departmentId: "fixture", businessUnitCode: unit, warehouseCode: "", rangeStart: "2026-10-15", rangeEnd: "2026-10-16" };
const window = { submittedAt: "2026-10-15T04:00:00.000Z", observedAt: "2026-10-15T04:00:30.000Z" };
const record = (patch = {}) => ({ id: taskId, deptId: "4418046540089", taskStatus: "2", taskName: "店铺商品列表", bizType: "111", recordCount: "906", successCount: 0,
  createTime: "2026-10-15 12:00:00.0", taskParams: JSON.stringify({ shopGoodsShopIdList: [1, 2], shopGoodsDeptId: 4418046540089, shopGoodsDeptNo: unit, shopGoodsYn: 1, shopGoodsStatus: 1 }), ...patch });
const query = (ids: (string | number)[] = []) => [{ ids, pageNo: 0, pageSize: ids.length || 10, taskNameList: ["店铺商品列表"], bizTypeList: ["111"] }];
const payload = (records: unknown[], pageSize = 10) => ({ success: true, data: { aaData: records, iDisplayStart: 0, iDisplayLength: pageSize, iTotalRecords: records.length } });

test("product list and multi-ID progress bind only the submitted task, source department and observed status protocol", () => {
  const list = parseProductLogisticsTaskPage(payload([record()]), query());
  const pending = selectProductLogisticsTask(list, taskId, scope, window)!;
  assert.equal(productLogisticsTaskCompleted(pending), false); // 2 is processing, never completion.
  const progress = parseProductLogisticsTaskPage(payload([record({ id: otherId, deptId: "999" }), record({ taskStatus: "3" })], 2), query([otherId, taskId]));
  const completed = selectProductLogisticsTask(progress, taskId, scope, window)!;
  assert.equal(completed.id, taskId); assert.equal(completed.recordCount, 906); assert.equal(productLogisticsTaskCompleted(completed), true);
  assert.throws(() => productLogisticsTaskCompleted(selectProductLogisticsTask([record({ taskStatus: "4" })], taskId, scope, window)!), /EXPORT_TASK_FAILED/);
  for (const patch of [{ deptId: "999" }, { taskName: "其他任务" }, { bizType: "112" }, { taskStatus: "1" }, { createTime: "2026-10-14 12:00:00.0" }, { taskParams: "{}" }])
    assert.throws(() => selectProductLogisticsTask([record(patch)], taskId, scope, window), /TASK_SCOPE_MISMATCH/);
});
test("product progress rejects duplicate/invalid IDs, unknown request keys, wrong method, sizes and unrequested records", () => {
  for (const body of [query([taskId, taskId]), query(["0"]), query([Number.MAX_SAFE_INTEGER + 1]), query(Array.from({ length: 201 }, (_, i) => String(i + 1))),
    [{ ...query()[0], extra: true }], [{ ...query()[0], pageNo: 1 }], [{ ...query([taskId])[0], pageSize: 10 }], [{ ...query()[0], taskNameList: ["其他"] }]])
    assert.throws(() => parseProductLogisticsTaskPage(payload([record()]), body), /TASK_QUERY_MISMATCH/);
  assert.throws(() => parseProductLogisticsTaskPage(payload([record()]), query(), "GET"), /TASK_QUERY_MISMATCH/);
  assert.throws(() => parseProductLogisticsTaskPage(payload([record({ id: otherId })], 1), query([taskId])), /TASK_PAGE_INVALID/);
  assert.throws(() => parseProductLogisticsTaskPage(payload([record(), record()], 2), query([taskId, otherId])), /TASK_PAGE_INVALID/);
  assert.throws(() => parseProductLogisticsTaskPage({ success: true, data: { ...payload([record()], 2).data, iTotalRecords: 2 } }, query([taskId, otherId])), /TASK_PAGE_INVALID/);
});

const chrome = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const attachmentPath = "report/shop_goods_task_list_report-local-fixture.csv";
const signed = `https://s3.cn-north-1.jdcloud-oss.com/ka-admin-web/${attachmentPath}?fixture=exact`;
const csv = "fixture,enabled\n1,true\n";
test("safe numeric and string wire IDs stay canonical without discarding raw request fields", () => {
  const response = { code: 0, success: true, data: signed.slice("https:".length) };
  for (const wireId of [taskId, Number(taskId)]) {
    const rows = parseProductLogisticsTaskPage(payload([record({ id: Number(taskId) })], 1), query([wireId]));
    assert.equal(selectProductLogisticsTask(rows, taskId, scope, window)?.id, taskId);
    assert.equal(typeof productLogisticsDownloadAck({ code: 0, success: true, data: wireId }, [{ taskId: wireId }], taskId), "string");
    assert.equal(productLogisticsDownloadAttachment(response, [{ downloadUrl: attachmentPath, id: wireId }], taskId), signed);
    assert.throws(() => parseProductLogisticsTaskPage(payload([record()], 1), [{ ...query([wireId])[0], ignored: true }]), /TASK_QUERY_MISMATCH/);
    assert.throws(() => productLogisticsDownloadAck({ code: 0, success: true, data: taskId }, [{ taskId: wireId, ignored: true }], taskId), /TASK_MISMATCH/);
    assert.throws(() => productLogisticsDownloadAttachment(response, [{ downloadUrl: attachmentPath, id: wireId, ignored: true }], taskId), /TASK_MISMATCH/);
  }
  for (const invalid of [0, -1, Number.MAX_SAFE_INTEGER + 1, 1.5, NaN, "0", "01", "1e3", "-1", ""]) {
    assert.throws(() => parseProductLogisticsTaskPage(payload([record()], 1), query([invalid])), /TASK_QUERY_MISMATCH/);
    assert.throws(() => productLogisticsDownloadAck({ code: 0, success: true, data: taskId }, [{ taskId: invalid }], taskId), /TASK_(?:ID_INVALID|MISMATCH)/);
    assert.throws(() => productLogisticsDownloadAttachment(response, [{ downloadUrl: attachmentPath, id: invalid }], taskId), /TASK_(?:ID_INVALID|MISMATCH)/);
  }
  assert.throws(() => parseProductLogisticsTaskPage(payload([record()], 2), query([taskId, Number(taskId)])), /TASK_QUERY_MISMATCH/);
  assert.throws(() => parseProductLogisticsTaskPage(payload([record(), record({ id: Number(taskId) })], 2), query([taskId, otherId])), /TASK_PAGE_INVALID/);
});

const proofEndpoint = { ack: "https://api.jdl.com/exportTaskApi/download", url: "https://api.jdl.com/exportTaskApi/getExportDownloadUrl" };
const proofRequest = (endpoint: "ack" | "url", id: string | number = taskId) => endpoint === "ack" ? [{ taskId: id }] : [{ downloadUrl: attachmentPath, id }];
const proofBody = (endpoint: "ack" | "url") => ({ code: 0, success: true, data: endpoint === "ack" ? Number(taskId) : signed.slice("https:".length) });
function deferredBody() {
  let resolve!: (body: string) => void;
  const promise = new Promise<string>(done => { resolve = done; });
  return { promise, resolve };
}
function rpcResponse(endpoint: "ack" | "url", request: unknown, body: Promise<string> = Promise.resolve(JSON.stringify(proofBody(endpoint)))) {
  return { url: () => proofEndpoint[endpoint], request: () => ({ method: () => "POST", postDataJSON: () => request }), status: () => 200, text: () => body } as unknown as Response;
}
function emitAttachment(context: EventEmitter) {
  context.emit("response", { url: () => signed, request: () => ({ method: () => "GET" }), status: () => 200,
    headers: () => ({ "content-length": String(Buffer.byteLength(csv)) }), body: async () => Buffer.from(csv) } as unknown as Response);
}
test("first unique ACK/URL waits for its slow body; equivalent numeric/string proof identities bind", async t => {
  for (const slow of ["ack", "url"] as const) await t.test(slow, async () => {
    const context = new EventEmitter(), proof = productDownloadProof(context as unknown as BrowserContext), body = deferredBody();
    try {
      context.emit("response", rpcResponse("ack", proofRequest("ack", Number(taskId)), slow === "ack" ? body.promise : undefined));
      context.emit("response", rpcResponse("url", proofRequest("url"), slow === "url" ? body.promise : undefined));
      let settled = false;
      const taking = proof.take(taskId).then(value => { settled = true; return value; });
      await new Promise(resolve => setImmediate(resolve)); assert.equal(settled, false);
      body.resolve(JSON.stringify(proofBody(slow)));
      const binding = await taking;
      await binding.assertDownload(signed, Buffer.from(csv));
    } finally { proof.close(); body.resolve(JSON.stringify(proofBody(slow))); }
  });
});
test("headers of late duplicate ACK/URL count synchronously even while body is pending", async t => {
  for (const mode of ["direct", "blob"] as const) for (const endpoint of ["ack", "url"] as const) await t.test(`${mode} ${endpoint}`, async () => {
    const context = new EventEmitter(), proof = productDownloadProof(context as unknown as BrowserContext), duplicate = deferredBody();
    try {
      context.emit("response", rpcResponse("ack", proofRequest("ack")));
      context.emit("response", rpcResponse("url", proofRequest("url", Number(taskId))));
      const binding = await proof.take(taskId); if (mode === "blob") emitAttachment(context);
      const fileUrl = mode === "blob" ? "blob:https://scsw.jdl.com/fixture" : signed;
      await binding.assertDownload(fileUrl, Buffer.from(csv));
      context.emit("response", rpcResponse(endpoint, proofRequest(endpoint, Number(taskId)), duplicate.promise));
      await assert.rejects(binding.assertDownload(fileUrl, Buffer.from(csv)), /DOWNLOAD_PROOF_AMBIGUOUS/);
      proof.close(); duplicate.resolve(JSON.stringify(proofBody(endpoint)));
      await new Promise(resolve => setImmediate(resolve));
      await assert.rejects(binding.assertDownload(fileUrl, Buffer.from(csv)), /DOWNLOAD_PROOF_UNAVAILABLE/);
    } finally { proof.close(); duplicate.resolve(JSON.stringify(proofBody(endpoint))); }
  });
});
test("duplicate slow proof before binding and invalid late raw requests fail closed", async t => {
  for (const endpoint of ["ack", "url"] as const) await t.test(`pending duplicate ${endpoint}`, async () => {
    const context = new EventEmitter(), proof = productDownloadProof(context as unknown as BrowserContext), body = deferredBody();
    try {
      context.emit("response", rpcResponse("ack", proofRequest("ack"), endpoint === "ack" ? body.promise : undefined));
      context.emit("response", rpcResponse("url", proofRequest("url"), endpoint === "url" ? body.promise : undefined));
      context.emit("response", rpcResponse(endpoint, proofRequest(endpoint, Number(taskId))));
      await assert.rejects(proof.take(taskId), /DOWNLOAD_PROOF_AMBIGUOUS/);
    } finally { proof.close(); body.resolve(JSON.stringify(proofBody(endpoint))); }
  });
  for (const endpoint of ["ack", "url"] as const) for (const bad of ["extra", "unsafe", "leading-zero"] as const) await t.test(`${endpoint} ${bad}`, async () => {
    const context = new EventEmitter(), proof = productDownloadProof(context as unknown as BrowserContext), body = deferredBody();
    try {
      context.emit("response", rpcResponse("ack", proofRequest("ack")));
      context.emit("response", rpcResponse("url", proofRequest("url")));
      const binding = await proof.take(taskId);
      const raw = proofRequest(endpoint, bad === "unsafe" ? Number.MAX_SAFE_INTEGER + 1 : bad === "leading-zero" ? `0${taskId}` : taskId);
      if (bad === "extra") Object.assign(raw[0], { ignored: true });
      context.emit("response", rpcResponse(endpoint, raw, body.promise));
      await assert.rejects(binding.assertDownload(signed, Buffer.from(csv)), /DOWNLOAD_PROOF_UNAVAILABLE/);
    } finally { proof.close(); body.resolve(JSON.stringify(proofBody(endpoint))); }
  });
});
type Mode = "blob" | "wrong-bytes" | "no-get" | "double-get" | "double-download" | "wrong-origin" | "direct" | "wrong-direct" | "late-ack";
test("native product download binds automatic ack, URL, passive attachment GET and exact saved blob bytes", { skip: !existsSync(chrome), timeout: 30000 }, async t => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ["--disable-background-networking"] });
  const directory = await mkdtemp(path.join(tmpdir(), "jd-product-download-fixture-"));
  t.after(async () => { await browser.close(); await rm(directory, { recursive: true, force: true }); });
  for (const mode of ["blob", "wrong-bytes", "no-get", "double-get", "double-download", "wrong-origin", "direct", "wrong-direct", "late-ack"] as const) await t.test(mode, async () => {
    const context = await browser.newContext({ serviceWorkers: "block", acceptDownloads: true });
    const origin = mode === "wrong-origin" ? "https://other.invalid" : "https://scsw.jdl.com";
    let attachmentGets = 0;
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      const cors = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "*" };
      if (request.method() === "OPTIONS") { await route.fulfill({ status: 204, headers: cors }); return; }
      if (url.origin === origin && url.pathname === "/fixture") {
        const script = `<button id="start">Start fixture</button><script>
          document.querySelector('#start').onclick=async()=>{
            await fetch('https://api.jdl.com/exportTaskApi/download',{method:'POST',body:JSON.stringify([{taskId:'${taskId}'}])});
            const proof=await fetch('https://api.jdl.com/exportTaskApi/getExportDownloadUrl',{method:'POST',body:JSON.stringify([{downloadUrl:'${attachmentPath}',id:'${taskId}'}])}).then(r=>r.json());
            const signed='https:'+proof.data;
            let href=signed;
            if(!${JSON.stringify(mode)}.includes('direct')){
              let data=${JSON.stringify(csv)};
              if(${JSON.stringify(mode)}!=='no-get') data=await fetch(signed).then(r=>r.arrayBuffer());
              if(${JSON.stringify(mode)}==='double-get')await fetch(signed).then(r=>r.arrayBuffer());
              if(${JSON.stringify(mode)}==='wrong-bytes')data='different content';
              if(${JSON.stringify(mode)}==='late-ack'){await new Promise(resolve=>window.releaseLateAck=resolve);await fetch('https://api.jdl.com/exportTaskApi/download',{method:'POST',body:JSON.stringify([{taskId:'${taskId}'}])});}
              href=URL.createObjectURL(new Blob([data],{type:'text/csv'}));
            }else if(${JSON.stringify(mode)}==='wrong-direct')href=signed.replace('fixture=exact','fixture=wrong');
            const click=()=>{const a=document.createElement('a');a.href=href;a.download='fixture.csv';document.body.append(a);a.click();};
            click();if(${JSON.stringify(mode)}==='double-download')click();
          };</script>`;
        await route.fulfill({ contentType: "text/html; charset=utf-8", body: script }); return;
      }
      if (url.origin === "https://api.jdl.com" && url.pathname === "/exportTaskApi/download") {
        assert.equal(request.method(), "POST"); assert.deepEqual(request.postDataJSON(), [{ taskId }]);
        await route.fulfill({ contentType: "application/json", headers: cors, body: JSON.stringify({ code: 0, success: true, data: taskId }) }); return;
      }
      if (url.origin === "https://api.jdl.com" && url.pathname === "/exportTaskApi/getExportDownloadUrl") {
        assert.equal(request.method(), "POST"); assert.deepEqual(request.postDataJSON(), [{ downloadUrl: attachmentPath, id: taskId }]);
        await route.fulfill({ contentType: "application/json", headers: cors, body: JSON.stringify({ code: 0, success: true, data: signed.slice("https:".length) }) }); return;
      }
      if (url.origin === "https://s3.cn-north-1.jdcloud-oss.com") {
        assert.equal(request.method(), "GET"); attachmentGets++;
        await route.fulfill({ contentType: "text/csv", headers: { ...cors, "content-disposition": 'attachment; filename="fixture.csv"' }, body: csv }); return;
      }
      await route.abort();
    });
    const page = await context.newPage(); await page.goto(`${origin}/fixture`);
    const proof = productDownloadProof(context), downloads = productDownloadWatch(page, context);
    const received: unknown[] = [];
    let allDownloads!: () => void;
    const doubled = new Promise<void>(resolve => { allDownloads = resolve; });
    page.on("download", file => { received.push(file); if (received.length === 2) allDownloads(); });
    try {
      await page.locator("#start").click();
      const binding = await proof.take(taskId);
      if (mode === "late-ack") {
        await page.waitForFunction(() => typeof (window as any).releaseLateAck === "function");
        await page.evaluate(() => (window as any).releaseLateAck());
      }
      if (mode === "double-download") {
        await Promise.race([doubled, new Promise((_, reject) => setTimeout(() => reject(new Error("second fixture download missing")), 3000))]);
        await assert.rejects(downloads.take(), /DOWNLOAD_AMBIGUOUS/); assert.throws(() => downloads.assertUnique(), /DOWNLOAD_AMBIGUOUS/);
        return;
      }
      const file = await downloads.take();
      assert.equal(await file.failure(), null);
      await file.saveAs(path.join(directory, `${mode}.csv`));
      const bytes = await readFile(path.join(directory, `${mode}.csv`));
      if (["wrong-bytes", "no-get", "double-get", "wrong-origin", "wrong-direct", "late-ack"].includes(mode)) {
        await assert.rejects(binding.assertDownload(file.url(), bytes), /JD_LOGISTICS_PRODUCTS_(?:ATTACHMENT|DOWNLOAD)/);
      } else {
        await binding.assertDownload(file.url(), bytes); downloads.assertUnique(); assert.equal(bytes.toString("utf8"), csv);
        if (mode === "blob") { assert.equal(new URL(file.url()).origin, "https://scsw.jdl.com"); assert.equal(attachmentGets, 1); }
        else assert.equal(file.url(), signed);
      }
    } finally { proof.close(); downloads.close(); await context.close(); }
  });
});
