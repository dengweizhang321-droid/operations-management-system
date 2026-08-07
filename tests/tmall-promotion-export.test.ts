import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertPromotionCoveragePayload,
  assertPromotionImportPayload,
  clickCalendarMonthArrowWithFallback,
  chooseTmallPromotionDownloadTask,
  isPromotionMetricSelectionState,
  isPromotionReportSuccessNavigation,
  isSafePromotionDismissLabel,
  parsePromotionTaskDateRange,
  planTmallPromotionDailyReports,
  planTmallPromotionDateRange,
  promotionNativeDialogAction,
  promotionDatePickerRole,
  promotionSuccessNavigationMissingMessage,
  runPromotionDailyPlansSequentially,
  runTmallPromotionStage,
  shouldRecoverSubmittedPromotionTask,
  TMALL_PROMOTION_DOWNLOAD_LIST_URL,
  TMALL_PROMOTION_ENTRY_URL,
} from "../tools/tmall-promotion-export";
import { TMALL_SELLER_ON_SALE_URL } from "../tools/tmall-product-master-export";

function requestedPeriodFromFetchInput(input: Parameters<typeof fetch>[0]) {
  const url = new URL(typeof input === "string" || input instanceof URL ? input.toString() : input.url);
  return {
    startDate: url.searchParams.get("startDate")!,
    endDate: url.searchParams.get("endDate")!,
  };
}

