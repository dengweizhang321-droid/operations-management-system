import assert from "node:assert/strict";
import test from "node:test";
import { Script } from "node:vm";
import { strFromU8, unzipSync } from "fflate";
import {
  buildPromotionDiagnosticReport,
  promotionDiagnosticHtml,
  promotionDiagnosticXlsx,
  type DiagnosticPeriod,
} from "../lib/jd/promotion-diagnostic-report";

function days(start: string, count: number) {
  const first = Date.parse(`${start}T00:00:00Z`);
  return Array.from({ length: count }, (_, index) => new Date(first + index * 86_400_000).toISOString().slice(0, 10));
}

function period(start: string, { count = 6, shopName = "志高商用设备旗舰店", missing = false }:
  { count?: number; shopName?: string; missing?: boolean } = {}): DiagnosticPeriod {
  const requested = days(start, count);
  const present = missing ? requested.slice(0, -1) : requested;
  const rowCount = present.length;
  const metrics = {
    spendCents: rowCount * 1000,
    impressions: rowCount * 100,
    clicks: rowCount * 20,
    reportedOrderLines: rowCount * 2,
    reportedGmvCents: rowCount * 9000,
  };
  const metricAvailability = Object.fromEntries(Object.keys(metrics).map((key) => [key, {
    presentRows: rowCount, totalRows: rowCount, complete: rowCount > 0,
  }])) as DiagnosticPeriod["metricAvailability"];
  const oneGroup = (key: string) => [{ key, rowCount, name: "计划甲", planId: "P1", id: "P1", metrics }];
  return {
    schemaVersion: "jd-promotion-diagnostic-v1",
    identity: { platform: "京东", shopName },
    period: { startDate: requested[0]!, endDate: requested.at(-1)! },
    sourceRevision: "12:abcdef",
    coverage: { requestedDates: requested, presentDates: present, missingDates: missing ? requested.slice(-1) : [], complete: !missing, rowCount, aggregateReconciled: true },
    metricAvailability,
    sourceBatches: present.map((date) => ({ date, batchIds: [`batch-${date}`], accountNicknames: ["测试账户"], rowCount: 1, aggregateBatchId: `batch-${date}` })),
    summary: metrics,
    daily: requested.map((date) => ({ date, rowCount: present.includes(date) ? 1 : 0,
      metrics: present.includes(date) ? { spendCents: 1000, impressions: 100, clicks: 20, reportedOrderLines: 2, reportedGmvCents: 9000 }
        : { spendCents: null, impressions: null, clicks: null, reportedOrderLines: null, reportedGmvCents: null } })),
    groups: { plans: oneGroup('["P1","计划甲"]'), products: oneGroup('["S1"]'), keywords: oneGroup('["词甲"]'),
      searchTerms: oneGroup('["搜索甲"]'), keywordSku: oneGroup('["词甲","S1"]') },
    limitations: ["归因窗口未独立核实"],
  };
}

test("fixed six-day periods produce dynamic offline HTML and same-table XLSX", () => {
  const current = period("2026-09-20");
  const previous = period("2026-09-14");
  const report = buildPromotionDiagnosticReport(current, previous);
  assert.equal(report.complete, true);
  assert.equal(report.comparisonAvailable, true);
  assert.equal(report.period.endDate, "2026-09-25");
  assert.equal(report.previousPeriod?.endDate, "2026-09-19");
  assert.deepEqual(report.tables.map((item) => item.key), ["summary", "daily", "plans", "products", "keywords", "searchTerms", "keywordSku", "actions", "coverage"]);
  const html = promotionDiagnosticHtml(report);
  assert.match(html, /2026-09-20 至 2026-09-25/);
  assert.match(html, /rows\.length-1/);
  assert.doesNotMatch(html, /\/29|30天|2026-08-16/);
  assert.match(html, /搜索当前表/);
  assert.match(html, /导出当前表CSV/);
  assert.match(html, /createElementNS\('http:\/\/www\.w3\.org\/2000\/svg'/);
  const offlineScript = html.match(/<script>([\s\S]*?)<\/script><\/body>/)?.[1];
  assert.ok(offlineScript);
  assert.doesNotThrow(() => new Script(offlineScript));
  const files = unzipSync(promotionDiagnosticXlsx(report));
  const workbook = strFromU8(files["xl/workbook.xml"]!);
  assert.equal((workbook.match(/<sheet /g) ?? []).length, report.tables.length);
  const summary = strFromU8(files["xl/worksheets/sheet1.xml"]!);
  assert.match(summary, /推广花费/);
  assert.match(summary, /60<\/v>/); // 6 × 10 yuan, same source cells as HTML.
  assert.match(summary, /state="frozen"/);
  assert.match(summary, /<autoFilter ref="A1:E10"\/>/);
});

test("missing source day stays partial, and a mismatched shop or revision cannot compare", () => {
  const current = period("2026-09-20", { missing: true });
  const report = buildPromotionDiagnosticReport(current, period("2026-09-14"));
  assert.equal(report.complete, false);
  assert.equal(report.comparisonAvailable, false);
  assert.equal(report.actions[0]?.priority, "先补源");
  assert.match(promotionDiagnosticHtml(report), /数据待补/);
  assert.throws(() => buildPromotionDiagnosticReport(period("2026-09-20"), period("2026-09-14", { shopName: "其他店" })), /店铺身份/);
  const stale = period("2026-09-14"); stale.sourceRevision = "13:changed";
  assert.equal(buildPromotionDiagnosticReport(period("2026-09-20"), stale).comparisonAvailable, false);
});

test("unreconciled or incomplete dimension facts cannot become a report", () => {
  const bad = period("2026-09-20");
  bad.coverage.aggregateReconciled = false;
  assert.throws(() => buildPromotionDiagnosticReport(bad), /来源身份、修订或逐日对账/);
  const lost = period("2026-09-20");
  lost.groups.keywordSku[0]!.rowCount -= 1;
  assert.throws(() => buildPromotionDiagnosticReport(lost), /词货|keywordSku/);
});

test("anonymous plan spend is disclosed without a fabricated plan concentration", () => {
  const current = period("2026-09-20");
  current.groups.plans = [{ key: "[null,null]", rowCount: 6, name: "未提供计划名称", planId: null, metrics: current.summary }];
  const report = buildPromotionDiagnosticReport(current);
  assert.ok(report.findings.some((finding) => finding.title === "计划身份缺失"));
  assert.ok(!report.findings.some((finding) => finding.title === "可识别计划花费"));
  assert.equal(report.actions[0]?.priority, "先核身份");
});
