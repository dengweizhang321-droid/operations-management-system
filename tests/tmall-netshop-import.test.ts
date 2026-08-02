import assert from "node:assert/strict";
import test from "node:test";

import { strToU8, unzipSync, zipSync } from "fflate";
import * as XLSX from "xlsx";

import {
  inspectTmallImportBytes,
  TMALL_PLATFORM,
  TMALL_YIJIU_SHOP,
} from "../lib/netshop/import-service";

function workbookBytes(rows: unknown[][], options: { bookType: "xlsx" | "xls"; sheetName: string }) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), options.sheetName);
  return new Uint8Array(XLSX.write(workbook, { type: "array", bookType: options.bookType }));
}

function masterFixture() {
  const headers = [
    "商品Id", "类目id", "类目名称", "商品标题", "一口价", "导购标题", "商家编码", "发货时间",
    "最长发货时间", "销售属性", "属性对", "发货时间", "skuId", "价格（元）", "数量", "商家编码",
    "生产日期（年/月/日）", "保质期",
  ];
  const bytes = workbookBytes([
    ["发布模板"],
    [null],
    headers,
    ["10001", "cat", "测试类目", "测试商品", "10.00", null, "ITEM-CODE", 2, 15, "颜色:红", null, null, null, "9.90", 5, "DUP-CODE", "-", "nan"],
    ["10001", "cat", "测试类目", "测试商品", "10.00", null, "ITEM-CODE", 2, 15, "颜色:蓝", null, null, "20002", "8.80", 7, "DUP-CODE", null, null],
  ], { bookType: "xlsx", sheetName: "发布模板" });

  // The real export can declare a stale worksheet dimension. Ensure parsing
  // follows actual cell references rather than the dimension hint.
  const archive = unzipSync(bytes);
  const sheetPath = "xl/worksheets/sheet1.xml";
  const xml = new TextDecoder().decode(archive[sheetPath]).replace(/<dimension ref="[^"]+"\s*\/>/, '<dimension ref="A1:A1"/>');
  archive[sheetPath] = strToU8(xml);
  return zipSync(archive);
}

function dailyFixture() {
  return workbookBytes([
    ["生意参谋商品明细"],
    ["统计日期", "商品ID", "商品名称", "货号", "商品访客数", "商品浏览量", "商品收藏人数", "商品加购件数", "支付买家数", "支付件数", "支付金额", "商品支付转化率", "成功退款金额", "搜索引导访客数"],
    ["2026-07-31", "10001", "测试商品", "ITEM-CODE", 10, 25, 2, 3, 1, 2, "123.45", "10%", "10.00", 4],
  ], { bookType: "xls", sheetName: "商品" });
}

const gb18030PromotionCsv = Buffer.from(
  "yNXG2izW98zlSUQs1vfM5cDg0M0s1vfM5cP7s8Ysu6i30Sy+u7PJvbu98LbuLNfcs8m9u73wtu4svrvKtbzKzbay+rHILMq1vMrNtrL6scgs1bnP1sG/LLXju/fBvyy147v3wsosxr2++bXju/e7qLfRLMentM7Vuc/Wu6i30Sy+u7PJvbuxysr9LNfcs8m9u7HKyv0steO799equ6/CyizWsb3Tvruzyb27vfC27izWsb3Tvruzyb27scrK/SzX3Lm6zu+ztcr9LNaxvdO5us7vs7XK/SzK1bLYsaaxtMr9LNaxvdPK1bLYsaaxtMr9LLGmsbTK1bLYvNO5usr9DQoyMDI2LTA3LTMxLDEwMDAxLMnMxrcssuLK1MnMxrcsbmFuLDEyLjM0LDE1LjAwLG5hbiwzLjAsMTAwLDUsNSUsbmFuLDEwLDEsMiwyMCUsNS4wMCwxLDMsMiwxLDAsNA0K",
  "base64",
);

