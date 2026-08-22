import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import * as XLSX from "xlsx";

import {
  abandonActiveTmallProductMasterAudit,
  compareTmallNoticeActionCandidates,
  chooseFreshTmallDownloadSignature,
  chooseLatestTmallDownloadSignature,
  chooseTmallExportRecordSignature,
  chooseTmallResumeSellerPageIndex,
  createTmallBrowserDownloadSession,
  countAcceptedTmallExportTasks,
  countTmallCompletedDownloadCards,
  decideTmallMasterAuditRecovery,
  hasAcceptedTmallExportTask,
  hasCompletedTmallExportResult,
  importTmallProductMasterFile,
  inspectTmallMasterFile,
  isExplicitTmallNoticeDismissAction,
  isTmallClosableOverlayNotice,
  isTmallNoticePointerInterceptionError,
  isResumableTmallExportStage,
  isTmallExportConfirmationLabel,
  isTmallProductWorkbookFilename,
  isTmallSellerBusinessUrl,
  isTmallSellerLoginUrl,
  matchTmallExportRecordChoice,
  parseTmallExportRecordStatus,
  parseTmallShanghaiTaskTime,
  productManagerChatOpenTimeoutMs,
  productManagerFloatingClusterKey,
  resolveTmallStagedDownloadPath,
  sameTmallNoticeActionTarget,
  scoreChatSendCandidate,
  scoreImportantNoticeCloseCandidate,
  scoreProductManagerCandidate,
  scoreProductManagerFloatingCandidate,
  scoreTmallBlockingNoticeCandidate,
  shouldRejectEqualTmallNoticeActions,
  tmallSellerLoginRedirectGraceMs,
  tmallBrowserDownloadOutcome,
  waitForTmallSellerSessionUrl,
} from "../tools/tmall-product-master-export";

test("识别千牛卖家专用登录跳转并拒绝普通业务页", () => {
  assert.equal(isTmallSellerLoginUrl("https://loginmyseller.taobao.com/?redirect_url=https%3A%2F%2Fmyseller.taobao.com"), true);
  assert.equal(isTmallSellerLoginUrl("https://login.taobao.com/member/login.jhtml"), true);
  assert.equal(isTmallSellerLoginUrl("https://myseller.taobao.com/home.htm/SellManage/on_sale"), false);
});

test("千牛业务页选择严格排除包含相似域名的登录页", () => {
  assert.equal(isTmallSellerBusinessUrl("https://myseller.taobao.com/home.htm/SellManage/on_sale"), true);
  assert.equal(isTmallSellerBusinessUrl("https://loginmyseller.taobao.com/?redirect_url=https%3A%2F%2Fmyseller.taobao.com"), false);
  assert.equal(isTmallSellerBusinessUrl("not-a-url"), false);
});

test("千牛启动时允许登录跳转短暂出现后回到受控出售中页面", async () => {
  const observations = [
    "https://loginmyseller.taobao.com/?redirect_url=on_sale",
    "https://myseller.taobao.com/home.htm/SellManage/on_sale?current=1&pageSize=20",
  ];
  let waits = 0;
  const result = await waitForTmallSellerSessionUrl(
    () => observations[Math.min(waits, observations.length - 1)]!,
    async () => { waits += 1; },
    1_000,
    250,
  );
  assert.equal(result, observations[1]);
  assert.equal(waits, 1);
  assert.equal(tmallSellerLoginRedirectGraceMs, 15_000);
});

test("千牛登录页在宽限期内持续存在时仍失败关闭", async () => {
  let waits = 0;
  await assert.rejects(
    () => waitForTmallSellerSessionUrl(
      () => "https://loginmyseller.taobao.com/?redirect_url=on_sale",
      async () => { waits += 1; },
      1_000,
      250,
    ),
    /waiting_login/,
  );
  assert.equal(waits, 4);
});

test("商品管家侧栏允许平台异步加载但保持一分钟有界失败", () => {
  assert.equal(productManagerChatOpenTimeoutMs, 60_000);
});

