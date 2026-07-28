import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { parseCustomerServiceAnalysisReply } from "../lib/customer-service/contracts";

test("customer-service AI analysis accepts only bounded enum values and requested ids", () => {
  const rows = parseCustomerServiceAnalysisReply(`\n\`\`\`json\n[{"id":12,"robotScope":"contains_robot","problemType":"安装使用","conversionStatus":"not_converted","serviceIssues":"未及时说明接线步骤","summaryText":"顾客咨询接线，客服给出步骤。"},{"id":99,"robotScope":"bad","problemType":"未知","conversionStatus":"converted"}]\n\`\`\``, new Set([12]));
  assert.deepEqual(rows, [{ id: 12, robotScope: "contains_robot", problemType: "安装使用", conversionStatus: "not_converted", serviceIssues: "未及时说明接线步骤", summaryText: "顾客咨询接线，客服给出步骤。" }]);
});

test("customer-service AI analysis rejects non-JSON model output", () => {
  assert.throws(() => parseCustomerServiceAnalysisReply("分析完成", new Set([1])), /有效 JSON/);
});

test("customer-service AI analysis accepts unknown conversion status", () => {
  const rows = parseCustomerServiceAnalysisReply(
    `[{"id":7,"robotScope":"exclude_robot","problemType":"商品咨询","conversionStatus":"unknown","serviceIssues":"未发现明显服务问题","summaryText":"聊天记录不足，无法判断是否成交。"}]`,
    new Set([7]),
  );
  assert.equal(rows[0]?.conversionStatus, "unknown");
});

test("customer-service page checks model readiness and analyzes every visible unlabelled row in bounded batches", async () => {
  const [page, route] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/customer-service/analyze/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /export async function GET\(\)/);
  assert.match(route, /resolveChatModel/);
  assert.match(page, /analysisReady !== true/);
  assert.match(page, /for \(let offset = 0; offset < ids\.length; offset \+= 8\)/);
  assert.doesNotMatch(page, /filter\(\(item\) => !item\.analyzedAt\)\.slice\(0, 8\)/);
});

test("customer-service imports scope file identity by shop", async () => {
  const [directRoute, chunkRoute] = await Promise.all([
    readFile(new URL("../app/api/customer-service/import/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/customer-service/import/chunks/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(directRoute, /`\$\{resolvedShopName\}:\$\{await digest\(sessionBytes\)\}/);
  assert.match(chunkRoute, /`\$\{resolvedShopName\}:\$\{await digest\(session\.bytes\)\}/);
});

test("customer-service page keeps the paired-file import available beside analysis", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /<CustomerServiceImportCard canImport=\{canImport\} onCompleted=\{load\} \/>/);
  assert.match(page, /可在本页直接导入/);
});

test("customer-service category filter and display use the netshop SKU to Jackyun sales chain", async () => {
  const [page, route, database] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/customer-service/conversations/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/customer-service/database.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /吉客云类目筛选/);
  assert.match(page, /params\.set\("category", category\)/);
  assert.match(route, /searchParams\.get\("category"\)/);
  assert.match(database, /SELECT DISTINCT product_sku FROM customer_service_conversations WHERE product_sku <> ''/);
  assert.match(database, /s\.online_spec_code = mapping\.online_spec_code/);
  assert.match(database, /onlineSpecCode: String\(raw\["商家SKU"\]/);
  assert.doesNotMatch(database, /s\.online_spec_code = customer_service_conversations\.product_sku/);
  assert.match(database, /categories: categories\.results\.map/);
  assert.doesNotMatch(database, /catalog\.get\(`\$\{item\.shopName\}/);
});

test("customer-service unknown conversion stays synchronized across AI prompt, UI, and tool schema", async () => {
  const [analysis, page, registry] = await Promise.all([
    readFile(new URL("../lib/customer-service/analysis.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/ai/tool-registry.ts", import.meta.url), "utf8"),
  ]);
  assert.match(analysis, /unknown（聊天记录不足，无法判断是否转化）/);
  assert.match(page, /\{ value: "unknown", label: "未知" \}/);
  assert.match(registry, /conversionStatus: \{ type: "string", enum: \["converted", "not_converted", "unknown"\] \}/);
  assert.match(registry, /category: \{ type: "string", maxLength: 120/);
});
