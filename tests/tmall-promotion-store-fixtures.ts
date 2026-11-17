import { strToU8, zipSync } from "fflate";

/**
 * 合成的阿里妈妈“商品报表”（商品、计划维度）夹具，沿用真实直连报表的表头形态：
 * 无“日期”列，业务日取自 ZIP 内 CSV 文件名中的唯一日期。不含任何真实业务数据。
 */
// ZIP 头会写入打包时间；固定为本地 2026-11-12 00:00:00，使原文件哈希（签收与指纹输入）可复现。
const FIXED_ZIP_TIME = new Date(2026, 10, 12, 0, 0, 0);
export const LILI_SHOP ="天猫-志高丽力专卖店";
export const FIXTURE_DAY = "2026-11-12";

export type PromoRow = {
  plan: string; subjectId: string; type: string; name: string;
  impressions: number; clicks: number; spend: number; net: number; gross: number; netOrders: number; grossOrders: number;
};

const header = [
  "场景ID", "场景名字", "计划ID", "计划名称", "主体ID", "主体类型", "主体名称",
  "展现量", "点击量", "花费", "净成交金额", "总成交金额", "净成交笔数", "总成交笔数",
];

export function promoRow(
  plan: string, subjectId: string, type: string, name: string,
  numbers: Partial<Pick<PromoRow, "impressions" | "clicks" | "spend" | "net" | "gross" | "netOrders" | "grossOrders">> = {},
): PromoRow {
  return { plan, subjectId, type, name, impressions: 100, clicks: 10, spend: 10, net: 0, gross: 0, netOrders: 0, grossOrders: 0, ...numbers };
}

export function directReport(rows: readonly PromoRow[], day = FIXTURE_DAY) {
  const compact = day.replaceAll("-", "");
  const lines = rows.map((row) => [
    "479", "店铺直达", `plan-${row.plan}`, `计划${row.plan}`, row.subjectId, row.type, row.name,
    row.impressions, row.clicks, row.spend.toFixed(2), row.net.toFixed(2), row.gross.toFixed(2), row.netOrders, row.grossOrders,
  ].join(","));
  const bytes = zipSync({ [`商品报表_${compact}_a7b5d13e.csv`]: [strToU8([header.join(","), ...lines].join("\r\n")), { mtime: FIXED_ZIP_TIME }] });
  return {
    source: "tmall_promotion" as const,
    bytes,
    fileName: `天猫-志高丽力专卖店-商品报表-${day}-fixture.zip`,
    fileSizeBytes: bytes.byteLength,
    shopName: LILI_SHOP,
    expectedStartDate: day,
    expectedEndDate: day,
  };
}

/** 只含商品行（含同一商品多计划行）的文件：店铺级改动前后结果必须逐字一致。 */
export const productOnlyRows = [
  promoRow("a", "10001", "商品", "商品一", { spend: 10.5, net: 30, gross: 40, netOrders: 1, grossOrders: 2 }),
  promoRow("b", "10001", "商品", "商品一·另一计划标题", { spend: 20.25, net: 10, gross: 10, netOrders: 1, grossOrders: 1 }),
  promoRow("a", "10002", "商品", "商品二", { spend: 7, clicks: 0 }),
  promoRow("c", "10003", "商品", "商品三", { spend: 1.1, net: 99.99, gross: 99.99, netOrders: 3, grossOrders: 3 }),
];

/** 日期列形态（旧版直接导出）的商品行文件。 */
export function datedProductReport() {
  const bytes = zipSync({ "商品报表_20260905.csv": [strToU8([
    "日期,商品ID,商品名称,计划ID,计划名称,花费,净成交金额,总成交金额,展现量,点击量",
    "2026-09-05,10001,商用设备新版标题,plan-a,计划A,10,20,30,100,10",
    "2026-09-05,10001,商用设备原版标题,plan-b,计划B,20,40,70,200,20",
    "2026-09-05,10002,商品二,plan-a,计划A,5,0,0,50,1",
  ].join("\r\n")), { mtime: FIXED_ZIP_TIME }] });
  return {
    source: "tmall_promotion" as const, bytes, fileName: "fixture.zip", fileSizeBytes: bytes.byteLength,
    shopName: "天猫-志高炊之王专卖店", expectedStartDate: "2026-09-05", expectedEndDate: "2026-09-05",
  };
}

/** 真实形态：多个商品 + 店铺首页（店铺直达）两个计划行，同一日期。 */
export const mixedRows = [
  ...productOnlyRows,
  promoRow("direct-1", "355577887", "店铺", "店铺首页", { impressions: 87, clicks: 6, spend: 35.21 }),
  promoRow("direct-2", "355577887", "店铺", "店铺首页", { impressions: 11, clicks: 2, spend: 4.63, net: 358, gross: 358, netOrders: 1, grossOrders: 1 }),
];
