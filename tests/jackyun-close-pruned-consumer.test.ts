import assert from "node:assert/strict";
import test from "node:test";
import { jackyunCloseConsumerState } from "../lib/jackyun/operator-close";

const unknown = "原业务 owner 状态无法确认，请核查精确 execution。";
const pruned = () => { throw new Error(unknown); };

test("a pruned consumer is unknown-but-safe only once its permission elapsed", () => {
  assert.equal(jackyunCloseConsumerState("10060", true, pruned), null);
  assert.throws(() => jackyunCloseConsumerState("10060", false, pruned), new RegExp(unknown));
});

test("a recorded consumer is always reported, expired or not", () => {
  for (const expired of [true, false]) {
    assert.deepEqual(jackyunCloseConsumerState("11223", expired, () => "error"),
      { executionId: "11223", status: "error" });
    // A live consumer must still reach the caller's in-flight rejection.
    assert.deepEqual(jackyunCloseConsumerState("11223", expired, () => "waiting"),
      { executionId: "11223", status: "waiting" });
  }
});

test("any other read failure keeps failing the close, even when expired", () => {
  for (const message of ["n8n 元数据路径身份异常。", "业务 owner execution 无效。", "database is locked"]) {
    assert.throws(() => jackyunCloseConsumerState("10060", true, () => { throw new Error(message); }),
      new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
