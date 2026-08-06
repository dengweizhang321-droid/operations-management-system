import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCookieMatchesStore,
  buildSycmExportUrl,
  classifySycmInspectionErrors,
  closeOneShotServer,
  createHelperInactivityReaper,
  createInitialDownloadManifest,
  decodeArtifactPath,
  encodeArtifactPath,
  getCookieSourceStatus,
  getTmallPromotionStageOptions,
  helperInactivityTimeoutMs,
  helperHealthCorsHeaders,
  helperRequestError,
  isLegacyXls,
  maximumDaysPerRun,
  normalizeN8nExecutionId,
  parseCookieHeader,
  shouldLoadCookieForPlan,
} from "../tools/tmall-sycm-cookie-pipeline";

test("one-shot helper closes both its listener and retained keep-alive connections", () => {
  let closeCalls = 0;
  let closeAllCalls = 0;
  closeOneShotServer({
    close() { closeCalls += 1; return undefined as never; },
    closeAllConnections() { closeAllCalls += 1; },
  });
  assert.equal(closeCalls, 1);
  assert.equal(closeAllCalls, 1);
});

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

test("单轮只规划一个商品日，空计划不读取 Cookie 并可生成空下载清单", () => {
  assert.equal(maximumDaysPerRun, 1);
  assert.deepEqual(getTmallPromotionStageOptions(), { storeKey: "tmall-yijiu", maximumDays: 1 });
  assert.equal(shouldLoadCookieForPlan([]), false);
  assert.equal(shouldLoadCookieForPlan(["2026-08-05"]), true);
  assert.deepEqual(createInitialDownloadManifest({
    runId: "run-empty",
    baseUrl: "http://localhost:3000",
    dates: [],
  }, {
    storeKey: "tmall-yijiu",
    shopName: "天猫-志高亿玖专卖店",
  }, "2026-08-06T01:00:00.000Z"), {
    version: 1,
    runId: "run-empty",
    generatedAt: "2026-08-06T01:00:00.000Z",
    status: "downloaded",
    baseUrl: "http://localhost:3000",
    storeKey: "tmall-yijiu",
    shopName: "天猫-志高亿玖专卖店",
    dates: [],
    files: [],
    errors: [],
  });
});

test("来源零行且缺少目标日明确归类为 SOURCE_NOT_READY", () => {
  assert.deepEqual(classifySycmInspectionErrors([
    { code: "NO_DATA_ROWS" },
    { code: "MISSING_EXPECTED_DATES" },
  ]), {
    code: "SOURCE_NOT_READY",
    message: "SOURCE_NOT_READY：生意参谋目标日尚未返回可导入数据 (NO_DATA_ROWS, MISSING_EXPECTED_DATES)",
  });
  assert.equal(classifySycmInspectionErrors([
    { code: "NO_DATA_ROWS" },
    { code: "MISSING_EXPECTED_DATES" },
    { code: "MISSING_REQUIRED_COLUMNS" },
  ]).code, "INVALID_SOURCE_FILE");
});

test("健康检查只暴露 Cookie 文件就绪状态，并仅允许运营系统本机来源跨域读取", async () => {
  assert.equal(await getCookieSourceStatus(""), "missing");
  assert.equal(await getCookieSourceStatus("relative-cookie.txt"), "invalid");
  assert.equal(await getCookieSourceStatus("C:\\definitely-missing\\cookie.txt"), "missing");

  assert.deepEqual(helperHealthCorsHeaders("https://example.com"), {});
  assert.deepEqual(helperHealthCorsHeaders(undefined), {});
  const headers = helperHealthCorsHeaders("http://localhost:3000", true);
  assert.equal(headers["Access-Control-Allow-Origin"], "http://localhost:3000");
  assert.equal(headers["Access-Control-Allow-Private-Network"], "true");
  assert.equal(JSON.stringify(headers).includes("cookie"), false);
});

test("一次性 HTTP 辅助进程绑定同一 n8n execution id 并拒绝旧执行、乱序和并发调用", () => {
  assert.equal(normalizeN8nExecutionId("execution-100"), "execution-100");
  assert.equal(normalizeN8nExecutionId("bad execution"), null);
  assert.equal(normalizeN8nExecutionId(undefined), null);

  assert.equal(helperRequestError("ready", false, "/product-master", "execution-100", null), null);
  assert.equal(helperRequestError("mastered", false, "/product-master", "execution-100", "execution-100"), null);
  assert.deepEqual(helperRequestError("planned", false, "/product-master", "execution-100", "execution-100"), {
    error: "invalid_stage",
    expected: "ready_or_mastered",
    actual: "planned",
  });
  assert.deepEqual(helperRequestError("ready", false, "/plan", "execution-100", null), {
    error: "execution_not_claimed",
    expected: "/product-master",
  });
  assert.equal(helperRequestError("mastered", false, "/plan", "execution-100", "execution-100"), null);
  assert.deepEqual(helperRequestError("planned", false, "/fetch", "execution-old", "execution-100"), {
    error: "execution_mismatch",
  });
  assert.deepEqual(helperRequestError("ready", false, "/fetch", "execution-100", "execution-100"), {
    error: "invalid_stage",
    expected: "planned",
    actual: "ready",
  });
  assert.deepEqual(helperRequestError("planned", false, "/plan", "execution-100", "execution-100"), {
    error: "invalid_stage",
    expected: "mastered",
    actual: "planned",
  });
  assert.deepEqual(helperRequestError("planned", true, "/fetch", "execution-100", "execution-100"), { error: "pipeline_busy" });
  assert.equal(helperRequestError("planned", false, "/fetch", "execution-100", "execution-100"), null);
  assert.equal(helperRequestError("fetched", false, "/import", "execution-100", "execution-100"), null);
  assert.equal(helperRequestError("imported", false, "/promotion", "execution-100", "execution-100"), null);
  assert.deepEqual(helperRequestError("fetched", false, "/promotion", "execution-100", "execution-100"), {
    error: "invalid_stage",
    expected: "imported",
    actual: "fetched",
  });
  assert.deepEqual(helperRequestError("imported", true, "/promotion", "execution-100", "execution-100"), { error: "pipeline_busy" });
  assert.deepEqual(helperRequestError("ready", false, "/product-master", null, null), { error: "missing_or_invalid_execution_id" });
  assert.match(JSON.stringify(helperRequestError("completed", false, "/import", "execution-100", "execution-100")), /invalid_stage/);
});

test("A/B 等非终态在有界空闲后关闭 helper，下一段领取会取消旧回收计时", () => {
  let closed = 0;
  let cancelled = 0;
  const scheduled: Array<{ callback: () => void; delay: number; handle: object }> = [];
  const reaper = createHelperInactivityReaper({
    close: () => { closed += 1; },
    schedule: (callback, delay) => {
      const handle = {};
      scheduled.push({ callback, delay, handle });
      return handle;
    },
    cancel: (handle) => {
      assert.equal(handle, scheduled.at(-1)?.handle);
      cancelled += 1;
    },
  });

  reaper.arm();
  assert.equal(reaper.isArmed(), true);
  assert.equal(scheduled[0]?.delay, helperInactivityTimeoutMs);
  reaper.clear();
  assert.equal(cancelled, 1);
  assert.equal(reaper.isArmed(), false);

  reaper.arm();
  scheduled.at(-1)?.callback();
  assert.equal(closed, 1);
  assert.equal(reaper.isArmed(), false);
});
