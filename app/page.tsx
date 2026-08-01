"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentProps, PointerEvent as ReactPointerEvent } from "react";
import { AI_MODEL_TOOL_BUDGET_LIMITS } from "@/lib/ai/model-tool-budget";
import { parseProductQueries } from "@/lib/sales/product-query";
import MarketView, { MarketDataImportPanel, MarketMasterAdminPanel, MarketWorkflowPanel } from "./market-view";
import MarketAnnotationView from "./market-annotation-view";

type ModuleKey =
  | "dashboard"
  | "shop"
  | "market"
  | "customer_service"
  | "sales"
  | "inventory"
  | "product"
  | "workflow"
  | "import"
  | "settings"
  | "ai";

type NavItem = {
  key: ModuleKey;
  label: string;
  short: string;
  description: string;
  badge?: string;
};

type CurrentUser = {
  email: string;
  displayName: string;
  role: "viewer" | "analyst" | "operator" | "admin";
  roleLabel: string;
};

type CustomerServiceMessage = { sender: string; sentAt: string; content: string };
type CustomerServiceConversation = {
  id: number; shopName: string; consultedAt: string; customerId: string; customerAlias: string; consultationType: string; agent: string; transferredAgent: string; skillGroup: string; productSku: string; matchedSkuId: string; productSpuId: string; erpProductCode: string; productCategory: string; productName: string; firstResponseAt: string; responseSeconds: number | null; durationMinutes: number | null; customerMessageCount: number | null; agentMessageCount: number | null; satisfaction: string; resolved: string; conversationId: string; matchStatus: "matched" | "session_only" | "chat_only" | "ambiguous"; matchConfidence: "exact" | "time_only" | "review" | "none"; chatStartedAt: string; chatEndedAt: string; chatCustomerAlias: string; messages: CustomerServiceMessage[]; robotScope: "robot_only" | "contains_robot" | "exclude_robot" | ""; problemType: "商品咨询" | "价格优惠" | "物流发货" | "售后维修" | "退换货" | "安装使用" | "发票开票" | "催单改单" | "其他" | ""; conversionStatus: "converted" | "not_converted" | "unknown" | ""; serviceIssues: string; summaryText: string; analysisSource: "ai" | "manual" | ""; analyzedAt: string | null; annotatedAt: string | null;
};
type CustomerServiceData = {
  items: CustomerServiceConversation[]; agents: string[]; shops: string[]; categories: string[]; summary: { total: number; matched: number; sessionOnly: number; chatOnly: number }; pagination: { page: number; pageSize: number; total: number };
};

type AiModelProtocol = "openai_compatible" | "anthropic";
type AiModelType = "text" | "vision";
type AiModelStatus = "enabled" | "disabled";
type AiModelReasoningMode = "auto" | "disabled";
type AiChannelKind = "dingtalk_group_bot" | "dingtalk_app" | "wechat_work_group_bot" | "wechat_work_app";
type AiArtifactCell = string | number | boolean | null;
type AiTableArtifact = { id: string; kind: "table"; title: string; sourceTool: string; columns: string[]; rows: AiArtifactCell[][]; rowCount: number; truncated: boolean; fileName: string; mimeType: "text/csv; charset=utf-8"; contentDigest: string; downloadUrl: string; createdAt: string };
type AiConversationMessage = { id: string; conversationId: string; role: "user" | "assistant"; content: string; messageKind: "message" | "context_reset" | "help"; createdAt: string; artifacts: AiTableArtifact[] };
type AiAvailableChatModel = { id: string; name: string; protocol: AiModelProtocol; modelType: AiModelType; modelName: string; isDefault: boolean };

type AiModelRecord = {
  id: string;
  name: string;
  protocol: AiModelProtocol;
  modelType: AiModelType;
  modelName: string;
  baseUrl: string;
  apiKeySuffix: string;
  isDefaultTextModel: boolean;
  status: AiModelStatus;
  timeoutMs: number;
  maxTokens: number;
  reasoningMode: AiModelReasoningMode;
  temperatureMilli: number;
  maxToolRounds: number;
  maxTotalToolCalls: number;
  lastTestResult: string | null;
  lastTestedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type AiChannelRecord = {
  id: string;
  name: string;
  kind: AiChannelKind;
  status: "enabled" | "disabled";
  sendEnabled: boolean;
  callbackEnabled: boolean;
  webhookUrlMasked: string;
  callbackTokenMasked: string;
  aesKeyMasked: string;
  receiverId: string;
  lastTestResult: string | null;
  lastTestedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type AiConversationRecord = {
  id: string;
  title: string;
  modelId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

type AiModelDraft = {
  id?: string;
  name: string;
  protocol: AiModelProtocol;
  modelType: AiModelType;
  modelName: string;
  baseUrl: string;
  apiKey: string;
  status: AiModelStatus;
  isDefaultTextModel: boolean;
  timeoutMs: number;
  maxTokens: number;
  reasoningMode: AiModelReasoningMode;
  temperatureMilli: number;
  maxToolRounds: number;
  maxTotalToolCalls: number;
};

type AiChannelDraft = {
  id?: string;
  name: string;
  kind: AiChannelKind;
  status: "enabled" | "disabled";
  sendEnabled: boolean;
  callbackEnabled: boolean;
  webhookUrl: string;
  callbackToken: string;
  aesKey: string;
  receiverId: string;
};

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
  previousStartDate?: string;
  previousEndDate?: string;
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
  filters?: { productCodes: string[]; platform?: string | null; shop?: string | null; outlets?: Array<{ platform: string; shop: string }>; categories?: string[] };
  filterOptions?: {
    shops: Array<{ key: string; name: string; platform: string }>;
    categories: string[];
  };
};

type GlobalSearchItem = {
  id: string;
  title: string;
  subtitle: string;
  detail: string;
  updatedAt: string;
  amountCents: number | null;
  module: ModuleKey;
};

type GlobalSearchGroup = {
  key: string;
  label: string;
  icon: string;
  module: ModuleKey;
  available: boolean;
  total: number;
  hasMore: boolean;
  items: GlobalSearchItem[];
};

type GlobalSearchResponse = {
  query: string;
  returned: number;
  truncated: boolean;
  groups: GlobalSearchGroup[];
  unavailableDomains: string[];
  error?: string;
};

type OperatingSettings = {
  targetDays: number;
  criticalDays: number;
  slowDays: number;
  stagnantDays: number;
  autoReplenishment: boolean;
  inventoryAlert: boolean;
  allowNegativeInventory: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
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
  filters: { platforms: string[]; shops: ProductShopFilterOption[] };
  filtersApplied: { platforms: string[]; shops: ProductShopFilterOption[] };
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
  pagination: { total: number; limit: number; truncated: boolean };
  recommendations: InventoryOverviewItem[];
  items: InventoryOverviewItem[];
  plans: ReplenishmentPlanItem[];
  planSummary: {
    draftCount: number;
    confirmedCount: number;
    completedCount: number;
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
  sync: { inventoryAsOf: string | null; latestInventoryBatchId: string | null; hasAgeSales: boolean };
  metrics: { skuWarehouseCount: number; aged90Count: number; aged90ValueCents: number; stagnantCount: number; stagnantValueCents: number; zeroSalesCount: number; cleanupCount: number };
  distribution: Array<{ key: string; label: string; count: number; valueCents: number }>;
  pagination: { total: number; limit: number; truncated: boolean };
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

type ImportSourceKey = "sales" | "inventory" | "products" | "inventory_age" | "combos" | "finance" | "jd_sku" | "jd_sku_images" | "jd_sku_daily" | "jd_spu_daily" | "customer_service";

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
  shopName: string;
  skuId: string;
  productCode: string;
  productName: string;
  imageUrl: string;
  saleAttribute: string;
  category: string;
  brand: string;
  price: number | null;
  totalInventory: number | null;
  availableInventory: number | null;
  status: string;
  productUrl: string;
  createdAt: string;
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
  pagination: { page: number; pageSize: number; total: number };
};

type NetshopProductPerformanceDimension = "sku" | "spu";

type NetshopProductPerformanceItem = {
  id: string;
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
  transactionOrders: number;
  transactionAmount: number;
  transactionQuantity: number;
  transactionCustomers: number;
  uvValue: number | null;
  conversionRate: number | null;
};

type NetshopProductPerformanceResponse = {
  dimension: NetshopProductPerformanceDimension;
  dataset: "sku_daily" | "spu_daily";
  requestedPeriod: { startDate: string | null; endDate: string | null };
  dateMin: string | null;
  dataCutoffDate: string | null;
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
    transactionOrders: number;
    transactionAmount: number;
    transactionQuantity: number;
    transactionCustomers: number;
    uvValue: number | null;
    conversionRate: number | null;
  };
  items: NetshopProductPerformanceItem[];
  pagination: { page: number; pageSize: number; total: number };
};

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
  shopName: string;
  category: string;
  manager: string;
  salesTargetCents: number;
  profitTargetCents: number;
  smallMarginBps: number;
  inventoryCleanupTargetCents: number;
  promotionFeeRatioBps: number;
  stagnantInventoryTargetCents: number;
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
  targets?: { month: FinanceTargetTotals; year: FinanceTargetTotals; projects: FinanceTarget[] };
  progress?: { month: FinanceProgress; year: FinanceProgress };
  expenses: Array<{ name: string; current: number; previous: number | null; yearAgo: number | null; feeRateBps: number; yearAgoFeeRateBps: number | null; momRate: number | null; yoyRate: number | null; abnormal: boolean }>;
  shops: Array<{ name: string; groupName: string; manager: string; actual: FinanceActualMetrics; target: FinanceTargetTotals; progress: FinanceProgress }>;
  anomalies: Array<{ level: "critical" | "warning" | "info"; title: string; detail: string }>;
  filters?: { platforms: string[]; shops: Array<{ name: string; platform: string }> };
  selection?: { allMonths: boolean; months: string[]; platforms: string[]; shops: string[] };
  sync?: { dataCutoffMonth: string; sourceFileName: string; importedAt: string };
  error?: string;
};

type FinanceTargetOptions = { shops: string[]; categories: string[]; projects: string[] };

type SalesImportResponse = {
  ok: boolean;
  status: "imported" | "duplicate" | "rejected" | string;
  message?: string;
  batch?: SalesImportBatch;
  warnings?: ImportIssue[];
  errors?: ImportIssue[];
};

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

const navItems: NavItem[] = [
  { key: "dashboard", label: "BI 看板", short: "BI", description: "经营驾驶舱" },
  { key: "shop", label: "网店分析", short: "店", description: "多网店经营分析" },
  { key: "market", label: "市场分析", short: "市", description: "榜单、行业与竞品洞察" },
  { key: "customer_service", label: "客服分析", short: "服", description: "会话导入与聊天分析" },
  { key: "sales", label: "销售分析", short: "销", description: "利润与渠道表现" },
  { key: "inventory", label: "库存管理", short: "库", description: "库存健康与备货" },
  { key: "product", label: "货品详情", short: "品", description: "商品与毛利测算" },
  { key: "workflow", label: "运营事务", short: "务", description: "计划、巡店与新品", badge: "7" },
  { key: "import", label: "数据导入", short: "入", description: "批次导入与校验" },
  { key: "settings", label: "系统设置", short: "设", description: "参数、映射与权限" },
  { key: "ai", label: "AI 助理", short: "AI", description: "模型、对话与渠道接入" },
];

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 0,
  }).format(value);

const formatCurrencyFromCents = (value = 0) => formatCurrency(value / 100);
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

type ProductPeriodPreset = "day" | "week" | "month" | "custom";
type ProductComparisonMode = "period" | "year";

const productPeriodPresetForRange = (range: SalesRangeLabel): ProductPeriodPreset => {
  if (range === "今天" || range === "昨天") return "day";
  if (range === "近7天" || range === "近15天") return "week";
  if (range === "自定义" || range === "月度") return "custom";
  return "month";
};

const productPeriodForPreset = (
  preset: ProductPeriodPreset,
  fallback: { startDate: string; endDate: string },
) => {
  if (preset === "day") return { startDate: fallback.endDate, endDate: fallback.endDate };
  if (preset === "week") return { startDate: addIsoDays(fallback.endDate, -6), endDate: fallback.endDate };
  if (preset === "month") return { startDate: `${fallback.endDate.slice(0, 7)}-01`, endDate: fallback.endDate };
  return fallback;
};

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

type SearchableSelectOption = {
  value: string;
  label: string;
  searchText?: string;
  disabled?: boolean;
};

function SearchableSelect({
  value,
  onChange,
  options,
  ariaLabel,
  className = "",
  searchPlaceholder = "输入关键词搜索",
  emptyLabel = "没有匹配项",
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SearchableSelectOption[];
  ariaLabel: string;
  className?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const selectedOption = options.find((option) => option.value === value);
  const visibleOptions = options.filter((option) => {
    if (!normalizedQuery) return true;
    return `${option.label} ${option.searchText ?? ""}`.toLocaleLowerCase("zh-CN").includes(normalizedQuery);
  });

  useEffect(() => {
    if (!open) return;
    const closeWhenOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeWhenOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeWhenOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const choose = (nextValue: string) => {
    onChange(nextValue);
    setQuery("");
    setOpen(false);
  };

  return <div className={`searchable-select ${className} ${open ? "open" : ""}`} ref={rootRef}>
    <button type="button" className="searchable-select-trigger" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => { if (!disabled) { setOpen((current) => !current); setQuery(""); } }}>
      <span title={selectedOption?.label ?? "请选择"}>{selectedOption?.label ?? "请选择"}</span><i aria-hidden="true">⌄</i>
    </button>
    {open && <div className="searchable-select-menu" role="listbox" aria-label={`${ariaLabel}选项`}>
      <label className="searchable-select-search"><span aria-hidden="true">⌕</span><input autoFocus type="search" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && visibleOptions.length === 1 && !visibleOptions[0].disabled) { event.preventDefault(); choose(visibleOptions[0].value); } }} placeholder={searchPlaceholder} aria-label={`搜索${ariaLabel}`} /></label>
      <div className="searchable-select-options">
        {visibleOptions.map((option) => <button type="button" key={`${option.value}-${option.label}`} className={option.value === value ? "selected" : ""} role="option" aria-selected={option.value === value} disabled={option.disabled} onClick={() => choose(option.value)}><span title={option.label}>{option.label}</span>{option.value === value && <i aria-hidden="true">✓</i>}</button>)}
        {visibleOptions.length === 0 && <p>{emptyLabel}</p>}
      </div>
    </div>}
  </div>;
}

function SearchableMultiSelect({
  values,
  onChange,
  options,
  ariaLabel,
  allLabel,
  className = "",
  searchPlaceholder = "输入关键词搜索",
  emptyLabel = "没有匹配项",
  disabled = false,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  options: SearchableSelectOption[];
  ariaLabel: string;
  allLabel: string;
  className?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const selectedValues = new Set(values);
  const availableOptions = options.filter((option) => !option.disabled);
  const selectedOptions = options.filter((option) => selectedValues.has(option.value));
  const visibleOptions = options.filter((option) => {
    if (!normalizedQuery) return true;
    return `${option.label} ${option.searchText ?? ""}`.toLocaleLowerCase("zh-CN").includes(normalizedQuery);
  });
  const summary = selectedOptions.length === 0
    ? allLabel
    : selectedOptions.length === 1
      ? selectedOptions[0].label
      : `已选 ${formatCount(selectedOptions.length)} 项`;

  useEffect(() => {
    if (!open) return;
    const closeWhenOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeWhenOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeWhenOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const toggle = (nextValue: string) => {
    onChange(selectedValues.has(nextValue)
      ? values.filter((value) => value !== nextValue)
      : [...values, nextValue]);
  };
  const selectAll = () => onChange(availableOptions.map((option) => option.value));

  return <div className={`searchable-select searchable-multi-select ${className} ${open ? "open" : ""}`} ref={rootRef}>
    <button type="button" className="searchable-select-trigger" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => { if (!disabled) { setOpen((current) => !current); setQuery(""); } }}>
      <span title={summary}>{summary}</span><i aria-hidden="true">⌄</i>
    </button>
    {open && <div className="searchable-select-menu" role="listbox" aria-label={`${ariaLabel}选项`} aria-multiselectable="true">
      <div className="searchable-select-menu-head"><strong>{ariaLabel}</strong><span><button type="button" onClick={selectAll} disabled={availableOptions.length === 0 || selectedOptions.length === availableOptions.length}>全选</button><button type="button" onClick={() => onChange([])} disabled={selectedOptions.length === 0}>清空</button></span></div>
      <label className="searchable-select-search"><span aria-hidden="true">⌕</span><input autoFocus type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} aria-label={`搜索${ariaLabel}`} /></label>
      <div className="searchable-select-options searchable-multi-select-options">
        <button type="button" className={selectedOptions.length === 0 ? "selected" : ""} role="option" aria-selected={selectedOptions.length === 0} onClick={() => onChange([])}><span className="searchable-multi-check" aria-hidden="true">{selectedOptions.length === 0 ? "✓" : ""}</span><span title={allLabel}>{allLabel}</span></button>
        {visibleOptions.map((option) => { const selected = selectedValues.has(option.value); return <button type="button" key={`${option.value}-${option.label}`} className={selected ? "selected" : ""} role="option" aria-selected={selected} disabled={option.disabled} onClick={() => toggle(option.value)}><span className="searchable-multi-check" aria-hidden="true">{selected ? "✓" : ""}</span><span title={option.label}>{option.label}</span></button>; })}
        {visibleOptions.length === 0 && <p>{emptyLabel}</p>}
      </div>
    </div>}
  </div>;
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
const formatWorkflowRecordedAt = (value?: string | null) => {
  if (!value) return "—";
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
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
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const query = new URLSearchParams({ range: apiRange });
      if (apiRange === "custom") { query.set("startDate", customStartDate); query.set("endDate", customEndDate); }
      const [salesResponse, inventoryResponse] = await Promise.all([fetch(`/api/sales/summary?${query}`, { cache: "no-store" }), fetch("/api/inventory/overview", { cache: "no-store" })]);
      const salesPayload = await salesResponse.json().catch(() => null) as SalesSummaryResponse | null;
      const inventoryPayload = await inventoryResponse.json().catch(() => null) as InventoryOverviewResponse | null;
      if (!salesResponse.ok || !salesPayload?.current || !inventoryResponse.ok || !inventoryPayload?.metrics) throw new Error("经营数据读取失败");
      setSales(salesPayload); setInventory(inventoryPayload);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "暂时无法读取经营看板"); }
    finally { setLoading(false); }
  }, [apiRange, customEndDate, customStartDate]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load, retryKey]);
  if (loading && !sales) return <section className="panel data-state" role="status"><span className="state-spinner" /><strong>正在同步 BI 经营看板</strong><p>正在汇总销售、网店与库存数据…</p></section>;
  if (!sales || !inventory) return <section className="panel data-state data-state-error" role="alert"><span className="state-symbol">!</span><strong>BI 看板加载失败</strong><p>{error || "暂时无法读取经营数据"}</p><button className="secondary-button" onClick={() => setRetryKey((value) => value + 1)}>重新加载</button></section>;
  const current = sales.current; const previous = sales.previous; const yearAgo = sales.yearAgo;
  const daily = sales.daily ?? []; const maxSales = Math.max(1, ...daily.map((item) => Math.max(0, item.netSalesCents))); const maxProfit = Math.max(1, ...daily.map((item) => Math.max(0, item.grossProfitCents)));
  const outlets = [...(sales.outlets ?? [])].sort((left, right) => right.netSalesCents - left.netSalesCents).slice(0, 5);
  const healthScore = Math.max(0, Math.min(100, 100 - inventory.metrics.urgentCount * 8 - inventory.health.stagnant * 2));
  return <><section className="dashboard-sync-bar"><span><Dot tone="green" />已同步经营数据</span><strong>{sales.startDate} 至 {sales.endDate}</strong><small>销售批次 {sales.latestBatch?.fileName ?? "暂无"} · 库存快照 {inventory.sync.inventoryAsOf ?? "暂无"}</small><button className="row-action" onClick={() => void load()} disabled={loading}>{loading ? "同步中…" : "↻ 刷新"}</button></section><section className="metrics-grid"><MetricCard label="净销售额" value={formatCurrencyFromCents(current.netSalesCents)} change={formatChange(current.netSalesCents, previous?.netSalesCents)} hint={comparisonHint(current.netSalesCents, previous?.netSalesCents, yearAgo?.netSalesCents)} tone="blue" /><MetricCard label="订单毛利" value={formatCurrencyFromCents(current.grossProfitCents)} change={formatChange(current.grossProfitCents, previous?.grossProfitCents)} hint={comparisonHint(current.grossProfitCents, previous?.grossProfitCents, yearAgo?.grossProfitCents)} tone="green" /><MetricCard label="综合大毛利率" value={formatRate(current.grossMarginRate)} change={formatChange(rateAsPercent(current.grossMarginRate), rateAsPercent(previous?.grossMarginRate))} hint={comparisonHint(rateAsPercent(current.grossMarginRate), rateAsPercent(previous?.grossMarginRate), rateAsPercent(yearAgo?.grossMarginRate))} tone="purple" /><MetricCard label="销售退货率" value={formatRate(current.refundRate)} change={formatChange(rateAsPercent(current.refundRate), rateAsPercent(previous?.refundRate))} hint={comparisonHint(rateAsPercent(current.refundRate), rateAsPercent(previous?.refundRate), rateAsPercent(yearAgo?.refundRate))} tone="orange" /></section><section className="dashboard-main-grid"><article className="panel trend-panel"><SectionHeader title="销售与毛利趋势" note="按当前统计周期内的已导入日度明细汇总" /><div className="chart-legend"><span><Dot tone="blue" />净销售额</span><span><Dot tone="green" />订单毛利</span></div><div className="bar-chart">{daily.map((item, index) => <div className="bar-group" key={item.date}><div className="bar-stack"><span className="bar sales-bar" style={{ height: `${Math.max(2, Math.max(0, item.netSalesCents) / maxSales * 100)}%` }} /><span className="bar profit-bar" style={{ height: `${Math.max(2, Math.max(0, item.grossProfitCents) / maxProfit * 100)}%` }} /></div><small>{daily.length <= 7 || index % Math.ceil(daily.length / 7) === 0 ? item.date.slice(5) : ""}</small></div>)}</div><div className="chart-summary"><div><span>日均净销售额</span><strong>{formatCurrencyFromCents(daily.length ? current.netSalesCents / daily.length : 0)}</strong></div><div><span>活跃网店</span><strong>{formatCount((sales.outlets ?? []).length)} 个</strong></div><div><span>库存健康度</span><strong className={healthScore < 70 ? "orange-text" : "green-text"}>{healthScore} 分</strong></div></div></article><article className="panel alert-panel"><SectionHeader title="库存预警中心" note="来自最新库存快照与销售需求联动" /><div className="alert-score"><div className="score-ring"><strong>{healthScore}</strong><small>健康分</small></div><div><strong>{healthScore >= 80 ? "整体经营稳定" : "建议关注库存风险"}</strong><p>库存快照 {inventory.sync.inventoryAsOf ?? "未同步"}</p></div></div><div className="alert-list"><button><span className="alert-icon danger">!</span><span><b>紧急补货</b><small>可售天数低于预警线的货品</small></span><em>{formatCount(inventory.metrics.urgentCount)}</em></button><button><span className="alert-icon warning">↓</span><span><b>建议补货</b><small>销量需求与可用库存计算得出</small></span><em>{formatCount(inventory.metrics.replenishCount)}</em></button><button><span className="alert-icon purple">◷</span><span><b>低动销库存</b><small>当前未匹配销售需求的库存商品</small></span><em>{formatCount(inventory.metrics.noSalesCount)}</em></button></div></article></section><section className="dashboard-bottom-grid"><article className="panel"><SectionHeader title="网店经营排行" note="按销售净额排序" /><div className="rank-list">{outlets.map((outlet, index) => <div className="rank-row" key={outlet.name}><span className={`rank-number rank-${index + 1}`}>{index + 1}</span><div className="shop-avatar">{outlet.platform.slice(0, 1)}</div><div className="rank-name"><strong>{outlet.name}</strong><small>{outlet.platform} · {formatCount(outlet.orderCount)} 单</small></div><div className="mini-progress"><i style={{ width: `${Math.max(4, outlet.shareRate * 100)}%` }} /></div><div className="rank-value"><strong>{formatCurrencyFromCents(outlet.netSalesCents)}</strong><small className={outlet.salesYearOverYearRate !== null && outlet.salesYearOverYearRate < 0 ? "red-text" : "green-text"}>{formatYearOverYear(outlet.salesYearOverYearRate)}</small></div></div>)}{outlets.length === 0 && <div className="table-state">当前周期没有可展示的网店数据。</div>}</div></article><article className="panel todo-panel"><SectionHeader title="数据同步状态" note="所有分析以最近成功导入为准" /><div className="dashboard-data-status"><div><span>销售明细</span><strong>{sales.latestBatch?.fileName ?? "未导入"}</strong><small>{sales.latestBatch?.completedAt ? formatDateTime(sales.latestBatch.completedAt) : "请前往数据导入"}</small></div><div><span>库存快照</span><strong>{inventory.sync.latestInventoryFile ?? "未导入"}</strong><small>{inventory.sync.inventoryAsOf ?? "请前往库存管理同步"}</small></div><div><span>销售需求匹配</span><strong>{formatRate(inventory.metrics.salesDemandMatchRate)}</strong><small>库存商品已匹配销售需求的比例</small></div></div></article></section></>;
}