test("推广目标日期不因已有覆盖而跳过，并为每个业务日生成独立报表", () => {
  const productDailyDates = [
    "2026-07-28", "2026-07-29", "2026-07-30", "2026-07-31",
    "2026-08-02", "2026-08-03",
  ];
  const plans = planTmallPromotionDailyReports({
    requestedStartDate: "2026-07-28",
    requestedEndDate: "2026-08-04",
    productDailyDates,
    promotionDates: ["2026-07-28"],
  });
  assert.deepEqual(plans, [
    { startDate: "2026-07-28", endDate: "2026-07-28", dates: ["2026-07-28"] },
    { startDate: "2026-07-29", endDate: "2026-07-29", dates: ["2026-07-29"] },
    { startDate: "2026-07-30", endDate: "2026-07-30", dates: ["2026-07-30"] },
    { startDate: "2026-07-31", endDate: "2026-07-31", dates: ["2026-07-31"] },
    { startDate: "2026-08-02", endDate: "2026-08-02", dates: ["2026-08-02"] },
    { startDate: "2026-08-03", endDate: "2026-08-03", dates: ["2026-08-03"] },
  ]);
  assert.deepEqual(planTmallPromotionDateRange({
    requestedStartDate: "2026-07-28",
    requestedEndDate: "2026-08-04",
    productDailyDates,
    promotionDates: ["2026-07-28"],
  }), plans[0]);

  const longDates = Array.from({ length: 40 }, (_, index) => {
    const date = new Date("2026-01-01T00:00:00Z");
    date.setUTCDate(date.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
  assert.equal(planTmallPromotionDailyReports({
    requestedStartDate: longDates[0]!,
    requestedEndDate: longDates[longDates.length - 1]!,
    productDailyDates: longDates,
    promotionDates: [],
  }).length, 30);
  assert.deepEqual(planTmallPromotionDailyReports({
    requestedStartDate: "2026-07-28",
    requestedEndDate: "2026-08-04",
    productDailyDates,
    promotionDates: productDailyDates,
  }), productDailyDates.map((date) => ({ startDate: date, endDate: date, dates: [date] })));
});

test("推广显式日期始终执行且仍要求商品日先覆盖", () => {
  const input = {
    requestedStartDate: "2026-08-01",
    requestedEndDate: "2026-08-05",
    productDailyDates: ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05"],
    promotionDates: ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05"],
  } as const;
  assert.deepEqual(planTmallPromotionDailyReports({
    ...input,
    requestedDates: ["2026-08-05", "2026-08-01", "2026-08-03", "2026-08-01"],
    forceExistingDates: true,
  }), [
    { startDate: "2026-08-01", endDate: "2026-08-01", dates: ["2026-08-01"] },
    { startDate: "2026-08-03", endDate: "2026-08-03", dates: ["2026-08-03"] },
    { startDate: "2026-08-05", endDate: "2026-08-05", dates: ["2026-08-05"] },
  ]);
  assert.deepEqual(planTmallPromotionDailyReports({
    ...input,
    forceExistingDates: true,
  }), input.productDailyDates.map((date) => ({ startDate: date, endDate: date, dates: [date] })));
  assert.throws(() => planTmallPromotionDailyReports({
    ...input,
    requestedDates: ["2026-08-03", "2026-08-04"],
    productDailyDates: ["2026-08-03"],
    forceExistingDates: true,
  }), /缺少商品日覆盖：2026-08-04/);
  assert.throws(() => planTmallPromotionDailyReports({
    ...input,
    requestedDates: ["2026-08-01", "2026-08-02"],
    forceExistingDates: true,
    maximumDays: 1,
  }), /超过单轮 1 天上限/);
});

test("推广日报严格串行执行且任意一天失败后不再处理后续日期", async () => {
  const plans = ["2026-08-01", "2026-08-02", "2026-08-03"].map((date) => ({
    startDate: date,
    endDate: date,
    dates: [date],
  }));
  const visited: string[] = [];
  await assert.rejects(runPromotionDailyPlansSequentially(plans, async (plan) => {
    visited.push(plan.startDate);
    if (plan.startDate === "2026-08-02") throw new Error("day_failed");
    return plan.startDate;
  }), /day_failed/);
  assert.deepEqual(visited, ["2026-08-01", "2026-08-02"]);

  await assert.rejects(runPromotionDailyPlansSequentially([{
    startDate: "2026-08-01",
    endDate: "2026-08-02",
    dates: ["2026-08-01", "2026-08-02"],
  }], async () => "should_not_run"), /必须按单个业务日下载/);
});

test("下载任务日期同时兼容同日起止范围和带标签的单日展示", () => {
  assert.deepEqual(parsePromotionTaskDateRange("日期范围 2026-08-05至2026-08-05 创建日期 2026-08-06"), {
    startDate: "2026-08-05",
    endDate: "2026-08-05",
  });
  assert.deepEqual(parsePromotionTaskDateRange("数据日期：2026-08-05 创建日期 2026-08-06"), {
    startDate: "2026-08-05",
    endDate: "2026-08-05",
  });
  assert.equal(parsePromotionTaskDateRange("创建日期 2026-08-06"), null);
});

test("下载中心只选择本轮日期、创建时间、成功状态和唯一下载动作一致的任务", () => {
  const runStartedAt = new Date(Date.now() - 30_000).toISOString();
  const createdAt = new Date(Date.now() - 5_000).toISOString();
  const common = {
    fileName: "报表_20260805_230918",
    startDate: "2026-07-29",
    endDate: "2026-08-04",
    createdAt,
    downloadReady: true,
  };
  const candidates = [
    { ...common, signature: "old-range", startDate: "2026-07-28", status: "生成成功" },
    { ...common, signature: "pending", status: "生成中" },
    { ...common, signature: "current", status: "生成成功" },
  ];
  assert.equal(chooseTmallPromotionDownloadTask(candidates, {
    startDate: "2026-07-29",
    endDate: "2026-08-04",
    runStartedAt,
  }), "current");

  assert.equal(chooseTmallPromotionDownloadTask([
    { ...common, signature: "same-time-a", status: "生成成功" },
    { ...common, signature: "same-time-b", status: "生成成功" },
  ], {
    startDate: "2026-07-29",
    endDate: "2026-08-04",
    runStartedAt,
  }), null);
  assert.equal(chooseTmallPromotionDownloadTask([
    { ...common, signature: "newer", status: "生成成功" },
    { ...common, signature: "older", status: "生成成功", createdAt: new Date(Date.now() - 10_000).toISOString() },
  ], {
    startDate: "2026-07-29",
    endDate: "2026-08-04",
    runStartedAt,
  }), null);
  assert.match(TMALL_PROMOTION_DOWNLOAD_LIST_URL, /#!\/report\/download-list$/);
});

test("平台消息和广告弹窗只允许无业务副作用的明确关闭动作", () => {
  for (const label of ["关闭", "忽略", "暂不", "稍后", "以后再说", "我知道了", "×", "close"]) {
    assert.equal(isSafePromotionDismissLabel(label), true, label);
  }
  for (const label of ["去优化", "立即处理", "立即报名", "查看详情", "前往下载", "开通"]) {
    assert.equal(isSafePromotionDismissLabel(label), false, label);
  }
});

test("原生对话框只自动处理明确的无数据信息，未知文案必须停止", () => {
  assert.equal(promotionNativeDialogAction({ type: "alert", message: "提示：暂无数据。" }), "dismiss");
  assert.equal(promotionNativeDialogAction({ type: "alert", message: "暂无可下载数据" }), "dismiss");
  assert.equal(promotionNativeDialogAction({ type: "confirm", message: "是否创建报表？" }), "stop");
  assert.equal(promotionNativeDialogAction({ type: "alert", message: "请完成验证码" }), "stop");
});

test("全部数据指标必须能从 checked 或 selected 状态得到确认", () => {
  assert.equal(isPromotionMetricSelectionState({ checked: true }), true);
  assert.equal(isPromotionMetricSelectionState({ attributeValues: ["false", "true"] }), true);
  assert.equal(isPromotionMetricSelectionState({ classNames: ["ant-checkbox-wrapper ant-checkbox-wrapper-checked"] }), true);
  assert.equal(isPromotionMetricSelectionState({ checked: false, attributeValues: ["false"], classNames: ["ant-checkbox-wrapper"] }), false);
  assert.equal(isPromotionMetricSelectionState({ classNames: ["unchecked unselected"] }), false);
});

test("确认报表后只点击生成成功提示中的前往下载动作", () => {
  const successNotice = "离线数据生成成功！您可以在下载任务管理中将报表内容保存到本地，文案仅为示意 立即前往";
  assert.equal(isPromotionReportSuccessNavigation({ label: "立即前往", context: successNotice }), true);
  assert.equal(isPromotionReportSuccessNavigation({ label: "前往下载", context: successNotice }), true);
  assert.equal(isPromotionReportSuccessNavigation({ label: "立即前往", context: "全站流量打爆，立即前往" }), false);
  assert.equal(isPromotionReportSuccessNavigation({ label: "查看详情", context: successNotice }), false);
  assert.equal(isSafePromotionDismissLabel("立即前往"), false);
  assert.equal(shouldRecoverSubmittedPromotionTask(new Error(promotionSuccessNavigationMissingMessage)), true);
  assert.equal(shouldRecoverSubmittedPromotionTask(new Error("点击前往下载后出现多个下载任务页面，为防止接管错误页面已停止")), true);
  assert.equal(shouldRecoverSubmittedPromotionTask(new Error("点击前往下载后未进入下载任务管理页面")), true);
  assert.equal(shouldRecoverSubmittedPromotionTask(new Error("locator.click: Timeout 10000ms exceeded. element was detached from the DOM while clicking 立即前往")), true);
  assert.equal(shouldRecoverSubmittedPromotionTask(new Error("报表生成成功提示中存在多个前往下载操作，为防止误点已停止")), false);
  assert.equal(shouldRecoverSubmittedPromotionTask(new Error("阿里妈妈登录身份与受控店铺不一致")), false);
});

test("推广报表必须从千牛店铺后台入口逐级进入", () => {
  assert.equal(TMALL_PROMOTION_ENTRY_URL, TMALL_SELLER_ON_SALE_URL);
  assert.match(TMALL_PROMOTION_ENTRY_URL, /^https:\/\/myseller\.taobao\.com\/home\.htm\/SellManage\/on_sale/);
  assert.match(TMALL_PROMOTION_DOWNLOAD_LIST_URL, /^https:\/\/one\.alimama\.com\//);
});

test("推广日期弹层能识别自定义组件的起止控件", () => {
  assert.equal(promotionDatePickerRole("mx_output_x\u001emagix-portsaH({trigger:'start'})"), "start");
  assert.equal(promotionDatePickerRole('mx_output_x\u001emagix-portsaH({trigger:"end"})'), "end");
  assert.equal(promotionDatePickerRole("mx_output_x\u001emagix-portsaH()"), null);
});

test("日期月份主点击超时但已经生效时不重复点击，未生效时才使用受控后备点击", async () => {
  let month = "2026-07";
  let fallbackClicks = 0;
  const changed = await clickCalendarMonthArrowWithFallback({
    beforeMonth: month,
    targetMonth: "2026-08",
    click: async () => {
      month = "2026-08";
      throw new Error("actionability timeout after click");
    },
    fallbackClick: async () => { fallbackClicks += 1; },
    readMonth: async () => month,
    primaryWaitMs: 5,
    finalWaitMs: 5,
  });
  assert.equal(changed, "2026-08");
  assert.equal(fallbackClicks, 0);

  month = "2026-07";
  const recovered = await clickCalendarMonthArrowWithFallback({
    beforeMonth: month,
    targetMonth: "2026-08",
    click: async () => { throw new Error("element is unstable"); },
    fallbackClick: async () => {
      fallbackClicks += 1;
      month = "2026-08";
    },
    readMonth: async () => month,
    primaryWaitMs: 5,
    finalWaitMs: 5,
  });
  assert.equal(recovered, "2026-08");
  assert.equal(fallbackClicks, 1);
});

test("推广导入结果必须同时匹配来源、店铺、日期、行数和落库回查", () => {
  const payload = {
    ok: true,
    status: "imported",
    batch: {
      id: "batch-1",
      source: "tmall_promotion",
      dataset: "promotion_daily",
      platform: "天猫",
      shopName: "天猫-志高亿玖专卖店",
      status: "completed",
      rowCount: 12,
      warningCount: 1,
      dateMin: "2026-07-29",
      dateMax: "2026-08-04",
    },
    verification: {
      verified: true,
      parsedRowCount: 12,
      readbackRowCount: 12,
      dataset: "promotion_daily",
      platform: "天猫",
      shopName: "天猫-志高亿玖专卖店",
      dateMin: "2026-07-29",
      dateMax: "2026-08-04",
    },
  };
  const expected = {
    shopName: "天猫-志高亿玖专卖店",
    startDate: "2026-07-29",
    endDate: "2026-08-04",
    rowCount: 12,
  };
  assert.deepEqual(assertPromotionImportPayload(payload, 201, expected), {
    batchId: "batch-1",
    status: "imported",
    warningCount: 1,
  });
  assert.deepEqual(assertPromotionImportPayload({ ...payload, status: "duplicate" }, 200, expected), {
    batchId: "batch-1",
    status: "duplicate",
    warningCount: 1,
  });
  assert.throws(() => assertPromotionImportPayload(payload, 200, expected), /不一致/);
  assert.throws(() => assertPromotionImportPayload({
    ...payload,
    verification: { ...payload.verification, parsedRowCount: 11 },
  }, 201, expected), /不一致/);
  assert.throws(() => assertPromotionImportPayload({
    ...payload,
    batch: { ...payload.batch, shopName: "天猫-志高丽力专卖店" },
  }, 201, expected), /不一致/);
});

test("推广覆盖响应必须精确匹配请求周期并拒绝非法日期", () => {
  const expected = { startDate: "2026-07-28", endDate: "2026-08-04" };
  assert.deepEqual(assertPromotionCoveragePayload({
    requestedPeriod: expected,
    coverage: {
      productDailyDates: ["2026-07-29", "2026-07-28", "2026-07-29"],
      promotionDates: ["2026-07-28"],
    },
  }, expected), {
    productDailyDates: ["2026-07-28", "2026-07-29"],
    promotionDates: ["2026-07-28"],
  });
  assert.throws(() => assertPromotionCoveragePayload({
    requestedPeriod: { startDate: "2026-07-29", endDate: "2026-08-04" },
    coverage: { productDailyDates: [], promotionDates: [] },
  }, expected), /requestedPeriod/);
  assert.throws(() => assertPromotionCoveragePayload({
    requestedPeriod: expected,
    coverage: { productDailyDates: ["2026-02-30"], promotionDates: [] },
  }, expected), /非法日期/);
  assert.throws(() => assertPromotionCoveragePayload({
    requestedPeriod: expected,
    coverage: { productDailyDates: ["2026-07-27"], promotionDates: [] },
  }, expected), /请求区间外日期/);
});

test("没有商品日覆盖时推广阶段明确等待并通过失败状态让调用链重试", async () => {
  const request = (async (input: Parameters<typeof fetch>[0]) => Response.json({
    requestedPeriod: requestedPeriodFromFetchInput(input),
    coverage: { productDailyDates: [], promotionDates: [] },
  })) as typeof fetch;
  await assert.rejects(runTmallPromotionStage({
    storeKey: "tmall-yijiu",
    baseUrl: "http://localhost:3000",
    request,
  }), /waiting_product_daily/);
});

test("推广阶段 maximumDays 能把单轮日任务限制为一个且默认规划器上限不变", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tmall-promotion-limit-"));
  let requestCount = 0;
  const executedDates: string[] = [];
  try {
    const request = (async (input: Parameters<typeof fetch>[0]) => {
      requestCount += 1;
      const requestedPeriod = requestedPeriodFromFetchInput(input);
      const singleDay = requestedPeriod.startDate === requestedPeriod.endDate;
      return Response.json({
        requestedPeriod,
        coverage: singleDay
          ? { productDailyDates: [requestedPeriod.startDate], promotionDates: [requestedPeriod.startDate] }
          : { productDailyDates: ["2026-07-28", "2026-07-29"], promotionDates: [] },
      });
    }) as typeof fetch;
    const result = await runTmallPromotionStage({
      storeKey: "tmall-yijiu",
      baseUrl: "http://localhost:3000",
      request,
      auditDirectory: directory,
      dates: ["2026-07-28"],
      maximumDays: 1,
      executeDate: async ({ plan }) => {
        executedDates.push(plan.startDate);
        return {
          ok: true,
          stage: "promotion_day" as const,
          status: "duplicate" as const,
          storeKey: "tmall-yijiu",
          shopName: "天猫-志高亿玖专卖店",
          date: plan.startDate,
          startDate: plan.startDate,
          endDate: plan.endDate,
          dates: plan.dates,
          metrics: "全部数据指标" as const,
          fileName: "promotion.zip",
          sha256: "a".repeat(64),
          rowCount: 1,
          warningCount: 0,
          batchId: "batch-1",
          coverageConfirmed: true,
        };
      },
    });
    assert.deepEqual(result.plannedDates, ["2026-07-28"]);
    assert.deepEqual(result.completedDates, ["2026-07-28"]);
    assert.equal(result.coverageConfirmed, true);
    assert.deepEqual(executedDates, ["2026-07-28"]);
    assert.equal(requestCount, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("损坏的推广恢复清单必须失败关闭且测试不读取真实活动清单", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tmall-promotion-audit-"));
  try {
    await writeFile(path.join(directory, "active-tmall-yijiu.json"), "{broken", "utf8");
    const request = (async (input: Parameters<typeof fetch>[0]) => Response.json({
      requestedPeriod: requestedPeriodFromFetchInput(input),
      coverage: { productDailyDates: ["2026-07-28"], promotionDates: [] },
    })) as typeof fetch;
    await assert.rejects(runTmallPromotionStage({
      storeKey: "tmall-yijiu",
      baseUrl: "http://localhost:3000",
      request,
      auditDirectory: directory,
      dates: ["2026-07-28"],
    }), /JSON|Unexpected|结构无效/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
