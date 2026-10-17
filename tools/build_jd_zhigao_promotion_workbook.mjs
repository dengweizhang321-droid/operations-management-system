import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const [analysisPath, outputPath, previewDir] = process.argv.slice(2);
if (!analysisPath || !outputPath || !previewDir) {
  throw new Error("Usage: node build_jd_zhigao_promotion_workbook.mjs <analysis.json> <output.xlsx> <preview-dir>");
}

const report = JSON.parse(await fs.readFile(analysisPath, "utf8"));
const workbook = Workbook.create();
const summary = workbook.worksheets.add("经营摘要");
const planSheet = workbook.worksheets.add("计划控费");
const skuSheet = workbook.worksheets.add("SKU动作");
const dailySheet = workbook.worksheets.add("每日趋势");
const causeSheet = workbook.worksheets.add("浪费根因");
const methodSheet = workbook.worksheets.add("方法与口径");

const font = "Arial";
const navy = "#17324D";
const blue = "#2D6CDF";
const lightBlue = "#EAF2FF";
const line = "#D9E2EC";
const red = "#B42318";
const redBg = "#FFF0EE";
const amber = "#9A6700";
const amberBg = "#FFF8E6";
const green = "#157347";
const greenBg = "#EDF8F2";
const muted = "#607087";

for (const sheet of [summary, planSheet, skuSheet, dailySheet, causeSheet, methodSheet]) {
  sheet.showGridLines = false;
}
summary.tabColor = navy;
planSheet.tabColor = "#B42318";
skuSheet.tabColor = blue;
dailySheet.tabColor = "#6B8EAD";
causeSheet.tabColor = "#A5652A";
methodSheet.tabColor = "#7A8594";

function writeMatrix(sheet, anchor, matrix) {
  sheet.getRange(anchor).write(matrix);
}

function title(sheet, text, subtitle, endCol = "H") {
  sheet.getRange(`A2:${endCol}2`).format.borders = { bottom: { style: "medium", color: navy } };
  sheet.getRange("A2").values = [[text]];
  sheet.getRange("A2").format.font = { name: font, size: 15, bold: true, color: navy };
  sheet.getRange("A3").values = [[subtitle]];
  sheet.getRange(`A3:${endCol}3`).format.font = { name: font, size: 10, italic: true, color: muted };
}

function header(range) {
  range.format.fill = navy;
  range.format.font = { name: font, size: 10, bold: true, color: "#FFFFFF" };
  range.format.horizontalAlignment = "center";
  range.format.verticalAlignment = "center";
  range.format.borders = { preset: "inside", style: "thin", color: "#FFFFFF" };
  range.format.rowHeight = 28;
}

function body(range) {
  range.format.font = { name: font, size: 10, color: "#18212F" };
  range.format.verticalAlignment = "center";
  range.format.borders = { bottom: { style: "thin", color: line } };
}

function money(cents) {
  return cents == null ? null : Math.round(Number(cents)) / 100;
}