type StoreGranularity = "day" | "week" | "month";
type StoreComparisonMode = "period" | "year";
type StorePeriodRow = SalesStats & { key: string; label: string };

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
    <strong>{value}</strong>
    <small className={change === null || change === undefined ? "muted-text" : change < 0 ? "red-text" : "green-text"}>{note ?? (change === null || change === undefined ? "暂无可比数据" : `${change >= 0 ? "+" : ""}${(change * 100).toFixed(1)}%`)}</small>
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
  outlets: SalesChannel[];
  selectedOutletKeys: string[];
}) {
  const [performance, setPerformance] = useState<NetshopProductPerformanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const selectedOutlets = useMemo(
    () => selectedOutletKeys.length === 0 ? [] : outlets.filter((item) => selectedOutletKeys.includes(item.groupKey)),
    [outlets, selectedOutletKeys],
  );
  const scope = useMemo(() => ({
    platforms: [...new Set(selectedOutlets.map((item) => item.platform).filter((item) => item && item !== "未分类"))],
    shops: [...new Set(selectedOutlets.map((item) => item.name).filter(Boolean))],
  }), [selectedOutlets]);
  const scopeKey = `${scope.platforms.join("\u0001")}\u0002${scope.shops.join("\u0001")}`;

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      setLoading(true);
      setError("");
      setPerformance(null);
      try {
        const params = new URLSearchParams({ dimension: "spu", page: "1", pageSize: "1", startDate, endDate });
        scope.platforms.forEach((platform) => params.append("platform", platform));
        scope.shops.forEach((shop) => params.append("shop", shop));
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
  }, [endDate, scopeKey, startDate]);

  if (loading) return <StoreMetricCard label="访客" value="同步中…" note="正在汇总已导入 SPU 商品访客" />;
  if (error || !performance?.dataCutoffDate) return <StoreMetricCard label="访客" value="—" note={error ? "未获取到匹配店铺的 SPU 日数据" : "待导入匹配店铺的 SPU 日数据"} unavailable />;

  const sourceVisitors = performance.summary.visitors;
  const estimatedVisitors = Math.round(sourceVisitors * 0.9);
  const scopeNote = selectedOutletKeys.length === 0
    ? `全部已导入 SPU 店铺 · 截止 ${performance.dataCutoffDate}`
    : `已匹配 ${formatCount(performance.shops.length)} 个店铺 · 截止 ${performance.dataCutoffDate}`;
  return <StoreMetricCard label="访客" value={formatCount(estimatedVisitors)} note={`SPU 商品访客 ${formatCount(sourceVisitors)} × 0.9 · ${scopeNote}`} />;
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
  { key: "promotionSpend", label: "推广花费", available: false },
  { key: "promotionShare", label: "推广占比", available: false },
  { key: "retailShare", label: "零售占比", available: false },
  { key: "b2bShare", label: "B 端占比", available: false },
  { key: "promotionClicks", label: "推广点击数", available: false },
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
  outlets: SalesChannel[];
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
  const columnPickerRef = useRef<HTMLDivElement>(null);
  const current = summary.current;
  const baseline = comparisonMode === "period" ? summary.previous : summary.yearAgo;
  const comparisonLabel = comparisonMode === "period" ? "环比" : "同比";
  const rows = useMemo(() => aggregateStorePeriods(summary.daily ?? [], granularity), [granularity, summary.daily]);
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
  const selectedOutlets = outlets.filter((item) => selectedOutletKeys.includes(item.groupKey));
  const selectedOutletLabel = selectedOutlets.length === 0
    ? "全部平台与店铺"
    : selectedOutlets.length === 1
      ? `${selectedOutlets[0].platform} · ${selectedOutlets[0].name}`
      : `已选 ${formatCount(selectedOutlets.length)} 个店铺`;
  const daily = summary.daily ?? [];
  const dataCutoff = daily.length > 0 ? daily[daily.length - 1].date : "暂无";
  const matchedStoreColumns = useMemo(() => {
    const keyword = columnPickerSearch.trim().toLocaleLowerCase("zh-CN");
    if (!keyword) return storeTableColumns;
    return storeTableColumns.filter((column) => column.label.toLocaleLowerCase("zh-CN").includes(keyword));
  }, [columnPickerSearch]);

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
      <div><span className="source-status-ready">✓ 已接入</span><strong>销售净额、订单量、客单价、毛利率、退货率、SPU 访客</strong></div>
      <div><span className="source-status-missing">○ 待接入</span><strong>UV、推广、企业购/零售拆分</strong></div>
      <p>访客按已导入 SPU 商品访客 × 0.9 估算；其余流量与推广字段不会用订单数据反推。</p>
    </section>

    <section className="store-metrics-grid">
      <StoreSpuVisitorMetric startDate={summary.startDate} endDate={summary.endDate} outlets={outlets} selectedOutletKeys={selectedOutletKeys} />
      <StoreMetricCard label="销售额（净额）" value={formatCurrencyFromCents(current.netSalesCents)} change={salesChange} note={showComparison ? `${comparisonLabel} ${formatStoreComparison(current.netSalesCents, baseline?.netSalesCents)}` : "来自已导入销售明细"} />
      <StoreMetricCard label="客单价" value={formatCurrencyFromCents(currentAov)} change={aovChange} note={showComparison ? `${comparisonLabel} ${formatStoreComparison(currentAov, baselineAov)}` : `${formatCount(current.orderCount)} 笔订单`} />
      <StoreMetricCard label="UV 价值" value="—" note="缺少访客数据，不做推算" unavailable />
      <StoreMetricCard label="转化率" value="—" note="需访客与成交人数" unavailable />
      <StoreMetricCard label="推广花费" value="—" note="待接入推广报表" unavailable />
      <StoreMetricCard label="推广占比" value="—" note="需推广花费与销售口径" unavailable />
      <StoreMetricCard label="零售占比" value="—" note="待接入订单类型标记" unavailable />
      <StoreMetricCard label="B 端占比" value="—" note="待接入企业购明细" unavailable />
      <StoreMetricCard label="推广点击数" value="—" note="待接入推广点击明细" unavailable />
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
  { key: "visitors", label: "访客数", available: true },
  { key: "transactionCustomers", label: "成交人数", available: true },
  { key: "transactionQuantity", label: "成交商品件数", available: true },
  { key: "addCartCustomers", label: "加购人数", available: true },
  { key: "addCartQuantity", label: "加购商品件数", available: true },
  { key: "transactionAmount", label: "成交金额", available: true },
  { key: "uvValue", label: "UV价值", available: true },
  { key: "conversionRate", label: "总转化率", available: true },
  { key: "searchImpressions", label: "搜索曝光次数", available: true },
  { key: "searchClicks", label: "搜索点击次数", available: true },
  { key: "searchClickRate", label: "搜索点击率", available: true },
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
  return <ProductPerformancePendingCell />;
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
  const [selectedShops, setSelectedShops] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [periodPreset, setPeriodPreset] = useState<ProductPeriodPreset>(() => productPeriodPresetForRange(range));
  const [customPeriodStart, setCustomPeriodStart] = useState(() => skuSalesPeriod(range, customStartDate, customEndDate).startDate);
  const [customPeriodEnd, setCustomPeriodEnd] = useState(() => skuSalesPeriod(range, customStartDate, customEndDate).endDate);
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
  const debouncedQuery = useDebouncedValue(query, 280);
  const basePeriod = useMemo(
    () => skuSalesPeriod(range, customStartDate, customEndDate),
    [customEndDate, customStartDate, range],
  );
  const selectedPeriod = useMemo(() => {
    const customPeriod = customPeriodStart <= customPeriodEnd
      ? { startDate: customPeriodStart, endDate: customPeriodEnd }
      : basePeriod;
    return productPeriodForPreset(periodPreset, periodPreset === "custom" ? customPeriod : basePeriod);
  }, [basePeriod, customPeriodEnd, customPeriodStart, periodPreset]);
  const comparisonPeriod = useMemo(
    () => showComparison ? productComparisonPeriod(selectedPeriod, comparisonMode) : null,
    [comparisonMode, selectedPeriod, showComparison],
  );
  const dimensionLabel = dimension === "sku" ? "SKU" : "SPU";
  const importLabel = dimension === "sku" ? "京东商品 SKU 日数据" : "京东商品 SPU 日数据";
  const comparisonLabel = comparisonMode === "period" ? "环比" : "同比";
  const comparisonItemById = useMemo(
    () => new Map((performance?.comparison?.items ?? []).map((item) => [item.id, item])),
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
    const nextPeriod = skuSalesPeriod(range, customStartDate, customEndDate);
    setPeriodPreset(productPeriodPresetForRange(range));
    setCustomPeriodStart(nextPeriod.startDate);
    setCustomPeriodEnd(nextPeriod.endDate);
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
      selectedShops.forEach((shop) => params.append("shop", shop));
      const response = await fetch(`/api/netshop/product-performance?${params.toString()}`, { cache: "no-store" });
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
      setPerformance({ current, comparison });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : `暂时无法读取 ${dimensionLabel} 商品表现`);
    } finally {
      setLoading(false);
    }
  }, [comparisonPeriod, debouncedQuery, dimension, dimensionLabel, page, selectedPeriod, selectedPlatforms, selectedShops]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, retryKey]);

  if (loading && !performance) {
    return <section className="panel data-state" role="status"><span className="state-spinner" /><strong>正在读取京东商智 {dimensionLabel} 日数据</strong><p>正在按当前统计周期汇总商品、店铺与经营指标…</p></section>;
  }
  if (error && !performance) {
    return <section className="panel data-state data-state-error" role="alert"><span className="state-symbol">!</span><strong>{dimensionLabel} 商品表现加载失败</strong><p>{error}</p><button className="secondary-button" onClick={() => setRetryKey((value) => value + 1)}>重新加载</button></section>;
  }
  if (!performance || !performance.current.dataCutoffDate) {
    return <section className="panel data-state"><span className="state-symbol">京</span><strong>尚未读取到{importLabel}</strong><p>商品数据会按“日期 + {dimensionLabel} + 店铺”汇总，并与京东商品页直接关联；导入完成后可在这里按平台、店铺或关键词查看。</p><button className="primary-button" onClick={() => onOpenImport(dimension)}>前往导入并同步{importLabel}</button></section>;
  }

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
    .map((shop) => ({ value: shop.shopName, label: shop.shopName, searchText: `${shop.shopName} ${shop.platform}` }));
  const tableColSpan = visibleProductColumns.length + 6;

  return <>
    <section className="panel product-performance-filter-panel" aria-label="商品数据筛选条件">
      <label className="product-performance-select-field"><span>平台</span><SearchableMultiSelect values={selectedPlatforms} onChange={(values) => {
        const allowedShops = new Set(current.shops.filter((shop) => values.length === 0 || values.includes(shop.platform)).map((shop) => shop.shopName));
        setSelectedPlatforms(values);
        setSelectedShops((shops) => shops.filter((shop) => allowedShops.has(shop)));
        setPage(1);
      }} ariaLabel={`选择${dimensionLabel}分析平台`} allLabel="全部平台" searchPlaceholder="搜索平台" options={platformOptions} /></label>
      <label className="product-performance-select-field"><span>店铺</span><SearchableMultiSelect values={selectedShops} onChange={(values) => { setSelectedShops(values); setPage(1); }} ariaLabel={`选择${dimensionLabel}分析店铺`} allLabel="全部店铺" searchPlaceholder="搜索店铺或平台" options={availableShopOptions} /></label>
      <div className="product-period-control"><span>日期</span><div className="segmented" role="group" aria-label="商品数据统计周期"><button type="button" className={periodPreset === "day" ? "active" : ""} onClick={() => { setPeriodPreset("day"); setPage(1); }}>日</button><button type="button" className={periodPreset === "week" ? "active" : ""} onClick={() => { setPeriodPreset("week"); setPage(1); }}>周</button><button type="button" className={periodPreset === "month" ? "active" : ""} onClick={() => { setPeriodPreset("month"); setPage(1); }}>月</button><button type="button" className={periodPreset === "custom" ? "active" : ""} onClick={() => { setPeriodPreset("custom"); setPage(1); }}>自定义</button></div></div>
      {periodPreset === "custom" && <div className="product-period-custom"><label><span>开始</span><input type="date" value={customPeriodStart} onChange={(event) => { setCustomPeriodStart(event.target.value); setPage(1); }} /></label><label><span>结束</span><input type="date" value={customPeriodEnd} onChange={(event) => { setCustomPeriodEnd(event.target.value); setPage(1); }} /></label></div>}
      <label className="product-performance-check"><input type="checkbox" checked={showComparison} onChange={(event) => setShowComparison(event.target.checked)} /><span>显示对比数据</span></label>
      <label className="product-performance-check"><input type="checkbox" checked={showActual} disabled={!showComparison} onChange={(event) => setShowActual(event.target.checked)} /><span>显示对比值</span></label>
      <div className="product-compare-control"><span>对比时间</span><div className="segmented" role="group" aria-label="商品数据对比口径"><button type="button" className={comparisonMode === "period" ? "active" : ""} disabled={!showComparison} onClick={() => setComparisonMode("period")}>环比</button><button type="button" className={comparisonMode === "year" ? "active" : ""} disabled={!showComparison} onClick={() => setComparisonMode("year")}>同比</button></div></div>
    </section>

    <section className="panel netshop-performance-hero">
      <div><span className="eyebrow">JD BUSINESS INTELLIGENCE</span><h2>{dimensionLabel} 商品表现</h2><p>直接汇总已导入的京东商智商品明细日数据；金额保留商智原始口径（元），不以销售订单明细替代。</p></div>
      <div className="netshop-performance-actions"><span><Dot tone="green" />数据截止 {current.dataCutoffDate}</span><button type="button" className="secondary-button" onClick={() => void load()} disabled={loading}>{loading ? "刷新中…" : "↻ 刷新"}</button><button type="button" className="primary-button" onClick={() => onOpenImport(dimension)}>＋ 导入并同步{dimensionLabel}日数据</button></div>
    </section>
    <section className="netshop-performance-source"><span><Dot tone="blue" />已关联 {current.dataset === "sku_daily" ? "商智 SKU" : "商智 SPU"} 日数据</span><strong>{periodLabel}</strong><small>当前筛选周期 {selectedPeriod.startDate} 至 {selectedPeriod.endDate}{comparisonPeriod ? ` · ${comparisonLabel} ${comparisonPeriod.startDate} 至 ${comparisonPeriod.endDate}` : ""}。</small></section>
    <section className="store-source-status product-performance-source-status" role="note">
      <div><span className="source-status-ready">✓ 已接入</span><strong>访客、成交、加购、搜索、UV 价值、转化率</strong></div>
      <div><span className="source-status-missing">○ 待接入</span><strong>推广、企业购/零售、付费/免费访客</strong></div>
      <p>以下 KPI 随当前 {dimensionLabel}、平台、店铺和日期筛选同步汇总；金额采用京东商智成交口径。</p>
    </section>
    <section className="store-metrics-grid product-performance-kpi-grid" aria-label={`${dimensionLabel} 商品数据 KPI`}>
      <StoreMetricCard label="访客" value={formatCount(current.summary.visitors)} change={showComparison ? productComparisonRate(current.summary.visitors, comparisonSummary?.visitors) : null} note={productKpiNote("商智商品访客", current.summary.visitors, comparisonSummary?.visitors)} />
      <StoreMetricCard label="成交金额" value={formatMerchantCurrency(current.summary.transactionAmount)} change={showComparison ? productComparisonRate(current.summary.transactionAmount, comparisonSummary?.transactionAmount) : null} note={productKpiNote("商智成交金额，不等同销售净额", current.summary.transactionAmount, comparisonSummary?.transactionAmount)} />
      <StoreMetricCard label="客单价" value={formatMerchantCurrency(currentAverageTransactionValue)} change={showComparison ? productComparisonRate(currentAverageTransactionValue, comparisonAverageTransactionValue) : null} note={currentAverageTransactionValue === null ? "当前周期没有成交人数" : productKpiNote("成交金额 / 成交人数", currentAverageTransactionValue, comparisonAverageTransactionValue)} unavailable={currentAverageTransactionValue === null} />
      <StoreMetricCard label="UV 价值" value={formatMerchantCurrency(current.summary.uvValue)} change={showComparison ? productComparisonRate(current.summary.uvValue, comparisonSummary?.uvValue) : null} note={current.summary.uvValue === null ? "当前导入日数据未提供" : productKpiNote("商智 UV 价值", current.summary.uvValue, comparisonSummary?.uvValue)} unavailable={current.summary.uvValue === null} />
      <StoreMetricCard label="转化率" value={formatOptionalRate(current.summary.conversionRate)} change={showComparison ? productComparisonRate(current.summary.conversionRate, comparisonSummary?.conversionRate) : null} note={current.summary.conversionRate === null ? "当前导入日数据未提供" : productKpiNote("商智总转化率", current.summary.conversionRate, comparisonSummary?.conversionRate)} unavailable={current.summary.conversionRate === null} />
      <StoreMetricCard label="推广花费" value="—" note="待接入推广报表" unavailable />
      <StoreMetricCard label="推广占比" value="—" note="需推广花费与成交口径" unavailable />
      <StoreMetricCard label="零售占比" value="—" note="待接入订单类型标记" unavailable />
      <StoreMetricCard label="B 端占比" value="—" note="待接入企业购明细" unavailable />
      <StoreMetricCard label="推广点击数" value="—" note="待接入推广点击明细" unavailable />
      <StoreMetricCard label="付费访客" value="不推算" note="避免用点击数替代访客" unavailable />
      <StoreMetricCard label="免费访客" value="不推算" note="需平台自然流量数据" unavailable />
    </section>
    {error && <section className="inventory-feedback inventory-feedback-error" role="alert"><span>!</span><div><strong>数据刷新失败</strong><p>{error}</p></div><button className="row-action" onClick={() => setRetryKey((value) => value + 1)}>重试</button></section>}
    <section className="panel table-panel netshop-performance-table-panel">
      <div className="table-toolbar netshop-performance-toolbar"><div><h2>{dimensionLabel} 商品明细</h2><p>商智已接入指标可显示{comparisonLabel}百分比；推广与企业购指标保留为待接入列，不会以零值替代。</p></div><div className="netshop-performance-toolbar-actions"><span className="soft-tag">{formatCount(current.summary.productCount)} 个商品</span><label className="jd-sku-search"><span>⌕</span><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder={`搜索 ${dimensionLabel}、商品编码或名称`} aria-label={`搜索${dimensionLabel}商品表现`} /></label><div className={`store-column-picker product-performance-column-picker ${columnPickerOpen ? "open" : ""}`} ref={columnPickerRef}><button type="button" className="store-column-picker-trigger" aria-haspopup="dialog" aria-expanded={columnPickerOpen} onClick={() => { setColumnPickerOpen((open) => !open); setColumnPickerSearch(""); }}><span>☷</span>列设置 <em>{visibleColumns.length}/{productPerformanceColumns.length}</em></button>{columnPickerOpen && <div className="store-column-picker-menu" role="dialog" aria-label="选择商品明细指标"><div className="store-column-picker-head"><div><strong>显示指标</strong><small>商品信息、店铺名称和数据覆盖固定显示，至少保留 1 个指标</small></div><button type="button" onClick={() => setColumnPickerOpen(false)} aria-label="关闭列设置">×</button></div><div className="store-column-picker-actions"><button type="button" onClick={() => setVisibleColumns(productPerformanceColumns.map((column) => column.key))}>全选</button><button type="button" onClick={() => setVisibleColumns(connectedProductPerformanceColumns)}>仅商智已接入</button></div><label className="store-column-picker-search">⌕<input autoFocus type="search" value={columnPickerSearch} onChange={(event) => setColumnPickerSearch(event.target.value)} placeholder="搜索指标" aria-label="搜索商品明细指标" /></label><div className="store-column-picker-options">{matchedProductColumns.map((column) => { const checked = visibleColumns.includes(column.key); return <label key={column.key} className={checked ? "selected" : ""}><input type="checkbox" checked={checked} disabled={checked && visibleColumns.length === 1} onChange={() => toggleProductColumn(column.key)} /><span>{column.label}</span><em className={column.available ? "available" : "pending"}>{column.available ? "商智已接入" : "待接入"}</em></label>; })}{matchedProductColumns.length === 0 && <p className="store-column-picker-empty">没有匹配的指标</p>}</div></div>}</div></div></div>
      <div className="data-table-wrap netshop-performance-detail-scroll"><table className="data-table netshop-performance-data-table" style={{ minWidth: `${Math.max(1680, 850 + visibleProductColumns.length * 116)}px` }}><thead><tr><th>{dimensionLabel} ID</th><th>商品名称 / 编码</th><th>店铺名称</th><th>类目</th>{visibleProductColumns.map((column) => <th key={column.key}>{column.label}</th>)}<th>数据覆盖</th><th>操作</th></tr></thead><tbody>{current.items.map((item) => { const productUrl = /^\d{5,}$/.test(item.id) ? `https://item.jd.com/${item.id}.html` : ""; const compared = comparisonItemById.get(item.id); return <tr key={item.id}><td><div className="netshop-product-id"><strong>{item.id || "—"}</strong><small>{dimension === "sku" && item.spuId ? `SPU ${item.spuId}` : dimension === "spu" && item.skuId ? `SKU ${item.skuId}` : "商智商品标识"}</small></div></td><td><div className="jd-sku-product-name"><strong title={item.productName}>{item.productName || "未命名商品"}</strong><small>{item.productCode || "未提供商品编码"}</small></div></td><td><span className="netshop-shop-list" title={item.shopNames.join("、")}>{item.shopNames.join("、") || "—"}</span></td><td><span className="jd-sku-category" title={item.category}>{item.category || "—"}</span></td>{visibleProductColumns.map((column) => <td key={column.key}><ProductPerformanceDataCell column={column} item={item} compared={compared} showComparison={showComparison} showActual={showActual} comparisonLabel={comparisonLabel} /></td>)}<td><div className="netshop-data-coverage"><strong>{item.dateMin && item.dateMax ? `${item.dateMin.slice(5)} ~ ${item.dateMax.slice(5)}` : "—"}</strong><small>{formatCount(item.dataDays)} 天</small></div></td><td>{productUrl ? <a className="netshop-product-link" href={productUrl} target="_blank" rel="noreferrer">打开商品 ↗</a> : <span className="muted-text">无可用链接</span>}</td></tr>; })}{!loading && current.items.length === 0 && <tr><td colSpan={tableColSpan}><div className="table-state">当前筛选条件下没有可展示的 {dimensionLabel} 商品数据。</div></td></tr>}{loading && <tr><td colSpan={tableColSpan}><div className="table-state"><span className="state-spinner" />正在刷新商品表现…</div></td></tr>}</tbody></table></div>
      <footer className="jd-sku-pagination"><span>第 {pagination.page} / {totalPages} 页</span><div><button type="button" className="row-action" disabled={loading || pagination.page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button><button type="button" className="row-action" disabled={loading || pagination.page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>下一页</button></div></footer>
    </section>
  </>;
}

function LegacyShopDailyProductPerformanceView({
  dimension,
  onOpenImport,
  range,
  customStartDate,
  customEndDate,
}: {
  dimension: NetshopProductPerformanceDimension;
  onOpenImport: () => void;
  range: SalesRangeLabel;
  customStartDate: string;
  customEndDate: string;
}) {
  const [performance, setPerformance] = useState<NetshopProductPerformanceResponse | null>(null);
  const [query, setQuery] = useState("");
  const [selectedShops, setSelectedShops] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const debouncedQuery = useDebouncedValue(query, 280);
  const period = useMemo(
    () => skuSalesPeriod(range, customStartDate, customEndDate),
    [customEndDate, customStartDate, range],
  );
  const dimensionLabel = dimension === "sku" ? "SKU" : "SPU";
  const importLabel = dimension === "sku" ? "京东商品 SKU 日数据" : "京东商品 SPU 日数据";

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        dimension,
        page: String(page),
        pageSize: "50",
        startDate: period.startDate,
        endDate: period.endDate,
      });
      if (debouncedQuery) params.set("q", debouncedQuery);
      selectedShops.forEach((shop) => params.append("shop", shop));
      const response = await fetch(`/api/netshop/product-performance?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null) as (NetshopProductPerformanceResponse & { error?: string }) | null;
      if (!response.ok || !payload?.summary || !Array.isArray(payload.items)) {
        throw new Error(payload?.error || `${dimensionLabel} 商品表现读取失败（${response.status}）`);
      }
      setPerformance(payload);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : `暂时无法读取 ${dimensionLabel} 商品表现`);
    } finally {
      setLoading(false);
    }
  }, [debouncedQuery, dimension, dimensionLabel, page, period.endDate, period.startDate, selectedShops]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, retryKey]);

  if (loading && !performance) {
    return <section className="panel data-state" role="status"><span className="state-spinner" /><strong>正在读取京东商智 {dimensionLabel} 日数据</strong><p>正在按当前统计周期汇总商品、店铺与经营指标…</p></section>;
  }
  if (error && !performance) {
    return <section className="panel data-state data-state-error" role="alert"><span className="state-symbol">!</span><strong>{dimensionLabel} 商品表现加载失败</strong><p>{error}</p><button className="secondary-button" onClick={() => setRetryKey((value) => value + 1)}>重新加载</button></section>;
  }
  if (!performance || !performance.dataCutoffDate) {
    return <section className="panel data-state"><span className="state-symbol">京</span><strong>尚未读取到{importLabel}</strong><p>商品数据会按“日期 + {dimensionLabel} + 店铺”汇总，并与京东商品页直接关联；导入完成后可在这里按店铺或关键词查看。</p><button className="primary-button" onClick={onOpenImport}>前往导入{importLabel}</button></section>;
  }

  const { summary, pagination } = performance;
  const totalPages = Math.max(1, Math.ceil(pagination.total / pagination.pageSize));
  const periodLabel = performance.dateMin && performance.dataCutoffDate
    ? `${performance.dateMin} 至 ${performance.dataCutoffDate}`
    : "暂无覆盖日期";
  return <>
    <section className="panel netshop-performance-hero">
      <div><span className="eyebrow">JD BUSINESS INTELLIGENCE</span><h2>{dimensionLabel} 商品表现</h2><p>直接汇总已导入的京东商智商品明细日数据；金额保留商智原始口径（元），不以销售订单明细替代。</p></div>
      <div className="netshop-performance-actions"><span><Dot tone="green" />数据截止 {performance.dataCutoffDate}</span><button type="button" className="secondary-button" onClick={() => void load()} disabled={loading}>{loading ? "刷新中…" : "↻ 刷新"}</button><button type="button" className="primary-button" onClick={onOpenImport}>＋ 导入{dimensionLabel}日数据</button></div>
    </section>
    <section className="netshop-performance-source"><span><Dot tone="blue" />已关联 {performance.dataset === "sku_daily" ? "商智 SKU" : "商智 SPU"} 日数据</span><strong>{periodLabel}</strong><small>当前筛选周期 {period.startDate} 至 {period.endDate} · 店铺、商品和指标均来自已导入数据。</small></section>
    <section className="metrics-grid legacy-netshop-performance-metrics">
      <MetricCard label={`${dimensionLabel} 商品数`} value={`${formatCount(summary.productCount)} 个`} change="当前筛选" hint={`共 ${formatCount(pagination.total)} 个匹配商品`} tone="blue" />
      <MetricCard label="商品浏览量" value={formatCount(summary.pageViews)} change="商智指标" hint={`访客数 ${formatCount(summary.visitors)}`} tone="purple" />
      <MetricCard label="成交金额" value={formatMerchantCurrency(summary.transactionAmount)} change="商智口径" hint={`下单金额 ${formatMerchantCurrency(summary.orderAmount)}`} tone="green" />
      <MetricCard label="成交商品件数" value={`${formatCount(summary.transactionQuantity)} 件`} change={summary.conversionRate === null ? "暂无访客口径" : `成交转化 ${formatRate(summary.conversionRate)}`} hint={`加购 ${formatCount(summary.addCartQuantity)} 件`} tone="orange" />
    </section>
    {error && <section className="inventory-feedback inventory-feedback-error" role="alert"><span>!</span><div><strong>数据刷新失败</strong><p>{error}</p></div><button className="row-action" onClick={() => setRetryKey((value) => value + 1)}>重试</button></section>}
    <section className="panel table-panel netshop-performance-table-panel">
      <div className="table-toolbar netshop-performance-toolbar"><div><h2>{dimensionLabel} 商品明细</h2><p>支持按店铺多选和商品 ID、名称、编码搜索；“打开商品”会跳转至对应京东商品页。</p></div><div className="netshop-performance-toolbar-actions"><label className="jd-sku-store-select"><span>店铺</span><SearchableMultiSelect values={selectedShops} onChange={(values) => { setSelectedShops(values); setPage(1); }} ariaLabel={`按店铺筛选${dimensionLabel}商品`} allLabel="全部店铺" searchPlaceholder="搜索店铺或平台" options={performance.shops.map((shop) => ({ value: shop.shopName, label: shop.shopName, searchText: `${shop.shopName} ${shop.platform}` }))} /></label><label className="jd-sku-search"><span>⌕</span><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder={`搜索 ${dimensionLabel}、商品编码或名称`} aria-label={`搜索${dimensionLabel}商品表现`} /></label></div></div>
      <div className="data-table-wrap"><table className="data-table netshop-performance-data-table"><thead><tr><th>{dimensionLabel} ID</th><th>商品名称 / 编码</th><th>关联店铺</th><th>类目</th><th>浏览量</th><th>访客数</th><th>加购件数</th><th>成交件数</th><th>成交金额</th><th>数据覆盖</th><th>操作</th></tr></thead><tbody>{performance.items.map((item) => { const productUrl = /^\d{5,}$/.test(item.id) ? `https://item.jd.com/${item.id}.html` : ""; return <tr key={item.id}><td><div className="netshop-product-id"><strong>{item.id || "—"}</strong><small>{dimension === "sku" && item.spuId ? `SPU ${item.spuId}` : dimension === "spu" && item.skuId ? `SKU ${item.skuId}` : "商智商品标识"}</small></div></td><td><div className="jd-sku-product-name"><strong title={item.productName}>{item.productName || "未命名商品"}</strong><small>{item.productCode || "未提供商品编码"}</small></div></td><td><span className="netshop-shop-list" title={item.shopNames.join("、")}>{item.shopNames.join("、") || "—"}</span></td><td><span className="jd-sku-category" title={item.category}>{item.category || "—"}</span></td><td>{formatCount(item.pageViews)}</td><td>{formatCount(item.visitors)}</td><td>{formatCount(item.addCartQuantity)}</td><td>{formatCount(item.transactionQuantity)}</td><td><strong>{formatMerchantCurrency(item.transactionAmount)}</strong></td><td><div className="netshop-data-coverage"><strong>{item.dateMin && item.dateMax ? `${item.dateMin.slice(5)} ~ ${item.dateMax.slice(5)}` : "—"}</strong><small>{formatCount(item.dataDays)} 天</small></div></td><td>{productUrl ? <a className="netshop-product-link" href={productUrl} target="_blank" rel="noreferrer">打开商品 ↗</a> : <span className="muted-text">无可用链接</span>}</td></tr>; })}{!loading && performance.items.length === 0 && <tr><td colSpan={11}><div className="table-state">当前筛选条件下没有可展示的 {dimensionLabel} 商品数据。</div></td></tr>}{loading && <tr><td colSpan={11}><div className="table-state"><span className="state-spinner" />正在刷新商品表现…</div></td></tr>}</tbody></table></div>
      <footer className="jd-sku-pagination"><span>第 {pagination.page} / {totalPages} 页</span><div><button type="button" className="row-action" disabled={loading || pagination.page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button><button type="button" className="row-action" disabled={loading || pagination.page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>下一页</button></div></footer>
    </section>
  </>;
}

type ShopProductDataTab = "sku" | "spu";

function ShopProductDataView({
  onOpenImport,
  range,
  customStartDate,
  customEndDate,
}: {
  onOpenImport: (dimension: NetshopProductPerformanceDimension) => void;
  range: SalesRangeLabel;
  customStartDate: string;
  customEndDate: string;
}) {
  const [activeTab, setActiveTab] = useState<ShopProductDataTab>("spu");
  return <>
    <section className="shop-product-data-tabs" role="tablist" aria-label="商品数据维度">
      <button type="button" role="tab" aria-selected={activeTab === "sku"} className={activeTab === "sku" ? "active" : ""} onClick={() => setActiveTab("sku")}>SKU</button>
      <button type="button" role="tab" aria-selected={activeTab === "spu"} className={activeTab === "spu" ? "active" : ""} onClick={() => setActiveTab("spu")}>SPU</button>
    </section>
    <ShopDailyProductPerformanceView key={activeTab} dimension={activeTab} range={range} customStartDate={customStartDate} customEndDate={customEndDate} onOpenImport={onOpenImport} />
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
  const [selectedShops, setSelectedShops] = useState<string[]>([]);
  const debouncedQuery = useDebouncedValue(query, 280);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const salesPeriod = useMemo(
    () => skuSalesPeriod(range, customStartDate, customEndDate),
    [customEndDate, customStartDate, range],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "50" });
      params.set("startDate", salesPeriod.startDate);
      params.set("endDate", salesPeriod.endDate);
      if (debouncedQuery) params.set("q", debouncedQuery);
      selectedShops.forEach((shop) => params.append("shop", shop));
      const response = await fetch("/api/netshop/products?" + params.toString(), { cache: "no-store" });
      const payload = await response.json().catch(() => null) as (JdSkuCatalogResponse & { error?: string }) | null;
      if (!response.ok || !payload?.summary || !Array.isArray(payload.items)) {
        throw new Error(payload?.error || "京东 SKU 数据读取失败（" + response.status + "）");
      }
      setCatalog(payload);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "暂时无法读取京东 SKU 数据");
    } finally {
      setLoading(false);
    }
  }, [debouncedQuery, page, salesPeriod.endDate, salesPeriod.startDate, selectedShops]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, retryKey]);

  if (loading && !catalog) {
    return <section className="panel data-state" role="status"><span className="state-spinner" /><strong>正在读取京东店铺商品 SKU</strong><p>正在加载最近一次成功导入的商品目录与当前统计周期经营指标…</p></section>;
  }
  if (error && !catalog) {
    return <section className="panel data-state data-state-error" role="alert"><span className="state-symbol">!</span><strong>京东 SKU 数据加载失败</strong><p>{error}</p><button className="secondary-button" onClick={() => setRetryKey((value) => value + 1)}>重新加载</button></section>;
  }
  if (!catalog?.batch) {
    return <section className="panel data-state"><span className="state-symbol">京</span><strong>尚未导入京东店铺商品 SKU</strong><p>请先上传京东后台“导出查询商品 → SKU 导出”生成的 Excel 文件；导入完成后会在这里展示 SKU 与经营指标。</p><button className="primary-button" onClick={onOpenImport}>前往导入京东 SKU</button></section>;
  }

  const { summary, pagination } = catalog;
  const totalPages = Math.max(1, Math.ceil(pagination.total / pagination.pageSize));
  const shops = catalog.shops ?? [];
  const sales = catalog.sales;
  return <>
    <section className="panel jd-sku-hero">
      <div><span className="eyebrow">JD PRODUCT CATALOG</span><h2>京东店铺商品 SKU</h2><p>商品目录来自最近一次成功导入的 SKU 文件；经营指标按顶部统计周期汇总京东平台已导入销售明细。</p></div>
      <div className="jd-sku-hero-actions"><span><Dot tone="green" />已同步 {catalog.batch.snapshotDate ?? "最新"} 快照</span><button type="button" className="secondary-button" onClick={() => void load()} disabled={loading}>{loading ? "刷新中…" : "↻ 刷新"}</button><button type="button" className="primary-button" onClick={onOpenImport}>＋ 导入新 SKU 文件</button></div>
    </section>
    <section className="metrics-grid jd-sku-metrics">
      <MetricCard label="SKU 总数" value={formatCount(summary.totalSkus) + " 个"} change="已同步" hint={"文件：" + catalog.batch.fileName} tone="blue" />
      <MetricCard label="上架 SKU" value={formatCount(summary.onSaleSkus) + " 个"} change="当前状态" hint="以京东商品状态字段为准" tone="green" />
      <MetricCard label="商品总库存" value={formatCount(summary.totalInventory)} change="最新快照" hint="SKU 商品总库存汇总" tone="purple" />
      <MetricCard label="商品可用库存" value={formatCount(summary.availableInventory)} change="最新快照" hint={"导入完成：" + formatDateTime(catalog.batch.completedAt)} tone="orange" />
    </section>
    {sales?.periodStart && sales?.periodEnd && <section className="jd-sku-sales-context"><strong>经营指标口径</strong><span>{sales.platform}平台已导入销售明细 · 统计周期 {sales.periodStart} 至 {sales.periodEnd} · 数据截止 {sales.dataCutoffDate ?? "暂无"}</span><small>成本价为当前周期销量加权成本；净销售额、毛利率与退货率均不按店铺名称推算。</small></section>}
    {error && <section className="inventory-feedback inventory-feedback-error" role="alert"><span>!</span><div><strong>数据刷新失败</strong><p>{error}</p></div><button className="row-action" onClick={() => setRetryKey((value) => value + 1)}>重试</button></section>}
    <section className="panel table-panel jd-sku-table-panel">
      <div className="table-toolbar jd-sku-toolbar"><div><h2>SKU 商品目录</h2><p>共 {formatCount(pagination.total)} 条；可按店铺名称、SKU、商品编码或商品名称搜索。</p></div><div className="jd-sku-toolbar-actions"><label className="jd-sku-store-select"><span>店铺</span><SearchableMultiSelect values={selectedShops} onChange={(values) => { setSelectedShops(values); setPage(1); }} ariaLabel="按店铺名称筛选" allLabel="全部店铺" searchPlaceholder="搜索店铺或平台" options={shops.map((shop) => ({ value: shop.shopName, label: shop.shopName || "未命名店铺", searchText: `${shop.shopName} ${shop.platform}` }))} /></label><label className="jd-sku-search"><span>⌕</span><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="搜索 SKU、商品编码或名称" aria-label="搜索京东商品 SKU" /></label></div></div>
      <div className="data-table-wrap"><table className="data-table jd-sku-data-table"><thead><tr><th>SKU图</th><th>店铺名称</th><th>SKU ID</th><th>商品编码</th><th>商品名称 / 销售属性</th><th>成本价</th><th>净销售额</th><th>大毛利率</th><th>退货率</th><th>类目</th><th>商品状态</th></tr></thead><tbody>{catalog.items.map((item) => { const link = item.productUrl ? (item.productUrl.startsWith("http") ? item.productUrl : "https://" + item.productUrl) : ""; const isOnSale = item.status === "上架"; const thumb = item.imageUrl ? <img className="jd-sku-thumb" src={item.imageUrl} alt={item.productName ? `${item.productName} SKU 主图` : "SKU 主图"} loading="lazy" referrerPolicy="no-referrer" /> : <span className="jd-sku-thumb jd-sku-thumb-missing" title="请在数据导入中补充京东 SKU 主图文件">暂无主图</span>; return <tr key={item.skuId}><td>{link ? <a className="jd-sku-thumb-link" href={link} target="_blank" rel="noreferrer">{thumb}</a> : thumb}</td><td><span className="jd-sku-shop-name" title={item.shopName}>{item.shopName || "未命名店铺"}</span></td><td>{link ? <a className="jd-sku-link" href={link} target="_blank" rel="noreferrer">{item.skuId}</a> : item.skuId || "—"}</td><td>{item.productCode || "—"}</td><td><div className="jd-sku-product-name"><strong title={item.productName}>{item.productName || "未命名商品"}</strong><small>{item.saleAttribute || item.brand || "—"}</small></div></td><td className="jd-sku-money-cell"><strong>{formatOptionalCurrencyFromCents(item.costPriceCents)}</strong>{!item.salesMatched && <small>本周期暂无</small>}</td><td className="jd-sku-money-cell"><strong>{formatOptionalCurrencyFromCents(item.netSalesCents)}</strong></td><td className={item.grossMarginRate !== null && item.grossMarginRate < 0 ? "red-text" : item.grossMarginRate !== null && item.grossMarginRate < 0.35 ? "orange-text" : "green-text"}><strong>{formatOptionalRate(item.grossMarginRate)}</strong></td><td className={item.refundRate !== null && item.refundRate > 0.1 ? "orange-text" : ""}><strong>{formatOptionalRate(item.refundRate)}</strong></td><td><span className="jd-sku-category" title={item.category}>{item.category || "—"}</span></td><td><span className={"status " + (isOnSale ? "status-success" : "status-warning")}><Dot tone={isOnSale ? "green" : "orange"} />{item.status || "未标记"}</span></td></tr>; })}{!loading && catalog.items.length === 0 && <tr><td colSpan={11}><div className="table-state">没有符合当前筛选条件的 SKU 数据。</div></td></tr>}{loading && <tr><td colSpan={11}><div className="table-state"><span className="state-spinner" />正在刷新 SKU 目录…</div></td></tr>}</tbody></table></div>
      <footer className="jd-sku-pagination"><span>第 {pagination.page} / {totalPages} 页</span><div><button type="button" className="row-action" disabled={loading || pagination.page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button><button type="button" className="row-action" disabled={loading || pagination.page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>下一页</button></div></footer>
    </section>
  </>;
}

type OutletTab = "analysis" | "outlets" | "platforms" | "products";

function ShopView({ range, customStartDate, customEndDate, onNavigate }: { range: SalesRangeLabel; customStartDate: string; customEndDate: string; onNavigate: (key: ModuleKey, importSource?: ImportSourceKey) => void }) {
  const apiRange = salesRangeMap[range];
  const [activeTab, setActiveTab] = useState<OutletTab>("analysis");
  const [summary, setSummary] = useState<SalesSummaryResponse | null>(null);
  const [analysisSummary, setAnalysisSummary] = useState<SalesSummaryResponse | null>(null);
  const [selectedOutletKeys, setSelectedOutletKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [platformFilter, setPlatformFilter] = useState("全部平台");

  const loadOutlets = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ range: apiRange });
      if (apiRange === "custom") {
        query.set("startDate", customStartDate);
        query.set("endDate", customEndDate);
      }
      const response = await fetch(`/api/sales/summary?${query.toString()}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null) as (SalesSummaryResponse & { error?: string; message?: string }) | null;
      if (!response.ok || !payload?.current || !Array.isArray(payload.outlets)) {
        throw new Error(payload?.message || payload?.error || `网店数据读取失败（${response.status}）`);
      }
      setSummary(payload);
      const validOutletKeys = selectedOutletKeys.filter((key) => payload.outlets.some((item) => item.groupKey === key));
      if (validOutletKeys.length !== selectedOutletKeys.length) setSelectedOutletKeys(validOutletKeys);
      if (validOutletKeys.length === 0) {
        setAnalysisSummary(payload);
      } else {
        const filteredQuery = new URLSearchParams(query);
        validOutletKeys.forEach((key) => filteredQuery.append("outlet", key));
        const filteredResponse = await fetch(`/api/sales/summary?${filteredQuery.toString()}`, { cache: "no-store" });
        const filteredPayload = await filteredResponse.json().catch(() => null) as (SalesSummaryResponse & { error?: string; message?: string }) | null;
        if (!filteredResponse.ok || !filteredPayload?.current) throw new Error(filteredPayload?.message || filteredPayload?.error || `店铺分析读取失败（${filteredResponse.status}）`);
        setAnalysisSummary(filteredPayload);
      }
    } catch (requestError) {
      setSummary(null);
      setAnalysisSummary(null);
      setError(requestError instanceof Error ? requestError.message : "暂时无法读取网店数据");
    } finally {
      setLoading(false);
    }
  }, [apiRange, customEndDate, customStartDate, selectedOutletKeys]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadOutlets(), 0);
    return () => window.clearTimeout(timer);
  }, [loadOutlets, retryKey]);

  const current = summary?.current;
  const previous = summary?.previous;
  const yearAgo = summary?.yearAgo;
  const outlets = useMemo(() => summary?.outlets ?? [], [summary?.outlets]);
  const platforms = useMemo(() => summary?.platforms ?? [], [summary?.platforms]);
  const platformOptions = useMemo(
    () => [...new Set(outlets.map((item) => item.platform).filter((item) => item && item !== "未分类"))].sort((left, right) => left.localeCompare(right, "zh-CN")),
    [outlets],
  );
  const displayedRows = useMemo(() => {
    const source = activeTab === "outlets" ? outlets : platforms;
    return source
      .filter((item) => activeTab !== "outlets" || platformFilter === "全部平台" || item.platform === platformFilter)
      .sort((left, right) => right.netSalesCents - left.netSalesCents);
  }, [activeTab, outlets, platformFilter, platforms]);
  const hasData = Boolean(current && (current.lineCount > 0 || current.orderCount > 0 || current.netSalesCents !== 0));
  const rowLabel = activeTab === "outlets" ? "网店" : "平台";
  const rangeNote = summary ? `${summary.startDate} 至 ${summary.endDate}` : range;

  const subnav = <div className="subnav outlet-subnav" role="tablist" aria-label="网店分析子版块"><button type="button" role="tab" aria-selected={activeTab === "analysis"} className={activeTab === "analysis" ? "active" : ""} onClick={() => setActiveTab("analysis")}>店铺分析</button><button type="button" role="tab" aria-selected={activeTab === "outlets"} className={activeTab === "outlets" ? "active" : ""} onClick={() => setActiveTab("outlets")}>网店总览</button><button type="button" role="tab" aria-selected={activeTab === "platforms"} className={activeTab === "platforms" ? "active" : ""} onClick={() => setActiveTab("platforms")}>平台对比</button><button type="button" role="tab" aria-selected={activeTab === "products"} className={activeTab === "products" ? "active" : ""} onClick={() => setActiveTab("products")}>商品数据</button><button type="button" disabled title="待接入企业购明细">企业购分析</button><button type="button" disabled title="待接入推广报表">推广分析</button><button type="button" disabled title="待接入客服报表">客服分析</button></div>;

  if (activeTab === "products") return <>{subnav}<ShopProductDataView range={range} customStartDate={customStartDate} customEndDate={customEndDate} onOpenImport={(dimension) => onNavigate("import", dimension === "sku" ? "jd_sku_daily" : "jd_spu_daily")} /></>;

  if (loading && !summary) return <>{subnav}<section className="panel data-state" role="status"><span className="state-spinner" /><strong>正在同步网店经营数据</strong><p>正在汇总已导入销售明细中的网店、平台、毛利与退货信息…</p></section></>;
  if (!summary || !analysisSummary) return <>{subnav}<section className="panel data-state data-state-error" role="alert"><span className="state-symbol">!</span><strong>网店数据加载失败</strong><p>{error || "暂时无法读取网店数据"}</p><button className="secondary-button" onClick={() => setRetryKey((value) => value + 1)}>重新加载</button></section></>;
  if (!current || !hasData) return <>{subnav}<section className="panel data-state"><span className="state-symbol">店</span><strong>{range}暂无网店销售数据</strong><p>请先在“数据导入”同步销售单明细账；系统会优先按店铺名称汇总，缺失时回退为渠道或平台。</p></section></>;

  if (activeTab === "analysis") return <>{subnav}<StoreAnalysisView summary={analysisSummary} outlets={outlets} selectedOutletKeys={selectedOutletKeys} onSelectOutlets={(keys) => { const unchanged = keys.length === selectedOutletKeys.length && keys.every((key, index) => key === selectedOutletKeys[index]); setSelectedOutletKeys(keys); if (unchanged) setRetryKey((value) => value + 1); }} loading={loading} /></>;

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
      <div className="table-toolbar"><div><h2>{rowLabel}经营明细</h2><p>销售额、同比、毛利率和退货率随顶部统计周期及最新导入批次自动更新。</p></div>{activeTab === "outlets" && <div className="segmented outlet-platform-filter" role="group" aria-label="平台筛选"><button type="button" className={platformFilter === "全部平台" ? "active" : ""} onClick={() => setPlatformFilter("全部平台")}>全部平台</button>{platformOptions.map((item) => <button type="button" key={item} className={platformFilter === item ? "active" : ""} onClick={() => setPlatformFilter(item)}>{item}</button>)}</div>}</div>
      <div className="data-table-wrap"><table className="data-table outlet-data-table"><thead><tr><th>排名</th><th>{rowLabel}</th>{activeTab === "outlets" && <th>所属平台</th>}<th>销售净额</th><th>净额占比</th><th>净销售同比</th><th>订单量</th><th>大毛利率</th><th>退货率</th><th>经营状态</th></tr></thead><tbody>{displayedRows.map((item, index) => { const needsAttention = item.grossMarginRate < current.grossMarginRate - .05 || item.refundRate > current.refundRate + .03; const statusText = needsAttention ? "需要关注" : index < 3 && item.shareRate >= .1 ? "核心网店" : "经营稳健"; return <tr key={`${activeTab}-${item.platform}-${item.name}`}><td><span className={`table-rank ${index < 3 ? `top-${index + 1}` : ""}`}>{index + 1}</span></td><td><div className="channel-name-cell"><span>{(item.name || "未").slice(0, 1)}</span><strong title={item.name}>{item.name || "未分类"}</strong></div></td>{activeTab === "outlets" && <td><span className="soft-tag">{item.platform || "未分类"}</span></td>}<td><strong>{formatCurrencyFromCents(item.netSalesCents)}</strong></td><td>{formatRate(item.shareRate)}</td><td className={netSalesYearOverYearTone(item.salesYearOverYearRate)}>{formatNetSalesYearOverYear(item.salesYearOverYearRate)}</td><td>{formatCount(item.orderCount)}</td><td className={item.grossMarginRate < current.grossMarginRate ? "orange-text" : "green-text"}>{formatRate(item.grossMarginRate)}</td><td className={item.refundRate > current.refundRate ? "orange-text" : ""}>{formatRate(item.refundRate)}</td><td><span className={`status ${needsAttention ? "status-warning" : "status-success"}`}><Dot tone={needsAttention ? "orange" : "green"} />{statusText}</span></td></tr>; })}{displayedRows.length === 0 && <tr><td colSpan={activeTab === "outlets" ? 10 : 9}><div className="table-state">当前筛选条件下没有可展示的{rowLabel}数据。</div></td></tr>}</tbody></table></div>
    </section>
  </>;
}

type SalesTab = "overview" | "channel" | "finance" | "targets";
type ChannelDimension = "channel" | "platform";

function SalesSubnav({ active, onChange }: { active: SalesTab; onChange: (tab: SalesTab) => void }) {
  return (
    <div className="subnav inventory-subnav sales-subnav" role="tablist" aria-label="销售分析子版块">
      <button type="button" role="tab" aria-selected={active === "overview"} className={active === "overview" ? "active" : ""} onClick={() => onChange("overview")}>销售总览</button>
      <button type="button" role="tab" aria-selected={active === "channel"} className={active === "channel" ? "active" : ""} onClick={() => onChange("channel")}>渠道分析</button>
      <button type="button" role="tab" aria-selected={active === "finance"} className={active === "finance" ? "active" : ""} onClick={() => onChange("finance")}>财报分析</button>
      <button type="button" role="tab" aria-selected={active === "targets"} className={active === "targets" ? "active" : ""} onClick={() => onChange("targets")}>目标设置</button>
    </div>
  );
}

function SalesOverviewFilterBar({
  shops,
  categories,
  selectedShopKeys,
  selectedCategories,
  onShopChange,
  onCategoryChange,
}: {
  shops: Array<{ key: string; name: string; platform: string }>;
  categories: string[];
  selectedShopKeys: string[];
  selectedCategories: string[];
  onShopChange: (values: string[]) => void;
  onCategoryChange: (values: string[]) => void;
}) {
  const hasFilter = selectedShopKeys.length > 0 || selectedCategories.length > 0;
  return <section className="panel sales-overview-filter-panel" aria-label="销售总览筛选">
    <div className="sales-overview-filter-heading">
      <div><span className="eyebrow">SALES SCOPE</span><h2>店铺与品类筛选</h2><p>筛选条件会同步应用到销售指标、趋势、渠道构成和店铺销售分布。</p></div>
      <div className="sales-overview-filter-controls">
        <label><span>店铺</span><SearchableMultiSelect values={selectedShopKeys} onChange={onShopChange} ariaLabel="销售总览店铺" allLabel="全部店铺" searchPlaceholder="搜索店铺或平台" options={shops.map((shop) => ({ value: shop.key, label: shop.platform === "未分类" ? shop.name : `${shop.platform} · ${shop.name}`, searchText: `${shop.platform} ${shop.name}` }))} /></label>
        <label><span>品类</span><SearchableMultiSelect values={selectedCategories} onChange={onCategoryChange} ariaLabel="销售总览品类" allLabel="全部品类" searchPlaceholder="搜索品类" options={categories.map((category) => ({ value: category, label: category }))} /></label>
        {hasFilter && <button type="button" className="secondary-button sales-overview-filter-reset" onClick={() => { onShopChange([]); onCategoryChange([]); }}>清空筛选</button>}
      </div>
    </div>
    <small>{hasFilter ? `当前已按 ${selectedShopKeys.length || "全部"} 个店铺、${selectedCategories.length || "全部"} 个品类统计；取消筛选即可恢复整体销售口径。` : "默认汇总当前统计周期内全部店铺、全部品类的销售数据。"}</small>
  </section>;
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

function ProductSearch({ value, onChange, queryCount }: { value: string; onChange: (value: string) => void; queryCount: number }) {
  return <section className="panel product-code-search-panel"><div className="search-box product-code-search">⌕ <textarea rows={1} value={value} onChange={(event) => onChange(event.target.value)} placeholder="输入货品编码或完整名称（多项用逗号或换行分隔）" aria-label="输入货品编码或完整名称" /><span aria-hidden="true">⌕</span></div><small>{queryCount > 0 ? `已按 ${formatCount(queryCount)} 个货品筛选，趋势与店铺分布同步更新。` : "可输入一个或多个货品编码或完整名称，留空则查看全部货品。"}</small></section>;
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

function FinanceAnalysisView() {
  const [selectedMonths, setSelectedMonths] = useState<string[] | null | undefined>(undefined);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[] | null>(null);
  const [selectedShops, setSelectedShops] = useState<string[] | null>(null);
  const [expenseSearch, setExpenseSearch] = useState("");
  const [expenseSort, setExpenseSort] = useState<{ column: FinanceExpenseSortKey; direction: "asc" | "desc" }>({ column: "current", direction: "desc" });
  const [data, setData] = useState<FinanceAnalysisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const query = new URLSearchParams();
        if (selectedMonths === null) query.append("month", "*");
        else selectedMonths?.forEach((month) => query.append("month", month));
        selectedPlatforms?.forEach((platform) => query.append("platform", platform));
        selectedShops?.forEach((shop) => query.append("shop", shop));
        const queryText = query.toString();
        const response = await fetch(`/api/finance/analysis${queryText ? `?${queryText}` : ""}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json().catch(() => null) as FinanceAnalysisResponse | null;
        if (!response.ok || !payload) throw new Error(payload?.error || `财报分析读取失败（${response.status}）`);
        setData(payload);
        if (selectedMonths === undefined && payload.selectedMonth) setSelectedMonths([payload.selectedMonth]);
      } catch (requestError) {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        setError(requestError instanceof Error ? requestError.message : "暂时无法读取财报分析");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [retryKey, selectedMonths, selectedPlatforms, selectedShops]);

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
  const platformOptions = data.filters?.platforms ?? [];
  const shopOptions = (data.filters?.shops ?? [])
    .filter((shop) => selectedPlatforms === null || selectedPlatforms.includes(shop.platform))
    .map((shop) => ({ value: shop.name, label: shop.name }));
  const activeMonthSelection = selectedMonths === undefined ? [data.selectedMonth!] : selectedMonths;
  const updateSelectedPlatforms = (next: string[] | null) => {
    setSelectedPlatforms(next);
    setSelectedShops(null);
  };
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
      <div className="finance-period-control"><div className="finance-hero-filter-row"><div className="finance-filter-field"><span>平台选择</span><FinanceMultiFilterSelect label="平台" allLabel="全部平台" options={platformOptions} selected={selectedPlatforms} onChange={updateSelectedPlatforms} /></div><div className="finance-filter-field"><span>店铺选择</span><FinanceMultiFilterSelect label="店铺" allLabel="全部店铺" options={shopOptions} selected={selectedShops} onChange={setSelectedShops} /></div><div className="finance-filter-field"><span>分析月份</span><FinanceMultiFilterSelect label="月份" allLabel="全部月份" options={monthOptions} selected={activeMonthSelection} onChange={setSelectedMonths} /></div></div><small>当前口径 {selectedPeriodName} · 数据截止 {data.sync?.dataCutoffMonth} · {data.sync?.sourceFileName}</small></div>
    </section>
    {error && <div className="inline-feedback warning"><strong>刷新提示</strong><span>{error}</span></div>}
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
      <div className="finance-expense-filter-bar" aria-label="费用明细筛选"><div><strong>费用筛选</strong><small>月份、平台与店铺支持多选，所有指标同步更新</small></div><FinanceMultiFilterSelect label="月份" allLabel="全部月份" options={monthOptions} selected={activeMonthSelection} onChange={setSelectedMonths} /><FinanceMultiFilterSelect label="平台" allLabel="全部平台" options={platformOptions} selected={selectedPlatforms} onChange={updateSelectedPlatforms} /><FinanceMultiFilterSelect label="店铺" allLabel="全部店铺" options={shopOptions} selected={selectedShops} onChange={setSelectedShops} /><button type="button" className="finance-filter-reset" onClick={() => { setSelectedMonths([data.months.at(-1)!.month]); setSelectedPlatforms(null); setSelectedShops(null); }}>重置筛选</button></div>
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
    <section className="panel finance-shop-panel"><div className="finance-panel-heading"><div><span className="eyebrow">SHOP TARGETS</span><h2>店铺目标进度</h2><p>店铺实际净销售、利润和小毛利率与所选月份目标同步对照。</p></div><span className="soft-tag">{data.shops.length} 家店铺</span></div><div className="finance-shop-filter-bar"><div><strong>店铺进度口径</strong><small>{selectedPeriodName}</small></div><FinanceMultiFilterSelect label="月份" allLabel="全部月份" options={monthOptions} selected={activeMonthSelection} onChange={setSelectedMonths} /><FinanceMultiFilterSelect label="平台" allLabel="全部平台" options={platformOptions} selected={selectedPlatforms} onChange={updateSelectedPlatforms} /></div><div className="data-table-wrap"><table className="data-table finance-shop-table"><thead><tr><th>店铺</th><th>负责人</th><th>净销售额</th><th>销售目标进度</th><th>利润</th><th>利润目标进度</th><th>小毛利率</th><th>推广费占比</th></tr></thead><tbody>{data.shops.map((shop) => <tr key={shop.name}><td><div className="finance-shop-name"><strong>{shop.name}</strong><small>{shop.groupName || "未分组"}</small></div></td><td>{shop.manager || "—"}</td><td>{formatCurrencyFromCents(shop.actual.netSalesCents)}</td><td><div className="table-progress"><span><i style={{ width: financeProgressWidth(shop.progress.sales) }} /></span><small>{shop.progress.sales === null ? "未设目标" : `${(shop.progress.sales * 100).toFixed(1)}%`}</small></div></td><td>{formatCurrencyFromCents(shop.actual.profitCents)}</td><td>{shop.progress.profit === null ? "未设目标" : `${(shop.progress.profit * 100).toFixed(1)}%`}</td><td>{formatFinanceBps(shop.actual.smallMarginBps)}</td><td>{formatFinanceBps(shop.actual.promotionFeeRatioBps)}</td></tr>)}</tbody></table></div></section>
  </div>;
}

