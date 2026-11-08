import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createElement } from "react";
import AiPiSkillDistillation from "../app/ai-pi-skill-distillation";
import AiDistilledMethodPublication from "../app/ai-distilled-method-publication";

// Install the matching renderer in an ignored, isolated directory. It resolves
// this worktree's existing React; no browser or production dependency changes.
// npm install --prefix .runtime/skill-ui-harness --no-save --package-lock=false --ignore-scripts --legacy-peer-deps react-test-renderer@19.2.6
const require = createRequire(import.meta.url);
type Node = { type: string; props: Record<string, unknown>; children: (Node | string)[] };
type Root = { root: { findAllByType(type: string): Node[] }; toJSON(): Node; unmount(): void };
const rendererPath = fileURLToPath(new URL("../.runtime/skill-ui-harness/node_modules/react-test-renderer", import.meta.url));
const renderer = existsSync(rendererPath) ? require(rendererPath) as { create(element: unknown): Root; act(callback: () => unknown): Promise<void> } : null;
const create = (element: unknown) => { if (!renderer) throw Error("Install isolated react-test-renderer as documented above"); return renderer.create(element); };
const act = (callback: () => unknown) => renderer!.act(callback);
const options = { skip: !renderer && "isolated react-test-renderer is not installed", timeout: 10_000 };
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const oldVersion = "a".repeat(64), newVersion = "b".repeat(64), storageKey = "fixture:distill:op";
function content() { return { goal: "goal", body: "method", parameters: [{ name: "shop", kind: "shop", required: true, meaning: "one shop", defaultRule: "ask" }], steps: [{ order: 1, action: "read", toolName: "tool", missingDataBranch: "stop" }], requiredTools: ["tool"], templateRefs: [] as string[], sourceEvidenceRefs: [] as string[], unverifiedRecommendations: ["unverified"], openQuestions: [] as string[] }; }
function candidate(body: unknown = content()) { return { id: "candidate", status: "draft", version: 7, contentDigest: "c".repeat(64), reportVersionDigest: newVersion, content: body, unverifiedRecommendations: 1 }; }
function text(node: Node | string | null): string { return typeof node === "string" ? node : node?.children?.map(text).join("") ?? ""; }
const button = (root: Root, name: string) => { const found = root.root.findAllByType("button").find(item => text(item) === name); assert.ok(found, `button ${name}`); return found; };
const click = async (node: Node) => { assert.notEqual(node.props.disabled, true); await act(async () => { (node.props.onClick as () => void)(); }); };
function harness() {
  const storage = new Map<string, string>();
  const state = { version: oldVersion, receipt: null as null | { clientRequestId: string; status: string; errorCode: string | null }, candidate: null as null | ReturnType<typeof candidate>, writes: [] as Record<string, unknown>[], failBeforeDispatch: false, competingCandidate: false, withdrawRacesWithSend: false };
  globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, value); }, removeItem: key => { storage.delete(key); }, clear: () => storage.clear(), key: () => null, get length() { return storage.size; } };
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input), "https://isolated.invalid");
    if (init.method === "POST") {
      const body = JSON.parse(String(init.body)); state.writes.push(body);
      if (url.pathname.endsWith("/review")) { state.candidate = { ...state.candidate!, status: body.status, version: state.candidate!.version + 1 }; return Response.json({ item: state.candidate }); }
      if (body.withdrawAuthorization) {
        if (state.withdrawRacesWithSend) { state.receipt = { clientRequestId: body.clientRequestId, status: "sent", errorCode: null }; return Response.json({ error: "already sent" }, { status: 409 }); }
        state.receipt = { clientRequestId: body.clientRequestId, status: "completed", errorCode: "distillation_authorization_withdrawn" }; return Response.json({ withdrawn: true });
      }
      if (state.failBeforeDispatch) { state.failBeforeDispatch = false; state.version = newVersion; return Response.json({ error: "report changed before dispatch" }, { status: 409 }); }
      if (state.competingCandidate) { state.competingCandidate = false; state.candidate = candidate(); return Response.json({ error: "another active candidate" }, { status: 409 }); }
      state.receipt = { clientRequestId: body.clientRequestId, status: "completed", errorCode: null }; state.candidate = candidate(); return Response.json({ item: state.candidate });
    }
    return Response.json({ reportVersionDigest: state.version, reportVersion: { operationId: "op", modelId: "model", modelVersion: 3 }, confirmedFeedbackIds: [], citableExportIds: [], citableFileIds: [], coverage: { sourcesComplete: false, truncated: {} }, distillation: { blocked: !!state.receipt && ["sent", "unknown"].includes(state.receipt.status), latest: state.receipt, requested: state.receipt?.clientRequestId === url.searchParams.get("distillationRequestId") ? state.receipt : null, candidate: state.candidate } });
  };
  async function mount() {
    let root!: Root;
    await act(async () => { root = create(createElement(AiPiSkillDistillation, { operations: [{ id: "op", status: "succeeded", modelId: "model" }], ownerKey: "fixture", writable: true, models: [{ id: "model", name: "model", modelName: "model" }] })); });
    await click(button(root, "提炼为 Skill 草稿 / 查看候选"));
    return root;
  }
  return { state, storage, mount };
}

