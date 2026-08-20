import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  canManageFinanceTargets,
  validateFinanceTargetDeletionReason,
} from "../app/page";

const pagePath = new URL("../app/page.tsx", import.meta.url);

test("finance target write controls are restricted to administrators", async () => {
  assert.equal(canManageFinanceTargets({ role: "admin" }), true);
  assert.equal(canManageFinanceTargets({ role: "viewer" }), false);
  assert.equal(canManageFinanceTargets({ role: "analyst" }), false);
  assert.equal(canManageFinanceTargets({ role: "operator" }), false);
  assert.equal(canManageFinanceTargets(null), false);

  const page = await readFile(pagePath, "utf8");
  assert.match(page, /function SalesView\(\{[^\n]+currentUser[^\n]+\}: \{[^\n]+currentUser: CurrentUser \| null;/);
  assert.match(page, /const canManageTargets = canManageFinanceTargets\(currentUser\);/);
  assert.match(page, /<FinanceTargetSettingsView canManageTargets=\{canManageTargets\}/);
  assert.match(page, /\{canManageTargets \? <section className="panel finance-target-form-panel">/);
  assert.match(page, /\{canManageTargets \? <div className="finance-target-row-actions">/);
  assert.match(page, /仅管理员可新增、编辑或删除经营目标；你仍可查看全部目标并使用分页。/);
  assert.match(page, /if \(!canManageTargets \|\| saving \|\| deletingTargetId !== null\) return;/);
});

test("finance target deletion requires confirmation and a bounded reason", async () => {
  assert.deepEqual(validateFinanceTargetDeletionReason(null), { status: "cancelled" });
  assert.deepEqual(validateFinanceTargetDeletionReason(""), { status: "invalid" });
  assert.deepEqual(validateFinanceTargetDeletionReason("   "), { status: "invalid" });
  assert.deepEqual(validateFinanceTargetDeletionReason("x".repeat(201)), { status: "invalid" });
  assert.deepEqual(validateFinanceTargetDeletionReason("  月度目标录入有误  "), {
    status: "accepted",
    reason: "月度目标录入有误",
  });

  const page = await readFile(pagePath, "utf8");
  const removeTarget = page.slice(page.indexOf("const removeTarget = async"), page.indexOf("return <div className=\"finance-target-page\">"));
  assert.ok(removeTarget.includes("window.confirm("));
  assert.ok(removeTarget.indexOf("window.confirm(") < removeTarget.indexOf("window.prompt("));
  assert.match(removeTarget, /const reasonResult = validateFinanceTargetDeletionReason\(providedReason\);/);
  assert.match(removeTarget, /if \(reasonResult\.status === "cancelled"\) return;/);
  assert.match(removeTarget, /if \(reasonResult\.status === "invalid"\) \{[\s\S]*?return;/);
  assert.match(removeTarget, /const query = new URLSearchParams\(\{[\s\S]*?id: item\.id,[\s\S]*?expectedVersion: String\(item\.version\),[\s\S]*?reason: reasonResult\.reason,/);
  assert.match(removeTarget, /fetch\(`\/api\/finance\/targets\?\$\{query\.toString\(\)\}`, \{ method: "DELETE" \}\)/);
  assert.match(removeTarget, /response\.status === 409[\s\S]*?await loadTargets\(\)/);
  assert.doesNotMatch(removeTarget, /finance\/targets\?id=\$\{encodeURIComponent/);
});

test("the page has no customer-service delete control that could omit an audit reason", async () => {
  const page = await readFile(new URL("../app/customer-service-view.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /fetch\([^\n]*\/api\/customer-service\/conversations[^\n]*\{\s*method:\s*"DELETE"/);
});

test("finance target form preserves the platform+shop composite identity and discloses truncated options", async () => {
  const [page, route] = await Promise.all([
    readFile(pagePath, "utf8"),
    readFile(new URL("../app/api/finance/targets/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /type FinanceTarget = \{[\s\S]*?platform: string;[\s\S]*?shopName: string;/);
  assert.match(page, /shopKey: item\.platform && item\.shopName \? JSON\.stringify\(\[item\.platform, item\.shopName\]\)/);
  assert.match(page, /platform: form\.platform,[\s\S]*?shopName: form\.shopName/);
  assert.match(page, /label: `\$\{item\.platform\} · \$\{item\.name\}`/);
  assert.match(page, /options\.pagination\?\.shops\.truncated[\s\S]*?店铺选项已设上限/);
  assert.match(route, /const platform = String\(body\.platform/);
  assert.match(route, /月度或年度目标必须选择有效平台/);
});
