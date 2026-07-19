import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { createXlsxWorkbookBytes } from "../lib/imports/xlsx-write";
import { parseXlsxFirstSheet } from "../lib/imports/xlsx";
import { findMissingPreviouslyLoadedChannels } from "../tools/sales-import-runner";

const execFileAsync = promisify(execFile);

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function salesSheet(rows: unknown[][]) {
  return createXlsxWorkbookBytes([{ name: "sheetTitle", rows }]);
}

function costSheet(rows: unknown[][]) {
  return createXlsxWorkbookBytes([{ name: "sheetTitle", rows }]);
}

test("sales completeness guard detects a previously loaded whitelist channel missing from the new snapshot", () => {
  const result = findMissingPreviouslyLoadedChannels(
    ["炊之王淘宝企业店", "天猫-志高丽力专卖店"],
    new Map([["天猫-志高丽力专卖店", 10]]),
    [
      { channel: "炊之王淘宝企业店", platform: "淘宝", shopName: "炊之王淘宝企业店", rowCount: 22, netSalesCents: 317_400 },
      { channel: "白名单外店铺", platform: "其他", shopName: "白名单外店铺", rowCount: 5, netSalesCents: 10_000 },
    ],
  );
  assert.deepEqual(result, [{ channel: "炊之王淘宝企业店", rowCount: 22, netSalesCents: 317_400 }]);
});