function masterWorkbook() {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["发布模板"],
    [null],
    [
      "商品Id", "类目id", "类目名称", "商品标题", "一口价", "导购标题", "商家编码", "发货时间",
      "最长发货时间", "销售属性", "属性对", "发货时间", "skuId", "价格（元）", "数量", "商家编码",
      "生产日期（年/月/日）", "保质期",
    ],
    ["10001", "cat", "测试类目", "测试商品", "10.00", null, "ITEM-1", 2, 15, "颜色:红", null, null, "20001", "9.90", 5, "SKU-1", null, null],
  ]), "发布模板");
  return new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" }));
}

test("商品管家入口接受右下角文字或图标属性并拒绝无关候选", () => {
  const candidate = {
    text: "商品管家",
    attributes: "",
    tag: "button",
    role: "button",
    left: 1320,
    top: 720,
    width: 96,
    height: 40,
    viewportWidth: 1440,
    viewportHeight: 900,
  };
  assert.ok(scoreProductManagerCandidate(candidate) > 0);
  assert.ok(scoreProductManagerCandidate({ ...candidate, tag: "span", role: "" }) > 0);
  assert.ok(scoreProductManagerCandidate({ ...candidate, text: "", attributes: "title 商品管家" }) > 0);
  assert.ok(scoreProductManagerCandidate({ ...candidate, text: "", attributes: "product-manager-entry" }) > 0);
  assert.equal(scoreProductManagerCandidate({ ...candidate, text: "商品搜索" }), -1);
  assert.equal(scoreProductManagerCandidate({ ...candidate, text: "", attributes: "generic-floating-entry" }), -1);
  assert.equal(scoreProductManagerCandidate({ ...candidate, left: 200 }), -1);
  assert.equal(scoreProductManagerCandidate({ ...candidate, top: 120 }), -1);
  assert.equal(scoreProductManagerCandidate({ ...candidate, width: 500 }), -1);
});

test("无标签商品管家只接受右侧下半区唯一固定悬浮图标", () => {
  const candidate = {
    text: "",
    attributes: "floating-entry",
    tag: "div",
    role: "button",
    left: 1380,
    top: 720,
    width: 60,
    height: 60,
    viewportWidth: 1440,
    viewportHeight: 900,
    position: "fixed",
    cursor: "pointer",
  };
  assert.ok(scoreProductManagerFloatingCandidate(candidate) > 0);
  assert.equal(
    productManagerFloatingClusterKey(candidate),
    productManagerFloatingClusterKey({ ...candidate, left: 1398, top: 738, width: 24, height: 24 }),
  );
  assert.equal(scoreProductManagerFloatingCandidate({ ...candidate, left: 900 }), -1);
  assert.equal(scoreProductManagerFloatingCandidate({ ...candidate, top: 300 }), -1);
  assert.equal(scoreProductManagerFloatingCandidate({ ...candidate, position: "absolute" }), -1);
  assert.equal(scoreProductManagerFloatingCandidate({ ...candidate, width: 300 }), -1);
  assert.equal(scoreProductManagerFloatingCandidate({ ...candidate, text: "返回顶部" }), -1);
  assert.equal(scoreProductManagerFloatingCandidate({ ...candidate, text: "商品巡检" }), -1);
});

test("商品管家发送键必须位于聊天输入框右侧附近", () => {
  const input = { left: 1120, right: 1390, top: 760, bottom: 820 };
  const send = { label: "ant-sender-actions-btn arrow-up", left: 1350, top: 770, width: 48, height: 40 };
  assert.ok(scoreChatSendCandidate(send, input) > 0);
  assert.equal(scoreChatSendCandidate({ ...send, label: "发送", left: 800 }, input), -1);
  assert.equal(scoreChatSendCandidate({ ...send, top: 600 }, input), -1);
  assert.equal(scoreChatSendCandidate({ ...send, width: 180 }, input), -1);
});

