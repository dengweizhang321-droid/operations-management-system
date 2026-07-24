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
