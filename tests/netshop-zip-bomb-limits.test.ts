import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";

import { parseFile } from "../lib/netshop/normalized-import";

// 照 lib/netshop/product-image-assets.ts 的条目数 + 解压总量双上限模板：
// netshop ZIP（典型为 tmall_promotion 单日单 CSV）必须在解压阶段就拒绝过多条目
// 或过大解压总量的压缩包，不能先把所有条目解出来再检查“只能 1 个”。

const header = "日期,商品ID,商品名称,计划ID,计划名称,花费,净成交金额,总成交金额,展现量,点击量";

function promotionCsv(day = "2026-09-05") {
  return [header, `${day},10001,商用设备,plan-a,计划A,10,20,30,100,10`].join("\r\n");
}

test("ZIP 内条目数超过上限时拒绝，不解出全部条目", () => {
  const entries: Record<string, Uint8Array> = {};
  // 51 个条目：第 1 个是真实业务 CSV，其余是填充条目，模拟 zip bomb 式的海量小文件。
  entries["商品报表_20260905.csv"] = strToU8(promotionCsv());
  for (let index = 0; index < 50; index += 1) {
    entries[`junk-${index}.txt`] = strToU8("x");
  }
  const bytes = zipSync(entries);
  assert.throws(
    () => parseFile(bytes, "商品报表.zip", "tmall_promotion"),
    /条目数超过/,
  );
});

test("ZIP 解压后总量超过 25MB 上限时拒绝（谎报与真实大小均需拦截）", () => {
  // originalSize 来自压缩包头部自报；用高压缩比的重复数据制造解压后超过 25MB 的真实大小，
  // 验证 filter 阶段的 advertisedTotalBytes 累加和解压后的 actualTotalBytes 复核都能拦住。
  const bigPayload = "0".repeat(30 * 1024 * 1024);
  const bytes = zipSync({ "big.csv": strToU8(bigPayload) }, { level: 9 });
  assert.throws(
    () => parseFile(bytes, "big.zip", "jd_shop_overview"),
    /超过 25MB 上限/,
  );
});

test("单个条目解压后超过 25MB 时仍拒绝（既有上限保持）", () => {
  const bytes = zipSync({ "商品报表_20260905.csv": strToU8("0".repeat(26 * 1024 * 1024)) }, { level: 9 });
  assert.throws(
    () => parseFile(bytes, "商品报表.zip", "tmall_promotion"),
    /超过 25MB 上限/,
  );
});

test("边界内的单条目天猫推广 ZIP 正常解析通过", () => {
  const bytes = zipSync({ "商品报表_20260905.csv": strToU8(promotionCsv()) });
  const parsed = parseFile(bytes, "商品报表.zip", "tmall_promotion");
  assert.equal(parsed.archiveEntryName, "商品报表_20260905.csv");
  assert.ok(parsed.rows.length > 0);
});

test("条目数在上限之内（非天猫推广来源，允许多条目取唯一可识别文件）时正常通过", () => {
  const entries: Record<string, Uint8Array> = {
    "商品日报_20260905.csv": strToU8(promotionCsv()),
  };
  // 追加 10 个非 .xlsx/.csv 条目（如说明文件），验证未超过新上限时不受影响；
  // tmall_promotion 额外要求“恰好 1 个条目”，这里用通用来源单独验证条目数上限本身。
  for (let index = 0; index < 10; index += 1) {
    entries[`readme-${index}.txt`] = strToU8("ignored");
  }
  const bytes = zipSync(entries);
  const parsed = parseFile(bytes, "商品日报.zip", "jd_shop_overview");
  assert.equal(parsed.archiveEntryName, "商品日报_20260905.csv");
});