test("real component recovers a pre-admission report conflict only after withdrawing the exact old authorization and reconsenting", options, async () => {
  const fixture = harness(); fixture.state.failBeforeDispatch = true;
  const root = await fixture.mount();
  try {
    const authorize = async () => { const checkbox = root.root.findAllByType("input").find(item => item.props.type === "checkbox")!; assert.equal(checkbox.props.disabled, false); await act(async () => { (checkbox.props.onChange as (event: unknown) => void)({ target: { checked: true } }); }); };
    await authorize(); await click(button(root, "提炼 Skill 草稿"));
    const original = fixture.state.writes[0]; assert.equal(original.reportVersionDigest, oldVersion);
    assert.match(text(root.toJSON()), /报告版本已变化/);
    assert.equal(fixture.state.receipt, null);
    assert.equal(root.root.findAllByType("input")[0].props.disabled, true);
    assert.equal(root.root.findAllByType("button").some(item => text(item) === "继续原请求 / 取回结果"), false);
    await click(button(root, "撤回未派发授权，重新确认"));
    assert.deepEqual(fixture.state.writes[1], { ...original, withdrawAuthorization: true });
    assert.equal(fixture.storage.has(storageKey), false);
    assert.equal(root.root.findAllByType("input")[0].props.checked, false);
    assert.equal(button(root, "重新提炼草稿").props.disabled, true);
    await authorize(); await click(button(root, "重新提炼草稿"));
    assert.equal(fixture.state.writes[2].reportVersionDigest, newVersion);
    assert.notEqual(fixture.state.writes[2].clientRequestId, original.clientRequestId);
    assert.match(text(root.toJSON()), /候选正文与审核/);
  } finally { await act(() => root.unmount()); }
});

test("real component restores disconnected pending authorization and preserves it if withdrawal loses the race to dispatch", options, async () => {
  const fixture = harness(); fixture.state.version = newVersion; fixture.state.withdrawRacesWithSend = true;
  const original = { clientRequestId: "disconnected", reportVersionDigest: oldVersion }; fixture.storage.set(storageKey, JSON.stringify(original));
  const root = await fixture.mount();
  try {
    assert.equal(fixture.state.writes.length, 0);
    await click(button(root, "撤回未派发授权，重新确认"));
    assert.equal(fixture.storage.get(storageKey), JSON.stringify(original));
    assert.equal(fixture.state.receipt!.status, "sent");
    assert.equal(root.root.findAllByType("input")[0].props.disabled, true);
    assert.equal(root.root.findAllByType("button").some(item => text(item) === "撤回未派发授权，重新确认"), false);
    assert.equal(fixture.state.writes.length, 1);
  } finally { await act(() => root.unmount()); }
});

test("real component can retire a rejected competing intent and recover after rejecting the other candidate", options, async () => {
  const fixture = harness(); fixture.state.competingCandidate = true;
  const root = await fixture.mount();
  try {
    await act(async () => { (root.root.findAllByType("input")[0].props.onChange as (event: unknown) => void)({ target: { checked: true } }); });
    await click(button(root, "提炼 Skill 草稿"));
    assert.ok(fixture.storage.has(storageKey));
    await click(button(root, "撤回未派发授权，重新确认"));
    assert.equal(fixture.storage.has(storageKey), false);
    await click(button(root, "退回候选"));
    assert.equal(root.root.findAllByType("input")[0].props.checked, false);
    assert.equal(root.root.findAllByType("input")[0].props.disabled, false);
    assert.equal(button(root, "重新提炼草稿").props.disabled, true);
  } finally { await act(() => root.unmount()); }
});

