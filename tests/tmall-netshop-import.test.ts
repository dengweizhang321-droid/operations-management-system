import assert from "node:assert/strict";
import test from "node:test";

import { strToU8, unzipSync, zipSync } from "fflate";
import * as XLSX from "xlsx";

import {
  importNetshopBytes,
  inspectTmallImportBytes,
  type NetshopImportDatabaseDependencies,
  type NetshopImportFingerprintDependencies,
  TMALL_PLATFORM,
  TMALL_YIJIU_SHOP,
} from "../lib/netshop/import-service";
import {
  buildImportContentFingerprint,
} from "../lib/imports/content-fingerprint";
import { tmallStoreRegistryData } from "../lib/netshop/tmall-store-catalog";

const isolatedFingerprintDependencies: NetshopImportFingerprintDependencies = {
  auditRejectedImportResult: async (_db, _input, result) => result,
  buildImportContentFingerprint,
  buildImportAttemptHash: async () => "a".repeat(64),
  ensureImportFingerprintSchema: async () => undefined,
  failImportFingerprint: async () => undefined,
  nextImportScopeStateToken: async () => "published-test-state",
  readImportScopeStateToken: async () => "initial",
  recordImportFingerprint: async () => ({ attemptId: "attempt-record", recovered: false, recoveredFromAttemptId: null }),
  renewImportFingerprintReservation: async () => undefined,
  reserveImportFingerprint: async () => ({
    attemptId: "attempt-test",
    claimed: true,
    recoveredStaleReservation: false,
    resynchronizedState: false,
  }),
};

const duplicateFingerprintDependencies: NetshopImportFingerprintDependencies = {
  ...isolatedFingerprintDependencies,
  buildImportContentFingerprint: async (input) => ({
    ...await buildImportContentFingerprint(input),
    contentHash: "c".repeat(64),
  }),
};

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

function dailyFixtureWithProductIds(productIds: readonly string[]) {
  return workbookBytes([
    ["生意参谋商品明细"],
    ["统计日期", "商品ID", "商品名称", "货号", "商品访客数", "商品浏览量", "商品收藏人数", "商品加购件数", "支付买家数", "支付件数", "支付金额", "商品支付转化率", "成功退款金额", "搜索引导访客数"],
    ...productIds.map((productId, index) => ["2026-07-31", productId, `测试商品${index + 1}`, `ITEM-${index + 1}`, 10, 25, 2, 3, 1, 2, "123.45", "10%", "10.00", 4]),
  ], { bookType: "xls", sheetName: "商品" });
}