test("商品管家确认兼容任务卡片文案并识别自动受理状态", () => {
  assert.equal(isTmallExportConfirmationLabel("确认导出"), true);
  assert.equal(isTmallExportConfirmationLabel("确认任务"), true);
  assert.equal(isTmallExportConfirmationLabel("确认执行任务"), true);
  assert.equal(isTmallExportConfirmationLabel("去优化"), false);
  assert.equal(hasAcceptedTmallExportTask("任务2：导出商品到Excel，共有2个任务，还剩0个任务待执行"), true);
  assert.equal(hasAcceptedTmallExportTask("成功导出 212 个商品到Excel文件，所有任务已完成"), true);
  assert.equal(hasAcceptedTmallExportTask("导出全部商品"), false);
  assert.equal(countAcceptedTmallExportTasks("历史任务1：导出商品到Excel"), 1);
  assert.equal(countAcceptedTmallExportTasks("历史任务1：导出商品到Excel\n新任务2：导出168个商品到Excel"), 2);
  assert.equal(hasCompletedTmallExportResult("成功导出 162 个商品到Excel文件，前往下载"), true);
  assert.equal(hasCompletedTmallExportResult("任务2：导出商品到Excel，共有2个任务"), false);
  assert.equal(isResumableTmallExportStage("export_submitted"), true);
  assert.equal(isResumableTmallExportStage("export_confirmed"), true);
  assert.equal(isResumableTmallExportStage("export_submitting"), false);
  assert.equal(isTmallProductWorkbookFilename("出售中全部商品.xlsx"), true);
  assert.equal(isTmallProductWorkbookFilename("出售中全部商品.xls"), false);
  assert.equal(isTmallProductWorkbookFilename("../出售中全部商品.xlsx"), false);
});

test("商品管家跨日恢复旧任务且不重复发送导出指令", () => {
  assert.deepEqual(decideTmallMasterAuditRecovery("2026-08-12", {
    snapshotDate: "2026-08-10",
    stage: "export_confirmed",
  }), { action: "resume_previous", snapshotDate: "2026-08-10" });
  assert.deepEqual(decideTmallMasterAuditRecovery("2026-08-12", {
    snapshotDate: "2026-08-10",
    stage: "downloaded",
  }), { action: "resume_previous", snapshotDate: "2026-08-10" });
  assert.deepEqual(decideTmallMasterAuditRecovery("2026-08-12", {
    snapshotDate: "2026-08-10",
    stage: "export_submitting",
  }), { action: "block", snapshotDate: "2026-08-10" });
  assert.deepEqual(decideTmallMasterAuditRecovery("2026-08-12", {
    snapshotDate: "2026-08-10",
    stage: "browser_ready",
  }), { action: "discard", snapshotDate: "2026-08-12" });
  assert.deepEqual(decideTmallMasterAuditRecovery("2026-08-12", {
    snapshotDate: "2026-08-12",
    stage: "export_submitting",
  }), { action: "continue", snapshotDate: "2026-08-12" });
});

