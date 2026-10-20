import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";

function fixture() {
  const initial = { posts: [], childControls: [], next: 1, childStatus: "idle" };
  const f = window.fixture = JSON.parse(sessionStorage.getItem("capability-server") || "null") || initial;
  f.calls = [];
  localStorage.setItem("ai-pi-v1:capabilities@example.invalid:session", "root-session");
  const native = () => ({ rootSessionId: "root-session", mode: "execute", transitionStatus: "stable", modeRevision: 1, admissionEpoch: 1, treeVersion: 2, planRevision: 0,
    thinking: { supported: ["off"], requested: "off", effective: "off" },
    agents: [{ id: "root-session", sessionId: "root-session", title: "合成主任务", status: "running", activeOperationId: "root-op" },
      { id: "child-session", sessionId: "child-session", parentSessionId: "root-session", title: "合成子任务", status: f.childStatus, activeOperationId: f.childStatus === "running" ? "child-op" : null }] });
  const session = id => ({ id, title: id === "root-session" ? "合成主任务" : "合成子任务", status: id === "root-session" ? "running" : "idle", epoch: 1, generation: f.generation ?? 1, scope: null, updatedAt: "2026-10-20T12:00:00Z" });
  window.fetch = async (input, init = {}) => {
    const url = String(input), method = init.method || "GET", body = init.body ? JSON.parse(init.body) : null;
    f.calls.push({ url, method });
    if (method === "POST") {
      f.posts.push(body);
      const control = { id: `control-${f.next++}`, controlSeq: f.next, command: body.command, clientRequestId: body.clientRequestId, status: "completed", result: {} };
      if (body.payload.targetAgentId) {
        const pending = JSON.parse(localStorage.getItem("ai-pi-v1:capabilities@example.invalid:workspace:root-session:1:1"));
        if (!pending.some(item => item.clientRequestId === body.clientRequestId && item.targetSessionId === "child-session")) throw Error("Target identity was not durable before dispatch");
        f.childControls.push(control);
        sessionStorage.setItem("capability-server", JSON.stringify(f));
        f.freezeChildReads = true;
        throw Error("Target accepted; POST response lost");
      }
      sessionStorage.setItem("capability-server", JSON.stringify(f));
      return Response.json({ control, workspace: { status: "ready", state: {} } });
    }
    if (url.endsWith("/skills")) return Response.json({ items: [], models: [{ id: "m1", name: "模型一", modelName: "fixture-1", isDefault: true }, { id: "m2", name: "模型二", modelName: "fixture-2", supportedThinkingLevels: ["off", "high", "max"] }] });
    if (/\/sessions\?/.test(url)) return Response.json({ items: [session("root-session"), session("child-session")] });
    if (url.includes("business-actions")) return Response.json({ items: [] });
    if (url.includes("/events?")) return Response.json({ items: [], hasMore: false });
    if (url.includes("/workspace")) {
      const child = url.includes("child-session");
      if (child && f.freezeChildReads) return new Promise(() => {});
      const controls = child ? f.childControls : [{ id: "research-1", clientRequestId: "research-original", controlSeq: 1, command: "research_read", status: "completed", result: {
        resultOmitted: true, originalBytes: 5000, sources: [{ title: "已核原来源", url: "https://example.com/reference", fetchedAt: "2026-10-20T00:00:00Z" }],
      } }];
      return Response.json({ native: native(), controls, workspace: { status: "ready", initialized: true, state: { terminals: [] } } });
    }
    if (url.endsWith("/sessions/root-session")) return Response.json({ session: session("root-session"), files: [], operations: [{ id: "root-op", status: "running", kind: "message", modelId: "m1", skills: [{ id: "skill-a" }, { id: "skill-b" }], businessIntents: [{ actionId: "original-workplan", actionType: "create_work_plan" }] }] });
    if (url.endsWith("/sessions/child-session")) return Response.json({ session: session("child-session"), operations: [{ id: "child-op", kind: "message", status: "succeeded", modelId: "m1" }], files: [{ id: "child-file", operationId: "child-op", direction: "output", fileName: "合成子代理报告.pdf", sizeBytes: 100, sha256: "f".repeat(64) }] });
    throw Error("Unexpected synthetic URL " + url);
  };
}

