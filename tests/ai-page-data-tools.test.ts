import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const testEnvironment: { DB?: unknown } = {};
(globalThis as typeof globalThis & { __aiPageDataToolsEnv?: typeof testEnvironment }).__aiPageDataToolsEnv = testEnvironment;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") {
      return {
        url: "data:text/javascript,export const env=globalThis.__aiPageDataToolsEnv;",
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});

const {
  compareMarketItemsPageData,
  getAutomationRunStatusPageData,
  getFinanceAnalysisPageData,
  getImportStatusPageData,
  getInventoryAgePageData,
  getInventoryInboundPageData,
  getMarketWorkspaceStatusPageData,
  getNetshopProductCatalogPageData,
  getNetshopProductPerformancePageData,
  getOperatingSettingsSummaryPageData,
  listFinanceTargetsPageData,
  listNewProductProjectsPageData,
  listOperationsRecordsPageData,
  listWorkflowTasksPageData,
  listWorkflowTemplatesPageData,
} = await import("../lib/ai/page-data-tools");

const unrestrictedAnalyst = {
  email: "analyst@example.com",
  displayName: "Analyst",
  role: "analyst" as const,
  scope: null,
};
const restrictedAnalyst = {
  email: "scoped@example.com",
  displayName: "Scoped",
  role: "analyst" as const,
  scope: {
    warehouses: ["华东仓"],
    channels: ["线上"],
    platforms: ["京东"],
  },
};
const unrestrictedOperator = {
  email: "operator@example.com",
  displayName: "Operator",
  role: "operator" as const,
  scope: null,
};
const restrictedAdmin = {
  email: "admin@example.com",
  displayName: "Admin",
  role: "admin" as const,
  scope: {
    warehouses: [],
    channels: [],
    platforms: ["京东"],
  },
};

test("finance page adapters require unrestricted scope and bound the projection", async () => {
  let captured: unknown;
  const payload = await getFinanceAnalysisPageData({
    months: ["2026-07", "2026-08"],
    platforms: ["京东"],
    shopKeys: [JSON.stringify(["京东", "旗舰店"])],
  }, { principal: unrestrictedAnalyst }, {
    readFinanceAnalysis: async (input) => {
      captured = input;
      return {
        hasData: true,
        selectedMonth: "2026-08",
        selectedMonths: ["2026-07", "2026-08"],
        periodLabel: "2026-07 至 2026-08",
        current: { netSalesCents: 123_400, profitCents: 12_300 },
        previous: null,
        yearAgo: null,
        yearToDate: { netSalesCents: 999_900 },
        timeline: Array.from({ length: 30 }, (_, index) => ({ month: `m${index}`, netSalesCents: index })),
        targets: {
          month: { salesTargetCents: 200_000, targetCount: 2 },
          year: { salesTargetCents: 2_000_000, targetCount: 2 },
          projects: Array.from({ length: 30 }, (_, index) => ({ id: `p${index}`, periodType: "project" })),
        },
        progress: { month: { sales: 0.6 }, year: { sales: 0.4 } },
        expenses: Array.from({ length: 30 }, (_, index) => ({ name: `费用${index}`, current: index })),
        shops: Array.from({ length: 30 }, (_, index) => ({ name: `店铺${index}`, actual: { netSalesCents: index } })),
        anomalies: Array.from({ length: 12 }, (_, index) => ({ level: "info", title: `异常${index}`, detail: "x" })),
        filters: { shops: Array.from({ length: 500 }, (_, index) => `unsafe${index}`) },
        selection: { months: ["2026-07", "2026-08"], requestedMonths: ["2026-07", "2026-08"] },
        sync: { dataCutoffMonth: "2026-08", sourceFileName: "财报.xlsx", importedAt: "2026-08-27" },
      };
    },
  });

  assert.deepEqual(captured, {
    requestedMonths: ["2026-07", "2026-08"],
    allMonths: false,
    fallbackToLatestCompletedMonth: false,
    platformNames: ["京东"],
    shopKeys: [JSON.stringify(["京东", "旗舰店"])],
  });
  assert.equal(payload.timeline.length, 24);
  assert.equal(payload.targets.projects.length, 20);
  assert.equal(payload.expenses.length, 20);
  assert.equal(payload.shops.length, 20);
  assert.equal(payload.anomalies.length, 10);
  assert.equal("filters" in payload, false);

  let called = false;
  await assert.rejects(
    () => getFinanceAnalysisPageData({}, { principal: restrictedAnalyst }, {
      readFinanceAnalysis: async () => {
        called = true;
        return {};
      },
    }),
    (error: unknown) => (error as { code?: string }).code === "access_denied",
  );
  assert.equal(called, false);
});

