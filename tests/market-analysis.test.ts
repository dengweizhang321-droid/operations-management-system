import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import * as XLSX from "xlsx";
import { parseMarketRows, parseRange, parseRangeBounds } from "../lib/market/parser";
import { aggregateMarketEstimates, annotateRankBounds } from "../lib/market/gmv-estimation";

function csvBytes(value: string) {
  return new TextEncoder().encode(value);
}

function legacyXlsBytes(rows: Array<Array<string | number>>) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "sheet");
  return new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "biff8" }) as ArrayBuffer);
}

test("市场榜单 CSV 映射商品、周期和经营指标", () => {
  const result = parseMarketRows({
    bytes: csvBytes([
      "周期起,周期止,类目,店铺类型,排名,SKUID,商品名称,品牌,成交金额,成交件数,访客数,成交转化率",
      "2026-07-01,2026-07-20,商用净水设备,自营,1,10001,商用净水机,TERUISI,12500.50,42,1680,2.5%",
    ].join("\n")),
    fileName: "市场商品榜单.csv",
    defaultStartDate: "2026-07-01",
    defaultEndDate: "2026-07-20",
  });

  assert.equal(result.sheetName, "CSV");
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]?.skuCode, "10001");
  assert.equal(result.rows[0]?.category, "商用净水设备");
  assert.equal(result.rows[0]?.gmvCents, 1_250_050);
  assert.equal(result.rows[0]?.conversionBps, 250);
  assert.equal(result.rows[0]?.rankingDimension, "SKU");
  assert.equal(result.rows[0]?.operationMode, "自营");
  assert.equal(result.rows[0]?.naturalKey, "2026-07-01|2026-07-20|商用净水设备|自营|全部|SKU|10001");
});

test("市场商品与自有商品关联字段具备独立索引", async () => {
  const [salesDatabase, netshopDatabase] = await Promise.all([
    readFile(new URL("../lib/sales/database.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/netshop/database.ts", import.meta.url), "utf8"),
  ]);
  assert.match(salesDatabase, /sales_order_lines_product_code_idx[\s\S]*ON sales_order_lines \(product_code\)/);
  assert.match(salesDatabase, /sales_order_lines_online_spec_code_idx[\s\S]*ON sales_order_lines \(online_spec_code\)/);
  assert.match(netshopDatabase, /netshop_rows_sku_id_idx[\s\S]*ON netshop_rows \(sku_id\)/);
  assert.match(netshopDatabase, /netshop_rows_spu_id_idx[\s\S]*ON netshop_rows \(spu_id\)/);
  assert.match(netshopDatabase, /netshop_rows_product_code_idx[\s\S]*ON netshop_rows \(product_code\)/);
});

test("旧版 XLS 商品榜单可直接解析并生成稳定的 SPU 市场标识", () => {
  const bytes = legacyXlsBytes([
    ["序号", "排名变化", "日期", "渠道", "行业名称", "商品名称", "所属店铺", "成交金额", "访客数", "搜索点击次数", "关注人数", "成交单量"],
    [1, "新入榜", "20260721", "整体", "商用净水设备", "商用净水机 A", "示例旗舰店", "￥6万 ~ ￥8万", "100 ~ 200", "50 ~ 100", "0.0", "0 ~ 5"],
  ]);
  const first = parseMarketRows({
    bytes,
    fileName: "商品榜单_商用净水设备_整体SPU_20260721.xls",
    defaultStartDate: "2026-07-01",
    defaultEndDate: "2026-07-01",
  });
  const second = parseMarketRows({
    bytes,
    fileName: "商品榜单_商用净水设备_整体SPU_20260721.xls",
    defaultStartDate: "2026-07-01",
    defaultEndDate: "2026-07-01",
  });
  assert.equal(first.rows.length, 1);
  assert.equal(first.rows[0]?.skuCode, second.rows[0]?.skuCode);
  assert.match(first.rows[0]?.skuCode ?? "", /^JD-MKT-SPU-[A-F0-9]{16}$/);
  assert.equal(first.rows[0]?.periodStart, "2026-07-21");
  assert.equal(first.rows[0]?.periodEnd, "2026-07-21");
  assert.equal(first.rows[0]?.category, "商用净水设备");
  assert.equal(first.rows[0]?.scope, "整体SPU");
  assert.equal(first.rows[0]?.rank, 1);
  assert.equal(first.rows[0]?.gmvCents, 7_000_000);
  assert.equal(first.rows[0]?.visitors, 150);
  assert.equal(first.warnings.length, 1);
  assert.match(first.warnings[0]?.message ?? "", /稳定市场标识/);
});

