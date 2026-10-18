import assert from "node:assert/strict";
import test from "node:test";
import { assertFreshRestartSerialFailure } from "../lib/jackyun/n8n-preflight-decode";

const a = "A·固定采集日和销售日期", b = "B·接口校验与五表下载", c = "C·五表完整校验和导入演练", d = "D·统一导入运营管理系统";
const success = () => ({ executionStatus: "success" });
const failure = () => ({ executionStatus: "error", error: { description: "known rejection" } });
const raw = (nodes: Record<string, unknown>) => JSON.stringify([{ resultData: { runData: nodes } }]);
test("serial restart proof accepts only the sole known D failure after one successful A/B/C", () => {
  const valid = () => ({ [a]: [success()], [b]: [success()], [c]: [success()], [d]: [failure()] });
  assert.doesNotThrow(() => assertFreshRestartSerialFailure(raw(valid()), true));
  const variants: Record<string, unknown>[] = [
    { ...valid(), [d]: [{ executionStatus: "error", error: { description: "unknown HTTP response" } }, failure()] },
    { ...valid(), [d]: [{ executionStatus: "success" }] },
    { ...valid(), [d]: [{ executionStatus: "error" }] },
    { ...valid(), "unknown HTTP writer": [success()] },
    { ...valid(), "E·独立核验五类精确批次": [success()] },
  ];
  for (const stage of [a, b, c]) {
    variants.push({ ...valid(), [stage]: [success(), success()] });
    variants.push({ ...valid(), [stage]: [failure()] });
    variants.push({ ...valid(), [stage]: [{ executionStatus: "success", error: {} }] });
  }
  for (const nodes of variants) assert.throws(() => assertFreshRestartSerialFailure(raw(nodes), true));
});
test("latest failed A must contain no later B-E or unknown node, and cannot hide earlier A invocations", () => {
  assert.doesNotThrow(() => assertFreshRestartSerialFailure(raw({ [a]: [failure()] }), false));
  for (const later of [b, c, d, "E·独立核验五类精确批次", "unrecognized stage"]) {
    assert.throws(() => assertFreshRestartSerialFailure(raw({ [a]: [failure()], [later]: [success()] }), false));
  }
  assert.throws(() => assertFreshRestartSerialFailure(raw({ [a]: [success(), failure()] }), false));
  for (const malformed of ["{}", "partial", "[]"]) assert.throws(() => assertFreshRestartSerialFailure(malformed, false));
});
