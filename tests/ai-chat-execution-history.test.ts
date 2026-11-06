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

// execution_json is capped at 16384 bytes by ai_execution_bound
// (backend/ai_assistant/migrations/0009_model_generation_capabilities.py:10).
// prompt_settings.fit_evidence() gives up each rule's unread "source" first, and
// only drops whole rules -- recording rulesOmitted -- if that is not enough. The
// names are rendered to the user, so a shortened list must say it is shortened.
test("a citation list shortened to fit the byte CHECK is labelled as partial", () => {
  const rules = [{ id: "kept-1", name: "净销售额口径" }, { id: "kept-2", name: "库存口径" }];
  const html = renderHistory({ guidance: { version: 4, digest: "synthetic", rules, rulesOmitted: 9 } });
  // Both retained names still shown, and the omission is stated, not implied.
  assert.match(html, /净销售额口径、库存口径（另有 9 条口径未记录）/);
});

test("dropping only the unread source is not reported as a missing rule", () => {
  const html = renderHistory({
    guidance: { version: 4, digest: "synthetic", ruleSourcesOmitted: true,
      rules: [{ id: "kept-1", name: "净销售额口径" }, { id: "kept-2", name: "库存口径" }] },
  });
  // No rule was lost, so the row must read as a complete list. ("本次技能 ·
  // 未记录" is a separate, unconditional row, so match the guidance one only.)
  assert.match(html, /本次业务口径<\/dt><dd>净销售额口径、库存口径<\/dd>/);
  assert.doesNotMatch(html, /口径未记录/);
});

test("a malformed omission count still warns instead of claiming a full list", () => {
  for (const rulesOmitted of ["9", 1.5, Number.NaN, -1, true, null] as unknown[]) {
    const html = renderHistory({
      guidance: { version: 4, digest: "synthetic", rulesOmitted, rules: [{ id: "kept", name: "库存口径" }] },
    });
    assert.match(html, /库存口径（另有部分口径未记录）/, `rulesOmitted=${String(rulesOmitted)}`);
    assert.doesNotMatch(html, /另有 (?:NaN|undefined|null|-1|1\.5|true)/);
  }
  // Absent or zero means nothing was dropped: the row reads as complete.
  for (const rulesOmitted of [undefined, 0, false] as unknown[]) {
    const html = renderHistory({
      guidance: { version: 4, digest: "synthetic", rulesOmitted, rules: [{ id: "kept", name: "库存口径" }] },
    });
    assert.match(html, /本次业务口径<\/dt><dd>库存口径<\/dd>/, `rulesOmitted=${String(rulesOmitted)}`);
    assert.doesNotMatch(html, /口径未记录/, `rulesOmitted=${String(rulesOmitted)}`);
  }
});

test("explicit default and empty selections remain distinct from missing evidence", () => {
  const html = renderHistory({ guidance: { version: 0, rules: [] }, skills: { version: 0, skills: [] } });
  assert.match(html, /系统默认/);
  assert.match(html, /通用口径/);
  assert.match(html, /未匹配技能/);
  assert.doesNotMatch(html, /配置版本<\/dt><dd>未记录/);
});