test("real component renders malformed stored candidates safely, refuses approval, and can reject the exact stored version", options, async () => {
  for (const malformed of [null, { ...content(), parameters: null }, { ...content(), steps: [null] }, { ...content(), requiredTools: {} }, { ...content(), templateRefs: "bad" }, { ...content(), sourceEvidenceRefs: [null] }, { ...content(), unverifiedRecommendations: [null] }, { ...content(), goal: {} }, { ...content(), body: {} }, { ...content(), parameters: [{ ...content().parameters[0], kind: ["shop"] }] }]) {
    const fixture = harness(); fixture.state.version = newVersion; fixture.state.candidate = candidate(malformed);
    const root = await fixture.mount();
    try {
      assert.match(text(root.toJSON()), /候选正文格式异常/);
      assert.equal(button(root, "批准此版本").props.disabled, true);
      assert.equal(button(root, "标记审核中").props.disabled, true);
      // Even a direct handler invocation cannot approve a hidden malformed field.
      await act(async () => { (button(root, "批准此版本").props.onClick as () => void)(); });
      assert.equal(fixture.state.writes.length, 0);
      await click(button(root, "退回候选"));
      assert.deepEqual(fixture.state.writes[0], { status: "rejected", expectedVersion: 7, contentDigest: "c".repeat(64), note: "" });
      assert.match(text(root.toJSON()), /已退回/);
    } finally { await act(() => root.unmount()); }
  }
});

test("real component uses Unicode code points for every schema string boundary and approves the exact-limit candidate", options, async () => {
  const boundaries: [string, number, (value: ReturnType<typeof content>, text: string) => void][] = [
    ["goal", 240, (value, text) => { value.goal = text; }],
    ["body", 2000, (value, text) => { value.body = text; }],
    ["parameter name", 40, (value, text) => { value.parameters[0].name = text; }],
    ["parameter meaning", 200, (value, text) => { value.parameters[0].meaning = text; }],
    ["parameter default rule", 200, (value, text) => { value.parameters[0].defaultRule = text; }],
    ["step action", 300, (value, text) => { value.steps[0].action = text; }],
    ["step tool", 80, (value, text) => { value.steps[0].toolName = text; }],
    ["step missing data", 200, (value, text) => { value.steps[0].missingDataBranch = text; }],
    ["required tool", 80, (value, text) => { value.requiredTools = [text]; }],
    ["template reference", 64, (value, text) => { value.templateRefs = [text]; }],
    ["source reference", 120, (value, text) => { value.sourceEvidenceRefs = [text]; }],
    ["unverified recommendation", 300, (value, text) => { value.unverifiedRecommendations = [text]; }],
    ["open question", 200, (value, text) => { value.openQuestions = [text]; }],
  ];
  const exact = content();
  for (const [, maximum, set] of boundaries) set(exact, "甲".repeat(maximum - 1) + "📊");
  assert.equal(exact.body.length, 2001);
  assert.equal(Array.from(exact.body).length, 2000);
  const fixture = harness(); fixture.state.version = newVersion; fixture.state.candidate = candidate(exact);
  const root = await fixture.mount();
  try {
    assert.doesNotMatch(text(root.toJSON()), /候选正文格式异常/);
    assert.equal(button(root, "批准此版本").props.disabled, false);
    await click(button(root, "批准此版本"));
    assert.deepEqual(fixture.state.writes[0], { status: "approved", expectedVersion: 7, contentDigest: "c".repeat(64), note: "" });
    assert.match(text(root.toJSON()), /已批准/);
  } finally { await act(() => root.unmount()); }
  for (const [name, maximum, set] of boundaries) {
    const oversized = content(); set(oversized, "甲".repeat(maximum) + "📊");
    const fixture = harness(); fixture.state.candidate = candidate(oversized);
    const root = await fixture.mount();
    try {
      assert.match(text(root.toJSON()), /候选正文格式异常/, name);
      assert.equal(button(root, "批准此版本").props.disabled, true, name);
      await act(async () => { (button(root, "批准此版本").props.onClick as () => void)(); });
      assert.equal(fixture.state.writes.length, 0, name);
      assert.equal(button(root, "退回候选").props.disabled, false, name);
    } finally { await act(() => root.unmount()); }
  }
});