test("市场上传入口声明支持 XLS、XLSX 和 CSV", async () => {
  const [route, view] = await Promise.all([
    readFile(new URL("../app/api/market/import/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/market-view.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(route, /\(xls\|xlsx\|csv\)/);
  assert.match(view, /accept="\.xls,\.xlsx,\.csv"/);
});

test("市场分析按商品榜单、市场概括、竞品对比、系统和 AI 设置拆分为四个工作区", async () => {
  const [view, masterRoute] = await Promise.all([
    readFile(new URL("../app/market-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/market/master/route.ts", import.meta.url), "utf8"),
  ]);
  for (const label of ["商品榜单", "市场概括", "竞品对比", "系统和 AI 设置"]) assert.match(view, new RegExp(label));
  assert.match(view, /useState<MarketSectionKey>\("ranking"\)/);
  assert.match(view, /activeSection === "ranking"/);
  assert.match(view, /activeSection === "overview"/);
  assert.match(view, /activeSection === "compare"/);
  assert.match(view, /activeSection === "settings"/);
  assert.match(view, /<CompareWorkspace/);
  assert.match(view, /<MarketMasterAdminPanel currentUser=\{currentUser\}/);
  assert.match(view, /<MarketAnnotationView currentUser=\{currentUser\}/);
  assert.match(view, /市场分析 → 系统和 AI 设置/);
  assert.match(view, /view=system_kpis/);
  for (const label of ["市场商品身份", "待确认价格", "待 AI 标注", "已生成 AI 结果"]) assert.match(view, new RegExp(label));
  assert.match(masterRoute, /view === "system_kpis"/);
  assert.match(masterRoute, /getMarketSystemKpis/);
});

test("市场榜单与系统设置呈现商品链接、上榜期数、主图价格复核和系统 AI 算力", async () => {
  const [view, database] = await Promise.all([
    readFile(new URL("../app/market-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/market/database.ts", import.meta.url), "utf8"),
  ]);
  assert.match(view, /market-product-title-link/);
  assert.match(view, /上榜 \{count\(item\.periodCount\)\} 期/);
  assert.match(database, /COUNT\(DISTINCT p\.period_start \|\| '\|' \|\| p\.period_end\)/);
  for (const label of ["SKU 数据库", "AI 标注", "品牌确认", "映射配置", "数据配置"]) assert.match(view, new RegExp(label));
  assert.match(view, /运营管理系统 AI 算力/);
  assert.match(view, /fetch\("\/api\/ai\/models"/);
  assert.match(view, /market-price-review-table/);
  assert.match(view, /market-review-image/);
  assert.match(view, /action: "infer_brand"/);
  assert.match(view, /action: "confirm_brand"/);
});

test("SKU 数据库和品牌确认提供卡片、全页 AI 识别与批量确认入口", async () => {
  const source = await readFile(new URL("../app/market-view.tsx", import.meta.url), "utf8");
  const annotation = await readFile(new URL("../app/market-annotation-view.tsx", import.meta.url), "utf8");
  const [service, gmvTotals] = await Promise.all([
    readFile(new URL("../lib/market/admin-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/market/gmv-total.ts", import.meta.url), "utf8"),
  ]);
  assert.match(source, /AI 一键识别价格（最多100条）/);
  assert.match(source, /pendingPriceSource/);
  assert.match(source, /AI 识别价/);
  assert.match(source, /非 AI 识别价/);
  assert.match(source, /pendingPricePageSize/);
  assert.match(source, /待确认价格页码/);
  assert.match(source, /SKU 数据库每页条数/);
  assert.match(source, /setCategory\(nextCategory\); setPriceCategory\(nextCategory\); setPage\(1\); setPendingPricePage\(1\);/);
  assert.match(source, /const requestId = \+\+loadRequestId\.current/);
  assert.match(source, /if \(requestId !== loadRequestId\.current\) return/);
  assert.match(source, /key=\{`pending-price-\$\{row\.id\}`\}/);
  assert.match(source, /人工确认市场定位价（元）/);
  assert.match(source, /Math\.round\(priceYuan \* 100\)/);
  assert.match(annotation, /主图价格（元）/);
  assert.doesNotMatch(annotation, /主图价格（分）/);
  assert.match(source, /AI 一键识别品牌（所有页）/);
  assert.match(source, /一键确认全部候选/);
  assert.match(source, /暂停识别/);
  assert.match(source, /remainingCount/);
  assert.match(source, /run_brand_recognition_job_batch/);
  assert.match(source, /create_brand_recognition_job/);
  assert.match(source, /品牌种子词典/);
  assert.match(source, /未知品牌 SKU 清单/);
  assert.match(source, /refresh_brand_seeds/);
  assert.match(source, /match_brand_seeds/);
  assert.match(source, /market-master-product-grid/);
  assert.match(service, /market_brand_suggestions/);
  assert.match(service, /PARTITION BY m\.category, m\.scope, m\.ranking_dimension, m\.sku_code/);
  assert.match(gmvTotals, /period_kind='monthly'/);
  assert.match(gmvTotals, /period_kind='daily'/);
  assert.match(gmvTotals, /coverage_days DESC/);
  assert.match(service, /market_sku_gmv_totals/);
  assert.match(service, /gmv_total_cents DESC/);
});

test("SKU 数据库合并价格与 AI 入库，按需加载，并提供细分品类设置和概括时间筛选", async () => {
  const [view, annotation, service, route, styles] = await Promise.all([
    readFile(new URL("../app/market-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/market-annotation-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/market/admin-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/market/master/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  for (const label of ["SKU 数据库与价格审核", "全部细分品类", "全部价格状态", "全部入库状态", "编辑 SKU 全部数据", "编辑 SKU 数据", "细分品类设置", "保存并刷新全部关联数据", "开始日期", "结束日期", "源表价格区间中位数兜底"]) assert.match(view, new RegExp(label));
  assert.match(view, /databaseArea === "annotation"/);
  assert.match(view, /<MarketAnnotationView currentUser=\{currentUser\} embedded/);
  assert.match(annotation, /storageStatus/);
  assert.match(annotation, /itemSegment/);
  assert.match(annotation, /reviewView === "gallery"/);
  assert.match(annotation, /批量入库/);
  assert.match(annotation, /全选筛选结果（跨页/);
  assert.match(annotation, /AI 标注每页条数/);
  assert.match(annotation, /AI 标注页码/);
  assert.match(annotation, /aria-label="AI 标注三级类目多选"/);
  assert.match(annotation, /reviewCategories\.forEach\(\(value\) => params\.append\("itemCategory", value\)\)/);
  assert.match(annotation, /data\.taxonomy\.filter\(\(item\) => !reviewCategories\.length \|\| reviewCategories\.includes\(item\.category\)\)/);
  assert.match(annotation, /setItemSegment\(""\)/);
  assert.match(annotation, /已汇总 \{data\.reviewSummary\.jobCount\} 个任务/);
  assert.match(annotation, /aggregateJobs: true/);
  assert.match(annotation, /全部 AI 结果/);
  assert.match(annotation, /未生成 AI 结果（含失败）/);
  assert.match(annotation, /此筛选不会调用模型/);
  assert.match(annotation, /annotationProductHref/);
  assert.match(annotation, /https:\/\/item\.jd\.com\/\$\{sku\}\.html/);
  assert.match(annotation, /annotation-image-link/);
  assert.match(annotation, /annotation-review-table-wrap/);
  assert.match(annotation, /打开商品链接/);
  assert.match(annotation, /taxonomy/);
  assert.match(annotation, /readOnly/);
  assert.match(view, /market-master-database-table/);
  assert.match(view, /market-master-table-image/);
  assert.match(view, /打开商品链接/);
  assert.match(service, /COUNT\(\*\) OVER\(\) full_count/);
  assert.match(service, /wantsDatabase/);
  assert.match(service, /updateMarketSkuMasterData/);
  assert.match(service, /saveMarketSubcategorySettings/);
  assert.match(service, /FROM market_subcategory_taxonomy t/);
  assert.match(route, /workspaceModeParam/);
  assert.match(route, /case "update_sku_master"/);
  assert.match(styles, /\.annotation-review-table-wrap\s*\{[\s\S]*?overflow-x:\s*clip/);
  assert.match(styles, /\.annotation-review-table\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?table-layout:\s*fixed/);
  assert.match(styles, /\.annotation-job-list\s*\{[\s\S]*?flex-wrap:\s*wrap;[\s\S]*?overflow:\s*visible/);
  assert.match(route, /case "save_subcategory_settings"/);
});

test("视觉模型错误保留安全的供应商详情并给出状态码诊断", async () => {
  const source = await readFile(new URL("../lib/market/annotation-model.ts", import.meta.url), "utf8");
  assert.match(source, /modelErrorDetail/);
  assert.match(source, /模型供应商限流或额度不足/);
  assert.match(source, /请求被接口拒绝/);
  assert.match(source, /replace\(\/\\b\(sk-\|key-\)/);
  assert.match(source, /throw modelCallError\("视觉", response\.status, data\)/);
});

test("market imports automatically match enabled brand seeds", async () => {
  const [service, matcher] = await Promise.all([
    readFile(new URL("../lib/market/import-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/market/brand-seeds.ts", import.meta.url), "utf8"),
  ]);
  assert.match(service, /matchImportedMarketBrands/);
  assert.match(service, /refreshSystemMarketBrandSeeds/);
  assert.match(service, /brandMatch\.rows/);
  assert.match(matcher, /title_prefix/);
  assert.match(matcher, /title_anywhere/);
  assert.match(matcher, /京东自营/);
});

test("市场数据使用默认周期并阻止同周期重复 SKU", () => {
  const result = parseMarketRows({
    bytes: csvBytes([
      "商品编号,商品名称,成交金额",
      "SKU-8,竞品 A,100~300",
      "SKU-8,重复竞品,900",
    ].join("\n")),
    fileName: "sku.csv",
    defaultStartDate: "2026-07-01",
    defaultEndDate: "2026-07-22",
    defaultCategory: "切片机",
    defaultScope: "POP",
  });

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]?.gmvCents, 20_000);
  assert.equal(result.rows[0]?.periodEnd, "2026-07-22");
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0]?.message ?? "", /重复 SKU/);
});

test("市场区间保留原文、中值和上下界，并把榜单价格段纳入自然键", () => {
  assert.deepEqual(parseRangeBounds("￥8,000 ~ ￥1万"), [8_000, 10_000]);
  assert.equal(parseRange("￥8,000 ~ ￥1万"), 9_000);
  assert.deepEqual(parseRangeBounds("8% ~ 10%"), [0.08, 0.1]);
  assert.equal(parseRange("8% ~ 10%"), 0.09);
  const result = parseMarketRows({
    bytes: csvBytes("商品编号,成交金额,成交件数,访客数,价格带筛选\nSKU-1,￥8万~￥10万,5~10,600~800,0-500"),
    fileName: "range.csv",
    defaultStartDate: "2026-07-01",
    defaultEndDate: "2026-07-31",
    defaultCategory: "净水设备",
    defaultScope: "POP",
  });
  const row = result.rows[0]!;
  assert.equal(row.gmvRaw, "￥8万~￥10万");
  assert.equal(row.gmvCents, 9_000_000);
  assert.equal(row.gmvLowCents, 8_000_000);
  assert.equal(row.gmvHighCents, 10_000_000);
  assert.equal(row.quantityLow, 5);
  assert.equal(row.quantityHigh, 10);
  assert.equal(row.visitorsLow, 600);
  assert.equal(row.visitorsHigh, 800);
  assert.equal(row.priceBandFilter, "0-500");
  assert.equal(row.naturalKey, "2026-07-01|2026-07-31|净水设备|POP|0-500|SKU|SKU-1");
});

test("排名约束使用真实 GMV 锚点做几何插值并反推自洽指标", () => {
  const base = {
    category: "净水设备", periodStart: "2026-07-01", periodEnd: "2026-07-31", scope: "全部", priceBandFilter: "全部", rankingDimension: "SKU",
    priceMidCents: 10_000, priceLowCents: 8_000, priceHighCents: 12_000,
    quantityMid: 50, quantityLow: 1, quantityHigh: 200, visitorsMid: 1_000, conversionLowBps: 10, conversionHighBps: 5_000,
  } as const;
  const rows = annotateRankBounds([
    { ...base, id: "a", rank: 1, gmvMidCents: 1_000_000, gmvLowCents: 900_000, gmvHighCents: 1_100_000, realGmvCents: 1_000_000 },
    { ...base, id: "b", rank: 2, gmvMidCents: 600_000, gmvLowCents: 100_000, gmvHighCents: 900_000 },
    { ...base, id: "c", rank: 3, gmvMidCents: 100_000, gmvLowCents: 90_000, gmvHighCents: 110_000, realGmvCents: 100_000 },
  ]);
  assert.equal(rows[0]?.effectiveGmvCents, 1_000_000);
  assert.equal(rows[1]?.effectiveGmvCents, 316_228);
  assert.equal(rows[2]?.effectiveGmvCents, 100_000);
  assert.ok(rows[0]!.effectiveGmvCents >= rows[1]!.effectiveGmvCents);
  assert.ok(rows[1]!.effectiveGmvCents >= rows[2]!.effectiveGmvCents);
  assert.equal(rows[1]?.estimatedQuantity, 32);
  assert.equal(rows[1]?.averageTransactionPriceCents, 9_882);
  assert.equal(aggregateMarketEstimates(rows, 3).effectiveGmvCents, 1_416_228);
});

test("真实锚点超出榜单区间时保留真实值且不按粗区间截断", () => {
  const [row] = annotateRankBounds([{
    id: 1, category: "净水设备", periodStart: "2026-07-01", periodEnd: "2026-07-31", scope: "全部", rank: 1,
    gmvMidCents: 100_000, gmvLowCents: 90_000, gmvHighCents: 110_000, realGmvCents: 300_000,
    priceMidCents: 10_000, quantityMid: 10, quantityLow: 1, quantityHigh: 10, visitorsMid: 100,
  }]);
  assert.equal(row?.effectiveGmvCents, 300_000);
  assert.equal(row?.gmvOutOfBand, true);
  assert.equal(row?.estimatedQuantity, 30);
});

test("市场导入缺少商品编号列时拒绝文件", () => {
  assert.throws(() => parseMarketRows({
    bytes: csvBytes("商品名称,成交金额\n竞品 A,100"),
    fileName: "bad.csv",
    defaultStartDate: "2026-07-01",
    defaultEndDate: "2026-07-22",
  }), /商品编号/);
});

test("参考模块的日期区间、品牌名称和中文金额单位可以直接导入", () => {
  const result = parseMarketRows({
    bytes: csvBytes([
      "日期区间,排名,SKUID,商品名称,品牌名称,成交金额,成交商品件数,访客数",
      '2026-06-17 ~ 2026-06-23,1,JD-100,竞品净水机,品牌甲,"￥8,000 ~ ￥1万",10~50,100~300',
    ].join("\n")),
    fileName: "京东交易榜单.csv",
    defaultStartDate: "2026-01-01",
    defaultEndDate: "2026-01-02",
  });

  assert.equal(result.rows[0]?.periodStart, "2026-06-17");
  assert.equal(result.rows[0]?.periodEnd, "2026-06-23");
  assert.equal(result.rows[0]?.brand, "品牌甲");
  assert.equal(result.rows[0]?.gmvCents, 900_000);
  assert.equal(result.rows[0]?.quantity, 30);
  assert.equal(result.rows[0]?.visitors, 200);
});

test("京东商智月度 TOP SKU CSV 识别原图、商品链接和区间中位数", () => {
  const result = parseMarketRows({
    bytes: csvBytes([
      "日期区间,榜单单位,排名,商品名称,SKUID,图片URL(原图),商品链接,成交金额,成交单量,访客数,搜索点击次数,店铺名称,店铺类型",
      "2026-01-01_2026-01-31,SKU,1,商用净饮水机,10047090465567,https://img10.360buyimg.com/imgzone/jfs/t1/a.jpg,https://item.jd.com/10047090465567.html,￥8万~￥10万,5~10,600~800,600~800,示例旗舰店,pop",
    ].join("\n")),
    fileName: "京东商智_交易榜单_SKU_商用净饮水设备_2026-01至2026-06.csv",
    defaultStartDate: "2026-01-01",
    defaultEndDate: "2026-06-30",
    defaultCategory: "商用净饮水设备",
    defaultScope: "整体SKU",
  });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]?.periodStart, "2026-01-01");
  assert.equal(result.rows[0]?.periodEnd, "2026-01-31");
  assert.equal(result.rows[0]?.imageUrl, "https://img10.360buyimg.com/imgzone/jfs/t1/a.jpg");
  assert.equal(result.rows[0]?.productUrl, "https://item.jd.com/10047090465567.html");
  assert.equal(result.rows[0]?.gmvCents, 9_000_000);
  assert.equal(result.rows[0]?.quantity, 8);
  assert.equal(result.rows[0]?.visitors, 700);
  assert.equal(result.rows[0]?.searchClicks, 700);
});

test("市场图片缓存使用受限京东抓取、R2、鉴权路由并接入标注目录", async () => {
  const [cache, cacheRoute, imageRoute, schemaCore, database, view, annotation] = await Promise.all([
    readFile(new URL("../lib/market/image-cache.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/market/images/cache/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/market/images/[hash]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/market/schema-core.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/market/database.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/market-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/market/annotation-service.ts", import.meta.url), "utf8"),
  ]);
  assert.match(cache, /fetchAnnotationImage/);
  assert.match(cache, /SALES_IMPORT_FILES/);
  assert.match(cache, /MAX_CACHE_BATCH = 24/);
  assert.match(cache, /CACHE_CONCURRENCY = 4/);
  assert.match(cacheRoute, /requireAppPrincipal\(\["admin"\]\)/);
  assert.match(cacheRoute, /limit > 24/);
  assert.match(imageRoute, /requireAppPrincipal\(\)/);
  assert.match(imageRoute, /x-content-type-options/);
  assert.match(schemaCore, /CREATE TABLE IF NOT EXISTS market_image_cache/);
  assert.match(database, /\/api\/market\/images\//);
  assert.match(view, /正在自动缓存商品图/);
  assert.match(view, /一键刷新图片缓存/);
  assert.match(view, /stopImageCacheRef/);
  assert.match(view, /JSON\.stringify\(\{ limit: 24 \}\)/);
  assert.match(annotation, /market_image_cache/);
});