test("天猫货品 XLSX 按列位区分重复表头并忽略错误 dimension", async () => {
  const bytes = masterFixture();
  const result = await inspectTmallImportBytes({
    source: "tmall_product_master",
    bytes,
    fileName: "master.xlsx",
    fileSizeBytes: bytes.byteLength,
    platform: "不可信平台",
    shopName: TMALL_YIJIU_SHOP,
    snapshotDate: "2026-08-01",
  });

  assert.equal(result.platform, TMALL_PLATFORM);
  assert.equal(result.shopName, TMALL_YIJIU_SHOP);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.totals, {
    rowCount: 2,
    uniqueProductCount: 1,
    uniqueSkuCount: 1,
    missingSkuCount: 1,
    inventoryQuantity: 12,
    transactionAmountCents: 0,
    refundAmountCents: 0,
    spendCents: 0,
    netTransactionAmountCents: 0,
    impressions: 0,
    clicks: 0,
    netOrders: 0,
    dateMin: null,
    dateMax: null,
  });
  assert.equal(result.rows[0].raw["SKU商家编码"], "DUP-CODE");
  assert.equal(result.rows[0].raw["生产日期"], null);
  assert.notEqual(result.rows[0].sourceRowKey, result.rows[1].sourceRowKey);
});

test("天猫导入拒绝未注册或未启用店铺", async () => {
  const bytes = dailyFixture();
  await assert.rejects(
    inspectTmallImportBytes({
      source: "tmall_product_daily",
      bytes,
      fileName: "daily.xls",
      fileSizeBytes: bytes.byteLength,
      shopName: "天猫-未注册店铺",
      expectedStartDate: "2026-07-31",
      expectedEndDate: "2026-07-31",
    }),
    /未注册或未启用/,
  );
});

test("生意参谋二进制 XLS 转换金额、比率并校验目标日期", async () => {
  const bytes = dailyFixture();
  const accepted = await inspectTmallImportBytes({
    source: "tmall_product_daily",
    bytes,
    fileName: "daily.xls",
    fileSizeBytes: bytes.byteLength,
    expectedStartDate: "2026-07-31",
    expectedEndDate: "2026-07-31",
  });
  assert.deepEqual(accepted.errors, []);
  assert.equal(accepted.totals.transactionAmountCents, 12_345);
  assert.equal(accepted.totals.refundAmountCents, 1_000);
  assert.equal(accepted.rows[0].metrics.conversionRate, 0.1);
  assert.equal(accepted.rows[0].metrics.searchVisitors, 4);

  const rejected = await inspectTmallImportBytes({
    source: "tmall_product_daily",
    bytes,
    fileName: "daily.xls",
    fileSizeBytes: bytes.byteLength,
    expectedStartDate: "2026-08-01",
    expectedEndDate: "2026-08-01",
  });
  assert.deepEqual(rejected.errors.map((issue) => issue.code), ["MISSING_EXPECTED_DATES", "OUT_OF_RANGE_DATES"]);
});

test("推广 ZIP 按 GB18030 解码并把 nan 规范为 null", async () => {
  const bytes = zipSync({ "promotion.csv": gb18030PromotionCsv });
  const result = await inspectTmallImportBytes({
    source: "tmall_promotion",
    bytes,
    fileName: "promotion.zip",
    fileSizeBytes: bytes.byteLength,
    expectedStartDate: "2026-07-31",
    expectedEndDate: "2026-07-31",
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.totals.spendCents, 0);
  assert.equal(result.totals.netTransactionAmountCents, 1_234);
  assert.equal(result.totals.impressions, 100);
  assert.equal(result.totals.clicks, 5);
  assert.equal(result.rows[0].raw["花费"], null);
  assert.equal(result.rows[0].metrics.clickThroughRate, 0.05);
});

test("推广 ZIP 多 CSV 时拒绝解析", async () => {
  const bytes = zipSync({ "a.csv": gb18030PromotionCsv, "b.csv": gb18030PromotionCsv });
  await assert.rejects(
    inspectTmallImportBytes({
      source: "tmall_promotion",
      bytes,
      fileName: "promotion.zip",
      fileSizeBytes: bytes.byteLength,
      expectedStartDate: "2026-07-31",
      expectedEndDate: "2026-07-31",
    }),
    /必须且只能包含一个 CSV/,
  );
});