test("approval cannot silently use a different report version", options, async () => {
  const fixture = harness(); fixture.state.candidate = candidate();
  const root = await fixture.mount();
  try {
    assert.match(text(root.toJSON()), /报告依据已有更新/);
    assert.equal(button(root, "批准此版本").props.disabled, true);
    await act(async () => { (button(root, "批准此版本").props.onClick as () => void)(); });
    assert.equal(fixture.state.writes.length, 0);
    await click(button(root, "退回候选"));
    assert.equal(fixture.state.writes[0].status, "rejected");
  } finally { await act(() => root.unmount()); }
});

test("publisher binds the approved candidate and library versions, recovers a lost reply by reading the exact candidate", options, async () => {
  const chosen = {
    id: "candidate", operationId: "synthetic-op", version: 7, contentDigest: "c".repeat(64), reportVersionDigest: newVersion,
    reviewedBy: "owner@example.invalid", reviewedAt: null, reviewNote: "synthetic review", unverifiedRecommendations: 1,
    method: { name: "合成方法", description: "合成目的", body: "按日期核对完整性。" },
    publication: { state: "unpublished", skillId: "candidate-method", libraryVersion: 4, publishedLibraryVersion: null as number | null },
  };
  const reads: string[] = [];
  const writes: unknown[] = [];
  let finish!: () => void;
  let changes = 0;
  let loseRead = false;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input), "https://isolated.invalid");
    if (init.method === "POST") {
      assert.equal(url.pathname, "/api/ai/pi/skill-candidates/candidate/publish");
      writes.push(JSON.parse(String(init.body)));
      await new Promise<void>(resolve => { finish = resolve; });
      chosen.publication = { ...chosen.publication, state: "enabled", libraryVersion: 5, publishedLibraryVersion: 5 };
      throw Error("connection lost after commit");
    }
    reads.push(url.search);
    if (loseRead) { loseRead = false; return Response.json({ error: "unavailable" }, { status: 503 }); }
    return Response.json({ items: [chosen], domains: { netshop: "网店" }, hasMore: false });
  };
  let root!: Root;
  await act(async () => { root = create(createElement(AiDistilledMethodPublication, { onLibraryChange: () => { changes++; } })); });
  try {
    await click(button(root, "查看已批准候选"));
    await click(button(root, "查看候选与发布记录"));
    assert.deepEqual(reads, ["?publicationPage=1", "?publicationId=candidate"]);
    assert.match(text(root.toJSON()), /按日期核对完整性/);
    const submit = () => (root.root.findAllByType("form")[0].props.onSubmit as (event: unknown) => void)({ preventDefault() {} });
    await act(async () => { submit(); });
    assert.equal(writes.length, 0);
    const change = (node: Node, target: unknown) => act(async () => { (node.props.onChange as (event: unknown) => void)({ target }); });
    await change(root.root.findAllByType("input")[0], { checked: true });
    await change(root.root.findAllByType("textarea")[0], { value: "合成触发" });
    assert.equal(button(root, "发布为文字方法（基于 v4）").props.disabled, true);
    await change(root.root.findAllByType("input")[1], { checked: true });
    await act(async () => { submit(); submit(); });
    assert.match(text(root.toJSON()), /正在提交此候选/);
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0], { expectedVersion: 7, contentDigest: chosen.contentDigest,
      expectedLibraryVersion: 4, domains: ["netshop"], keywords: ["合成触发"] });
    loseRead = true;
    await act(async () => { finish(); });
    assert.match(text(root.toJSON()), /发布状态待核实/);
    assert.equal(button(root, "发布为文字方法（基于 v4）").props.disabled, true);
    assert.equal(changes, 0);
    await click(button(root, "刷新原候选"));
    assert.equal(reads.at(-1), "?publicationId=candidate");
    assert.match(text(root.toJSON()), /已发布 · 已启用.*发布版本 v5/);
    assert.equal(root.root.findAllByType("form").length, 0);
    assert.equal(writes.length, 1);
    assert.equal(changes, 1);
  } finally { await act(() => root.unmount()); }
});
