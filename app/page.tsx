"use client";

import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode, RefObject } from "react";
import { requestJson } from "@/lib/http/api-client";
import { parseProductQueries } from "@/lib/sales/product-query";
import AppShell from "./shell/app-shell";
import GlobalHeader from "./shell/global-header";
import ModuleErrorBoundary from "./shell/module-error-boundary";
import {
  createReloadableLazy,
  resetReloadableLazyScope,
} from "./shell/reloadable-lazy";
import {
  getDefaultModuleView,
  isModuleKey,
  navItems,
  type ImportSourceKey,
  type ModuleKey,
  type ModuleViewKey,
} from "./shell/navigation-catalog";
import {
  normalizeShellLocation,
  parseShellLocation,
  serializeShellLocation,
  type ShellPeriodState,
} from "./shell/navigation-contract";
import { normalizeModuleView } from "./shell/module-view-contract";
import SidebarNavigation from "./shell/sidebar-navigation";
import { useModuleViewState } from "./shell/use-module-view-state";
import type { AppCurrentUser } from "./shell/view-contract";
import CustomerServiceImportCard from "./customer-service-import-card";
import type {
  GlobalSearchGroupKey,
  GlobalSearchItem,
  GlobalSearchResult,
} from "./global-search-dialog";
import Dialog from "./ui/dialog";
import { SearchableMultiSelect, SearchableSelect } from "./ui/searchable-select";
import TableColumnFilters from "./ui/table-column-filters";
import SalesFilterBar, {
  readSalesSharedFilters,
  writeSalesSharedFilters,
  type SalesSharedFilters,
} from "./sales-filter-bar";

const { Component: MarketView } = createReloadableLazy("market", () => import("./market-view"));
const { Component: N8nWorkflowView } = createReloadableLazy("n8n_workflows", () => import("./n8n-workflow-view"));
const { Component: OperationsView } = createReloadableLazy("workflow", () => import("./operations-view"));
const { Component: SalesCategoryView } = createReloadableLazy("sales", () => import("./sales-category-view"));
const { Component: SettingsView } = createReloadableLazy("settings", () => import("./settings-view"));
const GlobalSearchDialog = lazy(() => import("./global-search-dialog"));
const { Component: CustomerServiceView } = createReloadableLazy("customer_service", () => import("./customer-service-view"));
const { Component: AiAssistantView } = createReloadableLazy("ai", () => import("./ai-assistant-view"));

type GlobalSearchLoadBoundaryProps = {
  children: ReactNode;
  resetKey: number;
  onRetry: () => void;
  onClose: () => void;
  returnFocusRef: RefObject<HTMLElement | null>;
};

class GlobalSearchLoadBoundary extends Component<GlobalSearchLoadBoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(previousProps: GlobalSearchLoadBoundaryProps) {
    if (this.state.failed && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <Dialog open onClose={this.props.onClose} dialogId="global-search-load-error" ariaLabel="全系统搜索加载失败" className="panel search-modal" returnFocusRef={this.props.returnFocusRef}>
      <div className="data-state data-state-error" role="alert" aria-live="assertive">
        <span className="state-symbol" aria-hidden="true">!</span>
        <strong>全系统搜索加载失败</strong>
        <p>搜索工作区未载入，当前页面与筛选未受影响。</p>
        <div className="data-state-actions">
          <button type="button" className="primary-button" onClick={this.props.onRetry}>重新加载搜索</button>
          <button type="button" className="secondary-button" onClick={this.props.onClose}>关闭</button>
        </div>
      </div>
    </Dialog>;
  }
}

function GlobalSearchLoadingDialog({ onClose, returnFocusRef }: { onClose: () => void; returnFocusRef: RefObject<HTMLElement | null> }) {
  return <Dialog open onClose={onClose} dialogId="global-search-loading" ariaLabel="正在加载全系统搜索" className="panel search-modal" returnFocusRef={returnFocusRef}>
    <div className="data-state" role="status" aria-live="polite">
      <span className="state-spinner" aria-hidden="true" />
      <strong>正在加载全系统搜索</strong>
      <p>正在载入搜索工作区…</p>
      <button type="button" className="secondary-button" onClick={onClose}>取消</button>
    </div>
  </Dialog>;
}

type CurrentUser = AppCurrentUser;

export function canManageFinanceTargets(
  currentUser: Pick<CurrentUser, "role"> | null | undefined,
): boolean {
  return currentUser?.role === "admin";
}

export function validateFinanceTargetDeletionReason(value: string | null):
  | { status: "accepted"; reason: string }
  | { status: "cancelled" }
  | { status: "invalid" } {
  if (value === null) return { status: "cancelled" };
  const reason = value.trim();
  if (!reason || reason.length > 200) return { status: "invalid" };
  return { status: "accepted", reason };
}

type SalesRangeLabel = "今日" | "昨天" | "近7天" | "近15天" | "本月" | "月度" | "自定义";
type SalesRange = "today" | "yesterday" | "last7" | "last15" | "month" | "quarter" | "custom";

type SalesStats = {
  grossSalesCents: number;
  netSalesCents: number;
  grossProfitCents: number;
  refundAmountCents: number;
  orderCount: number;
  lineCount: number;
  netQuantity: number;
  averageOrderValueCents: number;
  grossMarginRate: number;
  refundRate: number;
};

type SalesChannel = {
  groupKey: string;
  name: string;
  platform: string;
  grossSalesCents: number;
  netSalesCents: number;
  grossProfitCents: number;
  refundAmountCents: number;
  grossMarginRate: number;
  refundRate: number;
  shareRate: number;
  orderCount: number;
  lineCount: number;
  netQuantity: number;
  averageOrderValueCents: number;
  yearAgoNetSalesCents: number;
  salesYearOverYearRate: number | null;
};

type SalesSummaryResponse = {
  range: SalesRange;
  startDate: string;
  endDate: string;
  requestedStartDate?: string;
  requestedEndDate?: string;
  dataCutoffDate?: string | null;
  periodAdjustedToDataCutoff?: boolean;
  comparisonDayCount?: number;
  previousStartDate?: string;
  previousEndDate?: string;
  yearAgoStartDate?: string;
  yearAgoEndDate?: string;
  current: SalesStats;
  previous?: SalesStats;
  yearAgo?: SalesStats;
  channels: SalesChannel[];
  outlets?: SalesChannel[];
  shops?: SalesChannel[];
  platforms?: SalesChannel[];
  latestBatch?: {
    id: string;
    fileName: string;
    completedAt?: string | null;
  } | null;
  daily?: Array<{ date: string } & SalesStats>;
  previousDaily?: Array<{ date: string } & SalesStats>;
  yearAgoDaily?: Array<{ date: string } & SalesStats>;
  filters?: { productCodes: string[]; platform?: string | null; platforms?: string[]; shop?: string | null; outlets?: Array<{ platform: string; shop: string }>; categories?: string[] };
  filterOptions?: {
    platforms: string[];
    shops: Array<{ key: string; name: string; platform: string }>;
    categories: string[];
  };
};

type ProductSummaryItem = {
  productCode: string;
  productName: string;
  brand: string;
  supplierName: string;
  specification: string;
  category: string;
  outlets: Array<{ platform: string; shop: string }>;
  netQuantity: number;
  grossSalesCents: number;
  refundAmountCents: number;
  netSalesCents: number;
  costCents: number;
  feeCents: number;
  grossProfitCents: number;
  grossMarginRate: number | null;
  refundRate: number;
  averageSalePriceCents: number | null;
  averageCostCents: number | null;
  observedFeeRate: number | null;
  availableQuantity: number | null;
  stockValueCents: number | null;
  knownStockValueCents: number | null;
  costCoverageRate: number | null;
};

type ProductShopFilterOption = {
  key: string;
  platform: string;
  shop: string;
};

type ProductSummaryResponse = {
  hasSales: boolean;
  range: "last30" | "last90" | "halfYear" | "custom";
  sync: {
    salesThrough: string | null;
    salesWindowStart: string | null;
    dataStartDate: string | null;
    dataCutoffDate: string | null;
    inventoryAsOf: string | null;
    latestSalesFile: string | null;
  };
  filters: { platforms: string[]; shops: ProductShopFilterOption[]; categories: string[] };
  filtersApplied: { platforms: string[]; shops: ProductShopFilterOption[]; query: string; categories: string[]; marginBands: string[] };
  pagination: { page: number; pageSize: number; total: number; returned: number; totalPages: number; truncated: boolean };
  metrics: {
    skuCount: number;
    grossSalesCents: number;
    netSalesCents: number;
    grossProfitCents: number;
    grossMarginRate: number | null;
    lossSkuCount: number;
    stockedSkuCount: number;
    marginBuckets: {
      below35Count: number;
      between35And40Count: number;
      between40And45Count: number;
      atLeast45Count: number;
    };
  };
  items: ProductSummaryItem[];
};

type InventoryHealthStatus = "urgent" | "replenish" | "healthy" | "slow" | "stagnant" | "no_sales";
type InventoryAgeStatus = "healthy" | "aged" | "slow" | "stagnant" | "no_stock";

type InventoryOverviewItem = {
  key: string;
  productCode: string;
  productName: string;
  specification: string;
  category: string;
  warehouse: string;
  warehouseType: "owned" | "jd_rdc" | "other";
  onHandQuantity: number;
  availableQuantity: number;
  lockedQuantity: number;
  sourceInTransitQuantity: number;
  plannedInTransitQuantity: number;
  totalInTransitQuantity: number;
  unitCostCents: number;
  inventoryAgeDays: number | null;
  stockValueCents: number | null;
  knownStockValueCents: number;
  costCoverageRate: number;
  sales30d: number | null;
  averageDailySales: number | null;
  coverageDays: number | null;
  suggestedQuantity: number | null;
  status: InventoryHealthStatus;
  statusLabel: string;
  reason: string;
  inDraftPlan: boolean;
};

type ReplenishmentPlanItem = {
  id: string;
  sourceBatchId: string;
  productCode: string;
  productName: string;
  warehouse: string;
  suggestedQuantity: number;
  plannedQuantity: number;
  coverageDays: number | null;
  reason: string;
  status: "draft" | "confirmed" | "completed" | "cancelled";
  createdAt: string;
  updatedAt: string;
};

type InventoryOverviewResponse = {
  hasInventory: boolean;
  sync: {
    latestInventoryBatchId: string | null;
    inventoryAsOf: string | null;
    inventorySyncedAt: string | null;
    salesThrough: string | null;
    salesWindowStart: string | null;
    latestInventoryFile: string | null;
    inventoryStale: boolean;
  };
  settings: {
    targetDays: number;
    criticalDays: number;
    replenishDays: number;
    slowDays: number;
    stagnantDays: number;
    salesWindowDays: number;
  };
  metrics: {
    skuWarehouseCount: number;
    totalAvailableQuantity: number;
    totalStockValueCents: number;
    knownStockValueCents: number;
    stockValueComplete: boolean;
    costCoverageRate: number;
    salesDemandMatchRate: number;
    averageCoverageDays: number | null;
    urgentCount: number;
    replenishCount: number;
    slowMovingValueCents: number;
    noSalesCount: number;
    recommendationCount: number;
  };
  health: {
    urgent: number;
    replenish: number;
    healthy: number;
    slow: number;
    stagnant: number;
    noSales: number;
  };
  sources: Array<{
    key: string;
    label: string;
    status: "ready" | "missing" | "stale";
    asOfDate: string | null;
  }>;
  filters: { warehouses: string[]; statuses: InventoryHealthStatus[] };
  pagination: { page: number; pageSize: number; limit: number; total: number; returned: number; totalPages: number; truncated: boolean };
  recommendations: InventoryOverviewItem[];
  items: InventoryOverviewItem[];
  plans: ReplenishmentPlanItem[];
  plansPagination: { page: number; pageSize: number; total: number; returned: number; totalPages: number; truncated: boolean };
  planSummary: {
    draftCount: number;
    confirmedCount: number;
    completedCount: number;
    cancelledCount: number;
    activeQuantity: number;
  };
};

type InventoryAgeItem = {
  key: string;
  productCode: string;
  productName: string;
  specification: string;
  category: string;
  warehouse: string;
  warehouseType: "owned" | "jd_rdc" | "other";
  availableQuantity: number;
  stockValueCents: number | null;
  inventoryAgeDays: number | null;
  sales7dQuantity: number | null;
  sales30dQuantity: number | null;
  status: InventoryAgeStatus;
  statusLabel: string;
  recommendation: string;
};

type InventoryAgeAnalysisResponse = {
  hasInventory: boolean;
  sync: { inventoryAsOf: string | null; latestInventoryBatchId: string | null; sourceKey?: "inventory_age" | "inventory"; hasAgeSales: boolean };
  metrics: { skuWarehouseCount: number; stockValueComplete: boolean; aged90Count: number; aged90ValueCents: number; stagnantCount: number; stagnantValueCents: number; zeroSalesCount: number; cleanupCount: number };
  distribution: Array<{ key: string; label: string; count: number; valueCents: number }>;
  filters: { warehouses: string[]; statuses: InventoryAgeStatus[] };
  pagination: { page: number; pageSize: number; limit: number; total: number; returned: number; totalPages: number; truncated: boolean };
  items: InventoryAgeItem[];
};

type InventoryImportResponse = {
  ok: boolean;
  status: "imported" | "duplicate" | "rejected";
  message?: string;
  batch?: {
    fileName: string;
    snapshotDate: string;
    rowCount: number;
    insertedCount: number;
  } | null;
  warnings?: ImportIssue[];
  errors?: ImportIssue[];
};

type InventoryChunkUploadResponse = Partial<InventoryImportResponse> & {
  ok: boolean;
  status?: string;
  message?: string;
  upload?: {
    id: string;
    receivedChunkIndexes: number[];
    receivedBytes: number;
    chunkCount: number;
  };
};

type ImportIssue = {
  code?: string;
  message: string;
  row?: number;
  sourceRowNumber?: number;
};

type SalesImportBatch = {
  id: string;
  source: string;
  fileName: string;
  fileSizeBytes: number;
  sheetName?: string | null;
  status: "imported" | "duplicate" | "rejected" | string;
  rowCount: number;
  insertedCount: number;
  duplicateCount: number;
  warningCount: number;
  warnings?: ImportIssue[];
  createdAt: string;
  completedAt?: string | null;
};

type ImportHistoryResponse = {
  items: SalesImportBatch[];
};

type InventoryImportHistoryItem = Pick<SalesImportBatch, "id" | "fileName" | "status" | "rowCount" | "insertedCount" | "warningCount" | "createdAt" | "completedAt"> & { snapshotDate: string };

type ErpReferenceImportBatch = {
  id: string;
  sourceKey: "products" | "inventory_age" | "combos";
  sourceLabel: string;
  fileName: string;
  fileSizeBytes: number;
  sheetName?: string | null;
  snapshotDate?: string | null;
  status: string;
  rowCount: number;
  insertedCount: number;
  updatedCount: number;
  excludedCount: number;
  warningCount: number;
  warnings?: ImportIssue[];
  createdAt: string;
  completedAt?: string | null;
};

type UnifiedImportBatch = {
  id?: string;
  dataset?: string;
  fileName?: string;
  fileSizeBytes?: number;
  sheetName?: string | null;
  snapshotDate?: string | null;
  rowCount?: number;
  insertedCount?: number;
  updatedCount?: number;
  duplicateCount?: number;
  excludedCount?: number;
  warningCount?: number;
  warnings?: ImportIssue[];
};

type UnifiedImportResponse = {
  ok: boolean;
  status?: string;
  message?: string;
  batch?: UnifiedImportBatch | null;
  warnings?: ImportIssue[];
  errors?: ImportIssue[];
  verification?: { verified: boolean; parsedRowCount: number; readbackRowCount: number; dateMin: string | null; dateMax: string | null; unmatchedProductCount: number };
  upload?: {
    id: string;
    receivedChunkIndexes: number[];
    receivedBytes: number;
    chunkCount: number;
  };
};

type UnifiedHistoryItem = {
  id: string;
  sourceKey: ImportSourceKey;
  sourceLabel: string;
  fileName: string;
  fileSizeBytes?: number;
  sheetName?: string | null;
  snapshotDate?: string | null;
  status: string;
  rowCount: number;
  insertedCount: number;
  updatedCount?: number;
  duplicateCount?: number;
  excludedCount?: number;
  warningCount: number;
  createdAt: string;
  completedAt?: string | null;
};

type CustomerServiceImportHistoryItem = {
  id: string; shopName: string; sessionFileName: string; chatFileName: string; status: string; conversationCount: number; matchedCount: number; warnings: string[]; createdAt: string; completedAt?: string | null;
};

type NetshopImportHistoryItem = {
  id: string;
  source: string;
  dataset: string;
  fileName: string;
  fileSizeBytes: number;
  sheetName?: string | null;
  snapshotDate?: string | null;
  status: string;
  rowCount: number;
  insertedCount: number;
  duplicateCount: number;
  warningCount: number;
  warnings?: ImportIssue[];
  createdAt: string;
  completedAt?: string | null;
};

type JdSkuCatalogItem = {
  platform: string;
  shopName: string;
  spuId: string;
  skuId: string;
  productCode: string;
  productName: string;
  imageUrl: string;
  saleAttribute: string;
  category: string;
  brand: string;
  price: number | null;
  priceCents: number | null;
  totalInventory: number | null;
  availableInventory: number | null;
  status: string;
  productUrl: string;
  createdAt: string;
  snapshotDate: string | null;
  costPriceCents: number | null;
  netSalesCents: number | null;
  grossMarginRate: number | null;
  refundRate: number | null;
  salesMatched: boolean;
};

type JdSkuCatalogResponse = {
  batch: Pick<NetshopImportHistoryItem, "fileName" | "snapshotDate" | "rowCount" | "completedAt"> | null;
  summary: { totalSkus: number; onSaleSkus: number; totalInventory: number; availableInventory: number };
  shops: Array<{ shopName: string; platform: string; snapshotDate: string | null; completedAt: string | null }>;
  sales: { periodStart: string | null; periodEnd: string | null; dataCutoffDate: string | null; platform: string };
  items: JdSkuCatalogItem[];
  pagination: { page: number; pageSize: number; total: number; returned?: number; truncated?: boolean };
};

type NetshopProductPerformanceDimension = "sku" | "spu";

type NetshopProductPerformanceItem = {
  id: string;
  platform: string;
  skuId: string;
  spuId: string;
  productCode: string;
  productName: string;
  category: string;
  shopNames: string[];
  dateMin: string | null;
  dateMax: string | null;
  dataDays: number;
  pageViews: number;
  visitors: number;
  searchImpressions: number;
  searchClicks: number;
  searchClickRate: number | null;
  addCartCustomers: number;
  addCartQuantity: number;
  orderCustomers: number;
  orderQuantity: number;
  orderAmount: number;
  orderAmountCents: number;
  transactionOrders: number;
  transactionAmount: number;
  transactionAmountCents: number;
  transactionQuantity: number;
  transactionCustomers: number;
  favorites: number;
  refundAmountCents: number;
  searchVisitors: number;
  searchTransactionCustomers: number;
  uvValue: number | null;
  conversionRate: number | null;
};

type NetshopProductPerformanceResponse = {
  dimension: NetshopProductPerformanceDimension;
  dataset: "sku_daily" | "spu_daily";
  requestedPeriod: { startDate: string | null; endDate: string | null };
  dateMin: string | null;
  dataCutoffDate: string | null;
  monetaryUnit: "cents";
  visitorAggregation: "product_day_sum";
  coverage: {
    actualDates: string[];
    missingDates: string[];
    availableDateMin: string | null;
    availableDateMax: string | null;
  };
  platforms: string[];
  shops: Array<{ shopName: string; platform: string; productCount: number }>;
  summary: {
    productCount: number;
    pageViews: number;
    visitors: number;
    searchImpressions: number;
    searchClicks: number;
    searchClickRate: number | null;
    addCartCustomers: number;
    addCartQuantity: number;
    orderCustomers: number;
    orderQuantity: number;
    orderAmount: number;
    orderAmountCents: number;
    transactionOrders: number;
    transactionAmount: number;
    transactionAmountCents: number;
    transactionQuantity: number;
    transactionCustomers: number;
    favorites: number;
    refundAmountCents: number;
    searchVisitors: number;
    searchTransactionCustomers: number;
    uvValue: number | null;
    conversionRate: number | null;
  };
  daily: Array<{
    date: string;
    pageViews: number;
    visitors: number;
    transactionCustomers: number;
    transactionQuantity: number;
    transactionAmountCents: number;
    refundAmountCents: number;
    favorites: number;
    addCartCustomers: number;
    addCartQuantity: number;
  }>;
  items: NetshopProductPerformanceItem[];
  pagination: { page: number; pageSize: number; total: number; returned?: number; truncated?: boolean };
};

type NetshopPromotionPerformanceResponse = {
  monetaryUnit: "cents";
  requestedPeriod: { startDate: string | null; endDate: string | null };
  dateMin: string | null;
  dataCutoffDate: string | null;
  coverage: { promotionDates: string[]; productDailyDates: string[]; intersectionDates: string[]; missingProductDailyDates: string[]; missingPromotionDates: string[] };
  summary: {
    productCount: number; spendCents: number; netTransactionAmountCents: number; grossTransactionAmountCents: number;
    platformPaymentAmountCents: number; impressions: number; clicks: number; netOrders: number; favorites: number; cartQuantity: number;
    clickThroughRate: number | null; averageClickCostCents: number | null; roas: number | null; spendRate: number | null; promotionTransactionShare: number | null;
  };
  daily: Array<{ date: string; spendCents: number; netTransactionAmountCents: number; platformPaymentAmountCents: number | null; impressions: number; clicks: number; netOrders: number; roas: number | null; spendRate: number | null; promotionTransactionShare: number | null }>;
  items: Array<{ id: string; platform: string; productName: string; shopName: string; dateMin: string | null; dateMax: string | null; dates?: string[]; dataDays: number; spendCents: number; netTransactionAmountCents: number; grossTransactionAmountCents: number; impressions: number; clicks: number; netOrders: number; favorites: number; cartQuantity: number; clickThroughRate: number | null; averageClickCostCents: number | null; roas: number | null }>;
  pagination: { page: number; pageSize: number; total: number; returned: number; truncated: boolean };
};

const netshopOutletFilterKey = (platform: string, shopName: string) => `${platform}\u001f${shopName}`;

type FinanceActualMetrics = {
  grossSalesCents: number;
  returnAmountCents: number;
  netSalesCents: number;
  netCostCents: number;
  grossProfitCents: number;
  grossMarginBps: number;
  returnRateBps: number;
  sellingExpenseCents: number;
  smallProfitCents: number;
  smallMarginBps: number;
  otherExpenseCents: number;
  profitCents: number;
  profitMarginBps: number;
  promotionExpenseCents: number;
  promotionFeeRatioBps: number;
};

type FinanceTargetTotals = {
  salesTargetCents: number;
  profitTargetCents: number;
  smallMarginBps: number;
  inventoryCleanupTargetCents: number;
  promotionFeeRatioBps: number;
  stagnantInventoryTargetCents: number;
  targetCount: number;
};

type FinanceProgress = {
  sales: number | null;
  profit: number | null;
  smallMarginGapBps: number | null;
  promotionFeeGapBps: number | null;
};

type FinanceTarget = {
  id: string;
  periodType: "month" | "year" | "project";
  periodKey: string;
  platform: string;
  shopName: string;
  category: string;
  manager: string;
  salesTargetCents: number;
  profitTargetCents: number;
  smallMarginBps: number;
  inventoryCleanupTargetCents: number;
  promotionFeeRatioBps: number;
  stagnantInventoryTargetCents: number;
  version: number;
  createdAt: string;
  updatedAt: string;
};

type FinanceAnalysisResponse = {
  hasData: boolean;
  selectedMonth: string | null;
  selectedMonths?: string[];
  periodLabel?: string;
  previousMonth?: string | null;
  previousMonths?: string[];
  yearAgoMonth?: string | null;
  yearAgoMonths?: string[];
  months: Array<{ month: string; fileName: string; importedAt: string; shopCount: number; subjectCount: number }>;
  current?: FinanceActualMetrics;
  previous?: FinanceActualMetrics | null;
  yearAgo?: FinanceActualMetrics | null;
  yearToDate?: FinanceActualMetrics;
  timeline: Array<{ month: string } & FinanceActualMetrics>;
  targets?: { month: FinanceTargetTotals; year: FinanceTargetTotals; projects: FinanceTarget[]; legacyCompatibility?: { excluded: number; reason: string } };
  progress?: { month: FinanceProgress; year: FinanceProgress };
  expenses: Array<{ name: string; current: number; previous: number | null; yearAgo: number | null; feeRateBps: number; yearAgoFeeRateBps: number | null; momRate: number | null; yoyRate: number | null; abnormal: boolean }>;
  shops: Array<{ key: string; name: string; groupName: string; manager: string; actual: FinanceActualMetrics; target: FinanceTargetTotals; progress: FinanceProgress }>;
  anomalies: Array<{ level: "critical" | "warning" | "info"; title: string; detail: string }>;
  filters?: { platforms: string[]; shops: Array<{ key: string; name: string; platform: string }> };
  selection?: { allMonths: boolean; months: string[]; platforms: string[]; shops: string[]; truncated: boolean; availableMonthCount: number };
  sync?: { dataCutoffMonth: string; sourceFileName: string; importedAt: string };
  error?: string;
};

type FinanceTargetOptions = { shops: Array<{ key: string; platform: string; name: string }>; categories: string[]; projects: string[]; pagination?: { shops: { total: number; returned: number; truncated: boolean } } };

type ImportFeedback = {
  tone: "success" | "warning" | "error" | "duplicate";
  title: string;
  message: string;
  details: string[];
};

const salesRangeMap: Record<SalesRangeLabel, SalesRange> = {
  今日: "today",
  昨天: "yesterday",
  近7天: "last7",
  近15天: "last15",
  本月: "month",
  月度: "custom",
  自定义: "custom",
};

const channelTones = ["blue", "purple", "green", "orange"] as const;
const channelColors = ["#4776e6", "#8167d9", "#27a978", "#e99436"];
const DIRECT_IMPORT_FILE_SIZE = 2 * 1024 * 1024;
const MAX_IMPORT_FILE_SIZE = 128 * 1024 * 1024;
const SALES_UPLOAD_CHUNK_SIZE = 2 * 1024 * 1024;
const MAX_INVENTORY_FILE_SIZE = 20 * 1024 * 1024;
const DIRECT_INVENTORY_FILE_SIZE = 1024 * 1024;
const INVENTORY_UPLOAD_CHUNK_SIZE = 1024 * 1024;
const MAX_FINANCE_FILE_SIZE = 8 * 1024 * 1024;
const MAX_JD_SKU_FILE_SIZE = 25 * 1024 * 1024;

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 0,
  }).format(value);

const formatCurrencyFromCents = (value = 0) => formatCurrency(value / 100);
const formatExactCurrencyFromCents = (value = 0) => new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "CNY",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(value / 100);
const formatMerchantCurrency = (value?: number | null) => value === null || value === undefined
  ? "—"
  : `¥${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value)}`;
const formatOptionalCurrencyFromCents = (value?: number | null) => value === null || value === undefined ? "—" : formatCurrencyFromCents(value);
const formatOptionalRate = (value?: number | null) => value === null || value === undefined ? "—" : formatRate(value);
const formatCount = (value = 0) => new Intl.NumberFormat("zh-CN").format(value);
const rateAsPercent = (value = 0) => value * 100;
const formatRate = (value = 0) => `${rateAsPercent(value).toFixed(1)}%`;
const formatYearOverYear = (value?: number | null) => value === null || value === undefined
  ? "—"
  : `${value >= 0 ? "+" : ""}${rateAsPercent(value).toFixed(1)}%`;
const formatNetSalesYearOverYear = (value?: number | null) => value === null || value === undefined
  ? "无同期数据"
  : formatYearOverYear(value);
const netSalesYearOverYearTone = (value?: number | null) => value === null || value === undefined
  ? "muted-text"
  : value < 0 ? "orange-text" : "green-text";
const formatFileSize = (bytes = 0) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const DAY_MS = 86_400_000;
const addIsoDays = (value: string, days: number) => {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const isoDayDifference = (start: string, end: string) => Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS);
const shanghaiIsoToday = () => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
};
const selectedMonthPeriod = (month: string) => {
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { startDate: `${month}-01`, endDate: `${month}-${String(lastDay).padStart(2, "0")}` };
};
const skuSalesPeriod = (range: SalesRangeLabel, customStartDate: string, customEndDate: string) => {
  const today = shanghaiIsoToday();
  if (range === "今日") return { startDate: today, endDate: today };
  if (range === "昨天") {
    const yesterday = addIsoDays(today, -1);
    return { startDate: yesterday, endDate: yesterday };
  }
  if (range === "近7天") return { startDate: addIsoDays(today, -6), endDate: today };
  if (range === "近15天") return { startDate: addIsoDays(today, -14), endDate: today };
  if (range === "月度" || range === "自定义") return { startDate: customStartDate, endDate: customEndDate };
  return { startDate: `${today.slice(0, 7)}-01`, endDate: today };
};

const shellPeriodForRange = (
  range: SalesRangeLabel,
  selectedMonth: string,
  customStartDate: string,
  customEndDate: string,
): ShellPeriodState => {
  if (range === "今日") return { kind: "today" };
  if (range === "昨天") return { kind: "yesterday" };
  if (range === "近7天") return { kind: "last7" };
  if (range === "近15天") return { kind: "last15" };
  if (range === "月度") return { kind: "calendar_month", month: selectedMonth };
  if (range === "自定义") return { kind: "custom", from: customStartDate, to: customEndDate };
  return { kind: "current_month" };
};

const rangeForShellPeriod = (period: ShellPeriodState): SalesRangeLabel => {
  if (period.kind === "today") return "今日";
  if (period.kind === "yesterday") return "昨天";
  if (period.kind === "last7") return "近7天";
  if (period.kind === "last15") return "近15天";
  if (period.kind === "calendar_month") return "月度";
  if (period.kind === "custom") return "自定义";
  return "本月";
};

type ProductComparisonMode = "period" | "year";

const moveIsoYears = (value: string, offset: number) => {
  const [year, month, day] = value.split("-").map(Number);
  const targetYear = year + offset;
  const targetLastDay = new Date(Date.UTC(targetYear, month, 0)).getUTCDate();
  return `${targetYear}-${String(month).padStart(2, "0")}-${String(Math.min(day, targetLastDay)).padStart(2, "0")}`;
};

const productComparisonPeriod = (
  current: { startDate: string; endDate: string },
  mode: ProductComparisonMode,
) => {
  if (mode === "year") {
    return { startDate: moveIsoYears(current.startDate, -1), endDate: moveIsoYears(current.endDate, -1) };
  }
  const days = Math.max(1, isoDayDifference(current.startDate, current.endDate) + 1);
  const endDate = addIsoDays(current.startDate, -1);
  return { startDate: addIsoDays(endDate, -(days - 1)), endDate };
};

const productComparisonRate = (value?: number | null, baseline?: number | null) => {
  if (value === null || value === undefined || baseline === null || baseline === undefined || baseline === 0) return null;
  return (value - baseline) / Math.abs(baseline);
};

const formatProductComparison = (value?: number | null, baseline?: number | null) => {
  const rate = productComparisonRate(value, baseline);
  return rate === null ? "—" : `${rate >= 0 ? "+" : ""}${(rate * 100).toFixed(1)}%`;
};

function useDebouncedValue<T>(value: T, delay = 260) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);
  return debounced;
}

const startOfIsoMonth = (value: string) => `${value.slice(0, 7)}-01`;
const endOfIsoMonth = (value: string) => {
  const [year, month] = value.slice(0, 7).split("-").map(Number);
  return `${value.slice(0, 7)}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}`;
};
const addIsoMonths = (value: string, months: number) => {
  const [year, month, day] = value.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
};
const addIsoYears = (value: string, years: number) => {
  const [year, month, day] = value.split("-").map(Number);
  const targetYear = year + years;
  const lastDay = new Date(Date.UTC(targetYear, month, 0)).getUTCDate();
  return `${targetYear}-${String(month).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
};
const clampIsoDate = (value: string, minDate: string, maxDate: string) => value < minDate ? minDate : value > maxDate ? maxDate : value;

type PickerPeriod = { startDate: string; endDate: string };

function CalendarMonth({ month, minDate, maxDate, startDate, endDate, onSelect }: {
  month: string;
  minDate: string;
  maxDate: string;
  startDate: string | null;
  endDate: string | null;
  onSelect: (date: string) => void;
}) {
  const firstDate = `${month}-01`;
  const firstWeekday = new Date(`${firstDate}T00:00:00Z`).getUTCDay();
  const calendarStart = addIsoDays(firstDate, -firstWeekday);
  const title = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${firstDate}T00:00:00Z`));
  const weekNames = ["日", "一", "二", "三", "四", "五", "六"];
  return <div className="period-calendar"><h4>{title}</h4><div className="period-weekdays">{weekNames.map((day) => <span key={day}>{day}</span>)}</div><div className="period-days">{Array.from({ length: 42 }, (_, index) => {
    const date = addIsoDays(calendarStart, index);
    const outside = !date.startsWith(month);
    const disabled = date < minDate || date > maxDate;
    const selected = date === startDate || date === endDate;
    const inRange = Boolean(startDate && endDate && date > startDate && date < endDate);
    return <button type="button" key={date} disabled={disabled} className={`${outside ? "outside" : ""} ${selected ? "selected" : ""} ${inRange ? "in-range" : ""}`} onClick={() => onSelect(date)}>{date.slice(8)}</button>;
  })}</div></div>;
}

function StatisticalPeriodPicker({ minDate, maxDate, startDate, endDate, onApply }: {
  minDate: string;
  maxDate: string;
  startDate: string;
  endDate: string;
  onApply: (startDate: string, endDate: string) => void;
}) {
  const [draftStart, setDraftStart] = useState<string | null>(startDate);
  const [draftEnd, setDraftEnd] = useState<string | null>(endDate);
  const [leftMonth, setLeftMonth] = useState(startDate.slice(0, 7));
  useEffect(() => {
    setDraftStart(startDate); setDraftEnd(endDate); setLeftMonth(startDate.slice(0, 7));
  }, [endDate, startDate]);
  const clampPeriod = (period: PickerPeriod): PickerPeriod => {
    const nextStart = clampIsoDate(period.startDate, minDate, maxDate);
    const nextEnd = clampIsoDate(period.endDate, minDate, maxDate);
    return nextStart <= nextEnd ? { startDate: nextStart, endDate: nextEnd } : { startDate: nextEnd, endDate: nextEnd };
  };
  const year = Number(maxDate.slice(0, 4));
  const month = Number(maxDate.slice(5, 7));
  const quarterStartMonth = Math.floor((month - 1) / 3) * 3 + 1;
  const shortcuts: Array<{ label: string; period: PickerPeriod }> = [
    { label: "去年", period: { startDate: `${year - 1}-01-01`, endDate: `${year - 1}-12-31` } },
    { label: "今年", period: { startDate: `${year}-01-01`, endDate: maxDate } },
    { label: "本季", period: { startDate: `${year}-${String(quarterStartMonth).padStart(2, "0")}-01`, endDate: maxDate } },
    { label: "本月", period: { startDate: startOfIsoMonth(maxDate), endDate: maxDate } },
    { label: "近一年", period: { startDate: addIsoMonths(maxDate, -12), endDate: maxDate } },
    { label: "近6月", period: { startDate: addIsoMonths(maxDate, -6), endDate: maxDate } },
    { label: "近3月", period: { startDate: addIsoMonths(maxDate, -3), endDate: maxDate } },
    { label: "上月", period: { startDate: startOfIsoMonth(addIsoMonths(maxDate, -1)), endDate: endOfIsoMonth(addIsoMonths(maxDate, -1)) } },
    { label: "近1月", period: { startDate: addIsoMonths(maxDate, -1), endDate: maxDate } },
    { label: "近7天", period: { startDate: addIsoDays(maxDate, -6), endDate: maxDate } },
    { label: "前7天", period: { startDate: addIsoDays(maxDate, -13), endDate: addIsoDays(maxDate, -7) } },
    { label: "昨天", period: { startDate: addIsoDays(maxDate, -1), endDate: addIsoDays(maxDate, -1) } },
    { label: "今天", period: { startDate: maxDate, endDate: maxDate } },
  ].map((item) => ({ ...item, period: clampPeriod(item.period) }));
  const chooseDate = (date: string) => {
    if (!draftStart || draftEnd) { setDraftStart(date); setDraftEnd(null); return; }
    if (date < draftStart) { setDraftStart(date); setDraftEnd(draftStart); return; }
    setDraftEnd(date);
  };
  const applyShortcut = (period: PickerPeriod) => { setDraftStart(period.startDate); setDraftEnd(period.endDate); setLeftMonth(period.startDate.slice(0, 7)); };
  const selectedShortcut = shortcuts.find((item) => item.period.startDate === draftStart && item.period.endDate === draftEnd)?.label;
  const rightMonth = addIsoMonths(`${leftMonth}-01`, 1).slice(0, 7);
  const exceedsMaximumDays = Boolean(draftStart && draftEnd && isoDayDifference(draftStart, draftEnd) + 1 > 366);
  return <div className="stat-period-picker" aria-label="自定义统计周期">
    <div className="period-shortcuts">{shortcuts.map((item) => <button type="button" key={item.label} className={selectedShortcut === item.label ? "active" : ""} onClick={() => applyShortcut(item.period)}>{item.label}</button>)}</div>
    <div className="period-calendars"><button type="button" className="period-nav" onClick={() => setLeftMonth(addIsoMonths(`${leftMonth}-01`, -1).slice(0, 7))} aria-label="上一月">‹</button><CalendarMonth month={leftMonth} minDate={minDate} maxDate={maxDate} startDate={draftStart} endDate={draftEnd} onSelect={chooseDate} /><CalendarMonth month={rightMonth} minDate={minDate} maxDate={maxDate} startDate={draftStart} endDate={draftEnd} onSelect={chooseDate} /><button type="button" className="period-nav" onClick={() => setLeftMonth(addIsoMonths(`${leftMonth}-01`, 1).slice(0, 7))} aria-label="下一月">›</button></div>
    <div className="period-picker-footer"><span>{draftStart ? `${draftStart} 00:00:00` : "请选择开始日期"}</span><i className={exceedsMaximumDays ? "period-limit-warning" : ""}>{exceedsMaximumDays ? "最长366天" : "—"}</i><span>{draftEnd ? `${draftEnd} 23:59:59` : "请选择结束日期"}</span><div><button type="button" onClick={() => { setDraftStart(null); setDraftEnd(null); }}>清空</button><button type="button" className="primary-button" disabled={!draftStart || !draftEnd || exceedsMaximumDays} onClick={() => draftStart && draftEnd && onApply(draftStart, draftEnd)}>确定</button></div></div>
  </div>;
}
const formatDateTime = (value?: string | null) => {
  if (!value) return "—";
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
};
const formatChange = (current = 0, previous = 0) => {
  if (previous === 0) return current === 0 ? "0.0%" : "新增";
  return `${(((current - previous) / Math.abs(previous)) * 100).toFixed(1)}%`;
};
const comparisonHint = (current = 0, previous = 0, yearAgo = 0) => (
  <><span>同比 {formatChange(current, yearAgo)}</span><span>环比 {formatChange(current, previous)}</span></>
);
const issueText = (issue: ImportIssue) =>
  issue.sourceRowNumber || issue.row
    ? `第 ${issue.sourceRowNumber ?? issue.row} 行：${issue.message}`
    : issue.message;

function Dot({ tone = "blue" }: { tone?: string }) {
  return <span className={`dot dot-${tone}`} aria-hidden="true" />;
}

function MetricCard({
  label,
  value,
  change,
  hint,
  tone = "blue",
}: {
  label: string;
  value: string;
  change: string;
  hint: React.ReactNode;
  tone?: string;
}) {
  const down = change.startsWith("-");
  return (
    <article className="metric-card">
      <div className="metric-top">
        <span className={`metric-icon metric-icon-${tone}`}><Dot tone={tone} /></span>
        <span className={`change ${down ? "change-down" : ""}`}>{change} {down ? "↘" : "↗"}</span>
      </div>
      <p>{label}</p>
      <strong>{value}</strong>
      <small>{hint}</small>
    </article>
  );
}

function SectionHeader({ title, note, action }: { title: string; note?: string; action?: string }) {
  return (
    <div className="section-header">
      <div>
        <h2>{title}</h2>
        {note && <p>{note}</p>}
      </div>
      {action && <button className="text-button">{action} <span>→</span></button>}
    </div>
  );
}

function DashboardView({ range, customStartDate, customEndDate }: { range: SalesRangeLabel; customStartDate: string; customEndDate: string }) {
  const apiRange = salesRangeMap[range];
  const [sales, setSales] = useState<SalesSummaryResponse | null>(null);
  const [inventory, setInventory] = useState<InventoryOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const requestGenerationRef = useRef(0);
  const requestControllerRef = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    setLoading(true); setError("");
    try {
      const query = new URLSearchParams({ range: apiRange });
      if (apiRange === "custom") { query.set("startDate", customStartDate); query.set("endDate", customEndDate); }
      const inventoryQuery = new URLSearchParams({ startDate: customStartDate, endDate: customEndDate });
      const [salesPayload, inventoryPayload] = await Promise.all([
        requestJson<SalesSummaryResponse>(`/api/sales/summary?${query}`, { signal: controller.signal }),
        requestJson<InventoryOverviewResponse>(`/api/inventory/overview?${inventoryQuery}`, { signal: controller.signal }),
      ]);
      if (!salesPayload?.current || !inventoryPayload?.metrics) throw new Error("经营数据读取失败");
      if (generation !== requestGenerationRef.current) return;
      setSales(salesPayload); setInventory(inventoryPayload);
    } catch (reason) {
      if (controller.signal.aborted || generation !== requestGenerationRef.current) return;
      setError(reason instanceof Error ? reason.message : "暂时无法读取经营看板");
    } finally {
      if (generation === requestGenerationRef.current) setLoading(false);
    }
  }, [apiRange, customEndDate, customStartDate]);
  useEffect(() => {
    void load();
    return () => requestControllerRef.current?.abort();
  }, [load, retryKey]);
  if (loading && !sales) return <section className="panel data-state" role="status"><span className="state-spinner" /><strong>正在同步 BI 经营看板</strong><p>正在汇总销售、网店与库存数据…</p></section>;
  if (!sales || !inventory) return <section className="panel data-state data-state-error" role="alert"><span className="state-symbol">!</span><strong>BI 看板加载失败</strong><p>{error || "暂时无法读取经营数据"}</p><button className="secondary-button" onClick={() => setRetryKey((value) => value + 1)}>重新加载</button></section>;
  const current = sales.current; const previous = sales.previous; const yearAgo = sales.yearAgo;
  const daily = sales.daily ?? []; const maxSales = Math.max(1, ...daily.map((item) => Math.max(0, item.netSalesCents))); const maxProfit = Math.max(1, ...daily.map((item) => Math.max(0, item.grossProfitCents)));
  const outlets = [...(sales.outlets ?? [])].sort((left, right) => right.netSalesCents - left.netSalesCents).slice(0, 5);
  const healthScore = Math.max(0, Math.min(100, 100 - inventory.metrics.urgentCount * 8 - inventory.health.stagnant * 2));
  return <><section className="dashboard-sync-bar"><span><Dot tone="green" />已同步经营数据</span><strong>{sales.startDate} 至 {sales.endDate}</strong><small>销售批次 {sales.latestBatch?.fileName ?? "暂无"} · 库存快照 {inventory.sync.inventoryAsOf ?? "暂无"}</small><button className="row-action" onClick={() => void load()} disabled={loading}>{loading ? "同步中…" : "↻ 刷新"}</button></section><section className="metrics-grid"><MetricCard label="净销售额" value={formatCurrencyFromCents(current.netSalesCents)} change={formatChange(current.netSalesCents, previous?.netSalesCents)} hint={comparisonHint(current.netSalesCents, previous?.netSalesCents, yearAgo?.netSalesCents)} tone="blue" /><MetricCard label="订单毛利" value={formatCurrencyFromCents(current.grossProfitCents)} change={formatChange(current.grossProfitCents, previous?.grossProfitCents)} hint={comparisonHint(current.grossProfitCents, previous?.grossProfitCents, yearAgo?.grossProfitCents)} tone="green" /><MetricCard label="综合大毛利率" value={formatRate(current.grossMarginRate)} change={formatChange(rateAsPercent(current.grossMarginRate), rateAsPercent(previous?.grossMarginRate))} hint={comparisonHint(rateAsPercent(current.grossMarginRate), rateAsPercent(previous?.grossMarginRate), rateAsPercent(yearAgo?.grossMarginRate))} tone="purple" /><MetricCard label="销售退货率" value={formatRate(current.refundRate)} change={formatChange(rateAsPercent(current.refundRate), rateAsPercent(previous?.refundRate))} hint={comparisonHint(rateAsPercent(current.refundRate), rateAsPercent(previous?.refundRate), rateAsPercent(yearAgo?.refundRate))} tone="orange" /></section><section className="dashboard-main-grid"><article className="panel trend-panel"><SectionHeader title="销售与毛利趋势" note="按当前统计周期内的已导入日度明细汇总" /><div className="chart-legend"><span><Dot tone="blue" />净销售额</span><span><Dot tone="green" />订单毛利</span></div><div className="bar-chart">{daily.map((item, index) => <div className="bar-group" key={item.date}><div className="bar-stack"><span className="bar sales-bar" style={{ height: `${Math.max(2, Math.max(0, item.netSalesCents) / maxSales * 100)}%` }} /><span className="bar profit-bar" style={{ height: `${Math.max(2, Math.max(0, item.grossProfitCents) / maxProfit * 100)}%` }} /></div><small>{daily.length <= 7 || index % Math.ceil(daily.length / 7) === 0 ? item.date.slice(5) : ""}</small></div>)}</div><div className="chart-summary"><div><span>日均净销售额</span><strong>{formatCurrencyFromCents(daily.length ? current.netSalesCents / daily.length : 0)}</strong></div><div><span>活跃网店</span><strong>{formatCount((sales.outlets ?? []).length)} 个</strong></div><div><span>库存健康度</span><strong className={healthScore < 70 ? "orange-text" : "green-text"}>{healthScore} 分</strong></div></div></article><article className="panel alert-panel"><SectionHeader title="库存预警中心" note="来自最新库存快照与销售需求联动" /><div className="alert-score"><div className="score-ring"><strong>{healthScore}</strong><small>健康分</small></div><div><strong>{healthScore >= 80 ? "整体经营稳定" : "建议关注库存风险"}</strong><p>库存快照 {inventory.sync.inventoryAsOf ?? "未同步"}</p></div></div><div className="alert-list"><button><span className="alert-icon danger">!</span><span><b>紧急补货</b><small>可售天数低于预警线的货品</small></span><em>{formatCount(inventory.metrics.urgentCount)}</em></button><button><span className="alert-icon warning">↓</span><span><b>建议补货</b><small>销量需求与可用库存计算得出</small></span><em>{formatCount(inventory.metrics.replenishCount)}</em></button><button><span className="alert-icon purple">◷</span><span><b>低动销库存</b><small>当前未匹配销售需求的库存商品</small></span><em>{formatCount(inventory.metrics.noSalesCount)}</em></button></div></article></section><section className="dashboard-bottom-grid"><article className="panel"><SectionHeader title="网店经营排行" note="按销售净额排序" /><div className="rank-list">{outlets.map((outlet, index) => <div className="rank-row" key={outlet.name}><span className={`rank-number rank-${index + 1}`}>{index + 1}</span><div className="shop-avatar">{outlet.platform.slice(0, 1)}</div><div className="rank-name"><strong>{outlet.name}</strong><small>{outlet.platform} · {formatCount(outlet.orderCount)} 单</small></div><div className="mini-progress"><i style={{ width: `${Math.max(4, outlet.shareRate * 100)}%` }} /></div><div className="rank-value"><strong>{formatCurrencyFromCents(outlet.netSalesCents)}</strong><small className={outlet.salesYearOverYearRate !== null && outlet.salesYearOverYearRate < 0 ? "green-text" : "red-text"}>{formatYearOverYear(outlet.salesYearOverYearRate)}</small></div></div>)}{outlets.length === 0 && <div className="table-state">当前周期没有可展示的网店数据。</div>}</div></article><article className="panel todo-panel"><SectionHeader title="数据同步状态" note="所有分析以最近成功导入为准" /><div className="dashboard-data-status"><div><span>销售明细</span><strong>{sales.latestBatch?.fileName ?? "未导入"}</strong><small>{sales.latestBatch?.completedAt ? formatDateTime(sales.latestBatch.completedAt) : "请前往数据导入"}</small></div><div><span>库存快照</span><strong>{inventory.sync.latestInventoryFile ?? "未导入"}</strong><small>{inventory.sync.inventoryAsOf ?? "请前往库存管理同步"}</small></div><div><span>销售需求匹配</span><strong>{formatRate(inventory.metrics.salesDemandMatchRate)}</strong><small>库存商品已匹配销售需求的比例</small></div></div></article></section></>;
}

type StoreGranularity = "day" | "week" | "month";
type StoreComparisonMode = "period" | "year";
type StorePeriodRow = SalesStats & {
  key: string;
  label: string;
  promotionSpendCents?: number;
  promotionNetTransactionCents?: number;
  platformPaymentCents?: number;
  promotionClicks?: number;
  promotionSpendRate?: number | null;
  promotionTransactionShare?: number | null;
};

function storePeriodKey(dateValue: string, granularity: StoreGranularity) {
  if (granularity === "day") return dateValue;
  if (granularity === "month") return dateValue.slice(0, 7);
  const date = new Date(`${dateValue}T00:00:00Z`);
  const weekDay = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + (weekDay === 0 ? -6 : 1 - weekDay));
  return date.toISOString().slice(0, 10);
}

function aggregateStorePeriods(daily: Array<{ date: string } & SalesStats>, granularity: StoreGranularity): StorePeriodRow[] {
  const buckets = new Map<string, StorePeriodRow>();
  for (const item of daily) {
    const key = storePeriodKey(item.date, granularity);
    const label = granularity === "week" ? `${key} 周` : key;
    const row = buckets.get(key) ?? {
      key,
      label,
      grossSalesCents: 0,
      netSalesCents: 0,
      grossProfitCents: 0,
      refundAmountCents: 0,
      orderCount: 0,
      lineCount: 0,
      netQuantity: 0,
      averageOrderValueCents: 0,
      grossMarginRate: 0,
      refundRate: 0,
    };
    row.grossSalesCents += item.grossSalesCents;
    row.netSalesCents += item.netSalesCents;
    row.grossProfitCents += item.grossProfitCents;
    row.refundAmountCents += item.refundAmountCents;
    row.orderCount += item.orderCount;
    row.lineCount += item.lineCount;
    row.netQuantity += item.netQuantity;
    row.averageOrderValueCents = row.orderCount === 0 ? 0 : row.netSalesCents / row.orderCount;
    row.grossMarginRate = row.netSalesCents === 0 ? 0 : row.grossProfitCents / row.netSalesCents;
    row.refundRate = row.grossSalesCents === 0 ? 0 : row.refundAmountCents / row.grossSalesCents;
    buckets.set(key, row);
  }
  return [...buckets.values()].sort((left, right) => left.key.localeCompare(right.key));
}

function mergeStorePromotionPeriods(rows: StorePeriodRow[], daily: NetshopPromotionPerformanceResponse["daily"], granularity: StoreGranularity) {
  const buckets = new Map<string, { spend: number; net: number; payment: number; clicks: number }>();
  for (const item of daily) {
    const key = storePeriodKey(item.date, granularity);
    const current = buckets.get(key) ?? { spend: 0, net: 0, payment: 0, clicks: 0 };
    current.spend += item.spendCents;
    current.net += item.netTransactionAmountCents;
    current.payment += item.platformPaymentAmountCents ?? 0;
    current.clicks += item.clicks;
    buckets.set(key, current);
  }
  return rows.map((row) => {
    const promotion = buckets.get(row.key);
    if (!promotion) return row;
    return {
      ...row,
      promotionSpendCents: promotion.spend,
      promotionNetTransactionCents: promotion.net,
      platformPaymentCents: promotion.payment,
      promotionClicks: promotion.clicks,
      promotionSpendRate: promotion.payment > 0 ? promotion.spend / promotion.payment : null,
      promotionTransactionShare: promotion.payment > 0 ? promotion.net / promotion.payment : null,
    };
  });
}

const storeComparisonRate = (value: number, baseline?: number) => !baseline ? null : (value - baseline) / Math.abs(baseline);
const formatStoreComparison = (value: number, baseline?: number) => {
  const rate = storeComparisonRate(value, baseline);
  return rate === null ? "无可比数据" : `${rate >= 0 ? "+" : ""}${(rate * 100).toFixed(1)}%`;
};

function StoreMetricCard({ label, value, change, note, unavailable = false }: {
  label: string;
  value: string;
  change?: number | null;
  note?: string;
  unavailable?: boolean;
}) {
  return <article className={`store-metric-card ${unavailable ? "unavailable" : ""}`}>
    <div><span>{label}</span>{unavailable && <em>待接入</em>}</div>
    <strong title={value}>{value}</strong>
    <small title={note} className={change === null || change === undefined ? "muted-text" : change < 0 ? "red-text" : "green-text"}>{note ?? (change === null || change === undefined ? "暂无可比数据" : `${change >= 0 ? "+" : ""}${(change * 100).toFixed(1)}%`)}</small>
  </article>;
}

function StoreSpuVisitorMetric({
  startDate,
  endDate,
  outlets,
  selectedOutletKeys,
}: {
  startDate: string;
  endDate: string;
  outlets: Array<Pick<SalesChannel, "groupKey" | "name" | "platform">>;
  selectedOutletKeys: string[];
}) {
  const [performance, setPerformance] = useState<NetshopProductPerformanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const selectedOutlets = useMemo(
    () => selectedOutletKeys.length === 0 ? [] : outlets.filter((item) => selectedOutletKeys.includes(item.groupKey)),
    [outlets, selectedOutletKeys],
  );
  const scopeOutlets = useMemo(
    () => selectedOutlets.map((item) => netshopOutletFilterKey(item.platform, item.name)),
    [selectedOutlets],
  );

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      setLoading(true);
      setError("");
      setPerformance(null);
      try {
        const params = new URLSearchParams({ dimension: "spu", page: "1", pageSize: "1", startDate, endDate });
        scopeOutlets.forEach((outlet) => params.append("outlet", outlet));
        const response = await fetch(`/api/netshop/product-performance?${params.toString()}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json().catch(() => null) as (NetshopProductPerformanceResponse & { error?: string }) | null;
        if (!response.ok || !payload?.summary) throw new Error(payload?.error || `SPU 商品访客读取失败（${response.status}）`);
        if (!controller.signal.aborted) setPerformance(payload);
      } catch (requestError) {
        if (!controller.signal.aborted) setError(requestError instanceof Error ? requestError.message : "暂时无法读取 SPU 商品访客");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [endDate, scopeOutlets, startDate]);

  if (loading) return <StoreMetricCard label="商品访客累计" value="同步中…" note="正在汇总已导入 SPU 商品×日访客" />;
  if (error || !performance?.dataCutoffDate) return <StoreMetricCard label="商品访客累计" value="—" note={error ? "未获取到匹配店铺的 SPU 日数据" : "待导入匹配店铺的 SPU 日数据"} unavailable />;

  const sourceVisitors = performance.summary.visitors;
  const scopeNote = selectedOutletKeys.length === 0
    ? `全部已导入 SPU 店铺 · 截止 ${performance.dataCutoffDate}`
    : `已匹配 ${formatCount(performance.shops.length)} 个店铺 · 截止 ${performance.dataCutoffDate}`;
  return <StoreMetricCard label="商品访客累计" value={formatCount(sourceVisitors)} note={`商品×日累计，非店铺去重 UV · ${scopeNote}`} />;
}

function StoreTableMetric({ value, baseline, formatter, showComparison, showActual }: {
  value: number;
  baseline?: number;
  formatter: (value: number) => string;
  showComparison: boolean;
  showActual: boolean;
}) {
  const rate = storeComparisonRate(value, baseline);
  return <div className="store-table-metric"><strong>{formatter(value)}</strong>{showComparison && <small className={rate === null ? "muted-text" : rate < 0 ? "red-text" : "green-text"}>{showActual && baseline !== undefined ? `对比 ${formatter(baseline)}` : rate === null ? "无可比数据" : `${rate >= 0 ? "+" : ""}${(rate * 100).toFixed(1)}%`}</small>}</div>;
}

function StoreUnavailableCell() {
  return <div className="store-unavailable-cell"><strong>—</strong><small>待接入</small></div>;
}

type StoreTableColumnKey =
  | "visitors"
  | "netSales"
  | "averageOrderValue"
  | "uvValue"
  | "conversionRate"
  | "promotionSpend"
  | "promotionShare"
  | "retailShare"
  | "b2bShare"
  | "promotionClicks"
  | "paidVisitors"
  | "freeVisitors"
  | "orderCount"
  | "grossMarginRate"
  | "refundRate";

const storeTableColumns: Array<{ key: StoreTableColumnKey; label: string; available: boolean }> = [
  { key: "visitors", label: "访客", available: false },
  { key: "netSales", label: "销售净额", available: true },
  { key: "averageOrderValue", label: "客单价", available: true },
  { key: "uvValue", label: "UV 价值", available: false },
  { key: "conversionRate", label: "转化率", available: false },
  { key: "promotionSpend", label: "推广花费", available: true },
  { key: "promotionShare", label: "推广费率", available: true },
  { key: "retailShare", label: "零售占比", available: false },
  { key: "b2bShare", label: "B 端占比", available: false },
  { key: "promotionClicks", label: "推广点击数", available: true },
  { key: "paidVisitors", label: "付费访客", available: false },
  { key: "freeVisitors", label: "免费访客", available: false },
  { key: "orderCount", label: "订单量", available: true },
  { key: "grossMarginRate", label: "大毛利率", available: true },
  { key: "refundRate", label: "退货率", available: true },
];

const connectedStoreTableColumns = storeTableColumns.filter((column) => column.available).map((column) => column.key);

function StoreDataCell({ column, row, compared, showComparison, showActual }: {
  column: StoreTableColumnKey;
  row: StorePeriodRow;
  compared?: StorePeriodRow;
  showComparison: boolean;
  showActual: boolean;
}) {
  if (column === "netSales") return <StoreTableMetric value={row.netSalesCents} baseline={compared?.netSalesCents} formatter={formatCurrencyFromCents} showComparison={showComparison} showActual={showActual} />;
  if (column === "averageOrderValue") return <StoreTableMetric value={row.averageOrderValueCents} baseline={compared?.averageOrderValueCents} formatter={formatCurrencyFromCents} showComparison={showComparison} showActual={showActual} />;
  if (column === "orderCount") return <StoreTableMetric value={row.orderCount} baseline={compared?.orderCount} formatter={formatCount} showComparison={showComparison} showActual={showActual} />;
  if (column === "grossMarginRate") return <StoreTableMetric value={row.grossMarginRate} baseline={compared?.grossMarginRate} formatter={formatRate} showComparison={showComparison} showActual={showActual} />;
  if (column === "refundRate") return <StoreTableMetric value={row.refundRate} baseline={compared?.refundRate} formatter={formatRate} showComparison={showComparison} showActual={showActual} />;
  if (column === "promotionSpend" && row.promotionSpendCents !== undefined) return <StoreTableMetric value={row.promotionSpendCents} formatter={formatCurrencyFromCents} showComparison={false} showActual={false} />;
  if (column === "promotionShare" && row.promotionSpendRate !== undefined && row.promotionSpendRate !== null) return <StoreTableMetric value={row.promotionSpendRate} formatter={formatRate} showComparison={false} showActual={false} />;
  if (column === "promotionClicks" && row.promotionClicks !== undefined) return <StoreTableMetric value={row.promotionClicks} formatter={formatCount} showComparison={false} showActual={false} />;
  return <StoreUnavailableCell />;
}

function StoreTrendChart({ rows, comparisonRows, showComparison, comparisonLabel }: {
  rows: StorePeriodRow[];
  comparisonRows: Array<StorePeriodRow | undefined>;
  showComparison: boolean;
  comparisonLabel: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const highlightedIndex = rows.length === 0 ? null : Math.min(activeIndex ?? rows.length - 1, rows.length - 1);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = canvas?.parentElement;
    if (!canvas || !container) return;
    const draw = () => {
      const width = Math.max(360, Math.floor(container.getBoundingClientRect().width));
      const height = 330;
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      const plot = { left: 56, right: width - 42, top: 28, bottom: height - 44 };
      context.font = "10px sans-serif";
      context.textAlign = "right";
      const maxSales = Math.max(1, ...rows.map((row) => Math.max(0, row.netSalesCents)), ...(showComparison ? comparisonRows.map((row) => Math.max(0, row?.netSalesCents ?? 0)) : []));
      const maxOrders = Math.max(1, ...rows.map((row) => Math.max(0, row.orderCount)));
      for (let index = 0; index <= 4; index += 1) {
        const y = plot.top + (plot.bottom - plot.top) * index / 4;
        context.strokeStyle = "#e8edf4";
        context.lineWidth = 1;
        context.beginPath(); context.moveTo(plot.left, y); context.lineTo(plot.right, y); context.stroke();
        context.fillStyle = "#8b97a8";
        context.fillText(formatCount(Math.round(maxSales / 100 * (1 - index / 4))), plot.left - 8, y + 3);
      }
      if (!rows.length) return;
      const slot = (plot.right - plot.left) / rows.length;
      const barWidth = Math.max(4, Math.min(26, slot * .52));
      rows.forEach((row, index) => {
        const x = plot.left + slot * index + slot / 2;
        const barHeight = Math.max(2, Math.max(0, row.netSalesCents) / maxSales * (plot.bottom - plot.top));
        const gradient = context.createLinearGradient(0, plot.bottom - barHeight, 0, plot.bottom);
        gradient.addColorStop(0, "#6f91e9"); gradient.addColorStop(1, "#4776e6");
        context.fillStyle = gradient;
        context.fillRect(x - barWidth / 2, plot.bottom - barHeight, barWidth, barHeight);
      });
      context.beginPath();
      rows.forEach((row, index) => {
        const x = plot.left + slot * index + slot / 2;
        const y = plot.bottom - Math.max(0, row.orderCount) / maxOrders * (plot.bottom - plot.top);
        if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
      });
      context.strokeStyle = "#65b76e"; context.lineWidth = 2.2; context.lineJoin = "round"; context.stroke();
      rows.forEach((row, index) => {
        const x = plot.left + slot * index + slot / 2;
        const y = plot.bottom - Math.max(0, row.orderCount) / maxOrders * (plot.bottom - plot.top);
        context.fillStyle = "#fff"; context.strokeStyle = "#65b76e"; context.lineWidth = 2;
        context.beginPath(); context.arc(x, y, 3.5, 0, Math.PI * 2); context.fill(); context.stroke();
      });
      if (showComparison && comparisonRows.length) {
        context.save(); context.beginPath(); context.setLineDash([5, 4]);
        let segmentStarted = false;
        comparisonRows.slice(0, rows.length).forEach((row, index) => {
          if (!row) { segmentStarted = false; return; }
          const x = plot.left + slot * index + slot / 2;
          const y = plot.bottom - Math.max(0, row.netSalesCents) / maxSales * (plot.bottom - plot.top);
          if (!segmentStarted) context.moveTo(x, y); else context.lineTo(x, y);
          segmentStarted = true;
        });
        context.strokeStyle = "#aab4c3"; context.lineWidth = 1.5; context.stroke(); context.restore();
      }
      const labelStep = Math.max(1, Math.ceil(rows.length / 8));
      context.fillStyle = "#8793a4"; context.textAlign = "center";
      rows.forEach((row, index) => { if (index % labelStep === 0 || index === rows.length - 1) context.fillText(row.label.slice(5), plot.left + slot * index + slot / 2, height - 17); });
      if (highlightedIndex !== null) {
        const x = plot.left + slot * highlightedIndex + slot / 2;
        context.save(); context.strokeStyle = "#b4bfce"; context.setLineDash([3, 4]); context.beginPath(); context.moveTo(x, plot.top); context.lineTo(x, plot.bottom); context.stroke(); context.restore();
      }
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(container);
    return () => observer.disconnect();
  }, [comparisonRows, highlightedIndex, rows, showComparison]);

  const active = highlightedIndex === null ? null : rows[highlightedIndex];
  const comparison = highlightedIndex === null ? undefined : comparisonRows[highlightedIndex];
  return <section className="panel store-trend-panel">
    <div className="store-section-header"><div><span className="eyebrow">STORE TREND</span><h2>趋势图</h2><p>蓝色柱为销售净额，绿色折线为订单量；灰色虚线为{comparisonLabel}销售净额。</p></div><div className="store-trend-legend"><span><i className="sales" />销售净额</span><span><i className="orders" />订单量</span>{showComparison && <span><i className="compare" />{comparisonLabel}</span>}</div></div>
    <div className="store-trend-canvas"><canvas ref={canvasRef} role="img" aria-label="店铺销售净额与订单量趋势图" onPointerMove={(event) => { if (!rows.length) return; const bounds = event.currentTarget.getBoundingClientRect(); const progress = Math.min(1, Math.max(0, (event.clientX - bounds.left - 56) / Math.max(1, bounds.width - 98))); setActiveIndex(Math.round(progress * (rows.length - 1))); }} onPointerLeave={() => setActiveIndex(null)} />{!rows.length && <div className="trend-empty">当前周期没有可绘制的店铺销售数据。</div>}</div>
    {active && <div className="store-trend-summary"><strong>{active.label}</strong><span>销售净额 <b>{formatCurrencyFromCents(active.netSalesCents)}</b></span><span>订单量 <b>{formatCount(active.orderCount)}</b></span><span>客单价 <b>{formatCurrencyFromCents(active.averageOrderValueCents)}</b></span>{showComparison && <span>{comparisonLabel} <b>{comparison ? formatStoreComparison(active.netSalesCents, comparison.netSalesCents) : "无数据"}</b></span>}</div>}
  </section>;
}

function StoreAnalysisView({ summary, outlets, selectedOutletKeys, onSelectOutlets, loading }: {
  summary: SalesSummaryResponse;
  outlets: Array<Pick<SalesChannel, "groupKey" | "name" | "platform">>;
  selectedOutletKeys: string[];
  onSelectOutlets: (keys: string[]) => void;
  loading: boolean;
}) {
  const [granularity, setGranularity] = useState<StoreGranularity>("day");
  const [comparisonMode, setComparisonMode] = useState<StoreComparisonMode>("period");
  const [showComparison, setShowComparison] = useState(true);
  const [showActual, setShowActual] = useState(false);
  const [columnPickerOpen, setColumnPickerOpen] = useState(false);
  const [columnPickerSearch, setColumnPickerSearch] = useState("");
  const [visibleColumns, setVisibleColumns] = useState<StoreTableColumnKey[]>(() => storeTableColumns.map((column) => column.key));
  const [promotion, setPromotion] = useState<NetshopPromotionPerformanceResponse | null>(null);
  const [promotionLoading, setPromotionLoading] = useState(true);
  const [promotionError, setPromotionError] = useState("");
  const columnPickerRef = useRef<HTMLDivElement>(null);
  const current = summary.current;
  const baseline = comparisonMode === "period" ? summary.previous : summary.yearAgo;
  const comparisonLabel = comparisonMode === "period" ? "环比" : "同比";
  const salesRows = useMemo(() => aggregateStorePeriods(summary.daily ?? [], granularity), [granularity, summary.daily]);
  const rows = useMemo(() => mergeStorePromotionPeriods(salesRows, promotion?.daily ?? [], granularity), [granularity, promotion?.daily, salesRows]);
  const comparisonRows = useMemo(() => {
    const available = aggregateStorePeriods(comparisonMode === "period" ? summary.previousDaily ?? [] : summary.yearAgoDaily ?? [], granularity);
    const byKey = new Map(available.map((row) => [row.key, row]));
    return rows.map((row) => {
      const targetDate = comparisonMode === "period" && summary.previousStartDate
        ? addIsoDays(summary.previousStartDate, isoDayDifference(summary.startDate, row.key))
        : addIsoYears(row.key.length === 7 ? `${row.key}-01` : row.key, -1);
      return byKey.get(storePeriodKey(targetDate, granularity));
    });
  }, [comparisonMode, granularity, rows, summary.previousDaily, summary.previousStartDate, summary.startDate, summary.yearAgoDaily]);
  const currentAov = current.orderCount === 0 ? 0 : current.netSalesCents / current.orderCount;
  const baselineAov = !baseline?.orderCount ? 0 : baseline.netSalesCents / baseline.orderCount;
  const salesChange = storeComparisonRate(current.netSalesCents, baseline?.netSalesCents);
  const aovChange = storeComparisonRate(currentAov, baselineAov);
  const selectedOutlets = useMemo(() => outlets.filter((item) => selectedOutletKeys.includes(item.groupKey)), [outlets, selectedOutletKeys]);
  const promotionOutlets = useMemo(
    () => selectedOutlets.map((item) => netshopOutletFilterKey(item.platform, item.name)),
    [selectedOutlets],
  );
  const selectedOutletLabel = selectedOutlets.length === 0
    ? "全部平台与店铺"
    : selectedOutlets.length === 1
      ? `${selectedOutlets[0].platform} · ${selectedOutlets[0].name}`
      : `已选 ${formatCount(selectedOutlets.length)} 个店铺`;
  const daily = summary.daily ?? [];
  const dataCutoff = summary.dataCutoffDate ?? (daily.length > 0 ? daily[daily.length - 1].date : "暂无");
  const comparisonPeriodNote = summary.periodAdjustedToDataCutoff
    ? `请求周期 ${summary.requestedStartDate ?? summary.startDate} 至 ${summary.requestedEndDate ?? summary.endDate}，销售数据截止 ${dataCutoff}；已自动对齐为 ${summary.startDate} 至 ${summary.endDate}（${summary.comparisonDayCount ?? daily.length} 天），未把未同步尾日计入环比或同比。`
    : `销售数据截止 ${dataCutoff}；当前按 ${summary.startDate} 至 ${summary.endDate}（${summary.comparisonDayCount ?? daily.length} 天）汇总，环比和同比使用等长日期。`;
  const matchedStoreColumns = useMemo(() => {
    const keyword = columnPickerSearch.trim().toLocaleLowerCase("zh-CN");
    if (!keyword) return storeTableColumns;
    return storeTableColumns.filter((column) => column.label.toLocaleLowerCase("zh-CN").includes(keyword));
  }, [columnPickerSearch]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      setPromotionLoading(true);
      setPromotionError("");
      try {
        const params = new URLSearchParams({ startDate: summary.startDate, endDate: summary.endDate, page: "1", pageSize: "1" });
        promotionOutlets.forEach((outlet) => params.append("outlet", outlet));
        const response = await fetch(`/api/netshop/promotion-performance?${params.toString()}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json().catch(() => null) as (NetshopPromotionPerformanceResponse & { error?: string }) | null;
        if (!response.ok || !payload?.summary) throw new Error(payload?.error || `推广数据读取失败（${response.status}）`);
        if (!controller.signal.aborted) setPromotion(payload);
      } catch (requestError) {
        if (!controller.signal.aborted) { setPromotion(null); setPromotionError(requestError instanceof Error ? requestError.message : "推广数据读取失败"); }
      } finally {
        if (!controller.signal.aborted) setPromotionLoading(false);
      }
    })();
    return () => controller.abort();
  }, [promotionOutlets, summary.endDate, summary.startDate]);

  useEffect(() => {
    if (!columnPickerOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!columnPickerRef.current?.contains(event.target as Node)) setColumnPickerOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setColumnPickerOpen(false);
    };
    window.addEventListener("pointerdown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [columnPickerOpen]);

  const toggleStoreColumn = (column: StoreTableColumnKey) => setVisibleColumns((currentColumns) => {
    if (currentColumns.includes(column)) return currentColumns.length === 1 ? currentColumns : currentColumns.filter((item) => item !== column);
    return storeTableColumns.map((item) => item.key).filter((key) => currentColumns.includes(key) || key === column);
  });

  return <>
    <section className="panel store-filter-panel" aria-label="店铺分析筛选条件">
      <label className="store-select-field"><span>店铺</span><SearchableMultiSelect values={selectedOutletKeys} onChange={onSelectOutlets} ariaLabel="选择分析店铺" allLabel="全部店铺" searchPlaceholder="搜索店铺或平台" options={outlets.map((outlet) => ({ value: outlet.groupKey, label: `${outlet.name} · ${outlet.platform}`, searchText: `${outlet.name} ${outlet.platform}` }))} /></label>
      <div className="store-period-context"><span>统计周期</span><strong>{summary.startDate} → {summary.endDate}</strong><small>{selectedOutletLabel} · 数据截止 {dataCutoff}</small></div>
      <div className="segmented store-granularity" role="group" aria-label="店铺分析时间粒度"><button type="button" className={granularity === "day" ? "active" : ""} onClick={() => setGranularity("day")}>按日</button><button type="button" className={granularity === "week" ? "active" : ""} onClick={() => setGranularity("week")}>按周</button><button type="button" className={granularity === "month" ? "active" : ""} onClick={() => setGranularity("month")}>按月</button></div>
      <label className="store-check"><input type="checkbox" checked={showComparison} onChange={(event) => setShowComparison(event.target.checked)} /><span>显示对比数据</span></label>
      <div className="segmented store-compare-mode" role="group" aria-label="店铺分析对比口径"><button type="button" className={comparisonMode === "period" ? "active" : ""} disabled={!showComparison} onClick={() => setComparisonMode("period")}>环比</button><button type="button" className={comparisonMode === "year" ? "active" : ""} disabled={!showComparison} onClick={() => setComparisonMode("year")}>同比</button></div>
      <label className="store-check"><input type="checkbox" checked={showActual} disabled={!showComparison} onChange={(event) => setShowActual(event.target.checked)} /><span>显示对比值</span></label>
      <button type="button" className="row-action store-refresh" disabled={loading} onClick={() => onSelectOutlets(selectedOutletKeys)}>{loading ? "刷新中…" : "↻ 刷新"}</button>
    </section>

    <section className="store-source-status" role="note">
      <div><span className="source-status-ready">✓ 已接入</span><strong>销售净额、订单量、客单价、毛利率、退货率、商品级访客累计、推广</strong></div>
      <div><span className="source-status-missing">○ 待接入</span><strong>店铺去重 UV、付费/免费访客、企业购/零售拆分</strong></div>
      <p>{comparisonPeriodNote} 商品访客仅按商品×日累计；推广比例只使用同日数据。</p>
    </section>

    <section className="store-metrics-grid">
      <StoreSpuVisitorMetric startDate={summary.startDate} endDate={summary.endDate} outlets={outlets} selectedOutletKeys={selectedOutletKeys} />
      <StoreMetricCard label="销售额（净额）" value={formatExactCurrencyFromCents(current.netSalesCents)} change={salesChange} note={showComparison ? `${comparisonLabel} ${formatStoreComparison(current.netSalesCents, baseline?.netSalesCents)} · 对比值 ${baseline ? formatExactCurrencyFromCents(baseline.netSalesCents) : "—"}` : "来自已导入销售明细"} />
      <StoreMetricCard label="客单价" value={formatCurrencyFromCents(currentAov)} change={aovChange} note={showComparison ? `${comparisonLabel} ${formatStoreComparison(currentAov, baselineAov)}` : `${formatCount(current.orderCount)} 笔订单`} />
      <StoreMetricCard label="UV 价值" value="—" note="缺少访客数据，不做推算" unavailable />
      <StoreMetricCard label="转化率" value="—" note="需访客与成交人数" unavailable />
      <StoreMetricCard label="推广花费" value={promotionLoading ? "同步中…" : promotion?.dataCutoffDate ? formatCurrencyFromCents(promotion.summary.spendCents) : "—"} note={promotion?.dataCutoffDate ? `推广成交 ${formatCurrencyFromCents(promotion.summary.netTransactionAmountCents)}` : promotionError || "当前店铺/周期暂无推广报表"} unavailable={!promotionLoading && !promotion?.dataCutoffDate} />
      <StoreMetricCard label="推广费率" value={promotion?.summary.spendRate === null || promotion?.summary.spendRate === undefined ? "—" : formatRate(promotion.summary.spendRate)} note={promotion?.summary.promotionTransactionShare === null || promotion?.summary.promotionTransactionShare === undefined ? "缺少同日平台商品成交金额" : `推广成交占比 ${formatRate(promotion.summary.promotionTransactionShare)}`} unavailable={!promotionLoading && promotion?.summary.spendRate === null} />
      <StoreMetricCard label="零售占比" value="—" note="待接入订单类型标记" unavailable />
      <StoreMetricCard label="B 端占比" value="—" note="待接入企业购明细" unavailable />
      <StoreMetricCard label="推广点击数" value={promotionLoading ? "同步中…" : promotion?.dataCutoffDate ? formatCount(promotion.summary.clicks) : "—"} note={promotion?.dataCutoffDate ? `展现 ${formatCount(promotion.summary.impressions)} · CTR ${formatOptionalRate(promotion.summary.clickThroughRate)}` : "当前店铺/周期暂无推广点击"} unavailable={!promotionLoading && !promotion?.dataCutoffDate} />
      <StoreMetricCard label="付费访客" value="不推算" note="避免用点击数替代访客" unavailable />
      <StoreMetricCard label="免费访客" value="不推算" note="需平台自然流量数据" unavailable />
    </section>

    <section className="store-reliable-strip">
      <div><span>订单量</span><strong>{formatCount(current.orderCount)}</strong><small>{showComparison ? `${comparisonLabel} ${formatStoreComparison(current.orderCount, baseline?.orderCount)}` : "笔"}</small></div>
      <div><span>净销量</span><strong>{formatCount(current.netQuantity)}</strong><small>{showComparison ? `${comparisonLabel} ${formatStoreComparison(current.netQuantity, baseline?.netQuantity)}` : "件"}</small></div>
      <div><span>订单毛利</span><strong>{formatCurrencyFromCents(current.grossProfitCents)}</strong><small>{showComparison ? `${comparisonLabel} ${formatStoreComparison(current.grossProfitCents, baseline?.grossProfitCents)}` : "已导入成本口径"}</small></div>
      <div><span>大毛利率</span><strong>{formatRate(current.grossMarginRate)}</strong><small>{showComparison ? `${comparisonLabel} ${formatStoreComparison(current.grossMarginRate, baseline?.grossMarginRate)}` : "毛利 / 净销售额"}</small></div>
      <div><span>退货率</span><strong>{formatRate(current.refundRate)}</strong><small>{showComparison ? `${comparisonLabel} ${formatStoreComparison(current.refundRate, baseline?.refundRate)}` : "退货额 / 正向销售额"}</small></div>
    </section>

    <StoreTrendChart rows={rows} comparisonRows={comparisonRows} showComparison={showComparison} comparisonLabel={comparisonLabel} />

    <section className="panel table-panel store-detail-panel">
      <div className="table-toolbar"><div><h2>数据明细</h2><p>按{granularity === "day" ? "日" : granularity === "week" ? "自然周" : "自然月"}汇总；金额均为人民币元，退货以负值参与净额。</p></div><div className="store-table-toolbar-actions"><span className="soft-tag">{formatCount(rows.length)} 个周期</span><div className={`store-column-picker ${columnPickerOpen ? "open" : ""}`} ref={columnPickerRef}><button type="button" className="store-column-picker-trigger" aria-haspopup="dialog" aria-expanded={columnPickerOpen} onClick={() => { setColumnPickerOpen((open) => !open); setColumnPickerSearch(""); }}><span>☷</span>指标选择 <em>{visibleColumns.length}/{storeTableColumns.length}</em></button>{columnPickerOpen && <div className="store-column-picker-menu" role="dialog" aria-label="选择数据明细指标"><div className="store-column-picker-head"><div><strong>显示指标</strong><small>周期列固定显示，至少保留 1 个指标</small></div><button type="button" onClick={() => setColumnPickerOpen(false)} aria-label="关闭指标选择">×</button></div><div className="store-column-picker-actions"><button type="button" onClick={() => setVisibleColumns(storeTableColumns.map((column) => column.key))}>全选</button><button type="button" onClick={() => setVisibleColumns(connectedStoreTableColumns)}>仅看已接入</button></div><label className="store-column-picker-search">⌕<input autoFocus type="search" value={columnPickerSearch} onChange={(event) => setColumnPickerSearch(event.target.value)} placeholder="搜索指标" aria-label="搜索数据明细指标" /></label><div className="store-column-picker-options">{matchedStoreColumns.map((column) => { const checked = visibleColumns.includes(column.key); return <label key={column.key} className={checked ? "selected" : ""}><input type="checkbox" checked={checked} disabled={checked && visibleColumns.length === 1} onChange={() => toggleStoreColumn(column.key)} /><span>{column.label}</span><em className={column.available ? "available" : "pending"}>{column.available ? "已接入" : "待接入"}</em></label>; })}{matchedStoreColumns.length === 0 && <p className="store-column-picker-empty">没有匹配的指标</p>}</div></div>}</div></div></div>
      <div className="data-table-wrap store-detail-scroll-area"><table className="data-table store-detail-table" style={{ minWidth: `${Math.max(760, 180 + visibleColumns.length * 112)}px` }}><thead><tr><th>周期</th>{storeTableColumns.filter((column) => visibleColumns.includes(column.key)).map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>{rows.map((row, index) => { const compared = comparisonRows[index]; return <tr key={row.key}><td><strong>{row.label}</strong></td>{storeTableColumns.filter((column) => visibleColumns.includes(column.key)).map((column) => <td key={column.key}><StoreDataCell column={column.key} row={row} compared={compared} showComparison={showComparison} showActual={showActual} /></td>)}</tr>; })}{rows.length === 0 && <tr><td colSpan={visibleColumns.length + 1}><div className="table-state">当前周期没有可展示的店铺明细。</div></td></tr>}</tbody></table></div>
    </section>
  </>;
}

type ProductPerformanceColumnKey =
  | "pageViews"
  | "visitors"
  | "transactionCustomers"
  | "transactionQuantity"
  | "addCartCustomers"
  | "addCartQuantity"
  | "transactionAmount"
  | "uvValue"
  | "conversionRate"
  | "searchImpressions"
  | "searchClicks"
  | "searchClickRate"
  | "favorites"
  | "refundAmount"
  | "searchVisitors"
  | "searchTransactionCustomers"
  | "promotionSpend"
  | "promotionShare"
  | "promotionTransactionAmount"
  | "promotionRoi"
  | "promotionTransactionShare"
  | "enterpriseAmount"
  | "enterpriseOrderCount"
  | "enterpriseCustomerCount"
  | "enterpriseQuantity"
  | "enterpriseAverageItemValue"
  | "enterpriseSalesShare";

type ProductPerformanceColumn = {
  key: ProductPerformanceColumnKey;
  label: string;
  available: boolean;
};

const productPerformanceColumns: ProductPerformanceColumn[] = [
  { key: "pageViews", label: "商品浏览量", available: true },
  { key: "visitors", label: "商品访客累计", available: true },
  { key: "transactionCustomers", label: "成交客户累计", available: true },
  { key: "transactionQuantity", label: "成交商品件数", available: true },
  { key: "addCartCustomers", label: "加购人数", available: true },
  { key: "addCartQuantity", label: "加购商品件数", available: true },
  { key: "transactionAmount", label: "成交金额", available: true },
  { key: "uvValue", label: "UV价值", available: true },
  { key: "conversionRate", label: "总转化率", available: true },
  { key: "searchImpressions", label: "搜索曝光次数", available: true },
  { key: "searchClicks", label: "搜索点击次数", available: true },
  { key: "searchClickRate", label: "搜索点击率", available: true },
  { key: "favorites", label: "收藏人数", available: true },
  { key: "refundAmount", label: "成功退款金额", available: true },
  { key: "searchVisitors", label: "搜索引导访客", available: true },
  { key: "searchTransactionCustomers", label: "搜索引导支付买家", available: true },
  { key: "promotionSpend", label: "推广花费", available: false },
  { key: "promotionShare", label: "推广占比", available: false },
  { key: "promotionTransactionAmount", label: "推广成交金额", available: false },
  { key: "promotionRoi", label: "推广ROI", available: false },
  { key: "promotionTransactionShare", label: "推广成交占比", available: false },
  { key: "enterpriseAmount", label: "企业购出库金额", available: false },
  { key: "enterpriseOrderCount", label: "企业购出库单量", available: false },
  { key: "enterpriseCustomerCount", label: "企业购出库用户数", available: false },
  { key: "enterpriseQuantity", label: "企业购出库件数", available: false },
  { key: "enterpriseAverageItemValue", label: "企业购件单价", available: false },
  { key: "enterpriseSalesShare", label: "企业购销售占比", available: false },
];

const connectedProductPerformanceColumns = productPerformanceColumns
  .filter((column) => column.available)
  .map((column) => column.key);

function ProductPerformanceMetricCell({
  value,
  baseline,
  formatter,
  showComparison,
  showActual,
  comparisonLabel,
}: {
  value?: number | null;
  baseline?: number | null;
  formatter: (value: number) => string;
  showComparison: boolean;
  showActual: boolean;
  comparisonLabel: string;
}) {
  const change = productComparisonRate(value, baseline);
  const hasBaseline = baseline !== null && baseline !== undefined;
  return <div className="product-performance-cell">
    <strong>{value === null || value === undefined ? "—" : formatter(value)}</strong>
    {showComparison && <>
      {showActual && hasBaseline && <small>{formatter(baseline)}</small>}
      <em className={change === null ? "muted-text" : change < 0 ? "red-text" : "green-text"}>{comparisonLabel} {formatProductComparison(value, baseline)}</em>
    </>}
  </div>;
}

function ProductPerformancePendingCell() {
  return <div className="product-performance-pending"><strong>—</strong><small>待接入报表</small></div>;
}

function ProductPerformanceDataCell({
  column,
  item,
  compared,
  showComparison,
  showActual,
  comparisonLabel,
}: {
  column: ProductPerformanceColumn;
  item: NetshopProductPerformanceItem;
  compared?: NetshopProductPerformanceItem;
  showComparison: boolean;
  showActual: boolean;
  comparisonLabel: string;
}) {
  if (!column.available) return <ProductPerformancePendingCell />;
  const props = { showComparison, showActual, comparisonLabel };
  if (column.key === "pageViews") return <ProductPerformanceMetricCell value={item.pageViews} baseline={compared?.pageViews} formatter={formatCount} {...props} />;
  if (column.key === "visitors") return <ProductPerformanceMetricCell value={item.visitors} baseline={compared?.visitors} formatter={formatCount} {...props} />;
  if (column.key === "transactionCustomers") return <ProductPerformanceMetricCell value={item.transactionCustomers} baseline={compared?.transactionCustomers} formatter={formatCount} {...props} />;
  if (column.key === "transactionQuantity") return <ProductPerformanceMetricCell value={item.transactionQuantity} baseline={compared?.transactionQuantity} formatter={formatCount} {...props} />;
  if (column.key === "addCartCustomers") return <ProductPerformanceMetricCell value={item.addCartCustomers} baseline={compared?.addCartCustomers} formatter={formatCount} {...props} />;
  if (column.key === "addCartQuantity") return <ProductPerformanceMetricCell value={item.addCartQuantity} baseline={compared?.addCartQuantity} formatter={formatCount} {...props} />;
  if (column.key === "transactionAmount") return <ProductPerformanceMetricCell value={item.transactionAmount} baseline={compared?.transactionAmount} formatter={formatMerchantCurrency} {...props} />;
  if (column.key === "uvValue") return <ProductPerformanceMetricCell value={item.uvValue} baseline={compared?.uvValue} formatter={formatMerchantCurrency} {...props} />;
  if (column.key === "conversionRate") return <ProductPerformanceMetricCell value={item.conversionRate} baseline={compared?.conversionRate} formatter={formatRate} {...props} />;
  if (column.key === "searchImpressions") return <ProductPerformanceMetricCell value={item.searchImpressions} baseline={compared?.searchImpressions} formatter={formatCount} {...props} />;
  if (column.key === "searchClicks") return <ProductPerformanceMetricCell value={item.searchClicks} baseline={compared?.searchClicks} formatter={formatCount} {...props} />;
  if (column.key === "searchClickRate") return <ProductPerformanceMetricCell value={item.searchClickRate} baseline={compared?.searchClickRate} formatter={formatRate} {...props} />;
  if (column.key === "favorites") return <ProductPerformanceMetricCell value={item.favorites} baseline={compared?.favorites} formatter={formatCount} {...props} />;
  if (column.key === "refundAmount") return <ProductPerformanceMetricCell value={item.refundAmountCents} baseline={compared?.refundAmountCents} formatter={formatCurrencyFromCents} {...props} />;
  if (column.key === "searchVisitors") return <ProductPerformanceMetricCell value={item.searchVisitors} baseline={compared?.searchVisitors} formatter={formatCount} {...props} />;
  if (column.key === "searchTransactionCustomers") return <ProductPerformanceMetricCell value={item.searchTransactionCustomers} baseline={compared?.searchTransactionCustomers} formatter={formatCount} {...props} />;
  return <ProductPerformancePendingCell />;
}

function netshopPerformanceItemKey(item: NetshopProductPerformanceItem) {
  return `${item.platform}\u001f${item.shopNames.join("\u001e")}\u001f${item.id}`;
}

function netshopProductUrl(platform: string, productId: string, explicitUrl = "") {
  const provided = explicitUrl.trim();
  if (/^https?:\/\//i.test(provided)) return provided;
  if (provided && !/^[a-z][a-z\d+.-]*:/i.test(provided)) return `https://${provided.replace(/^\/+/, "")}`;
  const normalizedId = productId.trim();
  if (!/^\d{5,}$/.test(normalizedId)) return "";
  return platform === "天猫"
    ? `https://detail.tmall.com/item.htm?id=${encodeURIComponent(normalizedId)}`
    : `https://item.jd.com/${encodeURIComponent(normalizedId)}.html`;
}

function ShopDailyProductPerformanceView({
  dimension,
  onOpenImport,
  range,
  customStartDate,
  customEndDate,
}: {
  dimension: NetshopProductPerformanceDimension;
  onOpenImport: (dimension: NetshopProductPerformanceDimension) => void;
  range: SalesRangeLabel;
  customStartDate: string;
  customEndDate: string;
}) {
  const [performance, setPerformance] = useState<{
    current: NetshopProductPerformanceResponse;
    comparison: NetshopProductPerformanceResponse | null;
  } | null>(null);
  const [query, setQuery] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [selectedOutletKeys, setSelectedOutletKeys] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [showComparison, setShowComparison] = useState(true);
  const [showActual, setShowActual] = useState(true);
  const [comparisonMode, setComparisonMode] = useState<ProductComparisonMode>("period");
  const [columnPickerOpen, setColumnPickerOpen] = useState(false);
  const [columnPickerSearch, setColumnPickerSearch] = useState("");
  const [visibleColumns, setVisibleColumns] = useState<ProductPerformanceColumnKey[]>(connectedProductPerformanceColumns);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const columnPickerRef = useRef<HTMLDivElement>(null);
  const productPerformanceGenerationRef = useRef(0);
  const productPerformanceControllerRef = useRef<AbortController | null>(null);
  const debouncedQuery = useDebouncedValue(query, 280);
  const basePeriod = useMemo(
    () => skuSalesPeriod(range, customStartDate, customEndDate),
    [customEndDate, customStartDate, range],
  );
  const selectedPeriod = basePeriod;
  const comparisonPeriod = useMemo(
    () => showComparison ? productComparisonPeriod(selectedPeriod, comparisonMode) : null,
    [comparisonMode, selectedPeriod, showComparison],
  );
  const dimensionLabel = dimension === "sku" ? "SKU" : "SPU";
  const importLabel = dimension === "sku" ? "京东商品 SKU 日数据" : "网店商品 SPU 日数据";
  const comparisonLabel = comparisonMode === "period" ? "环比" : "同比";
  const comparisonItemById = useMemo(
    () => new Map((performance?.comparison?.items ?? []).map((item) => [netshopPerformanceItemKey(item), item])),
    [performance],
  );
  const matchedProductColumns = useMemo(() => {
    const keyword = columnPickerSearch.trim().toLocaleLowerCase("zh-CN");
    if (!keyword) return productPerformanceColumns;
    return productPerformanceColumns.filter((column) => column.label.toLocaleLowerCase("zh-CN").includes(keyword));
  }, [columnPickerSearch]);
  const visibleProductColumns = useMemo(
    () => productPerformanceColumns.filter((column) => visibleColumns.includes(column.key)),
    [visibleColumns],
  );

  useEffect(() => {
    setPage(1);
  }, [customEndDate, customStartDate, range]);

  useEffect(() => {
    if (!columnPickerOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!columnPickerRef.current?.contains(event.target as Node)) setColumnPickerOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setColumnPickerOpen(false);
    };
    window.addEventListener("pointerdown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [columnPickerOpen]);

  const toggleProductColumn = (column: ProductPerformanceColumnKey) => setVisibleColumns((currentColumns) => {
    if (currentColumns.includes(column)) return currentColumns.length === 1 ? currentColumns : currentColumns.filter((item) => item !== column);
    return productPerformanceColumns.map((item) => item.key).filter((key) => currentColumns.includes(key) || key === column);
  });

  const load = useCallback(async () => {
    const generation = productPerformanceGenerationRef.current + 1;
    productPerformanceGenerationRef.current = generation;
    productPerformanceControllerRef.current?.abort();
    const controller = new AbortController();
    productPerformanceControllerRef.current = controller;
    const requestPerformance = async (requestedPeriod: { startDate: string; endDate: string }) => {
      const params = new URLSearchParams({
        dimension,
        page: String(page),
        pageSize: "50",
        startDate: requestedPeriod.startDate,
        endDate: requestedPeriod.endDate,
      });
      if (debouncedQuery) params.set("q", debouncedQuery);
      selectedPlatforms.forEach((platform) => params.append("platform", platform));
      selectedOutletKeys.forEach((outlet) => params.append("outlet", outlet));
      const response = await fetch(`/api/netshop/product-performance?${params.toString()}`, { cache: "no-store", signal: controller.signal });
      const payload = await response.json().catch(() => null) as (NetshopProductPerformanceResponse & { error?: string }) | null;
      if (!response.ok || !payload?.summary || !Array.isArray(payload.items)) {
        throw new Error(payload?.error || `${dimensionLabel} 商品表现读取失败（${response.status}）`);
      }
      return payload;
    };

    setLoading(true);
    setError("");
    try {
      const [current, comparison] = await Promise.all([
        requestPerformance(selectedPeriod),
        comparisonPeriod ? requestPerformance(comparisonPeriod) : Promise.resolve(null),
      ]);
      if (!controller.signal.aborted && generation === productPerformanceGenerationRef.current) setPerformance({ current, comparison });
    } catch (requestError) {
      if (!controller.signal.aborted && generation === productPerformanceGenerationRef.current) setError(requestError instanceof Error ? requestError.message : `暂时无法读取 ${dimensionLabel} 商品表现`);
    } finally {
      if (!controller.signal.aborted && generation === productPerformanceGenerationRef.current) {
        setLoading(false);
        if (productPerformanceControllerRef.current === controller) productPerformanceControllerRef.current = null;
      }
    }
  }, [comparisonPeriod, debouncedQuery, dimension, dimensionLabel, page, selectedOutletKeys, selectedPeriod, selectedPlatforms]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => {
      window.clearTimeout(timer);
      productPerformanceGenerationRef.current += 1;
      productPerformanceControllerRef.current?.abort();
    };
  }, [load, retryKey]);

  if (loading && !performance) {
    return <section className="panel data-state" role="status"><span className="state-spinner" /><strong>正在读取网店 {dimensionLabel} 日数据</strong><p>正在按当前统计周期汇总商品、店铺与经营指标…</p></section>;
  }
  if (error && !performance) {
    return <section className="panel data-state data-state-error" role="alert"><span className="state-symbol">!</span><strong>{dimensionLabel} 商品表现加载失败</strong><p>{error}</p><button className="secondary-button" onClick={() => setRetryKey((value) => value + 1)}>重新加载</button></section>;
  }
  if (!performance) return null;

  const current = performance.current;
  const comparisonSummary = performance.comparison?.summary;
  const currentAverageTransactionValue = current.summary.transactionCustomers > 0
    ? current.summary.transactionAmount / current.summary.transactionCustomers
    : null;
  const comparisonAverageTransactionValue = comparisonSummary && comparisonSummary.transactionCustomers > 0
    ? comparisonSummary.transactionAmount / comparisonSummary.transactionCustomers
    : null;
  const productKpiNote = (source: string, value?: number | null, baseline?: number | null) => showComparison
    ? `${comparisonLabel} ${formatProductComparison(value, baseline)}`
    : source;
  const { pagination } = current;
  const totalPages = Math.max(1, Math.ceil(pagination.total / pagination.pageSize));
  const periodLabel = current.dateMin && current.dataCutoffDate
    ? `${current.dateMin} 至 ${current.dataCutoffDate}`
    : "暂无覆盖日期";
  const platformOptions = current.platforms.map((platform) => ({ value: platform, label: platform }));
  const availableShopOptions = current.shops
    .filter((shop) => selectedPlatforms.length === 0 || selectedPlatforms.includes(shop.platform))
    .map((shop) => ({
      value: netshopOutletFilterKey(shop.platform, shop.shopName),
      label: `${shop.shopName} · ${shop.platform}`,
      searchText: `${shop.shopName} ${shop.platform}`,
    }));
  const tableColSpan = visibleProductColumns.length + 6;
  const availableCoverageLabel = current.coverage.availableDateMin && current.coverage.availableDateMax
    ? current.coverage.availableDateMin === current.coverage.availableDateMax
      ? current.coverage.availableDateMin
      : `${current.coverage.availableDateMin} 至 ${current.coverage.availableDateMax}`
    : "尚无已导入覆盖日期";
  const filterPanel = <section className="panel product-performance-filter-panel" aria-label="商品数据筛选条件">
    <label className="product-performance-select-field"><span>平台</span><SearchableMultiSelect values={selectedPlatforms} onChange={(values) => {
      const allowedOutlets = new Set(current.shops
        .filter((shop) => values.length === 0 || values.includes(shop.platform))
        .map((shop) => netshopOutletFilterKey(shop.platform, shop.shopName)));
      setSelectedPlatforms(values);
      setSelectedOutletKeys((outlets) => outlets.filter((outlet) => allowedOutlets.has(outlet)));
      setPage(1);
    }} ariaLabel={`选择${dimensionLabel}分析平台`} allLabel="全部平台" searchPlaceholder="搜索平台" options={platformOptions} /></label>
    <label className="product-performance-select-field"><span>店铺</span><SearchableMultiSelect values={selectedOutletKeys} onChange={(values) => { setSelectedOutletKeys(values); setPage(1); }} ariaLabel={`选择${dimensionLabel}分析店铺`} allLabel="全部店铺" searchPlaceholder="搜索店铺或平台" options={availableShopOptions} /></label>
    <div className="product-period-control global-period-context"><span>全局统计周期</span><strong>{selectedPeriod.startDate} 至 {selectedPeriod.endDate}</strong></div>
    <label className="product-performance-check"><input type="checkbox" checked={showComparison} onChange={(event) => setShowComparison(event.target.checked)} /><span>显示对比数据</span></label>
    <label className="product-performance-check"><input type="checkbox" checked={showActual} disabled={!showComparison} onChange={(event) => setShowActual(event.target.checked)} /><span>显示对比值</span></label>
    <div className="product-compare-control"><span>对比时间</span><div className="segmented" role="group" aria-label="商品数据对比口径"><button type="button" className={comparisonMode === "period" ? "active" : ""} disabled={!showComparison} onClick={() => setComparisonMode("period")}>环比</button><button type="button" className={comparisonMode === "year" ? "active" : ""} disabled={!showComparison} onClick={() => setComparisonMode("year")}>同比</button></div></div>
  </section>;

  if (!current.dataCutoffDate) {
    return <>
      {filterPanel}
      <section className="panel data-state"><span className="state-symbol">网</span><strong>当前筛选周期暂无{dimensionLabel}商品日数据</strong><p>当前筛选周期 {selectedPeriod.startDate} 至 {selectedPeriod.endDate}；系统数据覆盖 {availableCoverageLabel}。请调整平台或日期，未导入时可前往数据导入。</p><button className="primary-button" onClick={() => onOpenImport(dimension)}>前往导入并同步{importLabel}</button></section>
    </>;
  }

  return <>
    {filterPanel}

    <section className="panel netshop-performance-hero">
      <div><span className="eyebrow">NETSHOP PRODUCT INTELLIGENCE</span><h2>{dimensionLabel} 商品表现</h2><p>汇总已导入的京东商智与天猫生意参谋商品日数据；接口金额统一以分返回，页面按元展示，不以销售订单明细替代。</p></div>
      <div className="netshop-performance-actions"><span><Dot tone="green" />数据截止 {current.dataCutoffDate}</span><button type="button" className="secondary-button" onClick={() => void load()} disabled={loading}>{loading ? "刷新中…" : "↻ 刷新"}</button><button type="button" className="primary-button" onClick={() => onOpenImport(dimension)}>＋ 导入并同步{dimensionLabel}日数据</button></div>
    </section>
    <section className="netshop-performance-source"><span><Dot tone="blue" />已关联 {current.dataset === "sku_daily" ? "商智 SKU" : "商智 SPU"} 日数据</span><strong>{periodLabel}</strong><small>当前筛选周期 {selectedPeriod.startDate} 至 {selectedPeriod.endDate}{comparisonPeriod ? ` · ${comparisonLabel} ${comparisonPeriod.startDate} 至 ${comparisonPeriod.endDate}` : ""}；系统数据覆盖 {availableCoverageLabel}。</small></section>
    <section className="store-source-status product-performance-source-status" role="note">
      <div><span className="source-status-ready">✓ 已接入</span><strong>商品访客累计、成交、退款、收藏、加购、搜索、UV 价值、转化率</strong></div>
      <div><span className="source-status-missing">○ 不推算</span><strong>店铺去重 UV、付费访客、免费访客</strong></div>
      <p>以下 KPI 随当前 {dimensionLabel}、平台、店铺和日期筛选同步汇总；商品访客是商品×日累计，不能当作店铺去重 UV。</p>
    </section>
    <section className="store-metrics-grid product-performance-kpi-grid" aria-label={`${dimensionLabel} 商品数据 KPI`}>
      <StoreMetricCard label="商品访客累计" value={formatCount(current.summary.visitors)} change={showComparison ? productComparisonRate(current.summary.visitors, comparisonSummary?.visitors) : null} note={productKpiNote("商品×日访客累计，非店铺去重 UV", current.summary.visitors, comparisonSummary?.visitors)} />
      <StoreMetricCard label="成交金额" value={formatMerchantCurrency(current.summary.transactionAmount)} change={showComparison ? productComparisonRate(current.summary.transactionAmount, comparisonSummary?.transactionAmount) : null} note={productKpiNote("商智成交金额，不等同销售净额", current.summary.transactionAmount, comparisonSummary?.transactionAmount)} />
      <StoreMetricCard label="客单价" value={formatMerchantCurrency(currentAverageTransactionValue)} change={showComparison ? productComparisonRate(currentAverageTransactionValue, comparisonAverageTransactionValue) : null} note={currentAverageTransactionValue === null ? "当前周期没有成交人数" : productKpiNote("成交金额 / 成交人数", currentAverageTransactionValue, comparisonAverageTransactionValue)} unavailable={currentAverageTransactionValue === null} />
      <StoreMetricCard label="UV 价值" value={formatMerchantCurrency(current.summary.uvValue)} change={showComparison ? productComparisonRate(current.summary.uvValue, comparisonSummary?.uvValue) : null} note={current.summary.uvValue === null ? "当前导入日数据未提供" : productKpiNote("商智 UV 价值", current.summary.uvValue, comparisonSummary?.uvValue)} unavailable={current.summary.uvValue === null} />
      <StoreMetricCard label="转化率" value={formatOptionalRate(current.summary.conversionRate)} change={showComparison ? productComparisonRate(current.summary.conversionRate, comparisonSummary?.conversionRate) : null} note={current.summary.conversionRate === null ? "当前导入日数据未提供" : productKpiNote("商智总转化率", current.summary.conversionRate, comparisonSummary?.conversionRate)} unavailable={current.summary.conversionRate === null} />
      <StoreMetricCard label="推广花费" value="查看推广分析" note="按京东/天猫推广报表独立汇总" />
      <StoreMetricCard label="推广占比" value="查看推广分析" note="只按推广与支付金额日期交集计算" />
      <StoreMetricCard label="零售占比" value="—" note="待接入订单类型标记" unavailable />
      <StoreMetricCard label="B 端占比" value="—" note="待接入企业购明细" unavailable />
      <StoreMetricCard label="推广点击数" value="查看推广分析" note="不替代付费访客" />
      <StoreMetricCard label="付费访客" value="不推算" note="避免用点击数替代访客" unavailable />
      <StoreMetricCard label="免费访客" value="不推算" note="需平台自然流量数据" unavailable />
    </section>
    {error && <section className="inventory-feedback inventory-feedback-error" role="alert"><span>!</span><div><strong>数据刷新失败</strong><p>{error}</p></div><button className="row-action" onClick={() => setRetryKey((value) => value + 1)}>重试</button></section>}
    <section className="panel table-panel netshop-performance-table-panel">
      <div className="table-toolbar netshop-performance-toolbar"><div><h2>{dimensionLabel} 商品明细</h2><p>商智已接入指标可显示{comparisonLabel}百分比；推广与企业购指标保留为待接入列，不会以零值替代。</p></div><div className="netshop-performance-toolbar-actions"><span className="soft-tag">{formatCount(current.summary.productCount)} 个商品</span><label className="jd-sku-search"><span>⌕</span><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder={`搜索 ${dimensionLabel}、商品编码或名称`} aria-label={`搜索${dimensionLabel}商品表现`} /></label><div className={`store-column-picker product-performance-column-picker ${columnPickerOpen ? "open" : ""}`} ref={columnPickerRef}><button type="button" className="store-column-picker-trigger" aria-haspopup="dialog" aria-expanded={columnPickerOpen} onClick={() => { setColumnPickerOpen((open) => !open); setColumnPickerSearch(""); }}><span>☷</span>列设置 <em>{visibleColumns.length}/{productPerformanceColumns.length}</em></button>{columnPickerOpen && <div className="store-column-picker-menu" role="dialog" aria-label="选择商品明细指标"><div className="store-column-picker-head"><div><strong>显示指标</strong><small>商品信息、店铺名称和数据覆盖固定显示，至少保留 1 个指标</small></div><button type="button" onClick={() => setColumnPickerOpen(false)} aria-label="关闭列设置">×</button></div><div className="store-column-picker-actions"><button type="button" onClick={() => setVisibleColumns(productPerformanceColumns.map((column) => column.key))}>全选</button><button type="button" onClick={() => setVisibleColumns(connectedProductPerformanceColumns)}>仅商智已接入</button></div><label className="store-column-picker-search">⌕<input autoFocus type="search" value={columnPickerSearch} onChange={(event) => setColumnPickerSearch(event.target.value)} placeholder="搜索指标" aria-label="搜索商品明细指标" /></label><div className="store-column-picker-options">{matchedProductColumns.map((column) => { const checked = visibleColumns.includes(column.key); return <label key={column.key} className={checked ? "selected" : ""}><input type="checkbox" checked={checked} disabled={checked && visibleColumns.length === 1} onChange={() => toggleProductColumn(column.key)} /><span>{column.label}</span><em className={column.available ? "available" : "pending"}>{column.available ? "商智已接入" : "待接入"}</em></label>; })}{matchedProductColumns.length === 0 && <p className="store-column-picker-empty">没有匹配的指标</p>}</div></div>}</div></div></div>
      <div className="data-table-wrap netshop-performance-detail-scroll"><table className="data-table netshop-performance-data-table" style={{ minWidth: `${Math.max(1680, 850 + visibleProductColumns.length * 116)}px` }}><thead><tr><th>{dimensionLabel} ID</th><th>商品名称 / 编码</th><th>平台 / 店铺</th><th>类目</th>{visibleProductColumns.map((column) => <th key={column.key}>{column.label}</th>)}<th>数据覆盖</th><th>操作</th></tr></thead><tbody>{current.items.map((item) => { const productUrl = netshopProductUrl(item.platform, item.id); const relatedIdLabel = dimension === "sku" && item.spuId ? `SPU ${item.spuId}` : dimension === "spu" && item.skuId ? `SKU ${item.skuId}` : "平台商品标识"; const compared = comparisonItemById.get(netshopPerformanceItemKey(item)); return <tr key={netshopPerformanceItemKey(item)}><td><div className="netshop-product-id"><strong>{productUrl ? <a className="jd-sku-link" href={productUrl} target="_blank" rel="noreferrer">{item.id || "—"}</a> : item.id || "—"}</strong><small>{productUrl && relatedIdLabel !== "平台商品标识" ? <a className="jd-sku-link" href={productUrl} target="_blank" rel="noreferrer">{relatedIdLabel}</a> : relatedIdLabel}</small></div></td><td><div className="jd-sku-product-name"><strong title={item.productName}>{productUrl ? <a className="jd-sku-link" href={productUrl} target="_blank" rel="noreferrer">{item.productName || "未命名商品"}</a> : item.productName || "未命名商品"}</strong><small>{item.productCode || "未提供商品编码"}</small></div></td><td><span className="netshop-shop-list" title={`${item.platform} · ${item.shopNames.join("、")}`}>{item.platform || "—"} · {item.shopNames.join("、") || "—"}</span></td><td><span className="jd-sku-category" title={item.category}>{item.category || "—"}</span></td>{visibleProductColumns.map((column) => <td key={column.key}><ProductPerformanceDataCell column={column} item={item} compared={compared} showComparison={showComparison} showActual={showActual} comparisonLabel={comparisonLabel} /></td>)}<td><div className="netshop-data-coverage"><strong>{item.dateMin && item.dateMax ? `${item.dateMin.slice(5)} ~ ${item.dateMax.slice(5)}` : "—"}</strong><small>{formatCount(item.dataDays)} 天</small></div></td><td>{productUrl ? <a className="netshop-product-link" href={productUrl} target="_blank" rel="noreferrer">打开商品 ↗</a> : <span className="muted-text">无可用链接</span>}</td></tr>; })}{!loading && current.items.length === 0 && <tr><td colSpan={tableColSpan}><div className="table-state">当前筛选条件下没有可展示的 {dimensionLabel} 商品数据。</div></td></tr>}{loading && <tr><td colSpan={tableColSpan}><div className="table-state"><span className="state-spinner" />正在刷新商品表现…</div></td></tr>}</tbody></table></div>
      <footer className="jd-sku-pagination"><span>第 {pagination.page} / {totalPages} 页</span><div><button type="button" className="row-action" disabled={loading || pagination.page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button><button type="button" className="row-action" disabled={loading || pagination.page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>下一页</button></div></footer>
    </section>
  </>;
}

type ShopProductDataTab = "catalog" | "sku" | "spu";

function ShopProductDataView({
  onOpenImport,
  onOpenCatalogImport,
  range,
  customStartDate,
  customEndDate,
}: {
  onOpenImport: (dimension: NetshopProductPerformanceDimension) => void;
  onOpenCatalogImport: () => void;
  range: SalesRangeLabel;
  customStartDate: string;
  customEndDate: string;
}) {
  const [activeTab, setActiveTab] = useState<ShopProductDataTab>("spu");
  return <>
    <section className="shop-product-data-tabs" role="tablist" aria-label="商品数据维度">
      <button type="button" role="tab" aria-selected={activeTab === "catalog"} className={activeTab === "catalog" ? "active" : ""} onClick={() => setActiveTab("catalog")}>货品目录</button>
      <button type="button" role="tab" aria-selected={activeTab === "sku"} className={activeTab === "sku" ? "active" : ""} onClick={() => setActiveTab("sku")}>SKU（京东）</button>
      <button type="button" role="tab" aria-selected={activeTab === "spu"} className={activeTab === "spu" ? "active" : ""} onClick={() => setActiveTab("spu")}>SPU</button>
    </section>
    {activeTab === "catalog"
      ? <ShopSkuView onOpenImport={onOpenCatalogImport} range={range} customStartDate={customStartDate} customEndDate={customEndDate} />
      : <ShopDailyProductPerformanceView key={activeTab} dimension={activeTab} range={range} customStartDate={customStartDate} customEndDate={customEndDate} onOpenImport={onOpenImport} />}
  </>;
}

function ShopSkuView({
  onOpenImport,
  range,
  customStartDate,
  customEndDate,
}: {
  onOpenImport: () => void;
  range: SalesRangeLabel;
  customStartDate: string;
  customEndDate: string;
}) {
  const [catalog, setCatalog] = useState<JdSkuCatalogResponse | null>(null);
  const [query, setQuery] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [selectedOutletKeys, setSelectedOutletKeys] = useState<string[]>([]);
  const debouncedQuery = useDebouncedValue(query, 280);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const skuCatalogGenerationRef = useRef(0);
  const skuCatalogControllerRef = useRef<AbortController | null>(null);
  const salesPeriod = useMemo(
    () => skuSalesPeriod(range, customStartDate, customEndDate),
    [customEndDate, customStartDate, range],
  );

  const load = useCallback(async () => {
    const generation = skuCatalogGenerationRef.current + 1;
    skuCatalogGenerationRef.current = generation;
    skuCatalogControllerRef.current?.abort();
    const controller = new AbortController();
    skuCatalogControllerRef.current = controller;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "50" });
      params.set("startDate", salesPeriod.startDate);
      params.set("endDate", salesPeriod.endDate);
      if (debouncedQuery) params.set("q", debouncedQuery);
      selectedPlatforms.forEach((platform) => params.append("platform", platform));
      selectedOutletKeys.forEach((outlet) => params.append("outlet", outlet));
      const response = await fetch("/api/netshop/products?" + params.toString(), { cache: "no-store", signal: controller.signal });
      const payload = await response.json().catch(() => null) as (JdSkuCatalogResponse & { error?: string }) | null;
      if (!response.ok || !payload?.summary || !Array.isArray(payload.items)) {
        throw new Error(payload?.error || "网店货品数据读取失败（" + response.status + "）");
      }
      if (!controller.signal.aborted && generation === skuCatalogGenerationRef.current) setCatalog(payload);
    } catch (requestError) {
      if (!controller.signal.aborted && generation === skuCatalogGenerationRef.current) setError(requestError instanceof Error ? requestError.message : "暂时无法读取网店货品数据");
    } finally {
      if (!controller.signal.aborted && generation === skuCatalogGenerationRef.current) {
        setLoading(false);
        if (skuCatalogControllerRef.current === controller) skuCatalogControllerRef.current = null;
      }
    }
  }, [debouncedQuery, page, salesPeriod.endDate, salesPeriod.startDate, selectedOutletKeys, selectedPlatforms]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => {
      window.clearTimeout(timer);
      skuCatalogGenerationRef.current += 1;
      skuCatalogControllerRef.current?.abort();
    };
  }, [load, retryKey]);

  if (loading && !catalog) {
    return <section className="panel data-state" role="status"><span className="state-spinner" /><strong>正在读取网店货品目录</strong><p>正在加载各平台最近一次成功导入的商品快照…</p></section>;
  }
  if (error && !catalog) {
    return <section className="panel data-state data-state-error" role="alert"><span className="state-symbol">!</span><strong>网店货品数据加载失败</strong><p>{error}</p><button className="secondary-button" onClick={() => setRetryKey((value) => value + 1)}>重新加载</button></section>;
  }
  if (!catalog?.batch) {
    return <section className="panel data-state"><span className="state-symbol">品</span><strong>尚未导入网店货品快照</strong><p>请先上传京东 SKU 或天猫店铺商品发布模板；导入完成后会在这里展示商品与 SKU。</p><button className="primary-button" onClick={onOpenImport}>前往导入货品</button></section>;
  }

  const { summary, pagination } = catalog;
  const totalPages = Math.max(1, Math.ceil(pagination.total / pagination.pageSize));
  const shops = catalog.shops ?? [];
  const sales = catalog.sales;
  return <>
    <section className="panel jd-sku-hero">
      <div><span className="eyebrow">NETSHOP PRODUCT CATALOG</span><h2>网店货品与 SKU</h2><p>按平台与店铺读取最近一次成功导入的货品快照；商家编码仅作映射，不用于合并重复 SKU。</p></div>
      <div className="jd-sku-hero-actions"><span><Dot tone="green" />已同步 {catalog.batch.snapshotDate ?? "最新"} 快照</span><button type="button" className="secondary-button" onClick={() => void load()} disabled={loading}>{loading ? "刷新中…" : "↻ 刷新"}</button><button type="button" className="primary-button" onClick={onOpenImport}>＋ 导入天猫货品</button></div>
    </section>
    <section className="metrics-grid jd-sku-metrics">
      <MetricCard label="SKU 总数" value={formatCount(summary.totalSkus) + " 个"} change="已同步" hint={"文件：" + catalog.batch.fileName} tone="blue" />
      <MetricCard label="已标记上架 SKU" value={formatCount(summary.onSaleSkus) + " 个"} change="平台字段" hint="未提供状态的平台不做推算" tone="green" />
      <MetricCard label="商品总库存" value={formatCount(summary.totalInventory)} change="最新快照" hint="SKU 商品总库存汇总" tone="purple" />
      <MetricCard label="商品可用库存" value={formatCount(summary.availableInventory)} change="最新快照" hint={"导入完成：" + formatDateTime(catalog.batch.completedAt)} tone="orange" />
    </section>
    {sales?.periodStart && sales?.periodEnd && <section className="jd-sku-sales-context"><strong>经营指标口径</strong><span>{sales.platform}平台已导入销售明细 · 统计周期 {sales.periodStart} 至 {sales.periodEnd} · 数据截止 {sales.dataCutoffDate ?? "暂无"}</span><small>成本价为当前周期销量加权成本；净销售额、毛利率与退货率均不按店铺名称推算。</small></section>}
    {error && <section className="inventory-feedback inventory-feedback-error" role="alert"><span>!</span><div><strong>数据刷新失败</strong><p>{error}</p></div><button className="row-action" onClick={() => setRetryKey((value) => value + 1)}>重试</button></section>}
    <section className="panel table-panel jd-sku-table-panel">
      <div className="table-toolbar jd-sku-toolbar"><div><h2>SKU 商品目录</h2><p>共 {formatCount(pagination.total)} 条；可按店铺、商品 ID、SKU、商家编码或名称搜索。</p></div><div className="jd-sku-toolbar-actions"><label className="jd-sku-store-select"><span>平台</span><SearchableMultiSelect values={selectedPlatforms} onChange={(values) => { const allowedOutlets = new Set(shops.filter((shop) => values.length === 0 || values.includes(shop.platform)).map((shop) => netshopOutletFilterKey(shop.platform, shop.shopName))); setSelectedPlatforms(values); setSelectedOutletKeys((current) => current.filter((outlet) => allowedOutlets.has(outlet))); setPage(1); }} ariaLabel="按平台筛选货品" allLabel="全部平台" searchPlaceholder="搜索平台" options={[...new Set(shops.map((shop) => shop.platform))].map((platform) => ({ value: platform, label: platform }))} /></label><label className="jd-sku-store-select"><span>店铺</span><SearchableMultiSelect values={selectedOutletKeys} onChange={(values) => { setSelectedOutletKeys(values); setPage(1); }} ariaLabel="按店铺名称筛选" allLabel="全部店铺" searchPlaceholder="搜索店铺或平台" options={shops.filter((shop) => selectedPlatforms.length === 0 || selectedPlatforms.includes(shop.platform)).map((shop) => ({ value: netshopOutletFilterKey(shop.platform, shop.shopName), label: `${shop.shopName || "未命名店铺"} · ${shop.platform}`, searchText: `${shop.shopName} ${shop.platform}` }))} /></label><label className="jd-sku-search"><span>⌕</span><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="搜索商品 ID、SKU、商家编码或名称" aria-label="搜索网店商品 SKU" /></label></div></div>
      <div className="data-table-wrap"><table className="data-table jd-sku-data-table"><thead><tr><th>SKU图</th><th>平台 / 店铺</th><th>商品 ID</th><th>SKU ID</th><th>商家编码</th><th>商品名称 / 销售属性</th><th>平台售价</th><th>库存</th><th>净销售额</th><th>大毛利率</th><th>类目</th><th>快照 / 状态</th></tr></thead><tbody>{catalog.items.map((item) => { const link = netshopProductUrl(item.platform, item.spuId, item.productUrl); const isOnSale = item.status === "上架"; const thumb = item.imageUrl ? <img className="jd-sku-thumb" src={item.imageUrl} alt={item.productName ? `${item.productName} SKU 主图` : "SKU 主图"} loading="lazy" referrerPolicy="no-referrer" /> : <span className="jd-sku-thumb jd-sku-thumb-missing">暂无主图</span>; return <tr key={`${item.platform}-${item.shopName}-${item.spuId}-${item.skuId}-${item.saleAttribute}`}><td>{link ? <a className="jd-sku-thumb-link" href={link} target="_blank" rel="noreferrer">{thumb}</a> : thumb}</td><td><span className="soft-tag">{item.platform}</span><small className="jd-sku-shop-name" title={item.shopName}>{item.shopName || "未命名店铺"}</small></td><td>{link ? <a className="jd-sku-link" href={link} target="_blank" rel="noreferrer">{item.spuId || "—"}</a> : item.spuId || "—"}</td><td>{link && item.skuId ? <a className="jd-sku-link" href={link} target="_blank" rel="noreferrer">{item.skuId}</a> : item.skuId || "—"}</td><td>{item.productCode || "—"}</td><td><div className="jd-sku-product-name"><strong title={item.productName}>{link ? <a className="jd-sku-link" href={link} target="_blank" rel="noreferrer">{item.productName || "未命名商品"}</a> : item.productName || "未命名商品"}</strong><small>{item.saleAttribute || item.brand || "—"}</small></div></td><td><strong>{formatOptionalCurrencyFromCents(item.priceCents)}</strong></td><td><strong>{item.availableInventory === null ? "—" : formatCount(item.availableInventory)}</strong></td><td className="jd-sku-money-cell"><strong>{formatOptionalCurrencyFromCents(item.netSalesCents)}</strong></td><td className={item.grossMarginRate !== null && item.grossMarginRate < .35 ? "orange-text" : "green-text"}><strong>{formatOptionalRate(item.grossMarginRate)}</strong></td><td><span className="jd-sku-category" title={item.category}>{item.category || "—"}</span></td><td><small>{item.snapshotDate || "—"}</small><span className={"status " + (isOnSale ? "status-success" : "status-warning")}><Dot tone={isOnSale ? "green" : "orange"} />{item.status || "未标记"}</span></td></tr>; })}{!loading && catalog.items.length === 0 && <tr><td colSpan={12}><div className="table-state">没有符合当前筛选条件的 SKU 数据。</div></td></tr>}{loading && <tr><td colSpan={12}><div className="table-state"><span className="state-spinner" />正在刷新 SKU 目录…</div></td></tr>}</tbody></table></div>
      <footer className="jd-sku-pagination"><span>第 {pagination.page} / {totalPages} 页</span><div><button type="button" className="row-action" disabled={loading || pagination.page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button><button type="button" className="row-action" disabled={loading || pagination.page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>下一页</button></div></footer>
    </section>
  </>;
}

type PromotionPageKey = "jd" | "tmall";

const promotionPageConfig: Record<PromotionPageKey, {
  platform: "京东" | "天猫";
  shopName: string;
  eyebrow: string;
  title: string;
  description: string;
  paymentSource: string;
  transactionLabel: string;
  transactionShortLabel: string;
  ordersLabel: string;
}> = {
  jd: {
    platform: "京东",
    shopName: "志高商用设备旗舰店",
    eyebrow: "JD PROMOTION",
    title: "京东推广",
    description: "按京准通 AI 推广报表中的跟单 SKU 汇总；总订单金额、总订单行、花费、展现和点击均从来源字段重新聚合。",
    paymentSource: "京东商智成交金额",
    transactionLabel: "总订单金额",
    transactionShortLabel: "订单金额",
    ordersLabel: "总订单行",
  },
  tmall: {
    platform: "天猫",
    shopName: "天猫-志高亿玖专卖店",
    eyebrow: "TMALL PROMOTION",
    title: "天猫亿玖推广",
    description: "按天猫推广商品报表汇总；比例只使用推广报表与生意参谋商品日数据的日期交集，各行投产比不会被直接平均。",
    paymentSource: "生意参谋支付金额",
    transactionLabel: "推广净成交",
    transactionShortLabel: "推广净成交",
    ordersLabel: "净成交笔数",
  },
};

function ShopPromotionView({
  range,
  customStartDate,
  customEndDate,
  onOpenTmallImport,
}: {
  range: SalesRangeLabel;
  customStartDate: string;
  customEndDate: string;
  onOpenTmallImport: () => void;
}) {
  const period = useMemo(() => skuSalesPeriod(range, customStartDate, customEndDate), [customEndDate, customStartDate, range]);
  const [promotionPage, setPromotionPage] = useState<PromotionPageKey>("jd");
  const [performance, setPerformance] = useState<NetshopPromotionPerformanceResponse | null>(null);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 280);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const promotionGenerationRef = useRef(0);
  const promotionControllerRef = useRef<AbortController | null>(null);
  const pageConfig = promotionPageConfig[promotionPage];

  const selectPromotionPage = (nextPage: PromotionPageKey) => {
    if (nextPage === promotionPage) return;
    setPromotionPage(nextPage);
    setPerformance(null);
    setQuery("");
    setPage(1);
    setError("");
  };

  useEffect(() => {
    const generation = promotionGenerationRef.current + 1;
    promotionGenerationRef.current = generation;
    promotionControllerRef.current?.abort();
    const controller = new AbortController();
    promotionControllerRef.current = controller;
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          startDate: period.startDate,
          endDate: period.endDate,
          platform: pageConfig.platform,
          outlet: netshopOutletFilterKey(pageConfig.platform, pageConfig.shopName),
          page: String(page),
          pageSize: "50",
        });
        if (debouncedQuery) params.set("q", debouncedQuery);
        const response = await fetch(`/api/netshop/promotion-performance?${params.toString()}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json().catch(() => null) as (NetshopPromotionPerformanceResponse & { error?: string }) | null;
        if (!response.ok || !payload?.summary || !Array.isArray(payload.items)) throw new Error(payload?.error || `推广数据读取失败（${response.status}）`);
        if (!controller.signal.aborted && generation === promotionGenerationRef.current) setPerformance(payload);
      } catch (requestError) {
        if (!controller.signal.aborted && generation === promotionGenerationRef.current) setError(requestError instanceof Error ? requestError.message : "暂时无法读取推广数据");
      } finally {
        if (!controller.signal.aborted && generation === promotionGenerationRef.current) {
          setLoading(false);
          if (promotionControllerRef.current === controller) promotionControllerRef.current = null;
        }
      }
    })();
    return () => {
      promotionGenerationRef.current += 1;
      controller.abort();
    };
  }, [debouncedQuery, page, pageConfig.platform, pageConfig.shopName, period.endDate, period.startDate, retryKey]);

  const platformSubnav = <div className="subnav promotion-platform-subnav" role="tablist" aria-label="推广分析平台">
    <button type="button" role="tab" aria-selected={promotionPage === "jd"} className={promotionPage === "jd" ? "active" : ""} onClick={() => selectPromotionPage("jd")}>京东推广</button>
    <button type="button" role="tab" aria-selected={promotionPage === "tmall"} className={promotionPage === "tmall" ? "active" : ""} onClick={() => selectPromotionPage("tmall")}>天猫推广</button>
  </div>;

  if (loading && !performance) return <>{platformSubnav}<section className="panel data-state" role="status"><span className="state-spinner" /><strong>正在汇总{pageConfig.title}数据</strong><p>正在计算花费、成交、点击和平台商品成交口径占比…</p></section></>;
  if (error && !performance) return <>{platformSubnav}<section className="panel data-state data-state-error" role="alert"><span className="state-symbol">!</span><strong>{pageConfig.title}加载失败</strong><p>{error}</p><button className="secondary-button" onClick={() => setRetryKey((value) => value + 1)}>重新加载</button></section></>;
  if (!performance?.dataCutoffDate) return <>{platformSubnav}<section className="panel data-state"><span className="state-symbol">推</span><strong>当前周期尚未导入{pageConfig.title}数据</strong><p>{promotionPage === "jd" ? "请先运行京准通 AI 推广数据工作流并完成导入回查；推广费率和推广成交占比还需要同日期京东商智 SKU 日数据。" : "请上传天猫亿玖推广商品报表 ZIP；推广费率和推广成交占比还需要同日期生意参谋商品日数据。"}</p>{promotionPage === "tmall" ? <button className="primary-button" onClick={onOpenTmallImport}>前往导入推广数据</button> : <button className="secondary-button" onClick={() => setRetryKey((value) => value + 1)}>重新检查</button>}</section></>;

  const { summary, coverage, pagination } = performance;
  const maxTrend = Math.max(1, ...performance.daily.map((item) => Math.max(item.spendCents, item.netTransactionAmountCents)));
  const totalPages = Math.max(1, Math.ceil(pagination.total / pagination.pageSize));
  return <>
    {platformSubnav}
    <section className="panel jd-sku-hero">
      <div><span className="eyebrow">{pageConfig.eyebrow}</span><h2>{pageConfig.title}</h2><p>{pageConfig.description}</p></div>
      <div className="jd-sku-hero-actions"><span><Dot tone="green" />{pageConfig.shopName} · 数据截止 {performance.dataCutoffDate}</span><button type="button" className="secondary-button" onClick={() => setRetryKey((value) => value + 1)} disabled={loading}>{loading ? "刷新中…" : "↻ 刷新"}</button>{promotionPage === "tmall" && <button type="button" className="primary-button" onClick={onOpenTmallImport}>＋ 导入推广报表</button>}</div>
    </section>
    <section className="metrics-grid">
      <MetricCard label="推广花费" value={formatCurrencyFromCents(summary.spendCents)} change={formatOptionalRate(summary.spendRate)} hint={`花费 / ${pageConfig.paymentSource}`} tone="blue" />
      <MetricCard label={pageConfig.transactionLabel} value={formatCurrencyFromCents(summary.netTransactionAmountCents)} change={formatOptionalRate(summary.promotionTransactionShare)} hint={`${pageConfig.transactionShortLabel} / ${pageConfig.paymentSource}`} tone="purple" />
      <MetricCard label="推广 ROAS" value={summary.roas === null ? "—" : summary.roas.toFixed(2)} change={`${pageConfig.transactionShortLabel} / 花费`} hint={`${formatCount(summary.netOrders)} ${pageConfig.ordersLabel}`} tone="green" />
      <MetricCard label="展现 / 点击" value={`${formatCount(summary.impressions)} / ${formatCount(summary.clicks)}`} change={formatOptionalRate(summary.clickThroughRate)} hint={`平均点击花费 ${formatOptionalCurrencyFromCents(summary.averageClickCostCents)}`} tone="orange" />
    </section>
    <section className="store-source-status" role="note">
      <div><span className="source-status-ready">✓ 比例交集</span><strong>{coverage.intersectionDates.length ? `${coverage.intersectionDates[0]} 至 ${coverage.intersectionDates[coverage.intersectionDates.length - 1]}` : `暂无同日${pageConfig.paymentSource}`}</strong></div>
      <div><span className={coverage.missingProductDailyDates.length ? "source-status-missing" : "source-status-ready"}>{coverage.missingProductDailyDates.length ? "○ 覆盖缺口" : "✓ 覆盖完整"}</span><strong>{coverage.missingProductDailyDates.length ? `缺${pageConfig.paymentSource}：${coverage.missingProductDailyDates.join("、")}` : `${coverage.intersectionDates.length} 个共同业务日`}</strong></div>
      <p>{promotionPage === "jd" ? "京准通总订单金额不是退款后的销售净额；比例不与 ERP 销售净额混算。" : "推广费率与推广成交占比均采用平台报表口径，不与 ERP 销售净额混算。"}</p>
    </section>
    <section className="panel trend-panel">
      <SectionHeader title="推广日趋势" note={`蓝色为花费，紫色为${pageConfig.transactionShortLabel}；金额单位为人民币元。`} />
      <div className="chart-legend"><span><Dot tone="blue" />推广花费</span><span><Dot tone="purple" />{pageConfig.transactionShortLabel}</span></div>
      <div className="bar-chart">{performance.daily.map((item) => <div className="bar-group" key={item.date}><div className="bar-stack"><span className="bar sales-bar" style={{ height: `${Math.max(2, item.spendCents / maxTrend * 100)}%` }} /><span className="bar profit-bar" style={{ height: `${Math.max(2, item.netTransactionAmountCents / maxTrend * 100)}%` }} /></div><small>{item.date.slice(5)}</small></div>)}</div>
    </section>
    {error && <section className="inventory-feedback inventory-feedback-error" role="alert"><span>!</span><div><strong>数据刷新失败</strong><p>{error}</p></div></section>}
    <section className="panel table-panel">
      <div className="table-toolbar"><div><h2>推广商品排行</h2><p>共 {formatCount(pagination.total)} 个{promotionPage === "jd" ? "跟单 SKU" : "商品"}；搜索只筛选排行，顶部平台汇总保持稳定。</p></div><label className="jd-sku-search"><span>⌕</span><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder={promotionPage === "jd" ? "搜索跟单 SKU 或产品线" : "搜索商品 ID 或名称"} aria-label="搜索推广商品" /></label></div>
      <div className="data-table-wrap"><table className="data-table"><thead><tr><th>{promotionPage === "jd" ? "跟单 SKU / 产品线" : "商品"}</th><th>推广花费</th><th>{pageConfig.transactionLabel}</th><th>ROAS</th><th>展现</th><th>点击 / CTR</th><th>平均点击花费</th><th>{pageConfig.ordersLabel}</th>{promotionPage === "tmall" && <th>收藏 / 加购</th>}<th>覆盖日期</th></tr></thead><tbody>{performance.items.map((item) => { const productLink = netshopProductUrl(item.platform, item.id); return <tr key={`${item.platform}-${item.shopName}-${item.id}`}><td><div className="jd-sku-product-name">{productLink ? <a className="jd-sku-link" href={productLink} target="_blank" rel="noreferrer">{item.id}</a> : <strong>{item.id}</strong>}<strong title={item.productName}>{item.productName || (promotionPage === "jd" ? "未提供产品线" : "未命名商品")}</strong></div></td><td>{formatCurrencyFromCents(item.spendCents)}</td><td><strong>{formatCurrencyFromCents(item.netTransactionAmountCents)}</strong></td><td>{item.roas === null ? "—" : item.roas.toFixed(2)}</td><td>{formatCount(item.impressions)}</td><td>{formatCount(item.clicks)} / {formatOptionalRate(item.clickThroughRate)}</td><td>{formatOptionalCurrencyFromCents(item.averageClickCostCents)}</td><td>{formatCount(item.netOrders)}</td>{promotionPage === "tmall" && <td>{formatCount(item.favorites)} / {formatCount(item.cartQuantity)}</td>}<td data-column-filter-values={item.dates?.join("\u001f")}>{item.dateMin ?? "—"}{item.dateMax && item.dateMax !== item.dateMin ? ` 至 ${item.dateMax}` : ""}</td></tr>; })}{!loading && performance.items.length === 0 && <tr><td colSpan={promotionPage === "jd" ? 9 : 10}><div className="table-state">没有符合当前搜索条件的推广商品。</div></td></tr>}</tbody></table></div>
      <footer className="jd-sku-pagination"><span>第 {pagination.page} / {totalPages} 页</span><div><button type="button" className="row-action" disabled={loading || pagination.page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button><button type="button" className="row-action" disabled={loading || pagination.page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>下一页</button></div></footer>
    </section>
  </>;
}

type OutletTab = ModuleViewKey<"shop">;

function ShopView({ range, customStartDate, customEndDate, onNavigate, moduleView, onModuleViewChange }: { range: SalesRangeLabel; customStartDate: string; customEndDate: string; onNavigate: (key: ModuleKey, importSource?: ImportSourceKey) => void; moduleView: OutletTab; onModuleViewChange: (view: OutletTab) => void }) {
  const apiRange = salesRangeMap[range];
  const activeTab = moduleView;
  const [summary, setSummary] = useState<SalesSummaryResponse | null>(null);
  const [analysisSummary, setAnalysisSummary] = useState<SalesSummaryResponse | null>(null);
  const [selectedOutletKeys, setSelectedOutletKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [platformFilters, setPlatformFilters] = useState<string[]>([]);
  const requestGenerationRef = useRef(0);
  const requestControllerRef = useRef<AbortController | null>(null);

  const loadOutlets = useCallback(async () => {
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    if (activeTab === "products" || activeTab === "promotion") {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    requestControllerRef.current = controller;
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ range: apiRange });
      if (apiRange === "custom") {
        query.set("startDate", customStartDate);
        query.set("endDate", customEndDate);
      }
      if (activeTab === "analysis") selectedOutletKeys.forEach((key) => query.append("outlet", key));
      const payload = await requestJson<SalesSummaryResponse>(`/api/sales/summary?${query.toString()}`, { signal: controller.signal });
      if (!payload?.current || !Array.isArray(payload.outlets)) throw new Error("网店数据响应格式不完整");
      if (controller.signal.aborted || generation !== requestGenerationRef.current) return;
      const availableOutletKeys = new Set((payload.filterOptions?.shops ?? payload.outlets).map((item) => "key" in item ? item.key : item.groupKey));
      const validOutletKeys = selectedOutletKeys.filter((key) => availableOutletKeys.has(key));
      setSummary(payload);
      setAnalysisSummary(payload);
      if (validOutletKeys.length !== selectedOutletKeys.length) setSelectedOutletKeys(validOutletKeys);
    } catch (requestError) {
      if (controller.signal.aborted || generation !== requestGenerationRef.current) return;
      setSummary(null);
      setAnalysisSummary(null);
      setError(requestError instanceof Error ? requestError.message : "暂时无法读取网店数据");
    } finally {
      if (!controller.signal.aborted && generation === requestGenerationRef.current) {
        setLoading(false);
        if (requestControllerRef.current === controller) requestControllerRef.current = null;
      }
    }
  }, [activeTab, apiRange, customEndDate, customStartDate, selectedOutletKeys]);

  useEffect(() => {
    void loadOutlets();
    return () => requestControllerRef.current?.abort();
  }, [loadOutlets, retryKey]);

  const current = summary?.current;
  const previous = summary?.previous;
  const yearAgo = summary?.yearAgo;
  const outlets = useMemo(() => summary?.outlets ?? [], [summary?.outlets]);
  const filterOutletOptions = summary?.filterOptions?.shops;
  const outletOptions = useMemo<Array<Pick<SalesChannel, "groupKey" | "name" | "platform">>>(
    () => filterOutletOptions?.length
      ? filterOutletOptions.map((item) => ({ groupKey: item.key, name: item.name, platform: item.platform }))
      : outlets.map((item) => ({ groupKey: item.groupKey, name: item.name, platform: item.platform })),
    [filterOutletOptions, outlets],
  );
  const platforms = useMemo(() => summary?.platforms ?? [], [summary?.platforms]);
  const platformOptions = useMemo(
    () => [...new Set(outlets.map((item) => item.platform).filter((item) => item && item !== "未分类"))].sort((left, right) => left.localeCompare(right, "zh-CN")),
    [outlets],
  );
  const displayedRows = useMemo(() => {
    const source = activeTab === "outlets" ? outlets : platforms;
    return source
      .filter((item) => activeTab !== "outlets" || platformFilters.length === 0 || platformFilters.includes(item.platform))
      .sort((left, right) => right.netSalesCents - left.netSalesCents);
  }, [activeTab, outlets, platformFilters, platforms]);
  const hasData = Boolean(current && (current.lineCount > 0 || current.orderCount > 0 || current.netSalesCents !== 0));
  const rowLabel = activeTab === "outlets" ? "网店" : "平台";
  const rangeNote = summary ? `${summary.startDate} 至 ${summary.endDate}` : range;

  const subnav = <div className="subnav outlet-subnav" role="tablist" aria-label="网店分析子版块"><button type="button" role="tab" aria-selected={activeTab === "analysis"} className={activeTab === "analysis" ? "active" : ""} onClick={() => onModuleViewChange("analysis")}>店铺分析</button><button type="button" role="tab" aria-selected={activeTab === "outlets"} className={activeTab === "outlets" ? "active" : ""} onClick={() => onModuleViewChange("outlets")}>网店总览</button><button type="button" role="tab" aria-selected={activeTab === "platforms"} className={activeTab === "platforms" ? "active" : ""} onClick={() => onModuleViewChange("platforms")}>平台对比</button><button type="button" role="tab" aria-selected={activeTab === "products"} className={activeTab === "products" ? "active" : ""} onClick={() => onModuleViewChange("products")}>商品数据</button><button type="button" role="tab" aria-selected={activeTab === "promotion"} className={activeTab === "promotion" ? "active" : ""} onClick={() => onModuleViewChange("promotion")}>推广分析</button><button type="button" disabled title="待接入企业购明细">企业购分析</button><button type="button" disabled title="待接入客服报表">客服分析</button></div>;

  if (activeTab === "products") return <>{subnav}<ShopProductDataView range={range} customStartDate={customStartDate} customEndDate={customEndDate} onOpenCatalogImport={() => onNavigate("import", "tmall_product_master")} onOpenImport={(dimension) => onNavigate("import", dimension === "sku" ? "jd_sku_daily" : "tmall_product_daily")} /></>;
  if (activeTab === "promotion") return <>{subnav}<ShopPromotionView range={range} customStartDate={customStartDate} customEndDate={customEndDate} onOpenTmallImport={() => onNavigate("import", "tmall_promotion")} /></>;

  if (loading && !summary) return <>{subnav}<section className="panel data-state" role="status"><span className="state-spinner" /><strong>正在同步网店经营数据</strong><p>正在汇总已导入销售明细中的网店、平台、毛利与退货信息…</p></section></>;
  if (!summary || !analysisSummary) return <>{subnav}<section className="panel data-state data-state-error" role="alert"><span className="state-symbol">!</span><strong>网店数据加载失败</strong><p>{error || "暂时无法读取网店数据"}</p><button className="secondary-button" onClick={() => setRetryKey((value) => value + 1)}>重新加载</button></section></>;
  if (!current || (!hasData && !(activeTab === "analysis" && selectedOutletKeys.length > 0))) return <>{subnav}<section className="panel data-state"><span className="state-symbol">店</span><strong>{range}暂无网店销售数据</strong><p>请先在“数据导入”同步销售单明细账；系统会优先按店铺名称汇总，缺失时回退为渠道或平台。</p></section></>;

  if (activeTab === "analysis") return <>{subnav}<StoreAnalysisView summary={analysisSummary} outlets={outletOptions} selectedOutletKeys={selectedOutletKeys} onSelectOutlets={(keys) => { const unchanged = keys.length === selectedOutletKeys.length && keys.every((key, index) => key === selectedOutletKeys[index]); setSelectedOutletKeys(keys); if (unchanged) setRetryKey((value) => value + 1); }} loading={loading} /></>;

  return <>
    {subnav}
    <section className="outlet-sync-bar"><span><Dot tone="green" />已同步销售明细</span><strong>{rangeNote}</strong>{summary.latestBatch?.fileName && <small>最近批次：{summary.latestBatch.fileName}</small>}<button type="button" className="row-action" onClick={() => void loadOutlets()} disabled={loading}>{loading ? "同步中…" : "↻ 同步数据"}</button></section>
    {error && <section className="inventory-feedback inventory-feedback-error" role="alert"><span>!</span><div><strong>数据刷新失败</strong><p>{error}</p></div><button className="row-action" onClick={() => setRetryKey((value) => value + 1)}>重试</button></section>}
    <section className="metrics-grid outlet-metrics-grid">
      <MetricCard label="活跃网店" value={`${formatCount(outlets.length)} 个`} change={formatChange(outlets.length, 0)} hint={`覆盖 ${formatCount(platformOptions.length)} 个平台`} tone="blue" />
      <MetricCard label="网店销售净额" value={formatCurrencyFromCents(current.netSalesCents)} change={formatChange(current.netSalesCents, previous?.netSalesCents)} hint={comparisonHint(current.netSalesCents, previous?.netSalesCents, yearAgo?.netSalesCents)} tone="purple" />
      <MetricCard label="订单毛利" value={formatCurrencyFromCents(current.grossProfitCents)} change={formatChange(current.grossProfitCents, previous?.grossProfitCents)} hint={`综合大毛利率 ${formatRate(current.grossMarginRate)}`} tone="green" />
      <MetricCard label="退货率" value={formatRate(current.refundRate)} change={formatChange(rateAsPercent(current.refundRate), rateAsPercent(previous?.refundRate))} hint={comparisonHint(rateAsPercent(current.refundRate), rateAsPercent(previous?.refundRate), rateAsPercent(yearAgo?.refundRate))} tone="orange" />
    </section>
    <section className="panel table-panel outlet-table-panel">
      <div className="table-toolbar"><div><h2>{rowLabel}经营明细</h2><p>销售额、同比、毛利率和退货率随顶部统计周期及最新导入批次自动更新。</p></div>{activeTab === "outlets" && <SearchableMultiSelect className="filter-select outlet-platform-filter" values={platformFilters} onChange={setPlatformFilters} ariaLabel="平台筛选" allLabel="全部平台" searchPlaceholder="搜索平台" options={platformOptions.map((value) => ({ value, label: value }))} />}</div>
      <div className="data-table-wrap"><table className="data-table outlet-data-table"><thead><tr><th>排名</th><th>{rowLabel}</th>{activeTab === "outlets" && <th>所属平台</th>}<th>销售净额</th><th>净额占比</th><th>净销售同比</th><th>订单量</th><th>大毛利率</th><th>退货率</th><th>经营状态</th></tr></thead><tbody>{displayedRows.map((item, index) => { const needsAttention = item.grossMarginRate < current.grossMarginRate - .05 || item.refundRate > current.refundRate + .03; const statusText = needsAttention ? "需要关注" : index < 3 && item.shareRate >= .1 ? "核心网店" : "经营稳健"; return <tr key={`${activeTab}-${item.platform}-${item.name}`}><td><span className={`table-rank ${index < 3 ? `top-${index + 1}` : ""}`}>{index + 1}</span></td><td><div className="channel-name-cell"><span>{(item.name || "未").slice(0, 1)}</span><strong title={item.name}>{item.name || "未分类"}</strong></div></td>{activeTab === "outlets" && <td><span className="soft-tag">{item.platform || "未分类"}</span></td>}<td><strong>{formatCurrencyFromCents(item.netSalesCents)}</strong></td><td>{formatRate(item.shareRate)}</td><td className={netSalesYearOverYearTone(item.salesYearOverYearRate)}>{formatNetSalesYearOverYear(item.salesYearOverYearRate)}</td><td>{formatCount(item.orderCount)}</td><td className={item.grossMarginRate < current.grossMarginRate ? "orange-text" : "green-text"}>{formatRate(item.grossMarginRate)}</td><td className={item.refundRate > current.refundRate ? "orange-text" : ""}>{formatRate(item.refundRate)}</td><td><span className={`status ${needsAttention ? "status-warning" : "status-success"}`}><Dot tone={needsAttention ? "orange" : "green"} />{statusText}</span></td></tr>; })}{displayedRows.length === 0 && <tr><td colSpan={activeTab === "outlets" ? 10 : 9}><div className="table-state">当前筛选条件下没有可展示的{rowLabel}数据。</div></td></tr>}</tbody></table></div>
    </section>
  </>;
}

type SalesTab = ModuleViewKey<"sales">;
type ChannelDimension = "channel" | "platform";

function SalesSubnav({ active, onChange }: { active: SalesTab; onChange: (tab: SalesTab) => void }) {
  return (
    <div className="subnav inventory-subnav sales-subnav" role="tablist" aria-label="销售分析子版块">
      <button type="button" role="tab" aria-selected={active === "overview"} className={active === "overview" ? "active" : ""} onClick={() => onChange("overview")}>销售总览</button>
      <button type="button" role="tab" aria-selected={active === "channel"} className={active === "channel" ? "active" : ""} onClick={() => onChange("channel")}>渠道分析</button>
      <button type="button" role="tab" aria-selected={active === "category"} className={active === "category" ? "active" : ""} onClick={() => onChange("category")}>品类分析</button>
      <button type="button" role="tab" aria-selected={active === "finance"} className={active === "finance" ? "active" : ""} onClick={() => onChange("finance")}>财报分析</button>
      <button type="button" role="tab" aria-selected={active === "targets"} className={active === "targets" ? "active" : ""} onClick={() => onChange("targets")}>目标设置</button>
    </div>
  );
}

function ChannelAnalysisView({
  channels,
  platforms,
  current,
}: {
  channels: SalesChannel[];
  platforms: SalesChannel[];
  current: SalesStats;
}) {
  const [dimension, setDimension] = useState<ChannelDimension>("channel");
  const rows = useMemo(
    () => [...(dimension === "channel" ? channels : platforms)].sort((a, b) => b.netSalesCents - a.netSalesCents),
    [channels, dimension, platforms],
  );

  if (!rows.length) {
    return (
      <section className="panel data-state channel-empty-state">
        <span className="state-symbol" aria-hidden="true">渠</span>
        <strong>暂未识别到渠道数据</strong>
        <p>当前销售明细已有成交记录，但渠道字段为空。请检查导入文件中的渠道或平台映射。</p>
      </section>
    );
  }

  const topChannel = rows[0];
  const marginLeader = rows.reduce((best, item) => item.grossMarginRate > best.grossMarginRate ? item : best, rows[0]);
  const refundLeader = rows.reduce((highest, item) => {
    const itemRate = item.grossSalesCents === 0 ? 0 : item.refundAmountCents / item.grossSalesCents;
    const highestRate = highest.grossSalesCents === 0 ? 0 : highest.refundAmountCents / highest.grossSalesCents;
    return itemRate > highestRate ? item : highest;
  }, rows[0]);
  const topThreeShare = Math.min(1, Math.max(0, rows.slice(0, 3).reduce((sum, item) => sum + item.shareRate, 0)));
  const concentrationLabel = topThreeShare >= .75 ? "集中度较高" : topThreeShare >= .5 ? "集中度适中" : "渠道较均衡";
  const maxSales = Math.max(1, ...rows.map((item) => Math.max(0, item.netSalesCents)));
  const dimensionLabel = dimension === "channel" ? "销售渠道" : "平台";
  const refundLeaderRate = refundLeader.grossSalesCents === 0 ? 0 : refundLeader.refundAmountCents / refundLeader.grossSalesCents;

  return (
    <>
      <section className="channel-analysis-toolbar" aria-label="渠道分析维度">
        <div>
          <span className="eyebrow">渠道经营诊断</span>
          <h2>看清渠道贡献与经营质量</h2>
          <p>从销售规模、利润质量和退货风险三个角度，识别核心渠道与改善机会。</p>
        </div>
        <div className="segmented" role="group" aria-label="渠道分析口径">
          <button type="button" className={dimension === "channel" ? "active" : ""} aria-pressed={dimension === "channel"} onClick={() => setDimension("channel")}>销售渠道</button>
          <button type="button" className={dimension === "platform" ? "active" : ""} aria-pressed={dimension === "platform"} onClick={() => setDimension("platform")}>平台汇总</button>
        </div>
      </section>

      <section className="channel-kpi-grid">
        <article className="channel-kpi-card">
          <div><span>有效{dimensionLabel}</span><i className="channel-kpi-icon blue">渠</i></div>
          <strong>{formatCount(rows.length)}<small> 个</small></strong>
          <p>本周期产生销售净额的{dimensionLabel}</p>
        </article>
        <article className="channel-kpi-card">
          <div><span>头部{dimensionLabel}</span><i className="channel-kpi-icon purple">冠</i></div>
          <strong>{formatCurrencyFromCents(topChannel.netSalesCents)}</strong>
          <p title={topChannel.name}>{topChannel.name || "未分类"} · 占比 {formatRate(topChannel.shareRate)}</p>
        </article>
        <article className="channel-kpi-card">
          <div><span>Top 3 集中度</span><i className="channel-kpi-icon orange">集</i></div>
          <strong>{formatRate(topThreeShare)}</strong>
          <p>{concentrationLabel} · 按销售净额计算</p>
        </article>
        <article className="channel-kpi-card">
          <div><span>毛利表现最佳</span><i className="channel-kpi-icon green">利</i></div>
          <strong>{formatRate(marginLeader.grossMarginRate)}</strong>
          <p title={marginLeader.name}>{marginLeader.name || "未分类"} · 综合 {formatRate(current.grossMarginRate)}</p>
        </article>
      </section>

      <section className="channel-analysis-grid">
        <article className="panel channel-ranking-panel">
          <SectionHeader title={`${dimensionLabel}贡献排行`} note="销售净额、占比与毛利率综合查看" />
          <div className="channel-ranking-list">
            {rows.slice(0, 8).map((item, index) => (
              <div className="channel-ranking-row" key={item.name}>
                <span className={`channel-rank-number ${index < 3 ? `top-${index + 1}` : ""}`}>{index + 1}</span>
                <div className="channel-ranking-main">
                  <div><strong title={item.name}>{item.name || "未分类"}</strong><small>{formatCurrencyFromCents(item.netSalesCents)} · 占比 {formatRate(item.shareRate)} · 净销售同比 {formatNetSalesYearOverYear(item.salesYearOverYearRate)}</small></div>
                  <span><i style={{ width: `${Math.max(2, Math.max(0, item.netSalesCents) / maxSales * 100)}%` }} /></span>
                </div>
                <div className="channel-ranking-margin"><small>毛利率</small><strong className={item.grossMarginRate < current.grossMarginRate ? "orange-text" : "green-text"}>{formatRate(item.grossMarginRate)}</strong></div>
              </div>
            ))}
          </div>
        </article>

        <article className="panel channel-insight-panel">
          <SectionHeader title="经营洞察" note="基于当前周期自动识别" />
          <div className="channel-insight-list">
            <article>
              <span className="insight-badge blue">集中度</span>
              <div><strong>{concentrationLabel}</strong><p>Top 3 {dimensionLabel}贡献 {formatRate(topThreeShare)} 的销售净额。</p></div>
            </article>
            <article>
              <span className="insight-badge green">利润</span>
              <div><strong title={marginLeader.name}>{marginLeader.name || "未分类"}</strong><p>毛利率 {formatRate(marginLeader.grossMarginRate)}，高于综合水平 {formatRate(marginLeader.grossMarginRate - current.grossMarginRate)}。</p></div>
            </article>
            <article>
              <span className="insight-badge orange">退货</span>
              <div><strong title={refundLeader.name}>{refundLeader.name || "未分类"}</strong><p>退货率 {formatRate(refundLeaderRate)}，为当前{dimensionLabel}中的最高值。</p></div>
            </article>
          </div>
          <div className="channel-benchmark">
            <div><span>综合毛利率</span><strong>{formatRate(current.grossMarginRate)}</strong></div>
            <div><span>综合退货率</span><strong>{formatRate(current.refundRate)}</strong></div>
            <div><span>订单总量</span><strong>{formatCount(current.orderCount)}</strong></div>
          </div>
        </article>
      </section>

      <section className="panel table-panel channel-detail-panel">
        <div className="table-toolbar">
          <div><h2>{dimensionLabel}经营明细</h2><p>按销售净额从高到低排列，数据随顶部统计周期同步更新</p></div>
          <span className="soft-tag">共 {formatCount(rows.length)} 个{dimensionLabel}</span>
        </div>
        <div className="data-table-wrap">
          <table className="data-table channel-data-table">
            <thead><tr><th>排名</th><th>{dimensionLabel}</th><th>销售额（GMV）</th><th>销售净额</th><th>净额占比</th><th>净销售同比</th><th>订单毛利</th><th>毛利率</th><th>订单量</th><th>退货率</th><th>经营状态</th></tr></thead>
            <tbody>{rows.map((item, index) => {
              const refundRate = item.grossSalesCents === 0 ? 0 : item.refundAmountCents / item.grossSalesCents;
              const needsAttention = item.grossMarginRate < current.grossMarginRate - .05 || refundRate > current.refundRate + .03;
              const isCore = index < 3 && item.shareRate >= .1;
              const statusText = needsAttention ? "需要关注" : isCore ? "核心渠道" : "经营稳健";
              const statusTone = needsAttention ? "warning" : "success";
              return <tr key={item.name}>
                <td><span className={`table-rank ${index < 3 ? `top-${index + 1}` : ""}`}>{index + 1}</span></td>
                <td><div className="channel-name-cell"><span>{(item.name || "未").slice(0, 1)}</span><strong title={item.name}>{item.name || "未分类"}</strong></div></td>
                <td>{formatCurrencyFromCents(item.grossSalesCents)}</td>
                 <td><strong>{formatCurrencyFromCents(item.netSalesCents)}</strong></td>
                 <td><div className="share-cell"><strong>{formatRate(item.shareRate)}</strong><span><i style={{ width: `${Math.max(0, Math.min(100, rateAsPercent(item.shareRate)))}%` }} /></span></div></td>
                 <td className={netSalesYearOverYearTone(item.salesYearOverYearRate)}>{formatNetSalesYearOverYear(item.salesYearOverYearRate)}</td>
                 <td>{formatCurrencyFromCents(item.grossProfitCents)}</td>
                <td className={item.grossMarginRate < current.grossMarginRate ? "orange-text" : "green-text"}><strong>{formatRate(item.grossMarginRate)}</strong></td>
                <td>{formatCount(item.orderCount)}</td>
                <td className={refundRate > current.refundRate ? "orange-text" : ""}>{formatRate(refundRate)}</td>
                <td><span className={`status status-${statusTone}`}><Dot tone={statusTone === "warning" ? "orange" : "green"} />{statusText}</span></td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      </section>
    </>
  );
}

type TrendMetric = "netSales" | "netQuantity" | "grossMargin";
type TrendGranularity = "day" | "week" | "month";
type ProductTrendPoint = { key: string; label: string; netSalesCents: number; netQuantity: number; grossProfitCents: number; grossMarginRate: number };

const trendMetricMeta: Record<TrendMetric, { label: string; color: string }> = {
  netSales: { label: "净销售额", color: "#4776e6" },
  netQuantity: { label: "净销量", color: "#27a978" },
  grossMargin: { label: "大毛利率", color: "#8167d9" },
};

function aggregateProductTrend(daily: Array<{ date: string } & SalesStats>, granularity: TrendGranularity): ProductTrendPoint[] {
  const buckets = new Map<string, Omit<ProductTrendPoint, "grossMarginRate">>();
  for (const item of daily) {
    let key = item.date;
    let label = item.date.slice(5);
    if (granularity === "week") {
      const date = new Date(`${item.date}T00:00:00Z`);
      const weekDay = date.getUTCDay();
      date.setUTCDate(date.getUTCDate() + (weekDay === 0 ? -6 : 1 - weekDay));
      key = date.toISOString().slice(0, 10);
      label = `${key.slice(5)}周`;
    } else if (granularity === "month") {
      key = item.date.slice(0, 7);
      label = key;
    }
    const current = buckets.get(key) ?? { key, label, netSalesCents: 0, netQuantity: 0, grossProfitCents: 0 };
    current.netSalesCents += item.netSalesCents;
    current.netQuantity += item.netQuantity;
    current.grossProfitCents += item.grossProfitCents;
    buckets.set(key, current);
  }
  return [...buckets.values()].sort((left, right) => left.key.localeCompare(right.key)).map((item) => ({
    ...item,
    grossMarginRate: item.netSalesCents === 0 ? 0 : item.grossProfitCents / item.netSalesCents,
  }));
}

function ProductSalesTrend({ daily, selectedProductCount }: { daily: Array<{ date: string } & SalesStats>; selectedProductCount: number }) {
  const [granularity, setGranularity] = useState<TrendGranularity>("day");
  const [selectedMetrics, setSelectedMetrics] = useState<TrendMetric[]>(["netSales", "netQuantity", "grossMargin"]);
  const [hoveredPointIndex, setHoveredPointIndex] = useState<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const points = useMemo(() => aggregateProductTrend(daily, granularity), [daily, granularity]);
  const activePointIndex = points.length === 0 ? null : Math.min(hoveredPointIndex ?? points.length - 1, points.length - 1);
  const activePoint = activePointIndex === null ? null : points[activePointIndex];
  const totals = useMemo(() => {
    const netSalesCents = points.reduce((sum, item) => sum + item.netSalesCents, 0);
    const netQuantity = points.reduce((sum, item) => sum + item.netQuantity, 0);
    const grossProfitCents = points.reduce((sum, item) => sum + item.grossProfitCents, 0);
    return { netSalesCents, netQuantity, grossMarginRate: netSalesCents === 0 ? 0 : grossProfitCents / netSalesCents };
  }, [points]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const container = canvas.parentElement;
    if (!container) return;
    const draw = () => {
      const width = Math.max(320, Math.floor(container.getBoundingClientRect().width));
      const height = 300;
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      const plot = { left: 34, right: width - 18, top: 18, bottom: height - 35 };
      context.lineWidth = 1;
      context.font = "10px sans-serif";
      context.fillStyle = "#94a0b1";
      context.strokeStyle = "#edf0f4";
      for (let index = 0; index <= 4; index += 1) {
        const y = plot.top + (plot.bottom - plot.top) * index / 4;
        context.beginPath(); context.moveTo(plot.left, y); context.lineTo(plot.right, y); context.stroke();
      }
      if (points.length === 0 || selectedMetrics.length === 0) return;
      const xFor = (index: number) => points.length === 1 ? (plot.left + plot.right) / 2 : plot.left + (plot.right - plot.left) * index / (points.length - 1);
      const metricValue = (point: ProductTrendPoint, metric: TrendMetric) => metric === "netSales" ? point.netSalesCents / 100 : metric === "netQuantity" ? point.netQuantity : point.grossMarginRate * 100;
      const showPointLabels = points.length <= 12;
      for (const [metricIndex, metric] of selectedMetrics.entries()) {
        const values = points.map((point) => metricValue(point, metric));
        const minimum = Math.min(0, ...values);
        const maximum = Math.max(0, ...values);
        const span = maximum - minimum || 1;
        context.strokeStyle = trendMetricMeta[metric].color;
        context.lineWidth = 2.4;
        context.lineJoin = "round";
        context.lineCap = "round";
        context.beginPath();
        values.forEach((value, index) => {
          const x = xFor(index);
          const y = plot.bottom - (value - minimum) / span * (plot.bottom - plot.top);
          if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
        });
        context.stroke();
        values.forEach((value, index) => {
          const x = xFor(index);
          const y = plot.bottom - (value - minimum) / span * (plot.bottom - plot.top);
          context.fillStyle = "#fff"; context.strokeStyle = trendMetricMeta[metric].color; context.lineWidth = 2;
          context.beginPath(); context.arc(x, y, 3, 0, Math.PI * 2); context.fill(); context.stroke();
          if (!showPointLabels) return;
          const point = points[index];
          const valueLabel = metric === "netSales" ? formatCurrencyFromCents(point.netSalesCents) : metric === "netQuantity" ? `${formatCount(point.netQuantity)}件` : formatRate(point.grossMarginRate);
          const labelY = Math.max(plot.top + 10, y - 10 - metricIndex * 12);
          context.save();
          context.font = "8px sans-serif";
          context.textAlign = "center";
          const labelWidth = context.measureText(valueLabel).width + 6;
          const labelX = Math.min(plot.right - labelWidth / 2, Math.max(plot.left + labelWidth / 2, x));
          context.fillStyle = "rgba(255,255,255,.9)";
          context.fillRect(labelX - labelWidth / 2, labelY - 8, labelWidth, 11);
          context.fillStyle = trendMetricMeta[metric].color;
          context.fillText(valueLabel, labelX, labelY);
          context.restore();
        });
      }
      if (activePointIndex !== null) {
        const activeX = xFor(activePointIndex);
        context.save();
        context.strokeStyle = "#b9c7dd";
        context.setLineDash([4, 4]);
        context.lineWidth = 1;
        context.beginPath(); context.moveTo(activeX, plot.top); context.lineTo(activeX, plot.bottom); context.stroke();
        context.restore();
      }
      const labelStep = Math.max(1, Math.ceil(points.length / 6));
      context.fillStyle = "#8793a4";
      context.textAlign = "center";
      points.forEach((point, index) => {
        if (index % labelStep !== 0 && index !== points.length - 1) return;
        context.fillText(point.label, xFor(index), height - 12);
      });
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(container);
    return () => observer.disconnect();
  }, [activePointIndex, points, selectedMetrics]);

  const handleTrendPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (points.length === 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const plotLeft = 34;
    const plotRight = Math.max(plotLeft + 1, bounds.width - 18);
    const progress = Math.min(1, Math.max(0, (event.clientX - bounds.left - plotLeft) / (plotRight - plotLeft)));
    setHoveredPointIndex(Math.round(progress * (points.length - 1)));
  };

  const toggleMetric = (metric: TrendMetric) => setSelectedMetrics((current) => current.includes(metric)
    ? current.length === 1 ? current : current.filter((item) => item !== metric)
    : [...current, metric]);
  const activePointMetricValue = (metric: TrendMetric) => {
    if (!activePoint) return "—";
    if (metric === "netSales") return formatCurrencyFromCents(activePoint.netSalesCents);
    if (metric === "netQuantity") return `${formatCount(activePoint.netQuantity)} 件`;
    return formatRate(activePoint.grossMarginRate);
  };

  return <section className="panel product-sales-trend-panel">
    <div className="product-trend-toolbar"><div><span className="eyebrow">PRODUCT SITUATION</span><h2>货品情况</h2><p>{selectedProductCount > 0 ? `已按 ${formatCount(selectedProductCount)} 个货品汇总` : "当前统计周期内全部货品的经营趋势"} · 净销售额、净销量与大毛利率可单独或组合查看。</p></div><div className="product-trend-controls"><div className="trend-metric-toggle" role="group" aria-label="趋势指标选择">{(Object.keys(trendMetricMeta) as TrendMetric[]).map((metric) => <button type="button" key={metric} className={selectedMetrics.includes(metric) ? "active" : ""} aria-pressed={selectedMetrics.includes(metric)} onClick={() => toggleMetric(metric)}><i style={{ background: trendMetricMeta[metric].color }} />{trendMetricMeta[metric].label}</button>)}</div><div className="segmented trend-granularity" role="group" aria-label="趋势时间维度"><button type="button" className={granularity === "day" ? "active" : ""} onClick={() => setGranularity("day")}>日维度</button><button type="button" className={granularity === "week" ? "active" : ""} onClick={() => setGranularity("week")}>周维度</button><button type="button" className={granularity === "month" ? "active" : ""} onClick={() => setGranularity("month")}>月维度</button></div></div></div>
    <div className="product-trend-summary"><div className={selectedMetrics.includes("netSales") ? "active" : ""}><span>净销售额</span><strong>{formatCurrencyFromCents(totals.netSalesCents)}</strong></div><div className={selectedMetrics.includes("netQuantity") ? "active" : ""}><span>净销量</span><strong>{formatCount(totals.netQuantity)} 件</strong></div><div className={selectedMetrics.includes("grossMargin") ? "active" : ""}><span>大毛利率</span><strong>{formatRate(totals.grossMarginRate)}</strong></div><small>{granularity === "day" ? "按日" : granularity === "week" ? "按自然周" : "按自然月"}汇总 · {formatCount(points.length)} 个数据点</small></div>
    <div className="product-trend-canvas"><canvas ref={canvasRef} role="img" aria-label={`货品销售趋势，当前显示${selectedMetrics.map((metric) => trendMetricMeta[metric].label).join("、")}`} onPointerMove={handleTrendPointerMove} onPointerLeave={() => setHoveredPointIndex(null)} />{points.length === 0 && <div className="trend-empty">当前统计周期没有可绘制的货品销售数据。</div>}</div>
    {activePoint && <div className="product-trend-detail-area"><div className="product-trend-data-card" aria-live="polite"><small>{activePoint.label} 对应数据</small><div>{(["netSales", "netQuantity", "grossMargin"] as TrendMetric[]).map((metric) => <span key={metric}><i className="trend-data-dot" style={{ background: trendMetricMeta[metric].color }} />{trendMetricMeta[metric].label}<strong>{activePointMetricValue(metric)}</strong></span>)}</div></div></div>}
    {points.length > 0 && <p className="trend-data-hint">移动至每个趋势节点，可查看当前日期的净销售额、净销量和大毛利率。</p>}
  </section>;
}

type SalesDistributionDimension = "shop" | "platform";
type SalesDistributionRow = { name: string; platform: string; shopCount: number; grossSalesCents: number; netSalesCents: number; grossProfitCents: number; refundAmountCents: number; netQuantity: number; refundRate: number };

function ShopSalesDistribution({ shops }: { shops: SalesChannel[] }) {
  const [dimension, setDimension] = useState<SalesDistributionDimension>("shop");
  const distributionRows = useMemo<SalesDistributionRow[]>(() => {
    if (dimension === "shop") return shops.map((shop) => ({ name: shop.name || "未分类", platform: shop.platform || "未分类平台", shopCount: 1, grossSalesCents: shop.grossSalesCents, netSalesCents: shop.netSalesCents, grossProfitCents: shop.grossProfitCents, refundAmountCents: shop.refundAmountCents, netQuantity: shop.netQuantity, refundRate: shop.refundRate }));
    const grouped = new Map<string, SalesDistributionRow>();
    shops.forEach((shop) => {
      const platform = shop.platform || "未分类平台";
      const row = grouped.get(platform) ?? { name: platform, platform, shopCount: 0, grossSalesCents: 0, netSalesCents: 0, grossProfitCents: 0, refundAmountCents: 0, netQuantity: 0, refundRate: 0 };
      row.shopCount += 1;
      row.grossSalesCents += shop.grossSalesCents;
      row.netSalesCents += shop.netSalesCents;
      row.grossProfitCents += shop.grossProfitCents;
      row.refundAmountCents += shop.refundAmountCents;
      row.netQuantity += shop.netQuantity;
      row.refundRate = row.grossSalesCents === 0 ? 0 : row.refundAmountCents / row.grossSalesCents;
      grouped.set(platform, row);
    });
    return [...grouped.values()];
  }, [dimension, shops]);
  const sortedRows = useMemo(() => [...distributionRows].sort((left, right) => right.netSalesCents - left.netSalesCents), [distributionRows]);
  const maxNetSales = Math.max(1, ...sortedRows.map((item) => Math.max(0, item.netSalesCents)));
  const label = dimension === "shop" ? "店铺" : "平台";
  const countLabel = dimension === "shop" ? "家店铺" : "个平台";
  return <section className="panel shop-sales-distribution"><div className="shop-distribution-header"><div><span className="eyebrow">SALES DISTRIBUTION</span><h2>销售分布</h2><p>可切换店铺或平台维度；净销量已按退货后的销量计算。</p></div><div className="shop-distribution-actions"><div className="segmented shop-distribution-dimension" role="group" aria-label="销售分布维度"><button type="button" className={dimension === "shop" ? "active" : ""} onClick={() => setDimension("shop")}>店铺维度</button><button type="button" className={dimension === "platform" ? "active" : ""} onClick={() => setDimension("platform")}>平台维度</button></div><span className="soft-tag">{formatCount(sortedRows.length)} {countLabel}</span></div></div><div className="shop-distribution-columns"><span>{label}</span><span>净销售额</span><span>净销量</span><span>退货率</span></div><div className="shop-distribution-list">{sortedRows.map((row) => <article key={`${dimension}-${row.platform}-${row.name}`}><div className="shop-distribution-name"><strong title={row.name}>{row.name}</strong><small>{dimension === "shop" ? row.platform : `${formatCount(row.shopCount)} 家店铺`}<i><b style={{ width: `${Math.max(2, Math.max(0, row.netSalesCents) / maxNetSales * 100)}%` }} /></i></small></div><strong>{formatCurrencyFromCents(row.netSalesCents)}</strong><span>{formatCount(row.netQuantity)}</span><em className={row.refundRate > .1 ? "orange-text" : ""}>{formatRate(row.refundRate)}</em></article>)}{sortedRows.length === 0 && <div className="shop-distribution-empty">当前筛选条件没有{label}销售记录。</div>}</div></section>;
}

function ProductPlatformSalesShare({ platforms }: { platforms: SalesChannel[] }) {
  const rows = useMemo(
    () => [...platforms].sort((left, right) => right.grossSalesCents - left.grossSalesCents),
    [platforms],
  );
  const totalSalesCents = rows.reduce((sum, item) => sum + item.grossSalesCents, 0);

  return <section className="panel product-platform-sales-share">
    <div className="product-platform-share-header"><div><span className="eyebrow">PLATFORM MIX</span><h2>平台销售占比</h2><p>按正向销售额计算；退货额在下方店铺销售分布中单独展示。</p></div><span className="soft-tag">{formatCount(rows.length)} 个平台</span></div>
    <div className="product-platform-share-columns"><span>平台</span><span>销售额</span><span>占比</span></div>
    <div className="product-platform-share-list">{rows.map((row) => {
      const shareRate = totalSalesCents > 0 ? row.grossSalesCents / totalSalesCents : 0;
      return <article key={`${row.platform}-${row.groupKey}`}><div><strong title={row.name}>{row.name || "未分类"}</strong><i><b style={{ width: `${Math.max(2, Math.min(100, shareRate * 100))}%` }} /></i></div><strong>{formatCurrencyFromCents(row.grossSalesCents)}</strong><span>{formatRate(shareRate)}</span></article>;
    })}{rows.length === 0 && <div className="product-platform-share-empty">当前规格在所选周期内没有平台销售记录。</div>}</div>
  </section>;
}

const formatFinanceBps = (value: number | null | undefined) => value === null || value === undefined ? "—" : `${(value / 100).toFixed(1)}%`;
const formatFinanceChange = (current: number, comparison: number | null | undefined, points = false) => {
  if (comparison === null || comparison === undefined) return "暂无可比数据";
  if (points) {
    const difference = (current - comparison) / 100;
    return `${difference >= 0 ? "+" : ""}${difference.toFixed(1)} 个百分点`;
  }
  if (comparison === 0) return "基期为 0";
  const rate = (current - comparison) / Math.abs(comparison);
  return `${rate >= 0 ? "+" : ""}${(rate * 100).toFixed(1)}%`;
};
const financeChangeTone = (current: number, comparison: number | null | undefined, inverse = false) => {
  if (comparison === null || comparison === undefined || current === comparison) return "muted-text";
  const positive = current > comparison;
  return positive !== inverse ? "green-text" : "red-text";
};
const financeMonthLabel = (month: string) => `${month.slice(0, 4)}年${Number(month.slice(5))}月`;
const formatFinanceWan = (value: number) => new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(value / 1_000_000);
const financeProgressWidth = (value: number | null) => `${Math.max(0, Math.min(100, (value ?? 0) * 100))}%`;

function FinanceTrendChart({ rows }: { rows: Array<{ month: string } & FinanceActualMetrics> }) {
  const width = Math.max(760, rows.length * 92);
  const height = 270;
  const plot = { left: 42, right: width - 24, top: 38, bottom: 216 };
  const valuesFor = (key: "netSalesCents" | "profitCents") => rows.map((row) => row[key]);
  const coordinateSeries = (key: "netSalesCents" | "profitCents") => {
    const values = valuesFor(key);
    const minimum = Math.min(0, ...values);
    const maximum = Math.max(0, ...values);
    const span = maximum - minimum || 1;
    return values.map((value, index) => ({
      x: rows.length <= 1 ? (plot.left + plot.right) / 2 : plot.left + (plot.right - plot.left) * index / (rows.length - 1),
      y: plot.bottom - (value - minimum) / span * (plot.bottom - plot.top),
      value,
    }));
  };
  const salesPoints = coordinateSeries("netSalesCents");
  const profitPoints = coordinateSeries("profitCents");
  const pointsText = (points: Array<{ x: number; y: number }>) => points.map((point) => `${point.x},${point.y}`).join(" ");
  return <div className="finance-trend-chart">
    <div className="finance-chart-legend"><span><i className="blue" />净销售额（万）</span><span><i className="green" />利润（万）</span></div>
    <svg viewBox={`0 0 ${width} ${height}`} style={{ minWidth: `${width}px` }} role="img" aria-label="月度净销售额与利润趋势，节点单位万元">
      {[0, 1, 2, 3, 4].map((index) => { const y = plot.top + (plot.bottom - plot.top) * index / 4; return <line key={index} x1={plot.left} x2={plot.right} y1={y} y2={y} className="finance-grid-line" />; })}
      {salesPoints.length > 0 && <polyline points={pointsText(salesPoints)} className="finance-line sales" />}
      {profitPoints.length > 0 && <polyline points={pointsText(profitPoints)} className="finance-line profit" />}
      {salesPoints.map((point, index) => <g key={`sales-${rows[index].month}`}><circle cx={point.x} cy={point.y} r="4" className="finance-point sales"><title>{`${financeMonthLabel(rows[index].month)} 净销售额 ${formatCurrencyFromCents(point.value)}`}</title></circle><text x={point.x} y={Math.max(16, point.y - 10)} textAnchor="middle" className="finance-node-label sales">{formatFinanceWan(point.value)}</text></g>)}
      {profitPoints.map((point, index) => <g key={`profit-${rows[index].month}`}><circle cx={point.x} cy={point.y} r="4" className="finance-point profit"><title>{`${financeMonthLabel(rows[index].month)} 利润 ${formatCurrencyFromCents(point.value)}`}</title></circle><text x={point.x} y={Math.min(234, point.y + 17)} textAnchor="middle" className="finance-node-label profit">{formatFinanceWan(point.value)}</text></g>)}
      {rows.map((row, index) => { const x = rows.length <= 1 ? (plot.left + plot.right) / 2 : plot.left + (plot.right - plot.left) * index / (rows.length - 1); return <text key={row.month} x={x} y="258" textAnchor="middle" className="finance-axis-label">{row.month.slice(2)}</text>; })}
    </svg>
  </div>;
}

function FinanceKpiCard({ label, value, targetLabel, progress, mom, yoy, tone, icon }: {
  label: string;
  value: string;
  targetLabel: string;
  progress: number | null;
  mom: { text: string; tone: string };
  yoy: { text: string; tone: string };
  tone: "blue" | "green" | "purple" | "orange" | "cyan" | "red";
  icon?: string;
}) {
  return <article className={`panel finance-kpi-card finance-kpi-${tone}`}>
    <div><span>{label}</span><i>{icon ?? (tone === "blue" ? "销" : tone === "green" ? "利" : tone === "purple" ? "毛" : "费")}</i></div>
    <strong>{value}</strong>
    <div className="finance-kpi-comparison"><small className={mom.tone}>环比 {mom.text}</small><small className={yoy.tone}>同比 {yoy.text}</small></div>
    <footer><span>{targetLabel}</span>{progress !== null && <b>{(progress * 100).toFixed(1)}%</b>}</footer>
    {progress !== null && <div className="finance-progress-track"><span style={{ width: financeProgressWidth(progress) }} /></div>}
  </article>;
}

type FinanceFilterOption = string | { value: string; label: string };

function FinanceMultiFilterSelect({ label, allLabel, options, selected, onChange }: {
  label: string;
  allLabel: string;
  options: FinanceFilterOption[];
  selected: string[] | null;
  onChange: (next: string[] | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const normalizedOptions = options.map((option) => typeof option === "string" ? { value: option, label: option } : option);
  const visibleOptions = normalizedOptions.filter((option) => option.label.toLowerCase().includes(search.trim().toLowerCase()));
  const isAll = selected === null;
  const selectedValues = selected ?? [];
  const summary = isAll ? allLabel : `已选 ${formatCount(selectedValues.length)} 个${label}`;
  const toggleOption = (value: string) => {
    if (isAll) {
      onChange([value]);
      return;
    }
    const next = selectedValues.includes(value) ? selectedValues.filter((item) => item !== value) : [...selectedValues, value];
    if (next.length === 0 || next.length === normalizedOptions.length) onChange(null);
    else onChange(next);
  };
  return <div className={`multi-filter-select finance-multi-filter ${open ? "open" : ""}`}>
    <button type="button" className="multi-filter-trigger" aria-label={`${label}多选`} aria-haspopup="listbox" aria-expanded={open} onClick={() => { setOpen((value) => !value); setSearch(""); }}><span title={summary}>{summary}</span><i>⌄</i></button>
    {open && <div className="multi-filter-menu" role="listbox" aria-label={`${label}多选`} aria-multiselectable="true">
      <div className="multi-filter-menu-head"><strong>{label}筛选</strong><button type="button" onClick={() => onChange(null)} disabled={isAll}>全选</button></div>
      <label className="multi-filter-search">⌕<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`搜索${label}`} aria-label={`搜索${label}`} /></label>
      <button type="button" className={isAll ? "selected" : ""} role="option" aria-selected={isAll} onClick={() => onChange(null)}><i>{isAll ? "✓" : ""}</i><span>{allLabel}</span></button>
      {visibleOptions.map((option) => { const checked = isAll || selectedValues.includes(option.value); return <button type="button" key={option.value} className={checked ? "selected" : ""} role="option" aria-selected={checked} onClick={() => toggleOption(option.value)}><i>{checked ? "✓" : ""}</i><span title={option.label}>{option.label}</span></button>; })}
      {visibleOptions.length === 0 && <p className="multi-filter-menu-empty">没有匹配项</p>}
    </div>}
  </div>;
}

type FinanceExpenseSortKey = "name" | "current" | "feeRateBps" | "previous" | "momRate" | "yearAgo" | "yearAgoFeeRateBps" | "yoyRate" | "abnormal";

function FinanceSortButton({ label, column, activeColumn, direction, onSort }: {
  label: string;
  column: FinanceExpenseSortKey;
  activeColumn: FinanceExpenseSortKey;
  direction: "asc" | "desc";
  onSort: (column: FinanceExpenseSortKey) => void;
}) {
  const active = column === activeColumn;
  return <button type="button" className={`finance-sort-button ${active ? "active" : ""}`} onClick={() => onSort(column)} title={active ? (direction === "desc" ? "当前从高到低，点击切换为从低到高" : "当前从低到高，点击切换为从高到低") : `按${label}排序`}><span>{label}</span><i aria-hidden="true">{active ? (direction === "desc" ? "↓" : "↑") : "⇅"}</i></button>;
}

function isoMonthsBetween(startDate: string, endDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || startDate > endDate) return [];
  const [startYear, startMonth] = startDate.split("-").map(Number);
  const [endYear, endMonth] = endDate.split("-").map(Number);
  const values: string[] = [];
  for (let year = startYear, month = startMonth; year < endYear || (year === endYear && month <= endMonth);) {
    values.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) { year += 1; month = 1; }
  }
  return values.slice(0, 24);
}

function salesOutletKeyToFinanceKey(value: string) {
  const [platform, name, ...rest] = value.split("\u001f");
  return platform && name && rest.length === 0 ? JSON.stringify([platform, name]) : null;
}

function FinanceAnalysisView({
  customStartDate,
  customEndDate,
  selectedPlatforms,
  selectedShopKeys,
}: {
  customStartDate: string;
  customEndDate: string;
  selectedPlatforms: string[];
  selectedShopKeys: string[];
}) {
  const globalMonths = useMemo(() => isoMonthsBetween(customStartDate, customEndDate), [customEndDate, customStartDate]);
  const [selectedMonths, setSelectedMonths] = useState<string[] | null>(globalMonths);
  const [expenseSearch, setExpenseSearch] = useState("");
  const [expenseSort, setExpenseSort] = useState<{ column: FinanceExpenseSortKey; direction: "asc" | "desc" }>({ column: "current", direction: "desc" });
  const [data, setData] = useState<FinanceAnalysisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    setSelectedMonths(globalMonths);
  }, [globalMonths]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const query = new URLSearchParams();
        if (selectedMonths === null) query.append("month", "*");
        else selectedMonths.forEach((month) => query.append("month", month));
        selectedPlatforms.forEach((platform) => query.append("platform", platform));
        selectedShopKeys.map(salesOutletKeyToFinanceKey).filter((value): value is string => value !== null).forEach((shop) => query.append("shop", shop));
        const queryText = query.toString();
        const response = await fetch(`/api/finance/analysis${queryText ? `?${queryText}` : ""}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json().catch(() => null) as FinanceAnalysisResponse | null;
        if (!response.ok || !payload) throw new Error(payload?.error || `财报分析读取失败（${response.status}）`);
        setData(payload);
      } catch (requestError) {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        setError(requestError instanceof Error ? requestError.message : "暂时无法读取财报分析");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [retryKey, selectedMonths, selectedPlatforms, selectedShopKeys]);

  if (loading && !data) return <section className="panel data-state" role="status"><span className="state-spinner" /><strong>正在生成财报分析</strong><p>正在汇总利润、目标进度和费用异常…</p></section>;
  if (error && !data) return <section className="panel data-state data-state-error" role="alert"><span className="state-symbol">!</span><strong>财报分析加载失败</strong><p>{error}</p><button className="secondary-button" onClick={() => setRetryKey((key) => key + 1)}>重新加载</button></section>;
  if (!data?.hasData || !data.current || !data.targets || !data.progress || !data.yearToDate) return <section className="panel data-state finance-empty-state"><span className="state-symbol">财</span><strong>还没有月度财报数据</strong><p>请到“数据导入”选择“月度财报”，上传志高事业部 .xls 文件；系统会自动识别月份并排除已导入月份。</p></section>;

  const current = data.current;
  const previous = data.previous;
  const yearAgo = data.yearAgo;
  const targets = data.targets.month;
  const progress = data.progress.month;
  const selectedPeriodName = data.selectedMonths && data.selectedMonths.length > 1
    ? `${financeMonthLabel(data.selectedMonths[0])}—${financeMonthLabel(data.selectedMonths.at(-1)!)}（${data.selectedMonths.length}个月）`
    : financeMonthLabel(data.selectedMonth!);
  const monthOptions = data.months.map((item) => ({ value: item.month, label: financeMonthLabel(item.month) }));
  const activeMonthSelection = selectedMonths;
  const normalizedExpenseSearch = expenseSearch.trim().toLocaleLowerCase("zh-CN");
  const expenseRows = data.expenses.filter((item) => {
    if (!normalizedExpenseSearch) return true;
    const displayName = item.name.replace(/^销售费用_/, "").replaceAll("_", " / ");
    return `${item.name} ${displayName}`.toLocaleLowerCase("zh-CN").includes(normalizedExpenseSearch);
  }).sort((left, right) => {
    if (expenseSort.column === "name") {
      const result = left.name.localeCompare(right.name, "zh-CN");
      return expenseSort.direction === "asc" ? result : -result;
    }
    const leftValue = left[expenseSort.column];
    const rightValue = right[expenseSort.column];
    if (leftValue === null && rightValue === null) return 0;
    if (leftValue === null) return 1;
    if (rightValue === null) return -1;
    const result = Number(leftValue) - Number(rightValue);
    return expenseSort.direction === "asc" ? result : -result;
  });
  const updateExpenseSort = (column: FinanceExpenseSortKey) => setExpenseSort((currentSort) => ({
    column,
    direction: currentSort.column === column ? (currentSort.direction === "desc" ? "asc" : "desc") : column === "name" ? "asc" : "desc",
  }));

  return <div className="finance-analysis-page">
    <section className="finance-analysis-hero">
      <div><span className="eyebrow">FINANCIAL PERFORMANCE</span><h2>财报经营分析</h2><p>以月度财报与经营目标为口径，追踪销售、利润、毛利和动态费用异常。</p></div>
      <div className="finance-period-control"><div className="finance-hero-filter-row"><div className="finance-filter-field"><span>分析月份</span><FinanceMultiFilterSelect label="月份" allLabel="全部月份" options={monthOptions} selected={activeMonthSelection} onChange={setSelectedMonths} /></div></div><small>平台与店铺继承销售分析公共筛选 · 全局周期 {customStartDate} 至 {customEndDate} · 财报按涵盖月份汇总 · 数据截止 {data.sync?.dataCutoffMonth}</small></div>
    </section>
    {error && <div className="inline-feedback warning"><strong>刷新提示</strong><span>{error}</span></div>}
    {data.selection?.truncated && <div className="inline-feedback warning" role="status"><strong>分析范围已设上限</strong><span>当前共有 {data.selection.availableMonthCount} 个可用月份，“全部月份”仅分析最近 {data.selection.months.length} 个月；如需更早月份，请在月份筛选中明确选择。</span></div>}
    {Boolean(data.targets.legacyCompatibility?.excluded) && <div className="inline-feedback warning" role="status"><strong>旧目标缺少平台身份</strong><span>{data.targets.legacyCompatibility?.reason} 当前有 {data.targets.legacyCompatibility?.excluded} 项未参与本次 KPI。</span></div>}
    <section className="finance-kpi-grid">
      <FinanceKpiCard label="净销售额" value={formatCurrencyFromCents(current.netSalesCents)} targetLabel={targets.salesTargetCents > 0 ? `目标 ${formatCurrencyFromCents(targets.salesTargetCents)}` : "尚未设置销售目标"} progress={progress.sales} mom={{ text: formatFinanceChange(current.netSalesCents, previous?.netSalesCents), tone: financeChangeTone(current.netSalesCents, previous?.netSalesCents) }} yoy={{ text: formatFinanceChange(current.netSalesCents, yearAgo?.netSalesCents), tone: financeChangeTone(current.netSalesCents, yearAgo?.netSalesCents) }} tone="blue" />
      <FinanceKpiCard label="利润" value={formatCurrencyFromCents(current.profitCents)} targetLabel={targets.profitTargetCents > 0 ? `目标 ${formatCurrencyFromCents(targets.profitTargetCents)}` : "尚未设置利润目标"} progress={progress.profit} mom={{ text: formatFinanceChange(current.profitCents, previous?.profitCents), tone: financeChangeTone(current.profitCents, previous?.profitCents) }} yoy={{ text: formatFinanceChange(current.profitCents, yearAgo?.profitCents), tone: financeChangeTone(current.profitCents, yearAgo?.profitCents) }} tone="green" />
      <FinanceKpiCard label="大毛利率" value={formatFinanceBps(current.grossMarginBps)} targetLabel="大毛利 ÷ 净销售额" progress={null} mom={{ text: formatFinanceChange(current.grossMarginBps, previous?.grossMarginBps, true), tone: financeChangeTone(current.grossMarginBps, previous?.grossMarginBps) }} yoy={{ text: formatFinanceChange(current.grossMarginBps, yearAgo?.grossMarginBps, true), tone: financeChangeTone(current.grossMarginBps, yearAgo?.grossMarginBps) }} tone="cyan" icon="大" />
      <FinanceKpiCard label="小毛利率" value={formatFinanceBps(current.smallMarginBps)} targetLabel={targets.smallMarginBps > 0 ? `目标 ${formatFinanceBps(targets.smallMarginBps)}` : "尚未设置小毛利率目标"} progress={targets.smallMarginBps > 0 ? current.smallMarginBps / targets.smallMarginBps : null} mom={{ text: formatFinanceChange(current.smallMarginBps, previous?.smallMarginBps, true), tone: financeChangeTone(current.smallMarginBps, previous?.smallMarginBps) }} yoy={{ text: formatFinanceChange(current.smallMarginBps, yearAgo?.smallMarginBps, true), tone: financeChangeTone(current.smallMarginBps, yearAgo?.smallMarginBps) }} tone="purple" />
      <FinanceKpiCard label="推广费占比" value={formatFinanceBps(current.promotionFeeRatioBps)} targetLabel={targets.promotionFeeRatioBps > 0 ? `目标不高于 ${formatFinanceBps(targets.promotionFeeRatioBps)}` : "尚未设置推广费占比目标"} progress={targets.promotionFeeRatioBps > 0 ? current.promotionFeeRatioBps / targets.promotionFeeRatioBps : null} mom={{ text: formatFinanceChange(current.promotionFeeRatioBps, previous?.promotionFeeRatioBps, true), tone: financeChangeTone(current.promotionFeeRatioBps, previous?.promotionFeeRatioBps, true) }} yoy={{ text: formatFinanceChange(current.promotionFeeRatioBps, yearAgo?.promotionFeeRatioBps, true), tone: financeChangeTone(current.promotionFeeRatioBps, yearAgo?.promotionFeeRatioBps, true) }} tone="orange" />
      <FinanceKpiCard label="退货率" value={formatFinanceBps(current.returnRateBps)} targetLabel={`退货额 ${formatCurrencyFromCents(current.returnAmountCents)}`} progress={null} mom={{ text: formatFinanceChange(current.returnRateBps, previous?.returnRateBps, true), tone: financeChangeTone(current.returnRateBps, previous?.returnRateBps, true) }} yoy={{ text: formatFinanceChange(current.returnRateBps, yearAgo?.returnRateBps, true), tone: financeChangeTone(current.returnRateBps, yearAgo?.returnRateBps, true) }} tone="red" icon="退" />
    </section>
    <section className="panel finance-profit-bridge" aria-label="利润结构">
      <div><span>大毛利</span><strong>{formatCurrencyFromCents(current.grossProfitCents)}</strong><small>大毛利率 {formatFinanceBps(current.grossMarginBps)}</small></div><i>−</i>
      <div><span>销售费用</span><strong>{formatCurrencyFromCents(current.sellingExpenseCents)}</strong><small>占净销售 {current.netSalesCents ? formatFinanceBps(Math.round(current.sellingExpenseCents / current.netSalesCents * 10_000)) : "—"}</small></div><i>=</i>
      <div><span>小毛利</span><strong>{formatCurrencyFromCents(current.smallProfitCents)}</strong><small>小毛利率 {formatFinanceBps(current.smallMarginBps)}</small></div><i>−</i>
      <div><span>其他费用</span><strong>{formatCurrencyFromCents(current.otherExpenseCents)}</strong><small>管理、财务及税费</small></div><i>=</i>
      <div className={current.profitCents < 0 ? "loss" : "profit"}><span>利润</span><strong>{formatCurrencyFromCents(current.profitCents)}</strong><small>利润率 {formatFinanceBps(current.profitMarginBps)}</small></div>
    </section>
    <section className="finance-overview-grid">
      <article className="panel finance-trend-panel"><div className="finance-panel-heading"><div><span className="eyebrow">MONTHLY TREND</span><h2>销售与利润趋势</h2><p>每个节点直接展示净销售额与利润，数值单位为万元。</p></div><span className="soft-tag">{data.timeline.length} 个月</span></div><FinanceTrendChart rows={data.timeline} /><div className="finance-ytd-summary"><span>本年累计净销售<strong>{formatCurrencyFromCents(data.yearToDate.netSalesCents)}</strong></span><span>本年累计利润<strong>{formatCurrencyFromCents(data.yearToDate.profitCents)}</strong></span><span>累计小毛利率<strong>{formatFinanceBps(data.yearToDate.smallMarginBps)}</strong></span></div></article>
      <article className="panel finance-anomaly-panel"><div className="finance-panel-heading"><div><span className="eyebrow">EXCEPTION WATCH</span><h2>{selectedPeriodName}异常雷达</h2><p>按利润、目标差距及费用环比阈值自动识别。</p></div><span className="soft-tag">{data.anomalies.length} 项</span></div><div className="finance-anomaly-list">{data.anomalies.map((item, index) => <div className={`finance-anomaly ${item.level}`} key={`${item.title}-${index}`}><i>{item.level === "critical" ? "!" : item.level === "warning" ? "△" : "i"}</i><span><strong>{item.title}</strong><small>{item.detail}</small></span></div>)}</div></article>
    </section>
    <section className="panel finance-expense-panel">
      <div className="finance-panel-heading"><div><span className="eyebrow">DYNAMIC EXPENSES</span><h2>费用同环比与异常点</h2><p>字段直接来自金蝶科目名称；同名科目已合并，新增科目会自动出现。</p></div><span className="soft-tag">{expenseSearch.trim() ? `显示 ${expenseRows.length} / ${data.expenses.length} 项` : `共 ${expenseRows.length} 项`}</span></div>
      <div className="finance-expense-filter-bar" aria-label="费用明细筛选"><div><strong>费用筛选</strong><small>月份与上方公共平台、店铺筛选同步更新所有指标</small></div><FinanceMultiFilterSelect label="月份" allLabel="全部月份" options={monthOptions} selected={activeMonthSelection} onChange={setSelectedMonths} /><button type="button" className="finance-filter-reset" onClick={() => setSelectedMonths(globalMonths)}>重置月份</button></div>
      <div className="data-table-wrap finance-expense-scroll">
        <table className="data-table finance-expense-table">
          <thead><tr>
            <th><div className="finance-expense-name-head"><FinanceSortButton label="费用科目" column="name" activeColumn={expenseSort.column} direction={expenseSort.direction} onSort={updateExpenseSort} /><label className="finance-expense-name-search"><span aria-hidden="true">⌕</span><input type="search" value={expenseSearch} onChange={(event) => setExpenseSearch(event.target.value)} placeholder="搜索费用名称" aria-label="搜索费用名称" /></label></div></th>
            <th><FinanceSortButton label={(data.selectedMonths?.length ?? 1) > 1 ? "所选期间金额" : "本月金额"} column="current" activeColumn={expenseSort.column} direction={expenseSort.direction} onSort={updateExpenseSort} /></th>
            <th><FinanceSortButton label="费用率" column="feeRateBps" activeColumn={expenseSort.column} direction={expenseSort.direction} onSort={updateExpenseSort} /></th>
            <th><FinanceSortButton label={(data.selectedMonths?.length ?? 1) > 1 ? "上期金额" : "上月金额"} column="previous" activeColumn={expenseSort.column} direction={expenseSort.direction} onSort={updateExpenseSort} /></th>
            <th><FinanceSortButton label="环比" column="momRate" activeColumn={expenseSort.column} direction={expenseSort.direction} onSort={updateExpenseSort} /></th>
            <th><FinanceSortButton label="去年同期" column="yearAgo" activeColumn={expenseSort.column} direction={expenseSort.direction} onSort={updateExpenseSort} /></th>
            <th><FinanceSortButton label="同期费率" column="yearAgoFeeRateBps" activeColumn={expenseSort.column} direction={expenseSort.direction} onSort={updateExpenseSort} /></th>
            <th><FinanceSortButton label="同比" column="yoyRate" activeColumn={expenseSort.column} direction={expenseSort.direction} onSort={updateExpenseSort} /></th>
            <th><FinanceSortButton label="状态" column="abnormal" activeColumn={expenseSort.column} direction={expenseSort.direction} onSort={updateExpenseSort} /></th>
          </tr></thead>
          <tbody>{expenseRows.map((item) => <tr key={item.name}>
            <td><strong title={item.name}>{item.name.replace(/^销售费用_/, "").replaceAll("_", " / ")}</strong></td>
            <td>{formatCurrencyFromCents(item.current)}</td>
            <td><strong className="finance-fee-rate">{formatFinanceBps(item.feeRateBps)}</strong></td>
            <td>{item.previous === null ? "—" : formatCurrencyFromCents(item.previous)}</td>
            <td className={item.momRate === null ? "muted-text" : item.momRate > 0 ? "orange-text" : "green-text"}>{item.momRate === null ? "—" : `${item.momRate >= 0 ? "+" : ""}${(item.momRate * 100).toFixed(1)}%`}</td>
            <td>{item.yearAgo === null ? "—" : formatCurrencyFromCents(item.yearAgo)}</td>
            <td><strong className="finance-fee-rate">{item.yearAgoFeeRateBps === null ? "—" : formatFinanceBps(item.yearAgoFeeRateBps)}</strong></td>
            <td>{item.yoyRate === null ? "—" : `${item.yoyRate >= 0 ? "+" : ""}${(item.yoyRate * 100).toFixed(1)}%`}</td>
            <td><span className={`status ${item.abnormal ? "status-warning" : "status-success"}`}><Dot tone={item.abnormal ? "orange" : "green"} />{item.abnormal ? "波动异常" : "正常"}</span></td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>
    <section className="panel finance-shop-panel"><div className="finance-panel-heading"><div><span className="eyebrow">SHOP TARGETS</span><h2>店铺目标进度</h2><p>店铺实际净销售、利润和小毛利率与所选月份目标同步对照。</p></div><span className="soft-tag">{data.shops.length} 家店铺</span></div><div className="finance-shop-filter-bar"><div><strong>店铺进度口径</strong><small>{selectedPeriodName}</small></div><FinanceMultiFilterSelect label="月份" allLabel="全部月份" options={monthOptions} selected={activeMonthSelection} onChange={setSelectedMonths} /></div><div className="data-table-wrap"><table className="data-table finance-shop-table"><thead><tr><th>店铺</th><th>负责人</th><th>净销售额</th><th>销售目标进度</th><th>利润</th><th>利润目标进度</th><th>小毛利率</th><th>推广费占比</th></tr></thead><tbody>{data.shops.map((shop) => <tr key={shop.key}><td><div className="finance-shop-name"><strong>{shop.name}</strong><small>{shop.groupName || "未分组"}</small></div></td><td>{shop.manager || "—"}</td><td>{formatCurrencyFromCents(shop.actual.netSalesCents)}</td><td><div className="table-progress"><span><i style={{ width: financeProgressWidth(shop.progress.sales) }} /></span><small>{shop.progress.sales === null ? "未设目标" : `${(shop.progress.sales * 100).toFixed(1)}%`}</small></div></td><td>{formatCurrencyFromCents(shop.actual.profitCents)}</td><td>{shop.progress.profit === null ? "未设目标" : `${(shop.progress.profit * 100).toFixed(1)}%`}</td><td>{formatFinanceBps(shop.actual.smallMarginBps)}</td><td>{formatFinanceBps(shop.actual.promotionFeeRatioBps)}</td></tr>)}</tbody></table></div></section>
  </div>;
}

type FinanceTargetFormState = {
  id: string;
  expectedVersion: number | null;
  periodType: "month" | "year" | "project";
  periodKey: string;
  shopKey: string;
  platform: string;
  shopName: string;
  category: string;
  manager: string;
  salesTarget: string;
  profitTarget: string;
  smallMargin: string;
  inventoryCleanupTarget: string;
  promotionFeeRatio: string;
  stagnantInventoryTarget: string;
};

const currentShanghaiMonth = () => new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 7);
const emptyFinanceTargetForm = (): FinanceTargetFormState => ({
  id: "",
  expectedVersion: null,
  periodType: "month",
  periodKey: currentShanghaiMonth(),
  shopKey: "",
  platform: "",
  shopName: "",
  category: "",
  manager: "",
  salesTarget: "",
  profitTarget: "",
  smallMargin: "",
  inventoryCleanupTarget: "",
  promotionFeeRatio: "",
  stagnantInventoryTarget: "",
});

function FinanceTargetSettingsView({ canManageTargets }: { canManageTargets: boolean }) {
  const [items, setItems] = useState<FinanceTarget[]>([]);
  const [options, setOptions] = useState<FinanceTargetOptions>({ shops: [], categories: [], projects: ["8系列"] });
  const [form, setForm] = useState<FinanceTargetFormState>(emptyFinanceTargetForm);
  const [targetPage, setTargetPage] = useState(1);
  const [targetPagination, setTargetPagination] = useState({ page: 1, pageSize: 100, total: 0, returned: 0, truncated: false });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingTargetId, setDeletingTargetId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const targetRequestGenerationRef = useRef(0);
  const targetRequestControllerRef = useRef<AbortController | null>(null);

  const loadTargets = useCallback(async () => {
    targetRequestControllerRef.current?.abort();
    const controller = new AbortController();
    targetRequestControllerRef.current = controller;
    const generation = ++targetRequestGenerationRef.current;
    setLoading(true);
    try {
      const response = await fetch(`/api/finance/targets?page=${targetPage}&pageSize=100`, { cache: "no-store", signal: controller.signal });
      const payload = await response.json().catch(() => null) as { items?: FinanceTarget[]; options?: FinanceTargetOptions; pagination?: { page: number; pageSize: number; total: number; returned: number; truncated: boolean }; error?: string } | null;
      if (!response.ok || !Array.isArray(payload?.items) || !payload?.options || !payload.pagination) throw new Error(payload?.error || "目标设置读取失败");
      if (controller.signal.aborted || generation !== targetRequestGenerationRef.current) return;
      setItems(payload.items);
      setOptions(payload.options);
      setTargetPagination(payload.pagination);
    } catch (error) {
      if (controller.signal.aborted || generation !== targetRequestGenerationRef.current) return;
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "目标设置读取失败" });
    } finally {
      if (!controller.signal.aborted && generation === targetRequestGenerationRef.current) {
        setLoading(false);
        if (targetRequestControllerRef.current === controller) targetRequestControllerRef.current = null;
      }
    }
  }, [targetPage]);

  useEffect(() => { void loadTargets(); return () => targetRequestControllerRef.current?.abort(); }, [loadTargets]);
  const patchForm = (patch: Partial<FinanceTargetFormState>) => setForm((current) => ({ ...current, ...patch }));
  const toCents = (value: string) => Number.isFinite(Number(value)) ? Math.max(0, Math.round(Number(value) * 100)) : 0;
  const toBps = (value: string) => Number.isFinite(Number(value)) ? Math.max(0, Math.round(Number(value) * 100)) : 0;
  const saveTarget = async () => {
    if (!canManageTargets || saving || deletingTargetId !== null) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/finance/targets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: form.id || undefined,
          expectedVersion: form.id ? form.expectedVersion : undefined,
          periodType: form.periodType,
          periodKey: form.periodKey,
          platform: form.platform,
          shopName: form.shopName,
          category: form.category,
          manager: form.manager,
          salesTargetCents: toCents(form.salesTarget),
          profitTargetCents: toCents(form.profitTarget),
          smallMarginBps: toBps(form.smallMargin),
          inventoryCleanupTargetCents: toCents(form.inventoryCleanupTarget),
          promotionFeeRatioBps: toBps(form.promotionFeeRatio),
          stagnantInventoryTargetCents: toCents(form.stagnantInventoryTarget),
        }),
      });
      const payload = await response.json().catch(() => null) as { item?: FinanceTarget; error?: string } | null;
      if (!response.ok || !payload?.item) {
        if (response.status === 409) {
          await loadTargets();
          throw new Error("目标已被其他人更新，列表已刷新；请重新进入编辑后再保存。");
        }
        throw new Error(payload?.error || "目标保存失败");
      }
      setMessage({ tone: "success", text: "目标已保存，财报分析进度已同步更新。" });
      setForm(emptyFinanceTargetForm());
      await loadTargets();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "目标保存失败" });
    } finally {
      setSaving(false);
    }
  };
  const editTarget = (item: FinanceTarget) => {
    if (!canManageTargets || saving || deletingTargetId !== null) return;
    setForm({
      id: item.id,
      expectedVersion: item.version,
      periodType: item.periodType,
      periodKey: item.periodKey,
      shopKey: item.platform && item.shopName ? JSON.stringify([item.platform, item.shopName]) : "",
      platform: item.platform,
      shopName: item.shopName,
      category: item.category,
      manager: item.manager,
      salesTarget: item.salesTargetCents ? String(item.salesTargetCents / 100) : "",
      profitTarget: item.profitTargetCents ? String(item.profitTargetCents / 100) : "",
      smallMargin: item.smallMarginBps ? String(item.smallMarginBps / 100) : "",
      inventoryCleanupTarget: item.inventoryCleanupTargetCents ? String(item.inventoryCleanupTargetCents / 100) : "",
      promotionFeeRatio: item.promotionFeeRatioBps ? String(item.promotionFeeRatioBps / 100) : "",
      stagnantInventoryTarget: item.stagnantInventoryTargetCents ? String(item.stagnantInventoryTargetCents / 100) : "",
    });
  };
  const removeTarget = async (item: FinanceTarget) => {
    if (!canManageTargets || saving || deletingTargetId !== null) return;
    const confirmed = window.confirm(`确认删除“${item.periodKey}”经营目标？此操作不可撤销。`);
    if (!confirmed) return;
    const providedReason = window.prompt("请输入删除原因（1—200 个字符）：", "");
    const reasonResult = validateFinanceTargetDeletionReason(providedReason);
    if (reasonResult.status === "cancelled") return;
    if (reasonResult.status === "invalid") {
      setMessage({ tone: "error", text: "删除原因必填，且长度必须为 1—200 个字符。" });
      return;
    }

    const query = new URLSearchParams({
      id: item.id,
      expectedVersion: String(item.version),
      reason: reasonResult.reason,
    });
    setDeletingTargetId(item.id);
    setMessage(null);
    try {
      const response = await fetch(`/api/finance/targets?${query.toString()}`, { method: "DELETE" });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) {
        if (response.status === 409) {
          await loadTargets();
          setMessage({ tone: "error", text: "目标已被其他人更新，列表已刷新；请核对最新内容后重试。" });
          return;
        }
        setMessage({ tone: "error", text: payload?.error || "目标删除失败" });
        return;
      }
      setMessage({ tone: "success", text: "目标已删除。" });
      if (items.length === 1 && targetPage > 1) setTargetPage((value) => value - 1);
      else await loadTargets();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "目标删除失败" });
    } finally {
      setDeletingTargetId(null);
    }
  };

  return <div className="finance-target-page">
    <section className="finance-analysis-hero target-hero"><div><span className="eyebrow">TARGET MANAGEMENT</span><h2>经营目标设置</h2><p>按月度或年度设置店铺/店铺+品类目标，并单独管理 8 系列呆滞库存项目。</p></div><span className="soft-tag">共 {targetPagination.total} 项</span></section>
    {message && <div className={`inline-feedback ${message.tone}`}><strong>{message.tone === "success" ? "操作成功" : "操作失败"}</strong><span>{message.text}</span></div>}
    {options.pagination?.shops.truncated && <div className="inline-feedback warning" role="status"><strong>店铺选项已设上限</strong><span>当前展示 {options.pagination.shops.returned} / {options.pagination.shops.total} 个平台店铺，请先在财报数据中核对目标店铺或缩小历史数据范围。</span></div>}
    {canManageTargets ? <section className="panel finance-target-form-panel">
      <div className="finance-panel-heading"><div><span className="eyebrow">{form.id ? "EDIT TARGET" : "NEW TARGET"}</span><h2>{form.id ? "编辑目标" : "新增目标"}</h2><p>金额单位为元，比率单位为百分比；同周期、同平台、同店铺和同品类只能保留一项，冲突时请刷新后编辑。</p></div>{form.id && <button className="secondary-button" onClick={() => setForm(emptyFinanceTargetForm())}>取消编辑</button>}</div>
      <div className="finance-target-period-tabs" role="group" aria-label="目标类型">{(["month", "year", "project"] as const).map((type) => <button type="button" key={type} className={form.periodType === type ? "active" : ""} onClick={() => patchForm({ periodType: type, periodKey: type === "month" ? currentShanghaiMonth() : type === "year" ? currentShanghaiMonth().slice(0, 4) : "8系列", shopKey: type === "project" ? "" : form.shopKey, platform: type === "project" ? "" : form.platform, shopName: type === "project" ? "" : form.shopName, category: type === "project" ? "" : form.category })}>{type === "month" ? "月度目标" : type === "year" ? "年度目标" : "项目目标"}</button>)}</div>
      <div className="finance-target-form-grid">
        <label><span>{form.periodType === "project" ? "项目名称" : "目标周期"}</span>{form.periodType === "month" ? <input type="month" value={form.periodKey} onChange={(event) => patchForm({ periodKey: event.target.value })} /> : form.periodType === "year" ? <input type="number" min="2020" max="2100" value={form.periodKey} onChange={(event) => patchForm({ periodKey: event.target.value })} /> : <input list="finance-project-options" value={form.periodKey} onChange={(event) => patchForm({ periodKey: event.target.value })} />}</label>
        {form.periodType !== "project" && <><label><span>平台 · 店铺</span><SearchableSelect value={form.shopKey} onChange={(value) => { const selected = options.shops.find((item) => item.key === value); patchForm({ shopKey: value, platform: selected?.platform ?? "", shopName: selected?.name ?? "" }); }} ariaLabel="经营目标平台与店铺" searchPlaceholder="搜索平台或店铺" options={options.shops.map((item) => ({ value: item.key, label: `${item.platform} · ${item.name}` }))} /></label><label><span>品类（可选）</span><input list="finance-category-options" value={form.category} onChange={(event) => patchForm({ category: event.target.value })} placeholder="留空表示整店" /></label><label><span>店长 / 负责人</span><input value={form.manager} onChange={(event) => patchForm({ manager: event.target.value })} placeholder="输入姓名" /></label></>}
        {form.periodType === "project" ? <label><span>呆滞库存目标（元）</span><input type="number" min="0" step="0.01" value={form.stagnantInventoryTarget} onChange={(event) => patchForm({ stagnantInventoryTarget: event.target.value })} /></label> : <><label><span>销售额目标（元）</span><input type="number" min="0" step="0.01" value={form.salesTarget} onChange={(event) => patchForm({ salesTarget: event.target.value })} /></label><label><span>利润目标（元）</span><input type="number" min="0" step="0.01" value={form.profitTarget} onChange={(event) => patchForm({ profitTarget: event.target.value })} /></label><label><span>小毛利率目标（%）</span><input type="number" min="0" step="0.01" value={form.smallMargin} onChange={(event) => patchForm({ smallMargin: event.target.value })} /></label><label><span>库存清理目标（元）</span><input type="number" min="0" step="0.01" value={form.inventoryCleanupTarget} onChange={(event) => patchForm({ inventoryCleanupTarget: event.target.value })} /></label><label><span>推广费占比目标（%）</span><input type="number" min="0" step="0.01" value={form.promotionFeeRatio} onChange={(event) => patchForm({ promotionFeeRatio: event.target.value })} /></label></>}
      </div>
      <datalist id="finance-category-options">{options.categories.map((item) => <option key={item} value={item} />)}</datalist><datalist id="finance-project-options">{options.projects.map((item) => <option key={item} value={item} />)}</datalist>
      <div className="finance-target-actions"><span>{form.periodType === "project" ? "项目目标独立统计呆滞库存清理进度" : "品类留空时按整店目标统计；平台与店铺必须成对选择"}</span><button type="button" className="primary-button" disabled={saving || (form.periodType !== "project" && !form.shopKey)} onClick={() => void saveTarget()}>{saving ? "保存中…" : form.id ? "保存修改" : "保存目标"}</button></div>
    </section> : <div className="inline-feedback warning" role="status"><strong>当前为只读模式</strong><span>仅管理员可新增、编辑或删除经营目标；你仍可查看全部目标并使用分页。</span></div>}
    <section className="panel finance-target-list-panel">
      <div className="finance-panel-heading"><div><span className="eyebrow">TARGET LIST</span><h2>已设置目标</h2><p>目标保存后立即参与财报分析中的月度、年度和店铺进度计算。</p></div><span className="soft-tag">本页 {targetPagination.returned} / 共 {targetPagination.total} 项</span></div>
      {loading ? <div className="table-state">正在读取目标…</div> : <>
        <div className="data-table-wrap"><table className="data-table finance-target-table"><thead><tr><th>类型 / 周期</th><th>店铺 / 品类</th><th>负责人</th><th>销售目标</th><th>利润目标</th><th>小毛利率</th><th>库存清理 / 呆滞目标</th><th>推广费占比</th><th>{canManageTargets ? "操作" : "权限"}</th></tr></thead><tbody>
          {items.map((item) => <tr key={item.id}><td><strong>{item.periodType === "month" ? "月度" : item.periodType === "year" ? "年度" : "项目"}</strong><small>{item.periodKey}</small></td><td><strong>{item.periodType === "project" ? item.periodKey : item.shopName}</strong><small>{item.periodType === "project" ? "呆滞库存" : `${item.platform || "旧目标 · 平台待确认"}${item.category ? ` · ${item.category}` : " · 整店"}`}</small></td><td>{item.manager || "—"}</td><td>{item.periodType === "project" ? "—" : formatCurrencyFromCents(item.salesTargetCents)}</td><td>{item.periodType === "project" ? "—" : formatCurrencyFromCents(item.profitTargetCents)}</td><td>{item.periodType === "project" ? "—" : formatFinanceBps(item.smallMarginBps)}</td><td>{formatCurrencyFromCents(item.periodType === "project" ? item.stagnantInventoryTargetCents : item.inventoryCleanupTargetCents)}</td><td>{item.periodType === "project" ? "—" : formatFinanceBps(item.promotionFeeRatioBps)}</td><td>{canManageTargets ? <div className="finance-target-row-actions"><button type="button" disabled={saving || deletingTargetId !== null} onClick={() => editTarget(item)}>编辑</button><button type="button" className="danger" disabled={saving || deletingTargetId !== null} onClick={() => void removeTarget(item)}>{deletingTargetId === item.id ? "删除中…" : "删除"}</button></div> : <span className="soft-text">只读</span>}</td></tr>)}
          {items.length === 0 && <tr><td colSpan={9}><div className="table-state">{canManageTargets ? "还没有目标，先在上方新增一项。" : "当前没有可查看的经营目标。"}</div></td></tr>}
        </tbody></table></div>
        {(targetPage > 1 || targetPagination.truncated) && <div className="customer-service-pagination"><button type="button" className="row-action" disabled={targetPage <= 1} onClick={() => setTargetPage((value) => value - 1)}>上一页</button><span>第 {targetPage} 页 · 每页最多 100 项</span><button type="button" className="row-action" disabled={!targetPagination.truncated} onClick={() => setTargetPage((value) => value + 1)}>下一页</button></div>}
      </>}
    </section>
  </div>;
}

function SalesView({ range, customStartDate, customEndDate, currentUser, moduleView, onModuleViewChange }: { range: SalesRangeLabel; customStartDate: string; customEndDate: string; currentUser: CurrentUser | null; moduleView: SalesTab; onModuleViewChange: (view: SalesTab) => void }) {
  const apiRange = salesRangeMap[range];
  const activeTab = moduleView;
  const canManageTargets = canManageFinanceTargets(currentUser);
  const [summary, setSummary] = useState<SalesSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [filters, setFilters] = useState<SalesSharedFilters>(readSalesSharedFilters);
  const debouncedProductQuery = useDebouncedValue(filters.productQuery);
  const productQueries = useMemo(() => parseProductQueries(debouncedProductQuery), [debouncedProductQuery]);

  const updateFilters = useCallback((next: SalesSharedFilters) => {
    setFilters(next);
    writeSalesSharedFilters(next);
  }, []);

  const changeSalesTab = useCallback((tab: SalesTab) => {
    onModuleViewChange(tab);
  }, [onModuleViewChange]);

  useEffect(() => {
    const onPopState = () => setFilters(readSalesSharedFilters());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      await Promise.resolve();
      if (controller.signal.aborted) return;
      setLoading(true);
      setError("");

      try {
        const query = new URLSearchParams({ range: apiRange });
        if (apiRange === "custom") {
          query.set("startDate", customStartDate);
          query.set("endDate", customEndDate);
        }
        productQueries.forEach((productQuery) => query.append("productQuery", productQuery));
        filters.platforms.forEach((platform) => query.append("platform", platform));
        filters.outletKeys.forEach((shopKey) => query.append("outlet", shopKey));
        filters.categories.forEach((category) => query.append("category", category));
        const response = await fetch(`/api/sales/summary?${query.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => null) as (SalesSummaryResponse & { message?: string; error?: string }) | null;
        if (!response.ok) throw new Error(payload?.message || payload?.error || `销售汇总读取失败（${response.status}）`);
        if (!payload?.current || !Array.isArray(payload.channels)) throw new Error("销售汇总响应格式不完整");
        setSummary(payload);
      } catch (requestError) {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        setError(requestError instanceof Error ? requestError.message : "暂时无法读取销售汇总");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [apiRange, customEndDate, customStartDate, filters.categories, filters.outletKeys, filters.platforms, productQueries, retryKey]);

  const current = summary?.current;
  const previous = summary?.previous;
  const yearAgo = summary?.yearAgo;
  const channels = useMemo(() => summary?.channels ?? [], [summary?.channels]);
  const salesChannels = summary?.shops?.length ? summary.shops : channels;
  const platforms = summary?.platforms?.length ? summary.platforms : channels;
  const salesFilterOptions = summary?.filterOptions ?? { platforms: [], shops: [], categories: [] };
  const hasData = Boolean(current && (current.lineCount > 0 || current.orderCount > 0 || current.grossSalesCents !== 0 || current.netSalesCents !== 0));
  const donutBackground = useMemo(() => {
    if (!channels.length) return "#eef1f5";
    let cursor = 0;
    const stops = channels.map((channel, index) => {
      const start = cursor;
      cursor += Math.max(0, rateAsPercent(channel.shareRate));
      return `${channelColors[index % channelColors.length]} ${start}% ${Math.min(cursor, 100)}%`;
    });
    if (cursor < 100) stops.push(`#eef1f5 ${cursor}% 100%`);
    return `conic-gradient(${stops.join(",")})`;
  }, [channels]);
  const salesSubnav = <SalesSubnav active={activeTab} onChange={changeSalesTab} />;
  const sharedFilterBar = (capabilities?: { categories?: boolean; product?: boolean }) => <SalesFilterBar filters={filters} options={salesFilterOptions} capabilities={capabilities} updating={loading} scopeLabel={activeTab === "finance" ? "财报分析" : activeTab === "category" ? "品类分析" : activeTab === "channel" ? "渠道分析" : "销售总览"} onChange={updateFilters} />;

  if (activeTab === "category") return <>{salesSubnav}{sharedFilterBar()}<SalesCategoryView startDate={customStartDate} endDate={customEndDate} filters={filters} onFiltersChange={updateFilters} /></>;
  if (activeTab === "finance") return <>{salesSubnav}{sharedFilterBar({ categories: false, product: false })}<FinanceAnalysisView customStartDate={customStartDate} customEndDate={customEndDate} selectedPlatforms={filters.platforms} selectedShopKeys={filters.outletKeys} /></>;
  if (activeTab === "targets") return <>{salesSubnav}<FinanceTargetSettingsView canManageTargets={canManageTargets} /></>;

  if (loading && !summary) {
    return (
      <>{salesSubnav}<section className="panel data-state sales-data-state" role="status" aria-live="polite">
          <span className="state-spinner" aria-hidden="true" />
          <strong>正在读取{range}销售数据</strong>
          <p>正在汇总销售额、毛利与渠道构成…</p>
        </section></>
    );
  }

  if (error) {
    return (
      <>{salesSubnav}<section className="panel data-state sales-data-state data-state-error" role="alert">
          <span className="state-symbol" aria-hidden="true">!</span>
          <strong>销售数据加载失败</strong>
          <p>{error}</p>
          <button className="secondary-button" onClick={() => setRetryKey((key) => key + 1)}>重新加载</button>
        </section></>
    );
  }

  if (!hasData || !current) {
    return (
      <>{salesSubnav}<section className="panel data-state sales-data-state">
          <span className="state-symbol" aria-hidden="true">∅</span>
          <strong>{range}暂无销售数据</strong>
          <p>{productQueries.length > 0 ? "当前货品编码或名称在该统计周期内没有销售记录，可修改或清空下方查询。" : "请先在“数据导入”中上传吉客云销售单明细账，或切换其他统计周期。"}</p>
        </section>{sharedFilterBar()}</>
    );
  }

  const rangeNote = summary?.startDate && summary?.endDate
    ? `${summary.startDate} 至 ${summary.endDate}`
    : `${range}实时汇总`;

  return (
    <>
      {salesSubnav}
      <div className="sales-period-note">
        <span><Dot tone="green" />已加载真实明细</span>
        <strong>{rangeNote}</strong>
        {summary?.latestBatch?.fileName && <small>最近批次：{summary.latestBatch.fileName}</small>}
      </div>
      {sharedFilterBar()}
      {activeTab === "channel" ? (
        <ChannelAnalysisView channels={salesChannels} platforms={platforms} current={current} />
      ) : <>
        <section className="metrics-grid sales-metrics-grid">
          <MetricCard label="销售额（GMV）" value={formatCurrencyFromCents(current.grossSalesCents)} change={formatChange(current.grossSalesCents, previous?.grossSalesCents)} hint={comparisonHint(current.grossSalesCents, previous?.grossSalesCents, yearAgo?.grossSalesCents)} tone="blue" />
          <MetricCard label="销售净额" value={formatCurrencyFromCents(current.netSalesCents)} change={formatChange(current.netSalesCents, previous?.netSalesCents)} hint={comparisonHint(current.netSalesCents, previous?.netSalesCents, yearAgo?.netSalesCents)} tone="green" />
          <MetricCard label="订单毛利" value={formatCurrencyFromCents(current.grossProfitCents)} change={formatChange(current.grossProfitCents, previous?.grossProfitCents)} hint={comparisonHint(current.grossProfitCents, previous?.grossProfitCents, yearAgo?.grossProfitCents)} tone="purple" />
          <MetricCard label="退货金额" value={formatCurrencyFromCents(current.refundAmountCents)} change={formatChange(current.refundAmountCents, previous?.refundAmountCents)} hint={comparisonHint(current.refundAmountCents, previous?.refundAmountCents, yearAgo?.refundAmountCents)} tone="orange" />
          <MetricCard label="净销量" value={formatCount(current.netQuantity)} change={formatChange(current.netQuantity, previous?.netQuantity)} hint={comparisonHint(current.netQuantity, previous?.netQuantity, yearAgo?.netQuantity)} tone="blue" />
          <MetricCard label="客单价" value={formatCurrencyFromCents(current.averageOrderValueCents)} change={formatChange(current.averageOrderValueCents, previous?.averageOrderValueCents)} hint={comparisonHint(current.averageOrderValueCents, previous?.averageOrderValueCents, yearAgo?.averageOrderValueCents)} tone="purple" />
          <MetricCard label="退货率" value={formatRate(current.refundRate)} change={formatChange(rateAsPercent(current.refundRate), rateAsPercent(previous?.refundRate))} hint={comparisonHint(rateAsPercent(current.refundRate), rateAsPercent(previous?.refundRate), rateAsPercent(yearAgo?.refundRate))} tone="orange" />
          <MetricCard label="大毛利率" value={formatRate(current.grossMarginRate)} change={formatChange(rateAsPercent(current.grossMarginRate), rateAsPercent(previous?.grossMarginRate))} hint={comparisonHint(rateAsPercent(current.grossMarginRate), rateAsPercent(previous?.grossMarginRate), rateAsPercent(yearAgo?.grossMarginRate))} tone="green" />
        </section>
        <section className="split-panels">
          <article className="panel">
            <SectionHeader title="渠道销售构成" note="按销售净额统计渠道占比，并展示各渠道净销售同比" />
            <div className="channel-chart">
              <div className="donut" style={{ background: donutBackground }}><div><strong>{(current.netSalesCents / 1000000).toFixed(1)}</strong><small>万元净额</small></div></div>
              <div className="channel-list channel-sales-list"><div className="channel-list-head"><span>渠道</span><strong>净销售额</strong><em>占比</em><small>净销售同比</small></div>{channels.map((item, index) => <div key={item.name}><span><Dot tone={channelTones[index % channelTones.length]} />{item.name || "未分类"}</span><strong>{formatCurrencyFromCents(item.netSalesCents)}</strong><em>{formatRate(item.shareRate)}</em><small className={netSalesYearOverYearTone(item.salesYearOverYearRate)}>{formatNetSalesYearOverYear(item.salesYearOverYearRate)}</small></div>)}</div>
            </div>
          </article>
          <article className="panel">
            <SectionHeader title="渠道毛利表现" note="平台大毛利率、净销售同比与退货率" />
            <div className="progress-list">{channels.map((item, index) => {
              const margin = Math.max(0, Math.min(rateAsPercent(item.grossMarginRate), 100));
              const tone = channelTones[index % channelTones.length];
              return <div key={item.name}><div><span>{item.name || "未分类"}<small>净销售同比 {formatNetSalesYearOverYear(item.salesYearOverYearRate)} · 退货率 {formatRate(item.refundRate)}</small></span><strong className="platform-margin"><b>{formatRate(item.grossMarginRate)}</b><small>大毛利率</small></strong></div><span className="progress-track"><i className={`bg-${tone}`} style={{ width: `${margin}%` }} /></span></div>;
            })}</div>
            <div className="insight-card"><span>数据口径</span><p>渠道构成、毛利率与订单行数均来自当前统计周期内已成功导入的吉客云销售明细。</p></div>
          </article>
        </section>
        <section className="product-situation-grid"><ProductSalesTrend daily={summary?.daily ?? []} selectedProductCount={productQueries.length} /><ShopSalesDistribution shops={summary?.outlets ?? []} /></section>
      </>}
    </>
  );
}

type InventoryTab = ModuleViewKey<"inventory">;

const inventoryStatusMeta: Record<InventoryHealthStatus, { label: string; tone: string }> = {
  urgent: { label: "紧急补货", tone: "danger" },
  replenish: { label: "建议补货", tone: "warning" },
  healthy: { label: "库存健康", tone: "success" },
  slow: { label: "低周转", tone: "purple" },
  stagnant: { label: "呆滞风险", tone: "danger" },
  no_sales: { label: "无销量数据", tone: "gray" },
};

const inventoryAgeStatusMeta: Record<InventoryAgeStatus, { label: string; tone: string }> = {
  healthy: { label: "库龄健康", tone: "success" },
  aged: { label: "高库龄", tone: "warning" },
  slow: { label: "低动销", tone: "purple" },
  stagnant: { label: "滞销清理", tone: "danger" },
  no_stock: { label: "无可用库存", tone: "gray" },
};

function InventoryKpiCard({
  label,
  value,
  note,
  tone,
  icon,
}: {
  label: string;
  value: string;
  note: string;
  tone: "blue" | "green" | "orange" | "purple";
  icon: string;
}) {
  return (
    <article className="inventory-kpi-card">
      <div><span>{label}</span><i className={`inventory-kpi-icon ${tone}`}>{icon}</i></div>
      <strong>{value}</strong>
      <p>{note}</p>
    </article>
  );
}

function InventoryView({ customStartDate, customEndDate, currentUser, moduleView, onModuleViewChange }: { customStartDate: string; customEndDate: string; currentUser: CurrentUser | null; moduleView: InventoryTab; onModuleViewChange: (view: InventoryTab) => void }) {
  const syncInputRef = useRef<HTMLInputElement>(null);
  const activeTab = moduleView;
  const [overview, setOverview] = useState<InventoryOverviewResponse | null>(null);
  const [ageAnalysis, setAgeAnalysis] = useState<InventoryAgeAnalysisResponse | null>(null);
  const [ageLoading, setAgeLoading] = useState(false);
  const [ageError, setAgeError] = useState("");
  const [ageRetryKey, setAgeRetryKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [syncStage, setSyncStage] = useState("");
  const [snapshotDate, setSnapshotDate] = useState(shanghaiIsoToday);
  const [syncFeedback, setSyncFeedback] = useState<{ tone: "success" | "warning" | "error"; title: string; message: string } | null>(null);
  const [query, setQuery] = useState("");
  const [warehouseFilters, setWarehouseFilters] = useState<string[]>([]);
  const [typeFilters, setTypeFilters] = useState<string[]>([]);
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [planActionId, setPlanActionId] = useState("");
  const [planQuantities, setPlanQuantities] = useState<Record<string, number>>({});
  const [overviewPage, setOverviewPage] = useState(1);
  const [agePage, setAgePage] = useState(1);
  const [planPage, setPlanPage] = useState(1);
  const [planStatus, setPlanStatus] = useState<"" | ReplenishmentPlanItem["status"]>("");
  const overviewGenerationRef = useRef(0);
  const overviewControllerRef = useRef<AbortController | null>(null);
  const ageGenerationRef = useRef(0);
  const ageControllerRef = useRef<AbortController | null>(null);
  const debouncedInventoryQuery = useDebouncedValue(query);
  const canManageInventory = currentUser?.role === "admin";

  const loadOverview = useCallback(async () => {
    const generation = overviewGenerationRef.current + 1;
    overviewGenerationRef.current = generation;
    overviewControllerRef.current?.abort();
    const controller = new AbortController();
    overviewControllerRef.current = controller;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ page: String(overviewPage), pageSize: "50", startDate: customStartDate, endDate: customEndDate });
      params.set("planPage", String(planPage));
      params.set("planPageSize", "50");
      if (planStatus) params.set("planStatus", planStatus);
      if (debouncedInventoryQuery.trim()) params.set("q", debouncedInventoryQuery.trim());
      warehouseFilters.forEach((value) => params.append("warehouse", value));
      typeFilters.forEach((value) => params.append("warehouseType", value));
      statusFilters.forEach((value) => params.append("status", value));
      const response = await fetch(`/api/inventory/overview?${params}`, { cache: "no-store", signal: controller.signal });
      const payload = await response.json().catch(() => null) as (InventoryOverviewResponse & { error?: string; message?: string }) | null;
      if (!response.ok) throw new Error(payload?.error || payload?.message || `库存数据读取失败（${response.status}）`);
      if (!payload || !Array.isArray(payload.items) || !payload.metrics || !payload.sync) throw new Error("库存总览响应格式不完整");
      if (!controller.signal.aborted && generation === overviewGenerationRef.current) setOverview(payload);
    } catch (requestError) {
      if (!controller.signal.aborted && generation === overviewGenerationRef.current) setError(requestError instanceof Error ? requestError.message : "暂时无法读取库存数据");
    } finally {
      if (!controller.signal.aborted && generation === overviewGenerationRef.current) {
        setLoading(false);
        if (overviewControllerRef.current === controller) overviewControllerRef.current = null;
      }
    }
  }, [customEndDate, customStartDate, debouncedInventoryQuery, overviewPage, planPage, planStatus, statusFilters, typeFilters, warehouseFilters]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadOverview(), 0);
    return () => {
      window.clearTimeout(timer);
      overviewGenerationRef.current += 1;
      overviewControllerRef.current?.abort();
    };
  }, [loadOverview, retryKey]);

  const loadAgeAnalysis = useCallback(async () => {
    const generation = ageGenerationRef.current + 1;
    ageGenerationRef.current = generation;
    ageControllerRef.current?.abort();
    const controller = new AbortController();
    ageControllerRef.current = controller;
    setAgeLoading(true);
    setAgeError("");
    try {
      const params = new URLSearchParams({ page: String(agePage), pageSize: "50" });
      if (activeTab === "stale") ["stagnant", "slow", "aged"].forEach((status) => params.append("status", status));
      const response = await fetch(`/api/inventory/age-analysis?${params}`, { cache: "no-store", signal: controller.signal });
      const payload = await response.json().catch(() => null) as (InventoryAgeAnalysisResponse & { error?: string }) | null;
      if (!response.ok || !payload || !Array.isArray(payload.items) || !payload.metrics) {
        throw new Error(payload?.error || `库龄数据读取失败（${response.status}）`);
      }
      if (!controller.signal.aborted && generation === ageGenerationRef.current) setAgeAnalysis(payload);
    } catch (requestError) {
      if (!controller.signal.aborted && generation === ageGenerationRef.current) setAgeError(requestError instanceof Error ? requestError.message : "暂时无法读取库龄分析数据");
    } finally {
      if (!controller.signal.aborted && generation === ageGenerationRef.current) {
        setAgeLoading(false);
        if (ageControllerRef.current === controller) ageControllerRef.current = null;
      }
    }
  }, [activeTab, agePage]);

  useEffect(() => {
    if (activeTab !== "age" && activeTab !== "stale") return;
    const timer = window.setTimeout(() => void loadAgeAnalysis(), 0);
    return () => {
      window.clearTimeout(timer);
      ageGenerationRef.current += 1;
      ageControllerRef.current?.abort();
    };
  }, [activeTab, ageRetryKey, loadAgeAnalysis]);

  const inventoryItems = overview?.items ?? [];

  useEffect(() => setOverviewPage(1), [customEndDate, customStartDate, debouncedInventoryQuery, statusFilters, typeFilters, warehouseFilters]);
  useEffect(() => setAgePage(1), [activeTab]);
  useEffect(() => setPlanPage(1), [planStatus]);

  const inventoryQueryCount = useMemo(
    () => query.trim().split(/[\s,，;；]+/).filter(Boolean).length,
    [query],
  );

  const recommendations = useMemo(
    () => overview?.recommendations ?? [],
    [overview?.recommendations],
  );

  const syncInventory = useCallback(async (file?: File) => {
    if (!file || !canManageInventory) return;
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      setSyncFeedback({ tone: "error", title: "文件格式不支持", message: "请选择吉客云导出的 .xlsx 分仓库存查询报表。" });
      if (syncInputRef.current) syncInputRef.current.value = "";
      return;
    }
    if (file.size > MAX_INVENTORY_FILE_SIZE) {
      setSyncFeedback({ tone: "error", title: "文件超过 20MB", message: `当前文件为 ${formatFileSize(file.size)}，请拆分后再同步。` });
      if (syncInputRef.current) syncInputRef.current.value = "";
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) {
      setSyncFeedback({ tone: "error", title: "请填写快照日期", message: "库龄报表未包含日期时，需要填写 YYYY-MM-DD 格式的库存快照日期。" });
      return;
    }
    setSyncing(true);
    setSyncProgress(0);
    setSyncStage(file.size > DIRECT_INVENTORY_FILE_SIZE ? "正在分片上传库存报表…" : "正在上传库存报表…");
    setSyncFeedback(null);
    try {
      let payload: InventoryImportResponse | null;
      let responseStatus = 0;
      if (file.size <= DIRECT_INVENTORY_FILE_SIZE) {
        const formData = new FormData();
        formData.append("file", file, file.name);
        formData.append("snapshotDate", snapshotDate);
        const response = await fetch("/api/imports/inventory", { method: "POST", body: formData });
        responseStatus = response.status;
        payload = await response.json().catch(() => null) as InventoryImportResponse | null;
      } else {
        const chunkCount = Math.ceil(file.size / INVENTORY_UPLOAD_CHUNK_SIZE);
        const fingerprint = `inventory:${file.name}:${file.size}:${file.lastModified}:${INVENTORY_UPLOAD_CHUNK_SIZE}`;
        const initResponse = await fetch("/api/imports/inventory/chunks", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "init", fileName: file.name, fileSizeBytes: file.size, chunkCount, fingerprint }),
        });
        const initPayload = await initResponse.json().catch(() => null) as InventoryChunkUploadResponse | null;
        if (!initResponse.ok || !initPayload?.ok || !initPayload.upload) throw new Error(initPayload?.message || "无法初始化库存分片上传");
        const uploadId = initPayload.upload.id;
        const received = new Set(initPayload.upload.receivedChunkIndexes ?? []);
        setSyncProgress(Math.round((initPayload.upload.receivedBytes / file.size) * 85));
        for (let index = 0; index < chunkCount; index += 1) {
          if (received.has(index)) continue;
          const start = index * INVENTORY_UPLOAD_CHUNK_SIZE;
          const end = Math.min(start + INVENTORY_UPLOAD_CHUNK_SIZE, file.size);
          const chunkResponse = await fetch("/api/imports/inventory/chunks", {
            method: "PUT",
            headers: {
              "content-type": "application/octet-stream",
              "x-upload-id": uploadId,
              "x-chunk-index": String(index),
            },
            body: file.slice(start, end),
          });
          const chunkPayload = await chunkResponse.json().catch(() => null) as InventoryChunkUploadResponse | null;
          if (!chunkResponse.ok || !chunkPayload?.ok) throw new Error(chunkPayload?.message || `第 ${index + 1} 个库存分片上传失败`);
          setSyncProgress(Math.min(85, Math.round((end / file.size) * 85)));
        }
        setSyncProgress(90);
        setSyncStage("分片已上传，正在合并并计算库存健康…");
        const completeResponse = await fetch("/api/imports/inventory/chunks", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "complete", uploadId, snapshotDate }),
        });
        responseStatus = completeResponse.status;
        payload = await completeResponse.json().catch(() => null) as InventoryImportResponse | null;
      }
      if (responseStatus < 200 || responseStatus >= 300 || !payload?.ok) {
        const firstError = payload?.errors?.[0];
        const errorRow = firstError?.row ?? firstError?.sourceRowNumber;
        const errorDetail = firstError
          ? `${errorRow ? `第 ${errorRow} 行：` : ""}${firstError.message}${(payload?.errors?.length ?? 0) > 1 ? `（另有 ${(payload?.errors?.length ?? 1) - 1} 项）` : ""}`
          : payload?.message;
        throw new Error(errorDetail || `库存同步失败（${responseStatus}）`);
      }
      setSyncProgress(100);
      const warningText = payload.warnings?.length ? `；${payload.warnings[0].message}` : "";
      setSyncFeedback({
        tone: payload.status === "duplicate" ? "warning" : "success",
        title: payload.status === "duplicate" ? "库存快照已同步" : "库存数据同步成功",
        message: `${payload.batch?.snapshotDate ?? "最新"} · ${formatCount(payload.batch?.insertedCount ?? payload.batch?.rowCount ?? 0)} 行库存明细${warningText}`,
      });
      await Promise.all([loadOverview(), loadAgeAnalysis()]);
    } catch (requestError) {
      setSyncFeedback({ tone: "error", title: "库存同步失败", message: requestError instanceof Error ? requestError.message : "请检查文件后重试" });
    } finally {
      setSyncing(false);
      setSyncStage("");
      if (syncInputRef.current) syncInputRef.current.value = "";
    }
  }, [canManageInventory, loadAgeAnalysis, loadOverview, snapshotDate]);

  const createPlan = useCallback(async (item: InventoryOverviewItem) => {
    if (!canManageInventory) return;
    if (overview?.sync.inventoryStale) {
      const confirmed = window.confirm(`库存快照日期为 ${overview.sync.inventoryAsOf ?? "未知"}，已超过 3 天。建议先同步最新库存；是否仍按当前快照创建备货草稿？`);
      if (!confirmed) return;
    }
    setPlanActionId(item.key);
    setSyncFeedback(null);
    try {
      const response = await fetch("/api/inventory/replenishment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: item.key,
          plannedQuantity: item.suggestedQuantity,
          acknowledgeStale: Boolean(overview?.sync.inventoryStale),
          startDate: customStartDate,
          endDate: customEndDate,
        }),
      });
      const payload = await response.json().catch(() => null) as { ok?: boolean; message?: string } | null;
      if (!response.ok || !payload?.ok) throw new Error(payload?.message || "创建备货计划失败");
      setSyncFeedback({ tone: "success", title: "已加入备货草稿", message: `${item.productName} · 建议补货 ${formatCount(item.suggestedQuantity ?? 0)} 件` });
      await loadOverview();
    } catch (requestError) {
      setSyncFeedback({ tone: "error", title: "备货计划创建失败", message: requestError instanceof Error ? requestError.message : "请稍后重试" });
    } finally {
      setPlanActionId("");
    }
  }, [canManageInventory, customEndDate, customStartDate, loadOverview, overview]);

  const updatePlanStatus = useCallback(async (plan: ReplenishmentPlanItem, status: ReplenishmentPlanItem["status"]) => {
    if (!canManageInventory) return;
    const confirmationText = status === "confirmed"
      ? `确认 ${plan.productName} 的备货计划并计入执行在途？`
      : status === "completed"
        ? `确认 ${plan.productName} 的备货已完成？完成数量会持续扣减建议，直到下一次库存同步。`
        : status === "cancelled"
          ? `确认取消 ${plan.productName} 的备货计划？`
          : "";
    if (confirmationText && !window.confirm(confirmationText)) return;
    setPlanActionId(plan.id);
    try {
      const response = await fetch("/api/inventory/replenishment", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: plan.id,
          status,
          ...(plan.status === "draft" ? { plannedQuantity: planQuantities[plan.id] ?? plan.plannedQuantity } : {}),
        }),
      });
      const payload = await response.json().catch(() => null) as { ok?: boolean; message?: string } | null;
      if (!response.ok || !payload?.ok) throw new Error(payload?.message || "更新备货计划失败");
      setSyncFeedback({
        tone: "success",
        title: status === "confirmed" ? "备货计划已确认" : status === "completed" ? "备货计划已完成" : "备货草稿已取消",
        message: `${plan.productName} · ${formatCount(planQuantities[plan.id] ?? plan.plannedQuantity)} 件`,
      });
      await loadOverview();
    } catch (requestError) {
      setSyncFeedback({ tone: "error", title: "备货计划更新失败", message: requestError instanceof Error ? requestError.message : "请稍后重试" });
    } finally {
      setPlanActionId("");
    }
  }, [canManageInventory, loadOverview, planQuantities]);

  const subnav = (
    <div className="subnav inventory-subnav" role="tablist" aria-label="库存管理子版块">
      <button type="button" role="tab" aria-selected={activeTab === "overview"} className={activeTab === "overview" ? "active" : ""} onClick={() => onModuleViewChange("overview")}>库存总览</button>
      <button type="button" role="tab" aria-selected={activeTab === "age"} className={activeTab === "age" ? "active" : ""} onClick={() => onModuleViewChange("age")}>库龄分析</button>
      <button type="button" role="tab" aria-selected={activeTab === "plan"} className={activeTab === "plan" ? "active" : ""} onClick={() => onModuleViewChange("plan")}>备货计划</button>
      <button type="button" role="tab" aria-selected={activeTab === "stale"} className={activeTab === "stale" ? "active" : ""} onClick={() => onModuleViewChange("stale")}>滞销清理</button>
    </div>
  );

  const syncBar = (
    <section className="inventory-sync-bar">
      <div className="inventory-sync-title">
        <span className={`sync-pulse ${overview?.sync.inventoryStale ? "stale" : overview?.hasInventory ? "ready" : ""}`} aria-hidden="true" />
        <div><strong>{overview?.hasInventory ? overview.sync.salesThrough ? "库存与销售数据已按全局周期联动" : "库存已同步，所选周期暂无销售数据" : "等待首次库存同步"}</strong><small>{overview?.hasInventory ? `全局周期 ${customStartDate} 至 ${customEndDate} · 实际销售 ${overview.sync.salesWindowStart ?? "暂无"} 至 ${overview.sync.salesThrough ?? "暂无"} · 库存快照 ${overview.sync.inventoryAsOf}` : `全局周期 ${customStartDate} 至 ${customEndDate} · 上传分仓库存报表后生成健康与备货建议`}</small></div>
      </div>
      <div className="inventory-source-status" aria-label="库存数据源状态">
        {(overview?.sources ?? []).map((source) => <span className={`source-status source-status-${source.status}`} key={source.key}><Dot tone={source.status === "ready" ? "green" : source.status === "stale" ? "orange" : "gray"} />{source.label}<small>{source.status === "ready" ? "已同步" : source.status === "stale" ? "待更新" : "未接入"}</small></span>)}
      </div>
      {canManageInventory ? <>
        <label className="inventory-snapshot-input"><span>快照日期</span><input type="date" value={snapshotDate} onChange={(event) => setSnapshotDate(event.target.value)} disabled={syncing} /></label>
        <input ref={syncInputRef} className="file-input-hidden" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => void syncInventory(event.currentTarget.files?.[0])} />
        <button type="button" className="primary-button inventory-sync-button" disabled={syncing} onClick={() => syncInputRef.current?.click()}>{syncing ? `${syncProgress}%` : "↻ 同步库存"}</button>
      </> : <span className="soft-tag">仅管理员可同步库存与维护备货计划</span>}
      {syncing && <div className="inventory-sync-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={syncProgress} aria-label={syncStage}><span style={{ width: `${syncProgress}%` }} /><small>{syncStage}</small></div>}
    </section>
  );

  const feedback = syncFeedback && <section className={`inventory-feedback inventory-feedback-${syncFeedback.tone}`} role={syncFeedback.tone === "error" ? "alert" : "status"}><span>{syncFeedback.tone === "success" ? "✓" : syncFeedback.tone === "warning" ? "!" : "×"}</span><div><strong>{syncFeedback.title}</strong><p>{syncFeedback.message}</p></div></section>;
  const refreshError = error && overview && <section className="inventory-feedback inventory-feedback-error" role="alert"><span>!</span><div><strong>最新数据刷新失败</strong><p>{error}</p></div><button className="row-action" onClick={() => setRetryKey((key) => key + 1)}>重试</button></section>;

  if (loading && !overview) {
    return <>{subnav}{syncBar}{feedback}<section className="panel data-state inventory-data-state" role="status"><span className="state-spinner" /><strong>正在同步库存健康数据</strong><p>正在关联最新库存快照与 {customStartDate} 至 {customEndDate} 的销售明细…</p></section></>;
  }

  if (!overview) {
    return <>{subnav}{syncBar}{feedback}<section className="panel data-state inventory-data-state data-state-error" role="alert"><span className="state-symbol">!</span><strong>库存数据加载失败</strong><p>{error || "暂时无法读取库存数据"}</p><button className="secondary-button" onClick={() => setRetryKey((key) => key + 1)}>重新加载</button></section></>;
  }

  if (!overview.hasInventory) {
    return <>{subnav}{syncBar}{feedback}{refreshError}<section className="panel data-state inventory-data-state inventory-empty-state"><span className="state-symbol">库</span><strong>还没有库存快照</strong><p>请上传吉客云“分仓库存查询” .xlsx 报表。系统会保留批次、自动读取实盘库存与成本，并联动销售生成备货建议。</p>{canManageInventory && <button className="primary-button" onClick={() => syncInputRef.current?.click()}>选择库存报表</button>}</section></>;
  }

  const totalHealth = Math.max(1, overview.metrics.skuWarehouseCount);
  const planStatusLabel: Record<ReplenishmentPlanItem["status"], string> = {
    draft: "草稿",
    confirmed: "已确认",
    completed: "已完成",
    cancelled: "已取消",
  };
  const cleanupItems = (ageAnalysis?.items ?? []).filter((item) => item.status === "stagnant" || item.status === "slow" || item.status === "aged");

  return (
    <>
      {subnav}
      {syncBar}
      {feedback}
      {refreshError}
      {activeTab === "overview" ? <>
        <section className="inventory-kpi-grid">
          <InventoryKpiCard label="可用库存" value={`${formatCount(overview.metrics.totalAvailableQuantity)} 件`} note={`${formatCount(overview.metrics.skuWarehouseCount)} 个 SKU × 仓库`} tone="blue" icon="存" />
          <InventoryKpiCard label={overview.metrics.stockValueComplete ? "库存货值" : "已覆盖库存货值"} value={formatCurrencyFromCents(overview.metrics.knownStockValueCents)} note={overview.metrics.stockValueComplete ? "全部可用库存已有成本" : `成本覆盖 ${formatRate(overview.metrics.costCoverageRate)}，缺失部分未计入`} tone="purple" icon="值" />
          <InventoryKpiCard label="平均可售天数" value={overview.metrics.averageCoverageDays === null ? "暂无销量" : `${overview.metrics.averageCoverageDays.toFixed(1)} 天`} note={`销量匹配 ${formatRate(overview.metrics.salesDemandMatchRate)} · 目标 ${overview.settings.targetDays} 天`} tone="green" icon="天" />
          <InventoryKpiCard label="待补货货品" value={`${formatCount(overview.metrics.urgentCount + overview.metrics.replenishCount)} 个`} note={`${formatCount(overview.metrics.urgentCount)} 个需要紧急处理`} tone="orange" icon="补" />
        </section>

        <section className="inventory-diagnosis-grid">
          <article className="panel inventory-health-panel">
            <SectionHeader title="库存健康分布" note="按 SKU × 仓库实时诊断" />
            <div className="health-stack" aria-label="库存健康状态分布">
              {([
                ["urgent", overview.health.urgent], ["replenish", overview.health.replenish], ["healthy", overview.health.healthy],
                ["slow", overview.health.slow], ["stagnant", overview.health.stagnant], ["no_sales", overview.health.noSales],
              ] as [InventoryHealthStatus, number][]).map(([status, count]) => count > 0 && <i className={`health-${status}`} style={{ width: `${count / totalHealth * 100}%` }} title={`${inventoryStatusMeta[status].label} ${count}`} key={status} />)}
            </div>
            <div className="health-legend">
              {([
                ["urgent", overview.health.urgent], ["replenish", overview.health.replenish], ["healthy", overview.health.healthy],
                ["slow", overview.health.slow], ["stagnant", overview.health.stagnant], ["no_sales", overview.health.noSales],
              ] as [InventoryHealthStatus, number][]).map(([status, count]) => <button type="button" onClick={() => setStatusFilters([status])} key={status}><span className={`health-swatch health-${status}`} /><div><small>{inventoryStatusMeta[status].label}</small><strong>{formatCount(count)}</strong></div></button>)}
            </div>
            <div className="inventory-health-note"><span>低周转与呆滞货值</span><strong>{formatCurrencyFromCents(overview.metrics.slowMovingValueCents)}</strong><small>{overview.metrics.noSalesCount} 个 SKU × 仓库暂无有效销量</small></div>
          </article>

          <article className="panel replenishment-opportunity-panel">
            <SectionHeader title="优先补货建议" note="已扣减库存、报表在途和备货计划" />
            <div className="replenishment-opportunity-list">
              {recommendations.slice(0, 5).map((item, index) => <div key={item.key}><span className={`opportunity-rank ${index < 3 ? `top-${index + 1}` : ""}`}>{index + 1}</span><div><strong title={item.productName}>{item.productName}</strong><small>{item.warehouse} · 可售 {item.coverageDays?.toFixed(1) ?? "—"} 天</small></div><em>+{formatCount(item.suggestedQuantity ?? 0)}</em></div>)}
              {recommendations.length === 0 && <div className="inventory-mini-empty">当前没有需要补货的货品</div>}
            </div>
            <button className="inventory-plan-link" onClick={() => onModuleViewChange("plan")}>查看备货计划 <span>→</span></button>
          </article>
        </section>

        <section className="panel table-panel inventory-detail-panel">
          <div className="table-toolbar"><div><h2>库存健康明细</h2><p>自有仓与京东 RDC / DC 分开核算，销量仅按相同仓库匹配</p></div><span className="soft-tag">{inventoryQueryCount > 1 ? `已查询 ${formatCount(inventoryQueryCount)} 个货品编码 · ` : ""}显示 {formatCount(inventoryItems.length)} / {formatCount(overview.pagination.total)}</span></div>
          <div className="filter-row inventory-filter-row">
            <div className="search-box compact inventory-multi-query">⌕ <textarea rows={1} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入或粘贴多个货品编码（空格、逗号或换行分隔）" aria-label="搜索一个或多个货品编码、名称、规格、仓库或品类" /></div>
            <MultiFilterSelect label="库存类型" allLabel="全部类型" ariaLabel="库存类型" options={[{ value: "owned", label: "自有仓" }, { value: "jd_rdc", label: "京东 RDC / DC" }, { value: "other", label: "其他" }]} selected={typeFilters} onChange={setTypeFilters} />
            <MultiFilterSelect label="仓库" allLabel="全部仓库" ariaLabel="仓库" options={overview.filters.warehouses} selected={warehouseFilters} onChange={setWarehouseFilters} />
            <MultiFilterSelect label="健康状态" allLabel="全部状态" ariaLabel="健康状态" options={Object.entries(inventoryStatusMeta).map(([value, meta]) => ({ value, label: meta.label }))} selected={statusFilters} onChange={setStatusFilters} />
            {(query || warehouseFilters.length > 0 || typeFilters.length > 0 || statusFilters.length > 0) && <button className="row-action" onClick={() => { setQuery(""); setWarehouseFilters([]); setTypeFilters([]); setStatusFilters([]); }}>清除筛选</button>}
          </div>
          <div className="data-table-wrap"><table className="data-table inventory-data-table"><thead><tr><th>货品</th><th>库存类型 / 仓库</th><th>可用 / 在途</th><th>{overview.settings.salesWindowDays}日周期销量</th><th>日均销量</th><th>预计可售</th><th>库龄</th><th>建议补货</th><th>健康状态</th><th>操作</th></tr></thead><tbody>
            {inventoryItems.map((item) => {
              const meta = inventoryStatusMeta[item.status];
              const canPlan = canManageInventory && (item.suggestedQuantity ?? 0) > 0 && !item.inDraftPlan;
              return <tr key={item.key}><td><div className="product-cell inventory-product-cell"><span className="product-thumb">{item.productName.slice(0, 1) || "货"}</span><span><strong title={item.productName}>{item.productName}</strong><small>{item.productCode}{item.specification ? ` · ${item.specification}` : ""}</small></span></div></td><td><div className="inventory-warehouse-cell"><span className={`warehouse-type warehouse-type-${item.warehouseType}`}>{item.warehouseType === "owned" ? "自有仓" : item.warehouseType === "jd_rdc" ? "京东仓" : "其他"}</span><small>{item.warehouse}</small></div></td><td><div className="inventory-number-cell"><strong>{formatCount(item.availableQuantity)}</strong><small>在途 {formatCount(item.totalInTransitQuantity)}</small>{item.costCoverageRate < 1 && <small className="orange-text">成本缺口 {formatRate(1 - item.costCoverageRate)}</small>}</div></td><td>{item.sales30d === null ? "—" : formatCount(item.sales30d)}</td><td>{item.averageDailySales === null ? "—" : item.averageDailySales.toFixed(1)}</td><td><strong>{item.coverageDays === null ? "—" : `${item.coverageDays.toFixed(1)} 天`}</strong></td><td>{item.inventoryAgeDays === null ? "—" : `${formatCount(item.inventoryAgeDays)} 天`}</td><td className={(item.suggestedQuantity ?? 0) > 0 ? "orange-text" : ""}><strong>{item.suggestedQuantity === null ? "—" : formatCount(item.suggestedQuantity)}</strong></td><td><span className={`status status-${meta.tone}`} title={item.reason}><Dot tone={meta.tone === "danger" ? "red" : meta.tone === "warning" ? "orange" : meta.tone === "success" ? "green" : meta.tone} />{item.statusLabel}</span></td><td>{canManageInventory ? <button className="row-action" disabled={!canPlan || planActionId === item.key} onClick={() => void createPlan(item)}>{item.inDraftPlan ? "已在草稿" : canPlan ? planActionId === item.key ? "处理中…" : "加入计划" : "无需补货"}</button> : <span className="soft-text">只读</span>}</td></tr>;
            })}
            {inventoryItems.length === 0 && <tr><td colSpan={10}><div className="table-state">没有符合当前筛选条件的库存记录。</div></td></tr>}
          </tbody></table></div>
          <footer className="jd-sku-pagination"><span>第 {overview.pagination.page} / {Math.max(1, overview.pagination.totalPages)} 页</span><div><button type="button" className="row-action" disabled={loading || overview.pagination.page <= 1} onClick={() => setOverviewPage((value) => Math.max(1, value - 1))}>上一页</button><button type="button" className="row-action" disabled={loading || overview.pagination.page >= Math.max(1, overview.pagination.totalPages)} onClick={() => setOverviewPage((value) => value + 1)}>下一页</button></div></footer>
        </section>
      </> : activeTab === "plan" ? <>
        <section className="inventory-kpi-grid inventory-plan-kpis">
          <InventoryKpiCard label="待确认草稿" value={`${formatCount(overview.planSummary.draftCount)} 项`} note="确认后进入执行队列" tone="orange" icon="草" />
          <InventoryKpiCard label="已确认计划" value={`${formatCount(overview.planSummary.confirmedCount)} 项`} note="已计入在途库存" tone="blue" icon="确" />
          <InventoryKpiCard label="计划待回写量" value={`${formatCount(overview.planSummary.activeQuantity)} 件`} note="含完成后等待库存快照回写的数量" tone="purple" icon="途" />
          <InventoryKpiCard label="可生成建议" value={`${formatCount(overview.metrics.recommendationCount)} 项`} note="按最新库存与销量实时重算" tone="green" icon="荐" />
        </section>

        <section className="panel table-panel replenishment-plan-panel">
          <div className="table-toolbar"><div><h2>备货计划</h2><p>调整草稿数量并确认；草稿、已确认数量会自动计入在途，防止重复建议</p></div><span className="soft-tag">本页 {overview.plansPagination.returned} / 共 {overview.plansPagination.total} 项</span><SearchableSelect value={planStatus} onChange={(value) => setPlanStatus(value as "" | ReplenishmentPlanItem["status"])} ariaLabel="备货计划状态" searchPlaceholder="搜索计划状态" options={[{ value: "", label: "当前有效计划" }, { value: "draft", label: "待确认" }, { value: "confirmed", label: "已确认" }, { value: "completed", label: "已完成" }, { value: "cancelled", label: "已取消" }]} /><button className="secondary-button" onClick={() => onModuleViewChange("overview")}>返回库存明细</button></div>
          <div className="data-table-wrap"><table className="data-table replenishment-plan-table"><thead><tr><th>货品</th><th>仓库</th><th>建议依据</th><th>当前可售</th><th>系统建议</th><th>计划数量</th><th>状态</th><th>操作</th></tr></thead><tbody>
            {overview.plans.map((plan) => <tr key={plan.id}><td><div className="product-cell"><span className="product-thumb">{plan.productName.slice(0, 1) || "货"}</span><span><strong>{plan.productName}</strong><small>{plan.productCode}</small></span></div></td><td>{plan.warehouse}</td><td><span className="plan-reason" title={plan.reason}>{plan.reason}</span></td><td>{plan.coverageDays === null ? "—" : `${plan.coverageDays.toFixed(1)} 天`}</td><td><strong>{formatCount(plan.suggestedQuantity)}</strong></td><td>{plan.status === "draft" && canManageInventory ? <input className="plan-quantity-input" type="number" min={1} max={10000000} value={planQuantities[plan.id] ?? plan.plannedQuantity} onChange={(event) => setPlanQuantities((current) => ({ ...current, [plan.id]: Math.max(1, Math.trunc(Number(event.target.value) || 1)) }))} aria-label={`${plan.productName}计划数量`} /> : <strong>{formatCount(plan.plannedQuantity)}</strong>}</td><td><span className={`status status-${plan.status === "draft" ? "warning" : plan.status === "confirmed" ? "success" : "purple"}`}><Dot tone={plan.status === "draft" ? "orange" : plan.status === "confirmed" ? "green" : "purple"} />{planStatusLabel[plan.status]}</span></td><td><div className="plan-row-actions">{canManageInventory ? <>{plan.status === "draft" && <><button className="row-action primary-row-action" disabled={planActionId === plan.id} onClick={() => void updatePlanStatus(plan, "confirmed")}>确认</button><button className="row-action" disabled={planActionId === plan.id} onClick={() => void updatePlanStatus(plan, "cancelled")}>取消</button></>}{plan.status === "confirmed" && <><button className="row-action primary-row-action" disabled={planActionId === plan.id} onClick={() => void updatePlanStatus(plan, "completed")}>完成</button><button className="row-action" disabled={planActionId === plan.id} onClick={() => void updatePlanStatus(plan, "cancelled")}>取消</button></>}{plan.status === "completed" && <span className="plan-done">✓ 已完成</span>}{plan.status === "cancelled" && <span className="soft-text">已取消</span>}</> : <span className="soft-text">只读</span>}</div></td></tr>)}
            {overview.plans.length === 0 && <tr><td colSpan={8}><div className="table-state">暂无备货计划。请在“库存总览”中将补货建议加入计划。</div></td></tr>}
          </tbody></table></div>
          <footer className="jd-sku-pagination"><span>第 {overview.plansPagination.page} / {Math.max(1, overview.plansPagination.totalPages)} 页</span><div><button type="button" className="row-action" disabled={loading || overview.plansPagination.page <= 1} onClick={() => setPlanPage((value) => Math.max(1, value - 1))}>上一页</button><button type="button" className="row-action" disabled={loading || overview.plansPagination.page >= Math.max(1, overview.plansPagination.totalPages)} onClick={() => setPlanPage((value) => value + 1)}>下一页</button></div></footer>
        </section>

        {canManageInventory && recommendations.some((item) => !item.inDraftPlan) && <section className="panel plan-suggestion-panel"><SectionHeader title="待纳入计划的建议" note="按缺口量从高到低" /><div>{recommendations.filter((item) => !item.inDraftPlan).slice(0, 6).map((item) => <article key={item.key}><span>{item.productName.slice(0, 1) || "货"}</span><div><strong>{item.productName}</strong><small>{item.warehouse} · {item.reason}</small></div><em>+{formatCount(item.suggestedQuantity ?? 0)}</em><button className="row-action" disabled={planActionId === item.key} onClick={() => void createPlan(item)}>加入草稿</button></article>)}</div></section>}
      </> : <>
        {ageLoading && !ageAnalysis && <section className="panel data-state inventory-data-state" role="status"><span className="state-spinner" /><strong>正在汇总库龄与动销数据</strong><p>正在读取最新库存快照中的库龄、前 7 天与前 30 天销量…</p></section>}
        {!ageLoading && ageError && <section className="panel data-state inventory-data-state data-state-error" role="alert"><span className="state-symbol">!</span><strong>库龄数据加载失败</strong><p>{ageError}</p><button className="secondary-button" onClick={() => setAgeRetryKey((key) => key + 1)}>重新加载</button></section>}
        {!ageLoading && !ageError && ageAnalysis && !ageAnalysis.hasInventory && <section className="panel data-state inventory-data-state inventory-empty-state"><span className="state-symbol">龄</span><strong>还没有可分析的库存快照</strong><p>请同步包含库龄字段的库存报表后再查看库龄分析和滞销清理。</p></section>}
        {!ageLoading && !ageError && ageAnalysis?.hasInventory && activeTab === "age" && <>
          <section className="inventory-kpi-grid age-kpi-grid"><InventoryKpiCard label="库龄明细" value={`${formatCount(ageAnalysis.metrics.skuWarehouseCount)} 条`} note={`快照日期 ${ageAnalysis.sync.inventoryAsOf ?? "—"}`} tone="blue" icon="龄" /><InventoryKpiCard label={ageAnalysis.metrics.stockValueComplete ? "90天以上货值" : "已覆盖90天以上货值"} value={formatCurrencyFromCents(ageAnalysis.metrics.aged90ValueCents)} note={ageAnalysis.metrics.stockValueComplete ? `${formatCount(ageAnalysis.metrics.aged90Count)} 个 SKU × 仓库` : "缺少成本的库存未计入货值"} tone="orange" icon="90" /><InventoryKpiCard label="滞销清理" value={`${formatCount(ageAnalysis.metrics.stagnantCount)} 项`} note={ageAnalysis.sync.hasAgeSales ? "库龄≥90天且前30天销量为0" : "报表未提供前30天销量"} tone="purple" icon="清" /><InventoryKpiCard label="30天零销量" value={ageAnalysis.sync.hasAgeSales ? `${formatCount(ageAnalysis.metrics.zeroSalesCount)} 项` : "—"} note="仅统计有可用库存的商品" tone="green" icon="零" /></section>
          <section className="age-distribution-grid">{ageAnalysis.distribution.map((bucket) => <article className="panel age-distribution-card" key={bucket.key}><span>{bucket.label}</span><strong>{formatCount(bucket.count)} 项</strong><small>{ageAnalysis.metrics.stockValueComplete ? "库存货值" : "已覆盖货值"} {formatCurrencyFromCents(bucket.valueCents)}</small></article>)}</section>
          <section className="panel table-panel inventory-age-table-panel"><div className="table-toolbar"><div><h2>库龄分析明细</h2><p>{ageAnalysis.sync.hasAgeSales ? "库龄、前 7 天销量与前 30 天销量来自本次库龄报表" : "当前报表未提供销量列，系统仅展示库龄风险"}</p></div><span className="soft-tag">显示 {formatCount(ageAnalysis.items.length)} / {formatCount(ageAnalysis.pagination.total)}</span></div><div className="data-table-wrap"><table className="data-table inventory-age-table"><thead><tr><th>货品</th><th>仓库</th><th>可用库存</th><th>库龄</th><th>前7天销量</th><th>前30天销量</th><th>库存货值</th><th>状态</th></tr></thead><tbody>{ageAnalysis.items.map((item) => { const meta = inventoryAgeStatusMeta[item.status]; const tone = meta.tone === "danger" ? "red" : meta.tone === "warning" ? "orange" : meta.tone === "success" ? "green" : meta.tone; return <tr key={item.key}><td><div className="product-cell inventory-product-cell"><span className="product-thumb">{item.productName.slice(0, 1) || "货"}</span><span><strong title={item.productName}>{item.productName}</strong><small>{item.productCode}{item.specification ? ` · ${item.specification}` : ""}</small></span></div></td><td>{item.warehouse}</td><td>{formatCount(item.availableQuantity)}</td><td><strong>{item.inventoryAgeDays === null ? "—" : `${formatCount(item.inventoryAgeDays)} 天`}</strong></td><td>{item.sales7dQuantity === null ? "—" : formatCount(item.sales7dQuantity)}</td><td>{item.sales30dQuantity === null ? "—" : formatCount(item.sales30dQuantity)}</td><td>{item.stockValueCents === null ? "—" : formatCurrencyFromCents(item.stockValueCents)}</td><td><span className={`status status-${meta.tone}`} title={item.recommendation}><Dot tone={tone} />{item.statusLabel}</span></td></tr>; })}{ageAnalysis.items.length === 0 && <tr><td colSpan={8}><div className="table-state">当前快照没有可展示的库龄记录。</div></td></tr>}</tbody></table></div></section>
          <footer className="jd-sku-pagination"><span>第 {ageAnalysis.pagination.page} / {Math.max(1, ageAnalysis.pagination.totalPages)} 页</span><div><button type="button" className="row-action" disabled={ageLoading || ageAnalysis.pagination.page <= 1} onClick={() => setAgePage((value) => Math.max(1, value - 1))}>上一页</button><button type="button" className="row-action" disabled={ageLoading || ageAnalysis.pagination.page >= Math.max(1, ageAnalysis.pagination.totalPages)} onClick={() => setAgePage((value) => value + 1)}>下一页</button></div></footer>
        </>}
        {!ageLoading && !ageError && ageAnalysis?.hasInventory && activeTab === "stale" && <>
          <section className="inventory-kpi-grid age-kpi-grid"><InventoryKpiCard label="优先清理项" value={`${formatCount(ageAnalysis.metrics.stagnantCount)} 项`} note="库龄≥90天且近30日无销量" tone="orange" icon="清" /><InventoryKpiCard label={ageAnalysis.metrics.stockValueComplete ? "待处理货值" : "已覆盖待处理货值"} value={formatCurrencyFromCents(ageAnalysis.metrics.stagnantValueCents)} note={ageAnalysis.metrics.stockValueComplete ? "按固定成本价与可用库存计算" : "缺少成本的库存未计入货值"} tone="purple" icon="值" /><InventoryKpiCard label="高库龄商品" value={`${formatCount(ageAnalysis.metrics.aged90Count)} 项`} note="库龄超过90天且仍有可用库存" tone="blue" icon="龄" /><InventoryKpiCard label="零销量库存" value={ageAnalysis.sync.hasAgeSales ? `${formatCount(ageAnalysis.metrics.zeroSalesCount)} 项` : "—"} note="前30天销量为0" tone="green" icon="零" /></section>
          <section className="panel table-panel stale-cleanup-panel"><div className="table-toolbar"><div><h2>滞销清理清单</h2><p>仅输出清理建议，不会自动修改库存或创建补货计划。</p></div><span className="soft-tag">优先处理 {formatCount(ageAnalysis.metrics.cleanupCount)} 项</span></div><div className="data-table-wrap"><table className="data-table stale-cleanup-table"><thead><tr><th>货品</th><th>仓库</th><th>库龄</th><th>前30天销量</th><th>可用库存</th><th>库存货值</th><th>清理建议</th><th>风险状态</th></tr></thead><tbody>{cleanupItems.map((item) => { const meta = inventoryAgeStatusMeta[item.status]; const tone = meta.tone === "danger" ? "red" : meta.tone === "warning" ? "orange" : meta.tone; return <tr key={item.key}><td><div className="product-cell inventory-product-cell"><span className="product-thumb">{item.productName.slice(0, 1) || "货"}</span><span><strong title={item.productName}>{item.productName}</strong><small>{item.productCode}</small></span></div></td><td>{item.warehouse}</td><td>{item.inventoryAgeDays === null ? "—" : `${formatCount(item.inventoryAgeDays)} 天`}</td><td>{item.sales30dQuantity === null ? "—" : formatCount(item.sales30dQuantity)}</td><td>{formatCount(item.availableQuantity)}</td><td>{item.stockValueCents === null ? "—" : formatCurrencyFromCents(item.stockValueCents)}</td><td><span className="cleanup-recommendation">{item.recommendation}</span></td><td><span className={`status status-${meta.tone}`}><Dot tone={tone} />{item.statusLabel}</span></td></tr>; })}{cleanupItems.length === 0 && <tr><td colSpan={8}><div className="table-state">当前没有需要优先清理的滞销或高库龄商品。</div></td></tr>}</tbody></table></div></section>
          <footer className="jd-sku-pagination"><span>第 {ageAnalysis.pagination.page} / {Math.max(1, ageAnalysis.pagination.totalPages)} 页</span><div><button type="button" className="row-action" disabled={ageLoading || ageAnalysis.pagination.page <= 1} onClick={() => setAgePage((value) => Math.max(1, value - 1))}>上一页</button><button type="button" className="row-action" disabled={ageLoading || ageAnalysis.pagination.page >= Math.max(1, ageAnalysis.pagination.totalPages)} onClick={() => setAgePage((value) => value + 1)}>下一页</button></div></footer>
        </>}
      </>}
    </>
  );
}

type ProductTab = ModuleViewKey<"product">;
type ProductCalculatorInput = { salePrice: number; unitCost: number; feeRate: number; promotionCost: number };
type ProductMarginFilter = "低于35%" | "35%-40%" | "40%-45%" | "45%以上" | "暂无有效毛利率";

type MultiFilterOption = string | { value: string; label: string };

function MultiFilterSelect({ label, allLabel, ariaLabel, options, selected, onChange }: { label: string; allLabel: string; ariaLabel: string; options: MultiFilterOption[]; selected: string[]; onChange: (next: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const normalizedOptions = options.map((option) => typeof option === "string" ? { value: option, label: option } : option);
  const visibleOptions = normalizedOptions.filter((option) => option.label.toLowerCase().includes(search.trim().toLowerCase()));
  const toggleOption = (option: string) => onChange(selected.includes(option) ? selected.filter((item) => item !== option) : [...selected, option]);
  const summary = selected.length === 0 ? allLabel : `已选 ${formatCount(selected.length)} 个${label}`;
  return <div className={`multi-filter-select ${open ? "open" : ""}`}><button type="button" className="multi-filter-trigger" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} onClick={() => { setOpen((value) => !value); setSearch(""); }}><span title={summary}>{summary}</span><i>⌄</i></button>{open && <div className="multi-filter-menu" role="listbox" aria-label={`${ariaLabel}多选`} aria-multiselectable="true"><div className="multi-filter-menu-head"><strong>{label}筛选</strong><button type="button" onClick={() => onChange([])} disabled={selected.length === 0}>清空</button></div><label className="multi-filter-search">⌕<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`搜索${label}`} aria-label={`搜索${label}`} /></label><button type="button" className={selected.length === 0 ? "selected" : ""} role="option" aria-selected={selected.length === 0} onClick={() => onChange([])}><i>{selected.length === 0 ? "✓" : ""}</i>{allLabel}</button>{visibleOptions.map((option) => <button type="button" key={option.value} className={selected.includes(option.value) ? "selected" : ""} role="option" aria-selected={selected.includes(option.value)} onClick={() => toggleOption(option.value)}><i>{selected.includes(option.value) ? "✓" : ""}</i><span title={option.label}>{option.label}</span></button>)}{visibleOptions.length === 0 && <p className="multi-filter-menu-empty">没有匹配项</p>}</div>}</div>;
}

function ProductDetailView({
  item,
  detail,
  loading,
  error,
  rangeLabel,
  onBack,
  onRetry,
}: {
  item: ProductSummaryItem;
  detail: SalesSummaryResponse | null;
  loading: boolean;
  error: string;
  rangeLabel: string;
  onBack: () => void;
  onRetry: () => void;
}) {
  return <>
    <section className="panel product-detail-heading">
      <button type="button" className="product-detail-back" onClick={onBack}>← 返回商品经营</button>
      <div className="product-detail-heading-main"><div className="product-thumb gradient-thumb">{item.productName.slice(0, 1) || "货"}</div><div><span className="eyebrow">SPECIFICATION DETAIL</span><h2 title={item.productName}>{item.productName}</h2><p><b>规格代码：{item.productCode}</b>{item.specification ? ` · ${item.specification}` : " · 默认规格"}</p></div></div>
      <div className="product-detail-heading-meta"><strong>{rangeLabel}</strong><span>{detail ? `${detail.startDate} 至 ${detail.endDate}` : "正在载入统计周期"}</span><small>可通过上方周期切换查看趋势</small></div>
    </section>

    {loading && !detail && <section className="panel data-state product-detail-state" role="status"><span className="state-spinner" /><strong>正在汇总该规格的销售明细</strong><p>正在读取销量、销售额、平台和店铺分布…</p></section>}
    {!loading && !detail && <section className="panel data-state data-state-error product-detail-state" role="alert"><span className="state-symbol">!</span><strong>规格详情加载失败</strong><p>{error || "暂时无法读取该规格的销售明细"}</p><button className="secondary-button" onClick={onRetry}>重新加载</button></section>}

    {detail && <>
      {error && <section className="inventory-feedback inventory-feedback-error" role="alert"><span>!</span><div><strong>详情刷新失败</strong><p>{error}</p></div><button className="row-action" onClick={onRetry}>重试</button></section>}
      <section className="inventory-kpi-grid product-detail-kpi-grid">
        <InventoryKpiCard label={`${rangeLabel}销量`} value={`${formatCount(detail.current.netQuantity)} 件`} note="按净销量统计，已扣除退货数量" tone="blue" icon="量" />
        <InventoryKpiCard label="销售额（GMV）" value={formatCurrencyFromCents(detail.current.grossSalesCents)} note="正向销售金额，未扣除退货" tone="purple" icon="销" />
        <InventoryKpiCard label="销售净额" value={formatCurrencyFromCents(detail.current.netSalesCents)} note={`退货金额 ${formatCurrencyFromCents(detail.current.refundAmountCents)}`} tone="green" icon="净" />
        <InventoryKpiCard label="退货率" value={formatRate(detail.current.refundRate)} note={`实际大毛利率 ${formatRate(detail.current.grossMarginRate)}`} tone="orange" icon="退" />
      </section>
      <section className="product-detail-insights-grid"><ProductSalesTrend daily={detail.daily ?? []} selectedProductCount={1} /><ProductPlatformSalesShare platforms={detail.platforms ?? []} /></section>
      <section className="product-detail-store-section"><ShopSalesDistribution shops={detail.outlets ?? []} /></section>
    </>}
  </>;
}

function ProductView({ range, customStartDate, customEndDate, moduleView, onModuleViewChange }: { range: SalesRangeLabel; customStartDate: string; customEndDate: string; moduleView: ProductTab; onModuleViewChange: (view: ProductTab) => void }) {
  const activeTab = moduleView;
  const [summary, setSummary] = useState<ProductSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [query, setQuery] = useState("");
  const [categoryFilters, setCategoryFilters] = useState<string[]>([]);
  const [platformFilters, setPlatformFilters] = useState<string[]>([]);
  const [shopFilters, setShopFilters] = useState<string[]>([]);
  const [marginFilters, setMarginFilters] = useState<ProductMarginFilter[]>([]);
  const [sortBy, setSortBy] = useState("sales");
  const [selectedCode, setSelectedCode] = useState("");
  const [detailOpen, setDetailOpen] = useState(false);
  const [calculatorOverrides, setCalculatorOverrides] = useState<Record<string, ProductCalculatorInput>>({});
  const [productDetail, setProductDetail] = useState<SalesSummaryResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [productPage, setProductPage] = useState(1);
  const productSummaryGenerationRef = useRef(0);
  const productSummaryControllerRef = useRef<AbortController | null>(null);
  const productDetailGenerationRef = useRef(0);
  const productDetailControllerRef = useRef<AbortController | null>(null);
  const debouncedProductQuery = useDebouncedValue(query);
  const marginFilterKeys = useMemo(() => marginFilters.map((value) => ({
    "低于35%": "below35",
    "35%-40%": "35to40",
    "40%-45%": "40to45",
    "45%以上": "atLeast45",
    "暂无有效毛利率": "unavailable",
  }[value])), [marginFilters]);

  const loadSummary = useCallback(async () => {
    const generation = productSummaryGenerationRef.current + 1;
    productSummaryGenerationRef.current = generation;
    productSummaryControllerRef.current?.abort();
    const controller = new AbortController();
    productSummaryControllerRef.current = controller;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ range: "custom", startDate: customStartDate, endDate: customEndDate, page: String(productPage), pageSize: "50" });
      if (debouncedProductQuery.trim()) params.set("q", debouncedProductQuery.trim());
      categoryFilters.forEach((category) => params.append("category", category));
      marginFilterKeys.forEach((margin) => params.append("marginBand", margin));
      params.set("sortBy", sortBy === "margin" ? "grossMarginRate" : sortBy === "profit" ? "grossProfitCents" : sortBy === "refund" ? "refundRate" : "netSalesCents");
      params.set("direction", "desc");
      platformFilters.forEach((platform) => params.append("platform", platform));
      shopFilters.forEach((shop) => params.append("shop", shop));
      const response = await fetch(`/api/products/summary?${params}`, { cache: "no-store", signal: controller.signal });
      const payload = await response.json().catch(() => null) as (ProductSummaryResponse & { error?: string }) | null;
      if (!response.ok || !payload || !payload.metrics || !Array.isArray(payload.items)) {
        throw new Error(payload?.error || `商品数据读取失败（${response.status}）`);
      }
      if (!controller.signal.aborted && generation === productSummaryGenerationRef.current) {
        setSummary(payload);
        setSelectedCode((current) => payload.items.some((item) => item.productCode === current) ? current : payload.items[0]?.productCode || "");
      }
    } catch (requestError) {
      if (!controller.signal.aborted && generation === productSummaryGenerationRef.current) setError(requestError instanceof Error ? requestError.message : "暂时无法读取商品数据");
    } finally {
      if (!controller.signal.aborted && generation === productSummaryGenerationRef.current) {
        setLoading(false);
        if (productSummaryControllerRef.current === controller) productSummaryControllerRef.current = null;
      }
    }
  }, [categoryFilters, customEndDate, customStartDate, debouncedProductQuery, marginFilterKeys, platformFilters, productPage, shopFilters, sortBy]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadSummary(), 0);
    return () => {
      window.clearTimeout(timer);
      productSummaryGenerationRef.current += 1;
      productSummaryControllerRef.current?.abort();
    };
  }, [loadSummary, retryKey]);

  useEffect(() => setProductPage(1), [categoryFilters, customEndDate, customStartDate, debouncedProductQuery, marginFilterKeys, platformFilters, shopFilters, sortBy]);

  const selectedProduct = useMemo(
    () => summary?.items.find((item) => item.productCode === selectedCode) ?? null,
    [selectedCode, summary?.items],
  );
  const detailStartDate = summary?.sync.salesWindowStart ?? "";
  const detailEndDate = summary?.sync.salesThrough ?? "";
  const loadProductDetail = useCallback(async () => {
    if (!selectedCode || !detailStartDate || !detailEndDate) return;
    const generation = productDetailGenerationRef.current + 1;
    productDetailGenerationRef.current = generation;
    productDetailControllerRef.current?.abort();
    const controller = new AbortController();
    productDetailControllerRef.current = controller;
    setDetailLoading(true);
    setDetailError("");
    setProductDetail(null);
    try {
      const params = new URLSearchParams({
        range: "custom",
        startDate: detailStartDate,
        endDate: detailEndDate,
        productCodes: selectedCode,
      });
      const response = await fetch(`/api/sales/summary?${params}`, { cache: "no-store", signal: controller.signal });
      const payload = await response.json().catch(() => null) as (SalesSummaryResponse & { error?: string }) | null;
      if (!response.ok || !payload || !payload.current || !Array.isArray(payload.daily)) {
        throw new Error(payload?.error || `规格详情读取失败（${response.status}）`);
      }
      if (!controller.signal.aborted && generation === productDetailGenerationRef.current) setProductDetail(payload);
    } catch (requestError) {
      if (!controller.signal.aborted && generation === productDetailGenerationRef.current) setDetailError(requestError instanceof Error ? requestError.message : "暂时无法读取规格详情");
    } finally {
      if (!controller.signal.aborted && generation === productDetailGenerationRef.current) {
        setDetailLoading(false);
        if (productDetailControllerRef.current === controller) productDetailControllerRef.current = null;
      }
    }
  }, [detailEndDate, detailStartDate, selectedCode]);
  useEffect(() => {
    if (!detailOpen || !selectedCode || !detailStartDate || !detailEndDate) return;
    void loadProductDetail();
    return () => {
      productDetailGenerationRef.current += 1;
      productDetailControllerRef.current?.abort();
    };
  }, [detailEndDate, detailOpen, detailStartDate, loadProductDetail, selectedCode]);

  useEffect(() => { setDetailOpen(false); }, [activeTab]);

  const calculator = useMemo<ProductCalculatorInput>(() => {
    if (!selectedProduct) return { salePrice: 0, unitCost: 0, feeRate: 0, promotionCost: 0 };
    return calculatorOverrides[selectedProduct.productCode] ?? {
      salePrice: Number(((selectedProduct.averageSalePriceCents ?? 0) / 100).toFixed(2)),
      unitCost: Number(((selectedProduct.averageCostCents ?? 0) / 100).toFixed(2)),
      feeRate: Number(((selectedProduct.observedFeeRate ?? 0) * 100).toFixed(2)),
      promotionCost: 0,
    };
  }, [calculatorOverrides, selectedProduct]);

  const categories = useMemo(
    () => summary?.filters.categories ?? [],
    [summary?.filters.categories],
  );
  const platformOptions = useMemo(
    () => summary?.filters.platforms ?? [],
    [summary?.filters.platforms],
  );
  const shopOptions = useMemo(
    () => (summary?.filters.shops ?? [])
      .filter((outlet) => platformFilters.length === 0 || platformFilters.includes(outlet.platform))
      .map((outlet) => ({ value: outlet.key, label: `${outlet.platform} · ${outlet.shop}` })),
    [platformFilters, summary?.filters.shops],
  );
  useEffect(() => {
    setShopFilters((current) => {
      const next = current.filter((item) => shopOptions.some((option) => option.value === item));
      return next.length === current.length ? current : next;
    });
  }, [shopOptions]);
  const productItems = summary?.items ?? [];
  const multiCodeQueryCount = useMemo(
    () => query.trim().split(/[\s,，;；]+/).filter(Boolean).length,
    [query],
  );
  const rangeLabel = range;
  const appliedScope = useMemo(() => {
    const applied = summary?.filtersApplied;
    if (!applied || (applied.platforms.length === 0 && applied.shops.length === 0)) return "全渠道、全部店铺";
    const shops = applied.shops.map((shop) => `${shop.platform} · ${shop.shop}`);
    return shops.length > 0 ? shops.join("；") : applied.platforms.join("、");
  }, [summary?.filtersApplied]);
  const marginBuckets = summary?.metrics.marginBuckets ?? {
    below35Count: 0,
    between35And40Count: 0,
    between40And45Count: 0,
    atLeast45Count: 0,
  };
  const marginBucketCards: Array<{ filter: ProductMarginFilter; label: string; value: number; note: string; tone: "blue" | "green" | "orange" | "purple"; icon: string }> = [
    { filter: "低于35%", label: "实际大毛利率低于35%", value: marginBuckets.below35Count, note: "包含低毛利与亏损货品", tone: "orange", icon: "<35" },
    { filter: "35%-40%", label: "实际大毛利率35%–40%", value: marginBuckets.between35And40Count, note: "按当前统计周期实际毛利率", tone: "blue", icon: "35" },
    { filter: "40%-45%", label: "实际大毛利率40%–45%", value: marginBuckets.between40And45Count, note: "按当前统计周期实际毛利率", tone: "green", icon: "40" },
    { filter: "45%以上", label: "实际大毛利率45%以上", value: marginBuckets.atLeast45Count, note: "按当前统计周期实际毛利率", tone: "purple", icon: "45" },
  ];

  const estimatedFee = calculator.salePrice * calculator.feeRate / 100;
  const estimatedProfit = calculator.salePrice - calculator.unitCost - estimatedFee - calculator.promotionCost;
  const estimatedMargin = calculator.salePrice > 0 ? estimatedProfit / calculator.salePrice : null;
  const updateCalculator = (field: keyof ProductCalculatorInput, value: number) => {
    if (!selectedProduct) return;
    setCalculatorOverrides((current) => ({
      ...current,
      [selectedProduct.productCode]: { ...calculator, [field]: Math.max(0, Number.isFinite(value) ? value : 0) },
    }));
  };
  const openProductDetail = (productCode: string) => {
    setSelectedCode(productCode);
    setDetailOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const changeProductTab = (view: ProductTab) => {
    setDetailOpen(false);
    onModuleViewChange(view);
  };
  const subnav = <div className="subnav product-subnav" role="tablist" aria-label="商品管理子版块"><button type="button" role="tab" aria-selected={activeTab === "overview" && !detailOpen} className={activeTab === "overview" && !detailOpen ? "active" : ""} onClick={() => changeProductTab("overview")}>商品经营</button><button type="button" role="tab" aria-selected={activeTab === "calculator" && !detailOpen} className={activeTab === "calculator" && !detailOpen ? "active" : ""} onClick={() => changeProductTab("calculator")}>毛利测算</button>{detailOpen && <button type="button" role="tab" aria-selected className="active">规格详情</button>}</div>;

  if (loading && !summary) {
    return <>{subnav}<section className="panel data-state" role="status"><span className="state-spinner" /><strong>正在同步商品与毛利数据</strong><p>正在汇总已导入销售明细与最新库存快照…</p></section></>;
  }
  if (!summary) {
    return <>{subnav}<section className="panel data-state data-state-error" role="alert"><span className="state-symbol">!</span><strong>商品数据加载失败</strong><p>{error || "暂时无法读取商品与毛利数据"}</p><button className="secondary-button" onClick={() => setRetryKey((key) => key + 1)}>重新加载</button></section></>;
  }
  if (!summary.hasSales) {
    return <>{subnav}<section className="panel data-state inventory-empty-state"><span className="state-symbol">品</span><strong>还没有可用于毛利测算的销售明细</strong><p>请先在“数据导入”同步销售单明细账。商品价格、成本、费用和实际毛利会随销售数据同步更新。</p></section></>;
  }

  return (
    <>
      {subnav}
      <section className="product-search-hero product-live-hero"><div><span className="eyebrow">商品经营中心</span><h2>商品表现与实际毛利实时汇总</h2><p>全局统计周期 {customStartDate} 至 {customEndDate} · 实际数据 {summary.sync.salesWindowStart} 至 {summary.sync.salesThrough} · 库存快照 {summary.sync.inventoryAsOf ?? "未同步"}</p></div><div className="product-hero-actions"><span className="global-period-badge">{range} · 全局同步</span><button className="secondary-button product-refresh" onClick={() => void loadSummary()} disabled={loading}>{loading ? "同步中…" : "↻ 同步数据"}</button></div></section>

      {error && <section className="inventory-feedback inventory-feedback-error" role="alert"><span>!</span><div><strong>数据刷新失败</strong><p>{error}</p></div><button className="row-action" onClick={() => setRetryKey((key) => key + 1)}>重试</button></section>}

      {activeTab === "overview" && !detailOpen ? <>
        <section className="inventory-kpi-grid product-kpi-grid">
          {marginBucketCards.map((bucket) => <article className={`inventory-kpi-card product-margin-kpi ${marginFilters.includes(bucket.filter) ? "active" : ""}`} key={bucket.filter}><div><span>{bucket.label}</span><i className={`inventory-kpi-icon ${bucket.tone}`}>{bucket.icon}</i></div><strong>{formatCount(bucket.value)} 个</strong><p>{bucket.note}</p><button type="button" onClick={() => setMarginFilters((current) => current.includes(bucket.filter) ? current.filter((value) => value !== bucket.filter) : [...current, bucket.filter])}>{marginFilters.includes(bucket.filter) ? "取消筛选" : "加入筛选 →"}</button></article>)}
        </section>

        <section className="panel product-filter-panel">
          <div className="table-toolbar"><div><h2>商品经营明细</h2><p>已按 {appliedScope} 汇总；净销量已扣除退货。销售单价、成本、费用和实际毛利均来自已导入订单明细。</p></div><span className="soft-tag">{multiCodeQueryCount > 1 ? `已查询 ${formatCount(multiCodeQueryCount)} 个规格代码 · ` : ""}显示 {formatCount(productItems.length)} / {formatCount(summary.pagination.total)}</span></div>
          <div className="filter-row product-filter-row"><div className="search-box compact product-multi-query">⌕ <textarea rows={1} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入或粘贴货品规格代码、名称或规格（空格、逗号或换行分隔）" aria-label="搜索一个或多个货品规格代码、名称、品牌、供应商、规格或品类" /></div><MultiFilterSelect label="品类" allLabel="全部品类" ariaLabel="商品品类" options={categories} selected={categoryFilters} onChange={setCategoryFilters} /><MultiFilterSelect label="平台" allLabel="全部平台" ariaLabel="销售平台" options={platformOptions} selected={platformFilters} onChange={setPlatformFilters} /><MultiFilterSelect label="店铺" allLabel="全部店铺" ariaLabel="销售店铺" options={shopOptions} selected={shopFilters} onChange={setShopFilters} /><SearchableMultiSelect className="filter-select" values={marginFilters} onChange={(values) => setMarginFilters(values as ProductMarginFilter[])} ariaLabel="实际大毛利率区间" allLabel="全部毛利" searchPlaceholder="搜索毛利率区间" options={["低于35%", "35%-40%", "40%-45%", "45%以上", "暂无有效毛利率"].map((value) => ({ value, label: value }))} /><SearchableSelect className="filter-select" value={sortBy} onChange={setSortBy} ariaLabel="排序方式" searchPlaceholder="搜索排序方式" options={[{ value: "sales", label: "按销售净额" }, { value: "profit", label: "按订单毛利" }, { value: "margin", label: "按毛利率" }, { value: "refund", label: "按退货率" }]} /></div>
          <div className="data-table-wrap"><table className="data-table product-live-table"><thead><tr><th>货品 / 规格代码</th><th>品牌</th><th>供应商</th><th>品类</th><th>{rangeLabel}销量</th><th>销售净额</th><th>均价 / 均成本</th><th>费用</th><th>订单毛利</th><th>实际毛利率</th><th>退货率</th><th>操作</th></tr></thead><tbody>
            {productItems.map((item) => { const loss = item.grossProfitCents < 0; return <tr key={item.productCode}><td><div className="product-cell"><span className="product-thumb gradient-thumb">{item.productName.slice(0, 1) || "货"}</span><span><strong title={item.productName}>{item.productName}</strong><small>规格代码：{item.productCode}{item.specification ? ` · ${item.specification}` : " · 默认规格"}</small></span></div></td><td><span className="product-dimension" title={item.brand || "品牌未同步"}>{item.brand || "—"}</span></td><td><span className="product-dimension" title={item.supplierName || "供应商未同步"}>{item.supplierName || "—"}</span></td><td><span className="soft-tag">{item.category}</span></td><td>{formatCount(item.netQuantity)}</td><td><strong>{formatCurrencyFromCents(item.netSalesCents)}</strong></td><td><div className="product-money-pair"><strong>{item.averageSalePriceCents === null ? "—" : formatCurrencyFromCents(item.averageSalePriceCents)}</strong><small>成本 {item.averageCostCents === null ? "—" : formatCurrencyFromCents(item.averageCostCents)}</small></div></td><td>{formatCurrencyFromCents(item.feeCents)}</td><td className={loss ? "red-text" : "green-text"}><strong>{formatCurrencyFromCents(item.grossProfitCents)}</strong></td><td><span className={`product-margin ${loss ? "loss" : item.grossMarginRate !== null && item.grossMarginRate < 0.35 ? "low" : ""}`}>{item.grossMarginRate === null ? "—" : formatRate(item.grossMarginRate)}</span></td><td className={item.refundRate > 0.1 ? "orange-text" : ""}><strong>{formatRate(item.refundRate)}</strong></td><td><button className="row-action" onClick={() => openProductDetail(item.productCode)}>详情</button></td></tr>; })}
            {productItems.length === 0 && <tr><td colSpan={12}><div className="table-state">没有符合当前筛选条件的商品。</div></td></tr>}
          </tbody></table></div>
          <footer className="jd-sku-pagination"><span>第 {summary.pagination.page} / {Math.max(1, summary.pagination.totalPages)} 页</span><div><button type="button" className="row-action" disabled={loading || summary.pagination.page <= 1} onClick={() => setProductPage((value) => Math.max(1, value - 1))}>上一页</button><button type="button" className="row-action" disabled={loading || summary.pagination.page >= Math.max(1, summary.pagination.totalPages)} onClick={() => setProductPage((value) => value + 1)}>下一页</button></div></footer>
        </section>
      </> : detailOpen && selectedProduct ? <ProductDetailView item={selectedProduct} detail={productDetail} loading={detailLoading} error={detailError} rangeLabel={rangeLabel} onBack={() => setDetailOpen(false)} onRetry={() => void loadProductDetail()} /> : <>
        <section className="product-calculator-grid">
          <article className="panel calculator-input-panel"><SectionHeader title="毛利测算" note="默认带入所选商品近期开单均价、成本与费用率，可按活动方案调整" /><div className="calculator-fields"><label><span>选择商品</span><SearchableSelect value={selectedCode} onChange={setSelectedCode} ariaLabel="选择用于测算的商品" searchPlaceholder="搜索商品名称或规格代码" options={summary.items.map((item) => ({ value: item.productCode, label: `${item.productName} · ${item.productCode}`, searchText: `${item.productName} ${item.productCode} ${item.specification}` }))} /></label><label><span>预计成交价（元）</span><input type="number" min={0} step="0.01" value={calculator.salePrice} onChange={(event) => updateCalculator("salePrice", Number(event.target.value))} /></label><label><span>单位成本（元）</span><input type="number" min={0} step="0.01" value={calculator.unitCost} onChange={(event) => updateCalculator("unitCost", Number(event.target.value))} /></label><label><span>平台综合费率（%）</span><input type="number" min={0} step="0.01" value={calculator.feeRate} onChange={(event) => updateCalculator("feeRate", Number(event.target.value))} /></label><label><span>单件促销/履约成本（元）</span><input type="number" min={0} step="0.01" value={calculator.promotionCost} onChange={(event) => updateCalculator("promotionCost", Number(event.target.value))} /></label></div><div className="calculator-source"><Dot tone="blue" /><span>{selectedProduct ? `${selectedProduct.productName} · 最近实际毛利率 ${selectedProduct.grossMarginRate === null ? "—" : formatRate(selectedProduct.grossMarginRate)}` : "请选择商品"}</span></div></article>
          <article className="panel calculator-result-panel"><SectionHeader title="预计单件收益" note="成交价 − 单位成本 − 平台费 − 促销/履约成本" /><div className="calculator-result"><div><span>预计单件毛利</span><strong className={estimatedProfit < 0 ? "red-text" : "green-text"}>{formatCurrency(estimatedProfit)}</strong></div><div><span>预计毛利率</span><strong className={estimatedMargin === null ? "" : estimatedMargin < 0 ? "red-text" : "green-text"}>{estimatedMargin === null ? "—" : formatRate(estimatedMargin)}</strong></div><div><span>预计平台费用</span><strong>{formatCurrency(estimatedFee)}</strong></div></div><div className={`calculator-decision ${estimatedMargin !== null && estimatedMargin < 0 ? "danger" : estimatedMargin !== null && estimatedMargin < 0.2 ? "warning" : "success"}`}><strong>{estimatedMargin === null ? "请输入成交价" : estimatedMargin < 0 ? "该方案预计亏损" : estimatedMargin < 0.2 ? "该方案毛利偏低" : "该方案毛利健康"}</strong><p>{estimatedMargin === null ? "成交价大于 0 后即可得到测算结果。" : `每售出 1 件，预计保留 ${formatCurrency(estimatedProfit)} 毛利。`}</p></div></article>
        </section>
        <section className="panel product-reference-panel"><SectionHeader title="实际经营参考" note="用于对照测算方案与近期真实订单表现" /><div className="product-reference-grid"><div><span>{rangeLabel}销售净额</span><strong>{selectedProduct ? formatCurrencyFromCents(selectedProduct.netSalesCents) : "—"}</strong></div><div><span>{rangeLabel}订单毛利</span><strong className={selectedProduct && selectedProduct.grossProfitCents < 0 ? "red-text" : "green-text"}>{selectedProduct ? formatCurrencyFromCents(selectedProduct.grossProfitCents) : "—"}</strong></div><div><span>实际平台费用率</span><strong>{selectedProduct?.observedFeeRate === null || !selectedProduct ? "—" : formatRate(selectedProduct.observedFeeRate)}</strong></div><div><span>当前可用库存</span><strong>{selectedProduct?.availableQuantity === null || !selectedProduct ? "未同步" : `${formatCount(selectedProduct.availableQuantity)} 件`}</strong></div></div></section>
      </>}
    </>
  );
}



type ImportTab = ModuleViewKey<"import">;

function resolveImportHistoryDomain<T>(
  label: string,
  result: PromiseSettledResult<{ items?: T[] } | null>,
): { items: T[]; error: string | null } {
  if (result.status === "rejected") {
    return {
      items: [],
      error: `${label}：${result.reason instanceof Error ? result.reason.message : "请求失败"}`,
    };
  }
  if (!Array.isArray(result.value?.items)) return { items: [], error: `${label}：响应格式不完整` };
  return { items: result.value.items, error: null };
}

function ImportView({ importSource, currentUser, moduleView, onModuleViewChange }: { importSource?: ImportSourceKey; currentUser: CurrentUser | null; moduleView: ImportTab; onModuleViewChange: (view: ImportTab) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const activeSection = moduleView;
  const canImport = currentUser?.role === "admin";
  const [selectedSource, setSelectedSource] = useState<ImportSourceKey>(() => importSource ?? "sales");
  const [snapshotDate, setSnapshotDate] = useState(shanghaiIsoToday);
  const [dailyStartDate, setDailyStartDate] = useState(() => addIsoDays(shanghaiIsoToday(), -1));
  const [dailyEndDate, setDailyEndDate] = useState(() => addIsoDays(shanghaiIsoToday(), -1));
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStage, setUploadStage] = useState("");
  const [feedback, setFeedback] = useState<ImportFeedback | null>(null);
  const [history, setHistory] = useState<UnifiedHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyDomainErrors, setHistoryDomainErrors] = useState<string[]>([]);
  const historyVisible = activeSection === "history" || activeSection === "continuity";
  const historyRequestGenerationRef = useRef(0);
  const historyRequestControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!importSource) return;
    setSelectedSource(importSource);
    setSelectedFile(null);
    setFeedback(null);
    if (importSource === "tmall_product_master") setSnapshotDate(addIsoDays(shanghaiIsoToday(), -1));
  }, [importSource]);

  useEffect(() => {
    if (canImport) return;
    setSelectedFile(null);
    setDragging(false);
  }, [canImport]);

  const loadHistory = useCallback(async () => {
    if (!historyVisible) return;
    const generation = historyRequestGenerationRef.current + 1;
    historyRequestGenerationRef.current = generation;
    historyRequestControllerRef.current?.abort();
    const controller = new AbortController();
    historyRequestControllerRef.current = controller;
    setHistoryLoading(true);
    setHistoryDomainErrors([]);
    try {
      const results = await Promise.allSettled([
        requestJson<ImportHistoryResponse>("/api/imports/sales", { signal: controller.signal }),
        requestJson<{ items?: InventoryImportHistoryItem[] }>("/api/imports/inventory", { signal: controller.signal }),
        requestJson<{ items?: ErpReferenceImportBatch[] }>("/api/imports/erp", { signal: controller.signal }),
        requestJson<{ items?: SalesImportBatch[] }>("/api/imports/finance", { signal: controller.signal }),
        requestJson<{ items?: NetshopImportHistoryItem[] }>("/api/netshop/import?limit=50", { signal: controller.signal }),
        requestJson<{ items?: CustomerServiceImportHistoryItem[] }>("/api/customer-service/import-history?limit=50", { signal: controller.signal }),
      ] as const);
      if (controller.signal.aborted || generation !== historyRequestGenerationRef.current) return;
      const salesDomain = resolveImportHistoryDomain<SalesImportBatch>("销售导入历史", results[0]);
      const inventoryDomain = resolveImportHistoryDomain<InventoryImportHistoryItem>("库存导入历史", results[1]);
      const erpDomain = resolveImportHistoryDomain<ErpReferenceImportBatch>("ERP 主数据导入历史", results[2]);
      const financeDomain = resolveImportHistoryDomain<SalesImportBatch>("财报导入历史", results[3]);
      const netshopDomain = resolveImportHistoryDomain<NetshopImportHistoryItem>("网店导入历史", results[4]);
      const customerServiceDomain = resolveImportHistoryDomain<CustomerServiceImportHistoryItem>("客服会话导入历史", results[5]);
      const domainErrors = [salesDomain.error, inventoryDomain.error, erpDomain.error, financeDomain.error, netshopDomain.error, customerServiceDomain.error]
        .filter((message): message is string => Boolean(message));
      const combined: UnifiedHistoryItem[] = [
        ...salesDomain.items.map((item) => ({ ...item, sourceKey: "sales" as const, sourceLabel: "吉客云 ERP · 销售明细" })),
        ...inventoryDomain.items.map((item) => ({ ...item, sourceKey: "inventory" as const, sourceLabel: "吉客云 ERP · 分仓库存" })),
        ...erpDomain.items.map((item) => ({ ...item, sourceKey: item.sourceKey, sourceLabel: item.sourceLabel })),
        ...financeDomain.items.map((item) => ({ ...item, sourceKey: "finance" as const, sourceLabel: "月度财报 · 志高事业部" })),
        ...netshopDomain.items
          .filter((item) => item.source === "jd_product_master" || item.source === "jd_yimei_sku" || item.source.startsWith("tmall_") || item.dataset === "spu_daily" || item.dataset === "sku_daily")
          .map((item) => item.source === "tmall_product_master"
            ? { ...item, sourceKey: "tmall_product_master" as const, sourceLabel: "天猫亿玖 · 店铺货品" }
            : item.source === "tmall_product_daily"
              ? { ...item, sourceKey: "tmall_product_daily" as const, sourceLabel: "天猫亿玖 · 生意参谋商品日数据" }
              : item.source === "tmall_promotion"
                ? { ...item, sourceKey: "tmall_promotion" as const, sourceLabel: "天猫亿玖 · 推广商品日数据" }
            : item.dataset === "spu_daily"
            ? { ...item, sourceKey: "jd_spu_daily" as const, sourceLabel: "京东店铺 · 商品 SPU 日数据" }
            : item.dataset === "sku_daily"
              ? { ...item, sourceKey: "jd_sku_daily" as const, sourceLabel: "京东店铺 · 商品 SKU 日数据" }
            : item.source === "jd_yimei_sku"
              ? { ...item, sourceKey: "jd_sku_images" as const, sourceLabel: "京东店铺 · SKU 主图" }
              : { ...item, sourceKey: "jd_sku" as const, sourceLabel: "京东店铺 · 商品 SKU" }),
        ...customerServiceDomain.items.map((item) => ({ id: item.id, sourceKey: "customer_service" as const, sourceLabel: `客服会话 · ${item.shopName || "志高商用设备"}`, fileName: `${item.sessionFileName} + ${item.chatFileName}`, status: item.status, rowCount: item.conversationCount, insertedCount: item.matchedCount, warningCount: item.warnings.length, createdAt: item.createdAt, completedAt: item.completedAt })),
      ].sort((left, right) => Date.parse(right.completedAt || right.createdAt) - Date.parse(left.completedAt || left.createdAt));
      setHistory((current) => combined.length > 0 || domainErrors.length === 0 ? combined : current);
      setHistoryDomainErrors(domainErrors);
    } finally {
      if (!controller.signal.aborted && generation === historyRequestGenerationRef.current) {
        setHistoryLoading(false);
        if (historyRequestControllerRef.current === controller) historyRequestControllerRef.current = null;
      }
    }
  }, [historyVisible]);

  useEffect(() => {
    if (!historyVisible) {
      historyRequestGenerationRef.current += 1;
      historyRequestControllerRef.current?.abort();
      historyRequestControllerRef.current = null;
      setHistoryLoading(false);
      return;
    }
    void loadHistory();
    return () => historyRequestControllerRef.current?.abort();
  }, [historyVisible, loadHistory]);

  const sourceOptions: Array<{
    key: ImportSourceKey;
    icon: string;
    label: string;
    report: string;
    directEndpoint: string;
    chunkEndpoint: string;
    directFileSize: number;
    maxFileSize: number;
    chunkSize: number;
    needsSnapshotDate: boolean;
    extensions: string[];
    accept: string;
    systemLabel: string;
    formSource?: string;
    platform?: string;
    shopName?: string;
    includeSnapshotDate?: boolean;
    expectedDataset?: "sku_daily" | "spu_daily";
    needsDailyRange?: boolean;
    isCustomerService?: boolean;
  }> = [
    { key: "sales", icon: "销", label: "销售明细", report: "销售单明细账", directEndpoint: "/api/imports/sales", chunkEndpoint: "/api/imports/sales/chunks", directFileSize: DIRECT_IMPORT_FILE_SIZE, maxFileSize: MAX_IMPORT_FILE_SIZE, chunkSize: SALES_UPLOAD_CHUNK_SIZE, needsSnapshotDate: false, extensions: [".xlsx"], accept: ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", systemLabel: "吉客云 ERP", needsDailyRange: true },
    { key: "inventory", icon: "库", label: "分仓库存", report: "分仓库存快照", directEndpoint: "/api/imports/inventory", chunkEndpoint: "/api/imports/inventory/chunks", directFileSize: DIRECT_INVENTORY_FILE_SIZE, maxFileSize: MAX_INVENTORY_FILE_SIZE, chunkSize: INVENTORY_UPLOAD_CHUNK_SIZE, needsSnapshotDate: true, extensions: [".xlsx"], accept: ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", systemLabel: "吉客云 ERP" },
    { key: "products", icon: "品", label: "货品主数据", report: "货品资料", directEndpoint: "/api/imports/erp", chunkEndpoint: "/api/imports/erp/chunks", directFileSize: DIRECT_IMPORT_FILE_SIZE, maxFileSize: MAX_INVENTORY_FILE_SIZE, chunkSize: INVENTORY_UPLOAD_CHUNK_SIZE, needsSnapshotDate: false, extensions: [".xlsx"], accept: ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", systemLabel: "吉客云 ERP" },
    { key: "inventory_age", icon: "龄", label: "库龄", report: "库龄分析表", directEndpoint: "/api/imports/erp", chunkEndpoint: "/api/imports/erp/chunks", directFileSize: DIRECT_IMPORT_FILE_SIZE, maxFileSize: MAX_INVENTORY_FILE_SIZE, chunkSize: INVENTORY_UPLOAD_CHUNK_SIZE, needsSnapshotDate: true, extensions: [".xlsx"], accept: ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", systemLabel: "吉客云 ERP" },
    { key: "combos", icon: "组", label: "组合装", report: "组合装及子件", directEndpoint: "/api/imports/erp", chunkEndpoint: "/api/imports/erp/chunks", directFileSize: DIRECT_IMPORT_FILE_SIZE, maxFileSize: MAX_INVENTORY_FILE_SIZE, chunkSize: INVENTORY_UPLOAD_CHUNK_SIZE, needsSnapshotDate: false, extensions: [".xlsx"], accept: ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", systemLabel: "吉客云 ERP" },
    { key: "finance", icon: "财", label: "月度财报", report: "志高事业部销售财报", directEndpoint: "/api/imports/finance", chunkEndpoint: "", directFileSize: MAX_FINANCE_FILE_SIZE, maxFileSize: MAX_FINANCE_FILE_SIZE, chunkSize: MAX_FINANCE_FILE_SIZE, needsSnapshotDate: false, extensions: [".xls", ".xlsx"], accept: ".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", systemLabel: "月度财报" },
    { key: "customer_service", icon: "服", label: "客服会话", report: "会话记录与聊天记录关联", directEndpoint: "/api/customer-service/import", chunkEndpoint: "", directFileSize: MAX_JD_SKU_FILE_SIZE, maxFileSize: MAX_JD_SKU_FILE_SIZE, chunkSize: MAX_JD_SKU_FILE_SIZE, needsSnapshotDate: false, extensions: [".xlsx", ".log"], accept: ".xlsx,.log,.txt", systemLabel: "客服系统", isCustomerService: true },
    { key: "jd_sku", icon: "京", label: "京东商品 SKU", report: "店铺后台 SKU 导出", directEndpoint: "/api/netshop/import", chunkEndpoint: "", directFileSize: MAX_JD_SKU_FILE_SIZE, maxFileSize: MAX_JD_SKU_FILE_SIZE, chunkSize: MAX_JD_SKU_FILE_SIZE, needsSnapshotDate: false, extensions: [".xlsx"], accept: ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", systemLabel: "京东店铺", formSource: "jd_product_master", platform: "京东", shopName: "志高商用设备旗舰店", includeSnapshotDate: true },
    { key: "jd_sku_daily", icon: "日", label: "京东商品 SKU 日数据", report: "商品明细 SKU 分天下载", directEndpoint: "/api/netshop/import", chunkEndpoint: "", directFileSize: MAX_JD_SKU_FILE_SIZE, maxFileSize: MAX_JD_SKU_FILE_SIZE, chunkSize: MAX_JD_SKU_FILE_SIZE, needsSnapshotDate: false, extensions: [".xlsx"], accept: ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", systemLabel: "京东商智", formSource: "jd_sku_daily", platform: "京东", shopName: "志高商用设备旗舰店", expectedDataset: "sku_daily", needsDailyRange: true },
    { key: "jd_spu_daily", icon: "日", label: "京东商品 SPU 日数据", report: "商品明细 SPU 分天下载", directEndpoint: "/api/netshop/import", chunkEndpoint: "", directFileSize: MAX_JD_SKU_FILE_SIZE, maxFileSize: MAX_JD_SKU_FILE_SIZE, chunkSize: MAX_JD_SKU_FILE_SIZE, needsSnapshotDate: false, extensions: [".xlsx"], accept: ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", systemLabel: "京东商智", formSource: "jd_sku_daily", platform: "京东", shopName: "志高商用设备旗舰店", expectedDataset: "spu_daily", needsDailyRange: true },
    { key: "jd_sku_images", icon: "图", label: "京东 SKU 主图", report: "亿美/商品主图导出", directEndpoint: "/api/netshop/import", chunkEndpoint: "", directFileSize: MAX_JD_SKU_FILE_SIZE, maxFileSize: MAX_JD_SKU_FILE_SIZE, chunkSize: MAX_JD_SKU_FILE_SIZE, needsSnapshotDate: false, extensions: [".xlsx", ".csv"], accept: ".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv", systemLabel: "京东 SKU 主图", formSource: "jd_yimei_sku", platform: "京东", shopName: "志高商用设备旗舰店" },
    { key: "tmall_product_master", icon: "猫", label: "天猫亿玖店铺货品", report: "店铺商品发布模板（SKU）", directEndpoint: "/api/netshop/import", chunkEndpoint: "", directFileSize: MAX_JD_SKU_FILE_SIZE, maxFileSize: MAX_JD_SKU_FILE_SIZE, chunkSize: MAX_JD_SKU_FILE_SIZE, needsSnapshotDate: true, extensions: [".xlsx"], accept: ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", systemLabel: "天猫亿玖", formSource: "tmall_product_master", platform: "天猫", shopName: "天猫-志高亿玖专卖店" },
    { key: "tmall_product_daily", icon: "参", label: "天猫商品日数据", report: "生意参谋商品全部明细", directEndpoint: "/api/netshop/import", chunkEndpoint: "", directFileSize: MAX_JD_SKU_FILE_SIZE, maxFileSize: MAX_JD_SKU_FILE_SIZE, chunkSize: MAX_JD_SKU_FILE_SIZE, needsSnapshotDate: false, extensions: [".xls"], accept: ".xls,application/vnd.ms-excel", systemLabel: "生意参谋", formSource: "tmall_product_daily", platform: "天猫", shopName: "天猫-志高亿玖专卖店", needsDailyRange: true },
    { key: "tmall_promotion", icon: "推", label: "天猫推广日数据", report: "推广商品报表 ZIP", directEndpoint: "/api/netshop/import", chunkEndpoint: "", directFileSize: MAX_JD_SKU_FILE_SIZE, maxFileSize: MAX_JD_SKU_FILE_SIZE, chunkSize: MAX_JD_SKU_FILE_SIZE, needsSnapshotDate: false, extensions: [".zip"], accept: ".zip,application/zip", systemLabel: "天猫推广", formSource: "tmall_promotion", platform: "天猫", shopName: "天猫-志高亿玖专卖店", needsDailyRange: true },
  ];
  const activeSource = sourceOptions.find((item) => item.key === selectedSource)!;

  const acceptFile = useCallback((candidate?: File) => {
    setDragging(false);
    if (!candidate || !canImport) return;
    if (!activeSource.extensions.some((extension) => candidate.name.toLowerCase().endsWith(extension))) {
      setSelectedFile(null);
      setFeedback({
        tone: "error",
        title: "文件格式不支持",
        message: `请选择${activeSource.systemLabel}的 ${activeSource.extensions.join(" / ")} ${activeSource.report}。`,
        details: [],
      });
      return;
    }
    if (candidate.size > activeSource.maxFileSize) {
      setSelectedFile(null);
      setFeedback({
        tone: "error",
        title: `文件超过 ${formatFileSize(activeSource.maxFileSize)}`,
        message: `当前文件为 ${formatFileSize(candidate.size)}，超过${activeSource.label}单文件限制。`,
        details: [],
      });
      return;
    }
    setSelectedFile(candidate);
    setFeedback(null);
  }, [activeSource.extensions, activeSource.label, activeSource.maxFileSize, activeSource.report, activeSource.systemLabel, canImport]);

  const showImportResult = (payload: UnifiedImportResponse | null, responseStatus: number) => {
    const warnings = payload?.warnings ?? payload?.batch?.warnings ?? [];
    const errors = payload?.errors ?? [];
    if (!payload?.ok || payload.status === "rejected" || (activeSource.expectedDataset && (payload.batch as { dataset?: string } | undefined)?.dataset !== activeSource.expectedDataset)) {
      setFeedback({
        tone: "error",
        title: "导入未完成",
        message: payload?.message || `文件校验或导入失败（${responseStatus}）`,
        details: errors.slice(0, 8).map(issueText),
      });
      return false;
    }
    if (payload.status === "duplicate") {
      setFeedback({
        tone: "duplicate",
        title: "业务内容完全一致",
        message: payload.message || `全部标准化资料与当前${activeSource.label}数据一致，系统没有重复写入。`,
        details: warnings.slice(0, 8).map(issueText),
      });
    } else if (warnings.length || (payload.batch?.warningCount ?? 0) > 0) {
      setFeedback({
        tone: "warning",
        title: `导入完成，含 ${payload.batch?.warningCount ?? warnings.length} 条提示`,
        message: payload.message || `成功写入 ${formatCount(payload.batch?.insertedCount)} 行${activeSource.label}数据。`,
        details: warnings.slice(0, 8).map(issueText),
      });
    } else {
      setFeedback({
        tone: "success",
        title: `${activeSource.label}导入成功`,
        message: payload.message || `成功写入 ${formatCount(payload.batch?.insertedCount)} 行，相关分析已更新。`,
        details: [
          ...((payload.batch?.excludedCount ?? 0) > 0 ? [`已剔除刷刷仓 ${formatCount(payload.batch?.excludedCount)} 行`] : []),
          ...(payload.verification?.verified ? [`落库回查 ${formatCount(payload.verification.readbackRowCount)} 行 · ${payload.verification.dateMin ?? payload.batch?.snapshotDate ?? "快照"}${payload.verification.dateMax && payload.verification.dateMax !== payload.verification.dateMin ? ` 至 ${payload.verification.dateMax}` : ""}`] : []),
        ],
      });
    }
    return true;
  };

  const importChunkedFile = async (file: File): Promise<{ payload: UnifiedImportResponse | null; status: number }> => {
    const chunkCount = Math.ceil(file.size / activeSource.chunkSize);
    const fingerprint = `${selectedSource}-v1:${file.name}:${file.size}:${file.lastModified}:${activeSource.chunkSize}`;
    setUploadStage("正在检查可续传的上传进度…");
    const initResponse = await fetch(activeSource.chunkEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "init",
        source: activeSource.formSource ?? selectedSource,
        fileName: file.name,
        fileSizeBytes: file.size,
        chunkCount,
        fingerprint,
        ...((activeSource.needsSnapshotDate || activeSource.includeSnapshotDate)
          ? { snapshotDate: activeSource.includeSnapshotDate ? shanghaiIsoToday() : snapshotDate }
          : {}),
        ...(activeSource.needsDailyRange ? { expectedStartDate: dailyStartDate, expectedEndDate: dailyEndDate } : {}),
      }),
    });
    const initPayload = await initResponse.json().catch(() => null) as UnifiedImportResponse | null;
    if (!initResponse.ok || !initPayload?.ok || !initPayload.upload) {
      throw new Error(initPayload?.message || "无法创建分片上传任务");
    }
    const uploaded = new Set(initPayload.upload.receivedChunkIndexes);
    let uploadedBytes = 0;
    for (const index of uploaded) {
      const start = index * activeSource.chunkSize;
      uploadedBytes += Math.min(activeSource.chunkSize, file.size - start);
    }
    setUploadProgress(Math.round((uploadedBytes / file.size) * 100));

    for (let index = 0; index < chunkCount; index += 1) {
      if (uploaded.has(index)) continue;
      const start = index * activeSource.chunkSize;
      const part = file.slice(start, Math.min(start + activeSource.chunkSize, file.size));
      setUploadStage(`正在上传第 ${index + 1}/${chunkCount} 个分片…`);
      const partResponse = await fetch(activeSource.chunkEndpoint, {
        method: "PUT",
        headers: { "x-upload-id": initPayload.upload.id, "x-chunk-index": String(index), "content-type": "application/octet-stream" },
        body: part,
      });
      const partPayload = await partResponse.json().catch(() => null) as UnifiedImportResponse | null;
      if (!partResponse.ok || !partPayload?.ok) throw new Error(partPayload?.message || `第 ${index + 1} 个分片上传失败`);
      uploadedBytes += part.size;
      setUploadProgress(Math.min(99, Math.round((uploadedBytes / file.size) * 100)));
    }

    setUploadProgress(100);
    setUploadStage(`分片已上传，正在合并并校验${activeSource.label}…`);
    const completeResponse = await fetch(activeSource.chunkEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "complete", source: activeSource.formSource ?? selectedSource, uploadId: initPayload.upload.id, ...((activeSource.needsSnapshotDate || activeSource.includeSnapshotDate) ? { snapshotDate: activeSource.includeSnapshotDate ? shanghaiIsoToday() : snapshotDate } : {}), ...(activeSource.needsDailyRange ? { expectedStartDate: dailyStartDate, expectedEndDate: dailyEndDate } : {}) }),
    });
    return {
      payload: await completeResponse.json().catch(() => null) as UnifiedImportResponse | null,
      status: completeResponse.status,
    };
  };

  const importFile = async () => {
    if (!canImport) {
      setFeedback({ tone: "error", title: "当前账号为只读模式", message: "仅管理员可以上传和导入业务数据。", details: [] });
      return;
    }
    if (!selectedFile || uploading) return;
    if (activeSource.needsSnapshotDate && !/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) {
      setFeedback({ tone: "error", title: "请选择快照日期", message: `${activeSource.label}必须指定有效的数据快照日期。`, details: [] });
      return;
    }
    if (activeSource.needsDailyRange && (!/^\d{4}-\d{2}-\d{2}$/.test(dailyStartDate) || !/^\d{4}-\d{2}-\d{2}$/.test(dailyEndDate) || dailyStartDate > dailyEndDate)) {
      setFeedback({ tone: "error", title: "请选择有效业务日期区间", message: "该范围用于精确替换本次报表覆盖的数据，不要求每个自然日都有资料。", details: [] });
      return;
    }
    setUploading(true);
    setFeedback(null);
    setUploadProgress(0);
    try {
      let outcome: { payload: UnifiedImportResponse | null; status: number };
      if (selectedFile.size > activeSource.directFileSize) {
        outcome = await importChunkedFile(selectedFile);
      } else {
        setUploadStage(`正在上传并校验${activeSource.label}…`);
        let response: Response;
        if (selectedSource === "finance") {
          response = await fetch(activeSource.directEndpoint, {
            method: "POST",
            headers: { "content-type": "application/octet-stream", "x-file-name": encodeURIComponent(selectedFile.name) },
            body: selectedFile,
          });
        } else {
          const formData = new FormData();
          formData.append("file", selectedFile);
          formData.append("source", activeSource.formSource ?? (selectedSource === "sales" ? "jky" : selectedSource));
          if (activeSource.platform) formData.append("platform", activeSource.platform);
          if (activeSource.shopName) formData.append("shopName", activeSource.shopName);
          if (activeSource.expectedDataset) formData.append("expectedDataset", activeSource.expectedDataset);
          if (activeSource.needsDailyRange) {
            formData.append("expectedStartDate", dailyStartDate);
            formData.append("expectedEndDate", dailyEndDate);
          }
          if (activeSource.needsSnapshotDate || activeSource.includeSnapshotDate) formData.append("snapshotDate", activeSource.includeSnapshotDate ? shanghaiIsoToday() : snapshotDate);
          response = await fetch(activeSource.directEndpoint, { method: "POST", body: formData });
        }
        outcome = { payload: await response.json().catch(() => null) as UnifiedImportResponse | null, status: response.status };
      }
      if (showImportResult(outcome.payload, outcome.status)) await loadHistory();
    } catch (requestError) {
      setFeedback({
        tone: "error",
        title: "导入请求失败",
        message: requestError instanceof Error ? `${requestError.message}；重新选择同一文件后会自动续传已完成的分片。` : "网络异常，请稍后重试。",
        details: [],
      });
    } finally {
      setUploading(false);
      setUploadStage("");
    }
  };

  const latestBySource = new Map<ImportSourceKey, UnifiedHistoryItem>();
  for (const item of history) {
    if (!latestBySource.has(item.sourceKey)) latestBySource.set(item.sourceKey, item);
  }

  return (
    <>
      <div className="subnav" role="tablist" aria-label="数据导入工作区">
        <button type="button" role="tab" aria-selected={activeSection === "files"} className={activeSection === "files" ? "active" : ""} onClick={() => onModuleViewChange("files")}>文件导入</button>
        <button type="button" role="tab" aria-selected={activeSection === "history"} className={activeSection === "history" ? "active" : ""} onClick={() => onModuleViewChange("history")}>导入历史</button>
        <button type="button" role="tab" aria-selected={activeSection === "continuity"} className={activeSection === "continuity" ? "active" : ""} onClick={() => onModuleViewChange("continuity")}>数据连续性</button>
      </div>
      {activeSection === "files" && <>
      <section className="import-grid">
        <article className="panel import-panel">
          <span className="eyebrow">第 1 步</span><h2>选择数据类型</h2><p>销售、库存、主数据、京东与天猫网店数据使用同一套批次校验和导入历史。</p>
          <div className="source-grid">{sourceOptions.map((item) => <button type="button" className={item.key === selectedSource ? "selected" : ""} aria-pressed={item.key === selectedSource} key={item.key} onClick={() => { setSelectedSource(item.key); if (item.key === "tmall_product_master") setSnapshotDate(addIsoDays(shanghaiIsoToday(), -1)); setSelectedFile(null); setFeedback(null); setUploadProgress(0); }}><span>{item.icon}</span><strong>{item.label}</strong><small>{item.report}</small></button>)}</div>
        </article>
        <article className="panel import-panel">
          {activeSource.isCustomerService ? <CustomerServiceImportCard canImport={canImport} onCompleted={loadHistory} /> : <>
          <span className="eyebrow">第 2 步</span><h2>上传{activeSource.label}报表</h2><p>支持 {activeSource.extensions.join(" / ")}，单文件最大 {formatFileSize(activeSource.maxFileSize)}；月度财报按月份自动去重并合并同名科目。</p>
          {!canImport && <div className="inventory-feedback" role="note"><span aria-hidden="true">只读</span><div><strong>当前账号仅可查看导入历史</strong><p>文件选择、拖放和正式导入仅向管理员开放。</p></div></div>}
          {activeSource.needsSnapshotDate && <label className="import-snapshot-field"><span>数据快照日期</span><input type="date" value={snapshotDate} max={shanghaiIsoToday()} disabled={!canImport} onChange={(event) => setSnapshotDate(event.target.value)} /></label>}
          {activeSource.needsDailyRange && <div className="import-snapshot-field"><label><span>业务范围起始日期</span><input type="date" value={dailyStartDate} max={dailyEndDate} disabled={!canImport} onChange={(event) => setDailyStartDate(event.target.value)} /></label><label><span>业务范围结束日期</span><input type="date" value={dailyEndDate} min={dailyStartDate} max={addIsoDays(shanghaiIsoToday(), -1)} disabled={!canImport} onChange={(event) => setDailyEndDate(event.target.value)} /></label></div>}
          <input
            ref={inputRef}
            className="file-input-hidden"
            type="file"
            accept={activeSource.accept}
            disabled={!canImport}
            onChange={(event) => {
              acceptFile(event.currentTarget.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
          <button
            type="button"
            className={`dropzone ${selectedFile ? "uploaded" : ""} ${dragging ? "dragging" : ""}`}
            disabled={!canImport}
            onClick={() => { if (canImport) inputRef.current?.click(); }}
            onDragEnter={(event) => { event.preventDefault(); if (canImport) setDragging(true); }}
            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = canImport ? "copy" : "none"; if (canImport) setDragging(true); }}
            onDragLeave={(event) => { event.preventDefault(); if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
            onDrop={(event) => { event.preventDefault(); if (canImport) acceptFile(event.dataTransfer.files?.[0]); }}
          >
            <span>{selectedFile ? "✓" : "↑"}</span>
            <strong>{selectedFile ? selectedFile.name : `将 ${activeSource.extensions.join(" / ")} 文件拖到此处，或点击选择`}</strong>
            <small>{selectedFile ? `${formatFileSize(selectedFile.size)} · ${selectedFile.size > activeSource.directFileSize ? "将启用分片上传与断点续传" : "将直接上传并校验"}` : `上传后将写入${activeSource.label}正式数据`}</small>
          </button>
          <div className="import-actions">
            <span>{uploading ? uploadStage : selectedFile ? `准备导入${activeSource.systemLabel} ${activeSource.label}` : "请选择待导入文件"}</span>
            <button type="button" className="primary-button" disabled={!canImport || !selectedFile || uploading} onClick={() => void importFile()}>{uploading ? `${uploadProgress}%` : canImport ? "开始导入" : "仅管理员可导入"}</button>
          </div>
          {uploading && selectedFile && <div className="import-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={uploadProgress} aria-label={`${activeSource.label}上传进度`}><span style={{ width: `${uploadProgress}%` }} /></div>}
          </>}
        </article>
      </section>
      {feedback && <section className={`import-feedback import-feedback-${feedback.tone}`} role={feedback.tone === "error" ? "alert" : "status"} aria-live="polite"><span className="feedback-symbol">{feedback.tone === "success" ? "✓" : feedback.tone === "duplicate" ? "≡" : feedback.tone === "warning" ? "!" : "×"}</span><div><strong>{feedback.title}</strong><p>{feedback.message}</p>{feedback.details.length > 0 && <ul>{feedback.details.map((detail, index) => <li key={`${detail}-${index}`}>{detail}</li>)}</ul>}</div></section>}
      </>}
      {activeSection === "continuity" && <>
        {historyLoading && history.length === 0 && <section className="panel data-state" role="status" aria-live="polite"><span className="state-spinner" /><strong>正在核对数据连续性</strong><p>正在分别读取销售、库存、ERP 主数据、财报、网店和客服导入记录…</p></section>}
        {!historyLoading && historyDomainErrors.length > 0 && <section className="inventory-feedback inventory-feedback-error" role="alert"><span>!</span><div><strong>{historyDomainErrors.length === 6 ? "导入记录暂时不可用" : "部分导入来源读取失败"}</strong><p>{historyDomainErrors.join("；")}</p></div><button type="button" className="row-action" onClick={() => void loadHistory()}>重新读取</button></section>}
        {(history.length > 0 || (!historyLoading && historyDomainErrors.length < 6)) && <section className="import-overview-grid">{sourceOptions.map((source) => { const item = latestBySource.get(source.key); return <article className="panel import-overview-card" key={source.key}><span>{source.label}</span><strong>{item?.fileName ?? "尚未导入"}</strong><small>{item ? `${item.snapshotDate ? `快照 ${item.snapshotDate} · ` : ""}${formatCount(item.insertedCount)} 行 · ${formatDateTime(item.completedAt || item.createdAt)}` : `等待导入${source.report}`}</small></article>; })}</section>}
      </>}
      {activeSection === "history" &&
      <section className="panel table-panel import-history-panel">
        <div className="section-header"><div><h2>最近导入记录</h2><p>来自导入接口的真实批次记录</p></div><button className="text-button" disabled={historyLoading} onClick={() => void loadHistory()}>{historyLoading ? "刷新中…" : "刷新记录"} <span>↻</span></button></div>
        <div className="data-table-wrap"><table className="data-table"><thead><tr><th>数据来源</th><th>文件名称</th><th>文件大小</th><th>数据行数</th><th>导入结果</th><th>完成时间</th></tr></thead><tbody>
          {historyLoading && history.length === 0 && <tr><td colSpan={6}><div className="table-state"><span className="state-spinner" />正在读取导入记录…</div></td></tr>}
          {!historyLoading && historyDomainErrors.length > 0 && <tr><td colSpan={6}><div className="table-state table-state-error" role="alert"><span>{historyDomainErrors.length === 6 ? "导入记录读取失败" : "部分来源读取失败"}：{historyDomainErrors.join("；")}</span><button className="row-action" onClick={() => void loadHistory()}>重试</button></div></td></tr>}
          {!historyLoading && historyDomainErrors.length === 0 && history.length === 0 && <tr><td colSpan={6}><div className="table-state">暂无导入记录，请先上传业务报表。</div></td></tr>}
          {history.map((row) => {
            const rejected = row.status === "rejected";
            const duplicate = row.status === "duplicate";
            const warned = row.warningCount > 0;
            const resultText = rejected ? "导入失败" : duplicate ? "内容一致，已跳过" : warned ? `成功 · ${row.warningCount} 条警告` : "成功";
            const statusClass = rejected ? "status-danger" : duplicate || warned ? "status-warning" : "status-success";
            const dotTone = rejected ? "red" : duplicate || warned ? "orange" : "green";
            const countNote = row.sourceKey === "products" || row.sourceKey === "combos"
              ? `新增 ${formatCount(row.insertedCount)} · 更新 ${formatCount(row.updatedCount)}`
              : `新增 ${formatCount(row.insertedCount)}${row.excludedCount ? ` · 剔除 ${formatCount(row.excludedCount)}` : row.duplicateCount ? ` · 重复 ${formatCount(row.duplicateCount)}` : ""}`;
            return <tr key={`${row.sourceKey}-${row.id}`}><td><strong>{row.sourceLabel}</strong>{row.snapshotDate && <small className="history-source-date">快照 {row.snapshotDate}</small>}</td><td><div className="history-file"><strong>{row.fileName}</strong>{row.sheetName && <small>工作表：{row.sheetName}</small>}</div></td><td>{row.fileSizeBytes === undefined ? "—" : formatFileSize(row.fileSizeBytes)}</td><td><div className="history-count"><strong>{formatCount(row.rowCount)}</strong><small>{countNote}</small></div></td><td><span className={`status ${statusClass}`}><Dot tone={dotTone} />{resultText}</span></td><td>{formatDateTime(row.completedAt || row.createdAt)}</td></tr>;
          })}
        </tbody></table></div>
      </section>
      }
    </>
  );
}

type ShellViewProps = {
  range: SalesRangeLabel;
  customStartDate: string;
  customEndDate: string;
  importSource?: ImportSourceKey;
  moduleView: ModuleViewKey;
  onNavigate: (key: ModuleKey, importSource?: ImportSourceKey) => void;
  onModuleViewChange: (view: ModuleViewKey) => void;
  onApplyPeriod?: (startDate: string, endDate: string) => void;
  currentUser: CurrentUser | null;
};

const viewMap: Record<ModuleKey, (props: ShellViewProps) => React.ReactNode> = {
  n8n_workflows: ({ currentUser, moduleView, onModuleViewChange }) => <N8nWorkflowView currentUser={currentUser} moduleView={normalizeModuleView("n8n_workflows", moduleView)} onModuleViewChange={(view) => onModuleViewChange(view)} />,
  dashboard: DashboardView,
  shop: ({ range, customStartDate, customEndDate, onNavigate, moduleView, onModuleViewChange }) => <ShopView range={range} customStartDate={customStartDate} customEndDate={customEndDate} onNavigate={onNavigate} moduleView={normalizeModuleView("shop", moduleView)} onModuleViewChange={(view) => onModuleViewChange(view)} />,
  market: ({ customStartDate, customEndDate, currentUser, moduleView, onModuleViewChange, onApplyPeriod }) => <MarketView customStartDate={customStartDate} customEndDate={customEndDate} currentUser={currentUser} moduleView={normalizeModuleView("market", moduleView)} onModuleViewChange={(view) => onModuleViewChange(view)} onApplyPeriod={onApplyPeriod} />,
  customer_service: ({ customStartDate, customEndDate, currentUser, onNavigate }) => <CustomerServiceView customStartDate={customStartDate} customEndDate={customEndDate} currentUser={currentUser} onNavigate={onNavigate} />,
  sales: ({ range, customStartDate, customEndDate, currentUser, moduleView, onModuleViewChange }) => <SalesView range={range} customStartDate={customStartDate} customEndDate={customEndDate} currentUser={currentUser} moduleView={normalizeModuleView("sales", moduleView)} onModuleViewChange={(view) => onModuleViewChange(view)} />,
  inventory: ({ customStartDate, customEndDate, currentUser, moduleView, onModuleViewChange }) => <InventoryView customStartDate={customStartDate} customEndDate={customEndDate} currentUser={currentUser} moduleView={normalizeModuleView("inventory", moduleView)} onModuleViewChange={(view) => onModuleViewChange(view)} />,
  product: ({ range, customStartDate, customEndDate, moduleView, onModuleViewChange }) => <ProductView range={range} customStartDate={customStartDate} customEndDate={customEndDate} moduleView={normalizeModuleView("product", moduleView)} onModuleViewChange={(view) => onModuleViewChange(view)} />,
  workflow: ({ currentUser, moduleView, onModuleViewChange }) => <OperationsView currentUser={currentUser} moduleView={normalizeModuleView("workflow", moduleView)} onModuleViewChange={(view) => onModuleViewChange(view)} />,
  import: ({ importSource, currentUser, moduleView, onModuleViewChange }) => <ImportView importSource={importSource} currentUser={currentUser} moduleView={normalizeModuleView("import", moduleView)} onModuleViewChange={(view) => onModuleViewChange(view)} />,
  settings: ({ currentUser, moduleView, onModuleViewChange }) => <SettingsView currentUser={currentUser} moduleView={normalizeModuleView("settings", moduleView)} onModuleViewChange={(view) => onModuleViewChange(view)} />,
  ai: ({ currentUser }) => <AiAssistantView currentUser={currentUser} />,
};

export default function Home() {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [active, setActive] = useState<ModuleKey>("dashboard");
  const { selection: moduleViewSelection, syncFromLocation: syncModuleViewFromLocation, setSelection: setModuleViewSelection, pushView: pushModuleView } = useModuleViewState();
  const [importSource, setImportSource] = useState<ImportSourceKey | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [range, setRange] = useState<SalesRangeLabel>("本月");
  const [customEndDate, setCustomEndDate] = useState(shanghaiIsoToday);
  const [customStartDate, setCustomStartDate] = useState(() => addIsoDays(shanghaiIsoToday(), -29));
  const [selectedMonth, setSelectedMonth] = useState(() => shanghaiIsoToday().slice(0, 7));
  const [statPeriodPickerOpen, setStatPeriodPickerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [globalSearchLoadVersion, setGlobalSearchLoadVersion] = useState(0);
  const [GlobalSearchDialogView, setGlobalSearchDialogView] = useState(() => GlobalSearchDialog);
  const [globalSearchQuery, setGlobalSearchQuery] = useState("");
  const [globalSearchResult, setGlobalSearchResult] = useState<GlobalSearchResult | null>(null);
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false);
  const [globalSearchError, setGlobalSearchError] = useState("");
  const [globalSearchLoadingGroup, setGlobalSearchLoadingGroup] = useState<GlobalSearchGroupKey | null>(null);
  const [globalSearchGroupError, setGlobalSearchGroupError] = useState("");
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const pageTitleRef = useRef<HTMLHeadingElement>(null);
  const globalSearchButtonRef = useRef<HTMLButtonElement>(null);
  const globalSearchGenerationRef = useRef(0);
  const globalSearchControllerRef = useRef<AbortController | null>(null);
  const globalSearchGroupGenerationRef = useRef(0);
  const globalSearchGroupControllerRef = useRef<AbortController | null>(null);
  const globalSearchGroupRequestKeyRef = useRef("");
  const debouncedGlobalSearchQuery = useDebouncedValue(globalSearchQuery, 220);
  const customMaxDate = shanghaiIsoToday();
  const customMinDate = `${Number(customMaxDate.slice(0, 4)) - 1}-01-01`;
  const globalPeriod = useMemo(
    () => skuSalesPeriod(range, customStartDate, customEndDate),
    [customEndDate, customStartDate, range],
  );
  const shellPeriod = useMemo(
    () => shellPeriodForRange(range, selectedMonth, customStartDate, customEndDate),
    [customEndDate, customStartDate, range, selectedMonth],
  );
  const activeModuleView = moduleViewSelection.module === active
    ? moduleViewSelection.view
    : getDefaultModuleView(active);
  const closeMobileMenu = useCallback(() => setMobileMenu(false), []);
  const toggleCollapsed = useCallback(() => {
    setCollapsed((value) => {
      const next = !value;
      try {
        window.localStorage.setItem("teruisi.shell.v1", JSON.stringify({ sidebarCollapsed: next }));
      } catch {
        // A storage failure must not prevent the navigation from working.
      }
      return next;
    });
  }, []);

  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem("teruisi.shell.v1") ?? "null") as { sidebarCollapsed?: unknown } | null;
      if (typeof stored?.sidebarCollapsed === "boolean") setCollapsed(stored.sidebarCollapsed);
    } catch {
      // Ignore malformed or unavailable optional preferences.
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void requestJson<{ user?: CurrentUser }>("/api/auth/me", { signal: controller.signal })
      .then((payload) => {
        if (payload.user) setCurrentUser(payload.user);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!currentUser || active !== "market") return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void import("./market-view")
        .then(({ prefetchMarketRankingOverview }) => prefetchMarketRankingOverview(globalPeriod.startDate, globalPeriod.endDate, controller.signal))
        .catch(() => undefined);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [active, currentUser, globalPeriod.endDate, globalPeriod.startDate]);

  const applyLocationState = useCallback(() => {
    const state = parseShellLocation(window.location.href);
    const today = shanghaiIsoToday();
    const minDate = `${Number(today.slice(0, 4)) - 1}-01-01`;
    setActive(state.module);
    syncModuleViewFromLocation(window.location.href);
    setImportSource(state.source ?? null);
    setRange(rangeForShellPeriod(state.period));
    setStatPeriodPickerOpen(false);
    let appliedPeriod = state.period;
    if (state.period.kind === "calendar_month") {
      const month = state.period.month > today.slice(0, 7) ? today.slice(0, 7) : state.period.month;
      const period = selectedMonthPeriod(month);
      setSelectedMonth(month);
      setCustomStartDate(period.startDate);
      setCustomEndDate(period.endDate > today ? today : period.endDate);
      appliedPeriod = { kind: "calendar_month", month };
    } else if (state.period.kind === "custom") {
      const endDate = state.period.to > today ? today : state.period.to < minDate ? minDate : state.period.to;
      const startDate = state.period.from < minDate ? minDate : state.period.from > endDate ? endDate : state.period.from;
      setCustomStartDate(startDate);
      setCustomEndDate(endDate);
      appliedPeriod = { kind: "custom", from: startDate, to: endDate };
    }
    const normalizedContractUrl = normalizeShellLocation(window.location.href);
    const normalized = serializeShellLocation({
      module: state.module,
      view: state.view,
      ...(state.source ? { source: state.source } : {}),
      period: appliedPeriod,
    }, normalizedContractUrl);
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (normalized !== currentUrl) window.history.replaceState(null, "", normalized);
  }, [syncModuleViewFromLocation]);

  useEffect(() => {
    applyLocationState();
    const onPopState = () => {
      closeMobileMenu();
      applyLocationState();
      window.requestAnimationFrame(() => pageTitleRef.current?.focus());
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [applyLocationState, closeMobileMenu]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  const cancelGlobalSearchRequests = useCallback(() => {
    globalSearchGenerationRef.current += 1;
    globalSearchControllerRef.current?.abort();
    globalSearchControllerRef.current = null;
    globalSearchGroupGenerationRef.current += 1;
    globalSearchGroupControllerRef.current?.abort();
    globalSearchGroupControllerRef.current = null;
    globalSearchGroupRequestKeyRef.current = "";
  }, []);

  useEffect(() => {
    if (!searchOpen) return;
    const query = debouncedGlobalSearchQuery.trim();
    if (Array.from(query).length < 2) return;
    const generation = globalSearchGenerationRef.current + 1;
    globalSearchGenerationRef.current = generation;
    globalSearchControllerRef.current?.abort();
    globalSearchGroupGenerationRef.current += 1;
    globalSearchGroupControllerRef.current?.abort();
    globalSearchGroupControllerRef.current = null;
    globalSearchGroupRequestKeyRef.current = "";
    const controller = new AbortController();
    globalSearchControllerRef.current = controller;
    void (async () => {
      setGlobalSearchLoading(true);
      setGlobalSearchLoadingGroup(null);
      setGlobalSearchGroupError("");
      setGlobalSearchError("");
      try {
        const payload = await requestJson<GlobalSearchResult>(`/api/search?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        if (!payload || payload.query !== query || !Array.isArray(payload.groups) || !payload.groups.every((group) => Array.isArray(group.items)) || !Array.isArray(payload.unavailableDomains)) throw new Error("搜索结果格式不完整");
        if (controller.signal.aborted || generation !== globalSearchGenerationRef.current) return;
        setGlobalSearchResult(payload);
      } catch (error) {
        if (controller.signal.aborted || generation !== globalSearchGenerationRef.current) return;
        setGlobalSearchError(error instanceof Error ? error.message : "搜索失败");
        setGlobalSearchResult(null);
      } finally {
        if (!controller.signal.aborted && generation === globalSearchGenerationRef.current) {
          setGlobalSearchLoading(false);
          if (globalSearchControllerRef.current === controller) globalSearchControllerRef.current = null;
        }
      }
    })();
    return () => controller.abort();
  }, [debouncedGlobalSearchQuery, searchOpen]);

  const current = navItems.find((item) => item.key === active) ?? navItems[0];
  const View = viewMap[active];

  const replacePeriodUrl = useCallback((period: ShellPeriodState) => {
    const nextUrl = serializeShellLocation({
      module: active,
      view: normalizeModuleView(active, activeModuleView),
      ...(active === "import" && importSource ? { source: importSource } : {}),
      period,
    }, window.location.href);
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl !== currentUrl) window.history.replaceState(null, "", nextUrl);
  }, [active, activeModuleView, importSource]);

  const hrefForModule = useCallback((key: ModuleKey) => {
    const currentUrl = typeof window === "undefined" ? "/" : window.location.href;
    return serializeShellLocation({ module: key, view: getDefaultModuleView(key), period: shellPeriod }, currentUrl);
  }, [shellPeriod]);

  const selectModule = useCallback((key: ModuleKey, nextImportSource?: ImportSourceKey, requestedView?: ModuleViewKey) => {
    const nextSource = key === "import" ? nextImportSource : undefined;
    const nextView = requestedView ? normalizeModuleView(key, requestedView) : getDefaultModuleView(key);
    const nextUrl = serializeShellLocation({
      module: key,
      view: nextView,
      ...(nextSource ? { source: nextSource } : {}),
      period: shellPeriod,
    }, window.location.href);
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl !== currentUrl) window.history.pushState(null, "", nextUrl);
    setModuleViewSelection(key, nextView);
    setImportSource(nextSource ?? null);
    setActive(key);
    closeMobileMenu();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => pageTitleRef.current?.focus()));
  }, [closeMobileMenu, setModuleViewSelection, shellPeriod]);

  const selectModuleView = useCallback((view: ModuleViewKey) => {
    pushModuleView(active, normalizeModuleView(active, view));
  }, [active, pushModuleView]);

  const handleSidebarNavigate = useCallback((event: React.MouseEvent<HTMLAnchorElement>, key: ModuleKey) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    selectModule(key);
  }, [selectModule]);

  const loadMoreGlobalSearchGroup = useCallback(async (groupKey: GlobalSearchGroupKey, page: number) => {
    const query = globalSearchQuery.trim();
    if (!searchOpen || Array.from(query).length < 2) return;
    const generation = globalSearchGroupGenerationRef.current + 1;
    globalSearchGroupGenerationRef.current = generation;
    globalSearchGroupControllerRef.current?.abort();
    const controller = new AbortController();
    globalSearchGroupControllerRef.current = controller;
    const nextPage = Number.isInteger(page) ? Math.min(10_000, Math.max(2, page)) : 2;
    const requestKey = `${query}\u001f${groupKey}\u001f${nextPage}`;
    globalSearchGroupRequestKeyRef.current = requestKey;
    setGlobalSearchLoadingGroup(groupKey);
    setGlobalSearchGroupError("");
    try {
      const params = new URLSearchParams({ q: query, group: groupKey, page: String(nextPage) });
      const payload = await requestJson<GlobalSearchResult>(`/api/search?${params.toString()}`, { signal: controller.signal });
      const incomingGroup = payload?.groups?.find((group) => group.key === groupKey);
      if (payload?.query !== query || !incomingGroup || !Array.isArray(incomingGroup.items) || !Array.isArray(payload.unavailableDomains)) throw new Error("搜索分组响应格式不完整");
      if (controller.signal.aborted || generation !== globalSearchGroupGenerationRef.current || requestKey !== globalSearchGroupRequestKeyRef.current) return;
      setGlobalSearchResult((currentResult) => {
        if (!currentResult || currentResult.query !== query) return currentResult;
        const currentGroup = currentResult.groups.find((group) => group.key === groupKey);
        if (!currentGroup) return currentResult;
        const seenIds = new Set(currentGroup.items.map((item) => item.id));
        const mergedItems = [...currentGroup.items];
        for (const item of incomingGroup.items) {
          if (seenIds.has(item.id)) continue;
          seenIds.add(item.id);
          mergedItems.push(item);
        }
        const mergedGroup = { ...currentGroup, ...incomingGroup, page: nextPage, hasMore: nextPage < 10_000 && incomingGroup.hasMore, items: mergedItems };
        const groups = currentResult.groups.map((group) => group.key === groupKey ? mergedGroup : group);
        return {
          ...currentResult,
          groups,
          returned: groups.reduce((total, group) => total + group.items.length, 0),
          truncated: groups.some((group) => group.hasMore),
          unavailableDomains: [...new Set([...currentResult.unavailableDomains, ...payload.unavailableDomains])],
        };
      });
    } catch (error) {
      if (controller.signal.aborted || generation !== globalSearchGroupGenerationRef.current || requestKey !== globalSearchGroupRequestKeyRef.current) return;
      setGlobalSearchGroupError(error instanceof Error ? error.message : "加载更多搜索结果失败");
    } finally {
      if (!controller.signal.aborted && generation === globalSearchGroupGenerationRef.current && requestKey === globalSearchGroupRequestKeyRef.current) {
        setGlobalSearchLoadingGroup(null);
        if (globalSearchGroupControllerRef.current === controller) globalSearchGroupControllerRef.current = null;
      }
    }
  }, [globalSearchQuery, searchOpen]);

  const closeGlobalSearch = useCallback(() => {
    cancelGlobalSearchRequests();
    setSearchOpen(false);
    setGlobalSearchQuery("");
    setGlobalSearchResult(null);
    setGlobalSearchError("");
    setGlobalSearchGroupError("");
    setGlobalSearchLoading(false);
    setGlobalSearchLoadingGroup(null);
  }, [cancelGlobalSearchRequests]);
  const retryGlobalSearchDialog = useCallback(() => {
    setGlobalSearchDialogView(() => lazy(() => import("./global-search-dialog")));
    setGlobalSearchLoadVersion((version) => version + 1);
  }, []);
  const updateGlobalSearchQuery = useCallback((value: string) => {
    cancelGlobalSearchRequests();
    setGlobalSearchQuery(value);
    setGlobalSearchResult(null);
    setGlobalSearchError("");
    setGlobalSearchGroupError("");
    setGlobalSearchLoading(Array.from(value.trim()).length >= 2);
    setGlobalSearchLoadingGroup(null);
  }, [cancelGlobalSearchRequests]);
  const selectGlobalSearchItem = useCallback(async (item: GlobalSearchItem) => {
    let targetModule: ModuleKey | null = null;
    let targetView: ModuleViewKey | undefined;
    try {
      const {
        isGlobalSearchItemModuleValid,
        isGlobalSearchTargetForItem,
        parseGlobalSearchTarget,
      } = await import("./global-search-dialog");
      const target = parseGlobalSearchTarget(item.target);
      if (target && isGlobalSearchTargetForItem(item, target)) {
        targetModule = target.module;
        targetView = target.view;
      } else if (isGlobalSearchItemModuleValid(item)) {
        // A malformed optional deep link may only fall back to its validated module default.
        targetModule = item.module;
      }
    } catch {
      // Navigation fails closed if the validation chunk cannot be loaded.
    }
    if (!targetModule) return;
    selectModule(targetModule, undefined, targetView);
    closeGlobalSearch();
  }, [closeGlobalSearch, selectModule]);
  const selectRange = (nextRange: SalesRangeLabel) => {
    setRange(nextRange);
    setStatPeriodPickerOpen(nextRange === "自定义");
    if (nextRange === "月度") {
      const period = selectedMonthPeriod(selectedMonth);
      setCustomStartDate(period.startDate);
      setCustomEndDate(period.endDate > customMaxDate ? customMaxDate : period.endDate);
      replacePeriodUrl({ kind: "calendar_month", month: selectedMonth });
    } else if (nextRange === "自定义") {
      const endDate = customEndDate > customMaxDate ? customMaxDate : customEndDate < customMinDate ? customMinDate : customEndDate;
      const startDate = customStartDate < customMinDate ? customMinDate : customStartDate > endDate ? endDate : customStartDate;
      setCustomStartDate(startDate);
      setCustomEndDate(endDate);
    } else {
      replacePeriodUrl(shellPeriodForRange(nextRange, selectedMonth, customStartDate, customEndDate));
    }
  };
  const updateSelectedMonth = (month: string) => {
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    setSelectedMonth(month);
    const period = selectedMonthPeriod(month);
    setCustomStartDate(period.startDate);
    setCustomEndDate(period.endDate > customMaxDate ? customMaxDate : period.endDate);
    replacePeriodUrl({ kind: "calendar_month", month });
  };

  const applyCustomPeriod = (startDate: string, endDate: string) => {
    setRange("自定义");
    setCustomStartDate(startDate);
    setCustomEndDate(endDate);
    setStatPeriodPickerOpen(false);
    replacePeriodUrl({ kind: "custom", from: startDate, to: endDate });
  };

  const avatarText = currentUser
    ? [...currentUser.displayName.trim()][0]?.toUpperCase() ?? "管"
    : "访";

  return (
    <>
      <AppShell
        collapsed={collapsed}
        mobileOpen={mobileMenu}
        onCloseMobile={closeMobileMenu}
        sidebar={<>
        <div className="brand">
          <div className="brand-mark"><span>T</span></div>
          <div className="brand-copy"><strong>TERUISI</strong><small>电商运营中台</small></div>
        </div>
        <SidebarNavigation active={active} collapsed={collapsed} hrefForModule={hrefForModule} onNavigate={handleSidebarNavigate} onToggleCollapsed={toggleCollapsed} />
        <div className="sidebar-help"><span>?</span><div><strong>需要帮助？</strong><small>查看使用指南</small></div></div>
        <div className="sidebar-user"><span>{avatarText}</span><div><strong>{currentUser ? `${currentUser.displayName} · ${currentUser.roleLabel}` : "访客 · 只读查看者"}</strong><small>{currentUser ? currentUser.email : "可查看经营数据"}</small></div><button onClick={() => window.location.assign(currentUser ? "/signout-with-chatgpt?return_to=%2F" : "/signin-with-chatgpt?return_to=%2F")} aria-label={currentUser ? "退出登录" : "管理员登录"}>{currentUser ? "⋮" : "登录"}</button></div>
        </>}
        header={<GlobalHeader
          title={current.label}
          description={`${current.description}${active !== "n8n_workflows" ? ` · ${globalPeriod.startDate} 至 ${globalPeriod.endDate}` : ""}`}
          menuButtonRef={mobileMenuButtonRef}
          titleRef={pageTitleRef}
          mobileOpen={mobileMenu}
          onOpenMobile={() => setMobileMenu(true)}
          actions={<>
            <button ref={globalSearchButtonRef} className="global-search" onClick={() => setSearchOpen(true)} aria-label="搜索系统全部数据" aria-haspopup="dialog" aria-expanded={searchOpen} aria-controls="global-search-dialog"><span>⌕</span><em>搜索系统全部数据</em><kbd>⌘ K</kbd></button>
            {active !== "n8n_workflows" && <div className={`date-selector ${range === "月度" || (range === "自定义" && statPeriodPickerOpen) ? "date-selector-expanded" : ""}`}>
              <span>统计周期</span>
              <SearchableSelect value={range} onChange={(value) => selectRange(value as SalesRangeLabel)} ariaLabel="统计周期" searchPlaceholder="搜索统计周期" options={["今日", "昨天", "近7天", "近15天", "本月", "月度", "自定义"].map((value) => ({ value, label: value }))} />
              {range === "月度" && <label className="month-selector"><span>选择月份</span><input type="month" value={selectedMonth} max={customMaxDate.slice(0, 7)} onChange={(event) => updateSelectedMonth(event.target.value)} aria-label="选择统计月份" /></label>}
              {range === "自定义" && statPeriodPickerOpen && <StatisticalPeriodPicker minDate={customMinDate} maxDate={customMaxDate} startDate={customStartDate} endDate={customEndDate} onApply={applyCustomPeriod} />}
            </div>}
          </>}
        />}
      >
        <div className="content">
          <ModuleErrorBoundary
            resetKey={`${active}:${activeModuleView}:${importSource ?? ""}`}
            onRetry={() => { resetReloadableLazyScope(active); }}
            onOpenDashboard={() => selectModule("dashboard")}
          >
            <Suspense fallback={<section className="panel data-state" role="status" aria-live="polite"><span className="state-spinner" /><strong>正在加载{current.label}</strong><p>正在按需载入当前业务工作区…</p></section>}>
              <View range={range} customStartDate={globalPeriod.startDate} customEndDate={globalPeriod.endDate} importSource={importSource ?? undefined} moduleView={activeModuleView} onNavigate={selectModule} onModuleViewChange={selectModuleView} onApplyPeriod={applyCustomPeriod} currentUser={currentUser} />
            </Suspense>
          </ModuleErrorBoundary>
          <footer className="page-footer"><span>TERUISI 电商运营中台 · 业务数据中心</span><span>销售分析以最近成功导入批次为准</span></footer>
        </div>
      </AppShell>

      <TableColumnFilters />

      {searchOpen && <GlobalSearchLoadBoundary resetKey={globalSearchLoadVersion} onRetry={retryGlobalSearchDialog} onClose={closeGlobalSearch} returnFocusRef={globalSearchButtonRef}>
        <Suspense fallback={<GlobalSearchLoadingDialog onClose={closeGlobalSearch} returnFocusRef={globalSearchButtonRef} />}>
        <GlobalSearchDialogView
          open={searchOpen}
          query={globalSearchQuery}
          result={globalSearchResult}
          loading={globalSearchLoading}
          error={globalSearchError}
          loadingGroup={globalSearchLoadingGroup}
          loadMoreError={globalSearchGroupError}
          onQueryChange={updateGlobalSearchQuery}
          onClose={closeGlobalSearch}
          returnFocusRef={globalSearchButtonRef}
          onSelectItem={(item) => void selectGlobalSearchItem(item)}
          onSelectQuickModule={(module) => {
            if (!isModuleKey(module)) return;
            selectModule(module);
            closeGlobalSearch();
          }}
          onLoadMoreGroup={(groupKey, nextPage) => void loadMoreGlobalSearchGroup(groupKey, nextPage)}
        />
        </Suspense>
      </GlobalSearchLoadBoundary>}
    </>
  );
}