test("finance targets are paged and do not expose undeclared fields", async () => {
  let captured: unknown;
  const payload = await listFinanceTargetsPageData({ page: 2, limit: 2 }, { principal: unrestrictedAnalyst }, {
    readFinanceTargets: async (input) => {
      captured = input;
      return {
        items: [
          { id: "one", periodType: "month", salesTargetCents: 10, secret: "omit" },
          { id: "two", periodType: "year", salesTargetCents: 20, secret: "omit" },
        ],
        pagination: { page: 2, pageSize: 2, total: 4, returned: 2, truncated: false },
      };
    },
  });
  assert.deepEqual(captured, { page: 2, pageSize: 2 });
  assert.equal(payload.items.length, 2);
  assert.equal("secret" in payload.items[0], false);
});

test("inventory age and inbound adapters validate filters, bound rows, and fail closed for scoped users", async () => {
  let ageInput: unknown;
  const age = await getInventoryAgePageData({
    q: "SKU-1",
    warehouses: ["华东仓"],
    brands: ["品牌甲"],
    categories: ["品类甲"],
    statuses: ["stagnant"],
    ageBuckets: ["91-120"],
    limit: 2,
  }, { principal: unrestrictedAnalyst }, {
    readInventoryAge: async (input) => {
      ageInput = input;
      return {
        hasInventory: true,
        metrics: { skuWarehouseCount: 3, aged90ValueCents: 123 },
        filters: { warehouses: Array.from({ length: 80 }, (_, index) => `仓${index}`), brands: Array.from({ length: 80 }, (_, index) => `品牌${index}`), categories: Array.from({ length: 80 }, (_, index) => `品类${index}`) },
        pagination: { page: 1, pageSize: 2, total: 3, returned: 2, truncated: true },
        items: Array.from({ length: 4 }, (_, index) => ({ productCode: `SKU-${index}`, recommendation: "x" })),
      };
    },
  });
  assert.deepEqual(ageInput, {
    query: "SKU-1",
    warehouses: ["华东仓"],
    brands: ["品牌甲"],
    categories: ["品类甲"],
    statuses: ["stagnant"],
    ageBuckets: ["91-120"],
    page: 1,
    pageSize: 2,
  });
  assert.equal(age.items.length, 2);
  assert.equal(age.filterOptions.warehouses.length, 50);
  assert.equal(age.filterOptions.brands.length, 50);
  assert.equal(age.filterOptions.categories.length, 50);

  let inboundInput: unknown;
  const inbound = await getInventoryInboundPageData({ suppliers: ["供应商A"], limit: 1 }, { principal: unrestrictedAnalyst }, {
    readInventoryInbound: async (input) => {
      inboundInput = input;
      return {
        hasInventory: true,
        regions: [{ warehouse: "华东仓" }, { warehouse: "华南仓" }],
        items: [{ productCode: "SKU-1", raw: "omit" }, { productCode: "SKU-2" }],
      };
    },
  });
  assert.deepEqual(inboundInput, { query: undefined, warehouses: [], suppliers: ["供应商A"], page: 1, pageSize: 1 });
  assert.equal(inbound.items.length, 1);
  assert.equal("raw" in inbound.items[0], false);

  await assert.rejects(
    () => getInventoryAgePageData({}, { principal: restrictedAnalyst }),
    (error: unknown) => (error as { code?: string }).code === "access_denied",
  );
  await assert.rejects(
    () => getInventoryInboundPageData({ unexpected: true }, { principal: unrestrictedAnalyst }),
    (error: unknown) => (error as { code?: string }).code === "invalid_tool_arguments",
  );
});