test("sales dry-run uses the stable price-adjustment product code", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "sales-price-adjustment-test-"));
  try {
    const salesBytes = salesSheet([
      ["网店订单号", "销售渠道", "发货仓库", "货品编号", "货品名称", "数量", "下单时间", "发货时间", "货品成本", "分摊后单价", "分摊后金额", "费用分摊", "毛利"],
      ["ON-PRICE", "天猫-志高丽力专卖店", "主仓", "", "补差价专用", 1, "2026-07-10 09:00:00", "2026-07-10 10:00:00", 0, 20, 20, 0, 0],
    ]);
    const costBytes = costSheet([["货品编号", "固定成本价", "货品名称"]]);
    const salesPath = path.join(directory, "销售单明细账.xlsx");
    const costPath = path.join(directory, "分仓库存查询_已剔除刷刷仓.xlsx");
    await Promise.all([writeFile(salesPath, salesBytes), writeFile(costPath, costBytes)]);

    const result = await execFileAsync(process.execPath, [
      "--import", "tsx", path.resolve("tools/sales-import-runner.ts"),
      "--download", salesPath,
      "--cost-source", costPath,
      "--as-of", "2026-07-15",
      "--audit-root", path.join(directory, "audit"),
      "--dry-run",
    ], { cwd: path.resolve("."), encoding: "utf8", timeout: 30_000 });

    const output = JSON.parse(result.stdout) as { outputPath?: string };
    assert.ok(output.outputPath);
    const workbook = parseXlsxFirstSheet(new Uint8Array(await readFile(output.outputPath)));
    assert.equal(workbook.rows[1]?.cells[3], "ERP_PRICE_ADJUSTMENT");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("sales dry-run accepts the current sales export shape", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "sales-runner-test-"));
  try {
    const salesBytes = salesSheet([
      ["网店订单号", "销售渠道", "发货仓库", "货品编号", "货品名称", "数量", "下单时间", "发货时间", "货品成本", "分摊后单价", "分摊后金额", "费用分摊", "毛利"],
      ["ON-1", "京东-志高切肉机旗舰店（志高迈德豪）", "主仓", "SKU-1", "测试货品", 1, "2026-07-10 09:00:00", "2026-07-10 10:00:00", 0, 100, 100, 5, 0],
    ]);
    const costBytes = costSheet([
      ["货品编号", "固定成本价", "货品名称"],
      ["SKU-1", 20, "测试货品"],
    ]);
    const salesPath = path.join(directory, "销售单明细账.xlsx");
    const costPath = path.join(directory, "分仓库存查询_已剔除刷刷仓.xlsx");
    await Promise.all([writeFile(salesPath, salesBytes), writeFile(costPath, costBytes)]);

    const result = await execFileAsync(process.execPath, [
      "--import", "tsx", path.resolve("tools/sales-import-runner.ts"),
      "--download", salesPath,
      "--cost-source", costPath,
      "--expected-download-sha256", sha256(salesBytes),
      "--expected-cost-sha256", sha256(costBytes),
      "--expected-source-rows", "1",
      "--as-of", "2026-07-15",
      "--audit-root", path.join(directory, "audit"),
      "--dry-run",
    ], { cwd: path.resolve("."), encoding: "utf8", timeout: 30_000 });

    const output = JSON.parse(result.stdout) as { status?: string; auditPath?: string };
    assert.equal(output.status, "prepared");
    assert.ok(output.auditPath);
    const audit = JSON.parse(await readFile(output.auditPath, "utf8")) as {
      period?: unknown;
      filtering?: { retainedRows?: number; excludedTodayRows?: number };
      validation?: { processedChecks?: { rowCount?: number } };
    };
    assert.deepEqual(audit.period, {
      startDate: "2026-07-01",
      endDate: "2026-07-15",
      startDateTime: "2026-07-01 00:00:00",
      endExclusiveDateTime: "2026-07-16 00:00:00",
    });
    assert.equal(audit.filtering?.retainedRows, 1);
    assert.equal(audit.validation?.processedChecks?.rowCount, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("sales dry-run excludes only execution-day rows before later validation", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "sales-today-filter-test-"));
  try {
    const salesBytes = salesSheet([
      ["网店订单号", "销售渠道", "发货仓库", "货品编号", "货品名称", "数量", "下单时间", "发货时间", "货品成本", "分摊后单价", "分摊后金额", "费用分摊", "毛利"],
      ["ON-1", "京东-志高切肉机旗舰店（志高迈德豪）", "主仓", "SKU-1", "测试货品", 1, "2026-07-10 09:00:00", "2026-07-10 10:00:00", 0, 100, 100, 5, 0],
      ["ON-TODAY", "京东-志高切肉机旗舰店（志高迈德豪）", "主仓", "SKU-NO-COST", "当日货品", 1, "2026-07-16 09:00:00", "2026-07-16 10:00:00", 0, 100, 100, 5, 0],
    ]);
    const costBytes = costSheet([
      ["货品编号", "固定成本价", "货品名称"],
      ["SKU-1", 20, "测试货品"],
    ]);
    const salesPath = path.join(directory, "销售单明细账.xlsx");
    const costPath = path.join(directory, "分仓库存查询_已剔除刷刷仓及零成本.xlsx");
    await Promise.all([writeFile(salesPath, salesBytes), writeFile(costPath, costBytes)]);

    const result = await execFileAsync(process.execPath, [
      "--import", "tsx", path.resolve("tools/sales-import-runner.ts"),
      "--download", salesPath,
      "--cost-source", costPath,
      "--expected-source-rows", "2",
      "--as-of", "2026-07-15",
      "--audit-root", path.join(directory, "audit"),
      "--dry-run",
    ], { cwd: path.resolve("."), encoding: "utf8", timeout: 30_000 });

    const output = JSON.parse(result.stdout) as { status?: string; auditPath?: string };
    assert.equal(output.status, "prepared");
    assert.ok(output.auditPath);
    const audit = JSON.parse(await readFile(output.auditPath, "utf8")) as {
      filtering?: { retainedRows?: number; excludedTodayRows?: number; nonWhitelistRows?: number };
    };
    assert.equal(audit.filtering?.retainedRows, 1);
    assert.equal(audit.filtering?.excludedTodayRows, 1);
    assert.equal(audit.filtering?.nonWhitelistRows, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("sales dry-run ignores line ship time when shipment time is missing", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "sales-line-ship-ignore-test-"));
  try {
    const salesBytes = salesSheet([
      ["网店订单号", "销售渠道", "发货仓库", "货品编号", "货品名称", "数量", "下单时间", "发货时间", "货品级发货时间", "货品成本", "分摊后单价", "分摊后金额", "费用分摊", "毛利"],
      ["ON-1", "京东-志高切肉机旗舰店（志高迈德豪）", "主仓", "SKU-1", "测试货品", 1, "2026-07-10 09:00:00", "", "2026-07-16 10:00:00", 0, 100, 100, 5, 0],
    ]);
    const costBytes = costSheet([
      ["货品编号", "固定成本价", "货品名称"],
      ["SKU-1", 20, "测试货品"],
    ]);
    const salesPath = path.join(directory, "销售单明细账.xlsx");
    const costPath = path.join(directory, "分仓库存查询_已剔除刷刷仓.xlsx");
    await Promise.all([writeFile(salesPath, salesBytes), writeFile(costPath, costBytes)]);

    const result = await execFileAsync(process.execPath, [
      "--import", "tsx", path.resolve("tools/sales-import-runner.ts"),
      "--download", salesPath,
      "--cost-source", costPath,
      "--expected-download-sha256", sha256(salesBytes),
      "--expected-cost-sha256", sha256(costBytes),
      "--expected-source-rows", "1",
      "--as-of", "2026-07-15",
      "--audit-root", path.join(directory, "audit"),
      "--dry-run",
    ], { cwd: path.resolve("."), encoding: "utf8", timeout: 30_000 });

    const output = JSON.parse(result.stdout) as { status?: string; auditPath?: string };
    assert.equal(output.status, "prepared");
    assert.ok(output.auditPath);
    const audit = JSON.parse(await readFile(output.auditPath, "utf8")) as {
      filtering?: { retainedRows?: number; excludedTodayRows?: number };
    };
    assert.equal(audit.filtering?.retainedRows, 1);
    assert.equal(audit.filtering?.excludedTodayRows, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("sales recovery does not reuse a completed audit from an older policy version", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "sales-policy-recovery-test-"));
  try {
    const salesBytes = salesSheet([
      ["网店订单号", "销售渠道", "发货仓库", "货品编号", "货品名称", "数量", "下单时间", "发货时间", "货品成本", "分摊后单价", "分摊后金额", "费用分摊", "毛利"],
      ["ON-1", "京东-志高切肉机旗舰店（志高迈德豪）", "主仓", "SKU-1", "测试货品", 1, "2026-07-10 09:00:00", "2026-07-10 10:00:00", 0, 100, 100, 5, 0],
    ]);
    const costBytes = costSheet([
      ["货品编号", "固定成本价", "货品名称"],
      ["SKU-1", 20, "测试货品"],
    ]);
    const salesPath = path.join(directory, "销售单明细账.xlsx");
    const costPath = path.join(directory, "分仓库存查询_已剔除刷刷仓.xlsx");
    const auditRoot = path.join(directory, "audit");
    const previousAuditPath = path.join(auditRoot, "old-audit.json");
    await mkdir(auditRoot, { recursive: true });
    await Promise.all([
      writeFile(salesPath, salesBytes),
      writeFile(costPath, costBytes),
      writeFile(previousAuditPath, JSON.stringify({
        ok: true,
        policyVersion: "old-policy",
        period: { startDate: "2026-07-01", endDate: "2026-07-15" },
        sources: { costSource: { sha256: sha256(costBytes) } },
        filtering: { sourceRows: 1 },
        import: { batch: { status: "completed" } },
      })),
      writeFile(path.join(auditRoot, "processed-downloads.json"), JSON.stringify({
        runs: [{
          rawSha256: sha256(salesBytes),
          status: "imported",
          runId: "old-run",
          periodStart: "2026-07-01",
          periodEnd: "2026-07-15",
          auditPath: previousAuditPath,
        }],
      })),
    ]);

    const result = await execFileAsync(process.execPath, [
      "--import", "tsx", path.resolve("tools/sales-import-runner.ts"),
      "--download", salesPath,
      "--cost-source", costPath,
      "--expected-download-sha256", sha256(salesBytes),
      "--expected-cost-sha256", sha256(costBytes),
      "--expected-source-rows", "1",
      "--as-of", "2026-07-15",
      "--audit-root", auditRoot,
      "--dry-run",
    ], { cwd: path.resolve("."), encoding: "utf8", timeout: 30_000 });

    const output = JSON.parse(result.stdout) as { status?: string; recovered?: boolean };
    assert.equal(output.status, "prepared");
    assert.notEqual(output.recovered, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