test("child target hooks restore lost receipts by original child GET and expose spawn overrides, results and research sources", { timeout: 60000 }, async () => {
  const directory = await mkdtemp(path.join(process.cwd(), ".codex-tmp-pi-capabilities-"));
  let browser;
  try {
    const bundle = await build({ nodePaths: (process.env.PI_TEST_NODE_MODULES || "").split(path.delimiter).filter(Boolean), stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import Agent from './app/ai-pi-agent-view';createRoot(document.getElementById('root')).render(<Agent currentUser={{email:'capabilities@example.invalid',role:'operator',displayName:'合成验收',roleLabel:'操作员'}} embedded/>);`, loader: "tsx", resolveDir: process.cwd() }, write: false, bundle: true, platform: "browser", format: "iife", define: { "process.env.NODE_ENV": '"production"' } });
    const css = (await Promise.all(["app/ai-chat-workbench.css", "app/ai-pi-agent.css"].map(file => readFile(file, "utf8")))).join("\n");
    await writeFile(path.join(directory, "index.html"), `<!doctype html><meta charset="utf-8"><style>:root{--color-border-default:#ddd}#root{height:900px;display:flex}${css}</style><div id="root"></div><script>(${fixture.toString()})();${bundle.outputFiles[0].text}</script>`);
    browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(pathToFileURL(path.join(directory, "index.html")).href);
    await page.getByRole("button", { name: "会话与运行", exact: true }).click();
    await page.getByText("协作代理 · 1 个子代理", { exact: true }).click();
    await page.getByLabel("消息目标").selectOption("child-session");
    await page.getByLabel("Agent 任务").fill("子代理空闲时续聊");
    await page.getByRole("button", { name: "发送任务", exact: true }).click();
    await page.waitForFunction(() => window.fixture.posts.length === 1);
    assert.equal(await page.evaluate(() => window.fixture.posts[0].command), "agent_follow_up");
    await page.evaluate(() => { window.fixture.childStatus = "running"; sessionStorage.setItem("capability-server", JSON.stringify(window.fixture)); });
    await page.getByRole("button", { name: "重新连接", exact: true }).click();
    await page.getByRole("option", { name: "合成子任务 · 执行中", exact: true }).waitFor({ state: "attached" });
    await page.getByLabel("Agent 任务").fill("对子代理插话并模拟丢响应");
    await page.getByRole("button", { name: "发送任务", exact: true }).click();
    await page.waitForFunction(() => window.fixture.posts.length === 2);
    assert.equal(await page.evaluate(() => window.fixture.posts[1].command), "steer");
    await page.reload();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("ai-pi-v1:capabilities@example.invalid:workspace:root-session:1:1") || "[1]").length === 0);
    assert.equal(await page.evaluate(() => window.fixture.posts.length), 2);
    assert.ok(await page.evaluate(() => window.fixture.calls.some(call => call.method === "GET" && call.url.includes("child-session/workspace"))));
    await page.getByRole("button", { name: "会话与运行", exact: true }).click();
    await page.getByText("公开联网研究", { exact: true }).click();
    await page.getByRole("link", { name: "已核原来源", exact: true }).waitFor();
    await page.getByRole("status").filter({ hasText: "未恢复全文" }).waitFor();
    assert.equal(await page.evaluate(() => window.fixture.posts.filter(p => p.command.startsWith("research_")).length), 0);
    await page.getByText("协作代理 · 1 个子代理", { exact: true }).click();
    await page.getByText("创建子代理", { exact: true }).click();
    await page.getByLabel("子代理任务", { exact: true }).fill("合成明确子任务");
    await page.getByLabel("子代理标题", { exact: true }).fill("显式标题");
    await page.getByLabel("子代理模型", { exact: true }).selectOption("m2");
    await page.getByLabel("子代理思考档", { exact: true }).selectOption("high");
    await page.getByLabel("明确选择父级技能子集").check();
    await page.getByLabel("skill-a", { exact: true }).check();
    await page.getByRole("checkbox", { name: "create_work_plan · original-workplan", exact: true }).check();
    await page.getByRole("button", { name: "创建独立子代理", exact: true }).click();
    const spawn = await page.evaluate(() => window.fixture.posts.find(p => p.command === "agent_spawn"));
    assert.deepEqual({ title: spawn.payload.title, modelId: spawn.payload.modelId, thinkingLevel: spawn.payload.thinkingLevel, skills: spawn.payload.skills, businessActionIds: spawn.payload.businessActionIds }, { title: "显式标题", modelId: "m2", thinkingLevel: "high", skills: ["skill-a"], businessActionIds: ["original-workplan"] });
    await page.getByLabel("消息目标").selectOption("child-session");
    await page.getByRole("button", { name: "打开子代理会话与产物", exact: true }).click();
    await page.getByRole("link", { name: "合成子代理报告.pdf" }).first().waitFor();
    await page.getByText("环境与依赖", { exact: true }).click();
    await page.getByRole("button", { name: "暂停整个环境", exact: true }).click();
    await page.getByRole("dialog", { name: "环境操作确认" }).waitFor();
    await page.evaluate(() => { window.fixture.generation = 2; });
    await page.getByRole("button", { name: "刷新记录", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".ai-pi-conversation-meta")?.textContent.includes("1 / 2"));
    assert.equal(await page.getByRole("dialog", { name: "环境操作确认" }).count(), 0);
    assert.equal(await page.evaluate(() => window.fixture.posts.filter(post => post.command === "pause").length), 0);
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await rm(directory, { recursive: true, force: true }); }
});