test("netshop adapters enforce principal platforms, channels, outlet identity, and SKU platform semantics", async () => {
  let catalogInput: unknown;
  const catalog = await getNetshopProductCatalogPageData({
    platforms: ["京东"],
    outlets: [{ platform: "京东", shopName: "旗舰店" }],
    startDate: "2026-08-01",
    endDate: "2026-08-27",
    limit: 2,
  }, { principal: restrictedAnalyst }, {
    readNetshopCatalog: async (input) => {
      catalogInput = input;
      return {
        batch: { id: "batch", fileHash: "secret", warnings: ["secret"], status: "completed" },
        items: [{ platform: "京东", skuId: "1", productName: "商品", productUrl: "omit" }],
        pagination: { page: 1, pageSize: 2, total: 1, returned: 1, truncated: false },
      };
    },
  });
  assert.deepEqual(catalogInput, {
    query: undefined,
    platformNames: ["京东"],
    outlets: [{ platform: "京东", shopName: "旗舰店" }],
    salesStartDate: "2026-08-01",
    salesEndDate: "2026-08-27",
    salesChannels: ["线上"],
    page: 1,
    pageSize: 2,
  });
  assert.equal("fileHash" in (catalog.batch ?? {}), false);
  assert.equal("productUrl" in catalog.items[0], false);

  let performanceInput: unknown;
  await getNetshopProductPerformancePageData({ dimension: "sku" }, { principal: restrictedAnalyst }, {
    readNetshopPerformance: async (input) => {
      performanceInput = input;
      return {};
    },
  });
  assert.deepEqual((performanceInput as { platformNames: string[] }).platformNames, ["京东"]);

  await assert.rejects(
    () => getNetshopProductCatalogPageData({ platforms: ["天猫"] }, { principal: restrictedAnalyst }),
    (error: unknown) => (error as { code?: string }).code === "access_denied",
  );
  await assert.rejects(
    () => getNetshopProductPerformancePageData({ dimension: "sku", platforms: ["天猫"] }, { principal: unrestrictedAnalyst }),
    (error: unknown) => (error as { code?: string }).code === "invalid_tool_arguments",
  );
  await assert.rejects(
    () => getNetshopProductCatalogPageData({ outlets: [{ platform: "京东", shopName: "店", extra: true }] }, { principal: unrestrictedAnalyst }),
    (error: unknown) => (error as { code?: string }).code === "invalid_tool_arguments",
  );
  await assert.rejects(
    () => getNetshopProductCatalogPageData({}, {
      principal: {
        ...restrictedAnalyst,
        scope: { warehouses: [], channels: [], platforms: ["抖音"] },
      },
    }),
    (error: unknown) => (error as { code?: string }).code === "access_denied",
  );
});

test("workflow adapters keep unrestricted lists closed while operations records receive the real scoped principal", async () => {
  let taskFilters: unknown;
  const tasks = await listWorkflowTasksPageData({ statuses: ["工作中"], limit: 1 }, { principal: unrestrictedAnalyst }, {
    readWorkflowTasks: async (input) => {
      taskFilters = input;
      return {
        items: [{ id: "task", title: "核对报表", workContent: "处理", createdBy: "private@example.com" }],
        summary: { total: 1, inProgress: 1, open: 1 },
        pagination: { page: 1, pageSize: 1, total: 1, returned: 1, truncated: false },
      };
    },
  });
  assert.deepEqual((taskFilters as { statuses: string[] }).statuses, ["工作中"]);
  assert.equal(tasks.items.length, 1);
  assert.equal("createdBy" in tasks.items[0], false);

  await assert.rejects(
    () => listWorkflowTasksPageData({}, { principal: restrictedAnalyst }),
    (error: unknown) => (error as { code?: string }).code === "access_denied",
  );

  let receivedPrincipal: unknown;
  let receivedFilters: unknown;
  const operations = await listOperationsRecordsPageData({ platforms: ["京东"], limit: 2 }, { principal: restrictedAnalyst }, {
    readOperationRecords: async (input, principal) => {
      receivedFilters = input;
      receivedPrincipal = principal;
      return {
        items: [{ id: "record", title: "巡店", createdBy: "private@example.com" }],
        pagination: { page: 1, pageSize: 2, total: 1, returned: 1, truncated: false },
      };
    },
  });
  assert.equal(receivedPrincipal, restrictedAnalyst);
  assert.deepEqual((receivedFilters as { platforms: string[] }).platforms, ["京东"]);
  assert.equal(operations.filtersApplied.dataScope, "restricted");
  assert.equal("createdBy" in operations.items[0], false);

  let includeInactive: boolean | undefined;
  const analystTemplates = await listWorkflowTemplatesPageData({ includeInactive: true }, { principal: unrestrictedAnalyst }, {
    readWorkflowTemplates: async (include) => {
      includeInactive = include;
      return [{ id: "active", active: true }];
    },
  });
  assert.equal(includeInactive, false);
  assert.equal(analystTemplates.includeInactive, false);

  await listWorkflowTemplatesPageData({ includeInactive: true }, { principal: unrestrictedOperator }, {
    readWorkflowTemplates: async (include) => {
      includeInactive = include;
      return [];
    },
  });
  assert.equal(includeInactive, true);
});

