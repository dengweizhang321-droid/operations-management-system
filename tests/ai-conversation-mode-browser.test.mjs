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
        if (url.includes("/business-actions")) data = {items: []};
        else if (url.includes("/workspace")) data = {workspace:{status:"ready",state:{}},controls:[]};
        else if (url.endsWith("/skills")) data = { items: [], models: [{ id: "m1", name: "OpenCode Go", modelName: "fixture", isDefault: true }] };
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
    const stub = `import React,{useEffect,useState} from 'react'; import Workbench from './ai-chat-workbench'; export default function Chat(p){const [draft,setDraft]=useState('');useEffect(()=>{window.chatMounts=(window.chatMounts||0)+1},[]);return <Workbench compact={false} currentTitle="普通问答" activeConversationId="c1" conversations={[{id:'c1',title:'普通问答',updatedAt:'2026-10-20T12:00:00Z'}]} conversationTotal={1} messages={[]} models={[{id:'m1',name:'OpenCode Go',modelType:'text',isDefault:true}]} selectedModelId="m1" canChat={true} busy={false} sending={false} loading={false} recoveryBlocked={false} draft={draft} onDraft={setDraft} onSend={()=>{}} onStop={()=>{}} onNew={()=>setDraft('')} onOpen={()=>{}} onDelete={()=>{}} onModel={()=>{}} onExpand={()=>{}} onMore={()=>{}} onOlder={()=>{}} onRefresh={()=>{}} onRemoveContext={()=>{}} renderArtifacts={()=>null} composerModeControl={p.composerModeControl}/>}`;
    const bundle = await build({ nodePaths: (process.env.PI_TEST_NODE_MODULES || "").split(path.delimiter).filter(Boolean), stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import Workspace from './app/ai-conversation-workspace';createRoot(document.getElementById('root')).render(<Workspace currentUser={{email:'mode@example.invalid',displayName:'隔离',role:'analyst',roleLabel:'分析员'}}/>);`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "chat-controller-fixture", setup(b) { b.onLoad({ filter: /app[\\/]ai-assistant-view\.tsx$/ }, () => ({ contents: stub, loader: "tsx", resolveDir: path.join(process.cwd(), "app") })); } }] });
    const css = (await Promise.all(["app/ai-chat-workbench.css", "app/ai-pi-agent.css"].map(p => readFile(p, "utf8")))).join("\n");
    const html = `<!doctype html><meta charset="utf-8"><title>AI 对话 Chat / Agent · 合成验证</title><style>:root{--color-brand:#2c5b43;--color-border-default:#dce5df;--color-text-secondary:#52655a;--color-text-primary:#354c3d;--color-text-muted:#829087;--color-bg-surface:#fff;--color-text-inverse:#fff}body{margin:0;font:14px system-ui,"Microsoft YaHei",sans-serif}#root{height:800px;display:flex}${css}</style><div id="root"></div><script>(${bootstrapFixture.toString()})();${bundle.outputFiles[0].text}</script>`;
    await writeFile(path.join(directory, "index.html"), html);
    browser = await chromium.launch({ executablePath: process.env.PI_TEST_BROWSER || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(pathToFileURL(path.join(directory, "index.html")).href);
    await page.getByLabel("输入 AI 问题").fill("保留的普通对话草稿");
    await page.getByRole("button", { name: "Agent", exact: true }).click();
    await page.getByRole("button", { name: "＋ 新对话" }).click();
    await page.locator(".ai-unified-chat > header").getByText("合成报告", { exact: true }).waitFor();
    await page.getByLabel("Agent 任务", { exact: true }).fill("生成合成报告");
    await page.getByRole("button", { name: "发送任务", exact: true }).click();
    await page.waitForFunction(() => window.fixture.posts === 1);
    await page.getByRole("button", { name: "Chat", exact: true }).click();
    assert.equal(await page.getByLabel("输入 AI 问题").inputValue(), "保留的普通对话草稿");
    await page.getByRole("button", { name: "Agent", exact: true }).click();
    await page.evaluate(() => {
      const f = window.fixture; f.operations[0].status = "succeeded"; f.holdEvents = true;
      f.files = [{ id: "new-file", operationId: "op1", fileName: "本轮报告.xlsx", direction: "output", sizeBytes: 8000, sha256: "a".repeat(64) }, { id: "old-file", operationId: "old-op", fileName: "旧轮报告.xlsx", direction: "output", sizeBytes: 6000, sha256: "b".repeat(64) }];
      f.events = Array.from({length: 100}, (_, i) => ({eventSeq:i+1,operationId:"op1",type:"assistant_message",data:{text:"过程记录 "+i+"："+"合成过程说明".repeat(30)}}));
      f.events.push({eventSeq:101,operationId:"op1",type:"assistant_message",data:{text:"最终中文分析结果已完成，报告可下载。"}});
    });
    await page.locator(".ai-unified-chat > header").getByRole("button", { name: "刷新", exact:true }).click();
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
    if (process.env.PI_KEEP_MODE_HTML) {
      const demoSession = { id: "s1", title: "合成验收 · 经营复盘", status: "idle", epoch: 1, generation: 1, scope: null };
      const seed = `window.fixture.sessions=${JSON.stringify([demoSession])};window.fixture.operations=[{id:'op1',kind:'prompt',status:'succeeded',modelId:'m1'}];window.fixture.events=[{eventSeq:1,operationId:'op1',type:'user_message',data:{text:'请生成一份合成经营复盘，说明数据范围和建议。'}},{eventSeq:2,operationId:'op1',type:'assistant_message',data:{text:'## 本轮已完成\\n\\n已整理合成经营样例，并生成报告附件。\\n\\n- 数据范围：演示样例，未读取正式经营数据。\\n- 来源与口径：按已授权范围查询，缺失信息保留说明。\\n- 后续操作：可继续追问、查看文件，或创建明确的业务动作。\\n\\n实际模型、文件、业务保存和消息投递分别依据服务端回执确认。'}}];window.fixture.files=[{id:'demo-file',operationId:'op1',fileName:'合成经营复盘.xlsx',direction:'output',sizeBytes:3566,sha256:'f'.repeat(64)}];localStorage.setItem('ai-conversation-mode:mode@example.invalid','agent');localStorage.setItem('ai-pi-v1:mode@example.invalid:session','s1');document.addEventListener('click',event=>{const link=event.target.closest('a');if(link?.getAttribute('href')?.startsWith('/api/')){event.preventDefault();alert('合成界面演示不连接正式附件。真实产物请从正式会话下载。')}});`;
      const demo = html.replace(`(${bootstrapFixture.toString()})();`, `(${bootstrapFixture.toString()})();${seed}`)
        .replace('<div id="root"></div>', '<div style="padding:6px 18px;font:12px system-ui;color:#556b5c;background:#eef5f0">开发候选 · 合成界面演示 · 不连接正式服务</div><div id="root"></div>');
      await writeFile(process.env.PI_KEEP_MODE_HTML, demo);
      const review = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      await review.goto(pathToFileURL(process.env.PI_KEEP_MODE_HTML).href);
      await review.locator(".ai-unified-chat > header").getByText(demoSession.title, { exact: true }).waitFor();
      const composer = review.getByLabel("Agent 任务", { exact: true });
      const originalBox = await composer.boundingBox();
      assert.ok(originalBox && originalBox.y + originalBox.height < 1000);
      await review.getByText("技能与上下文", { exact: false }).click();
      assert.ok(Math.abs((await composer.boundingBox()).y - originalBox.y) < 2, "Opening tools must not push the composer out of view");
      await review.getByText("技能与上下文", { exact: false }).click();
      await review.screenshot({ path: `${process.env.PI_KEEP_MODE_HTML}.png`, fullPage: true });
      await review.setViewportSize({ width: 390, height: 844 });
      const narrowBox = await composer.boundingBox();
      assert.ok(narrowBox && narrowBox.x >= 0 && narrowBox.x + narrowBox.width <= 390);
      assert.equal(await review.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await review.close();
    }
  } finally { await browser?.close(); await rm(directory, {recursive:true,force:true}); }
});
