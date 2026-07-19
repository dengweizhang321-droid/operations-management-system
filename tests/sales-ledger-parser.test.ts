import assert from "node:assert/strict";
import test from "node:test";
import { parseSalesLedgerXlsx } from "../lib/imports/sales-ledger";
import { createXlsxWorkbookBytes } from "../lib/imports/xlsx-write";

test("sales ledger parser keeps order number when export also has online order number", () => {
  const bytes = createXlsxWorkbookBytes([{
    name: "sheetTitle",
    rows: [
      [
        "订单编号",
        "网店订单号",
        "销售渠道",
        "物流公司",
        "物流单号",
        "发货仓库",
        "客户编号",
        "货品编号",
        "货品名称",
        "规格",
        "货品条码",
        "数量",
        "单价",
        "货品默认供应商",
        "下单时间",
        "货品成本",
        "分摊后单价",
        "分摊后金额",
        "费用分摊",
        "毛利",
        "毛利率",
        "未税毛利",
        "未税毛利率(%)",
        "货品分类",
        "发货时间",
      ],
      [
        "JY202607160001",
        "3561428013514429",
        "京东-志高切肉机旗舰店（志高迈德豪）",
        "京东快递",
        "JDVC1",
        "广东仓",
        "C1",
        "SKU-1",
        "测试货品",
        "默认规格",
        "BAR-1",
        1,
        100,
        "测试供应商",
        "2026-07-16 10:00:00",
        30,
        100,
        100,
        5,
        65,
        "65.00%",
        65,
        65,
        "测试分类",
        "2026-07-16 11:00:00",
      ],
    ],
  }]);

  const parsed = parseSalesLedgerXlsx(bytes);

  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].orderNo, "JY202607160001");
  assert.equal(parsed.rows[0].onlineOrderNo, "3561428013514429");
  assert.ok(parsed.headers.includes("订单编号"));
  assert.ok(parsed.headers.includes("网店订单号"));
});