test("structured new-product AI projection exposes bounded stages and targets without audit identities", async () => {
  let captured: unknown;
  const payload = await listNewProductProjectsPageData({
    q: "净水器",
    statuses: ["blocked"],
    suppliers: ["供应商甲"],
    stage: "pricing",
    stageStatuses: ["blocked"],
    limit: 2,
  }, { principal: unrestrictedAnalyst }, {
    readNewProductProjects: async (input, principal) => {
      captured = { input, principal };
      return {
        workflowRevision: "3:abcdef123456",
        summary: {
          total: 1,
          blocked: 1,
          stageSummary: [{ stageKey: "pricing", label: "分析定价", blocked: 1, secret: "omit" }],
        },
        facets: { suppliers: ["供应商甲"], owners: ["负责人"], categories: ["商用净水"] },
        pagination: { page: 1, pageSize: 2, total: 1, returned: 1, truncated: false },
        items: [{
          id: "project-1",
          productName: "大通量净水器",
          supplierName: "供应商甲",
          status: "blocked",
          approvedPriceCents: 399_900,
          estimatedGrossMarginBps: 3_200,
          createdBy: "private@example.com",
          updatedBy: "private@example.com",
          privateField: "omit",
          targets: [{ platform: "京东", shopName: "旗舰店", listingSku: "JD-1", internal: "omit" }],
          stages: [{
            stageKey: "pricing",
            label: "分析定价",
            status: "blocked",
            blocker: "等待成本",
            evidenceUrl: "https://example.test/pricing.xlsx",
            evidenceLabel: "定价表",
            updatedBy: "private@example.com",
          }],
        }],
      };
    },
  });
  assert.equal((captured as { principal: unknown }).principal, unrestrictedAnalyst);
  assert.equal((captured as { input: { stage?: string } }).input.stage, "pricing");
  assert.equal(payload.available, true);
  assert.equal(payload.workflowRevision, "3:abcdef123456");
  assert.equal(payload.items[0]?.stages[0]?.blocker, "等待成本");
  assert.equal("createdBy" in payload.items[0]!, false);
  assert.equal("updatedBy" in payload.items[0]!, false);
  assert.equal("internal" in payload.items[0]!.targets[0]!, false);
  assert.equal("updatedBy" in payload.items[0]!.stages[0]!, false);

  let called = false;
  await assert.rejects(
    () => listNewProductProjectsPageData({}, { principal: restrictedAnalyst }, {
      readNewProductProjects: async () => { called = true; return {}; },
    }),
    (error: unknown) => (error as { code?: string }).code === "access_denied",
  );
  assert.equal(called, false);
});