function moneyText(cents) {
  const value = money(cents);
  return value == null ? "—" : `¥${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function shortText(value, length = 42) {
  const text = String(value || "");
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

function mappingLabel(value) {
  return ({ matched: "唯一映射", shared_erp_code: "共享ERP货号", unmapped: "未映射", ambiguous: "一对多映射" })[value] || value;
}

function excelText(value) {
  return `SKU ${String(value ?? "")}`;
}

function metric(period, section, key) {
  return report.shopSummary[period][section][key];
}

title(
  summary,
  "京东-志高商用设备旗舰店推广深度诊断",
  `数据截至 ${report.asOfDate}；近30天 ${report.windows.last30.label}；本自然月 ${report.windows.mtd.label}；业务时区 Asia/Shanghai`,
  "N",
);

const comparison = report.shopSummary.comparisons;
const summaryRows = [
  ["指标", "近30天", "前30天", "变化", "本月截至昨日", "上月同期", "变化", "单位/说明"],
  ["推广花费", money(metric("last30", "promotion", "spend_cents")), money(metric("previous30", "promotion", "spend_cents")), comparison.last30VsPrevious30.spendChange, money(metric("mtd", "promotion", "spend_cents")), money(metric("priorMtd", "promotion", "spend_cents")), comparison.mtdVsPriorMtd.spendChange, "人民币元"],
  ["平台归因成交", money(metric("last30", "promotion", "attributed_gmv_cents")), money(metric("previous30", "promotion", "attributed_gmv_cents")), comparison.last30VsPrevious30.attributedGmvChange, money(metric("mtd", "promotion", "attributed_gmv_cents")), money(metric("priorMtd", "promotion", "attributed_gmv_cents")), comparison.mtdVsPriorMtd.attributedGmvChange, "人民币元；归因窗口未知"],
  ["ROAS", metric("last30", "promotion", "roas"), metric("previous30", "promotion", "roas"), comparison.last30VsPrevious30.roasChange, metric("mtd", "promotion", "roas"), metric("priorMtd", "promotion", "roas"), comparison.mtdVsPriorMtd.roasChange, "倍数"],
  ["净销售额", money(metric("last30", "sales", "net_sales_cents")), money(metric("previous30", "sales", "net_sales_cents")), comparison.last30VsPrevious30.netSalesChange, money(metric("mtd", "sales", "net_sales_cents")), money(metric("priorMtd", "sales", "net_sales_cents")), comparison.mtdVsPriorMtd.netSalesChange, "人民币元；含退款负值"],
  ["大毛利", money(metric("last30", "sales", "gross_profit_cents")), money(metric("previous30", "sales", "gross_profit_cents")), null, money(metric("mtd", "sales", "gross_profit_cents")), money(metric("priorMtd", "sales", "gross_profit_cents")), null, "净销售额-货品成本"],
  ["广告后大毛利", money(metric("last30", "sales", "after_ad_gross_profit_cents")), money(metric("previous30", "sales", "after_ad_gross_profit_cents")), comparison.last30VsPrevious30.afterAdGrossProfitChange, money(metric("mtd", "sales", "after_ad_gross_profit_cents")), money(metric("priorMtd", "sales", "after_ad_gross_profit_cents")), comparison.mtdVsPriorMtd.afterAdGrossProfitChange, "大毛利-推广花费"],
  ["推广费率", metric("last30", "sales", "ad_spend_rate"), metric("previous30", "sales", "ad_spend_rate"), null, metric("mtd", "sales", "ad_spend_rate"), metric("priorMtd", "sales", "ad_spend_rate"), null, "推广花费/净销售额"],
  ["点击率", metric("last30", "promotion", "ctr"), metric("previous30", "promotion", "ctr"), null, metric("mtd", "promotion", "ctr"), metric("priorMtd", "promotion", "ctr"), null, "点击/展现"],
  ["平均点击成本", money(metric("last30", "promotion", "cpcCents")), money(metric("previous30", "promotion", "cpcCents")), null, money(metric("mtd", "promotion", "cpcCents")), money(metric("priorMtd", "promotion", "cpcCents")), null, "人民币元/点击"],
  ["点击到归因订单行转化率", metric("last30", "promotion", "cvr"), metric("previous30", "promotion", "cvr"), null, metric("mtd", "promotion", "cvr"), metric("priorMtd", "promotion", "cvr"), null, "订单行/点击"],
];
writeMatrix(summary, "A5", summaryRows);
header(summary.getRange("A5:H5"));
body(summary.getRange(`A6:H${4 + summaryRows.length}`));
summary.getRange("B6:C7").setNumberFormat('¥#,##0.00');
summary.getRange("E6:F7").setNumberFormat('¥#,##0.00');
summary.getRange("B9:C11").setNumberFormat('¥#,##0.00');
summary.getRange("E9:F11").setNumberFormat('¥#,##0.00');
summary.getRange("B14:C14").setNumberFormat('¥#,##0.00');
summary.getRange("E14:F14").setNumberFormat('¥#,##0.00');
summary.getRange("D6:D15").setNumberFormat('0.0%');
summary.getRange("G6:G15").setNumberFormat('0.0%');
summary.getRange("B12:C13").setNumberFormat('0.0%');
summary.getRange("E12:F13").setNumberFormat('0.0%');
summary.getRange("B15:C15").setNumberFormat('0.0%');
summary.getRange("E15:F15").setNumberFormat('0.0%');
summary.getRange("B8:C8").setNumberFormat('0.00');
summary.getRange("E8:F8").setNumberFormat('0.00');

const controlRows = [...report.planActions, ...report.planWatch].map((item) => [
  item.severity === "观察" ? "回查观察" : "成熟归因后条件下调",
  item.planId || "—",
  shortText(item.planName),
  money(item.current.spend_cents),
  item.current.roas,
  money(item.suggestedCutCents),
  item.promotedSkuIds.includes("-1") ? "-1计划池" : `${item.promotedSkuIds.length}个推广SKU`,
  item.reasons.join("；"),
]);
const controlTable = [["条件动作", "计划ID", "计划", "近30天花费", "ROAS", "30天收回情景", "推广SKU池", "依据"], ...controlRows];
writeMatrix(summary, "A18", controlTable);
header(summary.getRange("A18:H18"));
if (controlRows.length) {
  body(summary.getRange(`A19:H${18 + controlRows.length}`));
  summary.getRange(`D19:D${18 + controlRows.length}`).setNumberFormat('¥#,##0.00');
  summary.getRange(`E19:E${18 + controlRows.length}`).setNumberFormat('0.00');
  summary.getRange(`F19:F${18 + controlRows.length}`).setNumberFormat('¥#,##0.00');
  summary.getRange(`A19:H${18 + controlRows.length}`).format.wrapText = true;
  summary.getRange(`A19:H${18 + controlRows.length}`).conditionalFormats.addCustom('=$A19="成熟归因后条件下调"', { fill: redBg, font: { color: red } });
  summary.getRange(`A19:H${18 + controlRows.length}`).conditionalFormats.addCustom('=$A19="回查观察"', { fill: amberBg, font: { color: amber } });
}

const followStart = 20 + controlRows.length;
const followRows = [...report.inefficientFollowOrderSkus, ...report.watchFollowOrderSkus].map((item) => [
  item.severity === "观察" ? "归因观察" : "归因异常",
  excelText(item.skuId), shortText(item.productName), money(item.current.promotion.spend_cents),
  money(item.promotedSkuBreakdown.sameSkuSpendCents), money(item.promotedSkuBreakdown.unassignedPoolSpendCents),
  item.current.promotion.roas, item.reasons.join("；"),
]);
writeMatrix(summary, `A${followStart}`, [["状态", "跟单SKU", "商品", "簇花费", "同号推广SKU花费", "-1/空池归集", "ROAS", "定位依据"], ...followRows]);
header(summary.getRange(`A${followStart}:H${followStart}`));
if (followRows.length) {
  body(summary.getRange(`A${followStart + 1}:H${followStart + followRows.length}`));
  summary.getRange(`D${followStart + 1}:F${followStart + followRows.length}`).setNumberFormat('¥#,##0.00');
  summary.getRange(`G${followStart + 1}:G${followStart + followRows.length}`).setNumberFormat('0.00');
  summary.getRange(`A${followStart + 1}:H${followStart + followRows.length}`).format.wrapText = true;
}

const testStart = followStart + followRows.length + 2;
const testRows = report.underSpendSkus.map((item) => [
  excelText(item.skuId),
  shortText(item.productName),
  item.inventorySourceValue || "待核对",
  money(item.current.explicitSkuAssociatedSpendCents),
  money(item.current.sales.gross_profit_cents),
  money(item.allocatedSevenDayTestCents),
  item.targetRoas,
  item.reasons.join("；"),
]);
writeMatrix(summary, `A${testStart}`, [["SKU", "商品", "库存来源值", "明确SKU关联花费", "近30天大毛利", "7天试投情景", "目标ROAS", "依据"], ...testRows]);
header(summary.getRange(`A${testStart}:H${testStart}`));
if (testRows.length) {
  body(summary.getRange(`A${testStart + 1}:H${testStart + testRows.length}`));
  summary.getRange(`A${testStart + 1}:H${testStart + testRows.length}`).format.fill = greenBg;
  summary.getRange(`D${testStart + 1}:F${testStart + testRows.length}`).setNumberFormat('¥#,##0.00');
  summary.getRange(`G${testStart + 1}:G${testStart + testRows.length}`).setNumberFormat('0.00');
  summary.getRange(`A${testStart + 1}:A${testStart + testRows.length}`).setNumberFormat('@');
  summary.getRange(`A${testStart + 1}:H${testStart + testRows.length}`).format.wrapText = true;
}
summary.getRange("A1:N90").format.font.name = font;
summary.getRange("A1:A90").format.columnWidth = 22;
summary.getRange("B1:B90").format.columnWidth = 19;
summary.getRange("C1:C90").format.columnWidth = 42;
summary.getRange("D1:G90").format.columnWidth = 16;
summary.getRange("H1:H90").format.columnWidth = 48;

title(planSheet, "计划控费候选", "归因成熟度未验证；先按计划ID在京准通后台核对成熟归因、预算、出价和投放状态，再决定是否执行条件性下调。", "Q");
const planState = new Map();
for (const item of report.planActions) planState.set(item.planKey, { action: "成熟归因后条件下调", item });
for (const item of report.planWatch) planState.set(item.planKey, { action: "回查观察", item });
const planHeaders = ["状态", "计划ID", "计划", "推广SKU池", "近30天花费", "近30天归因成交", "ROAS", "点击", "归因订单行", "前30天花费", "前30天归因成交", "前30天ROAS", "本月花费", "本月归因成交", "本月ROAS", "条件性30天收回情景", "依据"];
const planValues = [...report.planAnalysis].sort((a, b) => {
  const rank = { "成熟归因后条件下调": 0, "回查观察": 1, "保持": 2 };
  const aa = planState.get(a.planKey)?.action || "保持";
  const bb = planState.get(b.planKey)?.action || "保持";
  return rank[aa] - rank[bb] || b.periods.last30.spend_cents - a.periods.last30.spend_cents;
}).map((item) => {
  const state = planState.get(item.planKey);
  const ids = item.promotedSkuIds;
  const pool = ids.includes("-1") ? "-1计划池" : ids.length <= 3 ? ids.join("、") : `${ids.slice(0, 3).join("、")} 等${ids.length}个`;
  return [
    state?.action || "保持", item.planId || "—", item.planName, pool,
    money(item.periods.last30.spend_cents), money(item.periods.last30.attributed_gmv_cents), item.periods.last30.roas,
    item.periods.last30.clicks, item.periods.last30.orders,
    money(item.periods.previous30.spend_cents), money(item.periods.previous30.attributed_gmv_cents), item.periods.previous30.roas,
    money(item.periods.mtd.spend_cents), money(item.periods.mtd.attributed_gmv_cents), item.periods.mtd.roas,
    money(state?.item?.suggestedCutCents || 0), (state?.item?.reasons || []).join("；"),
  ];
});
writeMatrix(planSheet, "A5", [planHeaders, ...planValues]);
header(planSheet.getRange("A5:Q5"));
if (planValues.length) {
  const end = 5 + planValues.length;
  body(planSheet.getRange(`A6:Q${end}`));
  planSheet.getRange(`E6:F${end}`).setNumberFormat('¥#,##0.00');
  planSheet.getRange(`G6:G${end}`).setNumberFormat('0.00');
  planSheet.getRange(`J6:K${end}`).setNumberFormat('¥#,##0.00');
  planSheet.getRange(`L6:L${end}`).setNumberFormat('0.00');
  planSheet.getRange(`M6:N${end}`).setNumberFormat('¥#,##0.00');
  planSheet.getRange(`O6:O${end}`).setNumberFormat('0.00');
  planSheet.getRange(`P6:P${end}`).setNumberFormat('¥#,##0.00');
  planSheet.getRange(`A6:Q${end}`).conditionalFormats.addCustom('=$A6="成熟归因后条件下调"', { fill: redBg, font: { color: red } });
  planSheet.getRange(`A6:Q${end}`).conditionalFormats.addCustom('=$A6="回查观察"', { fill: amberBg, font: { color: amber } });
  planSheet.tables.add(`A5:Q${end}`, true, "PlanActionsTable").style = "TableStyleMedium2";
}
planSheet.freezePanes.freezeRows(5);
for (const [col, width] of Object.entries({ A: 24, B: 16, C: 44, D: 32, E: 14, F: 15, G: 10, H: 10, I: 12, J: 14, K: 15, L: 12, M: 13, N: 14, O: 11, P: 18, Q: 48 })) planSheet.getRange(`${col}1:${col}${Math.max(10, 5 + planValues.length)}`).format.columnWidth = width;

// Full SKU action sheet.  Derived ratios are formula-backed for auditability.
title(skuSheet, "SKU归因与试投明细", "跟单SKU只用于定位异常终点；利润只在商家SKU与ERP货品唯一映射时计算；归因成熟度和库存核对后才执行试投。", "Y");
const flat = new Map();
for (const item of report.inefficientFollowOrderSkus) flat.set(item.skuId, { action: "归因异常", recommendation: item });
for (const item of report.watchFollowOrderSkus) flat.set(item.skuId, { action: "归因观察", recommendation: item });
for (const item of report.underSpendSkus) flat.set(item.skuId, { action: "试投候选", recommendation: item });
const orderedSkus = [...report.skuAnalysis].sort((a, b) => {
  const rank = { "归因异常": 0, "归因观察": 1, "试投候选": 2, "保持/观察": 3 };
  const aa = flat.get(a.skuId)?.action || "保持/观察";
  const bb = flat.get(b.skuId)?.action || "保持/观察";
  return rank[aa] - rank[bb] || b.periods.last30.promotion.spend_cents - a.periods.last30.promotion.spend_cents || a.skuId.localeCompare(b.skuId);
});
const skuHeaders = ["状态", "SKU", "商品", "商家SKU/ERP货品", "映射状态", "商品状态", "库存来源值", "跟单簇花费", "同号推广SKU花费", "-1/空池归集", "明确SKU关联花费", "归因成交", "ROAS", "点击", "归因订单行", "CPC", "CVR", "净销售额", "大毛利", "盈亏平衡ROAS", "本月跟单簇花费", "本月ROAS", "7天试投情景", "归因成熟度", "判断依据"];
const skuValues = orderedSkus.map((item) => {
  const current = item.periods.last30;
  const mtd = item.periods.mtd;
  const rec = flat.get(item.skuId)?.recommendation || {};
  return [
    flat.get(item.skuId)?.action || "保持/观察", excelText(item.skuId), item.productName,
    item.productCodes.join(", "), mappingLabel(item.mappingStatus), item.productStatus,
    item.inventorySourceValue || "待核对", money(current.promotion.spend_cents),
    money(item.promotedSkuBreakdown.sameSkuSpendCents), money(item.promotedSkuBreakdown.unassignedPoolSpendCents),
    money(current.explicitSkuAssociatedSpendCents), money(current.promotion.attributed_gmv_cents), null,
    current.promotion.clicks, current.promotion.orders, money(current.promotion.cpcCents), current.promotion.cvr,
    money(current.sales.net_sales_cents), money(current.sales.gross_profit_cents), current.sales.breakEvenRoas,
    money(mtd.promotion.spend_cents), mtd.promotion.roas, money(rec.allocatedSevenDayTestCents || 0), "未验证",
    (rec.reasons || []).join("；"),
  ];
});
writeMatrix(skuSheet, "A5", [skuHeaders, ...skuValues]);
header(skuSheet.getRange("A5:Y5"));
if (skuValues.length) {
  const end = 5 + skuValues.length;
  body(skuSheet.getRange(`A6:Y${end}`));
  const roasFormulas = [];
  for (let row = 6; row <= end; row += 1) {
    roasFormulas.push([`=IF(H${row}=0,"",L${row}/H${row})`]);
  }
  skuSheet.getRange(`M6:M${end}`).formulas = roasFormulas;
  skuSheet.getRange(`H6:L${end}`).setNumberFormat('¥#,##0.00');
  skuSheet.getRange(`B6:B${end}`).setNumberFormat('@');
  skuSheet.getRange(`M6:M${end}`).setNumberFormat('0.00');
  skuSheet.getRange(`P6:P${end}`).setNumberFormat('¥#,##0.00');
  skuSheet.getRange(`Q6:Q${end}`).setNumberFormat('0.0%');
  skuSheet.getRange(`R6:S${end}`).setNumberFormat('¥#,##0.00');
  skuSheet.getRange(`T6:T${end}`).setNumberFormat('0.00');
  skuSheet.getRange(`U6:U${end}`).setNumberFormat('¥#,##0.00');
  skuSheet.getRange(`V6:V${end}`).setNumberFormat('0.00');
  skuSheet.getRange(`W6:W${end}`).setNumberFormat('¥#,##0.00');
  skuSheet.getRange(`A6:Y${end}`).conditionalFormats.addCustom('=$A6="归因异常"', { fill: redBg, font: { color: red } });
  skuSheet.getRange(`A6:Y${end}`).conditionalFormats.addCustom('=$A6="归因观察"', { fill: amberBg, font: { color: amber } });
  skuSheet.getRange(`A6:Y${end}`).conditionalFormats.addCustom('=$A6="试投候选"', { fill: greenBg, font: { color: green } });
  skuSheet.tables.add(`A5:Y${end}`, true, "SkuActionsTable").style = "TableStyleMedium2";
}
skuSheet.freezePanes.freezeRows(5);
skuSheet.freezePanes.freezeColumns(2);
const skuEnd = Math.max(10, 5 + skuValues.length);
skuSheet.getRange(`A1:Y${skuEnd}`).format.font.name = font;
for (const [col, width] of Object.entries({ A: 13, B: 18, C: 44, D: 20, E: 17, F: 12, G: 14, H: 14, I: 16, J: 14, K: 16, L: 14, M: 10, N: 10, O: 12, P: 12, Q: 10, R: 14, S: 14, T: 14, U: 15, V: 11, W: 13, X: 12, Y: 48 })) {
  skuSheet.getRange(`${col}1:${col}${skuEnd}`).format.columnWidth = width;
}

title(dailySheet, "每日推广趋势", "近30天每日推广花费、归因成交与ROAS；缺失日保留为空，不补零。", "Q");
const dailyHeaders = ["日期", "花费", "归因成交", "ROAS", "展现", "点击", "点击率", "归因订单行", "点击转化率", "CPC", "是否缺失"];
const dailyValues = report.daily.map((item) => [
  new Date(`${item.businessDate}T00:00:00+08:00`), item.missing ? null : money(item.spend_cents), item.missing ? null : money(item.attributed_gmv_cents), null,
  item.missing ? null : item.impressions, item.missing ? null : item.clicks, item.missing ? null : item.ctr,
  item.missing ? null : item.orders, item.missing ? null : item.cvr, item.missing ? null : money(item.cpcCents), item.missing ? "是" : "否",
]);
writeMatrix(dailySheet, "A5", [dailyHeaders, ...dailyValues]);
writeMatrix(dailySheet, "L5", [["图表日期"], ...report.daily.map((item) => [item.businessDate.slice(5)])]);
header(dailySheet.getRange("A5:K5"));
if (dailyValues.length) {
  const end = 5 + dailyValues.length;
  body(dailySheet.getRange(`A6:K${end}`));
  const formulas = [];
  for (let row = 6; row <= end; row += 1) formulas.push([`=IF(B${row}=0,"",C${row}/B${row})`]);
  dailySheet.getRange(`D6:D${end}`).formulas = formulas;
  dailySheet.getRange(`A6:A${end}`).setNumberFormat('yyyy-mm-dd');
  dailySheet.getRange(`B6:C${end}`).setNumberFormat('¥#,##0.00');
  dailySheet.getRange(`D6:D${end}`).setNumberFormat('0.00');
  dailySheet.getRange(`G6:G${end}`).setNumberFormat('0.0%');
  dailySheet.getRange(`H6:H${end}`).setNumberFormat('#,##0');
  dailySheet.getRange(`I6:I${end}`).setNumberFormat('0.0%');
  dailySheet.getRange(`J6:J${end}`).setNumberFormat('¥#,##0.00');
  dailySheet.tables.add(`A5:K${end}`, true, "DailyTrendTable").style = "TableStyleMedium2";
  const spendChart = dailySheet.charts.add("bar", [dailySheet.getRange(`L5:L${end}`), dailySheet.getRange(`B5:B${end}`)]);
  spendChart.setPosition("M5", "U19");
  spendChart.title = "每日推广花费（元）";
  spendChart.titleTextStyle.fontSize = 12;
  spendChart.titleTextStyle.typeface = font;
  spendChart.hasLegend = false;
  spendChart.xAxis = { axisType: "textAxis", textStyle: { typeface: font, fontSize: 9 } };
  spendChart.yAxis = { numberFormatCode: '¥#,##0', numberFormatSourceLinked: false, textStyle: { typeface: font, fontSize: 9 } };
  if (spendChart.series.items.length) spendChart.series.items[0].fill = blue;
  const roasChart = dailySheet.charts.add("line", [dailySheet.getRange(`L5:L${end}`), dailySheet.getRange(`D5:D${end}`)]);
  roasChart.setPosition("M21", "U35");
  roasChart.title = "每日ROAS";
  roasChart.titleTextStyle.fontSize = 12;
  roasChart.titleTextStyle.typeface = font;
  roasChart.hasLegend = false;
  roasChart.xAxis = { axisType: "textAxis", textStyle: { typeface: font, fontSize: 9 } };
  roasChart.yAxis = { numberFormatCode: '0.0', numberFormatSourceLinked: false, textStyle: { typeface: font, fontSize: 9 } };
  if (roasChart.series.items.length) roasChart.series.items[0].line = { fill: red, style: "solid", width: 2 };
}
dailySheet.freezePanes.freezeRows(5);
dailySheet.getRange("A1:A40").format.columnWidth = 13;
dailySheet.getRange("B1:D40").format.columnWidth = 14;
dailySheet.getRange("E1:K40").format.columnWidth = 12;
dailySheet.getRange("L1:L40").format.columnWidth = 10;

title(causeSheet, "低效词与计划定位", "只列跟单SKU异常终点中达到门槛的关键词/搜索词；试算差额不是已证可节省金额，两个维度不可相加。", "N");
const causeHeaders = ["维度", "跟单SKU", "关键词/搜索词", "计划", "花费", "归因成交", "ROAS", "展现", "点击", "归因订单行", "目标ROAS", "按目标ROAS试算差额", "说明"];
const causeValues = report.rootCauses.map((item) => [
  item.dimension === "keyword" ? "关键词" : "搜索词", excelText(item.skuId), item.item, item.planName,
  money(item.spendCents), money(item.attributedGmvCents), item.roas, item.impressions, item.clicks, item.orders,
  item.targetRoas, money(item.targetRoasGapSpendCents), item.note,
]);
writeMatrix(causeSheet, "A5", [causeHeaders, ...causeValues]);
header(causeSheet.getRange("A5:M5"));
if (causeValues.length) {
  const end = 5 + causeValues.length;
  body(causeSheet.getRange(`A6:M${end}`));
  causeSheet.getRange(`B6:B${end}`).setNumberFormat('@');
  causeSheet.getRange(`E6:F${end}`).setNumberFormat('¥#,##0.00');
  causeSheet.getRange(`G6:G${end}`).setNumberFormat('0.00');
  causeSheet.getRange(`K6:K${end}`).setNumberFormat('0.00');
  causeSheet.getRange(`L6:L${end}`).setNumberFormat('¥#,##0.00');
  causeSheet.tables.add(`A5:M${end}`, true, "WasteCausesTable").style = "TableStyleMedium2";
}
causeSheet.freezePanes.freezeRows(5);
const causeEnd = Math.max(10, 5 + causeValues.length);
for (const [col, width] of Object.entries({ A: 10, B: 18, C: 26, D: 34, E: 13, F: 14, G: 10, H: 12, I: 10, J: 12, K: 12, L: 14, M: 46 })) causeSheet.getRange(`${col}1:${col}${causeEnd}`).format.columnWidth = width;

title(methodSheet, "方法与口径", "可复用分析逻辑、来源、阈值和限制。", "H");
const methodRows = [
  ["项目", "内容"],
  ["数据来源", report.quality.source],
  ["只读身份", `${report.quality.readOnlyRoles.netshop.role}；${report.quality.readOnlyRoles.sales.role}`],
  ["推广截止", report.quality.promotionDataThrough],
  ["销售截止", report.quality.salesDataThrough],
  ["店铺身份", `${report.scope.platform} / 推广：${report.scope.promotionShopName} / 销售：${report.scope.salesShopName} / 渠道：${report.scope.salesChannel}`],
  ["排除仓", report.scope.excludedWarehouse],
  ["近30天覆盖", `${report.quality.coveredLast30Days}/${report.quality.expectedLast30Days}天；缺失：${report.quality.missingLast30Dates.join(", ") || "无"}`],
  ["逐日对账", `未对账日期：${report.quality.unreconciledLast30Dates.join(", ") || "无"}`],
  ["归因成熟度", `未验证；${report.quality.attributionMaturityReason}`],
  ["商品主数据", `快照 ${report.quality.latestProductMaster?.snapshot_date || "未知"}；批次行数 ${report.quality.latestProductMaster?.row_count || "未知"}`],
  ["条件性30天收回情景", moneyText(report.budgetPlan.conditionalThirtyDayCutScenarioCents)],
  ["7天等速释放情景", moneyText(report.budgetPlan.sevenDayEquivalentReleaseScenarioCents)],
  ["7天试投池情景", moneyText(report.budgetPlan.sevenDayReallocationPoolCents)],
  ["7天利润保护留存", moneyText(report.budgetPlan.reserveCents)],
  ["跟单SKU高花费门槛", moneyText(report.thresholds.highSpendCents)],
  ["计划审计花费门槛", moneyText(report.thresholds.planHighSpendCents)],
  ["最小动作花费", moneyText(report.thresholds.minimumActionSpendCents)],
  ["店铺近30天ROAS", Number(report.thresholds.storeRoas).toFixed(2)],
  ...report.thresholds.rules.map((value, index) => [`判定规则${index + 1}`, value]),
  ...report.limitations.map((value, index) => [`限制${index + 1}`, value]),
  ["执行节奏", "先在京准通后台按计划ID核对成熟归因、预算、出价、投放状态和可售库存；未核对前不执行下调或试投。确认后，以7天等速释放情景为上限，50%小步试投、50%保留。"],
  ["条件止损", "仅在平台归因成熟窗口已确认或成熟数据已回溯重导后评估；成熟ROAS低于目标且累计20次点击仍无成熟归因订单时，停止新增试投并回查计划、词和商品页。"],
  ["条件放量", "同一测试批次归因成熟、至少3个成熟归因订单且ROAS高于目标线后，每3天最多增加10%，并继续核对库存和售后承载。"],
];
writeMatrix(methodSheet, "A5", methodRows);
header(methodSheet.getRange("A5:B5"));
body(methodSheet.getRange(`A6:B${4 + methodRows.length}`));
methodSheet.getRange(`A6:B${4 + methodRows.length}`).format.wrapText = true;
methodSheet.getRange(`A1:A${4 + methodRows.length}`).format.columnWidth = 22;
methodSheet.getRange(`B1:B${4 + methodRows.length}`).format.columnWidth = 96;
methodSheet.freezePanes.freezeRows(5);

workbook.recalculate();
const summaryInspect = await workbook.inspect({ kind: "table", range: "经营摘要!A2:H15", include: "values,formulas", tableMaxRows: 20, tableMaxCols: 10, maxChars: 6000 });
const skuInspect = await workbook.inspect({ kind: "table", range: `SKU动作!A5:Y${Math.min(15, 5 + skuValues.length)}`, include: "values,formulas", tableMaxRows: 12, tableMaxCols: 25, maxChars: 12000 });
const errors = await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!", options: { useRegex: true, maxResults: 300 }, summary: "final formula error scan", maxChars: 5000 });

await fs.mkdir(previewDir, { recursive: true });
const previewRanges = { "经营摘要": "A1:N55", "计划控费": "A1:Q35", "SKU动作": "A1:Y40", "每日趋势": "A1:U35", "浪费根因": "A1:M45", "方法与口径": "A1:B38" };
for (const sheet of [summary, planSheet, skuSheet, dailySheet, causeSheet, methodSheet]) {
  const preview = await workbook.render({ sheetName: sheet.name, range: previewRanges[sheet.name], scale: sheet.name === "SKU动作" ? 0.55 : 0.85, format: "png" });
  await fs.writeFile(path.join(previewDir, `${sheet.name}.png`), new Uint8Array(await preview.arrayBuffer()));
}
await fs.mkdir(path.dirname(outputPath), { recursive: true });
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(JSON.stringify({
  status: "ok",
  output: path.resolve(outputPath),
  previews: path.resolve(previewDir),
  summaryInspect: summaryInspect.ndjson,
  skuInspect: skuInspect.ndjson,
  formulaErrors: errors.ndjson,
  sheets: [summary.name, planSheet.name, skuSheet.name, dailySheet.name, causeSheet.name, methodSheet.name],
}, null, 2));
