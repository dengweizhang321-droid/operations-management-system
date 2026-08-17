import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertCookieMatchesStore,
  buildSycmExportUrl,
  classifySycmInspectionErrors,
  closeOneShotServer,
  closeTmallWorkflowBrowser,
  consumeTmallSkipMasterPermit,
  createHelperInactivityReaper,
  createInitialDownloadManifest,
  decodeArtifactPath,
  encodeArtifactPath,
  getCookieSourceStatus,
  getTmallProfileStatus,
  getTmallPromotionStageOptions,
  helperInactivityTimeoutMs,
  helperHealthCorsHeaders,
  helperRequestError,
  jdSilentNoWindowHeader,
  isLegacyXls,
  maximumDaysPerRun,
  normalizeN8nExecutionId,
  normalizeTmallSkipMasterPermitToken,
  parseCookieHeader,
  saveDownload,
  shouldLoadCookieForPlan,
  sycmCookieHeaderFromChromeStorage,
  tmallSkipMasterPermitHeader,
} from "../tools/tmall-sycm-cookie-pipeline";

test("JD silent copy uses one bounded non-secret no-window header", () => {
  assert.equal(jdSilentNoWindowHeader, "x-teruisi-jd-silent-no-window");
});

test("天猫跳过 M 只接受一次性有界许可请求头", async () => {
  assert.equal(tmallSkipMasterPermitHeader, "x-teruisi-tmall-skip-master-permit");
  const token = "permit-12345678901234567890123456789012";
  assert.equal(normalizeTmallSkipMasterPermitToken(token), token);
  assert.equal(normalizeTmallSkipMasterPermitToken("short"), null);

  const root = await mkdtemp(path.join(tmpdir(), "tmall-skip-master-"));
  const permitFile = path.join(root, "permit.json");
  const activeAuditFile = path.join(root, "active.json");
  try {
    await writeFile(permitFile, JSON.stringify({
      version: 1,
      storeKey: "tmall-yijiu",
      token,
      expiresAt: "2026-08-17T10:30:00.000Z",
    }));
    const consumed = await consumeTmallSkipMasterPermit({
      token,
      executionId: "execution-200",
      now: new Date("2026-08-17T10:00:00.000Z"),
      permitFile,
      activeAuditFile,
    });
    assert.equal(consumed.status, "master_skipped_by_operator");
    assert.equal(await stat(permitFile).then(() => true).catch(() => false), false);
    assert.equal(await stat(consumed.consumedFile).then(() => true).catch(() => false), true);

    await writeFile(permitFile, JSON.stringify({
      version: 1,
      storeKey: "tmall-yijiu",
      token,
      expiresAt: "2026-08-17T09:59:59.000Z",
    }));
    await assert.rejects(() => consumeTmallSkipMasterPermit({
      token,
      executionId: "execution-201",
      now: new Date("2026-08-17T10:00:00.000Z"),
      permitFile,
      activeAuditFile,
    }), /已过期/);
    assert.equal(await stat(permitFile).then(() => true).catch(() => false), true);

    await writeFile(activeAuditFile, "{}");
    await assert.rejects(() => consumeTmallSkipMasterPermit({
      token,
      executionId: "execution-202",
      now: new Date("2026-08-17T09:00:00.000Z"),
      permitFile,
      activeAuditFile,
    }), /活动清单仍存在/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("不同执行可保存同一目标日的不同源文件，交由导入接口比较业务内容", async () => {
  const downloadDir = await mkdtemp(path.join(tmpdir(), "tmall-sycm-run-download-"));
  const store = { browser: { profileDir: "unused", debugPort: 9222, downloadDir } };
  const fileName = "【生意参谋平台】商品_全部_2026-08-05_2026-08-05.xls";
  try {
    const first = await saveDownload(store, "run-one", "2026-08-05", new Uint8Array([1, 2, 3]), fileName);
    const repeated = await saveDownload(store, "run-one", "2026-08-05", new Uint8Array([1, 2, 3]), fileName);
    const changed = await saveDownload(store, "run-two", "2026-08-05", new Uint8Array([1, 2, 4]), fileName);

    assert.equal(repeated.filePath, first.filePath);
    assert.equal(repeated.reusedExistingFile, true);
    assert.notEqual(changed.filePath, first.filePath);
    assert.equal(changed.reusedExistingFile, false);
  } finally {
    await rm(downloadDir, { recursive: true, force: true });
  }
});

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

test("天猫工作流终态只关闭注册端口对应的独立 Chromium", async () => {
  const ports: number[] = [];
  assert.deepEqual(await closeTmallWorkflowBrowser(9334, async (port) => {
    ports.push(port);
    return true;
  }), { ok: true, status: "closed" });
  assert.deepEqual(await closeTmallWorkflowBrowser(9334, async (port) => {
    ports.push(port);
    return false;
  }), { ok: true, status: "already_closed" });
  assert.deepEqual(ports, [9334, 9334]);
  await assert.rejects(() => closeTmallWorkflowBrowser(0, async () => true), /调试端口无效/);
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

test("生意参谋优先从店铺独立 Chrome 读取当前域 Cookie 且排除过期与跨域值", () => {
  const now = Date.parse("2026-08-06T00:00:00Z");
  const header = sycmCookieHeaderFromChromeStorage([
    { name: "cookie2", value: "root-session", domain: ".taobao.com", path: "/", expires: now / 1000 + 3600 },
    { name: "cookie2", value: "specific-session", domain: "sycm.taobao.com", path: "/cc", expires: now / 1000 + 3600 },
    { name: "sn", value: encodeURIComponent("志高亿玖专卖店:测试账号"), domain: ".taobao.com", path: "/" },
    { name: "expired", value: "old", domain: ".taobao.com", path: "/", expires: now / 1000 - 1 },
    { name: "other", value: "wrong", domain: ".example.com", path: "/" },
  ], now);
  const parsed = parseCookieHeader(header);
  assert.equal(parsed.values.get("cookie2"), "specific-session");
  assert.equal(parsed.values.has("expired"), false);
  assert.equal(parsed.values.has("other"), false);
  assert.equal(parsed.values.get("sn"), encodeURIComponent("志高亿玖专卖店:测试账号"));
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

test("天猫健康检查接受完整专属 user-data-dir，备用 Cookie 缺失不影响 profile 就绪", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tmall-profile-health-"));
  const executablePath = path.join(root, "chrome.exe");
  const userDataDir = path.join(root, "User Data");
  const profileDir = path.join(userDataDir, "Default");
  try {
    await mkdir(profileDir, { recursive: true });
    await writeFile(executablePath, "test", "utf8");
    await writeFile(path.join(userDataDir, "Local State"), "{}", "utf8");
    assert.equal(await getTmallProfileStatus({ browser: {
      executablePath,
      userDataDir,
      profileName: "Default",
      profileDir,
      debugPort: 9334,
      downloadDir: path.join(root, "downloads"),
    } }), "ready");
    assert.equal(await getTmallProfileStatus({ browser: {
      profileDir,
      debugPort: 9334,
      downloadDir: path.join(root, "downloads"),
    } }), "invalid");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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
  assert.equal(helperRequestError("ready", false, "/plan", "execution-100", null, true), null);
  assert.deepEqual(helperRequestError("ready", true, "/plan", "execution-100", null, true), { error: "pipeline_busy" });
  assert.deepEqual(helperRequestError("ready", false, "/fetch", "execution-100", null, true), {
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

test("helper 空闲回收不会关闭仍在执行的活跃请求", () => {
  let busy = true;
  let closed = 0;
  const scheduled: Array<{ callback: () => void; delay: number }> = [];
  const reaper = createHelperInactivityReaper({
    close: () => { closed += 1; },
    isBusy: () => busy,
    timeoutMs: 250,
    schedule: (callback, delay) => {
      scheduled.push({ callback, delay });
      return { index: scheduled.length - 1 };
    },
    cancel: () => undefined,
  });

  reaper.arm();
  scheduled[0]!.callback();
  assert.equal(closed, 0);
  assert.equal(reaper.isArmed(), true);
  assert.equal(scheduled.length, 2);
  assert.equal(scheduled[1]!.delay, 250);

  busy = false;
  scheduled[1]!.callback();
  assert.equal(closed, 1);
  assert.equal(reaper.isArmed(), false);
});