test("import status enforces source-specific authorization and removes hashes, warnings, and raw payloads", async () => {
  await assert.rejects(
    () => getImportStatusPageData({ source: "netshop" }, { principal: unrestrictedAnalyst }),
    (error: unknown) => (error as { code?: string }).code === "insufficient_role",
  );
  await assert.rejects(
    () => getImportStatusPageData({ source: "sales" }, { principal: restrictedAnalyst }),
    (error: unknown) => (error as { code?: string }).code === "access_denied",
  );

  let captured: unknown;
  const payload = await getImportStatusPageData({ source: "netshop", platforms: ["京东"], limit: 2 }, { principal: restrictedAdmin }, {
    readImportBatches: async (source, input) => {
      captured = { source, input };
      return {
        items: [{
          id: "batch",
          source: "jd_sku_daily",
          platform: "京东",
          shopName: "旗舰店",
          status: "completed",
          rowCount: 100,
          fileHash: "secret",
          warnings: ["secret"],
          raw: { secret: true },
        }],
        pagination: { page: 1, pageSize: 2, total: 1, returned: 1, truncated: false },
      };
    },
  });
  assert.deepEqual(captured, { source: "netshop", input: { page: 1, pageSize: 2, platforms: ["京东"] } });
  assert.equal(payload.items[0].status, "completed");
  assert.equal("fileHash" in payload.items[0], false);
  assert.equal("warnings" in payload.items[0], false);
  assert.equal("raw" in payload.items[0], false);
});

test("automation status reports an explicit unavailable gap without probing localhost", async () => {
  const result = await getAutomationRunStatusPageData({ workflowKey: "tmall" }, { principal: restrictedAnalyst });
  assert.equal(result.available, false);
  assert.equal(result.status, "unavailable");
  assert.equal(result.gapCode, "automation_status_projection_unavailable");
  assert.match(result.message, /未调用本机 helper/);
});

test("market comparison requires exact identities and bounds trend history", async () => {
  const selections = [
    { skuCode: "SKU-1", category: "净水器", scope: "TOP100", rankingDimension: "SKU" as const },
    { skuCode: "SKU-2", category: "净水器", scope: "TOP100", rankingDimension: "SKU" as const },
  ];
  let captured: unknown;
  const result = await compareMarketItemsPageData({ selections }, { principal: unrestrictedAnalyst }, {
    readMarketComparison: async (input) => {
      captured = input;
      return {
        items: [{
          ...selections[0],
          productName: "商品",
          gmvCents: 100,
          trend: Array.from({ length: 30 }, (_, index) => ({ month: `m${index}`, gmvCents: index, raw: "omit" })),
        }],
        missingSelections: [selections[1]],
      };
    },
  });
  assert.deepEqual(captured, { selections, startDate: undefined, endDate: undefined });
  assert.equal(result.items[0].trend.length, 24);
  assert.equal("raw" in result.items[0].trend[0], false);
  assert.deepEqual(result.missingSelections[0], selections[1]);

  await assert.rejects(
    () => compareMarketItemsPageData({ selections: [selections[0]] }, { principal: unrestrictedAnalyst }),
    (error: unknown) => (error as { code?: string }).code === "invalid_tool_arguments",
  );
  await assert.rejects(
    () => getMarketWorkspaceStatusPageData({}, { principal: restrictedAnalyst }),
    (error: unknown) => (error as { code?: string }).code === "access_denied",
  );
});

test("market and settings summaries expose only bounded non-sensitive fields", async () => {
  const market = await getMarketWorkspaceStatusPageData({}, { principal: unrestrictedAnalyst }, {
    readMarketStatus: async () => ({
      dataRange: { startDate: "2026-01-01", endDate: "2026-08-01" },
      batches: Array.from({ length: 10 }, (_, index) => ({
        id: `batch-${index}`,
        status: "completed",
        rowCount: 10,
        fileHash: "secret",
        warnings: ["secret"],
      })),
      imageCache: { total: 10, cached: 8, failed: 1, pending: 1 },
    }),
  });
  assert.equal(market.batches.length, 8);
  assert.equal("fileHash" in market.batches[0], false);

  const settings = await getOperatingSettingsSummaryPageData({}, { principal: unrestrictedAnalyst }, {
    readOperatingSettings: async () => ({
      targetDays: 30,
      criticalDays: 7,
      slowDays: 45,
      stagnantDays: 90,
      autoReplenishment: true,
      inventoryAlert: true,
      allowNegativeInventory: false,
      updatedAt: "2026-08-27",
      updatedBy: "private@example.com",
      secret: "omit",
    }),
  });
  assert.equal(settings.settings.targetDays, 30);
  assert.equal("updatedBy" in settings.settings, false);
  assert.equal("secret" in settings.settings, false);
});
