import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertPromotionImportPayload,
  chooseTmallPromotionDownloadTask,
  isPromotionReportSuccessNavigation,
  isSafePromotionDismissLabel,
  planTmallPromotionDateRange,
  runTmallPromotionStage,
  TMALL_PROMOTION_DOWNLOAD_LIST_URL,
} from "../tools/tmall-promotion-export";

test("推广缺口只选择已有商品日数据中最早的连续区间并保持 30 天上限", () => {
  const productDailyDates = [
    "2026-07-28", "2026-07-29", "2026-07-30", "2026-07-31",
    "2026-08-02", "2026-08-03",
  ];
  const plan = planTmallPromotionDateRange({
    requestedStartDate: "2026-07-28",
    requestedEndDate: "2026-08-04",
    productDailyDates,
    promotionDates: ["2026-07-28"],
  });
  assert.deepEqual(plan, {
    startDate: "2026-07-29",
    endDate: "2026-07-31",
    dates: ["2026-07-29", "2026-07-30", "2026-07-31"],
  });

  const longDates = Array.from({ length: 40 }, (_, index) => {
    const date = new Date("2026-01-01T00:00:00Z");
    date.setUTCDate(date.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
  assert.equal(planTmallPromotionDateRange({
    requestedStartDate: longDates[0]!,
    requestedEndDate: longDates[longDates.length - 1]!,
    productDailyDates: longDates,
    promotionDates: [],
  })?.dates.length, 30);
  assert.equal(planTmallPromotionDateRange({
    requestedStartDate: "2026-07-28",
    requestedEndDate: "2026-08-04",
    productDailyDates,
    promotionDates: productDailyDates,
  }), null);
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

test("确认报表后只点击生成成功提示中的前往下载动作", () => {
  const successNotice = "离线数据生成成功！您可以在下载任务管理中将报表内容保存到本地，文案仅为示意 立即前往";
  assert.equal(isPromotionReportSuccessNavigation({ label: "立即前往", context: successNotice }), true);
  assert.equal(isPromotionReportSuccessNavigation({ label: "前往下载", context: successNotice }), true);
  assert.equal(isPromotionReportSuccessNavigation({ label: "立即前往", context: "全站流量打爆，立即前往" }), false);
  assert.equal(isPromotionReportSuccessNavigation({ label: "查看详情", context: successNotice }), false);
  assert.equal(isSafePromotionDismissLabel("立即前往"), false);
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
      readbackRowCount: 12,
      dataset: "promotion_daily",
      platform: "天猫",
      shopName: "天猫-志高亿玖专卖店",
      dateMin: "2026-07-29",
      dateMax: "2026-08-04",
    },
  };
  assert.deepEqual(assertPromotionImportPayload(payload, {
    shopName: "天猫-志高亿玖专卖店",
    startDate: "2026-07-29",
    endDate: "2026-08-04",
    rowCount: 12,
  }), { batchId: "batch-1", status: "imported", warningCount: 1 });
  assert.throws(() => assertPromotionImportPayload({
    ...payload,
    batch: { ...payload.batch, shopName: "天猫-志高丽力专卖店" },
  }, {
    shopName: "天猫-志高亿玖专卖店",
    startDate: "2026-07-29",
    endDate: "2026-08-04",
    rowCount: 12,
  }), /不一致/);
});

test("损坏的推广恢复清单必须失败关闭且测试不读取真实活动清单", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tmall-promotion-audit-"));
  try {
    await writeFile(path.join(directory, "active-tmall-yijiu.json"), "{broken", "utf8");
    const request = (async () => Response.json({
      requestedPeriod: { startDate: "2026-07-28", endDate: "2026-08-04" },
      coverage: { productDailyDates: ["2026-07-28"], promotionDates: [] },
    })) as typeof fetch;
    await assert.rejects(runTmallPromotionStage({
      storeKey: "tmall-yijiu",
      baseUrl: "http://localhost:3000",
      request,
      auditDirectory: directory,
    }), /JSON|Unexpected|结构无效/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