function dailyFixture() {
  return dailyFixtureWithProductIds(["10001"]);
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

test("天猫分页货品 XLSX 省略空发货时间列时仍按表头语义解析", async () => {
  const headers = [
    "商品Id", "类目id", "类目名称", "商品标题", "一口价", "导购标题", "商家编码", "最长发货时间",
    "销售属性", "属性对", "skuId", "价格（元）", "数量", "商家编码", "生产日期\n(格式：年-月-日 ~ 年-月-日)", "保质期（天）",
  ];
  const bytes = workbookBytes([
    ["发布模板"],
    [null],
    headers,
    ["10001", "cat", "测试类目", "测试商品", "10.00", null, "ITEM-CODE", 15, "颜色:红", null, "20001", "9.90", 5, "SKU-CODE", null, null],
  ], { bookType: "xlsx", sheetName: "发布模板" });

  const result = await inspectTmallImportBytes({
    source: "tmall_product_master",
    bytes,
    fileName: "page-2.xlsx",
    fileSizeBytes: bytes.byteLength,
    platform: "天猫",
    shopName: "天猫-志高拓丰专卖店",
    snapshotDate: "2026-08-22",
  });

  assert.deepEqual(result.errors, []);
  assert.equal(result.totals.rowCount, 1);
  assert.equal(result.totals.uniqueProductCount, 1);
  assert.equal(result.totals.uniqueSkuCount, 1);
  assert.equal(result.rows[0].raw["商品商家编码"], "ITEM-CODE");
  assert.equal(result.rows[0].raw["SKU商家编码"], "SKU-CODE");
  assert.equal(result.rows[0].raw["SKU库存"], 5);
  assert.equal(result.rows[0].raw["商品发货时间"], null);
  assert.equal(result.rows[0].raw["SKU发货时间"], null);
});

test("天猫货品 16 列与等价 18 列生成相同业务内容指纹", async () => {
  const compactHeaders = [
    "商品Id", "类目id", "类目名称", "商品标题", "一口价", "导购标题", "商家编码", "最长发货时间",
    "销售属性", "属性对", "skuId", "价格（元）", "数量", "商家编码", "生产日期（年/月/日）", "保质期",
  ];
  const fullHeaders = [
    "商品Id", "类目id", "类目名称", "商品标题", "一口价", "导购标题", "商家编码", "发货时间",
    "最长发货时间", "销售属性", "属性对", "发货时间", "skuId", "价格（元）", "数量", "商家编码",
    "生产日期（年/月/日）", "保质期",
  ];
  const compact = workbookBytes([["发布模板"], [null], compactHeaders,
    ["10001", "cat", "测试类目", "测试商品", "10.00", null, "ITEM", 15, "颜色:红", null, "20001", "9.90", 5, "SKU", null, null]],
  { bookType: "xlsx", sheetName: "发布模板" });
  const full = workbookBytes([["发布模板"], [null], fullHeaders,
    ["10001", "cat", "测试类目", "测试商品", "10.00", null, "ITEM", null, 15, "颜色:红", null, null, "20001", "9.90", 5, "SKU", null, null]],
  { bookType: "xlsx", sheetName: "发布模板" });
  const inspect = (bytes: Uint8Array, fileName: string) => inspectTmallImportBytes({
    source: "tmall_product_master", bytes, fileName, fileSizeBytes: bytes.byteLength,
    platform: "天猫", shopName: "天猫-志高拓丰专卖店", snapshotDate: "2026-08-22",
  });
  const [compactResult, fullResult] = await Promise.all([inspect(compact, "compact.xlsx"), inspect(full, "full.xlsx")]);
  const businessRows = (rows: typeof compactResult.rows) => rows.map((row) => ({
    source: row.source, dataset: row.dataset, platform: row.platform, shopName: row.shopName,
    businessDate: row.businessDate, snapshotDate: row.snapshotDate, productCode: row.productCode,
    productName: row.productName, skuId: row.skuId, spuId: row.spuId, warehouseType: row.warehouseType,
    metrics: row.metrics, raw: row.raw,
  }));
  const scope = { source: "tmall_product_master", dataset: "product_master", platform: "天猫", shopName: "天猫-志高拓丰专卖店", snapshotDate: "2026-08-22" };
  const [compactFingerprint, fullFingerprint] = await Promise.all([
    buildImportContentFingerprint({ domain: "netshop", scope, rows: businessRows(compactResult.rows) }),
    buildImportContentFingerprint({ domain: "netshop", scope, rows: businessRows(fullResult.rows) }),
  ]);
  assert.equal(compactFingerprint.contentHash, fullFingerprint.contentHash);
});

test("天猫货品缺少最长发货时间列时仍按销售属性区段识别商品与 SKU 发货时间", async () => {
  const inspect = (headers: string[], values: unknown[], fileName: string) => {
    const bytes = workbookBytes([["发布模板"], [null], headers, values], { bookType: "xlsx", sheetName: "发布模板" });
    return inspectTmallImportBytes({ source: "tmall_product_master", bytes, fileName, fileSizeBytes: bytes.byteLength,
      platform: "天猫", shopName: "天猫-志高拓丰专卖店", snapshotDate: "2026-08-22" });
  };
  const prefix = ["商品Id", "类目id", "类目名称", "商品标题", "一口价", "导购标题", "商家编码"];
  const suffix = ["skuId", "价格（元）", "数量", "商家编码", "生产日期（年/月/日）", "保质期"];
  const productOnly = await inspect([...prefix, "发货时间", "销售属性", "属性对", ...suffix],
    ["10001", "cat", "类目", "商品", 10, null, "ITEM", 2, "颜色:红", null, "20001", 9, 5, "SKU", null, null], "product-ship.xlsx");
  const skuOnly = await inspect([...prefix, "销售属性", "属性对", "发货时间", ...suffix],
    ["10001", "cat", "类目", "商品", 10, null, "ITEM", "颜色:红", null, 3, "20001", 9, 5, "SKU", null, null], "sku-ship.xlsx");
  const both = await inspect([...prefix, "发货时间", "销售属性", "属性对", "发货时间", ...suffix],
    ["10001", "cat", "类目", "商品", 10, null, "ITEM", 2, "颜色:红", null, 3, "20001", 9, 5, "SKU", null, null], "both-ship.xlsx");
  assert.equal(productOnly.rows[0].raw["商品发货时间"], 2);
  assert.equal(productOnly.rows[0].raw["SKU发货时间"], null);
  assert.equal(skuOnly.rows[0].raw["商品发货时间"], null);
  assert.equal(skuOnly.rows[0].raw["SKU发货时间"], 3);
  assert.equal(both.rows[0].raw["商品发货时间"], 2);
  assert.equal(both.rows[0].raw["SKU发货时间"], 3);
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

test("天猫样本检查返回解析出的受控店铺而不是固定店铺", async () => {
  const bytes = dailyFixture();
  const secondStore = tmallStoreRegistryData.stores.find((store) => store.storeKey === "tmall-lili");
  assert.ok(secondStore);
  const enabledBefore = secondStore.enabled;
  secondStore.enabled = true;
  try {
    const result = await inspectTmallImportBytes({
      source: "tmall_product_daily",
      bytes,
      fileName: "daily.xls",
      fileSizeBytes: bytes.byteLength,
      shopName: secondStore.shopName,
      expectedStartDate: "2026-07-31",
      expectedEndDate: "2026-07-31",
    });

    assert.equal(result.shopName, secondStore.shopName);
    assert.equal(result.rows[0]?.shopName, secondStore.shopName);
    assert.equal(JSON.parse(result.rows[0]!.sourceRowKey)[2], secondStore.shopName);
  } finally {
    secondStore.enabled = enabledBefore;
  }
});

test("生意参谋二进制 XLS 转换金额、比率并校验目标日期", async () => {
  const bytes = dailyFixture();
  const accepted = await inspectTmallImportBytes({
    source: "tmall_product_daily",
    bytes,
    fileName: "daily.xls",
    fileSizeBytes: bytes.byteLength,
    shopName: TMALL_YIJIU_SHOP,
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
    shopName: TMALL_YIJIU_SHOP,
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
    shopName: TMALL_YIJIU_SHOP,
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

test("阿里妈妈商品报表按日期和商品汇总计划维度后再生成唯一推广日事实", async () => {
  const itemPromotionCsv = strToU8([
    "日期,商品ID,商品名称,计划ID,计划名称,花费,净成交金额,总成交金额,展现量,点击量,净成交笔数,总成交笔数,总购物车数,收藏宝贝数",
    "2026-07-31,10001,测试商品,plan-a,计划A,10.00,20.00,30.00,100,10,1,2,3,1",
    "2026-07-31,10001,测试商品,plan-b,计划B,20.00,40.00,70.00,200,20,2,3,4,2",
  ].join("\r\n"));
  const bytes = zipSync({ "商品报表_20260801_110000.csv": itemPromotionCsv });
  const result = await inspectTmallImportBytes({
    source: "tmall_promotion",
    bytes,
    fileName: "商品报表.zip",
    fileSizeBytes: bytes.byteLength,
    shopName: TMALL_YIJIU_SHOP,
    expectedStartDate: "2026-07-31",
    expectedEndDate: "2026-07-31",
  });

  assert.deepEqual(result.errors, []);
  assert.equal(result.totals.rowCount, 1);
  assert.equal(result.totals.uniqueProductCount, 1);
  assert.equal(result.totals.spendCents, 3_000);
  assert.equal(result.totals.netTransactionAmountCents, 6_000);
  assert.equal(result.totals.impressions, 300);
  assert.equal(result.totals.clicks, 30);
  assert.equal(result.rows[0]?.spuId, "10001");
  assert.equal(result.rows[0]?.metrics.clickThroughRate, 0.1);
  assert.equal(result.rows[0]?.metrics.averageClickCostCents, 100);
  assert.equal(result.rows[0]?.raw["主体类型"], "商品");
  assert.equal(result.rows[0]?.raw["报表维度"], "商品,计划");
  assert.equal(result.rows[0]?.raw["计划明细行数"], 2);
  assert.equal(result.rows[0]?.raw["计划列表"], "plan-a:计划A|plan-b:计划B");
});

test("推广 ZIP 多 CSV 时拒绝解析", async () => {
  const bytes = zipSync({ "a.csv": gb18030PromotionCsv, "b.csv": gb18030PromotionCsv });
  await assert.rejects(
    inspectTmallImportBytes({
      source: "tmall_promotion",
      bytes,
      fileName: "promotion.zip",
      fileSizeBytes: bytes.byteLength,
      shopName: TMALL_YIJIU_SHOP,
      expectedStartDate: "2026-07-31",
      expectedEndDate: "2026-07-31",
    }),
    /必须且只能包含一个 CSV/,
  );
});

test("天猫日报与最新货品主数据零交集时阻止疑似跨店导入", async () => {
  const bytes = dailyFixtureWithProductIds(["20001", "20002", "20003", "20004", "20005"]);
  let saveCalls = 0;
  const dependencies = {
    getNetshopDatabase: () => ({}),
    ensureNetshopSchema: async () => undefined,
    findNetshopImportBatchById: async () => null,
    readNetshopScopeOwnership: async () => [],
    readNetshopScopeRows: async () => [],
    normalizeJdProductMasterRows: async () => undefined,
    reconcileNetshopMasterProducts: async () => ({
      masterAvailable: true,
      unmatchedCount: 5,
      unmatchedSample: ["20001"],
    }),
    sanitizeNetshopIssues: (issues: unknown[]) => issues,
    saveNetshopImport: async () => {
      saveCalls += 1;
      throw new Error("不应写入");
    },
    verifyNetshopImportBatch: async () => { throw new Error("不应回查"); },
  } as unknown as NetshopImportDatabaseDependencies;

  const result = await importNetshopBytes({
    source: "tmall_product_daily",
    bytes,
    fileName: "daily.xls",
    fileSizeBytes: bytes.byteLength,
    shopName: TMALL_YIJIU_SHOP,
    expectedStartDate: "2026-07-31",
    expectedEndDate: "2026-07-31",
  }, dependencies, isolatedFingerprintDependencies);

  assert.equal(saveCalls, 0);
  assert.equal(result.ok, false);
  assert.equal(result.status, "rejected");
  assert.deepEqual(result.errors?.map((issue) => issue.code), ["MASTER_IDENTITY_MISMATCH"]);
});

function duplicateDatabaseDependencies(input: {
  verified: boolean;
  replaceOnMismatch?: boolean;
  expectedFileSize: number;
  onVerify(): void;
}) {
  let saved = false;
  const batch = {
    id: "tmall-product-daily-batch",
    source: "tmall_product_daily" as const,
    dataset: "spu_daily",
    platform: TMALL_PLATFORM,
    shopName: TMALL_YIJIU_SHOP,
    fileName: "daily.xls",
    fileSizeBytes: input.expectedFileSize,
    fileHash: "existing-hash",
    sheetName: "商品",
    status: "completed",
    rowCount: 1,
    insertedCount: 1,
    duplicateCount: 0,
    warningCount: 0,
    dateMin: "2026-07-31",
    dateMax: "2026-07-31",
    snapshotDate: null,
    warnings: [],
    totals: { unmatchedProductCount: 0, contentHash: "c".repeat(64) },
    note: "",
    createdAt: "2026-08-01 00:00:00",
    completedAt: "2026-08-01 00:00:01",
  };
  const replacementBatch = { ...batch, id: "tmall-product-daily-replacement", fileHash: "a".repeat(64) };
  const database = {};
  return {
    getNetshopDatabase: () => database,
    ensureNetshopSchema: async () => undefined,
    findNetshopImportBatchById: async (_database: unknown, batchId: string) => {
      if (batchId === batch.id) return batch;
      if (batchId === replacementBatch.id) return replacementBatch;
      return null;
    },
    readNetshopScopeOwnership: async () => [{
      batchId: saved ? replacementBatch.id : batch.id,
      rowCount: 1,
    }],
    readNetshopScopeRows: async () => [],
    normalizeJdProductMasterRows: async () => undefined,
    reconcileNetshopMasterProducts: async () => ({ masterAvailable: true, unmatchedCount: 0, unmatchedSample: [] }),
    sanitizeNetshopIssues: (issues: unknown[]) => issues,
    saveNetshopImport: async () => {
      saved = true;
      return { batch: replacementBatch, created: true };
    },
    verifyNetshopImportBatch: async (_database: unknown, actualBatch: unknown, expected: {
      rowCount: number;
      dataset: string;
      platform: string;
      shopName: string;
      dateMin: string | null;
      dateMax: string | null;
    }) => {
      input.onVerify();
      const replacing = actualBatch === replacementBatch;
      assert.ok(actualBatch === batch || replacing);
      assert.deepEqual(expected, {
        rowCount: 1,
        dataset: "spu_daily",
        platform: TMALL_PLATFORM,
        shopName: TMALL_YIJIU_SHOP,
        dateMin: "2026-07-31",
        dateMax: "2026-07-31",
      });
      const verified = input.verified || Boolean(input.replaceOnMismatch && replacing);
      return {
        verified,
        parsedRowCount: expected.rowCount,
        readbackRowCount: verified ? expected.rowCount : 0,
        dateMin: verified ? expected.dateMin : null,
        dateMax: verified ? expected.dateMax : null,
        dataset: batch.dataset,
        platform: batch.platform,
        shopName: batch.shopName,
      };
    },
  } as unknown as NetshopImportDatabaseDependencies;
}

test("重复天猫文件必须经过真实落库回查后才能返回 duplicate", async () => {
  const bytes = dailyFixture();
  let verifiedCalls = 0;
  const accepted = await importNetshopBytes({
    source: "tmall_product_daily",
    bytes,
    fileName: "daily.xls",
    fileSizeBytes: bytes.byteLength,
    shopName: TMALL_YIJIU_SHOP,
    expectedStartDate: "2026-07-31",
    expectedEndDate: "2026-07-31",
  }, duplicateDatabaseDependencies({
    verified: true,
    expectedFileSize: bytes.byteLength,
    onVerify: () => { verifiedCalls += 1; },
  }), duplicateFingerprintDependencies);

  assert.equal(verifiedCalls, 1);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.status, "duplicate");
  assert.equal(accepted.verification?.verified, true);
  assert.equal(accepted.verification?.readbackRowCount, 1);
});

test("重复天猫文件允许同批次范围头确定性修复但拒绝其他并发状态", async () => {
  const bytes = dailyFixture();
  const run = (recordedStateToken: string) => {
    let tokenReads = 0;
    const dependencies: NetshopImportFingerprintDependencies = {
      ...duplicateFingerprintDependencies,
      readImportScopeStateToken: async () => {
        tokenReads += 1;
        return tokenReads < 3 ? "initial" : recordedStateToken;
      },
      nextImportScopeStateToken: async () => "published-test-state",
    };
    return importNetshopBytes({
      source: "tmall_product_daily",
      bytes,
      fileName: "daily.xls",
      fileSizeBytes: bytes.byteLength,
      shopName: TMALL_YIJIU_SHOP,
      expectedStartDate: "2026-07-31",
      expectedEndDate: "2026-07-31",
    }, duplicateDatabaseDependencies({
      verified: true,
      expectedFileSize: bytes.byteLength,
      onVerify: () => undefined,
    }), dependencies);
  };

  const repaired = await run("published-test-state");
  assert.equal(repaired.ok, true);
  assert.equal(repaired.status, "duplicate");

  const changed = await run("unrelated-concurrent-state");
  assert.equal(changed.ok, false);
  assert.equal(changed.status, "rejected");
  assert.deepEqual(changed.errors?.map((issue) => issue.code), ["IMPORT_SCOPE_CHANGED"]);
});

test("网店重复候选会重算当前事实内容，同批次同数量的字段损坏必须重新导入", async () => {
  const bytes = dailyFixture();
  let fingerprintCalls = 0;
  let verifiedCalls = 0;
  const mismatchedCurrentFacts: NetshopImportFingerprintDependencies = {
    ...isolatedFingerprintDependencies,
    buildImportContentFingerprint: async (input) => {
      const fingerprint = await buildImportContentFingerprint(input);
      fingerprintCalls += 1;
      return {
        ...fingerprint,
        contentHash: (fingerprintCalls === 1 ? "c" : "d").repeat(64),
      };
    },
  };

  const result = await importNetshopBytes({
    source: "tmall_product_daily",
    bytes,
    fileName: "daily.xls",
    fileSizeBytes: bytes.byteLength,
    shopName: TMALL_YIJIU_SHOP,
    expectedStartDate: "2026-07-31",
    expectedEndDate: "2026-07-31",
  }, duplicateDatabaseDependencies({
    verified: false,
    replaceOnMismatch: true,
    expectedFileSize: bytes.byteLength,
    onVerify: () => { verifiedCalls += 1; },
  }), mismatchedCurrentFacts);

  assert.equal(fingerprintCalls, 2);
  assert.equal(verifiedCalls, 1);
  assert.equal(result.ok, true);
  assert.equal(result.status, "imported");
  assert.equal(result.verification?.verified, true);
});

test("已被替换或当前事实不匹配的历史批次不会阻止差异内容重新导入", async () => {
  const bytes = dailyFixture();
  let verifiedCalls = 0;
  const rejected = await importNetshopBytes({
    source: "tmall_product_daily",
    bytes,
    fileName: "daily.xls",
    fileSizeBytes: bytes.byteLength,
    shopName: TMALL_YIJIU_SHOP,
    expectedStartDate: "2026-07-31",
    expectedEndDate: "2026-07-31",
  }, duplicateDatabaseDependencies({
    verified: false,
    replaceOnMismatch: true,
    expectedFileSize: bytes.byteLength,
    onVerify: () => { verifiedCalls += 1; },
  }), duplicateFingerprintDependencies);

  assert.equal(verifiedCalls, 2);
  assert.equal(rejected.ok, true);
  assert.equal(rejected.status, "imported");
  assert.equal(rejected.verification?.verified, true);
});
