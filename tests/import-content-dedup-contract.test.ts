import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const d1DomainServices = [
  "lib/netshop/import-service.ts",
  "lib/inventory/import-service.ts",
  "lib/erp-reference/import-service.ts",
  "lib/finance/import-service.ts",
  "lib/customer-service/database.ts",
  "lib/market/import-service.ts",
] as const;

test("仍由 D1 承载的六类导入领域都在解析后使用共享业务内容指纹", async () => {
  for (const file of d1DomainServices) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(source, /buildImportContentFingerprint\(/, file);
    assert.match(source, /lockScope:/, file);
    assert.match(source, /reserveImportFingerprint\(/, file);
    assert.match(source, /recordImportFingerprint\(/, file);
    assert.match(source, /readImportScopeStateToken\(/, file);
    assert.match(source, /renewImportFingerprintReservation\(/, file);
    assert.match(source, /reservationFence|importReservationCommitFence/, file);
    assert.match(source, /failImportFingerprint\(/, file);
  }
});

test("销售导入通过 Django 写 API 执行 PostgreSQL 指纹、审计和发布事务", async () => {
  const [service, writer, backend] = await Promise.all([
    readFile(new URL("../lib/sales/import-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/django/sales-writer.ts", import.meta.url), "utf8"),
    readFile(new URL("../backend/sales/write_service.py", import.meta.url), "utf8"),
  ]);
  assert.match(service, /requestDjangoSalesService/);
  assert.match(service, /SALES_STAGED_IMPORTS_PATH/);
  assert.doesNotMatch(service, /buildImportContentFingerprint|reserveImportFingerprint|getSalesDatabase|sales_order_lines/);
  assert.match(writer, /export const SALES_STAGED_IMPORTS_PATH/);
  assert.match(backend, /def _record_prevalidation_rejection/);
  assert.match(backend, /SalesImportAttempt\.objects\.create/);
  assert.match(backend, /def _content_hash/);
  assert.match(backend, /with transaction\.atomic\(\)/);
  assert.match(backend, /select_for_update\(\)/);
});

test("各导入入口都审计预校验拒绝且不让坏文件参与业务判重", async () => {
  for (const file of [
    "lib/netshop/import-service.ts",
    "lib/inventory/import-service.ts",
    "lib/erp-reference/import-service.ts",
    "lib/finance/import-service.ts",
  ]) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(source, /auditRejectedImportResult/, file);
  }
  for (const file of [
    "lib/market/import-service.ts",
    "app/api/customer-service/import/route.ts",
    "app/api/customer-service/import/chunks/route.ts",
  ]) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(source, /recordRejectedImportAttempt/, file);
  }

  const implementation = await readFile(new URL("../lib/imports/content-fingerprint.ts", import.meta.url), "utf8");
  const rejectedBlock = implementation.slice(
    implementation.indexOf("export async function recordRejectedImportAttempt"),
    implementation.indexOf("export async function auditRejectedImportResult"),
  );
  assert.match(rejectedBlock, /INSERT INTO import_content_attempts/);
  assert.doesNotMatch(rejectedBlock, /INSERT INTO import_content_fingerprints|UPDATE import_scope_heads|INSERT INTO import_scope_heads/);
});

test("六类 D1 事实发布事务都安装共享 owner 提交栅栏", async () => {
  for (const file of [
    "lib/inventory/database.ts",
    "lib/finance/database.ts",
    "lib/erp-reference/database.ts",
    "lib/netshop/database.ts",
    "lib/market/import-core.ts",
    "lib/customer-service/database.ts",
  ]) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(source, /importReservationCommitFence\(/, file);
  }
});

test("内容指纹同时保留原文件哈希，且迁移安装范围与原文件索引", async () => {
  const implementation = await readFile(new URL("../lib/imports/content-fingerprint.ts", import.meta.url), "utf8");
  const migration = await readFile(new URL("../drizzle/0056_import_content_fingerprints.sql", import.meta.url), "utf8");
  for (const source of [implementation, migration]) {
    assert.match(source, /raw_file_hash/);
    assert.match(source, /content_hash/);
    assert.match(source, /scope_key/);
    assert.match(source, /import_content_attempts/);
    assert.match(source, /import_scope_heads/);
    assert.match(source, /recovered_from_attempt_id/);
  }
  for (const indexName of [
    "finance_months_status_batch_idx",
    "customer_service_conversations_shop_last_batch_idx",
    "erp_inventory_age_last_batch_idx",
    "market_entries_last_batch_idx",
    "netshop_rows_lock_ownership_idx",
  ]) assert.match(migration, new RegExp(indexName));
});

test("天猫计划不再用已有日期覆盖筛掉目标日期", async () => {
  const daily = await readFile(new URL("../tools/tmall-multi-store-import-runner.ts", import.meta.url), "utf8");
  assert.match(daily, /requestedDatesToPlan/);
  assert.doesNotMatch(daily, /missingDatesInRange|explicitDatesToPlan/);
  const planningBlock = daily.slice(daily.indexOf("for (const store of selected)"), daily.indexOf("if (options.dryRun)"));
  assert.doesNotMatch(planningBlock, /getActualDates/);

  const promotion = await readFile(new URL("../tools/tmall-promotion-export.ts", import.meta.url), "utf8");
  const planner = promotion.slice(
    promotion.indexOf("export function planTmallPromotionDailyReports"),
    promotion.indexOf("export function planTmallPromotionDateRange"),
  );
  assert.doesNotMatch(planner, /promoted\.has|already_covered/);
  assert.match(planner, /return candidates\.slice/);

  const productMaster = await readFile(new URL("../tools/tmall-product-master-export.ts", import.meta.url), "utf8");
  const masterStage = productMaster.slice(productMaster.indexOf("export async function runTmallProductMasterStage"));
  assert.doesNotMatch(masterStage, /latestMasterBatch|currentMasterSnapshot|skipped_current_snapshot/);
  assert.match(masterStage, /importTmallProductMasterFile/);
});
