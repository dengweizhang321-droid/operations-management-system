import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCookieMatchesStore,
  buildSycmExportUrl,
  decodeArtifactPath,
  encodeArtifactPath,
  helperRequestError,
  isLegacyXls,
  parseCookieHeader,
} from "../tools/tmall-sycm-cookie-pipeline";

test("Cookie 只接受单行请求头并核验亿玖店登录身份", () => {
  const cookie = parseCookieHeader([
    "Cookie: _tb_token_=token-value",
    "cookie2=session-value",
    "unb=123",
    `sn=${encodeURIComponent("志高亿玖专卖店:测试账号")}`,
  ].join("; "));
  assert.equal(assertCookieMatchesStore(cookie, { shopName: "天猫-志高亿玖专卖店" }), "志高亿玖专卖店:测试账号");
  assert.throws(() => assertCookieMatchesStore(cookie, { shopName: "天猫-志高丽力专卖店" }), /跨店下载/);
  assert.throws(() => parseCookieHeader("a=1\nb=2"), /单行/);
  assert.throws(() => parseCookieHeader("a=1; a=2"), /重复键/);
  assert.throws(() => assertCookieMatchesStore(parseCookieHeader("cookie2=x; unb=1; sn=test"), { shopName: "天猫-志高亿玖专卖店" }), /必要登录键/);
});

test("生意参谋导出固定为同一单日且路径用规范 Base64 传递", () => {
  const url = new URL(buildSycmExportUrl("2026-08-02", "test-token"));
  assert.equal(url.origin, "https://sycm.taobao.com");
  assert.equal(url.pathname, "/cc/item/view/excel/top.json");
  assert.equal(url.searchParams.get("dateType"), "day");
  assert.equal(url.searchParams.get("dateRange"), "2026-08-02|2026-08-02");
  assert.equal(url.searchParams.get("token"), "test-token");
  assert.throws(() => buildSycmExportUrl("2026-08-01|2026-08-02", "test-token"), /YYYY-MM-DD/);

  const filePath = "D:\\运营管理系统\\outputs\\tmall-sycm-cookie-pipeline\\plan-test.json";
  assert.equal(decodeArtifactPath(encodeArtifactPath(filePath)), filePath);
  assert.throws(() => decodeArtifactPath("%%%"), /Base64/);
});

test("下载响应必须是老式 XLS 魔数", () => {
  assert.equal(isLegacyXls(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1])), true);
  assert.equal(isLegacyXls(new TextEncoder().encode('{"code":5810}')), false);
});

test("一次性 HTTP 辅助进程支持货品前置阶段并拒绝乱序、重复和并发调用", () => {
  assert.equal(helperRequestError("ready", false, "/product-master"), null);
  assert.deepEqual(helperRequestError("mastered", false, "/product-master"), {
    error: "invalid_stage",
    expected: "ready",
    actual: "mastered",
  });
  assert.equal(helperRequestError("ready", false, "/plan"), null);
  assert.equal(helperRequestError("mastered", false, "/plan"), null);
  assert.deepEqual(helperRequestError("ready", false, "/fetch"), {
    error: "invalid_stage",
    expected: "planned",
    actual: "ready",
  });
  assert.deepEqual(helperRequestError("planned", false, "/plan"), {
    error: "invalid_stage",
    expected: "ready_or_mastered",
    actual: "planned",
  });
  assert.deepEqual(helperRequestError("planned", true, "/fetch"), { error: "pipeline_busy" });
  assert.equal(helperRequestError("planned", false, "/fetch"), null);
  assert.equal(helperRequestError("fetched", false, "/import"), null);
  assert.match(JSON.stringify(helperRequestError("completed", false, "/import")), /invalid_stage/);
});
