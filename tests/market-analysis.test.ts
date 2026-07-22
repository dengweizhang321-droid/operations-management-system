import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { parseMarketRows } from "../lib/market/parser";

function csvBytes(value: string) {
  return new TextEncoder().encode(value);
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
  assert.equal(result.rows[0]?.naturalKey, "2026-07-01|2026-07-20|商用净水设备|自营|10001");
});

test("市场商品与自有商品关联字段具备独立索引", async () => {
  const [salesDatabase, netshopDatabase] = await Promise.all([
    readFile(new URL("../lib/sales/database.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/netshop/database.ts", import.meta.url), "utf8"),
  ]);
  assert.match(salesDatabase, /sales_order_lines_product_code_idx[\s\S]*ON sales_order_lines \(product_code\)/);
  assert.match(netshopDatabase, /netshop_rows_sku_id_idx[\s\S]*ON netshop_rows \(sku_id\)/);
  assert.match(netshopDatabase, /netshop_rows_spu_id_idx[\s\S]*ON netshop_rows \(spu_id\)/);
  assert.match(netshopDatabase, /netshop_rows_product_code_idx[\s\S]*ON netshop_rows \(product_code\)/);
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
