import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";

function bootstrapFixture() {
      const f = window.fixture = { sessions: [], operations: [], files: [], events: [], posts: 0, holdEvents: false };
      window.fetch = async (input, init = {}) => {
        const url = String(input), method = init.method || "GET", payload = init.body ? JSON.parse(init.body) : {};
        let data;
        if (url.endsWith("/skills")) data = { items: [], models: [{ id: "m1", name: "OpenCode Go", modelName: "fixture", isDefault: true }] };
        else if (/\/sessions(?:\?|$)/.test(url) && method === "GET") data = { items: f.sessions };
        else if (url.endsWith("/sessions")) { f.sessions = [{ id: "s1", title: "合成报告", status: "idle", epoch: 1, generation: 1, scope: null }]; data = { session: f.sessions[0] }; }
        else if (url.endsWith("/messages")) { f.posts++; f.operations = [{ id: "op1", kind: "prompt", status: "running", clientRequestId: payload.clientRequestId }]; data = { session: f.sessions[0], operation: f.operations[0] }; }
        else if (url.includes("/events?")) {
          const after = Number(new URL(url, "https://fixture.invalid").searchParams.get("after"));
          const items = f.events.filter(e => e.eventSeq > after).slice(0, 100);
          data = { items, after: items.at(-1)?.eventSeq ?? after, hasMore: f.events.some(e => e.eventSeq > (items.at(-1)?.eventSeq ?? after)) };
          if (after >= 100 && f.holdEvents) return new Promise(resolve => { (window.eventResolvers ||= []).push(() => resolve(Response.json(data))); window.releaseEvents = () => { f.holdEvents = false; for (const release of window.eventResolvers) release(); window.eventResolvers = []; }; });
        } else if (url.endsWith("/sessions/s1")) data = { session: f.sessions[0], operations: f.operations, files: f.files };
        else throw Error("Unexpected isolated route " + url);
        return Response.json(data);
      };
}

test("Chat/Agent preserves running controllers and restores completed results and current files", { timeout: 60000 }, async () => {
  const directory = await mkdtemp(path.join(process.cwd(), ".codex-tmp-mode-ui-"));
  let browser;
  try {
    const stub = `import React,{useEffect,useState} from 'react'; export default function Chat(p){const [draft,setDraft]=useState('');useEffect(()=>{window.chatMounts=(window.chatMounts||0)+1},[]);return <div><input aria-label="Chat draft" value={draft} onChange={e=>setDraft(e.target.value)}/>{p.composerModeControl}</div>}`;
    const bundle = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import Workspace from './app/ai-conversation-workspace';createRoot(document.getElementById('root')).render(<Workspace currentUser={{email:'mode@example.invalid',displayName:'隔离',role:'analyst',roleLabel:'分析员'}}/>);`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "chat-controller-fixture", setup(b) { b.onLoad({ filter: /app[\\/]ai-assistant-view\.tsx$/ }, () => ({ contents: stub, loader: "tsx" })); } }] });
    const css = (await Promise.all(["app/ai-chat-workbench.css", "app/ai-pi-agent.css"].map(p => readFile(p, "utf8")))).join("\n");
    const html = `<!doctype html><meta charset="utf-8"><title>AI 对话 Chat / Agent · 合成验证</title><style>:root{--color-brand:#2c5b43;--color-border-default:#dce5df;--color-text-secondary:#52655a}body{margin:0}#root{height:800px;display:flex}${css}</style><div id="root"></div><script>(${bootstrapFixture.toString()})();${bundle.outputFiles[0].text}</script>`;
    await writeFile(path.join(directory, "index.html"), html);
    browser = await chromium.launch({ executablePath: process.env.PI_TEST_BROWSER || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(pathToFileURL(path.join(directory, "index.html")).href);
    await page.getByLabel("Chat draft").fill("保留的普通对话草稿");
    await page.getByRole("button", { name: "Agent", exact: true }).click();
    await page.getByRole("button", { name: "＋ 新建环境" }).click();
    await page.getByRole("heading", { name: "合成报告" }).waitFor();
    await page.getByLabel("任务", { exact: true }).fill("生成合成报告");
    await page.getByRole("button", { name: "发送任务", exact: true }).click();
    await page.waitForFunction(() => window.fixture.posts === 1);
    await page.getByRole("button", { name: "Chat", exact: true }).click();
    assert.equal(await page.getByLabel("Chat draft").inputValue(), "保留的普通对话草稿");
    await page.getByRole("button", { name: "Agent", exact: true }).click();
    await page.evaluate(() => {
      const f = window.fixture; f.operations[0].status = "succeeded"; f.holdEvents = true;
      f.files = [{ id: "new-file", operationId: "op1", fileName: "本轮报告.xlsx", direction: "output", sizeBytes: 8000, sha256: "a".repeat(64) }, { id: "old-file", operationId: "old-op", fileName: "旧轮报告.xlsx", direction: "output", sizeBytes: 6000, sha256: "b".repeat(64) }];
      f.events = Array.from({length: 100}, (_, i) => ({eventSeq:i+1,operationId:"op1",type:"assistant_message",data:{text:"过程记录 "+i+"："+"合成过程说明".repeat(30)}}));
      f.events.push({eventSeq:101,operationId:"op1",type:"assistant_message",data:{text:"最终中文分析结果已完成，报告可下载。"}});
    });
    await page.getByRole("button", { name: "刷新记录" }).click();
    await page.waitForFunction(() => typeof window.releaseEvents === "function");
    assert.equal(await page.getByRole("button", {name:"正在恢复结果…",exact:true}).isDisabled(), true);
    assert.equal(await page.locator(".ai-pi-completed").getByRole("link", {name:"本轮报告.xlsx"}).count(), 1);
    assert.equal(await page.locator(".ai-pi-completed").getByRole("link", {name:"旧轮报告.xlsx"}).count(), 0);
    await page.evaluate(() => { window.fixture.holdEvents = false; for (const release of window.eventResolvers ?? []) release(); window.eventResolvers = []; });
    try { await page.getByRole("button", {name:"查看分析结果",exact:true}).waitFor({timeout:5000}); }
    catch (error) { console.log(await page.evaluate(() => ({body:document.body.innerText.slice(-1800),events:window.fixture.events.length,hold:window.fixture.holdEvents,resolvers:window.eventResolvers?.length,errors:document.querySelector('[role=alert]')?.textContent}))); throw error; }
    try { await page.waitForFunction(() => { const e=document.querySelector('.ai-pi .ai-workbench-scroll');return e.scrollHeight-e.scrollTop-e.clientHeight<10; }, {timeout:5000}); }
    catch (error) { console.log(await page.locator('.ai-pi .ai-workbench-scroll').evaluate(e => ({top:e.scrollTop,height:e.scrollHeight,client:e.clientHeight,css:getComputedStyle(e).overflowY}))); throw error; }
    await page.getByRole("button", {name:"Chat",exact:true}).click();
    await page.getByRole("button", {name:"Agent",exact:true}).click();
    assert.equal(await page.evaluate(() => window.fixture.posts), 1);
    assert.equal(await page.evaluate(() => window.chatMounts), 1);
    assert.deepEqual(errors, []);
    await context.close();
    if (process.env.PI_KEEP_MODE_HTML) await writeFile(process.env.PI_KEEP_MODE_HTML, html);
  } finally { await browser?.close(); await rm(directory, {recursive:true,force:true}); }
});
