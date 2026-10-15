import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AiChatWorkbench, { type AiWorkbenchProps } from "../app/ai-chat-workbench";
import type { AiExecutionInfo } from "../lib/ai/model-generation";

function renderHistory(selection: Record<string, unknown>, compact = false) {
  const noop = () => {};
  const props: AiWorkbenchProps = {
    compact, currentTitle: "合成历史会话", activeConversationId: "conversation-1",
    conversations: [{ id: "conversation-1", title: "合成历史会话", updatedAt: "2026-10-15T08:00:00Z" }],
    conversationTotal: 1, hasMoreConversations: false, loadingMoreConversations: false,
    messages: [{ id: "message-1", conversationId: "conversation-1", role: "assistant", content: "合成回复",
      messageKind: "message", createdAt: "2026-10-15T08:00:00Z", contentTruncated: false,
      execution: { durationMs: 1234, providerCalls: 1, ...selection } as AiExecutionInfo }],
    hasOlderMessages: false, loadingOlderMessages: false, models: [], selectedModelId: "", canChat: true,
    busy: false, sending: false, loading: false, recoveryBlocked: false, draft: "", error: "", notice: "",
    context: null, contextError: "", liveAnswer: null,
    onDraft: noop, onSend: noop, onStop: noop, onNew: noop, onOpen: noop, onDelete: noop, onModel: noop,
    onExpand: noop, onMore: noop, onOlder: noop, onRefresh: noop, onRemoveContext: noop, renderArtifacts: () => null,
  };
  return renderToStaticMarkup(createElement(AiChatWorkbench, props));
}

test("restoring scheduled or older execution metadata keeps both chat layouts usable", () => {
  for (const compact of [false, true]) {
    for (const selection of [
      {}, { guidance: {}, skills: {} }, { guidance: null, skills: null },
      { guidance: { version: 1 }, skills: { version: 1 } },
      { guidance: { version: 1, rules: null }, skills: { version: 1, skills: "invalid" } },
      { guidance: { version: 1, rules: [null] }, skills: { version: 1, skills: [{}] } },
    ]) {
      const html = renderHistory(selection, compact);
      assert.match(html, /AI 对话工作台/);
      assert.match(html, /输入 AI 问题/);
      assert.match(html, /1\.2 秒/);
      assert.match(html, /配置版本<\/dt><dd>未记录/);
      assert.match(html, /本次技能<\/dt><dd>未记录/);
      assert.doesNotMatch(html, /vundefined|通用口径|未匹配技能/);
    }
  }
});

test("valid execution selections retain their versions and names", () => {
  const html = renderHistory({
    guidance: { version: 2, digest: "synthetic", rules: [{ id: "rule", name: "库存口径", source: "test" }] },
    skills: { version: 3, digest: "synthetic", skills: [{ id: "skill", name: "库存分析" }] },
  });
  assert.match(html, /配置版本<\/dt><dd>v2/);
  assert.match(html, /库存口径/);
  assert.match(html, /v3/);
  assert.match(html, /库存分析/);
});

test("explicit default and empty selections remain distinct from missing evidence", () => {
  const html = renderHistory({ guidance: { version: 0, rules: [] }, skills: { version: 0, skills: [] } });
  assert.match(html, /系统默认/);
  assert.match(html, /通用口径/);
  assert.match(html, /未匹配技能/);
  assert.doesNotMatch(html, /配置版本<\/dt><dd>未记录/);
});
