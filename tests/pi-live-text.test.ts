import test from "node:test";
import assert from "node:assert/strict";
import { piLiveText } from "../lib/ai/pi-live-text";

const event = (type: string, data: Record<string, unknown>, operationId = "op") => ({ type, data, operationId });
test("Pi replays one public preview, ignores duplicates, and replaces it with the runner answer", () => {
  const events = [
    event("provider_text_delta", { messageId: "r1", offset: 0, text: "别人的结果" }, "other"),
    event("assistant_message", { text: "第一轮" }),
    event("provider_text_delta", { messageId: "r2", offset: 0, text: "中😀" }),
    event("provider_text_delta", { messageId: "r2", offset: 0, text: "中😀" }),
    event("provider_text_delta", { messageId: "r2", offset: 3, text: "文" }),
  ];
  assert.equal(piLiveText(events, "op"), "中😀文");
  events.push(event("provider_text_end", { messageId: "r2" }), event("text_delta", { text: "中😀文" }));
  assert.equal(piLiveText(events, "op"), "中😀文");
  events.push(event("assistant_message", { text: "中😀文" }));
  assert.equal(piLiveText(events, "op"), "");
});