test("明确授权作废已确认货品任务时原清单完整归档且不能覆盖", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tmall-abandon-audit-"));
  const activePath = path.join(root, "active-tmall-yijiu.json");
  const audit = {
    version: 1,
    runId: "confirmed-run",
    storeKey: "tmall-yijiu",
    shopName: "天猫-志高亿玖专卖店",
    snapshotDate: "2026-08-19",
    targetUrl: "https://myseller.taobao.com/home.htm/SellManage/on_sale",
    prompt: "导出全部商品",
    startedAt: "2026-08-19T03:47:03.320Z",
    updatedAt: "2026-08-22T05:41:11.476Z",
    stage: "export_confirmed",
    exportSubmittedAt: "2026-08-19T03:47:10.645Z",
    lastError: "等待千牛生成全部商品 Excel 超时",
  };
  try {
    await writeFile(activePath, JSON.stringify(audit), "utf8");
    await assert.rejects(() => abandonActiveTmallProductMasterAudit({
      storeKey: "tmall-yijiu",
      reason: "操作者确认旧任务已作废",
      operatorConfirmed: false,
      auditDirectory: root,
    }), /必须取得操作者明确确认/);
    assert.equal((await stat(activePath)).isFile(), true);

    const result = await abandonActiveTmallProductMasterAudit({
      storeKey: "tmall-yijiu",
      reason: "操作者确认旧任务已作废",
      operatorConfirmed: true,
      auditDirectory: root,
      now: new Date("2026-08-22T06:30:00.000Z"),
    });
    await assert.rejects(() => stat(activePath), { code: "ENOENT" });
    const archived = JSON.parse(await readFile(path.join(root, result.archiveFileName), "utf8"));
    assert.equal(archived.runId, audit.runId);
    assert.equal(archived.stage, "export_confirmed");
    assert.deepEqual(archived.abandonment, {
      abandonedAt: "2026-08-22T06:30:00.000Z",
      previousStage: "export_confirmed",
      reason: "操作者确认旧任务已作废",
    });
    await assert.rejects(() => abandonActiveTmallProductMasterAudit({
      storeKey: "tmall-yijiu",
      reason: "重复请求不应覆盖归档",
      operatorConfirmed: true,
      auditDirectory: root,
    }), /不存在可作废/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("业务点击前或点击未决的货品清单不能走已提交任务作废入口", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tmall-abandon-stage-"));
  const activePath = path.join(root, "active-tmall-yijiu.json");
  try {
    await writeFile(activePath, JSON.stringify({
      version: 1,
      runId: "submitting-run",
      storeKey: "tmall-yijiu",
      shopName: "天猫-志高亿玖专卖店",
      snapshotDate: "2026-08-22",
      targetUrl: "https://myseller.taobao.com/home.htm/SellManage/on_sale",
      prompt: "导出全部商品",
      startedAt: "2026-08-22T06:30:00.000Z",
      updatedAt: "2026-08-22T06:30:01.000Z",
      stage: "export_submitting",
    }), "utf8");
    await assert.rejects(() => abandonActiveTmallProductMasterAudit({
      storeKey: "tmall-yijiu",
      reason: "点击结果仍未确定",
      operatorConfirmed: true,
      auditDirectory: root,
    }), /不允许按已提交任务作废/);
    assert.equal((await stat(activePath)).isFile(), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("恢复商品管家任务只接管唯一含完成结果的千牛页面", () => {
  assert.equal(chooseTmallResumeSellerPageIndex([
    { hasCompletedResult: false },
    { hasCompletedResult: true },
  ]), 1);
  assert.equal(chooseTmallResumeSellerPageIndex([
    { hasCompletedResult: false },
    { hasCompletedResult: false },
  ]), 0);
  assert.throws(() => chooseTmallResumeSellerPageIndex([
    { hasCompletedResult: true },
    { hasCompletedResult: true },
  ]), /多个千牛页面/);
});

test("商品管家下载候选合并嵌套按钮并只选择最下方成功结果", () => {
  const completed = "成功导出 212 个商品到Excel文件，所有任务已完成 前往下载";
  const candidate = (patch: Partial<{
    signature: string;
    frameUrl: string;
    href: string;
    left: number;
    top: number;
    width: number;
    height: number;
    contextText: string;
  }> = {}) => ({
    signature: "old",
    frameUrl: "https://myseller.taobao.com/chat",
    href: "https://download.example/old.xlsx",
    left: 1200,
    top: 300,
    width: 120,
    height: 36,
    contextText: completed,
    ...patch,
  });

  assert.equal(chooseLatestTmallDownloadSignature([
    candidate({ signature: "nested-parent", href: "", left: 1196, width: 128 }),
    candidate({ signature: "nested-link", contextText: "" }),
  ]), "nested-link");
  assert.equal(countTmallCompletedDownloadCards([
    candidate({ signature: "nested-parent", href: "", left: 1196, width: 128 }),
    candidate({ signature: "nested-link", contextText: "" }),
  ]), 1);
  assert.equal(chooseFreshTmallDownloadSignature([
    candidate({ signature: "old-reflowed", top: 540 }),
  ], 1), null);
  assert.equal(chooseFreshTmallDownloadSignature([
    candidate({ signature: "old-reflowed", top: 420 }),
    candidate({ signature: "new-result", href: "https://download.example/new.xlsx", top: 620 }),
  ], 1), "new-result");
  assert.equal(chooseLatestTmallDownloadSignature([
    candidate(),
    candidate({ signature: "latest", href: "https://download.example/latest.xlsx", top: 620 }),
  ]), "latest");
  assert.throws(() => chooseLatestTmallDownloadSignature([
    candidate({ signature: "tie-a", top: 620 }),
    candidate({ signature: "tie-b", href: "https://download.example/tie-b.xlsx", left: 1450, top: 628 }),
  ]), /位置并列/);
  assert.throws(() => chooseLatestTmallDownloadSignature([
    candidate(),
    candidate({ signature: "other-frame", frameUrl: "https://other.example/chat", top: 620, contextText: "" }),
  ]), /不同页面/);
});

test("商品管家下载事件必须监听 Chrome 浏览器根会话", async () => {
  let browserSessionCalls = 0;
  let pageSessionCalls = 0;
  const expectedSession = {};
  const page = {
    context: () => ({
      browser: () => ({
        newBrowserCDPSession: async () => {
          browserSessionCalls += 1;
          return expectedSession;
        },
      }),
      newCDPSession: async () => {
        pageSessionCalls += 1;
        return expectedSession;
      },
    }),
  } as unknown as Parameters<typeof createTmallBrowserDownloadSession>[0];
  const session = await createTmallBrowserDownloadSession(page);
  assert.equal(session, expectedSession);
  assert.equal(browserSessionCalls, 1);
  assert.equal(pageSessionCalls, 0);
});

test("浏览器下载取消先解析为受控结果，不产生提前拒绝", () => {
  assert.equal(tmallBrowserDownloadOutcome({ guid: "other", state: "canceled" }, "target"), null);
  assert.equal(tmallBrowserDownloadOutcome({ guid: "target", state: "inProgress" }, "target"), null);
  assert.deepEqual(tmallBrowserDownloadOutcome({ guid: "target", state: "canceled" }, "target"), {
    ok: false,
    guid: "target",
    error: "Chrome 已取消商品管家 XLSX 下载",
  });
  assert.deepEqual(tmallBrowserDownloadOutcome({ guid: "target", state: "completed", filePath: "safe.xlsx" }, "target"), {
    ok: true,
    guid: "target",
    filePath: "safe.xlsx",
  });
});

test("Chrome 回报异常路径时只在本轮受控暂存目录按 GUID 或安全文件名签收", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tmall-download-path-"));
  try {
    const staging = path.join(root, "staging");
    await mkdir(staging);
    const guidPath = path.join(staging, "download-guid");
    await writeFile(guidPath, "current-download");
    assert.equal(await resolveTmallStagedDownloadPath({
      stagingDirectory: staging,
      guid: "download-guid",
      suggestedFilename: "出售中全部商品.xlsx",
      reportedFilePath: path.join(root, "outside", "download-guid"),
    }), guidPath);
    assert.equal(await resolveTmallStagedDownloadPath({
      stagingDirectory: staging,
      guid: "download-guid",
      suggestedFilename: "出售中全部商品.xlsx",
      reportedFilePath: "download-guid",
    }), guidPath);
    await rm(guidPath);
    await assert.rejects(() => resolveTmallStagedDownloadPath({
      stagingDirectory: staging,
      guid: "missing-guid",
      suggestedFilename: "出售中全部商品.xlsx",
      reportedFilePath: path.join(root, "outside", "download-guid"),
    }), /未落入本轮受控暂存目录/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("导出记录按原任务创建时间和已完成状态选择同一行下载", () => {
  const runStartedAt = "2026-08-03T17:54:17.650Z";
  assert.deepEqual(parseTmallShanghaiTaskTime("2026-08-04 01:54:\n44"), {
    text: "2026-08-04 01:54:44",
    epochMs: Date.parse("2026-08-04T01:54:44+08:00"),
  });
  assert.equal(parseTmallShanghaiTaskTime("2026-02-30 01:54:44"), null);
  assert.equal(parseTmallExportRecordStatus("334 5 2026-08-22 12:14:21 任务失败 下载"), "任务失败");
  assert.equal(parseTmallExportRecordStatus("处理失败数 0 生成成功 下载"), "已完成");
  assert.equal(parseTmallExportRecordStatus("任务生成中"), "处理中");
  assert.equal(chooseTmallExportRecordSignature([
    { signature: "later-duplicate", taskCreatedAt: "2026-08-04 02:01:32", status: "已完成" },
    { signature: "original", taskCreatedAt: "2026-08-04 01:54:44", status: "已完成" },
    { signature: "older", taskCreatedAt: "2026-08-01 23:49:09", status: "已完成" },
  ], runStartedAt), "original");
  assert.equal(chooseTmallExportRecordSignature([
    { signature: "original", taskCreatedAt: "2026-08-04 01:54:44", status: "处理中" },
  ], runStartedAt), null);
  const pending = {
    signature: "current-pending",
    taskCreatedAt: "2026-08-04 01:54:44",
    status: "处理中",
    downloadReady: false,
  };
  assert.deepEqual(matchTmallExportRecordChoice([pending], runStartedAt), pending);
  assert.equal(chooseTmallExportRecordSignature([pending], runStartedAt), null);
  assert.equal(chooseTmallExportRecordSignature([{
    ...pending,
    status: "已完成",
    downloadReady: true,
  }], runStartedAt), "current-pending");
  assert.equal(chooseTmallExportRecordSignature([{
    ...pending,
    status: "已完成",
    downloadReady: false,
  }], runStartedAt), null);
  assert.equal(chooseTmallExportRecordSignature([{
    signature: "previous-run",
    taskCreatedAt: "2026-08-04 01:54:10",
    status: "已完成",
    downloadReady: true,
  }], runStartedAt), null);
  assert.equal(chooseTmallExportRecordSignature([
    {
      signature: "same-row-main-frame",
      recordIdentity: "same-business-row",
      taskCreatedAt: "2026-08-04 01:54:44",
      status: "已完成",
      downloadReady: true,
    },
    {
      signature: "same-row-fixed-table",
      recordIdentity: "same-business-row",
      taskCreatedAt: "2026-08-04 01:54:44",
      status: "初始状态",
      downloadReady: false,
    },
  ], runStartedAt), "same-row-main-frame");
  assert.throws(() => chooseTmallExportRecordSignature([
    { signature: "tie-a", recordIdentity: "task-a", taskCreatedAt: "2026-08-04 01:54:47", status: "处理中" },
    { signature: "tie-b", recordIdentity: "task-b", taskCreatedAt: "2026-08-04 01:55:07", status: "已完成" },
  ], runStartedAt), /多个创建时间同样接近/);
  assert.throws(() => matchTmallExportRecordChoice([{
    signature: "failed-current-run",
    taskCreatedAt: "2026-08-04 01:54:44",
    status: "任务失败",
    downloadReady: true,
  }], runStartedAt), /明确显示任务失败/);
});

test("重要通知、商品巡检或发货异常提醒只允许右下角安全关闭动作", () => {
  const notice = {
    text: "重要通知",
    attributes: "",
    tag: "div",
    role: "",
    left: 1120,
    top: 650,
    width: 160,
    height: 32,
    viewportWidth: 1440,
    viewportHeight: 900,
  };
  const close = {
    text: "",
    attributes: "ant-notice-close 关闭",
    tag: "button",
    role: "button",
    left: 1350,
    top: 620,
    width: 28,
    height: 28,
    viewportWidth: 1440,
    viewportHeight: 900,
  };
  assert.ok(scoreImportantNoticeCloseCandidate(close, notice) > 0);
  assert.ok(scoreImportantNoticeCloseCandidate({
    ...close,
    text: "忽略",
    attributes: "next-btn",
    width: 180,
  }, { ...notice, text: "商品巡检" }) > 0);
  assert.equal(scoreImportantNoticeCloseCandidate({
    ...close,
    text: "去优化",
    attributes: "next-btn",
    width: 60,
  }, { ...notice, text: "商品巡检" }), -1);
  const shippingNotice = {
    ...notice,
    text: "发货异常提醒（延迟/缺货/虚假点击发货）",
    top: 500,
    width: 420,
  };
  assert.ok(scoreTmallBlockingNoticeCandidate(shippingNotice) > 0);
  const importantMessage = { ...shippingNotice, text: "重要消息 1" };
  const channelPromotion = { ...shippingNotice, text: "渠道活动快速报名，灵活售卖", top: 430 };
  assert.ok(scoreTmallBlockingNoticeCandidate(importantMessage) > 0);
  assert.ok(scoreTmallBlockingNoticeCandidate(channelPromotion) > scoreTmallBlockingNoticeCandidate(importantMessage));
  assert.ok(scoreImportantNoticeCloseCandidate(close, shippingNotice) > 0);
  assert.equal(scoreImportantNoticeCloseCandidate({
    ...close,
    text: "立即处理",
    attributes: "next-btn",
    width: 80,
  }, shippingNotice), -1);
  assert.equal(isExplicitTmallNoticeDismissAction({ ...close, text: "忽略", attributes: "next-btn" }), true);
  assert.equal(isExplicitTmallNoticeDismissAction({ ...close, text: "", attributes: "next-icon-close" }), true);
  assert.equal(isExplicitTmallNoticeDismissAction({ ...close, text: "×", attributes: "" }), true);
  assert.equal(isExplicitTmallNoticeDismissAction({ ...close, text: "立即处理", attributes: "next-btn" }), false);
  assert.equal(isExplicitTmallNoticeDismissAction({ ...close, text: "", attributes: "next-icon" }), false);
  const rankedActions = [
    { score: 30, signature: "unlabeled", explicitDismiss: false },
    { score: 30, signature: "close", explicitDismiss: true },
  ].sort(compareTmallNoticeActionCandidates);
  assert.equal(rankedActions[0]?.signature, "close");
  assert.equal(shouldRejectEqualTmallNoticeActions(rankedActions[0]!, rankedActions[1]), false);
  assert.equal(shouldRejectEqualTmallNoticeActions(
    { score: 30, signature: "unlabeled-a", explicitDismiss: false },
    { score: 30, signature: "unlabeled-b", explicitDismiss: false },
  ), true);
  assert.equal(sameTmallNoticeActionTarget(close, {
    ...close,
    left: 1356,
    top: 626,
    width: 16,
    height: 16,
    tag: "span",
    role: "",
    attributes: "next-icon next-icon-close",
  }), true);
  assert.equal(sameTmallNoticeActionTarget(close, {
    ...close,
    left: 1180,
    top: 700,
    width: 80,
    height: 32,
    text: "忽略",
    attributes: "next-btn",
  }), false);
  assert.equal(scoreImportantNoticeCloseCandidate({ ...close, left: 200, top: 120 }, notice), -1);
  assert.equal(scoreImportantNoticeCloseCandidate(close, { ...notice, left: 100, top: 100 }), -1);
  assert.ok(scoreTmallBlockingNoticeCandidate({
    ...notice,
    text: "",
    attributes: "notify_body__vpald",
    top: 500,
    width: 380,
    height: 160,
  }) > 0);
  const closableOverlay = {
    ...notice,
    text: "",
    attributes: "next-balloon next-balloon-closable next-overlay-inner",
    role: "tooltip",
    top: 590,
    width: 360,
    height: 180,
  };
  assert.equal(isTmallClosableOverlayNotice(closableOverlay), true);
  assert.ok(scoreTmallBlockingNoticeCandidate(closableOverlay) > scoreTmallBlockingNoticeCandidate({
    ...notice,
    text: "",
    attributes: "notify_body__vpald",
    top: 500,
    width: 380,
    height: 160,
  }));
  assert.equal(isTmallClosableOverlayNotice({ ...closableOverlay, attributes: "next-balloon" }), false);
  assert.equal(isTmallNoticePointerInterceptionError(new Error("another element intercepts pointer events")), true);
  assert.equal(isTmallNoticePointerInterceptionError(new Error("locator.click: Timeout exceeded")), false);
  assert.ok(scoreTmallBlockingNoticeCandidate(
    { ...notice, text: "商品巡检" },
    "商品巡检 商品当前存在以下问题，请及时关注：影响成交转化 质量分问题 忽略 去优化",
  ) > 0);
  assert.equal(scoreTmallBlockingNoticeCandidate(
    { ...notice, text: "商品巡检" },
    "商品搜索 商品巡检 商品ID查询 商品上架 商品下架",
  ), -1);
  assert.equal(scoreTmallBlockingNoticeCandidate({
    ...notice,
    text: "",
    attributes: "ordinary_body",
  }), -1);
});

test("下载文件必须位于店铺独立目录并通过发布模板结构校验", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tmall-master-export-"));
  const downloadDir = path.join(root, "tmall-yijiu");
  await mkdir(downloadDir);
  const filePath = path.join(downloadDir, "master.xlsx");
  await writeFile(filePath, masterWorkbook());
  const store = {
    shopName: "天猫-志高亿玖专卖店",
    browser: { profileDir: "unused", debugPort: 9999, downloadDir },
  };
  try {
    const evidence = await inspectTmallMasterFile(filePath, store, "2026-08-04");
    assert.equal(evidence.rowCount, 1);
    assert.equal(evidence.uniqueProductCount, 1);
    assert.equal(evidence.uniqueSkuCount, 1);
    assert.match(evidence.sha256, /^[a-f0-9]{64}$/);

    const outsidePath = path.join(root, "outside.xlsx");
    await writeFile(outsidePath, masterWorkbook());
    await assert.rejects(inspectTmallMasterFile(outsidePath, store, "2026-08-04"), /独立下载目录/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("货品导入要求精确批次身份和落库行数回查", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tmall-master-import-"));
  const filePath = path.join(root, "master.xlsx");
  await writeFile(filePath, masterWorkbook());
  const evidence = {
    fileName: "master.xlsx",
    filePath,
    fileSizeBytes: (await stat(filePath)).size,
    sha256: "0".repeat(64),
    rowCount: 1,
    uniqueProductCount: 1,
    uniqueSkuCount: 1,
  };
  try {
    const received: { form: FormData | null } = { form: null };
    const request = (async (_url: string | URL | Request, init?: RequestInit) => {
      received.form = init?.body as FormData;
      return Response.json({
        ok: true,
        status: "imported",
        batch: {
          id: "batch-1",
          source: "tmall_product_master",
          dataset: "product_master",
          platform: "天猫",
          shopName: "天猫-志高亿玖专卖店",
          snapshotDate: "2026-08-04",
          status: "completed",
          rowCount: 1,
          warningCount: 0,
        },
        verification: {
          verified: true,
          parsedRowCount: 1,
          readbackRowCount: 1,
          dataset: "product_master",
          platform: "天猫",
          shopName: "天猫-志高亿玖专卖店",
        },
      }, { status: 201 });
    }) as typeof fetch;
    const result = await importTmallProductMasterFile({
      baseUrl: "http://127.0.0.1:3000",
      store: { shopName: "天猫-志高亿玖专卖店" },
      snapshotDate: "2026-08-04",
      evidence,
      request,
    });
    assert.equal(result.status, "imported");
    assert.ok(received.form);
    assert.equal(received.form.get("source"), "tmall_product_master");
    assert.equal(received.form.get("shop_name"), "天猫-志高亿玖专卖店");
    assert.equal(received.form.get("snapshot_date"), "2026-08-04");

    const badReadback = (async () => Response.json({
      ok: true,
      status: "imported",
      batch: {
        id: "batch-2", source: "tmall_product_master", dataset: "product_master", platform: "天猫",
        shopName: "天猫-志高亿玖专卖店", snapshotDate: "2026-08-04", status: "completed", rowCount: 1, warningCount: 0,
      },
      verification: {
        verified: true, parsedRowCount: 1, readbackRowCount: 0, dataset: "product_master", platform: "天猫", shopName: "天猫-志高亿玖专卖店",
      },
    }, { status: 201 })) as typeof fetch;
    await assert.rejects(importTmallProductMasterFile({
      baseUrl: "http://127.0.0.1:3000",
      store: { shopName: "天猫-志高亿玖专卖店" },
      snapshotDate: "2026-08-04",
      evidence,
      request: badReadback,
    }), /导入或落库回查失败/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
