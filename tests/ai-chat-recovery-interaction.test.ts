import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as wait } from "node:timers/promises";
import { build } from "esbuild";
import type { AiWorkbenchProps } from "../app/ai-chat-workbench";

type Node = { type: unknown; props: { children?: unknown[] } };
type Ref = { current: unknown };
type HooksState = { values: unknown[]; refs: Ref[]; stateIndex: number; refIndex: number; effects: Array<() => unknown> };
type Post = { clientRequestId: string; message: string; conversationId?: string };
type Reply = "provider_timeout" | "provider_unavailable" | "ai_chat_result_unknown" | "lost-response" | "stop";

const workbench = (tree: Node) => tree.props.children?.find(
  (node): node is { type: "Workbench"; props: AiWorkbenchProps } =>
    Boolean(node && typeof node === "object" && "type" in node && node.type === "Workbench"),
)?.props;

test("real chat handlers keep unknown requests fenced across edit, model change and history", async t => {
  let active: HooksState;
  // Only React scheduling and leaf UI are faked. The tested handlers, recovery
  // fetches and SSE decoder are all the actual application's implementation.
  const hooks = {
    useState(initial: unknown) {
      const current = active;
      const index = current.stateIndex++;
      if (!(index in current.values)) current.values[index] = typeof initial === "function" ? initial() : initial;
      return [current.values[index], (value: unknown) => {
        current.values[index] = typeof value === "function" ? value(current.values[index]) : value;
      }];
    },
    useRef(initial: unknown) { return active.refs[active.refIndex++] ??= { current: initial }; },
    useEffect(effect: () => unknown) { active.effects.push(effect); },
    useCallback(fn: unknown) { return fn; },
  };
  const globals = globalThis as unknown as Record<string, unknown>;
  const saved = Object.fromEntries(["__chatRecoveryHooks", "window", "sessionStorage", "fetch"].map(
    key => [key, Object.getOwnPropertyDescriptor(globalThis, key)],
  ));
  globals.__chatRecoveryHooks = hooks;
  globals.window = { setTimeout, clearTimeout };
  t.after(() => {
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globals[key];
    }
  });

  const compiled = await build({
    entryPoints: ["app/ai-assistant-view.tsx"], bundle: true, write: false,
    platform: "node", format: "esm", jsx: "automatic", jsxImportSource: "fixture-chat",
    plugins: [{ name: "chat-recovery-leaves", setup(builder) {
      builder.onResolve({ filter: /^(react|fixture-chat\/jsx-runtime)$/ },
        args => ({ path: args.path, namespace: "fixture" }));
      builder.onResolve({ filter: /^\.\/(ui\/searchable-select|ai-chat-workbench|ai-model-generation-fields)$/ },
        args => ({ path: args.path, namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({
        loader: "js",
        contents: args.path === "react" ? "export const {useState,useRef,useEffect,useCallback}=globalThis.__chatRecoveryHooks;"
          : args.path === "fixture-chat/jsx-runtime" ? "export const jsx=(type,props)=>({type,props}); export const jsxs=jsx; export const Fragment=Symbol.for('fragment');"
          : args.path.includes("searchable-select") ? 'export const SearchableSelect="Select";'
          : args.path.includes("workbench") ? 'export default "Workbench";' : 'export default "Generation";',
      }));
    } }],
  });
  const { default: View } = await import(
    `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`
  ) as { default: (props: object) => Node };
  const email = "chat-recovery@example.invalid";
  const recoveryKey = `teruisi.ai.pending.v1:${email}:sales`;

  async function scenario(reply: Reply) {
    active = { values: [], refs: [], stateIndex: 0, refIndex: 0, effects: [] };
    const storage = new Map<string, string>();
    const posts: Post[] = [];
    const stopIds: string[] = [];
    const statusReads: string[] = [];
    const activations: string[] = [];
    const modelChanges: string[] = [];
    let answer = reply;
    let status: object = { status: "unknown", dispatchState: "unconfirmed", conversationId: "original" };
    globals.sessionStorage = {
      setItem: (key: string, value: string) => storage.set(key, value),
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => storage.delete(key),
    };
    globalThis.fetch = async (input, options) => {
      const url = new URL(String(input), "https://fixture.invalid");
      if (url.pathname === "/api/ai/chat" && options?.method === "POST") {
        posts.push(JSON.parse(String(options.body)));
        if (answer === "lost-response") throw new TypeError("fixture lost the connection after submitting");
        if (answer === "stop") return await new Promise<Response>((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
        });
        return new Response(`id: 1\nevent: failure\ndata: ${JSON.stringify({ code: answer, error: "synthetic failure" })}\n\n`,
          { headers: { "content-type": "text/event-stream" } });
      }
      if (url.pathname === "/api/ai/chat/cancel") {
        const body = JSON.parse(String(options?.body));
        stopIds.push(body.clientRequestId);
        assert.equal(body.workspaceModule, "sales");
        return Response.json({ ok: true, request: { ...status, status: "stopping", cancelRequested: true } });
      }
      if (url.pathname === "/api/ai/conversations" && options?.method === "PATCH") {
        const body = JSON.parse(String(options.body));
        if (body.action === "activate") activations.push(body.conversationId);
        else modelChanges.push(body.modelId);
        return Response.json({ ok: true });
      }
      if (url.pathname === "/api/ai/conversations") {
        return Response.json({ items: [{ id: "original" }, { id: "historical" }], models: [] });
      }
      if (url.pathname === "/api/ai/chat" && url.searchParams.has("clientRequestId")) {
        assert.equal(url.searchParams.get("workspaceModule"), "sales");
        statusReads.push(url.searchParams.get("clientRequestId")!);
        return Response.json({ request: status });
      }
      const conversationId = url.searchParams.get("conversationId");
      if (url.pathname === "/api/ai/chat" && conversationId) {
        return Response.json({ conversation: { id: conversationId },
          items: url.searchParams.has("messageId") ? [{ id: "saved-reply", conversationId }] : [] });
      }
      throw new Error(`Unexpected fixture route ${url.pathname}`);
    };
    const render = () => {
      active.stateIndex = active.refIndex = 0;
      active.effects = [];
      return workbench(View({ currentUser: { email, displayName: "fixture", role: "analyst", roleLabel: "analyst" }, workspaceModule: "sales" }));
    };
    render();
    for (const effect of active.effects) effect();
    const until = async (predicate: (ui: AiWorkbenchProps) => boolean) => {
      for (let i = 0; i < 100; i++) {
        const ui = render();
        if (ui && predicate(ui)) return ui;
        await wait(2);
      }
      throw new Error("Chat fixture did not reach the expected state");
    };
    const ready = await until(ui => !ui.busy);
    ready.onDraft("原问题");
    render()!.onSend();
    if (reply === "stop") {
      assert.equal(posts.length, 1);
      render()!.onStop();
    }
    const blocked = await until(ui => !ui.busy);
    return { blocked, storage, posts, stopIds, statusReads, activations, modelChanges, until,
      render: () => render()!, setStatus: (next: object) => { status = next; },
      setAnswer: (next: Reply) => { answer = next; } };
  }

  for (const reply of ["provider_timeout", "provider_unavailable", "lost-response", "ai_chat_result_unknown", "stop"] as const) {
    await t.test(reply, async () => {
      const s = await scenario(reply);
      assert.equal(s.posts.length, 1);
      assert.equal(s.blocked.recoveryBlocked, true);
      const originalId = s.posts[0].clientRequestId;
      assert.deepEqual(s.stopIds, reply === "stop" ? [originalId] : []);
      assert.equal(s.storage.get(recoveryKey), originalId);
      s.blocked.onDraft("原问题？");
      s.render().onSend();
      s.render().onModel("another-model");
      assert.equal(s.posts.length, 1);
      assert.deepEqual(s.modelChanges, []);

      s.render().onOpen("historical");
      const historical = await s.until(ui => !ui.busy && ui.activeConversationId === "historical");
      assert.deepEqual(s.activations, ["historical"]);
      assert.equal(historical.draft, "");
      assert.equal(historical.recoveryBlocked, true);
      assert.equal(s.storage.get(recoveryKey), originalId);
      historical.onDraft("在既有会话重发");
      s.render().onSend();
      assert.equal(s.posts.length, 1);
      s.render().onRefresh();
      const refreshed = await s.until(ui => !ui.busy);
      assert.equal(refreshed.recoveryBlocked, true);
      assert.deepEqual(s.statusReads, [originalId]);
      assert.equal(s.storage.get(recoveryKey), originalId);

      refreshed.onNew();
      const fresh = s.render();
      assert.equal(fresh.recoveryBlocked, false);
      assert.equal(fresh.activeConversationId, "");
      assert.equal(fresh.draft, "");
      fresh.onSend();
      assert.equal(s.posts.length, 1);
      s.setAnswer("ai_chat_result_unknown");
      fresh.onDraft("独立新问题");
      s.render().onSend();
      await s.until(ui => !ui.busy);
      assert.equal(s.posts.length, 2);
      assert.equal(s.posts[1].message, "独立新问题");
      assert.equal(s.posts[1].conversationId, undefined);
      assert.notEqual(s.posts[1].clientRequestId, originalId);
    });
  }

  await t.test("only proven non-dispatch or the exact saved reply unlocks recovery", async () => {
    const s = await scenario("lost-response");
    s.setStatus({ status: "failed" });
    s.blocked.onRefresh();
    assert.equal((await s.until(ui => !ui.busy)).recoveryBlocked, true);
    s.setStatus({ status: "failed", dispatchState: "not_sent" });
    s.render().onRefresh();
    assert.equal((await s.until(ui => !ui.busy)).recoveryBlocked, false);
    assert.equal(s.posts.length, 1);

    const complete = await scenario("lost-response");
    complete.setStatus({ status: "succeeded", conversationId: "original", assistantMessageId: "saved-reply" });
    complete.blocked.onRefresh();
    const recovered = await complete.until(ui => !ui.busy);
    assert.equal(recovered.recoveryBlocked, false);
    assert.equal(recovered.draft, "");
    assert.equal(complete.posts.length, 1);
  });
});