type FinanceTargetFormState = {
  id: string;
  periodType: "month" | "year" | "project";
  periodKey: string;
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
  periodType: "month",
  periodKey: currentShanghaiMonth(),
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

function FinanceTargetSettingsView() {
  const [items, setItems] = useState<FinanceTarget[]>([]);
  const [options, setOptions] = useState<FinanceTargetOptions>({ shops: [], categories: [], projects: ["8系列"] });
  const [form, setForm] = useState<FinanceTargetFormState>(emptyFinanceTargetForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const loadTargets = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/finance/targets", { cache: "no-store" });
      const payload = await response.json().catch(() => null) as { items?: FinanceTarget[]; options?: FinanceTargetOptions; error?: string } | null;
      if (!response.ok || !Array.isArray(payload?.items) || !payload?.options) throw new Error(payload?.error || "目标设置读取失败");
      setItems(payload.items);
      setOptions(payload.options);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "目标设置读取失败" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadTargets(); }, [loadTargets]);
  const patchForm = (patch: Partial<FinanceTargetFormState>) => setForm((current) => ({ ...current, ...patch }));
  const toCents = (value: string) => Number.isFinite(Number(value)) ? Math.max(0, Math.round(Number(value) * 100)) : 0;
  const toBps = (value: string) => Number.isFinite(Number(value)) ? Math.max(0, Math.round(Number(value) * 100)) : 0;
  const saveTarget = async () => {
    if (saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/finance/targets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: form.id || undefined,
          periodType: form.periodType,
          periodKey: form.periodKey,
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
      if (!response.ok || !payload?.item) throw new Error(payload?.error || "目标保存失败");
      setMessage({ tone: "success", text: "目标已保存，财报分析进度已同步更新。" });
      setForm(emptyFinanceTargetForm());
      await loadTargets();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "目标保存失败" });
    } finally {
      setSaving(false);
    }
  };
  const editTarget = (item: FinanceTarget) => setForm({
    id: item.id,
    periodType: item.periodType,
    periodKey: item.periodKey,
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
  const removeTarget = async (id: string) => {
    const response = await fetch(`/api/finance/targets?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) {
      setMessage({ tone: "error", text: payload?.error || "目标删除失败" });
      return;
    }
    setMessage({ tone: "success", text: "目标已删除。" });
    await loadTargets();
  };

  return <div className="finance-target-page">
    <section className="finance-analysis-hero target-hero"><div><span className="eyebrow">TARGET MANAGEMENT</span><h2>经营目标设置</h2><p>按月度或年度设置店铺/店铺+品类目标，并单独管理 8 系列呆滞库存项目。</p></div><span className="soft-tag">已设置 {items.length} 项</span></section>
    {message && <div className={`inline-feedback ${message.tone}`}><strong>{message.tone === "success" ? "操作成功" : "操作失败"}</strong><span>{message.text}</span></div>}
    <section className="panel finance-target-form-panel">
      <div className="finance-panel-heading"><div><span className="eyebrow">{form.id ? "EDIT TARGET" : "NEW TARGET"}</span><h2>{form.id ? "编辑目标" : "新增目标"}</h2><p>金额单位为元，比率单位为百分比；同周期、同店铺和同品类再次保存会自动更新。</p></div>{form.id && <button className="secondary-button" onClick={() => setForm(emptyFinanceTargetForm())}>取消编辑</button>}</div>
      <div className="finance-target-period-tabs" role="group" aria-label="目标类型">{(["month", "year", "project"] as const).map((type) => <button type="button" key={type} className={form.periodType === type ? "active" : ""} onClick={() => patchForm({ periodType: type, periodKey: type === "month" ? currentShanghaiMonth() : type === "year" ? currentShanghaiMonth().slice(0, 4) : "8系列", shopName: type === "project" ? "" : form.shopName, category: type === "project" ? "" : form.category })}>{type === "month" ? "月度目标" : type === "year" ? "年度目标" : "项目目标"}</button>)}</div>
      <div className="finance-target-form-grid">
        <label><span>{form.periodType === "project" ? "项目名称" : "目标周期"}</span>{form.periodType === "month" ? <input type="month" value={form.periodKey} onChange={(event) => patchForm({ periodKey: event.target.value })} /> : form.periodType === "year" ? <input type="number" min="2020" max="2100" value={form.periodKey} onChange={(event) => patchForm({ periodKey: event.target.value })} /> : <input list="finance-project-options" value={form.periodKey} onChange={(event) => patchForm({ periodKey: event.target.value })} />}</label>
        {form.periodType !== "project" && <><label><span>店铺</span><input list="finance-shop-options" value={form.shopName} onChange={(event) => patchForm({ shopName: event.target.value })} placeholder="选择或输入店铺" /></label><label><span>品类（可选）</span><input list="finance-category-options" value={form.category} onChange={(event) => patchForm({ category: event.target.value })} placeholder="留空表示整店" /></label><label><span>店长 / 负责人</span><input value={form.manager} onChange={(event) => patchForm({ manager: event.target.value })} placeholder="输入姓名" /></label></>}
        {form.periodType === "project" ? <label><span>呆滞库存目标（元）</span><input type="number" min="0" step="0.01" value={form.stagnantInventoryTarget} onChange={(event) => patchForm({ stagnantInventoryTarget: event.target.value })} /></label> : <><label><span>销售额目标（元）</span><input type="number" min="0" step="0.01" value={form.salesTarget} onChange={(event) => patchForm({ salesTarget: event.target.value })} /></label><label><span>利润目标（元）</span><input type="number" min="0" step="0.01" value={form.profitTarget} onChange={(event) => patchForm({ profitTarget: event.target.value })} /></label><label><span>小毛利率目标（%）</span><input type="number" min="0" step="0.01" value={form.smallMargin} onChange={(event) => patchForm({ smallMargin: event.target.value })} /></label><label><span>库存清理目标（元）</span><input type="number" min="0" step="0.01" value={form.inventoryCleanupTarget} onChange={(event) => patchForm({ inventoryCleanupTarget: event.target.value })} /></label><label><span>推广费占比目标（%）</span><input type="number" min="0" step="0.01" value={form.promotionFeeRatio} onChange={(event) => patchForm({ promotionFeeRatio: event.target.value })} /></label></>}
      </div>
      <datalist id="finance-shop-options">{options.shops.map((item) => <option key={item} value={item} />)}</datalist><datalist id="finance-category-options">{options.categories.map((item) => <option key={item} value={item} />)}</datalist><datalist id="finance-project-options">{options.projects.map((item) => <option key={item} value={item} />)}</datalist>
      <div className="finance-target-actions"><span>{form.periodType === "project" ? "项目目标独立统计呆滞库存清理进度" : "品类留空时按整店目标统计"}</span><button type="button" className="primary-button" disabled={saving} onClick={() => void saveTarget()}>{saving ? "保存中…" : form.id ? "保存修改" : "保存目标"}</button></div>
    </section>
    <section className="panel finance-target-list-panel"><div className="finance-panel-heading"><div><span className="eyebrow">TARGET LIST</span><h2>已设置目标</h2><p>目标保存后立即参与财报分析中的月度、年度和店铺进度计算。</p></div></div>{loading ? <div className="table-state">正在读取目标…</div> : <div className="data-table-wrap"><table className="data-table finance-target-table"><thead><tr><th>类型 / 周期</th><th>店铺 / 品类</th><th>负责人</th><th>销售目标</th><th>利润目标</th><th>小毛利率</th><th>库存清理 / 呆滞目标</th><th>推广费占比</th><th>操作</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><strong>{item.periodType === "month" ? "月度" : item.periodType === "year" ? "年度" : "项目"}</strong><small>{item.periodKey}</small></td><td><strong>{item.periodType === "project" ? item.periodKey : item.shopName}</strong><small>{item.category || (item.periodType === "project" ? "呆滞库存" : "整店")}</small></td><td>{item.manager || "—"}</td><td>{item.periodType === "project" ? "—" : formatCurrencyFromCents(item.salesTargetCents)}</td><td>{item.periodType === "project" ? "—" : formatCurrencyFromCents(item.profitTargetCents)}</td><td>{item.periodType === "project" ? "—" : formatFinanceBps(item.smallMarginBps)}</td><td>{formatCurrencyFromCents(item.periodType === "project" ? item.stagnantInventoryTargetCents : item.inventoryCleanupTargetCents)}</td><td>{item.periodType === "project" ? "—" : formatFinanceBps(item.promotionFeeRatioBps)}</td><td><div className="finance-target-row-actions"><button onClick={() => editTarget(item)}>编辑</button><button className="danger" onClick={() => void removeTarget(item.id)}>删除</button></div></td></tr>)}{items.length === 0 && <tr><td colSpan={9}><div className="table-state">还没有目标，先在上方新增一项。</div></td></tr>}</tbody></table></div>}</section>
  </div>;
}

function SalesView({ range, customStartDate, customEndDate }: { range: SalesRangeLabel; customStartDate: string; customEndDate: string }) {
  const apiRange = salesRangeMap[range];
  const [activeTab, setActiveTab] = useState<SalesTab>("overview");
  const [summary, setSummary] = useState<SalesSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [productQuery, setProductQuery] = useState("");
  const [selectedShopKeys, setSelectedShopKeys] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const debouncedProductQuery = useDebouncedValue(productQuery);
  const productQueries = useMemo(() => parseProductQueries(debouncedProductQuery), [debouncedProductQuery]);

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
        selectedShopKeys.forEach((shopKey) => query.append("outlet", shopKey));
        selectedCategories.forEach((category) => query.append("category", category));
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
        setSummary(null);
        setError(requestError instanceof Error ? requestError.message : "暂时无法读取销售汇总");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [apiRange, customEndDate, customStartDate, productQueries, retryKey, selectedCategories, selectedShopKeys]);

  const current = summary?.current;
  const previous = summary?.previous;
  const yearAgo = summary?.yearAgo;
  const channels = useMemo(() => summary?.channels ?? [], [summary?.channels]);
  const salesChannels = summary?.shops?.length ? summary.shops : channels;
  const platforms = summary?.platforms?.length ? summary.platforms : channels;
  const salesFilterOptions = summary?.filterOptions ?? { shops: [], categories: [] };
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
  const salesSubnav = <SalesSubnav active={activeTab} onChange={setActiveTab} />;

  if (activeTab === "finance") return <>{salesSubnav}<FinanceAnalysisView /></>;
  if (activeTab === "targets") return <>{salesSubnav}<FinanceTargetSettingsView /></>;

  if (loading) {
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
        </section>{activeTab === "overview" && <SalesOverviewFilterBar shops={salesFilterOptions.shops} categories={salesFilterOptions.categories} selectedShopKeys={selectedShopKeys} selectedCategories={selectedCategories} onShopChange={setSelectedShopKeys} onCategoryChange={setSelectedCategories} />}<ProductSearch value={productQuery} onChange={setProductQuery} queryCount={productQueries.length} /></>
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
      {activeTab === "overview" && <SalesOverviewFilterBar shops={salesFilterOptions.shops} categories={salesFilterOptions.categories} selectedShopKeys={selectedShopKeys} selectedCategories={selectedCategories} onShopChange={setSelectedShopKeys} onCategoryChange={setSelectedCategories} />}
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
        <ProductSearch value={productQuery} onChange={setProductQuery} queryCount={productQueries.length} />
      </>}
    </>
  );
}

type InventoryTab = "overview" | "age" | "plan" | "stale";

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

function InventoryView() {
  const syncInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<InventoryTab>("overview");
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
  const [snapshotDate, setSnapshotDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [syncFeedback, setSyncFeedback] = useState<{ tone: "success" | "warning" | "error"; title: string; message: string } | null>(null);
  const [query, setQuery] = useState("");
  const [warehouseFilters, setWarehouseFilters] = useState<string[]>([]);
  const [typeFilters, setTypeFilters] = useState<string[]>([]);
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [planActionId, setPlanActionId] = useState("");
  const [planQuantities, setPlanQuantities] = useState<Record<string, number>>({});
  const debouncedInventoryQuery = useDebouncedValue(query);

  const loadOverview = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: "300" });
      if (debouncedInventoryQuery.trim()) params.set("q", debouncedInventoryQuery.trim());
      warehouseFilters.forEach((value) => params.append("warehouse", value));
      typeFilters.forEach((value) => params.append("warehouseType", value));
      statusFilters.forEach((value) => params.append("status", value));
      const response = await fetch(`/api/inventory/overview?${params}`, { cache: "no-store", signal });
      const payload = await response.json().catch(() => null) as (InventoryOverviewResponse & { error?: string; message?: string }) | null;
      if (!response.ok) throw new Error(payload?.error || payload?.message || `库存数据读取失败（${response.status}）`);
      if (!payload || !Array.isArray(payload.items) || !payload.metrics || !payload.sync) throw new Error("库存总览响应格式不完整");
      if (!signal?.aborted) setOverview(payload);
    } catch (requestError) {
      if (!signal?.aborted) setError(requestError instanceof Error ? requestError.message : "暂时无法读取库存数据");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [debouncedInventoryQuery, statusFilters, typeFilters, warehouseFilters]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void loadOverview(controller.signal), 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [loadOverview, retryKey]);

  const loadAgeAnalysis = useCallback(async () => {
    setAgeLoading(true);
    setAgeError("");
    try {
      const response = await fetch("/api/inventory/age-analysis", { cache: "no-store" });
      const payload = await response.json().catch(() => null) as (InventoryAgeAnalysisResponse & { error?: string }) | null;
      if (!response.ok || !payload || !Array.isArray(payload.items) || !payload.metrics) {
        throw new Error(payload?.error || `库龄数据读取失败（${response.status}）`);
      }
      setAgeAnalysis(payload);
    } catch (requestError) {
      setAgeError(requestError instanceof Error ? requestError.message : "暂时无法读取库龄分析数据");
    } finally {
      setAgeLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab !== "age" && activeTab !== "stale") return;
    const timer = window.setTimeout(() => void loadAgeAnalysis(), 0);
    return () => window.clearTimeout(timer);
  }, [activeTab, ageRetryKey, loadAgeAnalysis]);

  const filteredItems = useMemo(() => {
    const queryKeywords = query.trim().toLowerCase().split(/[\s,，;；]+/).filter(Boolean);
    return (overview?.items ?? []).filter((item) => {
      const searchable = `${item.productCode}\n${item.productName}\n${item.specification}\n${item.category}\n${item.warehouse}`.toLowerCase();
      const matchesQuery = queryKeywords.length === 0 || queryKeywords.some((keyword) => searchable.includes(keyword));
      const matchesWarehouse = warehouseFilters.length === 0 || warehouseFilters.includes(item.warehouse);
      const matchesType = typeFilters.length === 0 || typeFilters.includes(item.warehouseType);
      const matchesStatus = statusFilters.length === 0 || statusFilters.includes(item.status);
      return matchesQuery && matchesWarehouse && matchesType && matchesStatus;
    });
  }, [overview?.items, query, statusFilters, typeFilters, warehouseFilters]);

  const inventoryQueryCount = useMemo(
    () => query.trim().split(/[\s,，;；]+/).filter(Boolean).length,
    [query],
  );

  const recommendations = useMemo(
    () => overview?.recommendations ?? [],
    [overview?.recommendations],
  );

  const syncInventory = useCallback(async (file?: File) => {
    if (!file) return;
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
  }, [loadAgeAnalysis, loadOverview, snapshotDate]);

  const createPlan = useCallback(async (item: InventoryOverviewItem) => {
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
  }, [loadOverview, overview]);

  const updatePlanStatus = useCallback(async (plan: ReplenishmentPlanItem, status: ReplenishmentPlanItem["status"]) => {
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
  }, [loadOverview, planQuantities]);

  const subnav = (
    <div className="subnav inventory-subnav" role="tablist" aria-label="库存管理子版块">
      <button type="button" role="tab" aria-selected={activeTab === "overview"} className={activeTab === "overview" ? "active" : ""} onClick={() => setActiveTab("overview")}>库存总览</button>
      <button type="button" role="tab" aria-selected={activeTab === "age"} className={activeTab === "age" ? "active" : ""} onClick={() => setActiveTab("age")}>库龄分析</button>
      <button type="button" role="tab" aria-selected={activeTab === "plan"} className={activeTab === "plan" ? "active" : ""} onClick={() => setActiveTab("plan")}>备货计划</button>
      <button type="button" role="tab" aria-selected={activeTab === "stale"} className={activeTab === "stale" ? "active" : ""} onClick={() => setActiveTab("stale")}>滞销清理</button>
    </div>
  );

  const syncBar = (
    <section className="inventory-sync-bar">
      <div className="inventory-sync-title">
        <span className={`sync-pulse ${overview?.sync.inventoryStale ? "stale" : overview?.hasInventory ? "ready" : ""}`} aria-hidden="true" />
        <div><strong>{overview?.hasInventory ? overview.sync.salesThrough ? "库存与销售数据已联动" : "库存已同步，等待销售数据" : "等待首次库存同步"}</strong><small>{overview?.hasInventory ? `库存快照 ${overview.sync.inventoryAsOf} · 销售截止 ${overview.sync.salesThrough ?? "暂无"}` : "上传分仓库存查询报表后自动生成库存健康与备货建议"}</small></div>
      </div>
      <div className="inventory-source-status" aria-label="库存数据源状态">
        {(overview?.sources ?? []).map((source) => <span className={`source-status source-status-${source.status}`} key={source.key}><Dot tone={source.status === "ready" ? "green" : source.status === "stale" ? "orange" : "gray"} />{source.label}<small>{source.status === "ready" ? "已同步" : source.status === "stale" ? "待更新" : "未接入"}</small></span>)}
      </div>
      <label className="inventory-snapshot-input"><span>快照日期</span><input type="date" value={snapshotDate} onChange={(event) => setSnapshotDate(event.target.value)} disabled={syncing} /></label>
      <input ref={syncInputRef} className="file-input-hidden" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => void syncInventory(event.currentTarget.files?.[0])} />
      <button type="button" className="primary-button inventory-sync-button" disabled={syncing} onClick={() => syncInputRef.current?.click()}>{syncing ? `${syncProgress}%` : "↻ 同步库存"}</button>
      {syncing && <div className="inventory-sync-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={syncProgress} aria-label={syncStage}><span style={{ width: `${syncProgress}%` }} /><small>{syncStage}</small></div>}
    </section>
  );

  const feedback = syncFeedback && <section className={`inventory-feedback inventory-feedback-${syncFeedback.tone}`} role={syncFeedback.tone === "error" ? "alert" : "status"}><span>{syncFeedback.tone === "success" ? "✓" : syncFeedback.tone === "warning" ? "!" : "×"}</span><div><strong>{syncFeedback.title}</strong><p>{syncFeedback.message}</p></div></section>;
  const refreshError = error && overview && <section className="inventory-feedback inventory-feedback-error" role="alert"><span>!</span><div><strong>最新数据刷新失败</strong><p>{error}</p></div><button className="row-action" onClick={() => setRetryKey((key) => key + 1)}>重试</button></section>;

  if (loading && !overview) {
    return <>{subnav}{syncBar}{feedback}<section className="panel data-state inventory-data-state" role="status"><span className="state-spinner" /><strong>正在同步库存健康数据</strong><p>正在关联最新库存快照与近 30 日销售明细…</p></section></>;
  }

  if (!overview) {
    return <>{subnav}{syncBar}{feedback}<section className="panel data-state inventory-data-state data-state-error" role="alert"><span className="state-symbol">!</span><strong>库存数据加载失败</strong><p>{error || "暂时无法读取库存数据"}</p><button className="secondary-button" onClick={() => setRetryKey((key) => key + 1)}>重新加载</button></section></>;
  }

  if (!overview.hasInventory) {
    return <>{subnav}{syncBar}{feedback}{refreshError}<section className="panel data-state inventory-data-state inventory-empty-state"><span className="state-symbol">库</span><strong>还没有库存快照</strong><p>请上传吉客云“分仓库存查询” .xlsx 报表。系统会保留批次、自动读取实盘库存与成本，并联动销售生成备货建议。</p><button className="primary-button" onClick={() => syncInputRef.current?.click()}>选择库存报表</button></section></>;
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
          <InventoryKpiCard label="库存货值" value={formatCurrencyFromCents(overview.metrics.totalStockValueCents)} note={`成本覆盖 ${formatRate(overview.metrics.costCoverageRate)}`} tone="purple" icon="值" />
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
            <button className="inventory-plan-link" onClick={() => setActiveTab("plan")}>查看备货计划 <span>→</span></button>
          </article>
        </section>

        <section className="panel table-panel inventory-detail-panel">
          <div className="table-toolbar"><div><h2>库存健康明细</h2><p>自有仓与京东 RDC / DC 分开核算，销量仅按相同仓库匹配</p></div><span className="soft-tag">{inventoryQueryCount > 1 ? `已查询 ${formatCount(inventoryQueryCount)} 个货品编码 · ` : ""}显示 {formatCount(filteredItems.length)} / {formatCount(overview.pagination.total)}</span></div>
          <div className="filter-row inventory-filter-row">
            <div className="search-box compact inventory-multi-query">⌕ <textarea rows={1} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入或粘贴多个货品编码（空格、逗号或换行分隔）" aria-label="搜索一个或多个货品编码、名称、规格、仓库或品类" /></div>
            <MultiFilterSelect label="库存类型" allLabel="全部类型" ariaLabel="库存类型" options={[{ value: "owned", label: "自有仓" }, { value: "jd_rdc", label: "京东 RDC / DC" }, { value: "other", label: "其他" }]} selected={typeFilters} onChange={setTypeFilters} />
            <MultiFilterSelect label="仓库" allLabel="全部仓库" ariaLabel="仓库" options={overview.filters.warehouses} selected={warehouseFilters} onChange={setWarehouseFilters} />
            <MultiFilterSelect label="健康状态" allLabel="全部状态" ariaLabel="健康状态" options={Object.entries(inventoryStatusMeta).map(([value, meta]) => ({ value, label: meta.label }))} selected={statusFilters} onChange={setStatusFilters} />
            {(query || warehouseFilters.length > 0 || typeFilters.length > 0 || statusFilters.length > 0) && <button className="row-action" onClick={() => { setQuery(""); setWarehouseFilters([]); setTypeFilters([]); setStatusFilters([]); }}>清除筛选</button>}
          </div>
          <div className="data-table-wrap"><table className="data-table inventory-data-table"><thead><tr><th>货品</th><th>库存类型 / 仓库</th><th>可用 / 在途</th><th>近30日销量</th><th>日均销量</th><th>预计可售</th><th>库龄</th><th>建议补货</th><th>健康状态</th><th>操作</th></tr></thead><tbody>
            {filteredItems.slice(0, 300).map((item) => {
              const meta = inventoryStatusMeta[item.status];
              const canPlan = (item.suggestedQuantity ?? 0) > 0 && !item.inDraftPlan;
              return <tr key={item.key}><td><div className="product-cell inventory-product-cell"><span className="product-thumb">{item.productName.slice(0, 1) || "货"}</span><span><strong title={item.productName}>{item.productName}</strong><small>{item.productCode}{item.specification ? ` · ${item.specification}` : ""}</small></span></div></td><td><div className="inventory-warehouse-cell"><span className={`warehouse-type warehouse-type-${item.warehouseType}`}>{item.warehouseType === "owned" ? "自有仓" : item.warehouseType === "jd_rdc" ? "京东仓" : "其他"}</span><small>{item.warehouse}</small></div></td><td><div className="inventory-number-cell"><strong>{formatCount(item.availableQuantity)}</strong><small>在途 {formatCount(item.totalInTransitQuantity)}</small></div></td><td>{item.sales30d === null ? "—" : formatCount(item.sales30d)}</td><td>{item.averageDailySales === null ? "—" : item.averageDailySales.toFixed(1)}</td><td><strong>{item.coverageDays === null ? "—" : `${item.coverageDays.toFixed(1)} 天`}</strong></td><td>{item.inventoryAgeDays === null ? "—" : `${formatCount(item.inventoryAgeDays)} 天`}</td><td className={(item.suggestedQuantity ?? 0) > 0 ? "orange-text" : ""}><strong>{item.suggestedQuantity === null ? "—" : formatCount(item.suggestedQuantity)}</strong></td><td><span className={`status status-${meta.tone}`} title={item.reason}><Dot tone={meta.tone === "danger" ? "red" : meta.tone === "warning" ? "orange" : meta.tone === "success" ? "green" : meta.tone} />{item.statusLabel}</span></td><td><button className="row-action" disabled={!canPlan || planActionId === item.key} onClick={() => void createPlan(item)}>{item.inDraftPlan ? "已在草稿" : canPlan ? planActionId === item.key ? "处理中…" : "加入计划" : "无需补货"}</button></td></tr>;
            })}
            {filteredItems.length === 0 && <tr><td colSpan={10}><div className="table-state">没有符合当前筛选条件的库存记录。</div></td></tr>}
          </tbody></table></div>
        </section>
      </> : activeTab === "plan" ? <>
        <section className="inventory-kpi-grid inventory-plan-kpis">
          <InventoryKpiCard label="待确认草稿" value={`${formatCount(overview.planSummary.draftCount)} 项`} note="确认后进入执行队列" tone="orange" icon="草" />
          <InventoryKpiCard label="已确认计划" value={`${formatCount(overview.planSummary.confirmedCount)} 项`} note="已计入在途库存" tone="blue" icon="确" />
          <InventoryKpiCard label="计划待回写量" value={`${formatCount(overview.planSummary.activeQuantity)} 件`} note="含完成后等待库存快照回写的数量" tone="purple" icon="途" />
          <InventoryKpiCard label="可生成建议" value={`${formatCount(overview.metrics.recommendationCount)} 项`} note="按最新库存与销量实时重算" tone="green" icon="荐" />
        </section>

        <section className="panel table-panel replenishment-plan-panel">
          <div className="table-toolbar"><div><h2>备货计划</h2><p>调整草稿数量并确认；草稿、已确认数量会自动计入在途，防止重复建议</p></div><button className="secondary-button" onClick={() => setActiveTab("overview")}>返回库存明细</button></div>
          <div className="data-table-wrap"><table className="data-table replenishment-plan-table"><thead><tr><th>货品</th><th>仓库</th><th>建议依据</th><th>当前可售</th><th>系统建议</th><th>计划数量</th><th>状态</th><th>操作</th></tr></thead><tbody>
            {overview.plans.map((plan) => <tr key={plan.id}><td><div className="product-cell"><span className="product-thumb">{plan.productName.slice(0, 1) || "货"}</span><span><strong>{plan.productName}</strong><small>{plan.productCode}</small></span></div></td><td>{plan.warehouse}</td><td><span className="plan-reason" title={plan.reason}>{plan.reason}</span></td><td>{plan.coverageDays === null ? "—" : `${plan.coverageDays.toFixed(1)} 天`}</td><td><strong>{formatCount(plan.suggestedQuantity)}</strong></td><td>{plan.status === "draft" ? <input className="plan-quantity-input" type="number" min={1} max={10000000} value={planQuantities[plan.id] ?? plan.plannedQuantity} onChange={(event) => setPlanQuantities((current) => ({ ...current, [plan.id]: Math.max(1, Math.trunc(Number(event.target.value) || 1)) }))} aria-label={`${plan.productName}计划数量`} /> : <strong>{formatCount(plan.plannedQuantity)}</strong>}</td><td><span className={`status status-${plan.status === "draft" ? "warning" : plan.status === "confirmed" ? "success" : "purple"}`}><Dot tone={plan.status === "draft" ? "orange" : plan.status === "confirmed" ? "green" : "purple"} />{planStatusLabel[plan.status]}</span></td><td><div className="plan-row-actions">{plan.status === "draft" && <><button className="row-action primary-row-action" disabled={planActionId === plan.id} onClick={() => void updatePlanStatus(plan, "confirmed")}>确认</button><button className="row-action" disabled={planActionId === plan.id} onClick={() => void updatePlanStatus(plan, "cancelled")}>取消</button></>}{plan.status === "confirmed" && <><button className="row-action primary-row-action" disabled={planActionId === plan.id} onClick={() => void updatePlanStatus(plan, "completed")}>完成</button><button className="row-action" disabled={planActionId === plan.id} onClick={() => void updatePlanStatus(plan, "cancelled")}>取消</button></>}{plan.status === "completed" && <span className="plan-done">✓ 已完成</span>}</div></td></tr>)}
            {overview.plans.length === 0 && <tr><td colSpan={8}><div className="table-state">暂无备货计划。请在“库存总览”中将补货建议加入计划。</div></td></tr>}
          </tbody></table></div>
        </section>

        {recommendations.some((item) => !item.inDraftPlan) && <section className="panel plan-suggestion-panel"><SectionHeader title="待纳入计划的建议" note="按缺口量从高到低" /><div>{recommendations.filter((item) => !item.inDraftPlan).slice(0, 6).map((item) => <article key={item.key}><span>{item.productName.slice(0, 1) || "货"}</span><div><strong>{item.productName}</strong><small>{item.warehouse} · {item.reason}</small></div><em>+{formatCount(item.suggestedQuantity ?? 0)}</em><button className="row-action" disabled={planActionId === item.key} onClick={() => void createPlan(item)}>加入草稿</button></article>)}</div></section>}
      </> : <>
        {ageLoading && !ageAnalysis && <section className="panel data-state inventory-data-state" role="status"><span className="state-spinner" /><strong>正在汇总库龄与动销数据</strong><p>正在读取最新库存快照中的库龄、前 7 天与前 30 天销量…</p></section>}
        {!ageLoading && ageError && <section className="panel data-state inventory-data-state data-state-error" role="alert"><span className="state-symbol">!</span><strong>库龄数据加载失败</strong><p>{ageError}</p><button className="secondary-button" onClick={() => setAgeRetryKey((key) => key + 1)}>重新加载</button></section>}
        {!ageLoading && !ageError && ageAnalysis && !ageAnalysis.hasInventory && <section className="panel data-state inventory-data-state inventory-empty-state"><span className="state-symbol">龄</span><strong>还没有可分析的库存快照</strong><p>请同步包含库龄字段的库存报表后再查看库龄分析和滞销清理。</p></section>}
        {!ageLoading && !ageError && ageAnalysis?.hasInventory && activeTab === "age" && <>
          <section className="inventory-kpi-grid age-kpi-grid"><InventoryKpiCard label="库龄明细" value={`${formatCount(ageAnalysis.metrics.skuWarehouseCount)} 条`} note={`快照日期 ${ageAnalysis.sync.inventoryAsOf ?? "—"}`} tone="blue" icon="龄" /><InventoryKpiCard label="90天以上货值" value={formatCurrencyFromCents(ageAnalysis.metrics.aged90ValueCents)} note={`${formatCount(ageAnalysis.metrics.aged90Count)} 个 SKU × 仓库`} tone="orange" icon="90" /><InventoryKpiCard label="滞销清理" value={`${formatCount(ageAnalysis.metrics.stagnantCount)} 项`} note={ageAnalysis.sync.hasAgeSales ? "库龄≥90天且前30天销量为0" : "报表未提供前30天销量"} tone="purple" icon="清" /><InventoryKpiCard label="30天零销量" value={ageAnalysis.sync.hasAgeSales ? `${formatCount(ageAnalysis.metrics.zeroSalesCount)} 项` : "—"} note="仅统计有可用库存的商品" tone="green" icon="零" /></section>
          <section className="age-distribution-grid">{ageAnalysis.distribution.map((bucket) => <article className="panel age-distribution-card" key={bucket.key}><span>{bucket.label}</span><strong>{formatCount(bucket.count)} 项</strong><small>库存货值 {formatCurrencyFromCents(bucket.valueCents)}</small></article>)}</section>
          <section className="panel table-panel inventory-age-table-panel"><div className="table-toolbar"><div><h2>库龄分析明细</h2><p>{ageAnalysis.sync.hasAgeSales ? "库龄、前 7 天销量与前 30 天销量来自本次库龄报表" : "当前报表未提供销量列，系统仅展示库龄风险"}</p></div><span className="soft-tag">显示 {formatCount(ageAnalysis.items.length)} / {formatCount(ageAnalysis.pagination.total)}</span></div><div className="data-table-wrap"><table className="data-table inventory-age-table"><thead><tr><th>货品</th><th>仓库</th><th>可用库存</th><th>库龄</th><th>前7天销量</th><th>前30天销量</th><th>库存货值</th><th>状态</th></tr></thead><tbody>{ageAnalysis.items.map((item) => { const meta = inventoryAgeStatusMeta[item.status]; const tone = meta.tone === "danger" ? "red" : meta.tone === "warning" ? "orange" : meta.tone === "success" ? "green" : meta.tone; return <tr key={item.key}><td><div className="product-cell inventory-product-cell"><span className="product-thumb">{item.productName.slice(0, 1) || "货"}</span><span><strong title={item.productName}>{item.productName}</strong><small>{item.productCode}{item.specification ? ` · ${item.specification}` : ""}</small></span></div></td><td>{item.warehouse}</td><td>{formatCount(item.availableQuantity)}</td><td><strong>{item.inventoryAgeDays === null ? "—" : `${formatCount(item.inventoryAgeDays)} 天`}</strong></td><td>{item.sales7dQuantity === null ? "—" : formatCount(item.sales7dQuantity)}</td><td>{item.sales30dQuantity === null ? "—" : formatCount(item.sales30dQuantity)}</td><td>{item.stockValueCents === null ? "—" : formatCurrencyFromCents(item.stockValueCents)}</td><td><span className={`status status-${meta.tone}`} title={item.recommendation}><Dot tone={tone} />{item.statusLabel}</span></td></tr>; })}{ageAnalysis.items.length === 0 && <tr><td colSpan={8}><div className="table-state">当前快照没有可展示的库龄记录。</div></td></tr>}</tbody></table></div></section>
        </>}
        {!ageLoading && !ageError && ageAnalysis?.hasInventory && activeTab === "stale" && <>
          <section className="inventory-kpi-grid age-kpi-grid"><InventoryKpiCard label="优先清理项" value={`${formatCount(ageAnalysis.metrics.stagnantCount)} 项`} note="库龄≥90天且近30日无销量" tone="orange" icon="清" /><InventoryKpiCard label="待处理货值" value={formatCurrencyFromCents(ageAnalysis.metrics.stagnantValueCents)} note="按固定成本价与可用库存计算" tone="purple" icon="值" /><InventoryKpiCard label="高库龄商品" value={`${formatCount(ageAnalysis.metrics.aged90Count)} 项`} note="库龄超过90天且仍有可用库存" tone="blue" icon="龄" /><InventoryKpiCard label="零销量库存" value={ageAnalysis.sync.hasAgeSales ? `${formatCount(ageAnalysis.metrics.zeroSalesCount)} 项` : "—"} note="前30天销量为0" tone="green" icon="零" /></section>
          <section className="panel table-panel stale-cleanup-panel"><div className="table-toolbar"><div><h2>滞销清理清单</h2><p>仅输出清理建议，不会自动修改库存或创建补货计划。</p></div><span className="soft-tag">优先处理 {formatCount(ageAnalysis.metrics.cleanupCount)} 项</span></div><div className="data-table-wrap"><table className="data-table stale-cleanup-table"><thead><tr><th>货品</th><th>仓库</th><th>库龄</th><th>前30天销量</th><th>可用库存</th><th>库存货值</th><th>清理建议</th><th>风险状态</th></tr></thead><tbody>{cleanupItems.slice(0, 300).map((item) => { const meta = inventoryAgeStatusMeta[item.status]; const tone = meta.tone === "danger" ? "red" : meta.tone === "warning" ? "orange" : meta.tone; return <tr key={item.key}><td><div className="product-cell inventory-product-cell"><span className="product-thumb">{item.productName.slice(0, 1) || "货"}</span><span><strong title={item.productName}>{item.productName}</strong><small>{item.productCode}</small></span></div></td><td>{item.warehouse}</td><td>{item.inventoryAgeDays === null ? "—" : `${formatCount(item.inventoryAgeDays)} 天`}</td><td>{item.sales30dQuantity === null ? "—" : formatCount(item.sales30dQuantity)}</td><td>{formatCount(item.availableQuantity)}</td><td>{item.stockValueCents === null ? "—" : formatCurrencyFromCents(item.stockValueCents)}</td><td><span className="cleanup-recommendation">{item.recommendation}</span></td><td><span className={`status status-${meta.tone}`}><Dot tone={tone} />{item.statusLabel}</span></td></tr>; })}{cleanupItems.length === 0 && <tr><td colSpan={8}><div className="table-state">当前没有需要优先清理的滞销或高库龄商品。</div></td></tr>}</tbody></table></div></section>
        </>}
      </>}
    </>
  );
}

type ProductTab = "overview" | "calculator" | "detail";
type ProductTimeRange = "last30" | "last90" | "halfYear" | "custom";
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

function ProductView() {
  const [activeTab, setActiveTab] = useState<ProductTab>("overview");
  const [timeRange, setTimeRange] = useState<ProductTimeRange>("last30");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");
  const [productPeriodPickerOpen, setProductPeriodPickerOpen] = useState(false);
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
  const [calculatorOverrides, setCalculatorOverrides] = useState<Record<string, ProductCalculatorInput>>({});
  const [productDetail, setProductDetail] = useState<SalesSummaryResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  const loadSummary = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ range: timeRange });
      if (timeRange === "custom") {
        if (!customStartDate || !customEndDate) throw new Error("请选择完整的自定义开始和结束日期");
        params.set("startDate", customStartDate);
        params.set("endDate", customEndDate);
      }
      platformFilters.forEach((platform) => params.append("platform", platform));
      shopFilters.forEach((shop) => params.append("shop", shop));
      const response = await fetch(`/api/products/summary?${params}`, { cache: "no-store", signal });
      const payload = await response.json().catch(() => null) as (ProductSummaryResponse & { error?: string }) | null;
      if (!response.ok || !payload || !payload.metrics || !Array.isArray(payload.items)) {
        throw new Error(payload?.error || `商品数据读取失败（${response.status}）`);
      }
      if (!signal?.aborted) {
        setSummary(payload);
        setSelectedCode((current) => payload.items.some((item) => item.productCode === current) ? current : payload.items[0]?.productCode || "");
      }
    } catch (requestError) {
      if (!signal?.aborted) setError(requestError instanceof Error ? requestError.message : "暂时无法读取商品数据");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [customEndDate, customStartDate, platformFilters, shopFilters, timeRange]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void loadSummary(controller.signal), timeRange === "custom" ? 260 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [loadSummary, retryKey, timeRange]);

  const selectedProduct = useMemo(
    () => summary?.items.find((item) => item.productCode === selectedCode) ?? null,
    [selectedCode, summary?.items],
  );
  const detailStartDate = summary?.sync.salesWindowStart ?? "";
  const detailEndDate = summary?.sync.salesThrough ?? "";
  const loadProductDetail = useCallback(async (signal?: AbortSignal) => {
    if (!selectedCode || !detailStartDate || !detailEndDate) return;
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
      const response = await fetch(`/api/sales/summary?${params}`, { cache: "no-store", signal });
      const payload = await response.json().catch(() => null) as (SalesSummaryResponse & { error?: string }) | null;
      if (!response.ok || !payload || !payload.current || !Array.isArray(payload.daily)) {
        throw new Error(payload?.error || `规格详情读取失败（${response.status}）`);
      }
      if (!signal?.aborted) setProductDetail(payload);
    } catch (requestError) {
      if (!signal?.aborted) setDetailError(requestError instanceof Error ? requestError.message : "暂时无法读取规格详情");
    } finally {
      if (!signal?.aborted) setDetailLoading(false);
    }
  }, [detailEndDate, detailStartDate, selectedCode]);
  useEffect(() => {
    if (activeTab !== "detail" || !selectedCode || !detailStartDate || !detailEndDate) return;
    const controller = new AbortController();
    void loadProductDetail(controller.signal);
    return () => controller.abort();
  }, [activeTab, detailEndDate, detailStartDate, loadProductDetail, selectedCode]);

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
    () => [...new Set((summary?.items ?? []).map((item) => item.category))].sort((left, right) => left.localeCompare(right, "zh-CN")),
    [summary?.items],
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
  const filtered = useMemo(() => {
    const keywords = query.trim().toLowerCase().split(/[\s,，;；]+/).filter(Boolean);
    const items = (summary?.items ?? []).filter((item) => {
      const searchable = `${item.productCode}\n${item.productName}\n${item.brand}\n${item.supplierName}\n${item.specification}\n${item.category}`.toLowerCase();
      const matchesKeyword = keywords.length === 0 || keywords.some((keyword) => searchable.includes(keyword));
      const matchesCategory = categoryFilters.length === 0 || categoryFilters.includes(item.category);
      const matchesOutlet = (platformFilters.length === 0 && shopFilters.length === 0) || item.outlets.some((outlet) => (
        (platformFilters.length === 0 || platformFilters.includes(outlet.platform))
        && (shopFilters.length === 0 || shopFilters.includes(`${outlet.platform}\u001f${outlet.shop}`))
      ));
      const matchesMargin = marginFilters.length === 0 || marginFilters.some((marginFilter) => (
        (marginFilter === "低于35%" && item.grossMarginRate !== null && item.grossMarginRate < 0.35)
        || (marginFilter === "35%-40%" && item.grossMarginRate !== null && item.grossMarginRate >= 0.35 && item.grossMarginRate < 0.4)
        || (marginFilter === "40%-45%" && item.grossMarginRate !== null && item.grossMarginRate >= 0.4 && item.grossMarginRate < 0.45)
        || (marginFilter === "45%以上" && item.grossMarginRate !== null && item.grossMarginRate >= 0.45)
        || (marginFilter === "暂无有效毛利率" && item.grossMarginRate === null)
      ));
      return matchesKeyword && matchesCategory && matchesOutlet && matchesMargin;
    });
    return items.sort((left, right) => {
      if (sortBy === "margin") return (right.grossMarginRate ?? -Infinity) - (left.grossMarginRate ?? -Infinity);
      if (sortBy === "profit") return right.grossProfitCents - left.grossProfitCents;
      if (sortBy === "refund") return right.refundRate - left.refundRate;
      return right.netSalesCents - left.netSalesCents;
    });
  }, [categoryFilters, marginFilters, platformFilters, query, shopFilters, sortBy, summary?.items]);
  const multiCodeQueryCount = useMemo(
    () => query.trim().split(/[\s,，;；]+/).filter(Boolean).length,
    [query],
  );
  const rangeLabel = timeRange === "last30" ? "近30天" : timeRange === "last90" ? "近90天" : timeRange === "halfYear" ? "近半年" : "自定义时间";
  const appliedScope = useMemo(() => {
    const applied = summary?.filtersApplied;
    if (!applied || (applied.platforms.length === 0 && applied.shops.length === 0)) return "全渠道、全部店铺";
    const shops = applied.shops.map((shop) => `${shop.platform} · ${shop.shop}`);
    return shops.length > 0 ? shops.join("；") : applied.platforms.join("、");
  }, [summary?.filtersApplied]);
  const selectCustomRange = () => {
    const maxDate = summary?.sync.dataCutoffDate || summary?.sync.salesThrough || shanghaiIsoToday();
    const minDate = summary?.sync.dataStartDate || addIsoDays(maxDate, -365);
    setCustomStartDate((current) => clampIsoDate(current || summary?.sync.salesWindowStart || minDate, minDate, maxDate));
    setCustomEndDate((current) => clampIsoDate(current || summary?.sync.salesThrough || maxDate, minDate, maxDate));
    setProductPeriodPickerOpen(true);
  };
  const productCustomMaxDate = summary?.sync.dataCutoffDate || summary?.sync.salesThrough || shanghaiIsoToday();
  const productCustomMinDate = summary?.sync.dataStartDate || addIsoDays(productCustomMaxDate, -365);
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
    setActiveTab("detail");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const subnav = <div className="subnav product-subnav" role="tablist" aria-label="商品管理子版块"><button type="button" role="tab" aria-selected={activeTab === "overview"} className={activeTab === "overview" ? "active" : ""} onClick={() => setActiveTab("overview")}>商品经营</button><button type="button" role="tab" aria-selected={activeTab === "calculator"} className={activeTab === "calculator" ? "active" : ""} onClick={() => setActiveTab("calculator")}>毛利测算</button>{activeTab === "detail" && <button type="button" role="tab" aria-selected className="active">规格详情</button>}</div>;

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
      <section className="product-search-hero product-live-hero"><div><span className="eyebrow">商品经营中心</span><h2>商品表现与实际毛利实时汇总</h2><p>统计期间 {summary.sync.salesWindowStart} 至 {summary.sync.salesThrough} · 数据截止 {summary.sync.dataCutoffDate} · 库存快照 {summary.sync.inventoryAsOf ?? "未同步"}</p></div><div className="product-hero-actions"><div className="product-time-controls"><div className="product-window-toggle" role="group" aria-label="商品统计周期"><button className={timeRange === "last30" ? "active" : ""} onClick={() => { setTimeRange("last30"); setProductPeriodPickerOpen(false); }}>近30天</button><button className={timeRange === "last90" ? "active" : ""} onClick={() => { setTimeRange("last90"); setProductPeriodPickerOpen(false); }}>近90天</button><button className={timeRange === "halfYear" ? "active" : ""} onClick={() => { setTimeRange("halfYear"); setProductPeriodPickerOpen(false); }}>近半年</button><button className={timeRange === "custom" || productPeriodPickerOpen ? "active" : ""} onClick={selectCustomRange}>自定义时间</button></div>{productPeriodPickerOpen && customStartDate && customEndDate && <StatisticalPeriodPicker minDate={productCustomMinDate} maxDate={productCustomMaxDate} startDate={customStartDate} endDate={customEndDate} onApply={(startDate, endDate) => { setCustomStartDate(startDate); setCustomEndDate(endDate); setTimeRange("custom"); setProductPeriodPickerOpen(false); }} />}</div><button className="secondary-button product-refresh" onClick={() => void loadSummary()} disabled={loading}>{loading ? "同步中…" : "↻ 同步数据"}</button></div></section>

      {error && <section className="inventory-feedback inventory-feedback-error" role="alert"><span>!</span><div><strong>数据刷新失败</strong><p>{error}</p></div><button className="row-action" onClick={() => setRetryKey((key) => key + 1)}>重试</button></section>}

      {activeTab === "overview" ? <>
        <section className="inventory-kpi-grid product-kpi-grid">
          {marginBucketCards.map((bucket) => <article className={`inventory-kpi-card product-margin-kpi ${marginFilters.includes(bucket.filter) ? "active" : ""}`} key={bucket.filter}><div><span>{bucket.label}</span><i className={`inventory-kpi-icon ${bucket.tone}`}>{bucket.icon}</i></div><strong>{formatCount(bucket.value)} 个</strong><p>{bucket.note}</p><button type="button" onClick={() => setMarginFilters((current) => current.includes(bucket.filter) ? current.filter((value) => value !== bucket.filter) : [...current, bucket.filter])}>{marginFilters.includes(bucket.filter) ? "取消筛选" : "加入筛选 →"}</button></article>)}
        </section>

        <section className="panel product-filter-panel">
          <div className="table-toolbar"><div><h2>商品经营明细</h2><p>已按 {appliedScope} 汇总；净销量已扣除退货。销售单价、成本、费用和实际毛利均来自已导入订单明细。</p></div><span className="soft-tag">{multiCodeQueryCount > 1 ? `已查询 ${formatCount(multiCodeQueryCount)} 个规格代码 · ` : ""}显示 {formatCount(Math.min(filtered.length, 300))} / {formatCount(filtered.length)}</span></div>
          <div className="filter-row product-filter-row"><div className="search-box compact product-multi-query">⌕ <textarea rows={1} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入或粘贴货品规格代码、名称或规格（空格、逗号或换行分隔）" aria-label="搜索一个或多个货品规格代码、名称、品牌、供应商、规格或品类" /></div><MultiFilterSelect label="品类" allLabel="全部品类" ariaLabel="商品品类" options={categories} selected={categoryFilters} onChange={setCategoryFilters} /><MultiFilterSelect label="平台" allLabel="全部平台" ariaLabel="销售平台" options={platformOptions} selected={platformFilters} onChange={setPlatformFilters} /><MultiFilterSelect label="店铺" allLabel="全部店铺" ariaLabel="销售店铺" options={shopOptions} selected={shopFilters} onChange={setShopFilters} /><SearchableMultiSelect className="filter-select" values={marginFilters} onChange={(values) => setMarginFilters(values as ProductMarginFilter[])} ariaLabel="实际大毛利率区间" allLabel="全部毛利" searchPlaceholder="搜索毛利率区间" options={["低于35%", "35%-40%", "40%-45%", "45%以上", "暂无有效毛利率"].map((value) => ({ value, label: value }))} /><SearchableSelect className="filter-select" value={sortBy} onChange={setSortBy} ariaLabel="排序方式" searchPlaceholder="搜索排序方式" options={[{ value: "sales", label: "按销售净额" }, { value: "profit", label: "按订单毛利" }, { value: "margin", label: "按毛利率" }, { value: "refund", label: "按退货率" }]} /></div>
          <div className="data-table-wrap"><table className="data-table product-live-table"><thead><tr><th>货品 / 规格代码</th><th>品牌</th><th>供应商</th><th>品类</th><th>{rangeLabel}销量</th><th>销售净额</th><th>均价 / 均成本</th><th>费用</th><th>订单毛利</th><th>实际毛利率</th><th>退货率</th><th>操作</th></tr></thead><tbody>
            {filtered.slice(0, 300).map((item) => { const loss = item.grossProfitCents < 0; return <tr key={item.productCode}><td><div className="product-cell"><span className="product-thumb gradient-thumb">{item.productName.slice(0, 1) || "货"}</span><span><strong title={item.productName}>{item.productName}</strong><small>规格代码：{item.productCode}{item.specification ? ` · ${item.specification}` : " · 默认规格"}</small></span></div></td><td><span className="product-dimension" title={item.brand || "品牌未同步"}>{item.brand || "—"}</span></td><td><span className="product-dimension" title={item.supplierName || "供应商未同步"}>{item.supplierName || "—"}</span></td><td><span className="soft-tag">{item.category}</span></td><td>{formatCount(item.netQuantity)}</td><td><strong>{formatCurrencyFromCents(item.netSalesCents)}</strong></td><td><div className="product-money-pair"><strong>{item.averageSalePriceCents === null ? "—" : formatCurrencyFromCents(item.averageSalePriceCents)}</strong><small>成本 {item.averageCostCents === null ? "—" : formatCurrencyFromCents(item.averageCostCents)}</small></div></td><td>{formatCurrencyFromCents(item.feeCents)}</td><td className={loss ? "red-text" : "green-text"}><strong>{formatCurrencyFromCents(item.grossProfitCents)}</strong></td><td><span className={`product-margin ${loss ? "loss" : item.grossMarginRate !== null && item.grossMarginRate < 0.35 ? "low" : ""}`}>{item.grossMarginRate === null ? "—" : formatRate(item.grossMarginRate)}</span></td><td className={item.refundRate > 0.1 ? "orange-text" : ""}><strong>{formatRate(item.refundRate)}</strong></td><td><button className="row-action" onClick={() => openProductDetail(item.productCode)}>详情</button></td></tr>; })}
            {filtered.length === 0 && <tr><td colSpan={12}><div className="table-state">没有符合当前筛选条件的商品。</div></td></tr>}
          </tbody></table></div>
        </section>
      </> : activeTab === "detail" && selectedProduct ? <ProductDetailView item={selectedProduct} detail={productDetail} loading={detailLoading} error={detailError} rangeLabel={rangeLabel} onBack={() => setActiveTab("overview")} onRetry={() => void loadProductDetail()} /> : <>
        <section className="product-calculator-grid">
          <article className="panel calculator-input-panel"><SectionHeader title="毛利测算" note="默认带入所选商品近期开单均价、成本与费用率，可按活动方案调整" /><div className="calculator-fields"><label><span>选择商品</span><SearchableSelect value={selectedCode} onChange={setSelectedCode} ariaLabel="选择用于测算的商品" searchPlaceholder="搜索商品名称或规格代码" options={summary.items.map((item) => ({ value: item.productCode, label: `${item.productName} · ${item.productCode}`, searchText: `${item.productName} ${item.productCode} ${item.specification}` }))} /></label><label><span>预计成交价（元）</span><input type="number" min={0} step="0.01" value={calculator.salePrice} onChange={(event) => updateCalculator("salePrice", Number(event.target.value))} /></label><label><span>单位成本（元）</span><input type="number" min={0} step="0.01" value={calculator.unitCost} onChange={(event) => updateCalculator("unitCost", Number(event.target.value))} /></label><label><span>平台综合费率（%）</span><input type="number" min={0} step="0.01" value={calculator.feeRate} onChange={(event) => updateCalculator("feeRate", Number(event.target.value))} /></label><label><span>单件促销/履约成本（元）</span><input type="number" min={0} step="0.01" value={calculator.promotionCost} onChange={(event) => updateCalculator("promotionCost", Number(event.target.value))} /></label></div><div className="calculator-source"><Dot tone="blue" /><span>{selectedProduct ? `${selectedProduct.productName} · 最近实际毛利率 ${selectedProduct.grossMarginRate === null ? "—" : formatRate(selectedProduct.grossMarginRate)}` : "请选择商品"}</span></div></article>
          <article className="panel calculator-result-panel"><SectionHeader title="预计单件收益" note="成交价 − 单位成本 − 平台费 − 促销/履约成本" /><div className="calculator-result"><div><span>预计单件毛利</span><strong className={estimatedProfit < 0 ? "red-text" : "green-text"}>{formatCurrency(estimatedProfit)}</strong></div><div><span>预计毛利率</span><strong className={estimatedMargin === null ? "" : estimatedMargin < 0 ? "red-text" : "green-text"}>{estimatedMargin === null ? "—" : formatRate(estimatedMargin)}</strong></div><div><span>预计平台费用</span><strong>{formatCurrency(estimatedFee)}</strong></div></div><div className={`calculator-decision ${estimatedMargin !== null && estimatedMargin < 0 ? "danger" : estimatedMargin !== null && estimatedMargin < 0.2 ? "warning" : "success"}`}><strong>{estimatedMargin === null ? "请输入成交价" : estimatedMargin < 0 ? "该方案预计亏损" : estimatedMargin < 0.2 ? "该方案毛利偏低" : "该方案毛利健康"}</strong><p>{estimatedMargin === null ? "成交价大于 0 后即可得到测算结果。" : `每售出 1 件，预计保留 ${formatCurrency(estimatedProfit)} 毛利。`}</p></div></article>
        </section>
        <section className="panel product-reference-panel"><SectionHeader title="实际经营参考" note="用于对照测算方案与近期真实订单表现" /><div className="product-reference-grid"><div><span>{rangeLabel}销售净额</span><strong>{selectedProduct ? formatCurrencyFromCents(selectedProduct.netSalesCents) : "—"}</strong></div><div><span>{rangeLabel}订单毛利</span><strong className={selectedProduct && selectedProduct.grossProfitCents < 0 ? "red-text" : "green-text"}>{selectedProduct ? formatCurrencyFromCents(selectedProduct.grossProfitCents) : "—"}</strong></div><div><span>实际平台费用率</span><strong>{selectedProduct?.observedFeeRate === null || !selectedProduct ? "—" : formatRate(selectedProduct.observedFeeRate)}</strong></div><div><span>当前可用库存</span><strong>{selectedProduct?.availableQuantity === null || !selectedProduct ? "未同步" : `${formatCount(selectedProduct.availableQuantity)} 件`}</strong></div></div></section>
      </>}
    </>
  );
}

type WorkflowTab = "plan" | "inspection" | "reviews" | "launch";
type WorkflowStatus = "待开始" | "工作中" | "已完成";
type WorkflowPriority = "high" | "normal" | "low";

type WorkflowAttachment = {
  id: string;
  name: string;
  type: string;
  size: number;
  url: string;
  kind: "image" | "file";
};

type WorkflowTask = {
  id: string;
  title: string;
  workContent: string;
  category: string;
  owner: string;
  shopName: string;
  startDate: string;
  due: string;
  status: WorkflowStatus;
  priority: WorkflowPriority;
  source: "系统预置" | "手动录入";
  createdAt: string;
  attachments: WorkflowAttachment[];
};

type WorkflowLaunch = {
  id: string;
  productName: string;
  productCode: string;
  stage: string;
  owner: string;
  due: string;
  status: WorkflowStatus;
  attachments: WorkflowAttachment[];
};

const workflowStages: Array<{ value: WorkflowStatus; tone: "gray" | "blue" | "green" }> = [
  { value: "待开始", tone: "gray" },
  { value: "工作中", tone: "blue" },
  { value: "已完成", tone: "green" },
];

function workflowStatusTone(status: WorkflowStatus) {
  return status === "已完成" ? "green" : status === "工作中" ? "blue" : "gray";
}

function workflowStatusClass(status: WorkflowStatus) {
  return status === "已完成" ? "status-success" : status === "工作中" ? "status-info" : "status-gray";
}

function workflowStatusLabel(status: WorkflowStatus) {
  return status === "待开始" ? "未开始" : status;
}

function workflowPriorityLabel(priority: WorkflowPriority) {
  return priority === "high" ? "紧急" : priority === "low" ? "低" : "普通";
}

function formatWorkflowFileSize(size: number) {
  if (size < 1024) return size + " B";
  if (size < 1024 * 1024) return (size / 1024).toFixed(1) + " KB";
  return (size / (1024 * 1024)).toFixed(1) + " MB";
}

function buildWorkflowAttachments(files: FileList | null): WorkflowAttachment[] {
  return Array.from(files ?? []).slice(0, 8).map((file, index) => ({
    id: "attachment-" + Date.now().toString(36) + "-" + index + "-" + Math.random().toString(36).slice(2, 8),
    name: file.name,
    type: file.type || "application/octet-stream",
    size: file.size,
    url: URL.createObjectURL(file),
    kind: file.type.startsWith("image/") ? "image" : "file",
  }));
}

function WorkflowTransitionActions({
  status,
  onTransition,
  disabled = false,
}: {
  status: WorkflowStatus;
  onTransition: (nextStatus: WorkflowStatus) => void;
  disabled?: boolean;
}) {
  const actions: Array<{ status: WorkflowStatus; label: string; primary?: boolean }> = status === "待开始"
    ? [{ status: "工作中", label: "标记工作中", primary: true }]
    : status === "工作中"
      ? [
        { status: "待开始", label: "退回待开始" },
        { status: "已完成", label: "标记完成", primary: true },
      ]
      : [
        { status: "待开始", label: "返还待开始" },
        { status: "工作中", label: "返还工作中", primary: true },
      ];

  return <div className="workflow-transition-actions" aria-label="任务状态操作">
    {actions.map((action) => <button
      type="button"
      className={"row-action workflow-transition-button" + (action.primary ? " primary-row-action" : "")}
      key={action.status}
      disabled={disabled}
      onClick={() => onTransition(action.status)}
    >{action.label}</button>)}
  </div>;
}

function WorkflowAttachmentList({
  attachments,
  inputId,
  onFiles,
  onRemove,
  onPreview,
}: {
  attachments: WorkflowAttachment[];
  inputId: string;
  onFiles: (files: FileList | null) => void;
  onRemove: (attachmentId: string) => void;
  onPreview: (attachment: WorkflowAttachment) => void;
}) {
  return <div className="workflow-attachment-list">
    <div className="workflow-attachment-toolbar">
      <label className="workflow-attachment-add" htmlFor={inputId}>＋ 添加附件</label>
      <small>支持图片 / 文件</small>
    </div>
    <input
      id={inputId}
      className="file-input-hidden"
      type="file"
      multiple
      accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.rar,.txt"
      onChange={(event) => {
        onFiles(event.currentTarget.files);
        event.currentTarget.value = "";
      }}
    />
    {attachments.length === 0 ? <span className="workflow-attachment-empty">暂无附件</span> : <div className="workflow-attachment-chips">
      {attachments.map((attachment) => <div className="workflow-attachment-chip" key={attachment.id}>
        <button type="button" className="workflow-attachment-preview" onClick={() => onPreview(attachment)} aria-label={"预览附件 " + attachment.name}>
          {attachment.kind === "image" ? <img src={attachment.url} alt="" /> : <i>文件</i>}
          <span title={attachment.name}>{attachment.name}</span>
        </button>
        <a href={attachment.url} download={attachment.name}>下载</a>
        <button type="button" className="workflow-attachment-remove" onClick={() => onRemove(attachment.id)} aria-label={"移除附件 " + attachment.name}>×</button>
      </div>)}
    </div>}
  </div>;
}

function WorkflowAttachmentPreview({
  attachment,
  onClose,
}: {
  attachment: WorkflowAttachment;
  onClose: () => void;
}) {
  return <div className="workflow-attachment-modal-backdrop" role="presentation" onMouseDown={(event) => {
    if (event.currentTarget === event.target) onClose();
  }}>
    <section className="workflow-attachment-modal" role="dialog" aria-modal="true" aria-labelledby="workflow-attachment-preview-title">
      <button type="button" className="workflow-modal-close" onClick={onClose} aria-label="关闭附件预览">×</button>
      <span className="eyebrow">TASK ATTACHMENT</span>
      <h2 id="workflow-attachment-preview-title">{attachment.name}</h2>
      {attachment.kind === "image"
        ? <img className="workflow-attachment-full-image" src={attachment.url} alt={attachment.name} />
        : <div className="workflow-file-preview"><i>文件</i><strong>{attachment.name}</strong><small>{formatWorkflowFileSize(attachment.size)} · {attachment.type}</small></div>}
      <div className="workflow-modal-actions">
        <a className="primary-button" href={attachment.url} download={attachment.name}>下载附件</a>
        <button type="button" className="secondary-button" onClick={onClose}>关闭</button>
      </div>
    </section>
  </div>;
}

function WorkflowDeleteConfirm({
  task,
  onCancel,
  onConfirm,
  disabled = false,
}: {
  task: WorkflowTask;
  onCancel: () => void;
  onConfirm: () => void;
  disabled?: boolean;
}) {
  return <div className="workflow-attachment-modal-backdrop" role="presentation" onMouseDown={(event) => {
    if (event.currentTarget === event.target) onCancel();
  }}>
    <section className="workflow-delete-confirm" role="dialog" aria-modal="true" aria-labelledby="workflow-delete-confirm-title">
      <span className="eyebrow">DELETE TASK</span>
      <h2 id="workflow-delete-confirm-title">确认删除工作项？</h2>
      <p>将删除“{task.title}”及其当前会话中的附件；此操作无法撤销。</p>
      <div className="workflow-modal-actions">
        <button type="button" className="secondary-button" onClick={onCancel} disabled={disabled}>取消</button>
        <button type="button" className="danger-button" onClick={onConfirm} disabled={disabled}>{disabled ? "删除中…" : "确认删除"}</button>
      </div>
    </section>
  </div>;
}

function WorkflowView() {
  const [activeTab, setActiveTab] = useState<WorkflowTab>("plan");
  const [taskQuery, setTaskQuery] = useState("");
  const [taskStatuses, setTaskStatuses] = useState<WorkflowStatus[]>([]);
  const [taskPriorities, setTaskPriorities] = useState<WorkflowPriority[]>([]);
  const [inspectionStatuses, setInspectionStatuses] = useState<Array<"待处理" | "正常">>([]);
  const [reviewStatuses, setReviewStatuses] = useState<Array<"待回复" | "已回复">>([]);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [draftOwner, setDraftOwner] = useState("");
  const [draftShopName, setDraftShopName] = useState("");
  const [draftStartDate, setDraftStartDate] = useState("");
  const [draftDueDate, setDraftDueDate] = useState("");
  const [draftPriority, setDraftPriority] = useState<WorkflowPriority | "">("");
  const [workflowFeedback, setWorkflowFeedback] = useState("");
  const [attachmentViewer, setAttachmentViewer] = useState<WorkflowAttachment | null>(null);
  const [taskPendingDeletion, setTaskPendingDeletion] = useState<WorkflowTask | null>(null);
  const [tasks, setTasks] = useState<WorkflowTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [taskMutationPending, setTaskMutationPending] = useState(false);
  const [launches, setLaunches] = useState<WorkflowLaunch[]>(() => [
    { id: "launch-1", productName: "志高 ZK-30 商用开水器", productCode: "ZK-30-003", stage: "商品资料", owner: "商品组", due: "7月18日", status: "已完成", attachments: [] },
    { id: "launch-2", productName: "志高 YT-2H 榨汁机", productCode: "ZG-2H-004", stage: "主图与详情页", owner: "运营组", due: "7月19日", status: "工作中", attachments: [] },
    { id: "launch-3", productName: "志高 8 系列滤芯", productCode: "CH-800-002", stage: "平台建档", owner: "天猫组", due: "7月22日", status: "待开始", attachments: [] },
    { id: "launch-4", productName: "志高商用洗碗机", productCode: "DW-160-001", stage: "首批备货", owner: "供应链", due: "7月20日", status: "工作中", attachments: [] },
  ]);
  const [launchQuery, setLaunchQuery] = useState("");
  const [launchStatuses, setLaunchStatuses] = useState<WorkflowStatus[]>([]);
  const [launchCreateOpen, setLaunchCreateOpen] = useState(false);
  const [launchDraftName, setLaunchDraftName] = useState("");
  const [launchDraftCode, setLaunchDraftCode] = useState("");
  const [launchDraftStage, setLaunchDraftStage] = useState("资料建档");
  const [launchDraftOwner, setLaunchDraftOwner] = useState("商品组");
  const [launchDraftDue, setLaunchDraftDue] = useState("");

  const loadTasks = useCallback(async () => {
    setTasksLoading(true);
    try {
      const response = await fetch("/api/workflow/tasks", { cache: "no-store" });
      const payload = await response.json().catch(() => null) as { items?: WorkflowTask[]; error?: string } | null;
      if (!response.ok || !Array.isArray(payload?.items)) {
        throw new Error(payload?.error || `工作计划读取失败（${response.status}）`);
      }
      setTasks(payload.items);
    } catch (error) {
      setWorkflowFeedback(error instanceof Error ? error.message : "工作计划读取失败，请稍后重试。");
    } finally {
      setTasksLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  const filteredTasks = useMemo(() => tasks.filter((item) => {
    const matchesQuery = !taskQuery.trim() || [item.title, item.workContent, item.category, item.owner, item.shopName, item.status].join(" ").toLocaleLowerCase("zh-CN").includes(taskQuery.trim().toLocaleLowerCase("zh-CN"));
    const matchesStatus = taskStatuses.length === 0 || taskStatuses.includes(item.status);
    const matchesPriority = taskPriorities.length === 0 || taskPriorities.includes(item.priority);
    return matchesQuery && matchesStatus && matchesPriority;
  }), [taskPriorities, taskQuery, taskStatuses, tasks]);

  const filteredLaunches = useMemo(() => launches.filter((item) => {
    const matchesQuery = !launchQuery.trim() || [item.productName, item.productCode, item.stage, item.owner, item.status].join(" ").toLocaleLowerCase("zh-CN").includes(launchQuery.trim().toLocaleLowerCase("zh-CN"));
    return matchesQuery && (launchStatuses.length === 0 || launchStatuses.includes(item.status));
  }), [launchQuery, launchStatuses, launches]);

  const createTask = async () => {
    if (tasksLoading || taskMutationPending) return;
    const title = draftTitle.trim() || "未命名工作项";
    const workContent = draftContent.trim() || "未填写工作内容";
    const owner = draftOwner.trim() || "未指定跟进人";
    const shopName = draftShopName.trim() || "未关联店铺";
    if (draftStartDate && draftDueDate && draftDueDate < draftStartDate) {
      setWorkflowFeedback("截止时间不能早于开始时间。");
      return;
    }
    setTaskMutationPending(true);
    try {
      const response = await fetch("/api/workflow/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          workContent,
          owner,
          shopName,
          startDate: draftStartDate || "待排期",
          due: draftDueDate || "待排期",
          priority: draftPriority || "normal",
        }),
      });
      const payload = await response.json().catch(() => null) as { item?: WorkflowTask; error?: string } | null;
      if (!response.ok || !payload?.item) {
        throw new Error(payload?.error || `工作项保存失败（${response.status}）`);
      }
      setTasks((current) => [payload.item!, ...current]);
      setDraftTitle("");
      setDraftContent("");
      setDraftOwner("");
      setDraftShopName("");
      setDraftStartDate("");
      setDraftDueDate("");
      setDraftPriority("");
      setWorkflowFeedback("「" + title + "」已创建并保存，当前状态为待开始，可按需继续补充信息。");
    } catch (error) {
      setWorkflowFeedback(error instanceof Error ? error.message : "工作项保存失败，请稍后重试。");
    } finally {
      setTaskMutationPending(false);
    }
  };

  const createLaunch = () => {
    const productName = launchDraftName.trim() || "未命名新品项目";
    const productCode = launchDraftCode.trim() || "NEW-" + Date.now().toString().slice(-6);
    setLaunches((current) => [{
      id: "launch-" + Date.now(),
      productName,
      productCode,
      stage: launchDraftStage.trim() || "资料建档",
      owner: launchDraftOwner.trim() || "商品组",
      due: launchDraftDue.trim() || "待排期",
      status: "待开始",
      attachments: [],
    }, ...current]);
    setLaunchDraftName("");
    setLaunchDraftCode("");
    setLaunchDraftStage("资料建档");
    setLaunchDraftDue("");
    setLaunchCreateOpen(false);
    setWorkflowFeedback("新品「" + productName + "」已创建，当前状态为待开始。");
  };

  const updateTask = async (taskId: string, changes: Partial<Pick<WorkflowTask, "status" | "due">>) => {
    if (tasksLoading || taskMutationPending) return;
    const task = tasks.find((item) => item.id === taskId);
    if (!task || (changes.status === task.status && changes.due === undefined) || (changes.due === task.due && changes.status === undefined)) return;
    setTasks((current) => current.map((item) => item.id === taskId ? { ...item, ...changes } : item));
    setTaskMutationPending(true);
    try {
      const response = await fetch("/api/workflow/tasks?id=" + encodeURIComponent(taskId), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(changes),
      });
      const payload = await response.json().catch(() => null) as { item?: WorkflowTask; error?: string } | null;
      if (!response.ok || !payload?.item) {
        throw new Error(payload?.error || `工作项保存失败（${response.status}）`);
      }
      setTasks((current) => current.map((item) => item.id === taskId ? { ...payload.item!, attachments: item.attachments } : item));
      setWorkflowFeedback(changes.status
        ? `「${task.title}」状态已调整为${workflowStatusLabel(changes.status)}并保存。`
        : `「${task.title}」截止时间已调整为${changes.due === "待排期" ? "待排期" : changes.due}并保存。`);
    } catch (error) {
      setTasks((current) => current.map((item) => item.id === taskId ? {
        ...item,
        ...(changes.status !== undefined ? { status: task.status } : {}),
        ...(changes.due !== undefined ? { due: task.due } : {}),
      } : item));
      setWorkflowFeedback(error instanceof Error ? error.message : "工作项保存失败，请稍后重试。");
    } finally {
      setTaskMutationPending(false);
    }
  };

  const transitionLaunch = (launchId: string, nextStatus: WorkflowStatus) => {
    const launch = launches.find((item) => item.id === launchId);
    if (!launch || launch.status === nextStatus) return;
    setLaunches((current) => current.map((item) => item.id === launchId ? { ...item, status: nextStatus } : item));
    setWorkflowFeedback("新品「" + launch.productName + "」已标记为" + nextStatus + "。");
  };

  const addTaskAttachments = (taskId: string, files: FileList | null) => {
    const attachments = buildWorkflowAttachments(files);
    const task = tasks.find((item) => item.id === taskId);
    if (!task || attachments.length === 0) return;
    setTasks((current) => current.map((item) => item.id === taskId ? { ...item, attachments: [...item.attachments, ...attachments] } : item));
    setWorkflowFeedback("已为「" + task.title + "」添加 " + attachments.length + " 个附件。");
  };

  const addLaunchAttachments = (launchId: string, files: FileList | null) => {
    const attachments = buildWorkflowAttachments(files);
    const launch = launches.find((item) => item.id === launchId);
    if (!launch || attachments.length === 0) return;
    setLaunches((current) => current.map((item) => item.id === launchId ? { ...item, attachments: [...item.attachments, ...attachments] } : item));
    setWorkflowFeedback("已为新品「" + launch.productName + "」添加 " + attachments.length + " 个附件。");
  };

  const removeTaskAttachment = (taskId: string, attachmentId: string) => {
    const attachment = tasks.find((item) => item.id === taskId)?.attachments.find((item) => item.id === attachmentId);
    if (!attachment) return;
    URL.revokeObjectURL(attachment.url);
    setTasks((current) => current.map((item) => item.id === taskId ? { ...item, attachments: item.attachments.filter((entry) => entry.id !== attachmentId) } : item));
    if (attachmentViewer?.id === attachmentId) setAttachmentViewer(null);
    setWorkflowFeedback("附件已移除。");
  };

  const removeLaunchAttachment = (launchId: string, attachmentId: string) => {
    const attachment = launches.find((item) => item.id === launchId)?.attachments.find((item) => item.id === attachmentId);
    if (!attachment) return;
    URL.revokeObjectURL(attachment.url);
    setLaunches((current) => current.map((item) => item.id === launchId ? { ...item, attachments: item.attachments.filter((entry) => entry.id !== attachmentId) } : item));
    if (attachmentViewer?.id === attachmentId) setAttachmentViewer(null);
    setWorkflowFeedback("附件已移除。");
  };

  const confirmTaskDeletion = async () => {
    if (taskMutationPending) return;
    const task = taskPendingDeletion;
    if (!task) return;
    setTaskMutationPending(true);
    try {
      const response = await fetch("/api/workflow/tasks?id=" + encodeURIComponent(task.id), { method: "DELETE" });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.error || `工作项删除失败（${response.status}）`);
      }
      task.attachments.forEach((attachment) => URL.revokeObjectURL(attachment.url));
      setTasks((current) => current.filter((item) => item.id !== task.id));
      setTaskPendingDeletion(null);
      setWorkflowFeedback("「" + task.title + "」已删除并保存。");
    } catch (error) {
      setWorkflowFeedback(error instanceof Error ? error.message : "工作项删除失败，请稍后重试。");
    } finally {
      setTaskMutationPending(false);
    }
  };

  const taskCount = (status: WorkflowStatus) => tasks.filter((item) => item.status === status).length;
  const launchCount = (status: WorkflowStatus) => launches.filter((item) => item.status === status).length;
  const taskStatusBadge = (status: WorkflowStatus) => <span className={"status " + workflowStatusClass(status)}><Dot tone={workflowStatusTone(status)} />{status}</span>;
  const feedback = workflowFeedback ? <section className="workflow-feedback" role="status"><span>✓</span><p>{workflowFeedback}</p><button type="button" onClick={() => setWorkflowFeedback("")} aria-label="关闭提示">×</button></section> : null;
  const attachmentModal = attachmentViewer ? <WorkflowAttachmentPreview attachment={attachmentViewer} onClose={() => setAttachmentViewer(null)} /> : null;
  const taskDeletionModal = taskPendingDeletion ? <WorkflowDeleteConfirm task={taskPendingDeletion} onCancel={() => setTaskPendingDeletion(null)} onConfirm={() => void confirmTaskDeletion()} disabled={taskMutationPending} /> : null;

  const subnav = <div className="subnav workflow-subnav" role="tablist" aria-label="运营事务子版块">
    <button type="button" role="tab" aria-selected={activeTab === "plan"} className={activeTab === "plan" ? "active" : ""} onClick={() => setActiveTab("plan")}>工作计划</button>
    <button type="button" role="tab" aria-selected={activeTab === "inspection"} className={activeTab === "inspection" ? "active" : ""} onClick={() => setActiveTab("inspection")}>巡店查询</button>
    <button type="button" role="tab" aria-selected={activeTab === "reviews"} className={activeTab === "reviews" ? "active" : ""} onClick={() => setActiveTab("reviews")}>评价维护</button>
    <button type="button" role="tab" aria-selected={activeTab === "launch"} className={activeTab === "launch" ? "active" : ""} onClick={() => setActiveTab("launch")}>新品上架</button>
  </div>;

  if (activeTab === "inspection") {
    const inspections = [
      ["天猫-志高亿用专卖店", "天猫", "7月16日 10:20", "商品详情页", "主图与卖点完整", "正常"],
      ["京东-志高商用设备旗舰店", "京东", "7月16日 09:42", "价格与库存", "2 个 SKU 库存偏低", "待处理"],
      ["拼多多-志高商用厨电旗舰店", "拼多多", "7月15日 16:18", "活动报名", "活动库存已锁定", "正常"],
      ["抖店-志高商业设备旗舰店", "抖音", "7月15日 14:05", "评价与问大家", "3 条低分评价待回复", "待处理"],
    ];
    const filteredInspections = inspections.filter((item) => {
      const matchesQuery = !taskQuery.trim() || item.join(" ").toLocaleLowerCase("zh-CN").includes(taskQuery.trim().toLocaleLowerCase("zh-CN"));
      return matchesQuery && (inspectionStatuses.length === 0 || inspectionStatuses.includes(item[5] as "待处理" | "正常"));
    });
    return <>
      {subnav}
      <section className="workflow-toolbar"><div><span className="eyebrow">STORE INSPECTION</span><h2>巡店查询</h2><p>按店铺追溯每日巡检记录，快速定位价格、库存、页面与服务异常。</p></div><button className="secondary-button">↻ 刷新记录</button></section>
      <section className="workflow-kpi-grid"><article><span>今日已巡店</span><strong>18 / 22</strong><small>完成率 81.8%</small></article><article><span>待处理问题</span><strong className="orange-text">6 项</strong><small>价格、库存与评价事项</small></article><article><span>高优先级</span><strong className="red-text">2 项</strong><small>需在今日闭环</small></article><article><span>最近巡检</span><strong>10:20</strong><small>天猫 · 亿用专卖店</small></article></section>
      <section className="panel workflow-table-panel"><div className="table-toolbar"><div><h2>巡店记录</h2><p>保留最近一次巡检结果与需要跟进的异常项。</p></div><div className="workflow-filter-row"><input value={taskQuery} onChange={(event) => setTaskQuery(event.target.value)} placeholder="搜索店铺、巡检项或结论" aria-label="搜索巡店记录" /><SearchableMultiSelect values={inspectionStatuses} onChange={(values) => setInspectionStatuses(values as Array<"待处理" | "正常">)} ariaLabel="巡店状态" allLabel="全部状态" searchPlaceholder="搜索巡店状态" options={[{ value: "待处理", label: "待处理" }, { value: "正常", label: "正常" }]} /></div></div><div className="data-table-wrap"><table className="data-table workflow-data-table"><thead><tr><th>店铺</th><th>平台</th><th>巡检时间</th><th>巡检事项</th><th>巡检结论</th><th>状态</th><th>操作</th></tr></thead><tbody>{filteredInspections.map((item) => <tr key={item[0]}><td><strong>{item[0]}</strong></td><td><span className="soft-tag">{item[1]}</span></td><td>{item[2]}</td><td>{item[3]}</td><td>{item[4]}</td><td><span className={"status " + (item[5] === "正常" ? "status-success" : "status-warning")}><Dot tone={item[5] === "正常" ? "green" : "orange"} />{item[5]}</span></td><td><button className="row-action">查看详情</button></td></tr>)}{filteredInspections.length === 0 && <tr><td colSpan={7}><div className="table-state">没有符合当前筛选条件的巡店记录。</div></td></tr>}</tbody></table></div></section>
      {attachmentModal}
    </>;
  }

  if (activeTab === "reviews") {
    const reviews = [["天猫-志高亿用专卖店", "5 星", "商品使用方便，出水很快。", "已回复", "7月16日"], ["抖店-志高商业设备旗舰店", "2 星", "包装有破损，希望改善。", "待回复", "7月16日"], ["京东-志高商用设备旗舰店", "3 星", "物流略慢，产品正常。", "待回复", "7月15日"], ["拼多多-志高商用厨电旗舰店", "5 星", "复购第二次，满意。", "已回复", "7月15日"]];
    const filteredReviews = reviews.filter((item) => {
      const matchesQuery = !taskQuery.trim() || item.join(" ").toLocaleLowerCase("zh-CN").includes(taskQuery.trim().toLocaleLowerCase("zh-CN"));
      return matchesQuery && (reviewStatuses.length === 0 || reviewStatuses.includes(item[3] as "待回复" | "已回复"));
    });
    return <>
      {subnav}
      <section className="workflow-toolbar"><div><span className="eyebrow">REVIEW CARE</span><h2>评价维护</h2><p>集中跟进各平台商品评价，优先处理低分、售后与未回复内容。</p></div><button className="primary-button">＋ 新建回复模板</button></section>
      <section className="workflow-kpi-grid"><article><span>近 30 天评价</span><strong>1,286</strong><small>较上周期 +8.4%</small></article><article><span>好评率</span><strong className="green-text">96.8%</strong><small>4–5 星评价占比</small></article><article><span>待回复评价</span><strong className="orange-text">18 条</strong><small>其中 3 条低于 3 星</small></article><article><span>平均响应时长</span><strong>3.2 小时</strong><small>目标：12 小时内</small></article></section>
      <section className="panel workflow-table-panel"><div className="table-toolbar"><div><h2>评价跟进清单</h2><p>支持按店铺与处理状态筛选，回复后自动记录处理时间。</p></div><div className="workflow-filter-row"><input value={taskQuery} onChange={(event) => setTaskQuery(event.target.value)} placeholder="搜索店铺或评价内容" aria-label="搜索评价内容" /><SearchableMultiSelect values={reviewStatuses} onChange={(values) => setReviewStatuses(values as Array<"待回复" | "已回复">)} ariaLabel="评价处理状态" allLabel="全部处理状态" searchPlaceholder="搜索评价处理状态" options={[{ value: "待回复", label: "待回复" }, { value: "已回复", label: "已回复" }]} /></div></div><div className="data-table-wrap"><table className="data-table workflow-data-table"><thead><tr><th>店铺</th><th>星级</th><th>评价内容</th><th>处理状态</th><th>评价日期</th><th>操作</th></tr></thead><tbody>{filteredReviews.map((item) => <tr key={item[0] + "-" + item[4]}><td><strong>{item[0]}</strong></td><td><span className={item[1] === "5 星" ? "green-text" : item[1] === "2 星" ? "red-text" : "orange-text"}>{item[1]}</span></td><td>{item[2]}</td><td><span className={"status " + (item[3] === "已回复" ? "status-success" : "status-warning")}><Dot tone={item[3] === "已回复" ? "green" : "orange"} />{item[3]}</span></td><td>{item[4]}</td><td><button className="row-action">{item[3] === "已回复" ? "查看回复" : "立即回复"}</button></td></tr>)}{filteredReviews.length === 0 && <tr><td colSpan={6}><div className="table-state">没有符合当前筛选条件的评价。</div></td></tr>}</tbody></table></div></section>
      {attachmentModal}
    </>;
  }

  if (activeTab === "launch") {
    return <>{subnav}<section className="workflow-toolbar"><div><span className="eyebrow">NEW PRODUCT LAUNCH</span><h2>新品上架</h2><p>新品项目同样使用待开始、工作中、已完成三阶段流转，并保留对应资料附件。</p></div><button className="primary-button" onClick={() => setLaunchCreateOpen((open) => !open)}>{launchCreateOpen ? "收起新增面板" : "＋ 新增新品项目"}</button></section>{feedback}{launchCreateOpen && <section className="panel workflow-create-panel"><div><h3>新增新品项目</h3><p>新项目默认进入“待开始”，随后可按实际进度推进或回退。</p></div><div className="workflow-create-fields"><input value={launchDraftName} onChange={(event) => setLaunchDraftName(event.target.value)} placeholder="新品名称" aria-label="新品名称" /><input value={launchDraftCode} onChange={(event) => setLaunchDraftCode(event.target.value)} placeholder="商品规格代码（可选）" aria-label="新品规格代码" /><input value={launchDraftStage} onChange={(event) => setLaunchDraftStage(event.target.value)} placeholder="当前节点" aria-label="新品当前节点" /><input value={launchDraftOwner} onChange={(event) => setLaunchDraftOwner(event.target.value)} placeholder="负责人" aria-label="新品负责人" /><input value={launchDraftDue} onChange={(event) => setLaunchDraftDue(event.target.value)} placeholder="计划上架日期" aria-label="新品计划上架日期" /><button className="primary-button" onClick={createLaunch}>创建新品项目</button></div></section>}<section className="launch-progress"><div><span>待开始</span><strong>{launchCount("待开始")}</strong><small>等待排期或资料准备</small></div><i>→</i><div><span>工作中</span><strong className="blue-text">{launchCount("工作中")}</strong><small>正在推进上架节点</small></div><i>→</i><div><span>已完成</span><strong className="green-text">{launchCount("已完成")}</strong><small>已完成当前上架流程</small></div><i>→</i><div><span>含附件项目</span><strong>{launches.filter((item) => item.attachments.length > 0).length}</strong><small>图片、资料或表格附件</small></div></section><section className="panel workflow-table-panel"><div className="table-toolbar"><div><h2>新品项目进度</h2><p>每个新品可推进或退回状态，并按项目保存图片、资料与交接文件。</p></div><div className="workflow-filter-row"><input value={launchQuery} onChange={(event) => setLaunchQuery(event.target.value)} placeholder="搜索新品名称、编码或节点" aria-label="搜索新品项目" /><SearchableMultiSelect values={launchStatuses} onChange={(values) => setLaunchStatuses(values as WorkflowStatus[])} ariaLabel="新品上架状态" allLabel="全部状态" searchPlaceholder="搜索新品状态" options={workflowStages.map((stage) => ({ value: stage.value, label: stage.value }))} /></div></div><div className="data-table-wrap"><table className="data-table workflow-data-table workflow-launch-table"><thead><tr><th>新品名称</th><th>商品规格代码</th><th>当前节点</th><th>状态</th><th>负责人</th><th>计划上架</th><th>附件</th><th>操作</th></tr></thead><tbody>{filteredLaunches.map((launch) => <tr key={launch.id}><td><strong>{launch.productName}</strong></td><td>{launch.productCode}</td><td>{launch.stage}</td><td>{taskStatusBadge(launch.status)}</td><td>{launch.owner}</td><td>{launch.due}</td><td className="workflow-attachment-cell"><WorkflowAttachmentList attachments={launch.attachments} inputId={"workflow-launch-file-" + launch.id} onFiles={(files) => addLaunchAttachments(launch.id, files)} onRemove={(attachmentId) => removeLaunchAttachment(launch.id, attachmentId)} onPreview={setAttachmentViewer} /></td><td><WorkflowTransitionActions status={launch.status} onTransition={(nextStatus) => transitionLaunch(launch.id, nextStatus)} /></td></tr>)}{filteredLaunches.length === 0 && <tr><td colSpan={8}><div className="table-state">没有符合当前筛选条件的新品项目。</div></td></tr>}</tbody></table></div></section>{attachmentModal}</>;
  }

  return (
    <>
      {subnav}
      <section className="workflow-toolbar workflow-plan-toolbar">
        <div>
          <span className="eyebrow">OPERATION COLLABORATION</span>
          <h2>工作计划</h2>
          <p>新工作项可按需补充工作事项、内容、跟进人、店铺、时间与紧急程度；未填写项会保留默认提示。</p>
        </div>
        <form className="workflow-task-create-fields" onSubmit={(event) => {
          event.preventDefault();
          void createTask();
        }}>
          <label><span>工作事项</span><input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} placeholder="如：大促价格检查（可选）" aria-label="工作事项" /></label>
          <label><span>工作内容</span><input value={draftContent} onChange={(event) => setDraftContent(event.target.value)} placeholder="填写需完成的内容（可选）" aria-label="工作内容" /></label>
          <label><span>跟进人</span><input value={draftOwner} onChange={(event) => setDraftOwner(event.target.value)} placeholder="负责人姓名或小组（可选）" aria-label="跟进人" /></label>
          <label><span>店铺名称</span><input value={draftShopName} onChange={(event) => setDraftShopName(event.target.value)} placeholder="关联店铺名称（可选）" aria-label="店铺名称" /></label>
          <label><span>开始时间</span><input type="date" value={draftStartDate} onChange={(event) => setDraftStartDate(event.target.value)} aria-label="开始时间" /></label>
          <label><span>截止时间</span><input type="date" min={draftStartDate || undefined} value={draftDueDate} onChange={(event) => setDraftDueDate(event.target.value)} aria-label="截止时间" /></label>
          <label><span>紧急程度</span><SearchableSelect value={draftPriority} onChange={(value) => setDraftPriority(value as WorkflowPriority | "")} ariaLabel="紧急程度" searchPlaceholder="搜索紧急程度" options={[{ value: "", label: "未设置" }, { value: "high", label: "紧急" }, { value: "normal", label: "普通" }, { value: "low", label: "低" }]} /></label>
          <button type="submit" className="primary-button" disabled={tasksLoading || taskMutationPending}>{tasksLoading ? "读取中…" : taskMutationPending ? "保存中…" : "＋ 新建工作项"}</button>
        </form>
      </section>
      {feedback}
      <section className="workflow-kpi-grid">
        <article><span>未开始</span><strong>{taskCount("待开始")}</strong><small>等待启动的工作项</small></article>
        <article><span>工作中</span><strong className="blue-text">{taskCount("工作中")}</strong><small>正在推进的工作项</small></article>
        <article><span>已完成</span><strong className="green-text">{taskCount("已完成")}</strong><small>已办结的工作项</small></article>
        <article><span>含附件任务</span><strong>{tasks.filter((item) => item.attachments.length > 0).length}</strong><small>图片、文件与交接材料</small></article>
      </section>
      <section className="workflow-plan-controls panel">
        <div className="workflow-filter-row">
          <input value={taskQuery} onChange={(event) => setTaskQuery(event.target.value)} placeholder="搜索工作事项、内容、店铺或跟进人" aria-label="搜索工作计划" />
          <SearchableMultiSelect values={taskStatuses} onChange={(values) => setTaskStatuses(values as WorkflowStatus[])} ariaLabel="工作计划状态" allLabel="全部状态" searchPlaceholder="搜索工作计划状态" options={workflowStages.map((stage) => ({ value: stage.value, label: workflowStatusLabel(stage.value) }))} />
          <SearchableMultiSelect values={taskPriorities} onChange={(values) => setTaskPriorities(values as WorkflowPriority[])} ariaLabel="工作计划紧急程度" allLabel="全部紧急程度" searchPlaceholder="搜索紧急程度" options={[{ value: "high", label: "紧急" }, { value: "normal", label: "普通" }, { value: "low", label: "低" }]} />
        </div>
        <span className="soft-tag">显示 {filteredTasks.length} 项</span>
      </section>
      <section className="panel workflow-plan-table-panel">
        <div className="data-table-wrap">
          <table className="data-table workflow-data-table workflow-plan-table">
            <thead><tr><th>工作事项</th><th>工作内容</th><th>店铺</th><th>紧急程度</th><th>跟进人</th><th>截止时间</th><th>状态</th><th>来源</th><th>录入时间</th><th>附件</th><th>操作</th></tr></thead>
            <tbody>{filteredTasks.map((task) => <tr key={task.id}>
              <td><div className="workflow-plan-title"><strong>{task.title}</strong><small>{task.category}</small></div></td>
              <td><p className="workflow-plan-content" title={task.workContent}>{task.workContent}</p></td>
              <td><span className="workflow-plan-shop" title={task.shopName}>{task.shopName}</span></td>
              <td><strong className={"workflow-priority priority-" + task.priority}>{workflowPriorityLabel(task.priority)}</strong></td>
              <td>{task.owner}</td>
              <td><input className="workflow-due-input" type="date" min={task.startDate === "待排期" ? undefined : task.startDate} value={task.due === "待排期" ? "" : task.due} aria-label={`调整${task.title}截止时间`} disabled={tasksLoading || taskMutationPending} onChange={(event) => void updateTask(task.id, { due: event.target.value || "待排期" })} /></td>
              <td><div className={`workflow-status-field ${workflowStatusClass(task.status)}`}><SearchableSelect value={task.status} onChange={(value) => void updateTask(task.id, { status: value as WorkflowStatus })} ariaLabel={`${task.title}状态`} searchPlaceholder="搜索状态" disabled={tasksLoading || taskMutationPending} options={workflowStages.map((stage) => ({ value: stage.value, label: workflowStatusLabel(stage.value) }))} /></div></td>
              <td><span className="workflow-plan-source">{task.source}</span></td>
              <td><time className="workflow-plan-recorded-at" dateTime={task.createdAt}>{formatWorkflowRecordedAt(task.createdAt)}</time></td>
              <td className="workflow-plan-attachments"><WorkflowAttachmentList attachments={task.attachments} inputId={"workflow-plan-file-" + task.id} onFiles={(files) => addTaskAttachments(task.id, files)} onRemove={(attachmentId) => removeTaskAttachment(task.id, attachmentId)} onPreview={setAttachmentViewer} /></td>
              <td><button type="button" className="row-action workflow-delete-button" disabled={tasksLoading || taskMutationPending} onClick={() => setTaskPendingDeletion(task)}>删除</button></td>
            </tr>)}{filteredTasks.length === 0 && <tr><td colSpan={11}><div className="table-state">没有符合当前筛选条件的工作计划。</div></td></tr>}</tbody>
          </table>
        </div>
      </section>
      {attachmentModal}
      {taskDeletionModal}
    </>
  );
}


function CustomerServiceImportCard({ canImport, onCompleted }: { canImport: boolean; onCompleted: () => Promise<void> }) {
  const sessionFileRef = useRef<HTMLInputElement>(null);
  const chatFileRef = useRef<HTMLInputElement>(null);
  const [sessionFile, setSessionFile] = useState<File | null>(null);
  const [chatFile, setChatFile] = useState<File | null>(null);
  const [shopName, setShopName] = useState("志高商用设备");
  const [uploading, setUploading] = useState(false);
  const [feedback, setFeedback] = useState("");
  const acceptDroppedFiles = (files: FileList) => {
    if (!canImport) return;
    const candidates = Array.from(files);
    const nextSession = candidates.find((file) => /\.xlsx$/i.test(file.name));
    const nextChat = candidates.find((file) => /\.(log|txt)$/i.test(file.name));
    if (nextSession) setSessionFile(nextSession);
    if (nextChat) setChatFile(nextChat);
    setFeedback(nextSession && nextChat ? "已识别 Excel 会话记录和 LOG 聊天记录，请确认店铺后开始导入。" : "请同时拖入一份 .xlsx 会话记录和一份 .log/.txt 聊天记录。");
  };
  const uploadFile = async (file: File, kind: "session" | "chat") => {
    const chunkSize = 1024 * 1024;
    const chunkCount = Math.ceil(file.size / chunkSize);
    const init = await fetch("/api/customer-service/import/chunks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "init", kind, fileName: file.name, fileSizeBytes: file.size, chunkCount, fingerprint: `${kind}:${file.name}:${file.size}:${file.lastModified}` }) });
    const initPayload = await init.json().catch(() => null) as { ok?: boolean; message?: string; upload?: { id: string; receivedChunkIndexes?: number[] } } | null;
    if (!init.ok || !initPayload?.ok || !initPayload.upload) throw new Error(initPayload?.message || "无法创建分片上传任务");
    const uploaded = new Set(initPayload.upload.receivedChunkIndexes ?? []);
    for (let index = 0; index < chunkCount; index += 1) {
      if (uploaded.has(index)) continue;
      const part = file.slice(index * chunkSize, Math.min((index + 1) * chunkSize, file.size));
      const response = await fetch("/api/customer-service/import/chunks", { method: "PUT", headers: { "x-upload-id": initPayload.upload.id, "x-chunk-index": String(index), "content-type": "application/octet-stream" }, body: part });
      const payload = await response.json().catch(() => null) as { ok?: boolean; message?: string } | null;
      if (!response.ok || !payload?.ok) throw new Error(payload?.message || `第 ${index + 1} 个分片上传失败`);
    }
    return initPayload.upload.id;
  };
  const submit = async () => {
    if (!sessionFile || !chatFile || uploading || !canImport) return;
    setUploading(true); setFeedback("");
    try {
      const [sessionUploadId, chatUploadId] = await Promise.all([uploadFile(sessionFile, "session"), uploadFile(chatFile, "chat")]);
      const response = await fetch("/api/customer-service/import/chunks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "complete", shopName, sessionUploadId, chatUploadId, sessionFileName: sessionFile.name, chatFileName: chatFile.name }) });
      const payload = await response.json().catch(() => null) as { ok?: boolean; status?: string; message?: string; summary?: { matchedCount: number; timeOnlyMatchedCount: number; sessionOnlyCount: number; chatOnlyCount: number } } | null;
      if (!response.ok || !payload?.ok) throw new Error(payload?.message || "客服会话导入失败");
      const summary = payload.summary;
      setFeedback(`${payload.message || "导入完成"}${summary ? ` 已关联 ${formatCount(summary.matchedCount + summary.timeOnlyMatchedCount)} 条，待核对 ${formatCount(summary.sessionOnlyCount + summary.chatOnlyCount)} 条。` : ""}`);
      setSessionFile(null); setChatFile(null); await onCompleted();
    } catch (error) { setFeedback(error instanceof Error ? error.message : "客服会话导入失败"); }
    finally { setUploading(false); }
  };
  return <section className="customer-service-import-in-data" onDragOver={(event) => { if (canImport) event.preventDefault(); }} onDrop={(event) => { event.preventDefault(); acceptDroppedFiles(event.dataTransfer.files); }}><div className="customer-service-import-copy"><span className="eyebrow">双文件关联导入</span><h3>客服会话与聊天记录</h3><p>可同时拖入一份 Excel 和一份 LOG；系统按咨询时间、顾客脱敏标识和会话顺序关联，补充日志会替换同一聊天的旧记录。</p></div><label className="customer-service-import-shop"><span>所属店铺</span><SearchableSelect value={shopName} onChange={setShopName} ariaLabel="客服导入店铺" searchPlaceholder="搜索客服店铺" options={[{ value: "志高商用设备", label: "志高商用设备" }, { value: "志高厨电", label: "志高厨电" }]} /></label><input className="file-input-hidden" ref={sessionFileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file && /\.xlsx$/i.test(file.name)) setSessionFile(file); else if (file) setFeedback("会话记录请上传 .xlsx 文件。"); event.currentTarget.value = ""; }} /><input className="file-input-hidden" ref={chatFileRef} type="file" accept=".log,.txt,text/plain" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file && /\.(log|txt)$/i.test(file.name)) setChatFile(file); else if (file) setFeedback("聊天记录请上传 .log 或 .txt 文件。"); event.currentTarget.value = ""; }} /><div className="customer-service-import-files"><button type="button" className={`customer-file-field ${sessionFile ? "selected" : ""}`} onClick={() => sessionFileRef.current?.click()} disabled={!canImport}><span>①</span><strong>{sessionFile?.name || "选择会话记录 Excel"}</strong><small>{sessionFile ? formatFileSize(sessionFile.size) : "咨询时间、顾客、客服、商品等字段"}</small></button><button type="button" className={`customer-file-field ${chatFile ? "selected" : ""}`} onClick={() => chatFileRef.current?.click()} disabled={!canImport}><span>②</span><strong>{chatFile?.name || "选择聊天记录 LOG"}</strong><small>{chatFile ? formatFileSize(chatFile.size) : "以“以下为一通会话”为分隔符"}</small></button></div><div className="customer-service-import-actions"><small>支持整组拖入；单个文件最大 25MB，仅管理员可导入。</small><button type="button" className="primary-button" disabled={!sessionFile || !chatFile || uploading || !canImport} onClick={() => void submit()}>{uploading ? "导入匹配中…" : canImport ? "开始导入并匹配" : "仅管理员可导入"}</button></div>{feedback && <p className={`customer-service-feedback ${feedback.includes("失败") || feedback.includes("请同时") || feedback.includes("请上传") ? "error" : ""}`}>{feedback}</p>}</section>;
}

function ImportView({ importSource, currentUser }: { importSource?: ImportSourceKey; currentUser: CurrentUser | null }) {
  const inputRef = useRef<HTMLInputElement>(null);
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
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");

  useEffect(() => {
    if (!importSource) return;
    setSelectedSource(importSource);
    setSelectedFile(null);
    setFeedback(null);
  }, [importSource]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const [response, inventoryResponse, erpResponse, financeResponse, netshopResponse, customerServiceResponse] = await Promise.all([
        fetch("/api/imports/sales", { cache: "no-store" }),
        fetch("/api/imports/inventory", { cache: "no-store" }),
        fetch("/api/imports/erp", { cache: "no-store" }),
        fetch("/api/imports/finance", { cache: "no-store" }),
        fetch("/api/netshop/import?limit=50", { cache: "no-store" }),
        fetch("/api/customer-service/import-history?limit=50", { cache: "no-store" }),
      ]);
      const payload = await response.json().catch(() => null) as (ImportHistoryResponse & { message?: string }) | null;
      const inventoryPayload = await inventoryResponse.json().catch(() => null) as { items?: InventoryImportHistoryItem[]; error?: string } | null;
      const erpPayload = await erpResponse.json().catch(() => null) as { items?: ErpReferenceImportBatch[]; error?: string } | null;
      const financePayload = await financeResponse.json().catch(() => null) as { items?: SalesImportBatch[]; error?: string } | null;
      const netshopPayload = await netshopResponse.json().catch(() => null) as { items?: NetshopImportHistoryItem[]; error?: string } | null;
      const customerServicePayload = await customerServiceResponse.json().catch(() => null) as { items?: CustomerServiceImportHistoryItem[]; error?: string } | null;
      if (!response.ok) throw new Error(payload?.message || `销售导入历史读取失败（${response.status}）`);
      if (!inventoryResponse.ok) throw new Error(inventoryPayload?.error || `库存导入历史读取失败（${inventoryResponse.status}）`);
      if (!erpResponse.ok) throw new Error(erpPayload?.error || `ERP 主数据导入历史读取失败（${erpResponse.status}）`);
      if (!financeResponse.ok) throw new Error(financePayload?.error || `财报导入历史读取失败（${financeResponse.status}）`);
      if (!netshopResponse.ok) throw new Error(netshopPayload?.error || `京东 SKU 导入历史读取失败（${netshopResponse.status}）`);
      if (!customerServiceResponse.ok) throw new Error(customerServicePayload?.error || `客服会话导入历史读取失败（${customerServiceResponse.status}）`);
      if (!Array.isArray(payload?.items) || !Array.isArray(inventoryPayload?.items) || !Array.isArray(erpPayload?.items) || !Array.isArray(financePayload?.items) || !Array.isArray(netshopPayload?.items) || !Array.isArray(customerServicePayload?.items)) throw new Error("导入历史响应格式不完整");
      const combined: UnifiedHistoryItem[] = [
        ...payload.items.map((item) => ({ ...item, sourceKey: "sales" as const, sourceLabel: "吉客云 ERP · 销售明细" })),
        ...inventoryPayload.items.map((item) => ({ ...item, sourceKey: "inventory" as const, sourceLabel: "吉客云 ERP · 分仓库存" })),
        ...erpPayload.items.map((item) => ({ ...item, sourceKey: item.sourceKey, sourceLabel: item.sourceLabel })),
        ...financePayload.items.map((item) => ({ ...item, sourceKey: "finance" as const, sourceLabel: "月度财报 · 志高事业部" })),
        ...netshopPayload.items
          .filter((item) => item.source === "jd_product_master" || item.source === "jd_yimei_sku" || item.dataset === "spu_daily" || item.dataset === "sku_daily")
          .map((item) => item.dataset === "spu_daily"
            ? { ...item, sourceKey: "jd_spu_daily" as const, sourceLabel: "京东店铺 · 商品 SPU 日数据" }
            : item.dataset === "sku_daily"
              ? { ...item, sourceKey: "jd_sku_daily" as const, sourceLabel: "京东店铺 · 商品 SKU 日数据" }
            : item.source === "jd_yimei_sku"
              ? { ...item, sourceKey: "jd_sku_images" as const, sourceLabel: "京东店铺 · SKU 主图" }
              : { ...item, sourceKey: "jd_sku" as const, sourceLabel: "京东店铺 · 商品 SKU" }),
        ...customerServicePayload.items.map((item) => ({ id: item.id, sourceKey: "customer_service" as const, sourceLabel: `客服会话 · ${item.shopName || "志高商用设备"}`, fileName: `${item.sessionFileName} + ${item.chatFileName}`, status: item.status, rowCount: item.conversationCount, insertedCount: item.matchedCount, warningCount: item.warnings.length, createdAt: item.createdAt, completedAt: item.completedAt })),
      ].sort((left, right) => Date.parse(right.completedAt || right.createdAt) - Date.parse(left.completedAt || left.createdAt));
      setHistory(combined);
    } catch (requestError) {
      setHistoryError(requestError instanceof Error ? requestError.message : "暂时无法读取导入历史");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadHistory(), 0);
    return () => window.clearTimeout(timer);
  }, [loadHistory]);

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
    { key: "sales", icon: "销", label: "销售明细", report: "销售单明细账", directEndpoint: "/api/imports/sales", chunkEndpoint: "/api/imports/sales/chunks", directFileSize: DIRECT_IMPORT_FILE_SIZE, maxFileSize: MAX_IMPORT_FILE_SIZE, chunkSize: SALES_UPLOAD_CHUNK_SIZE, needsSnapshotDate: false, extensions: [".xlsx"], accept: ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", systemLabel: "吉客云 ERP" },
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
  ];
  const activeSource = sourceOptions.find((item) => item.key === selectedSource)!;

  const acceptFile = useCallback((candidate?: File) => {
    setDragging(false);
    if (!candidate) return;
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
  }, [activeSource.extensions, activeSource.label, activeSource.maxFileSize, activeSource.report, activeSource.systemLabel]);

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
        title: "检测到重复文件",
        message: payload.message || `该文件已导入，系统没有重复写入${activeSource.label}数据。`,
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
        details: (payload.batch?.excludedCount ?? 0) > 0 ? [`已剔除刷刷仓 ${formatCount(payload.batch?.excludedCount)} 行`] : [],
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
      body: JSON.stringify({ action: "init", source: activeSource.formSource ?? selectedSource, fileName: file.name, fileSizeBytes: file.size, chunkCount, fingerprint }),
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
      body: JSON.stringify({ action: "complete", source: activeSource.formSource ?? selectedSource, uploadId: initPayload.upload.id, ...((activeSource.needsSnapshotDate || activeSource.includeSnapshotDate) ? { snapshotDate: activeSource.includeSnapshotDate ? shanghaiIsoToday() : snapshotDate } : {}) }),
    });
    return {
      payload: await completeResponse.json().catch(() => null) as UnifiedImportResponse | null,
      status: completeResponse.status,
    };
  };

  const importFile = async () => {
    if (!selectedFile || uploading) return;
    if (activeSource.needsSnapshotDate && !/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) {
      setFeedback({ tone: "error", title: "请选择快照日期", message: "分仓库存和库龄报表必须指定有效的快照日期。", details: [] });
      return;
    }
    if (activeSource.needsDailyRange && (!/^\d{4}-\d{2}-\d{2}$/.test(dailyStartDate) || !/^\d{4}-\d{2}-\d{2}$/.test(dailyEndDate) || dailyStartDate > dailyEndDate)) {
      setFeedback({ tone: "error", title: "请选择有效目标日期区间", message: "SKU/SPU 分天数据必须与下载的起止日期逐日一致。", details: [] });
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
      <div className="subnav"><button className="active">文件导入</button><button>导入历史</button><button>数据连续性</button></div>
      <section className="import-grid">
        <article className="panel import-panel">
          <span className="eyebrow">第 1 步</span><h2>选择数据类型</h2><p>销售、库存、主数据、京东商品 SKU 与月度财报使用同一套校验和导入历史。</p>
          <div className="source-grid">{sourceOptions.map((item) => <button type="button" className={item.key === selectedSource ? "selected" : ""} aria-pressed={item.key === selectedSource} key={item.key} onClick={() => { setSelectedSource(item.key); setSelectedFile(null); setFeedback(null); setUploadProgress(0); }}><span>{item.icon}</span><strong>{item.label}</strong><small>{item.report}</small></button>)}</div>
        </article>
        <article className="panel import-panel">
          {activeSource.isCustomerService ? <CustomerServiceImportCard canImport={currentUser?.role === "admin"} onCompleted={loadHistory} /> : <>
          <span className="eyebrow">第 2 步</span><h2>上传{activeSource.label}报表</h2><p>支持 {activeSource.extensions.join(" / ")}，单文件最大 {formatFileSize(activeSource.maxFileSize)}；月度财报按月份自动去重并合并同名科目。</p>
          {activeSource.needsSnapshotDate && <label className="import-snapshot-field"><span>数据快照日期</span><input type="date" value={snapshotDate} max={shanghaiIsoToday()} onChange={(event) => setSnapshotDate(event.target.value)} /></label>}
          {activeSource.needsDailyRange && <div className="import-snapshot-field"><label><span>目标起始日期</span><input type="date" value={dailyStartDate} max={dailyEndDate} onChange={(event) => setDailyStartDate(event.target.value)} /></label><label><span>目标结束日期</span><input type="date" value={dailyEndDate} min={dailyStartDate} max={addIsoDays(shanghaiIsoToday(), -1)} onChange={(event) => setDailyEndDate(event.target.value)} /></label></div>}
          <input
            ref={inputRef}
            className="file-input-hidden"
            type="file"
            accept={activeSource.accept}
            onChange={(event) => {
              acceptFile(event.currentTarget.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
          <button
            type="button"
            className={`dropzone ${selectedFile ? "uploaded" : ""} ${dragging ? "dragging" : ""}`}
            onClick={() => inputRef.current?.click()}
            onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setDragging(true); }}
            onDragLeave={(event) => { event.preventDefault(); if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
            onDrop={(event) => { event.preventDefault(); acceptFile(event.dataTransfer.files?.[0]); }}
          >
            <span>{selectedFile ? "✓" : "↑"}</span>
            <strong>{selectedFile ? selectedFile.name : `将 ${activeSource.extensions.join(" / ")} 文件拖到此处，或点击选择`}</strong>
            <small>{selectedFile ? `${formatFileSize(selectedFile.size)} · ${selectedFile.size > activeSource.directFileSize ? "将启用分片上传与断点续传" : "将直接上传并校验"}` : `上传后将写入${activeSource.label}正式数据`}</small>
          </button>
          <div className="import-actions">
            <span>{uploading ? uploadStage : selectedFile ? `准备导入${activeSource.systemLabel} ${activeSource.label}` : "请选择待导入文件"}</span>
            <button type="button" className="primary-button" disabled={!selectedFile || uploading} onClick={() => void importFile()}>{uploading ? `${uploadProgress}%` : "开始导入"}</button>
          </div>
          {uploading && selectedFile && <div className="import-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={uploadProgress} aria-label={`${activeSource.label}上传进度`}><span style={{ width: `${uploadProgress}%` }} /></div>}
          </>}
        </article>
      </section>

      <section className="import-overview-grid">{sourceOptions.map((source) => { const item = latestBySource.get(source.key); return <article className="panel import-overview-card" key={source.key}><span>{source.label}</span><strong>{item?.fileName ?? "尚未导入"}</strong><small>{item ? `${item.snapshotDate ? `快照 ${item.snapshotDate} · ` : ""}${formatCount(item.insertedCount)} 行 · ${formatDateTime(item.completedAt || item.createdAt)}` : `等待导入${source.report}`}</small></article>; })}</section>

      {feedback && <section className={`import-feedback import-feedback-${feedback.tone}`} role={feedback.tone === "error" ? "alert" : "status"} aria-live="polite"><span className="feedback-symbol">{feedback.tone === "success" ? "✓" : feedback.tone === "duplicate" ? "≡" : feedback.tone === "warning" ? "!" : "×"}</span><div><strong>{feedback.title}</strong><p>{feedback.message}</p>{feedback.details.length > 0 && <ul>{feedback.details.map((detail, index) => <li key={`${detail}-${index}`}>{detail}</li>)}</ul>}</div></section>}

      <section className="panel table-panel import-history-panel">
        <div className="section-header"><div><h2>最近导入记录</h2><p>来自导入接口的真实批次记录</p></div><button className="text-button" disabled={historyLoading} onClick={() => void loadHistory()}>{historyLoading ? "刷新中…" : "刷新记录"} <span>↻</span></button></div>
        <div className="data-table-wrap"><table className="data-table"><thead><tr><th>数据来源</th><th>文件名称</th><th>文件大小</th><th>数据行数</th><th>导入结果</th><th>完成时间</th></tr></thead><tbody>
          {historyLoading && history.length === 0 && <tr><td colSpan={6}><div className="table-state"><span className="state-spinner" />正在读取导入记录…</div></td></tr>}
          {!historyLoading && historyError && <tr><td colSpan={6}><div className="table-state table-state-error"><span>{historyError}</span><button className="row-action" onClick={() => void loadHistory()}>重试</button></div></td></tr>}
          {!historyLoading && !historyError && history.length === 0 && <tr><td colSpan={6}><div className="table-state">暂无导入记录，请先上传业务报表。</div></td></tr>}
          {history.map((row) => {
            const rejected = row.status === "rejected";
            const duplicate = row.status === "duplicate";
            const warned = row.warningCount > 0;
            const resultText = rejected ? "导入失败" : duplicate ? "重复文件" : warned ? `成功 · ${row.warningCount} 条警告` : "成功";
            const statusClass = rejected ? "status-danger" : duplicate || warned ? "status-warning" : "status-success";
            const dotTone = rejected ? "red" : duplicate || warned ? "orange" : "green";
            const countNote = row.sourceKey === "products" || row.sourceKey === "combos"
              ? `新增 ${formatCount(row.insertedCount)} · 更新 ${formatCount(row.updatedCount)}`
              : `新增 ${formatCount(row.insertedCount)}${row.excludedCount ? ` · 剔除 ${formatCount(row.excludedCount)}` : row.duplicateCount ? ` · 重复 ${formatCount(row.duplicateCount)}` : ""}`;
            return <tr key={`${row.sourceKey}-${row.id}`}><td><strong>{row.sourceLabel}</strong>{row.snapshotDate && <small className="history-source-date">快照 {row.snapshotDate}</small>}</td><td><div className="history-file"><strong>{row.fileName}</strong>{row.sheetName && <small>工作表：{row.sheetName}</small>}</div></td><td>{row.fileSizeBytes === undefined ? "—" : formatFileSize(row.fileSizeBytes)}</td><td><div className="history-count"><strong>{formatCount(row.rowCount)}</strong><small>{countNote}</small></div></td><td><span className={`status ${statusClass}`}><Dot tone={dotTone} />{resultText}</span></td><td>{formatDateTime(row.completedAt || row.createdAt)}</td></tr>;
          })}
        </tbody></table></div>
      </section>
    </>
  );
}

function customerServiceStatusLabel(status: CustomerServiceConversation["matchStatus"]) {
  return ({ matched: "已匹配", session_only: "缺聊天记录", chat_only: "缺会话记录", ambiguous: "待核对" })[status];
}

const customerProblemTypes = ["商品咨询", "价格优惠", "物流发货", "售后维修", "退换货", "安装使用", "发票开票", "催单改单", "其他"] as const;
const customerRobotOptions = [{ value: "robot_only", label: "仅机器人" }, { value: "contains_robot", label: "包含机器人" }, { value: "exclude_robot", label: "排除机器人" }] as const;
const customerConversionOptions = [{ value: "converted", label: "已转化" }, { value: "not_converted", label: "未转化" }, { value: "unknown", label: "未知" }] as const;

function CustomerServiceView({ customStartDate, customEndDate, currentUser, onNavigate }: { customStartDate: string; customEndDate: string; currentUser: CurrentUser | null; onNavigate: (key: ModuleKey, importSource?: ImportSourceKey) => void }) {
  const [startDate, setStartDate] = useState(customStartDate);
  const [endDate, setEndDate] = useState(customEndDate);
  const [agent, setAgent] = useState("");
  const [shopName, setShopName] = useState("");
  const [status, setStatus] = useState("");
  const [robotScope, setRobotScope] = useState("");
  const [problemType, setProblemType] = useState("");
  const [conversionStatus, setConversionStatus] = useState("");
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const [skuIds, setSkuIds] = useState("");
  const [spuIds, setSpuIds] = useState("");
  const [period, setPeriod] = useState<"day" | "week" | "month" | "custom">("custom");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<CustomerServiceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<CustomerServiceConversation | null>(null);
  const [busyId, setBusyId] = useState<number | "batch" | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState("");
  const [analysisReady, setAnalysisReady] = useState<boolean | null>(null);
  const optionsLoadedRef = useRef(false);
  const debouncedCustomerQuery = useDebouncedValue(query);
  const debouncedSkuIds = useDebouncedValue(skuIds);
  const debouncedSpuIds = useDebouncedValue(spuIds);
  const canAnnotate = currentUser?.role === "operator" || currentUser?.role === "admin";
  const canImport = currentUser?.role === "admin";

  useEffect(() => {
    if (!canAnnotate) return;
    const controller = new AbortController();
    void fetch("/api/customer-service/analyze", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as { configured?: boolean } | null;
        if (!controller.signal.aborted) setAnalysisReady(response.ok && payload?.configured === true);
      })
      .catch(() => { if (!controller.signal.aborted) setAnalysisReady(false); });
    return () => controller.abort();
  }, [canAnnotate]);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "30" });
      params.set("includeOptions", optionsLoadedRef.current ? "false" : "true");
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      if (agent) params.set("agent", agent);
      if (shopName) params.set("shopName", shopName);
      if (status) params.set("status", status);
      if (robotScope) params.set("robotScope", robotScope);
      if (problemType) params.set("problemType", problemType);
      if (conversionStatus) params.set("conversionStatus", conversionStatus);
      if (category) params.set("category", category);
      if (debouncedCustomerQuery.trim()) params.set("query", debouncedCustomerQuery.trim());
      if (debouncedSkuIds.trim()) params.set("skuIds", debouncedSkuIds.trim());
      if (debouncedSpuIds.trim()) params.set("spuIds", debouncedSpuIds.trim());
      const response = await fetch(`/api/customer-service/conversations?${params.toString()}`, { cache: "no-store", signal });
      const payload = await response.json().catch(() => null) as CustomerServiceData & { error?: string } | null;
      if (!response.ok || !payload) throw new Error(payload?.error || "读取客服会话失败");
      if (!signal?.aborted) {
        setData((current) => ({
          ...payload,
          agents: payload.agents.length ? payload.agents : current?.agents ?? [],
          shops: payload.shops.length ? payload.shops : current?.shops ?? [],
          categories: payload.categories.length ? payload.categories : current?.categories ?? [],
        }));
        if (payload.agents.length || payload.shops.length || payload.categories.length) optionsLoadedRef.current = true;
      }
    } catch (reason) { if (!signal?.aborted) setError(reason instanceof Error ? reason.message : "读取客服会话失败"); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [agent, category, conversionStatus, debouncedCustomerQuery, debouncedSkuIds, debouncedSpuIds, endDate, page, problemType, robotScope, shopName, startDate, status]);

  useEffect(() => { const controller = new AbortController(); const timer = window.setTimeout(() => void load(controller.signal), 0); return () => { window.clearTimeout(timer); controller.abort(); }; }, [load]);
  useEffect(() => { setPage(1); }, [agent, category, conversionStatus, endDate, problemType, query, robotScope, shopName, skuIds, spuIds, startDate, status]);

  const selectPeriod = (next: "day" | "week" | "month" | "custom") => {
    setPeriod(next);
    if (next === "custom") return;
    const anchor = endDate || shanghaiIsoToday();
    setEndDate(anchor);
    setStartDate(next === "day" ? anchor : next === "week" ? addIsoDays(anchor, -6) : `${anchor.slice(0, 7)}-01`);
  };
  const pageCount = Math.max(1, Math.ceil((data?.pagination.total ?? 0) / (data?.pagination.pageSize ?? 30)));

  const saveAnnotation = async (item: CustomerServiceConversation, patch: Partial<Pick<CustomerServiceConversation, "robotScope" | "problemType" | "conversionStatus" | "serviceIssues" | "summaryText">>) => {
    if (!canAnnotate) return;
    setBusyId(item.id); setError("");
    const next = { ...item, ...patch, analysisSource: "manual" as const };
    setData((current) => current ? { ...current, items: current.items.map((row) => row.id === item.id ? next : row) } : current);
    setSelected((current) => current?.id === item.id ? next : current);
    try {
      const response = await fetch("/api/customer-service/conversations", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: item.id, ...patch }) });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || "保存客服标注失败");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "保存客服标注失败"); await load(); }
    finally { setBusyId(null); }
  };

  const analyze = async (ids: number[], marker: number | "batch") => {
    if (!ids.length || !canAnnotate) return;
    setBusyId(marker); setError("");
    try {
      for (let offset = 0; offset < ids.length; offset += 8) {
        const batch = ids.slice(offset, offset + 8);
        setAnalysisProgress(`${Math.min(offset + batch.length, ids.length)}/${ids.length}`);
        const response = await fetch("/api/customer-service/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: batch }) });
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        if (!response.ok) throw new Error(payload?.error || "AI 客服分析失败");
      }
      await load();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "AI 客服分析失败";
      if (message.includes("尚未配置可用的文本模型")) setAnalysisReady(false);
      setError(message);
    }
    finally { setBusyId(null); setAnalysisProgress(""); }
  };

  return <section className="customer-service-page">
    <div className="customer-service-heading"><div><span className="eyebrow">网店分析 / 客服分析</span><h2>会话与聊天记录</h2><p>按时间和顾客标识关联会话，支持机器人、问题类型、订单转化、AI 服务质检和小结标注。</p></div><div className="customer-service-heading-actions">{canAnnotate && <button type="button" className="primary-button" onClick={() => void analyze((data?.items ?? []).filter((item) => !item.analyzedAt).map((item) => item.id), "batch")} disabled={analysisReady !== true || busyId !== null || !(data?.items ?? []).some((item) => !item.analyzedAt)}>{busyId === "batch" ? `AI分析中${analysisProgress ? ` ${analysisProgress}` : "…"}` : analysisReady === false ? "请先配置文本模型" : "AI分析本页未标注"}</button>}<button type="button" className="secondary-button" onClick={() => void load()} disabled={loading}>{loading ? "刷新中…" : "↻ 刷新数据"}</button></div></div>
    <CustomerServiceImportCard canImport={canImport} onCompleted={load} />
    <section className="customer-service-data-source panel"><strong>客服会话数据</strong><span>可在本页直接导入；「数据导入 → 客服会话」也保留相同入口。</span><label className="customer-service-shop-select"><span>店铺</span><SearchableSelect value={shopName} onChange={setShopName} ariaLabel="客服店铺筛选" searchPlaceholder="搜索店铺" options={[{ value: "", label: "全部店铺" }, ...(data?.shops ?? []).map((name) => ({ value: name, label: name }))]} /></label></section>
    {error && <section className="customer-service-feedback error" role="alert">{error}</section>}
    {canAnnotate && analysisReady === false && <section className="customer-service-feedback error customer-service-analysis-setup" role="status"><span>客服会话已导入；AI 标注尚缺文本模型。配置并测试成功后即可分批分析本页全部未标注记录。</span><button type="button" className="row-action" onClick={() => onNavigate("ai")}>前往 AI 助理配置</button></section>}
    <section className="customer-service-filters panel"><div className="customer-period-tabs" role="group" aria-label="时间维度">{(["day", "week", "month", "custom"] as const).map((value) => <button type="button" key={value} className={period === value ? "active" : ""} onClick={() => selectPeriod(value)}>{({ day: "日", week: "周", month: "月", custom: "自定义" })[value]}</button>)}</div><label>咨询日期<input type="date" value={startDate} onChange={(event) => { setPeriod("custom"); setStartDate(event.target.value); }} /></label><span>至</span><label><span className="sr-only">结束日期</span><input type="date" value={endDate} min={startDate} onChange={(event) => { setPeriod("custom"); setEndDate(event.target.value); }} /></label><label><span>客服</span><SearchableSelect value={agent} onChange={setAgent} ariaLabel="客服筛选" searchPlaceholder="搜索客服" options={[{ value: "", label: "全部客服" }, ...(data?.agents ?? []).map((name) => ({ value: name, label: name }))]} /></label><label><span>匹配状态</span><SearchableSelect value={status} onChange={setStatus} ariaLabel="匹配状态筛选" searchPlaceholder="搜索匹配状态" options={[{ value: "", label: "全部状态" }, { value: "matched", label: "已匹配" }, { value: "session_only", label: "缺聊天记录" }, { value: "chat_only", label: "缺会话记录" }]} /></label><label><span>机器人</span><SearchableSelect value={robotScope} onChange={setRobotScope} ariaLabel="机器人内容筛选" searchPlaceholder="搜索机器人标注" options={[{ value: "", label: "全部" }, ...customerRobotOptions]} /></label><label><span>问题类型</span><SearchableSelect value={problemType} onChange={setProblemType} ariaLabel="问题类型筛选" searchPlaceholder="搜索问题类型" options={[{ value: "", label: "全部" }, ...customerProblemTypes.map((value) => ({ value, label: value }))]} /></label><label><span>吉客云类目</span><SearchableSelect value={category} onChange={setCategory} ariaLabel="吉客云类目筛选" searchPlaceholder="搜索吉客云类目" options={[{ value: "", label: "全部类目" }, ...(data?.categories ?? []).map((value) => ({ value, label: value }))]} /></label><label><span>订单转化</span><SearchableSelect value={conversionStatus} onChange={setConversionStatus} ariaLabel="订单转化筛选" searchPlaceholder="搜索转化状态" options={[{ value: "", label: "全部" }, ...customerConversionOptions]} /></label><label className="customer-service-id-search"><span>SKU ID（可多项）</span><input value={skuIds} onChange={(event) => setSkuIds(event.target.value)} placeholder="逗号、空格或换行分隔" /></label><label className="customer-service-id-search"><span>SPU ID（可多项）</span><input value={spuIds} onChange={(event) => setSpuIds(event.target.value)} placeholder="逗号、空格或换行分隔" /></label><label className="customer-service-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索顾客、客服、商品、服务问题或小结" /></label></section>
    <section className="panel table-panel customer-service-table-panel"><div className="section-header"><div><h2>会话列表</h2><p>正向按 SKUID → 商家SKU → 吉客云网店规格编码匹配；未命中时从吉客云网店规格编码唯一反查 SKUID，最终展示 SKUID、吉客云货品编号与品类。</p></div><span className="soft-tag">{formatCount(data?.pagination.total ?? 0)} 条</span></div><div className="data-table-wrap"><table className="data-table customer-service-table customer-service-analysis-table"><thead><tr><th>时间 / 顾客</th><th>客服</th><th>SKUID / 吉客云编号</th><th>吉客云类目</th><th>消息数</th><th>机器人内容</th><th>问题类型</th><th>订单转化</th><th>AI服务问题 / 小结</th><th>匹配状态</th><th aria-label="操作" /></tr></thead><tbody>
      {loading && <tr><td colSpan={11}><div className="table-state"><span className="state-spinner" />正在读取客服会话…</div></td></tr>}
      {!loading && error && <tr><td colSpan={11}><div className="table-state table-state-error">{error}</div></td></tr>}
      {!loading && !error && data?.items.length === 0 && <tr><td colSpan={11}><div className="table-state">暂无会话记录。请在数据导入模块完成客服会话导入。</div></td></tr>}
      {data?.items.map((item) => <tr key={item.id}>
        <td><div className="customer-time"><small>{item.consultedAt}</small><strong>{item.customerId || item.chatCustomerAlias || "未知顾客"}</strong><small>{item.shopName}</small></div></td>
        <td><strong>{item.agent || "—"}</strong><small>{item.skillGroup || item.transferredAgent || ""}</small></td>
        <td><strong>{item.matchedSkuId ? `SKUID ${item.matchedSkuId}` : item.productSku || "—"}</strong><small>{item.productSpuId ? `SPU ${item.productSpuId}` : item.productName || "未关联商品"}</small>{item.erpProductCode && <small>吉客云编号 {item.erpProductCode}</small>}{item.matchedSkuId && item.productSku !== item.matchedSkuId && <small>会话规格 {item.productSku}</small>}</td>
        <td><span className="customer-category" title={item.productCategory}>{item.productCategory || "未匹配类目"}</span></td>
        <td><strong>{item.messages.length || item.customerMessageCount || 0} / {item.agentMessageCount ?? "—"}</strong><small>客户 / 客服</small></td>
        <td><SearchableSelect className="customer-annotation-select" value={item.robotScope} disabled={!canAnnotate || busyId === item.id} ariaLabel={`${item.id}机器人内容`} searchPlaceholder="搜索机器人标注" options={[{ value: "", label: "待标注", disabled: true }, ...customerRobotOptions]} onChange={(value) => void saveAnnotation(item, { robotScope: value as CustomerServiceConversation["robotScope"] })} /></td>
        <td><SearchableSelect className="customer-annotation-select" value={item.problemType} disabled={!canAnnotate || busyId === item.id} ariaLabel={`${item.id}问题类型`} searchPlaceholder="搜索问题类型" options={[{ value: "", label: "待标注", disabled: true }, ...customerProblemTypes.map((value) => ({ value, label: value }))]} onChange={(value) => void saveAnnotation(item, { problemType: value as CustomerServiceConversation["problemType"] })} /></td>
        <td><SearchableSelect className="customer-annotation-select" value={item.conversionStatus} disabled={!canAnnotate || busyId === item.id} ariaLabel={`${item.id}订单转化`} searchPlaceholder="搜索转化状态" options={[{ value: "", label: "待标注", disabled: true }, ...customerConversionOptions]} onChange={(value) => void saveAnnotation(item, { conversionStatus: value as CustomerServiceConversation["conversionStatus"] })} /></td>
        <td><div className="customer-ai-summary"><strong title={item.serviceIssues}>{item.serviceIssues || "待 AI 分析服务问题"}</strong><small title={item.summaryText}>{item.summaryText || "暂无小结"}</small>{item.analyzedAt && <em>AI · {formatDateTime(item.analyzedAt)}</em>}</div></td>
        <td><span className={`customer-match customer-match-${item.matchStatus}`}>{customerServiceStatusLabel(item.matchStatus)}<small>{item.matchConfidence === "exact" ? "时间 + 顾客" : item.matchConfidence === "time_only" ? "仅时间" : "待补充"}</small></span></td>
        <td><div className="customer-row-actions">{canAnnotate && <button type="button" className="row-action" disabled={busyId !== null} onClick={() => void analyze([item.id], item.id)}>{busyId === item.id ? "分析中…" : "AI分析"}</button>}<button type="button" className="row-action" onClick={() => setSelected(item)}>{item.messages.length ? "查看会话" : "查看详情"}</button></div></td>
      </tr>)}
    </tbody></table></div>{pageCount > 1 && <div className="customer-service-pagination"><button type="button" className="row-action" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>上一页</button><span>第 {page} / {pageCount} 页</span><button type="button" className="row-action" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>下一页</button></div>}</section>
    {selected && <div className="modal-backdrop" onClick={() => setSelected(null)}><section className="customer-transcript" role="dialog" aria-modal="true" aria-label="客服会话详情" onClick={(event) => event.stopPropagation()}><header><div><span>{selected.consultedAt}</span><h3>{selected.customerId || selected.chatCustomerAlias || "未知顾客"} · {selected.agent || "未识别客服"}</h3><small>{selected.matchedSkuId ? `SKUID ${selected.matchedSkuId}` : selected.productSku ? `商品规格 ${selected.productSku}` : "未关联商品"} · {customerServiceStatusLabel(selected.matchStatus)}</small></div><button type="button" onClick={() => setSelected(null)} aria-label="关闭">×</button></header><div className="customer-transcript-metrics"><span>咨询类型：{selected.consultationType || "—"}</span><span>吉客云编号：{selected.erpProductCode || "未匹配"}</span><span>吉客云类目：{selected.productCategory || "未匹配"}</span><span>响应：{selected.responseSeconds === null ? "—" : `${selected.responseSeconds}s`}</span><span>时长：{selected.durationMinutes === null ? "—" : `${selected.durationMinutes} 分钟`}</span></div><div className="customer-analysis-editor"><label><span>服务问题</span><textarea value={selected.serviceIssues} disabled={!canAnnotate} onChange={(event) => setSelected({ ...selected, serviceIssues: event.target.value })} onBlur={() => void saveAnnotation(selected, { serviceIssues: selected.serviceIssues })} placeholder="AI 分析或人工补充客服服务问题" /></label><label><span>会话小结</span><textarea value={selected.summaryText} disabled={!canAnnotate} onChange={(event) => setSelected({ ...selected, summaryText: event.target.value })} onBlur={() => void saveAnnotation(selected, { summaryText: selected.summaryText })} placeholder="概括顾客诉求、客服处理与结果" /></label></div><div className="customer-transcript-messages">{selected.messages.length ? selected.messages.map((message, index) => <article key={`${message.sentAt}-${index}`} className={message.sender === selected.agent ? "agent" : "customer"}><strong>{message.sender || "未知"}</strong><small>{message.sentAt}</small><p>{message.content || "（无文字内容）"}</p></article>) : <p className="soft-text">此会话未匹配到聊天记录；会话表中的结构化字段仍已完整导入。</p>}</div></section></div>}
  </section>;
}

function SettingsView({ currentUser }: { currentUser: CurrentUser | null }) {
  const [settings, setSettings] = useState<OperatingSettings | null>(null);
  const [activeTab, setActiveTab] = useState<"parameters" | "master" | "permissions">("parameters");
  const [marketData, setMarketData] = useState<ComponentProps<typeof MarketDataImportPanel>["data"]>(null);
  const [loading, setLoading] = useState(true);
  const [marketLoading, setMarketLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [marketReloadKey, setMarketReloadKey] = useState(0);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { const response = await fetch("/api/settings", { cache: "no-store" }); const payload = await response.json().catch(() => null) as OperatingSettings | null; if (!response.ok || !payload) throw new Error("系统设置读取失败"); setSettings(payload); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "暂时无法读取系统设置"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => {
    if (activeTab !== "master") return;
    const controller = new AbortController();
    setMarketLoading(true);
    void fetch("/api/market/overview", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as ComponentProps<typeof MarketDataImportPanel>["data"] | null;
        if (!response.ok || !payload) throw new Error("市场主数据读取失败");
        setMarketData(payload);
      })
      .catch((reason) => { if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : "市场主数据读取失败"); })
      .finally(() => { if (!controller.signal.aborted) setMarketLoading(false); });
    return () => controller.abort();
  }, [activeTab, marketReloadKey]);
  const updateNumber = (key: "targetDays" | "criticalDays" | "slowDays" | "stagnantDays", value: number) => setSettings((current) => current ? { ...current, [key]: Number.isFinite(value) ? value : 0 } : current);
  const toggle = (key: "autoReplenishment" | "inventoryAlert" | "allowNegativeInventory") => setSettings((current) => current ? { ...current, [key]: !current[key] } : current);
  const save = async () => { if (!settings) return; setSaving(true); setNotice(""); try { const response = await fetch("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(settings) }); const payload = await response.json().catch(() => null) as OperatingSettings & { error?: string }; if (!response.ok || !payload) throw new Error(payload?.error || "保存系统设置失败"); setSettings(payload); setNotice("系统设置已保存，后续库存分析会使用新的规则。"); } catch (reason) { setError(reason instanceof Error ? reason.message : "保存系统设置失败"); } finally { setSaving(false); } };
  if (loading && !settings) return <section className="panel data-state" role="status"><span className="state-spinner" /><strong>正在读取系统设置</strong><p>正在加载库存分析与预警规则…</p></section>;
  if (!settings) return <section className="panel data-state data-state-error" role="alert"><span className="state-symbol">!</span><strong>系统设置加载失败</strong><p>{error || "暂时无法读取系统设置"}</p><button className="secondary-button" onClick={() => void load()}>重新加载</button></section>;
  return <><div className="subnav"><button className={activeTab === "parameters" ? "active" : ""} onClick={() => setActiveTab("parameters")}>系统参数</button><button className={activeTab === "master" ? "active" : ""} onClick={() => setActiveTab("master")}>主数据与映射</button><button className={activeTab === "permissions" ? "active" : ""} onClick={() => setActiveTab("permissions")}>权限管理</button></div>{(error || notice) && <section className={`inventory-feedback ${error ? "inventory-feedback-error" : "inventory-feedback-success"}`} role={error ? "alert" : "status"}><span>{error ? "!" : "✓"}</span><div><strong>{error ? "处理失败" : "保存成功"}</strong><p>{error || notice}</p></div></section>}
    {activeTab === "parameters" && <section className="settings-grid"><article className="panel settings-menu"><h2>设置中心</h2><p>管理员可保存库存健康、库龄和预警规则。</p>{[["库存参数", "周转、库龄与补货规则", "库"], ["主数据与映射", "TOP SKU、价格带、细分类目和 AI 工作流", "主"], ["权限管理", "仅管理员可保存设置", "权"]].map((item, index) => <button className={index === 0 ? "active" : ""} key={item[0]} onClick={() => index === 1 ? setActiveTab("master") : index === 2 ? setActiveTab("permissions") : undefined}><span>{item[2]}</span><div><strong>{item[0]}</strong><small>{item[1]}</small></div><em>›</em></button>)}</article><article className="panel settings-form"><SectionHeader title="库存分析参数" note="保存后适用于后续库存健康、库龄分析与备货建议" /><div className="form-section"><h3>周转与预警</h3><div className="form-grid"><label><span>目标库存天数</span><div><input type="number" min={1} max={365} value={settings.targetDays} onChange={(event) => updateNumber("targetDays", Number(event.target.value))} /><em>天</em></div><small>用于计算建议补货数量</small></label><label><span>低库存预警线</span><div><input type="number" min={1} max={120} value={settings.criticalDays} onChange={(event) => updateNumber("criticalDays", Number(event.target.value))} /><em>天</em></div><small>低于该天数触发库存预警</small></label><label><span>低周转判定</span><div><input type="number" min={1} max={730} value={settings.slowDays} onChange={(event) => updateNumber("slowDays", Number(event.target.value))} /><em>天</em></div><small>用于识别低动销库存</small></label><label><span>呆滞库存判定</span><div><input type="number" min={1} max={1460} value={settings.stagnantDays} onChange={(event) => updateNumber("stagnantDays", Number(event.target.value))} /><em>天</em></div><small>用于生成滞销清理清单</small></label></div></div><div className="form-section"><h3>自动化规则</h3>{[["自动生成补货建议", "自动计算建议补货量，仍需人工确认草稿", "autoReplenishment"], ["库存异常提醒", "在 BI 看板集中显示库存健康风险", "inventoryAlert"], ["允许负库存", "仅影响导入校验，不会修改已有库存", "allowNegativeInventory"]].map(([label, note, key]) => <div className="toggle-row" key={key}><div><strong>{label}</strong><small>{note}</small></div><button type="button" onClick={() => toggle(key as "autoReplenishment" | "inventoryAlert" | "allowNegativeInventory")} className={`toggle ${settings[key as "autoReplenishment" | "inventoryAlert" | "allowNegativeInventory"] ? "on" : ""}`}><i /></button></div>)}</div><footer className="form-actions"><span>上次保存：{settings.updatedAt ? `${formatDateTime(settings.updatedAt)}${settings.updatedBy ? ` · ${settings.updatedBy}` : ""}` : "尚未保存"}</span><button className="primary-button" disabled={saving} onClick={() => void save()}>{saving ? "保存中…" : "保存设置"}</button></footer></article></section>}
    {activeTab === "master" && <section className="settings-market-master"><MarketMasterAdminPanel currentUser={currentUser} /><MarketDataImportPanel currentUser={currentUser} data={marketData} onImported={() => setMarketReloadKey((key) => key + 1)} /><MarketWorkflowPanel data={marketData} /><MarketAnnotationView currentUser={currentUser} /></section>}
    {activeTab === "permissions" && <section className="panel settings-form"><SectionHeader title="权限管理" note="当前版本沿用应用用户表和角色授权；市场导入、提交标注和模型配置仍仅管理员可执行。" /><p className="soft-text">如需新增行级数据范围，请在系统用户权限中配置，AI 工具不会信任模型提供的身份或角色声明。</p></section>}
  </>;
}

function newAiModelDraft(): AiModelDraft {
  return {
    name: "",
    protocol: "openai_compatible",
    modelType: "text",
    modelName: "",
    baseUrl: "",
    apiKey: "",
    status: "enabled",
    isDefaultTextModel: false,
    timeoutMs: 60000,
    maxTokens: 4096,
    reasoningMode: "auto",
    temperatureMilli: 200,
    maxToolRounds: 6,
    maxTotalToolCalls: 12,
  };
}

function aiModelTypeLabel(type: AiModelType): string {
  return type === "vision" ? "视觉识别（读取图片）" : "文本对话";
}

function newAiChannelDraft(): AiChannelDraft {
  return { name: "", kind: "dingtalk_group_bot", status: "enabled", sendEnabled: true, callbackEnabled: false, webhookUrl: "", callbackToken: "", aesKey: "", receiverId: "" };
}

function channelKindLabel(kind: AiChannelKind): string {
  return ({ dingtalk_group_bot: "钉钉群机器人", wechat_work_group_bot: "企业微信群机器人", dingtalk_app: "钉钉应用（暂未启用）", wechat_work_app: "企业微信应用回调" })[kind];
}

function AiMessageArtifacts({ artifacts }: { artifacts: AiTableArtifact[] }) {
  if (artifacts.length === 0) return null;
  return <div className="ai-artifact-list" aria-label="本条回复的数据产物">
    {artifacts.map((artifact) => <section key={artifact.id} className="ai-artifact-card">
      <header><div><strong>{artifact.title}</strong><small>来源工具：{artifact.sourceTool} · 展示 {artifact.rows.length}/{artifact.rowCount} 行{artifact.truncated ? " · 已截断" : ""}</small></div><a href={artifact.downloadUrl} download={artifact.fileName}>下载 CSV</a></header>
      <div className="ai-artifact-table-wrap">
        <table><thead><tr>{artifact.columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr></thead><tbody>{artifact.rows.map((row, rowIndex) => <tr key={`${artifact.id}-${rowIndex}`}>{artifact.columns.map((column, columnIndex) => <td key={`${column}-${columnIndex}`}>{formatAiArtifactCell(row[columnIndex])}</td>)}</tr>)}</tbody></table>
      </div>
    </section>)}
  </div>;
}

function formatAiArtifactCell(value: AiArtifactCell | undefined) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "是" : "否";
  return String(value);
}

function AiAssistantView({ currentUser }: { currentUser: CurrentUser | null }) {
  const isAdmin = currentUser?.role === "admin";
  const canChat = Boolean(currentUser && currentUser.role !== "viewer");
  const [modelItems, setModelItems] = useState<AiModelRecord[]>([]);
  const [availableChatModels, setAvailableChatModels] = useState<AiAvailableChatModel[]>([]);
  const [channelItems, setChannelItems] = useState<AiChannelRecord[]>([]);
  const [conversationItems, setConversationItems] = useState<AiConversationRecord[]>([]);
  const [activeConversationId, setActiveConversationId] = useState("");
  const [messages, setMessages] = useState<AiConversationMessage[]>([]);
  const [messageDraft, setMessageDraft] = useState("");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [modelDraft, setModelDraft] = useState<AiModelDraft>(() => newAiModelDraft());
  const [channelDraft, setChannelDraft] = useState<AiChannelDraft>(() => newAiChannelDraft());
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [busyConversationId, setBusyConversationId] = useState("");
  const [switchingModel, setSwitchingModel] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  const [savingChannel, setSavingChannel] = useState(false);
  const [busyConfigId, setBusyConfigId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const sendControllerRef = useRef<AbortController | null>(null);

  const loadConfiguration = useCallback(async () => {
    if (!isAdmin) {
      setModelItems([]);
      setChannelItems([]);
      return;
    }
    const [modelsResponse, channelsResponse] = await Promise.all([
      fetch("/api/ai/models", { cache: "no-store" }),
      fetch("/api/ai/channels", { cache: "no-store" }),
    ]);
    const modelsPayload = await modelsResponse.json().catch(() => null) as { items?: AiModelRecord[]; error?: string } | null;
    const channelsPayload = await channelsResponse.json().catch(() => null) as { items?: AiChannelRecord[]; error?: string } | null;
    if (!modelsResponse.ok) throw new Error(modelsPayload?.error || "读取模型配置失败");
    setModelItems(modelsPayload?.items ?? []);
    if (!channelsResponse.ok) throw new Error(channelsPayload?.error || "读取渠道配置失败");
    setChannelItems(channelsPayload?.items ?? []);
  }, [isAdmin]);

  const loadConversations = useCallback(async () => {
    const response = await fetch("/api/ai/conversations", { cache: "no-store" });
    const payload = await response.json().catch(() => null) as { items?: AiConversationRecord[]; models?: AiAvailableChatModel[]; error?: string } | null;
    if (!response.ok) throw new Error(payload?.error || "读取对话记录失败");
    const items = payload?.items ?? [];
    const models = payload?.models ?? [];
    setConversationItems(items);
    setAvailableChatModels(models);
    setSelectedModelId((current) => models.some((model) => model.id === current) ? current : models.find((model) => model.isDefault)?.id || models[0]?.id || "");
    setActiveConversationId((current) => current || items[0]?.id || "");
  }, []);

  const loadMessages = useCallback(async (conversationId: string, signal?: AbortSignal) => {
    const response = await fetch(`/api/ai/chat?conversationId=${encodeURIComponent(conversationId)}`, { cache: "no-store", signal });
    const payload = await response.json().catch(() => null) as { items?: AiConversationMessage[]; error?: string } | null;
    if (!response.ok) throw new Error(payload?.error || "读取对话失败");
    setMessages(payload?.items ?? []);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      await Promise.all([loadConfiguration(), loadConversations()]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "AI 助理加载失败");
    } finally {
      setLoading(false);
    }
  }, [loadConfiguration, loadConversations]);

  useEffect(() => { const timer = window.setTimeout(() => void refresh(), 0); return () => window.clearTimeout(timer); }, [refresh]);

  useEffect(() => {
    if (!activeConversationId) {
      const timer = window.setTimeout(() => setMessages([]), 0);
      return () => window.clearTimeout(timer);
    }
    const controller = new AbortController();
    const activeConversation = conversationItems.find((item) => item.id === activeConversationId);
    if (activeConversation?.modelId && availableChatModels.some((model) => model.id === activeConversation.modelId)) {
      setSelectedModelId(activeConversation.modelId);
    }
    void loadMessages(activeConversationId, controller.signal)
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "读取对话失败"); });
    return () => controller.abort();
  }, [activeConversationId, availableChatModels, conversationItems, loadMessages]);

  useEffect(() => () => sendControllerRef.current?.abort(), []);

  const sendMessage = async () => {
    const text = messageDraft.trim();
    if (!text || sending || !canChat) return;
    const controller = new AbortController();
    sendControllerRef.current = controller;
    setSending(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId: activeConversationId || undefined, modelId: selectedModelId || undefined, message: text, title: "小特对话" }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null) as { conversationId?: string; reply?: string; modelId?: string | null; error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || "发送失败");
      setMessageDraft("");
      const conversationId = payload?.conversationId || activeConversationId;
      if (payload?.modelId) setSelectedModelId(payload.modelId);
      if (conversationId) {
        setActiveConversationId(conversationId);
        await loadMessages(conversationId);
      }
      await loadConversations();
    } catch (reason) {
      if (controller.signal.aborted) {
        setNotice("已停止本次生成；已写入的用户消息仍保留在对话中。");
        if (activeConversationId) await loadMessages(activeConversationId).catch(() => undefined);
        await loadConversations().catch(() => undefined);
      } else setError(reason instanceof Error ? reason.message : "发送失败");
    } finally {
      if (sendControllerRef.current === controller) sendControllerRef.current = null;
      setSending(false);
    }
  };

  const startNewConversation = () => {
    if (sending) return;
    setActiveConversationId("");
    setMessages([]);
    setMessageDraft("");
    setError("");
    setNotice("");
    setSelectedModelId(availableChatModels.find((model) => model.isDefault)?.id || availableChatModels[0]?.id || "");
  };

  const changeConversationModel = async (modelId: string) => {
    if (!activeConversationId) {
      setSelectedModelId(modelId);
      return;
    }
    setSwitchingModel(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/ai/conversations", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId: activeConversationId, modelId }),
      });
      const payload = await response.json().catch(() => null) as { item?: AiConversationRecord; error?: string } | null;
      if (!response.ok || !payload?.item) throw new Error(payload?.error || "切换对话模型失败");
      setSelectedModelId(modelId);
      setConversationItems((items) => items.map((item) => item.id === payload.item?.id ? payload.item : item));
      setNotice(`本对话后续消息将使用“${availableChatModels.find((model) => model.id === modelId)?.name || "所选模型"}”。`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "切换对话模型失败");
    } finally {
      setSwitchingModel(false);
    }
  };

  const deleteConversation = async (item: AiConversationRecord) => {
    if (sending || !canChat || !window.confirm(`确定删除对话“${item.title}”吗？对话消息和生成的数据产物将一并删除，此操作无法撤销。`)) return;
    setBusyConversationId(item.id); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/ai/conversations?id=${encodeURIComponent(item.id)}`, { method: "DELETE" });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || "删除对话失败");
      const remaining = conversationItems.filter((conversation) => conversation.id !== item.id);
      setConversationItems(remaining);
      if (activeConversationId === item.id) {
        setActiveConversationId(remaining[0]?.id || "");
        setMessages([]);
      }
      setNotice(`对话“${item.title}”已删除。`);
      await loadConversations();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "删除对话失败");
    } finally {
      setBusyConversationId("");
    }
  };

  const saveModel = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSavingModel(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/ai/models", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(modelDraft) });
      const payload = await response.json().catch(() => null) as { item?: AiModelRecord; error?: string } | null;
      if (!response.ok || !payload?.item) throw new Error(payload?.error || "保存模型失败");
      setNotice(`模型“${payload.item.name}”已保存。`);
      setModelDraft(newAiModelDraft());
      await loadConfiguration();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "保存模型失败"); }
    finally { setSavingModel(false); }
  };

  const saveChannel = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSavingChannel(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/ai/channels", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(channelDraft) });
      const payload = await response.json().catch(() => null) as { item?: AiChannelRecord; error?: string } | null;
      if (!response.ok || !payload?.item) throw new Error(payload?.error || "保存渠道失败");
      setNotice(`渠道“${payload.item.name}”已保存。`);
      setChannelDraft(newAiChannelDraft());
      await loadConfiguration();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "保存渠道失败"); }
    finally { setSavingChannel(false); }
  };

  const testConfiguration = async (type: "model" | "channel", id: string) => {
    setBusyConfigId(`${type}:${id}`); setError(""); setNotice("");
    try {
      const response = await fetch(type === "model" ? "/api/ai/models" : "/api/ai/channels", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "test", id }) });
      const payload = await response.json().catch(() => null) as { message?: string; error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || "连通性测试失败");
      setNotice(payload?.message || "连通性测试成功。");
      await loadConfiguration();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "连通性测试失败"); }
    finally { setBusyConfigId(""); }
  };

  const deleteConfiguration = async (type: "model" | "channel", id: string, name: string) => {
    if (!window.confirm(`确定删除“${name}”吗？已保存的密钥和回调配置将一并删除。`)) return;
    setBusyConfigId(`${type}:${id}`); setError(""); setNotice("");
    try {
      const response = await fetch(`${type === "model" ? "/api/ai/models" : "/api/ai/channels"}?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || "删除失败");
      setNotice(`“${name}”已删除。`);
      await loadConfiguration();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "删除失败"); }
    finally { setBusyConfigId(""); }
  };

  const editModel = (item: AiModelRecord) => setModelDraft({
    id: item.id,
    name: item.name,
    protocol: item.protocol,
    modelType: item.modelType,
    modelName: item.modelName,
    baseUrl: item.baseUrl,
    apiKey: "",
    status: item.status,
    isDefaultTextModel: item.isDefaultTextModel,
    timeoutMs: item.timeoutMs,
    maxTokens: item.maxTokens,
    reasoningMode: item.reasoningMode,
    temperatureMilli: item.temperatureMilli,
    maxToolRounds: item.maxToolRounds,
    maxTotalToolCalls: item.maxTotalToolCalls,
  });
  const editChannel = (item: AiChannelRecord) => setChannelDraft({ id: item.id, name: item.name, kind: item.kind, status: item.status, sendEnabled: item.sendEnabled, callbackEnabled: item.callbackEnabled, webhookUrl: "", callbackToken: "", aesKey: "", receiverId: item.receiverId });

  const isEditingModel = Boolean(modelDraft.id);
  const isEditingChannel = Boolean(channelDraft.id);
  const channelSupportsOutbound = channelDraft.kind === "dingtalk_group_bot" || channelDraft.kind === "wechat_work_group_bot";
  const channelNeedsWebhook = channelDraft.kind === "dingtalk_group_bot" || channelDraft.kind === "wechat_work_group_bot" || channelDraft.sendEnabled;
  if (loading && !isAdmin && conversationItems.length === 0) return <section className="panel data-state" role="status"><span className="state-spinner" /><strong>正在读取 AI 助理</strong><p>正在加载可用对话…</p></section>;

  return <section className="ai-assistant-grid">
    <article className="panel ai-chat-card">
      <div className="section-header"><div><h2>AI 助理</h2><p>网页入口统一经过权限、问答 Workflow、模型网关和中央工具注册表；外部聊天回调仍只验签和去重。</p></div><button type="button" className="secondary-button" onClick={() => void refresh()} disabled={loading}>{loading ? "刷新中…" : "刷新"}</button></div>
      {(error || notice) && <div className={`inventory-feedback ${error ? "inventory-feedback-error" : "inventory-feedback-success"}`} role={error ? "alert" : "status"}><span>{error ? "!" : "✓"}</span><div><strong>{error ? "操作失败" : "操作成功"}</strong><p>{error || notice}</p></div></div>}
      <div className="ai-chat-layout">
        <aside className="ai-sidebar"><div className="ai-sidebar-heading"><h3>对话记录</h3><small>{conversationItems.length} 个</small></div><button type="button" className="ai-new-conversation" onClick={startNewConversation} disabled={sending}>＋ 新对话</button><div className="ai-conversation-list">{conversationItems.length === 0 && <p className="soft-text">发送第一条消息后会自动建立对话。</p>}{conversationItems.map((item) => <div key={item.id} className={`ai-conversation-row ${item.id === activeConversationId ? "active" : ""}`}><button type="button" className="ai-conversation-open" onClick={() => setActiveConversationId(item.id)}><strong>{item.title}</strong><small>{formatDateTime(item.updatedAt)}</small></button>{canChat && <button type="button" className="ai-conversation-delete" aria-label={`删除对话 ${item.title}`} title="删除对话" disabled={sending || busyConversationId === item.id} onClick={() => void deleteConversation(item)}>{busyConversationId === item.id ? "…" : "×"}</button>}</div>)}</div></aside>
        <div className="ai-chat-panel"><div className="ai-chat-toolbar"><label><span>本对话模型</span><SearchableSelect value={selectedModelId} onChange={(value) => void changeConversationModel(value)} ariaLabel="本对话模型" searchPlaceholder="搜索对话模型" disabled={sending || switchingModel || availableChatModels.length === 0} options={availableChatModels.map((model) => ({ value: model.id, label: `${model.name} · ${model.modelType === "vision" ? "视觉" : "文本"}${model.isDefault ? "（默认）" : ""}` }))} /></label><small>{switchingModel ? "正在切换模型…" : "文本和视觉模型均可用于对话；切换后从下一条消息起生效。输入“帮助”或“新话题”可走免模型短路。"}</small></div><div className="ai-message-list">{messages.length === 0 && <div className="ai-empty-chat"><strong>开始一段新对话</strong><p>可询问已导入运营数据；确定性帮助与上下文重置不会调用模型。</p></div>}{messages.map((item) => <div key={item.id} className={`ai-message ai-message-${item.role} ${item.messageKind === "context_reset" ? "ai-message-reset" : ""} ${item.artifacts?.length ? "ai-message-has-artifacts" : ""}`}><strong>{item.messageKind === "context_reset" ? "上下文断点" : item.role === "user" ? "你" : "小特"}</strong><p>{item.content}</p><AiMessageArtifacts artifacts={item.artifacts ?? []} /><small>{formatDateTime(item.createdAt)}</small></div>)}</div><div className="ai-chat-compose"><textarea value={messageDraft} maxLength={12000} onChange={(event) => setMessageDraft(event.target.value)} placeholder={canChat ? "输入问题；也可输入“帮助”或“新话题”" : "登录并获得操作权限后可发送消息"} disabled={!canChat || sending} />{sending ? <button type="button" className="secondary-button ai-stop-button" onClick={() => sendControllerRef.current?.abort()}>停止生成</button> : <button type="button" className="primary-button" disabled={!canChat || !messageDraft.trim()} onClick={() => void sendMessage()}>发送</button>}</div></div>
      </div>
    </article>
    {isAdmin ? <>
      <article className="panel ai-admin-card">
        <div className="section-header"><div><h3>{isEditingModel ? "编辑模型配置" : "新增模型配置"}</h3><p>支持 OpenAI 兼容接口和 Anthropic Messages 接口。密钥加密保存，列表只显示末四位。</p></div>{isEditingModel && <button type="button" className="text-button" onClick={() => setModelDraft(newAiModelDraft())}>取消编辑</button>}</div>
        <form className="ai-config-form" onSubmit={(event) => void saveModel(event)}>
          <label><span>配置名称</span><input value={modelDraft.name} required maxLength={100} onChange={(event) => setModelDraft((current) => ({ ...current, name: event.target.value }))} placeholder="例如：生产文本模型" /></label>
          <label><span>协议</span><SearchableSelect value={modelDraft.protocol} onChange={(value) => setModelDraft((current) => ({ ...current, protocol: value as AiModelProtocol, reasoningMode: value === "openai_compatible" ? current.reasoningMode : "auto" }))} ariaLabel="模型协议" searchPlaceholder="搜索模型协议" options={[{ value: "openai_compatible", label: "OpenAI 兼容" }, { value: "anthropic", label: "Anthropic" }]} /></label>
          <label><span>能力类型</span><SearchableSelect value={modelDraft.modelType} onChange={(value) => setModelDraft((current) => ({ ...current, modelType: value as AiModelType, isDefaultTextModel: value === "text" ? current.isDefaultTextModel : false }))} ariaLabel="模型能力类型" searchPlaceholder="搜索模型能力" options={[{ value: "text", label: "文本对话（不读取图片）" }, { value: "vision", label: "视觉识别（读取图片）" }]} /><small>市场主图价格识别必须选择“视觉识别”；连接测试会实际发送一张测试图。</small></label>
          <label><span>模型标识</span><input value={modelDraft.modelName} required maxLength={100} onChange={(event) => setModelDraft((current) => ({ ...current, modelName: event.target.value }))} placeholder="例如：gpt-4.1-mini" /></label>
          <label className="ai-form-wide"><span>API 地址</span><input value={modelDraft.baseUrl} required type="url" onChange={(event) => setModelDraft((current) => ({ ...current, baseUrl: event.target.value }))} placeholder="https://api.example.com/v1" /><small>生产环境仅接受 HTTPS；本地调试需显式启用服务器环境变量。</small></label>
          <label><span>API Key</span><input value={modelDraft.apiKey} type="password" autoComplete="new-password" onChange={(event) => setModelDraft((current) => ({ ...current, apiKey: event.target.value }))} placeholder={isEditingModel ? "留空保留现有密钥" : "输入模型密钥"} /><small>{isEditingModel ? "当前已配置：留空不会覆盖。" : "保存后仅显示掩码。"}</small></label>
          <label><span>状态</span><SearchableSelect value={modelDraft.status} onChange={(value) => setModelDraft((current) => ({ ...current, status: value as AiModelStatus }))} ariaLabel="模型状态" searchPlaceholder="搜索模型状态" options={[{ value: "enabled", label: "启用" }, { value: "disabled", label: "停用" }]} /></label>
          <label><span>文本请求超时（毫秒）</span><input type="number" min={3000} max={120000} step={1000} disabled={modelDraft.modelType !== "text"} value={modelDraft.timeoutMs} onChange={(event) => setModelDraft((current) => ({ ...current, timeoutMs: Number(event.target.value) }))} /><small>3,000—120,000，覆盖响应头和完整响应体。</small></label>
          <label><span>文本最大输出 Token</span><input type="number" min={128} max={8192} step={128} disabled={modelDraft.modelType !== "text"} value={modelDraft.maxTokens} onChange={(event) => setModelDraft((current) => ({ ...current, maxTokens: Number(event.target.value) }))} /></label>
          <label><span>文本推理模式</span><SearchableSelect value={modelDraft.reasoningMode} onChange={(value) => setModelDraft((current) => ({ ...current, reasoningMode: value as AiModelReasoningMode }))} ariaLabel="文本推理模式" searchPlaceholder="搜索推理模式" disabled={modelDraft.modelType !== "text" || modelDraft.protocol !== "openai_compatible"} options={[{ value: "auto", label: "跟随供应商默认" }, { value: "disabled", label: "关闭推理（运营问答推荐）" }]} /><small>GLM 等默认深度思考模型建议关闭，避免推理占满输出 Token；其他模型保持“跟随供应商默认”。</small></label>
          <label><span>文本温度（千分数）</span><input type="number" min={0} max={1000} step={50} disabled={modelDraft.modelType !== "text"} value={modelDraft.temperatureMilli} onChange={(event) => setModelDraft((current) => ({ ...current, temperatureMilli: Number(event.target.value) }))} /><small>200 = 0.2；服务端按 0—1,000 校验。</small></label>
          <label><span>最大工具轮数</span><input type="number" min={1} max={AI_MODEL_TOOL_BUDGET_LIMITS.maximumRounds} disabled={modelDraft.modelType !== "text"} value={modelDraft.maxToolRounds} onChange={(event) => setModelDraft((current) => ({ ...current, maxToolRounds: Number(event.target.value) }))} /></label>
          <label><span>工具调用总数</span><input type="number" min={1} max={AI_MODEL_TOOL_BUDGET_LIMITS.maximumTotalCalls} disabled={modelDraft.modelType !== "text"} value={modelDraft.maxTotalToolCalls} onChange={(event) => setModelDraft((current) => ({ ...current, maxTotalToolCalls: Number(event.target.value) }))} /><small>单轮不再另限 4 次；仍以此总数、执行时长和取消机制防止死循环，不能设置为真正无限。</small></label>
          <label className="ai-check-field"><input type="checkbox" checked={modelDraft.isDefaultTextModel} disabled={modelDraft.modelType !== "text" || modelDraft.status !== "enabled"} onChange={(event) => setModelDraft((current) => ({ ...current, isDefaultTextModel: event.target.checked }))} /><span>设为默认文本模型</span></label>
          <div className="ai-form-actions"><button type="submit" className="primary-button" disabled={savingModel}>{savingModel ? "保存中…" : isEditingModel ? "保存修改" : "新增模型"}</button></div>
        </form>
        <div className="ai-config-list">{modelItems.length === 0 && <p className="soft-text">暂无模型配置。新增并测试成功后，小特才能对话。</p>}{modelItems.map((item) => <div key={item.id} className="ai-config-card"><div><strong>{item.name}</strong><small>{aiModelTypeLabel(item.modelType)} · {item.protocol === "anthropic" ? "Anthropic" : "OpenAI 兼容"} · {item.modelName} · 密钥 {item.apiKeySuffix || "未配置"}</small>{item.modelType === "text" && <small>超时 {item.timeoutMs}ms · 输出 {item.maxTokens} · 推理 {item.reasoningMode === "disabled" ? "关闭" : "供应商默认"} · 温度 {(item.temperatureMilli / 1000).toFixed(2)} · 工具 {item.maxToolRounds} 轮/{item.maxTotalToolCalls} 次</small>}<small>{item.isDefaultTextModel ? "默认文本模型 · " : ""}{item.lastTestedAt ? `最近测试：${formatDateTime(item.lastTestedAt)} · ${item.lastTestResult || "完成"}` : "尚未测试"}</small></div><span className={`status ${item.status === "enabled" ? "status-success" : "status-warning"}`}>{item.status === "enabled" ? "启用" : "停用"}</span><div className="ai-card-actions"><button type="button" className="row-action" onClick={() => editModel(item)}>编辑</button><button type="button" className="row-action" disabled={busyConfigId === `model:${item.id}`} onClick={() => void testConfiguration("model", item.id)}>{busyConfigId === `model:${item.id}` ? "测试中…" : item.modelType === "vision" ? "测试图片识别" : "测试连接"}</button><button type="button" className="row-action danger" disabled={busyConfigId === `model:${item.id}`} onClick={() => void deleteConfiguration("model", item.id, item.name)}>删除</button></div></div>)}</div>
      </article>
      <article className="panel ai-admin-card">
        <div className="section-header"><div><h3>{isEditingChannel ? "编辑聊天渠道" : "新增聊天渠道"}</h3><p>钉钉和企业微信群机器人可主动发送测试消息；企业微信应用回调会验签、解密并只记录去重凭据，不会自动执行消息内容。</p></div>{isEditingChannel && <button type="button" className="text-button" onClick={() => setChannelDraft(newAiChannelDraft())}>取消编辑</button>}</div>
        <form className="ai-config-form" onSubmit={(event) => void saveChannel(event)}>
          <label><span>渠道名称</span><input value={channelDraft.name} required maxLength={100} onChange={(event) => setChannelDraft((current) => ({ ...current, name: event.target.value }))} placeholder="例如：运营群通知" /></label>
          <label><span>渠道类型</span><SearchableSelect value={channelDraft.kind} onChange={(value) => { const kind = value as AiChannelKind; setChannelDraft((current) => ({ ...current, kind, sendEnabled: kind === "dingtalk_group_bot" || kind === "wechat_work_group_bot" ? current.sendEnabled : false, callbackEnabled: kind === "wechat_work_app" ? current.callbackEnabled : false })); }} ariaLabel="渠道类型" searchPlaceholder="搜索渠道类型" options={[{ value: "dingtalk_group_bot", label: "钉钉群机器人" }, { value: "wechat_work_group_bot", label: "企业微信群机器人" }, { value: "wechat_work_app", label: "企业微信应用回调" }]} /></label>
          <label><span>状态</span><SearchableSelect value={channelDraft.status} onChange={(value) => setChannelDraft((current) => ({ ...current, status: value as "enabled" | "disabled" }))} ariaLabel="渠道状态" searchPlaceholder="搜索渠道状态" options={[{ value: "enabled", label: "启用" }, { value: "disabled", label: "停用" }]} /></label>
          <label className="ai-check-field"><input type="checkbox" checked={channelDraft.sendEnabled} disabled={!channelSupportsOutbound} onChange={(event) => setChannelDraft((current) => ({ ...current, sendEnabled: event.target.checked }))} /><span>{channelSupportsOutbound ? "允许主动发送" : "应用回调不支持主动发送"}</span></label>
          <label className="ai-check-field"><input type="checkbox" checked={channelDraft.callbackEnabled} disabled={channelDraft.kind !== "wechat_work_app"} onChange={(event) => setChannelDraft((current) => ({ ...current, callbackEnabled: event.target.checked }))} /><span>{channelDraft.kind === "wechat_work_app" ? "启用企业微信签名回调" : "企业微信应用可启用回调"}</span></label>
          <label className="ai-form-wide"><span>Webhook 地址{channelNeedsWebhook ? "（必填）" : "（可选）"}</span><input value={channelDraft.webhookUrl} required={channelNeedsWebhook && !isEditingChannel} type="url" onChange={(event) => setChannelDraft((current) => ({ ...current, webhookUrl: event.target.value }))} placeholder={isEditingChannel ? "留空保留现有 Webhook" : "https://..."} /><small>{isEditingChannel ? "当前地址已掩码保存；留空不会覆盖。" : "仅接受 HTTPS，群机器人或启用主动发送时必须配置。"}</small></label>
          <label><span>签名密钥 / 回调 Token</span><input value={channelDraft.callbackToken} type="password" autoComplete="new-password" onChange={(event) => setChannelDraft((current) => ({ ...current, callbackToken: event.target.value }))} placeholder={isEditingChannel ? "留空保留现有密钥" : "按平台填写"} /></label>
          <label><span>企业微信 EncodingAESKey</span><input value={channelDraft.aesKey} type="password" autoComplete="new-password" onChange={(event) => setChannelDraft((current) => ({ ...current, aesKey: event.target.value }))} placeholder={isEditingChannel ? "留空保留现有密钥" : "企业微信回调时填写"} /></label>
          <label><span>接收方 ID</span><input value={channelDraft.receiverId} maxLength={160} onChange={(event) => setChannelDraft((current) => ({ ...current, receiverId: event.target.value }))} placeholder="企业微信 CorpID / SuiteID" /></label>
          {channelDraft.callbackEnabled && channelDraft.id && <div className="ai-callback-path"><strong>回调地址</strong><code>/api/ai/webhooks/{channelDraft.id}</code><small>将完整站点域名与该路径填入聊天平台；回调需使用同一渠道的 Token/AESKey。</small></div>}
          <div className="ai-form-actions"><button type="submit" className="primary-button" disabled={savingChannel}>{savingChannel ? "保存中…" : isEditingChannel ? "保存修改" : "新增渠道"}</button></div>
        </form>
        <div className="ai-config-list">{channelItems.length === 0 && <p className="soft-text">暂无聊天渠道配置。</p>}{channelItems.map((item) => <div key={item.id} className="ai-config-card"><div><strong>{item.name}</strong><small>{channelKindLabel(item.kind)} · {item.webhookUrlMasked} · {item.sendEnabled ? "允许发送" : "仅回调"}</small><small>{item.callbackEnabled ? `回调：/api/ai/webhooks/${item.id}` : "未启用回调"}{item.lastTestedAt ? ` · 最近测试：${formatDateTime(item.lastTestedAt)} · ${item.lastTestResult || "完成"}` : ""}</small></div><span className={`status ${item.status === "enabled" ? "status-success" : "status-warning"}`}>{item.status === "enabled" ? "启用" : "停用"}</span><div className="ai-card-actions"><button type="button" className="row-action" onClick={() => editChannel(item)}>编辑</button><button type="button" className="row-action" disabled={!item.sendEnabled || busyConfigId === `channel:${item.id}`} onClick={() => void testConfiguration("channel", item.id)}>{busyConfigId === `channel:${item.id}` ? "测试中…" : "测试发送"}</button><button type="button" className="row-action danger" disabled={busyConfigId === `channel:${item.id}`} onClick={() => void deleteConfiguration("channel", item.id, item.name)}>删除</button></div></div>)}</div>
      </article>
    </> : <article className="panel ai-permission-card"><h3>模型与渠道配置</h3><p>仅管理员可查看和维护模型密钥、Webhook 及聊天平台回调。你的对话不会显示这些敏感配置。</p></article>}
  </section>;
}

const viewMap: Record<ModuleKey, (props: { range: SalesRangeLabel; customStartDate: string; customEndDate: string; importSource?: ImportSourceKey; onNavigate: (key: ModuleKey, importSource?: ImportSourceKey) => void; currentUser: CurrentUser | null }) => React.ReactNode> = {
  dashboard: DashboardView,
  shop: ShopView,
  market: MarketView,
  customer_service: CustomerServiceView,
  sales: SalesView,
  inventory: InventoryView,
  product: ProductView,
  workflow: WorkflowView,
  import: ImportView,
  settings: SettingsView,
  ai: AiAssistantView,
};

export default function Home() {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [active, setActive] = useState<ModuleKey>("dashboard");
  const [importSource, setImportSource] = useState<ImportSourceKey | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [range, setRange] = useState<SalesRangeLabel>("本月");
  const [customEndDate, setCustomEndDate] = useState(shanghaiIsoToday);
  const [customStartDate, setCustomStartDate] = useState(() => addIsoDays(shanghaiIsoToday(), -29));
  const [selectedMonth, setSelectedMonth] = useState(() => shanghaiIsoToday().slice(0, 7));
  const [statPeriodPickerOpen, setStatPeriodPickerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [globalSearchQuery, setGlobalSearchQuery] = useState("");
  const [globalSearchResult, setGlobalSearchResult] = useState<GlobalSearchResponse | null>(null);
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false);
  const [globalSearchError, setGlobalSearchError] = useState("");
  const debouncedGlobalSearchQuery = useDebouncedValue(globalSearchQuery, 220);
  const customMaxDate = shanghaiIsoToday();
  const customMinDate = `${Number(customMaxDate.slice(0, 4)) - 1}-01-01`;
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/auth/me", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const payload = await response.json().catch(() => ({})) as { user?: CurrentUser };
        if (payload.user) setCurrentUser(payload.user);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

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

  useEffect(() => {
    if (!searchOpen) return;
    const query = debouncedGlobalSearchQuery.trim();
    if (Array.from(query).length < 2) return;
    const controller = new AbortController();
    void (async () => {
      setGlobalSearchLoading(true);
      setGlobalSearchError("");
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json().catch(() => null) as GlobalSearchResponse | null;
        if (!response.ok) throw new Error(payload?.error || "搜索失败");
        if (!payload || !Array.isArray(payload.groups)) throw new Error("搜索结果格式不完整");
        setGlobalSearchResult(payload);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setGlobalSearchError(error instanceof Error ? error.message : "搜索失败");
        setGlobalSearchResult(null);
      } finally {
        if (!controller.signal.aborted) setGlobalSearchLoading(false);
      }
    })();
    return () => controller.abort();
  }, [debouncedGlobalSearchQuery, searchOpen]);

  const current = navItems.find((item) => item.key === active) ?? navItems[0];
  const View = viewMap[active];

  const selectModule = (key: ModuleKey, nextImportSource?: ImportSourceKey) => {
    if (key === "import") setImportSource(nextImportSource ?? null);
    setActive(key);
    setMobileMenu(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const closeGlobalSearch = () => {
    setSearchOpen(false);
    setGlobalSearchQuery("");
    setGlobalSearchResult(null);
    setGlobalSearchError("");
  };
  const updateGlobalSearchQuery = (value: string) => {
    setGlobalSearchQuery(value);
    if (Array.from(value.trim()).length >= 2) return;
    setGlobalSearchResult(null);
    setGlobalSearchError("");
    setGlobalSearchLoading(false);
  };
  const selectRange = (nextRange: SalesRangeLabel) => {
    setRange(nextRange);
    setStatPeriodPickerOpen(nextRange === "自定义");
    if (nextRange === "月度") {
      const period = selectedMonthPeriod(selectedMonth);
      setCustomStartDate(period.startDate);
      setCustomEndDate(period.endDate > customMaxDate ? customMaxDate : period.endDate);
    } else if (nextRange === "自定义") {
      const endDate = customEndDate > customMaxDate ? customMaxDate : customEndDate < customMinDate ? customMinDate : customEndDate;
      const startDate = customStartDate < customMinDate ? customMinDate : customStartDate > endDate ? endDate : customStartDate;
      setCustomStartDate(startDate);
      setCustomEndDate(endDate);
    }
  };
  const updateSelectedMonth = (month: string) => {
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    setSelectedMonth(month);
    const period = selectedMonthPeriod(month);
    setCustomStartDate(period.startDate);
    setCustomEndDate(period.endDate > customMaxDate ? customMaxDate : period.endDate);
  };

  const avatarText = currentUser
    ? [...currentUser.displayName.trim()][0]?.toUpperCase() ?? "管"
    : "访";

  return (
    <main className={`app-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
      <aside className={`sidebar ${mobileMenu ? "mobile-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark"><span>T</span></div>
          <div className="brand-copy"><strong>TERUISI</strong><small>电商运营中台</small></div>
          <button className="collapse-button" onClick={() => setCollapsed(!collapsed)} aria-label="收起侧边栏">‹</button>
        </div>
        <nav className="main-nav" aria-label="主导航">
          <p>经营管理</p>
          {navItems.slice(0, 8).map((item) => <button key={item.key} title={item.label} className={active === item.key ? "active" : ""} onClick={() => selectModule(item.key)}><span className="nav-icon">{item.short}</span><span className="nav-copy"><b>{item.label}</b><small>{item.description}</small></span>{item.badge && <em>{item.badge}</em>}</button>)}
          <p>系统管理</p>
          {navItems.slice(8).map((item) => <button key={item.key} title={item.label} className={active === item.key ? "active" : ""} onClick={() => selectModule(item.key)}><span className="nav-icon">{item.short}</span><span className="nav-copy"><b>{item.label}</b><small>{item.description}</small></span></button>)}
        </nav>
        <div className="sidebar-help"><span>?</span><div><strong>需要帮助？</strong><small>查看使用指南</small></div></div>
        <div className="sidebar-user"><span>{avatarText}</span><div><strong>{currentUser ? `${currentUser.displayName} · ${currentUser.roleLabel}` : "访客 · 只读查看者"}</strong><small>{currentUser ? currentUser.email : "可查看经营数据"}</small></div><button onClick={() => window.location.assign(currentUser ? "/signout-with-chatgpt?return_to=%2F" : "/signin-with-chatgpt?return_to=%2F")} aria-label={currentUser ? "退出登录" : "管理员登录"}>{currentUser ? "⋮" : "登录"}</button></div>
      </aside>
      {mobileMenu && <button className="mobile-overlay" onClick={() => setMobileMenu(false)} aria-label="关闭导航" />}

      <section className="workspace">
        <header className="topbar">
          <div className="title-area"><button className="mobile-menu-button" onClick={() => setMobileMenu(true)}>☰</button><div><span>运营中心 / {current.label}</span><h1>{current.description}</h1></div></div>
          <div className="topbar-actions">
            <button className="global-search" onClick={() => setSearchOpen(true)}><span>⌕</span><em>搜索系统全部数据</em><kbd>⌘ K</kbd></button>
            <button className="icon-button" aria-label="消息通知">♢<i>3</i></button>
            <div className={`date-selector ${range === "月度" || (range === "自定义" && statPeriodPickerOpen) ? "date-selector-expanded" : ""}`}>
              <span>统计周期</span>
              <SearchableSelect value={range} onChange={(value) => selectRange(value as SalesRangeLabel)} ariaLabel="统计周期" searchPlaceholder="搜索统计周期" options={["今日", "昨天", "近7天", "近15天", "本月", "月度", "自定义"].map((value) => ({ value, label: value }))} />
              {range === "月度" && <label className="month-selector"><span>选择月份</span><input type="month" value={selectedMonth} max={customMaxDate.slice(0, 7)} onChange={(event) => updateSelectedMonth(event.target.value)} aria-label="选择统计月份" /></label>}
              {range === "自定义" && statPeriodPickerOpen && <StatisticalPeriodPicker minDate={customMinDate} maxDate={customMaxDate} startDate={customStartDate} endDate={customEndDate} onApply={(startDate, endDate) => { setCustomStartDate(startDate); setCustomEndDate(endDate); setStatPeriodPickerOpen(false); }} />}
            </div>
          </div>
        </header>

        <div className="content">
          <div className="page-intro"><div><p>{active === "dashboard" ? "经营数据中心" : current.label}</p><h2>{current.description}</h2><span>{active === "sales" ? `${range} · 数据来自已导入销售明细` : active === "shop" ? "销售经营值来自已导入明细；访客按已导入 SPU 商品访客 × 0.9 估算，推广仍不做推算" : active === "market" ? "市场榜单与运营系统 SKU/SPU、销售明细及 AI 模型实时关联" : active === "customer_service" ? "会话记录与聊天日志按时间及顾客标识安全关联" : active === "inventory" ? "最新库存快照 · 近 30 日销售需求自动联动" : active === "product" ? "商品价格、成本、费用与库存随已导入数据实时汇总" : active === "import" ? "导入批次实时记录，销售分析自动更新" : "业务数据视图 · 以系统最近同步为准"}</span></div><div className="intro-actions"><button className="secondary-button">↗ 导出报表</button>{active !== "dashboard" && active !== "shop" && active !== "market" && active !== "customer_service" && active !== "settings" && active !== "sales" && active !== "inventory" && active !== "product" && active !== "import" && active !== "ai" && <button className="primary-button">＋ 新建</button>}</div></div>
          <View range={range} customStartDate={customStartDate} customEndDate={customEndDate} importSource={importSource ?? undefined} onNavigate={selectModule} currentUser={currentUser} />
          <footer className="page-footer"><span>TERUISI 电商运营中台 · 业务数据中心</span><span>销售分析以最近成功导入批次为准</span></footer>
        </div>
      </section>

      {searchOpen && <div className="modal-backdrop" onClick={closeGlobalSearch}>
        <div className="search-modal search-modal-global" role="dialog" aria-modal="true" aria-label="全系统业务搜索" onClick={(event) => event.stopPropagation()}>
          <div className="modal-search">⌕<input autoFocus value={globalSearchQuery} onChange={(event) => updateGlobalSearchQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") closeGlobalSearch(); }} placeholder="搜索商品、订单、库存、市场、客服、财务或批次…" aria-label="搜索系统全部已接入数据" /><button onClick={closeGlobalSearch}>ESC</button></div>
          {globalSearchQuery.trim() ? <div className="search-results" aria-live="polite">
            {Array.from(globalSearchQuery.trim()).length < 2 && <div className="search-state">请输入至少 2 个字符。</div>}
            {globalSearchLoading && <div className="search-state">正在按业务域搜索已接入数据…</div>}
            {globalSearchError && <div className="search-state search-state-error">{globalSearchError}</div>}
            {!globalSearchLoading && !globalSearchError && globalSearchResult && <>
              {globalSearchResult.groups.filter((group) => group.items.length > 0).map((group) => <section className="search-result-section" key={group.key}>
                <div><p>{group.label}</p><small>显示 {formatCount(group.items.length)} / {formatCount(group.total)} 条{group.hasMore ? " · 可继续分页" : ""}</small></div>
                {group.items.map((item) => <button className="search-result-item" key={`${group.key}-${item.id}`} onClick={() => { selectModule(item.module); closeGlobalSearch(); }}>
                  <span className={`search-result-icon search-result-icon-${group.key}`}>{group.icon}</span>
                  <div><strong title={item.title}>{item.title || "未命名记录"}</strong><small>{item.subtitle || item.detail || "暂无摘要"}</small>{item.subtitle && item.detail && <small className="search-result-detail">{item.detail}</small>}</div>
                  <em>{item.amountCents !== null && <b>{formatCurrencyFromCents(item.amountCents)}</b>}{item.updatedAt && <small>{item.updatedAt.slice(0, 10)}</small>}</em>
                </button>)}
              </section>)}
              {globalSearchResult.returned === 0 && <div className="search-state">未在当前已接入业务域中找到匹配数据。</div>}
              <div className="search-coverage-note">按字段白名单搜索，单域和总结果均有限额{globalSearchResult.unavailableDomains.length > 0 ? `；${globalSearchResult.unavailableDomains.length} 个未建表业务域已安全跳过` : ""}。</div>
            </>}
          </div> : <><p>全系统搜索</p><div className="search-guide"><strong>覆盖货品、订单、京东商品、库存、市场 SKU、客服、财务、目标、事务与导入批次</strong><small>按业务域分组返回；聊天正文可匹配，结果只展示必要摘要。</small></div><p>快速访问</p><div className="quick-links">{navItems.slice(0, 5).map((item) => <button key={item.key} onClick={() => { selectModule(item.key); closeGlobalSearch(); }}><span>{item.short}</span><div><strong>{item.label}</strong><small>{item.description}</small></div><em>↗</em></button>)}</div></>}
        </div>
      </div>}
    </main>
  );
}
