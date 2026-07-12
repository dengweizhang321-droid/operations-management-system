"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type ModuleKey =
  | "dashboard"
  | "shop"
  | "sales"
  | "inventory"
  | "product"
  | "workflow"
  | "import"
  | "settings";

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

type SalesRangeLabel = "今日" | "近7天" | "本月" | "本季度" | "自定义";
type SalesRange = "today" | "last7" | "month" | "quarter" | "custom";

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
  name: string;
  grossSalesCents: number;
  netSalesCents: number;
  grossProfitCents: number;
  refundAmountCents: number;
  grossMarginRate: number;
  shareRate: number;
  orderCount: number;
  lineCount: number;
  netQuantity: number;
  averageOrderValueCents: number;
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
  shops?: SalesChannel[];
  platforms?: SalesChannel[];
  latestBatch?: {
    id: string;
    fileName: string;
    completedAt?: string | null;
  } | null;
};

type ProductSummaryItem = {
  productCode: string;
  productName: string;
  specification: string;
  category: string;
  netQuantity: number;
  grossSalesCents: number;
  netSalesCents: number;
  costCents: number;
  feeCents: number;
  grossProfitCents: number;
  grossMarginRate: number | null;
  averageSalePriceCents: number | null;
  averageCostCents: number | null;
  observedFeeRate: number | null;
  availableQuantity: number | null;
  stockValueCents: number | null;
};

type ProductSummaryResponse = {
  hasSales: boolean;
  sync: {
    salesThrough: string | null;
    salesWindowStart: string | null;
    inventoryAsOf: string | null;
    latestSalesFile: string | null;
  };
  metrics: {
    skuCount: number;
    grossSalesCents: number;
    netSalesCents: number;
    grossProfitCents: number;
    grossMarginRate: number | null;
    lossSkuCount: number;
    stockedSkuCount: number;
  };
  items: ProductSummaryItem[];
};

type InventoryHealthStatus = "urgent" | "replenish" | "healthy" | "slow" | "stagnant" | "no_sales";

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
  items: InventoryOverviewItem[];
  plans: ReplenishmentPlanItem[];
  planSummary: {
    draftCount: number;
    confirmedCount: number;
    completedCount: number;
    activeQuantity: number;
  };
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

type SalesImportResponse = {
  ok: boolean;
  status: "imported" | "duplicate" | "rejected" | string;
  message?: string;
  batch?: SalesImportBatch;
  warnings?: ImportIssue[];
  errors?: ImportIssue[];
};

type ChunkUploadResponse = {
  ok: boolean;
  status?: string;
  message?: string;
  upload?: {
    id: string;
    receivedChunkIndexes: number[];
    receivedBytes: number;
    chunkCount: number;
  };
} & Partial<SalesImportResponse>;

type ImportFeedback = {
  tone: "success" | "warning" | "error" | "duplicate";
  title: string;
  message: string;
  details: string[];
};

const salesRangeMap: Record<SalesRangeLabel, SalesRange> = {
  今日: "today",
  近7天: "last7",
  本月: "month",
  本季度: "quarter",
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

const navItems: NavItem[] = [
  { key: "dashboard", label: "BI 看板", short: "BI", description: "经营驾驶舱" },
  { key: "shop", label: "网店分析", short: "店", description: "多平台经营分析" },
  { key: "sales", label: "销售分析", short: "销", description: "利润与渠道表现" },
  { key: "inventory", label: "库存管理", short: "库", description: "库存健康与备货" },
  { key: "product", label: "货品详情", short: "品", description: "商品与毛利测算" },
  { key: "workflow", label: "运营事务", short: "务", description: "计划、巡店与新品", badge: "7" },
  { key: "import", label: "数据导入", short: "入", description: "批次导入与校验" },
  { key: "settings", label: "系统设置", short: "设", description: "参数、映射与权限" },
];

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 0,
  }).format(value);

const formatCurrencyFromCents = (value = 0) => formatCurrency(value / 100);
const formatCount = (value = 0) => new Intl.NumberFormat("zh-CN").format(value);
const rateAsPercent = (value = 0) => value * 100;
const formatRate = (value = 0) => `${rateAsPercent(value).toFixed(1)}%`;
const formatFileSize = (bytes = 0) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
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

const shopRows = [
  { name: "京东自营旗舰店", platform: "京东自营", sales: 1468200, orders: 8412, rate: "23.8%", trend: 15.2 },
  { name: "天猫官方旗舰店", platform: "天猫", sales: 1086300, orders: 6917, rate: "22.4%", trend: 9.7 },
  { name: "京东 POP 旗舰店", platform: "京东 POP", sales: 734600, orders: 4258, rate: "19.6%", trend: 6.1 },
  { name: "京东专营店", platform: "京东 POP", sales: 426800, orders: 2671, rate: "18.9%", trend: -2.4 },
];

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

function DashboardView() {
  const bars = [52, 61, 48, 68, 74, 64, 81, 76, 88, 69, 92, 84, 96, 91];
  const profit = [30, 35, 26, 39, 44, 36, 47, 43, 54, 38, 57, 51, 63, 58];
  return (
    <>
      <section className="metrics-grid">
        <MetricCard label="净销售额" value="¥ 3,862,900" change="12.8%" hint="较上周期增加 ¥437,600" tone="blue" />
        <MetricCard label="净毛利" value="¥ 846,210" change="8.6%" hint="已完成本月目标 72%" tone="green" />
        <MetricCard label="综合毛利率" value="21.9%" change="1.2%" hint="目标毛利率 22.5%" tone="purple" />
        <MetricCard label="销售退货率" value="4.7%" change="-0.6%" hint="低于行业均值 1.3%" tone="orange" />
      </section>

      <section className="dashboard-main-grid">
        <article className="panel trend-panel">
          <SectionHeader title="销售与毛利趋势" note="近 14 日经营表现" />
          <div className="chart-legend">
            <span><Dot tone="blue" />净销售额</span>
            <span><Dot tone="green" />净毛利</span>
            <div className="chart-tabs"><button>日</button><button className="active">周</button><button>月</button></div>
          </div>
          <div className="bar-chart" aria-label="近14日销售和毛利柱状趋势图">
            {bars.map((height, index) => (
              <div className="bar-group" key={index}>
                <div className="bar-stack">
                  <span className="bar sales-bar" style={{ height: `${height}%` }} />
                  <span className="bar profit-bar" style={{ height: `${profit[index]}%` }} />
                </div>
                <small>{index % 2 === 0 ? `${index + 1}日` : ""}</small>
              </div>
            ))}
          </div>
          <div className="chart-summary">
            <div><span>日均销售额</span><strong>¥ 276,000</strong></div>
            <div><span>峰值日期</span><strong>07月07日</strong></div>
            <div><span>目标完成率</span><strong className="green-text">72.4%</strong></div>
          </div>
        </article>

        <article className="panel alert-panel">
          <SectionHeader title="预警中心" note="需要及时处理的异常" action="查看全部" />
          <div className="alert-score">
            <div className="score-ring"><strong>86</strong><small>健康分</small></div>
            <div><strong>整体经营稳定</strong><p>较昨日提升 3 分</p></div>
          </div>
          <div className="alert-list">
            <button><span className="alert-icon danger">!</span><span><b>库存即将售罄</b><small>5 个货品低于 7 天库存</small></span><em>5</em></button>
            <button><span className="alert-icon warning">↓</span><span><b>销售连续下降</b><small>3 个店铺连续 3 日下降</small></span><em>3</em></button>
            <button><span className="alert-icon purple">◷</span><span><b>低周转库存</b><small>12 个货品周转超过 45 天</small></span><em>12</em></button>
          </div>
        </article>
      </section>

      <section className="dashboard-bottom-grid">
        <article className="panel">
          <SectionHeader title="店铺经营排行" note="按净销售额排序" action="进入网店分析" />
          <div className="rank-list">
            {shopRows.map((shop, index) => (
              <div className="rank-row" key={shop.name}>
                <span className={`rank-number rank-${index + 1}`}>{index + 1}</span>
                <div className="shop-avatar">{shop.platform.slice(0, 1)}</div>
                <div className="rank-name"><strong>{shop.name}</strong><small>{shop.platform} · {shop.orders.toLocaleString()} 单</small></div>
                <div className="mini-progress"><i style={{ width: `${90 - index * 17}%` }} /></div>
                <div className="rank-value"><strong>{formatCurrency(shop.sales)}</strong><small className={shop.trend < 0 ? "red-text" : "green-text"}>{shop.trend > 0 ? "+" : ""}{shop.trend}%</small></div>
              </div>
            ))}
          </div>
        </article>

        <article className="panel todo-panel">
          <SectionHeader title="今日待办" note="7 项任务等待推进" action="运营事务" />
          <div className="todo-progress"><span><i style={{ width: "58%" }} /></span><small>已完成 7 / 12</small></div>
          {[
            ["检查京东旗舰店活动价格", "今天 11:30", "高"],
            ["新品精华液主图复核", "今天 14:00", "中"],
            ["华东 RDC 缺货补单", "今天 17:00", "高"],
            ["天猫评价晒图维护", "明天 10:00", "普通"],
          ].map((item) => (
            <label className="todo-item" key={item[0]}>
              <input type="checkbox" />
              <span><b>{item[0]}</b><small>{item[1]}</small></span>
              <em className={`priority priority-${item[2]}`}>{item[2]}</em>
            </label>
          ))}
        </article>
      </section>
    </>
  );
}

function ShopView() {
  const [platform, setPlatform] = useState("全部平台");
  const filtered = platform === "全部平台" ? shopRows : shopRows.filter((row) => row.platform === platform);
  return (
    <>
      <div className="subnav">
        {['店铺数据', '商品数据', '企业购分析', '推广分析', '商品信息'].map((tab, index) => <button className={index === 0 ? "active" : ""} key={tab}>{tab}</button>)}
      </div>
      <section className="metrics-grid">
        <MetricCard label="店铺成交金额" value="¥ 3,715,900" change="11.4%" hint="4 家店铺 · 22,258 笔订单" tone="blue" />
        <MetricCard label="访客数" value="684,320" change="18.2%" hint="访客价值 ¥5.43" tone="purple" />
        <MetricCard label="成交转化率" value="3.25%" change="0.4%" hint="高于上月平均水平" tone="green" />
        <MetricCard label="推广投入产出比" value="4.68" change="6.7%" hint="推广花费 ¥176,800" tone="orange" />
      </section>
      <section className="panel table-panel">
        <div className="table-toolbar">
          <div><h2>店铺经营表现</h2><p>统一查看京东自营、POP 与天猫店铺</p></div>
          <div className="segmented">
            {["全部平台", "京东自营", "京东 POP", "天猫"].map((item) => <button key={item} className={platform === item ? "active" : ""} onClick={() => setPlatform(item)}>{item}</button>)}
          </div>
        </div>
        <div className="data-table-wrap"><table className="data-table">
          <thead><tr><th>店铺</th><th>平台</th><th>净销售额</th><th>订单量</th><th>毛利率</th><th>环比</th><th>经营状态</th></tr></thead>
          <tbody>{filtered.map((row) => <tr key={row.name}>
            <td><div className="cell-name"><span className="shop-avatar">{row.platform[0]}</span><strong>{row.name}</strong></div></td>
            <td><span className="soft-tag">{row.platform}</span></td><td><strong>{formatCurrency(row.sales)}</strong></td><td>{row.orders.toLocaleString()}</td><td>{row.rate}</td>
            <td className={row.trend < 0 ? "red-text" : "green-text"}>{row.trend > 0 ? "↑" : "↓"} {Math.abs(row.trend)}%</td><td><span className={`status ${row.trend < 0 ? "status-warning" : "status-success"}`}><Dot tone={row.trend < 0 ? "orange" : "green"} />{row.trend < 0 ? "需要关注" : "表现良好"}</span></td>
          </tr>)}</tbody>
        </table></div>
      </section>
    </>
  );
}

type SalesTab = "overview" | "channel";
type ChannelDimension = "channel" | "platform";

function SalesSubnav({ active, onChange }: { active: SalesTab; onChange: (tab: SalesTab) => void }) {
  return (
    <div className="subnav sales-subnav" role="tablist" aria-label="销售分析子版块">
      <button type="button" role="tab" aria-selected={active === "overview"} className={active === "overview" ? "active" : ""} onClick={() => onChange("overview")}>销售总览</button>
      <button type="button" role="tab" aria-selected={active === "channel"} className={active === "channel" ? "active" : ""} onClick={() => onChange("channel")}>渠道分析</button>
      <button type="button" disabled title="该版块正在规划中">财报分析</button>
      <button type="button" disabled title="该版块正在规划中">参数配置</button>
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
                  <div><strong title={item.name}>{item.name || "未分类"}</strong><small>{formatCurrencyFromCents(item.netSalesCents)} · {formatRate(item.shareRate)}</small></div>
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
            <thead><tr><th>排名</th><th>{dimensionLabel}</th><th>销售额（GMV）</th><th>销售净额</th><th>净额占比</th><th>订单毛利</th><th>毛利率</th><th>订单量</th><th>退货率</th><th>经营状态</th></tr></thead>
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

function SalesView({ range, customStartDate, customEndDate }: { range: SalesRangeLabel; customStartDate: string; customEndDate: string }) {
  const apiRange = salesRangeMap[range];
  const [activeTab, setActiveTab] = useState<SalesTab>("overview");
  const [summary, setSummary] = useState<SalesSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);

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
  }, [apiRange, customStartDate, customEndDate, retryKey]);

  const current = summary?.current;
  const previous = summary?.previous;
  const yearAgo = summary?.yearAgo;
  const channels = useMemo(() => summary?.channels ?? [], [summary?.channels]);
  const salesChannels = summary?.shops?.length ? summary.shops : channels;
  const platforms = summary?.platforms?.length ? summary.platforms : channels;
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
          <p>请先在“数据导入”中上传吉客云销售单明细账，或切换其他统计周期。</p>
        </section></>
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
            <SectionHeader title="渠道销售构成" note="按销售净额统计渠道占比" />
            <div className="channel-chart">
              <div className="donut" style={{ background: donutBackground }}><div><strong>{(current.netSalesCents / 1000000).toFixed(1)}</strong><small>万元净额</small></div></div>
              <div className="channel-list">{channels.map((item, index) => <div key={item.name}><span><Dot tone={channelTones[index % channelTones.length]} />{item.name || "未分类"}</span><strong>{formatCurrencyFromCents(item.netSalesCents)}</strong><em>{formatRate(item.shareRate)}</em></div>)}</div>
            </div>
          </article>
          <article className="panel">
            <SectionHeader title="渠道毛利表现" note={`综合毛利率 ${formatRate(current.grossMarginRate)}`} />
            <div className="progress-list">{channels.map((item, index) => {
              const margin = Math.max(0, Math.min(rateAsPercent(item.grossMarginRate), 100));
              const tone = channelTones[index % channelTones.length];
              return <div key={item.name}><div><span>{item.name || "未分类"}<small>{formatCount(item.orderCount)} 单 · {formatCount(item.lineCount)} 行</small></span><strong>{formatRate(item.grossMarginRate)}</strong></div><span className="progress-track"><i className={`bg-${tone}`} style={{ width: `${margin}%` }} /></span></div>;
            })}</div>
            <div className="insight-card"><span>数据口径</span><p>渠道构成、毛利率与订单行数均来自当前统计周期内已成功导入的吉客云销售明细。</p></div>
          </article>
        </section>
      </>}
    </>
  );
}

type InventoryTab = "overview" | "plan";

const inventoryStatusMeta: Record<InventoryHealthStatus, { label: string; tone: string }> = {
  urgent: { label: "紧急补货", tone: "danger" },
  replenish: { label: "建议补货", tone: "warning" },
  healthy: { label: "库存健康", tone: "success" },
  slow: { label: "低周转", tone: "purple" },
  stagnant: { label: "呆滞风险", tone: "danger" },
  no_sales: { label: "无销量数据", tone: "gray" },
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [syncStage, setSyncStage] = useState("");
  const [syncFeedback, setSyncFeedback] = useState<{ tone: "success" | "warning" | "error"; title: string; message: string } | null>(null);
  const [query, setQuery] = useState("");
  const [warehouseFilter, setWarehouseFilter] = useState("全部仓库");
  const [typeFilter, setTypeFilter] = useState("全部类型");
  const [statusFilter, setStatusFilter] = useState("全部状态");
  const [planActionId, setPlanActionId] = useState("");
  const [planQuantities, setPlanQuantities] = useState<Record<string, number>>({});

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/inventory/overview", { cache: "no-store" });
      const payload = await response.json().catch(() => null) as (InventoryOverviewResponse & { error?: string; message?: string }) | null;
      if (!response.ok) throw new Error(payload?.error || payload?.message || `库存数据读取失败（${response.status}）`);
      if (!payload || !Array.isArray(payload.items) || !payload.metrics || !payload.sync) throw new Error("库存总览响应格式不完整");
      setOverview(payload);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "暂时无法读取库存数据");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadOverview(), 0);
    return () => window.clearTimeout(timer);
  }, [loadOverview, retryKey]);

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return (overview?.items ?? []).filter((item) => {
      const matchesQuery = !normalizedQuery || `${item.productCode}${item.productName}${item.specification}${item.category}${item.warehouse}`.toLowerCase().includes(normalizedQuery);
      const matchesWarehouse = warehouseFilter === "全部仓库" || item.warehouse === warehouseFilter;
      const matchesType = typeFilter === "全部类型" || item.warehouseType === typeFilter;
      const matchesStatus = statusFilter === "全部状态" || item.status === statusFilter;
      return matchesQuery && matchesWarehouse && matchesType && matchesStatus;
    });
  }, [overview?.items, query, statusFilter, typeFilter, warehouseFilter]);

  const recommendations = useMemo(
    () => (overview?.items ?? []).filter((item) => (item.suggestedQuantity ?? 0) > 0).sort((left, right) => (right.suggestedQuantity ?? 0) - (left.suggestedQuantity ?? 0)),
    [overview?.items],
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
          body: JSON.stringify({ action: "complete", uploadId }),
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
      await loadOverview();
    } catch (requestError) {
      setSyncFeedback({ tone: "error", title: "库存同步失败", message: requestError instanceof Error ? requestError.message : "请检查文件后重试" });
    } finally {
      setSyncing(false);
      setSyncStage("");
      if (syncInputRef.current) syncInputRef.current.value = "";
    }
  }, [loadOverview]);

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
      <button type="button" disabled title="库龄字段已接入，独立分析视图将在下一阶段开放">库龄分析</button>
      <button type="button" role="tab" aria-selected={activeTab === "plan"} className={activeTab === "plan" ? "active" : ""} onClick={() => setActiveTab("plan")}>备货计划</button>
      <button type="button" disabled title="滞销清理流程正在规划中">滞销清理</button>
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

  const totalHealth = Math.max(1, overview.items.length);
  const planStatusLabel: Record<ReplenishmentPlanItem["status"], string> = {
    draft: "草稿",
    confirmed: "已确认",
    completed: "已完成",
    cancelled: "已取消",
  };

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
              ] as [InventoryHealthStatus, number][]).map(([status, count]) => <button type="button" onClick={() => setStatusFilter(status)} key={status}><span className={`health-swatch health-${status}`} /><div><small>{inventoryStatusMeta[status].label}</small><strong>{formatCount(count)}</strong></div></button>)}
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
          <div className="table-toolbar"><div><h2>库存健康明细</h2><p>自有仓与京东 RDC / DC 分开核算，销量仅按相同仓库匹配</p></div><span className="soft-tag">显示 {formatCount(Math.min(filteredItems.length, 300))} / {formatCount(filteredItems.length)}</span></div>
          <div className="filter-row inventory-filter-row">
            <div className="search-box compact">⌕ <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索货品、编号、仓库或品类" /></div>
            <select className="filter-select" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} aria-label="库存类型"><option>全部类型</option><option value="owned">自有仓</option><option value="jd_rdc">京东 RDC / DC</option><option value="other">其他</option></select>
            <select className="filter-select" value={warehouseFilter} onChange={(event) => setWarehouseFilter(event.target.value)} aria-label="仓库"><option>全部仓库</option>{overview.filters.warehouses.map((warehouse) => <option key={warehouse}>{warehouse}</option>)}</select>
            <select className="filter-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="健康状态"><option>全部状态</option>{Object.entries(inventoryStatusMeta).map(([value, meta]) => <option value={value} key={value}>{meta.label}</option>)}</select>
            {(query || warehouseFilter !== "全部仓库" || typeFilter !== "全部类型" || statusFilter !== "全部状态") && <button className="row-action" onClick={() => { setQuery(""); setWarehouseFilter("全部仓库"); setTypeFilter("全部类型"); setStatusFilter("全部状态"); }}>清除筛选</button>}
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
      </> : <>
        <section className="inventory-kpi-grid inventory-plan-kpis">
          <InventoryKpiCard label="待确认草稿" value={`${formatCount(overview.planSummary.draftCount)} 项`} note="确认后进入执行队列" tone="orange" icon="草" />
          <InventoryKpiCard label="已确认计划" value={`${formatCount(overview.planSummary.confirmedCount)} 项`} note="已计入在途库存" tone="blue" icon="确" />
          <InventoryKpiCard label="计划待回写量" value={`${formatCount(overview.planSummary.activeQuantity)} 件`} note="含完成后等待库存快照回写的数量" tone="purple" icon="途" />
          <InventoryKpiCard label="可生成建议" value={`${formatCount(recommendations.filter((item) => !item.inDraftPlan).length)} 项`} note="按最新库存与销量实时重算" tone="green" icon="荐" />
        </section>

        <section className="panel table-panel replenishment-plan-panel">
          <div className="table-toolbar"><div><h2>备货计划</h2><p>调整草稿数量并确认；草稿、已确认数量会自动计入在途，防止重复建议</p></div><button className="secondary-button" onClick={() => setActiveTab("overview")}>返回库存明细</button></div>
          <div className="data-table-wrap"><table className="data-table replenishment-plan-table"><thead><tr><th>货品</th><th>仓库</th><th>建议依据</th><th>当前可售</th><th>系统建议</th><th>计划数量</th><th>状态</th><th>操作</th></tr></thead><tbody>
            {overview.plans.map((plan) => <tr key={plan.id}><td><div className="product-cell"><span className="product-thumb">{plan.productName.slice(0, 1) || "货"}</span><span><strong>{plan.productName}</strong><small>{plan.productCode}</small></span></div></td><td>{plan.warehouse}</td><td><span className="plan-reason" title={plan.reason}>{plan.reason}</span></td><td>{plan.coverageDays === null ? "—" : `${plan.coverageDays.toFixed(1)} 天`}</td><td><strong>{formatCount(plan.suggestedQuantity)}</strong></td><td>{plan.status === "draft" ? <input className="plan-quantity-input" type="number" min={1} max={10000000} value={planQuantities[plan.id] ?? plan.plannedQuantity} onChange={(event) => setPlanQuantities((current) => ({ ...current, [plan.id]: Math.max(1, Math.trunc(Number(event.target.value) || 1)) }))} aria-label={`${plan.productName}计划数量`} /> : <strong>{formatCount(plan.plannedQuantity)}</strong>}</td><td><span className={`status status-${plan.status === "draft" ? "warning" : plan.status === "confirmed" ? "success" : "purple"}`}><Dot tone={plan.status === "draft" ? "orange" : plan.status === "confirmed" ? "green" : "purple"} />{planStatusLabel[plan.status]}</span></td><td><div className="plan-row-actions">{plan.status === "draft" && <><button className="row-action primary-row-action" disabled={planActionId === plan.id} onClick={() => void updatePlanStatus(plan, "confirmed")}>确认</button><button className="row-action" disabled={planActionId === plan.id} onClick={() => void updatePlanStatus(plan, "cancelled")}>取消</button></>}{plan.status === "confirmed" && <><button className="row-action primary-row-action" disabled={planActionId === plan.id} onClick={() => void updatePlanStatus(plan, "completed")}>完成</button><button className="row-action" disabled={planActionId === plan.id} onClick={() => void updatePlanStatus(plan, "cancelled")}>取消</button></>}{plan.status === "completed" && <span className="plan-done">✓ 已完成</span>}</div></td></tr>)}
            {overview.plans.length === 0 && <tr><td colSpan={8}><div className="table-state">暂无备货计划。请在“库存总览”中将补货建议加入计划。</div></td></tr>}
          </tbody></table></div>
        </section>

        {recommendations.some((item) => !item.inDraftPlan) && <section className="panel plan-suggestion-panel"><SectionHeader title="待纳入计划的建议" note="按缺口量从高到低" /><div>{recommendations.filter((item) => !item.inDraftPlan).slice(0, 6).map((item) => <article key={item.key}><span>{item.productName.slice(0, 1) || "货"}</span><div><strong>{item.productName}</strong><small>{item.warehouse} · {item.reason}</small></div><em>+{formatCount(item.suggestedQuantity ?? 0)}</em><button className="row-action" disabled={planActionId === item.key} onClick={() => void createPlan(item)}>加入草稿</button></article>)}</div></section>}
      </>}
    </>
  );
}

type ProductTab = "overview" | "calculator";
type ProductCalculatorInput = { salePrice: number; unitCost: number; feeRate: number; promotionCost: number };

function ProductView() {
  const [activeTab, setActiveTab] = useState<ProductTab>("overview");
  const [days, setDays] = useState(30);
  const [summary, setSummary] = useState<ProductSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部品类");
  const [marginFilter, setMarginFilter] = useState("全部毛利");
  const [sortBy, setSortBy] = useState("sales");
  const [selectedCode, setSelectedCode] = useState("");
  const [calculatorOverrides, setCalculatorOverrides] = useState<Record<string, ProductCalculatorInput>>({});

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/products/summary?days=${days}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null) as (ProductSummaryResponse & { error?: string }) | null;
      if (!response.ok || !payload || !payload.metrics || !Array.isArray(payload.items)) {
        throw new Error(payload?.error || `商品数据读取失败（${response.status}）`);
      }
      setSummary(payload);
      setSelectedCode((current) => current || payload.items[0]?.productCode || "");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "暂时无法读取商品数据");
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadSummary(), 0);
    return () => window.clearTimeout(timer);
  }, [loadSummary, retryKey]);

  const selectedProduct = useMemo(
    () => summary?.items.find((item) => item.productCode === selectedCode) ?? null,
    [selectedCode, summary?.items],
  );

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
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const items = (summary?.items ?? []).filter((item) => {
      const matchesKeyword = !keyword || `${item.productCode}${item.productName}${item.specification}${item.category}`.toLowerCase().includes(keyword);
      const matchesCategory = category === "全部品类" || item.category === category;
      const matchesMargin = marginFilter === "全部毛利"
        || (marginFilter === "盈利" && item.grossProfitCents >= 0)
        || (marginFilter === "亏损" && item.grossProfitCents < 0)
        || (marginFilter === "低毛利" && item.grossMarginRate !== null && item.grossMarginRate >= 0 && item.grossMarginRate < 0.2);
      return matchesKeyword && matchesCategory && matchesMargin;
    });
    return items.sort((left, right) => {
      if (sortBy === "margin") return (right.grossMarginRate ?? -Infinity) - (left.grossMarginRate ?? -Infinity);
      if (sortBy === "profit") return right.grossProfitCents - left.grossProfitCents;
      if (sortBy === "stock") return (right.availableQuantity ?? -1) - (left.availableQuantity ?? -1);
      return right.netSalesCents - left.netSalesCents;
    });
  }, [category, marginFilter, query, sortBy, summary?.items]);

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
  const subnav = <div className="subnav product-subnav" role="tablist" aria-label="商品管理子版块"><button type="button" role="tab" aria-selected={activeTab === "overview"} className={activeTab === "overview" ? "active" : ""} onClick={() => setActiveTab("overview")}>商品经营</button><button type="button" role="tab" aria-selected={activeTab === "calculator"} className={activeTab === "calculator" ? "active" : ""} onClick={() => setActiveTab("calculator")}>毛利测算</button></div>;

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
      <section className="product-search-hero product-live-hero"><div><span className="eyebrow">商品经营中心</span><h2>商品表现与实际毛利实时汇总</h2><p>销售数据截止 {summary.sync.salesThrough} · 库存快照 {summary.sync.inventoryAsOf ?? "未同步"}</p></div><div className="product-hero-actions"><div className="product-window-toggle" role="group" aria-label="商品统计周期"><button className={days === 30 ? "active" : ""} onClick={() => setDays(30)}>近30日</button><button className={days === 90 ? "active" : ""} onClick={() => setDays(90)}>近90日</button></div><button className="secondary-button product-refresh" onClick={() => void loadSummary()} disabled={loading}>{loading ? "同步中…" : "↻ 同步数据"}</button></div></section>

      {error && <section className="inventory-feedback inventory-feedback-error" role="alert"><span>!</span><div><strong>数据刷新失败</strong><p>{error}</p></div><button className="row-action" onClick={() => setRetryKey((key) => key + 1)}>重试</button></section>}

      {activeTab === "overview" ? <>
        <section className="inventory-kpi-grid product-kpi-grid">
          <InventoryKpiCard label="活跃商品" value={`${formatCount(summary.metrics.skuCount)} 个`} note={`已覆盖 ${formatCount(summary.metrics.stockedSkuCount)} 个有库存商品`} tone="blue" icon="品" />
          <InventoryKpiCard label="商品销售净额" value={formatCurrencyFromCents(summary.metrics.netSalesCents)} note={`近 ${days} 日已扣除退货`} tone="purple" icon="销" />
          <InventoryKpiCard label="实际订单毛利" value={formatCurrencyFromCents(summary.metrics.grossProfitCents)} note={`综合毛利率 ${summary.metrics.grossMarginRate === null ? "—" : formatRate(summary.metrics.grossMarginRate)}`} tone="green" icon="利" />
          <InventoryKpiCard label="亏损商品" value={`${formatCount(summary.metrics.lossSkuCount)} 个`} note="按销售净额与订单毛利识别" tone="orange" icon="警" />
        </section>

        <section className="panel product-filter-panel">
          <div className="table-toolbar"><div><h2>商品经营明细</h2><p>销售单价、成本、费用与毛利均由已导入订单明细聚合，不使用演示数据。</p></div><span className="soft-tag">显示 {formatCount(Math.min(filtered.length, 300))} / {formatCount(filtered.length)}</span></div>
          <div className="filter-row product-filter-row"><div className="search-box compact">⌕ <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索货品编号、名称、规格或品类" /></div><select className="filter-select" value={category} onChange={(event) => setCategory(event.target.value)} aria-label="商品品类"><option>全部品类</option>{categories.map((item) => <option key={item}>{item}</option>)}</select><select className="filter-select" value={marginFilter} onChange={(event) => setMarginFilter(event.target.value)} aria-label="毛利状态"><option>全部毛利</option><option>盈利</option><option>低毛利</option><option>亏损</option></select><select className="filter-select" value={sortBy} onChange={(event) => setSortBy(event.target.value)} aria-label="排序方式"><option value="sales">按销售净额</option><option value="profit">按订单毛利</option><option value="margin">按毛利率</option><option value="stock">按可用库存</option></select></div>
          <div className="data-table-wrap"><table className="data-table product-live-table"><thead><tr><th>货品</th><th>品类</th><th>近{days}日销量</th><th>销售净额</th><th>均价 / 均成本</th><th>费用</th><th>订单毛利</th><th>实际毛利率</th><th>可用库存</th><th>操作</th></tr></thead><tbody>
            {filtered.slice(0, 300).map((item) => { const loss = item.grossProfitCents < 0; return <tr key={item.productCode}><td><div className="product-cell"><span className="product-thumb gradient-thumb">{item.productName.slice(0, 1) || "货"}</span><span><strong title={item.productName}>{item.productName}</strong><small>{item.productCode}{item.specification ? ` · ${item.specification}` : ""}</small></span></div></td><td><span className="soft-tag">{item.category}</span></td><td>{formatCount(item.netQuantity)}</td><td><strong>{formatCurrencyFromCents(item.netSalesCents)}</strong></td><td><div className="product-money-pair"><strong>{item.averageSalePriceCents === null ? "—" : formatCurrencyFromCents(item.averageSalePriceCents)}</strong><small>成本 {item.averageCostCents === null ? "—" : formatCurrencyFromCents(item.averageCostCents)}</small></div></td><td>{formatCurrencyFromCents(item.feeCents)}</td><td className={loss ? "red-text" : "green-text"}><strong>{formatCurrencyFromCents(item.grossProfitCents)}</strong></td><td><span className={`product-margin ${loss ? "loss" : item.grossMarginRate !== null && item.grossMarginRate < 0.2 ? "low" : ""}`}>{item.grossMarginRate === null ? "—" : formatRate(item.grossMarginRate)}</span></td><td>{item.availableQuantity === null ? "未同步" : formatCount(item.availableQuantity)}</td><td><button className="row-action" onClick={() => { setSelectedCode(item.productCode); setActiveTab("calculator"); }}>测算</button></td></tr>; })}
            {filtered.length === 0 && <tr><td colSpan={10}><div className="table-state">没有符合当前筛选条件的商品。</div></td></tr>}
          </tbody></table></div>
        </section>
      </> : <>
        <section className="product-calculator-grid">
          <article className="panel calculator-input-panel"><SectionHeader title="毛利测算" note="默认带入所选商品近期开单均价、成本与费用率，可按活动方案调整" /><div className="calculator-fields"><label><span>选择商品</span><select value={selectedCode} onChange={(event) => setSelectedCode(event.target.value)} aria-label="选择用于测算的商品">{summary.items.map((item) => <option value={item.productCode} key={item.productCode}>{item.productName} · {item.productCode}</option>)}</select></label><label><span>预计成交价（元）</span><input type="number" min={0} step="0.01" value={calculator.salePrice} onChange={(event) => updateCalculator("salePrice", Number(event.target.value))} /></label><label><span>单位成本（元）</span><input type="number" min={0} step="0.01" value={calculator.unitCost} onChange={(event) => updateCalculator("unitCost", Number(event.target.value))} /></label><label><span>平台综合费率（%）</span><input type="number" min={0} step="0.01" value={calculator.feeRate} onChange={(event) => updateCalculator("feeRate", Number(event.target.value))} /></label><label><span>单件促销/履约成本（元）</span><input type="number" min={0} step="0.01" value={calculator.promotionCost} onChange={(event) => updateCalculator("promotionCost", Number(event.target.value))} /></label></div><div className="calculator-source"><Dot tone="blue" /><span>{selectedProduct ? `${selectedProduct.productName} · 最近实际毛利率 ${selectedProduct.grossMarginRate === null ? "—" : formatRate(selectedProduct.grossMarginRate)}` : "请选择商品"}</span></div></article>
          <article className="panel calculator-result-panel"><SectionHeader title="预计单件收益" note="成交价 − 单位成本 − 平台费 − 促销/履约成本" /><div className="calculator-result"><div><span>预计单件毛利</span><strong className={estimatedProfit < 0 ? "red-text" : "green-text"}>{formatCurrency(estimatedProfit)}</strong></div><div><span>预计毛利率</span><strong className={estimatedMargin === null ? "" : estimatedMargin < 0 ? "red-text" : "green-text"}>{estimatedMargin === null ? "—" : formatRate(estimatedMargin)}</strong></div><div><span>预计平台费用</span><strong>{formatCurrency(estimatedFee)}</strong></div></div><div className={`calculator-decision ${estimatedMargin !== null && estimatedMargin < 0 ? "danger" : estimatedMargin !== null && estimatedMargin < 0.2 ? "warning" : "success"}`}><strong>{estimatedMargin === null ? "请输入成交价" : estimatedMargin < 0 ? "该方案预计亏损" : estimatedMargin < 0.2 ? "该方案毛利偏低" : "该方案毛利健康"}</strong><p>{estimatedMargin === null ? "成交价大于 0 后即可得到测算结果。" : `每售出 1 件，预计保留 ${formatCurrency(estimatedProfit)} 毛利。`}</p></div></article>
        </section>
        <section className="panel product-reference-panel"><SectionHeader title="实际经营参考" note="用于对照测算方案与近期真实订单表现" /><div className="product-reference-grid"><div><span>近{days}日销售净额</span><strong>{selectedProduct ? formatCurrencyFromCents(selectedProduct.netSalesCents) : "—"}</strong></div><div><span>近{days}日订单毛利</span><strong className={selectedProduct && selectedProduct.grossProfitCents < 0 ? "red-text" : "green-text"}>{selectedProduct ? formatCurrencyFromCents(selectedProduct.grossProfitCents) : "—"}</strong></div><div><span>实际平台费用率</span><strong>{selectedProduct?.observedFeeRate === null || !selectedProduct ? "—" : formatRate(selectedProduct.observedFeeRate)}</strong></div><div><span>当前可用库存</span><strong>{selectedProduct?.availableQuantity === null || !selectedProduct ? "未同步" : `${formatCount(selectedProduct.availableQuantity)} 件`}</strong></div></div></section>
      </>}
    </>
  );
}

function WorkflowView() {
  const columns = [
    { title: "待开始", count: 3, tone: "gray", cards: [["完成 7 月大促价格检查", "京东自营", "今天"], ["新品成分资料归档", "新品上架", "7月12日"], ["面膜套装赠品确认", "天猫", "7月13日"]] },
    { title: "进行中", count: 4, tone: "blue", cards: [["净透精华主图升级", "新品上架", "今天"], ["华东仓缺货补单", "库存协同", "今天"], ["POP 店铺巡店检查", "巡店", "7月11日"]] },
    { title: "待审核", count: 2, tone: "orange", cards: [["618 复盘报告", "数据分析", "今天"], ["评价晒图素材第 3 批", "评价维护", "7月11日"]] },
    { title: "已完成", count: 7, tone: "green", cards: [["天猫周报数据核对", "周报", "昨天"], ["新品 SKU 映射", "新品上架", "昨天"], ["京东活动报名", "京东自营", "7月8日"]] },
  ];
  return (
    <>
      <div className="subnav"><button className="active">工作计划</button><button>巡店检查</button><button>评价维护</button><button>新品上架</button><button>变量配置</button></div>
      <section className="workflow-toolbar"><div><span className="eyebrow">运营协作</span><h2>工作计划看板</h2><p>集中管理日常任务、巡店事项与新品推进。</p></div><button className="primary-button">＋ 新建工作项</button></section>
      <section className="kanban">{columns.map((column) => <div className="kanban-column" key={column.title}><div className="kanban-title"><span><Dot tone={column.tone} />{column.title}</span><em>{column.count}</em></div><div className="kanban-cards">{column.cards.map((card, index) => <article className="task-card" key={card[0]}><div><span className={`task-priority priority-line-${index === 1 ? "orange" : column.tone}`} /><button>•••</button></div><h3>{card[0]}</h3><span className="soft-tag">{card[1]}</span><footer><span className="avatar-stack"><i>张</i><i>李</i></span><small>{card[2]}</small></footer></article>)}</div><button className="add-card">＋ 添加工作项</button></div>)}</section>
    </>
  );
}

function ImportView() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStage, setUploadStage] = useState("");
  const [feedback, setFeedback] = useState<ImportFeedback | null>(null);
  const [history, setHistory] = useState<SalesImportBatch[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const response = await fetch("/api/imports/sales", { cache: "no-store" });
      const payload = await response.json().catch(() => null) as (ImportHistoryResponse & { message?: string }) | null;
      if (!response.ok) throw new Error(payload?.message || `导入历史读取失败（${response.status}）`);
      if (!Array.isArray(payload?.items)) throw new Error("导入历史响应格式不完整");
      setHistory(payload.items);
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

  const acceptFile = useCallback((candidate?: File) => {
    setDragging(false);
    if (!candidate) return;
    if (!candidate.name.toLowerCase().endsWith(".xlsx")) {
      setSelectedFile(null);
      setFeedback({
        tone: "error",
        title: "文件格式不支持",
        message: "请选择吉客云 ERP 导出的 .xlsx 销售单明细账。",
        details: [],
      });
      return;
    }
    if (candidate.size > MAX_IMPORT_FILE_SIZE) {
      setSelectedFile(null);
      setFeedback({
        tone: "error",
        title: "文件超过 128MB",
        message: `当前文件为 ${formatFileSize(candidate.size)}。单个销售明细账最大支持 128MB。`,
        details: [],
      });
      return;
    }
    setSelectedFile(candidate);
    setFeedback(null);
  }, []);

  const showImportResult = (payload: SalesImportResponse | null, responseStatus: number) => {
    const warnings = payload?.warnings ?? payload?.batch?.warnings ?? [];
    const errors = payload?.errors ?? [];
    if (!payload?.ok || payload.status === "rejected") {
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
        message: payload.message || "该文件已导入，系统没有重复写入销售数据。",
        details: warnings.slice(0, 8).map(issueText),
      });
    } else if (warnings.length || (payload.batch?.warningCount ?? 0) > 0) {
      setFeedback({
        tone: "warning",
        title: `导入完成，含 ${payload.batch?.warningCount ?? warnings.length} 条提示`,
        message: payload.message || `成功写入 ${formatCount(payload.batch?.insertedCount)} 行销售明细。`,
        details: warnings.slice(0, 8).map(issueText),
      });
    } else {
      setFeedback({
        tone: "success",
        title: "销售明细导入成功",
        message: payload.message || `成功写入 ${formatCount(payload.batch?.insertedCount)} 行，销售分析已更新。`,
        details: [],
      });
    }
    return true;
  };

  const importChunkedFile = async (file: File): Promise<{ payload: SalesImportResponse | null; status: number }> => {
    const chunkCount = Math.ceil(file.size / SALES_UPLOAD_CHUNK_SIZE);
    const fingerprint = `sales-v1:${file.name}:${file.size}:${file.lastModified}:${SALES_UPLOAD_CHUNK_SIZE}`;
    setUploadStage("正在检查可续传的上传进度…");
    const initResponse = await fetch("/api/imports/sales/chunks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "init", fileName: file.name, fileSizeBytes: file.size, chunkCount, fingerprint }),
    });
    const initPayload = await initResponse.json().catch(() => null) as ChunkUploadResponse | null;
    if (!initResponse.ok || !initPayload?.ok || !initPayload.upload) {
      throw new Error(initPayload?.message || "无法创建分片上传任务");
    }
    const uploaded = new Set(initPayload.upload.receivedChunkIndexes);
    let uploadedBytes = 0;
    for (const index of uploaded) {
      const start = index * SALES_UPLOAD_CHUNK_SIZE;
      uploadedBytes += Math.min(SALES_UPLOAD_CHUNK_SIZE, file.size - start);
    }
    setUploadProgress(Math.round((uploadedBytes / file.size) * 100));

    for (let index = 0; index < chunkCount; index += 1) {
      if (uploaded.has(index)) continue;
      const start = index * SALES_UPLOAD_CHUNK_SIZE;
      const part = file.slice(start, Math.min(start + SALES_UPLOAD_CHUNK_SIZE, file.size));
      setUploadStage(`正在上传第 ${index + 1}/${chunkCount} 个分片…`);
      const partResponse = await fetch("/api/imports/sales/chunks", {
        method: "PUT",
        headers: { "x-upload-id": initPayload.upload.id, "x-chunk-index": String(index), "content-type": "application/octet-stream" },
        body: part,
      });
      const partPayload = await partResponse.json().catch(() => null) as ChunkUploadResponse | null;
      if (!partResponse.ok || !partPayload?.ok) throw new Error(partPayload?.message || `第 ${index + 1} 个分片上传失败`);
      uploadedBytes += part.size;
      setUploadProgress(Math.min(99, Math.round((uploadedBytes / file.size) * 100)));
    }

    setUploadProgress(100);
    setUploadStage("分片已上传，正在合并并校验销售明细…");
    const completeResponse = await fetch("/api/imports/sales/chunks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "complete", uploadId: initPayload.upload.id }),
    });
    return {
      payload: await completeResponse.json().catch(() => null) as SalesImportResponse | null,
      status: completeResponse.status,
    };
  };

  const importFile = async () => {
    if (!selectedFile || uploading) return;
    setUploading(true);
    setFeedback(null);
    setUploadProgress(0);
    try {
      let outcome: { payload: SalesImportResponse | null; status: number };
      if (selectedFile.size > DIRECT_IMPORT_FILE_SIZE) {
        outcome = await importChunkedFile(selectedFile);
      } else {
        setUploadStage("正在上传并校验销售明细…");
        const formData = new FormData();
        formData.append("file", selectedFile);
        formData.append("source", "jky");
        const response = await fetch("/api/imports/sales", { method: "POST", body: formData });
        outcome = { payload: await response.json().catch(() => null) as SalesImportResponse | null, status: response.status };
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

  const sourceOptions = [
    ["吉", "吉客云 ERP", "销售单明细账"],
    ["京", "京东", "暂未开放"],
    ["猫", "天猫", "暂未开放"],
    ["财", "财务报表", "暂未开放"],
  ];

  return (
    <>
      <div className="subnav"><button className="active">文件导入</button><button>导入历史</button><button>数据连续性</button></div>
      <section className="import-grid">
        <article className="panel import-panel">
          <span className="eyebrow">第 1 步</span><h2>选择数据来源</h2><p>当前仅开放吉客云 ERP 销售单明细账导入。</p>
          <div className="source-grid">{sourceOptions.map((item, index) => <button type="button" className={index === 0 ? "selected" : ""} disabled={index !== 0} aria-pressed={index === 0} key={item[1]}><span>{item[0]}</span><strong>{item[1]}</strong><small>{item[2]}</small></button>)}</div>
        </article>
        <article className="panel import-panel">
          <span className="eyebrow">第 2 步</span><h2>上传报表文件</h2><p>仅支持 .xlsx，单文件最大 128MB；超过 2MB 会自动按 2MB 分片上传，网络中断后可续传。</p>
          <input
            ref={inputRef}
            className="file-input-hidden"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
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
            <strong>{selectedFile ? selectedFile.name : "将 .xlsx 文件拖到此处，或点击选择"}</strong>
            <small>{selectedFile ? `${formatFileSize(selectedFile.size)} · ${selectedFile.size > DIRECT_IMPORT_FILE_SIZE ? "将启用分片上传与断点续传" : "将直接上传并校验"}` : "上传后将写入销售分析正式数据"}</small>
          </button>
          <div className="import-actions">
            <span>{uploading ? uploadStage : selectedFile ? "准备导入吉客云 ERP 销售明细" : "请选择待导入文件"}</span>
            <button type="button" className="primary-button" disabled={!selectedFile || uploading} onClick={() => void importFile()}>{uploading ? `${uploadProgress}%` : "开始导入"}</button>
          </div>
          {uploading && selectedFile && <div className="import-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={uploadProgress} aria-label="销售明细上传进度"><span style={{ width: `${uploadProgress}%` }} /></div>}
        </article>
      </section>

      {feedback && <section className={`import-feedback import-feedback-${feedback.tone}`} role={feedback.tone === "error" ? "alert" : "status"} aria-live="polite"><span className="feedback-symbol">{feedback.tone === "success" ? "✓" : feedback.tone === "duplicate" ? "≡" : feedback.tone === "warning" ? "!" : "×"}</span><div><strong>{feedback.title}</strong><p>{feedback.message}</p>{feedback.details.length > 0 && <ul>{feedback.details.map((detail, index) => <li key={`${detail}-${index}`}>{detail}</li>)}</ul>}</div></section>}

      <section className="panel table-panel import-history-panel">
        <div className="section-header"><div><h2>最近导入记录</h2><p>来自导入接口的真实批次记录</p></div><button className="text-button" disabled={historyLoading} onClick={() => void loadHistory()}>{historyLoading ? "刷新中…" : "刷新记录"} <span>↻</span></button></div>
        <div className="data-table-wrap"><table className="data-table"><thead><tr><th>数据来源</th><th>文件名称</th><th>文件大小</th><th>数据行数</th><th>导入结果</th><th>完成时间</th></tr></thead><tbody>
          {historyLoading && history.length === 0 && <tr><td colSpan={6}><div className="table-state"><span className="state-spinner" />正在读取导入记录…</div></td></tr>}
          {!historyLoading && historyError && <tr><td colSpan={6}><div className="table-state table-state-error"><span>{historyError}</span><button className="row-action" onClick={() => void loadHistory()}>重试</button></div></td></tr>}
          {!historyLoading && !historyError && history.length === 0 && <tr><td colSpan={6}><div className="table-state">暂无导入记录，请上传第一份吉客云销售单明细账。</div></td></tr>}
          {history.map((row) => {
            const rejected = row.status === "rejected";
            const duplicate = row.status === "duplicate";
            const warned = row.warningCount > 0;
            const resultText = rejected ? "导入失败" : duplicate ? "重复文件" : warned ? `成功 · ${row.warningCount} 条警告` : "成功";
            const statusClass = rejected ? "status-danger" : duplicate || warned ? "status-warning" : "status-success";
            const dotTone = rejected ? "red" : duplicate || warned ? "orange" : "green";
            return <tr key={row.id}><td><strong>{row.source || "吉客云 ERP · 销售单明细账"}</strong></td><td><div className="history-file"><strong>{row.fileName}</strong>{row.sheetName && <small>工作表：{row.sheetName}</small>}</div></td><td>{formatFileSize(row.fileSizeBytes)}</td><td><div className="history-count"><strong>{formatCount(row.rowCount)}</strong><small>新增 {formatCount(row.insertedCount)} · 重复 {formatCount(row.duplicateCount)}</small></div></td><td><span className={`status ${statusClass}`}><Dot tone={dotTone} />{resultText}</span></td><td>{formatDateTime(row.completedAt || row.createdAt)}</td></tr>;
          })}
        </tbody></table></div>
      </section>
    </>
  );
}

function SettingsView() {
  const [toggles, setToggles] = useState([true, true, false]);
  const toggle = (index: number) => setToggles((current) => current.map((value, i) => i === index ? !value : value));
  return (
    <>
      <div className="subnav"><button className="active">系统参数</button><button>主数据与映射</button><button>权限管理</button><button>数据备份</button></div>
      <section className="settings-grid">
        <article className="panel settings-menu"><h2>设置中心</h2><p>管理系统运行参数与基础数据。</p>{[["库存参数", "周转、库龄与补货规则", "库"], ["BI 看板", "统计周期与经营目标", "BI"], ["消息通知", "钉钉机器人与推送时间", "铃"], ["店铺与平台", "店铺、品牌和渠道配置", "店"], ["用户与权限", "模块查看及编辑权限", "权"]].map((item, index) => <button className={index === 0 ? "active" : ""} key={item[0]}><span>{item[2]}</span><div><strong>{item[0]}</strong><small>{item[1]}</small></div><em>›</em></button>)}</article>
        <article className="panel settings-form"><SectionHeader title="库存参数" note="用于库存健康评估与智能补货建议" /><div className="form-section"><h3>周转与预警</h3><div className="form-grid"><label><span>目标库存天数</span><div><input defaultValue="30" /><em>天</em></div><small>用于计算建议补货数量</small></label><label><span>低库存预警线</span><div><input defaultValue="7" /><em>天</em></div><small>低于该天数触发库存预警</small></label><label><span>低周转判定</span><div><input defaultValue="45" /><em>天</em></div><small>高于该天数标记为低周转</small></label><label><span>呆滞库存判定</span><div><input defaultValue="90" /><em>天</em></div><small>用于生成滞销清理清单</small></label></div></div><div className="form-section"><h3>自动化规则</h3>{[["自动生成补货建议", "每天根据销量和在途数量计算建议补货", 0], ["库存异常钉钉提醒", "紧急缺货与高货值呆滞库存自动推送", 1], ["允许负库存", "导入销售数据时允许库存出现负数", 2]].map((item) => <div className="toggle-row" key={item[0]}><div><strong>{item[0]}</strong><small>{item[1]}</small></div><button onClick={() => toggle(item[2] as number)} className={`toggle ${toggles[item[2] as number] ? "on" : ""}`}><i /></button></div>)}</div><footer className="form-actions"><span>上次保存：今天 09:18，管理员</span><button className="primary-button">保存设置</button></footer></article>
      </section>
    </>
  );
}

const viewMap: Record<ModuleKey, (props: { range: SalesRangeLabel; customStartDate: string; customEndDate: string }) => React.ReactNode> = {
  dashboard: DashboardView,
  shop: ShopView,
  sales: SalesView,
  inventory: InventoryView,
  product: ProductView,
  workflow: WorkflowView,
  import: ImportView,
  settings: SettingsView,
};

export default function Home() {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [active, setActive] = useState<ModuleKey>("dashboard");
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [range, setRange] = useState<SalesRangeLabel>("本月");
  const [customStartDate, setCustomStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [customEndDate, setCustomEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [searchOpen, setSearchOpen] = useState(false);
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

  const current = navItems.find((item) => item.key === active) ?? navItems[0];
  const View = viewMap[active];

  const selectModule = (key: ModuleKey) => {
    setActive(key);
    setMobileMenu(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
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
          {navItems.slice(0, 6).map((item) => <button key={item.key} title={item.label} className={active === item.key ? "active" : ""} onClick={() => selectModule(item.key)}><span className="nav-icon">{item.short}</span><span className="nav-copy"><b>{item.label}</b><small>{item.description}</small></span>{item.badge && <em>{item.badge}</em>}</button>)}
          <p>系统管理</p>
          {navItems.slice(6).map((item) => <button key={item.key} title={item.label} className={active === item.key ? "active" : ""} onClick={() => selectModule(item.key)}><span className="nav-icon">{item.short}</span><span className="nav-copy"><b>{item.label}</b><small>{item.description}</small></span></button>)}
        </nav>
        <div className="sidebar-help"><span>?</span><div><strong>需要帮助？</strong><small>查看使用指南</small></div></div>
        <div className="sidebar-user"><span>{avatarText}</span><div><strong>{currentUser ? `${currentUser.displayName} · ${currentUser.roleLabel}` : "访客 · 只读查看者"}</strong><small>{currentUser ? currentUser.email : "可查看经营数据"}</small></div><button onClick={() => window.location.assign(currentUser ? "/signout-with-chatgpt?return_to=%2F" : "/signin-with-chatgpt?return_to=%2F")} aria-label={currentUser ? "退出登录" : "管理员登录"}>{currentUser ? "⋮" : "登录"}</button></div>
      </aside>
      {mobileMenu && <button className="mobile-overlay" onClick={() => setMobileMenu(false)} aria-label="关闭导航" />}

      <section className="workspace">
        <header className="topbar">
          <div className="title-area"><button className="mobile-menu-button" onClick={() => setMobileMenu(true)}>☰</button><div><span>运营中心 / {current.label}</span><h1>{current.description}</h1></div></div>
          <div className="topbar-actions">
            <button className="global-search" onClick={() => setSearchOpen(true)}><span>⌕</span><em>搜索货品、订单或功能</em><kbd>⌘ K</kbd></button>
            <button className="icon-button" aria-label="消息通知">♢<i>3</i></button>
            <div className={`date-selector ${range === "自定义" ? "date-selector-custom" : ""}`}>
              <span>统计周期</span>
              <select value={range} onChange={(e) => setRange(e.target.value as SalesRangeLabel)}><option>今日</option><option>近7天</option><option>本月</option><option>本季度</option><option>自定义</option></select>
              {range === "自定义" && <div className="custom-date-range" aria-label="自定义统计周期">
                <input type="date" value={customStartDate} max={customEndDate} onChange={(event) => setCustomStartDate(event.target.value)} aria-label="开始日期" />
                <span>至</span>
                <input type="date" value={customEndDate} min={customStartDate} onChange={(event) => setCustomEndDate(event.target.value)} aria-label="结束日期" />
              </div>}
            </div>
          </div>
        </header>

        <div className="content">
          <div className="page-intro"><div><p>{active === "dashboard" ? "经营数据中心" : current.label}</p><h2>{current.description}</h2><span>{active === "sales" ? `${range} · 数据来自已导入销售明细` : active === "inventory" ? "最新库存快照 · 近 30 日销售需求自动联动" : active === "product" ? "商品价格、成本、费用与库存随已导入数据实时汇总" : active === "import" ? "导入批次实时记录，销售分析自动更新" : "业务数据视图 · 以系统最近同步为准"}</span></div><div className="intro-actions"><button className="secondary-button">↗ 导出报表</button>{active !== "dashboard" && active !== "settings" && active !== "sales" && active !== "inventory" && active !== "product" && active !== "import" && <button className="primary-button">＋ 新建</button>}</div></div>
          <View range={range} customStartDate={customStartDate} customEndDate={customEndDate} />
          <footer className="page-footer"><span>TERUISI 电商运营中台 · 业务数据中心</span><span>销售分析以最近成功导入批次为准</span></footer>
        </div>
      </section>

      {searchOpen && <div className="modal-backdrop" onClick={() => setSearchOpen(false)}><div className="search-modal" onClick={(event) => event.stopPropagation()}><div className="modal-search">⌕<input autoFocus placeholder="搜索货品、订单或功能…" /><button onClick={() => setSearchOpen(false)}>ESC</button></div><p>快速访问</p><div className="quick-links">{navItems.slice(0, 5).map((item) => <button key={item.key} onClick={() => { selectModule(item.key); setSearchOpen(false); }}><span>{item.short}</span><div><strong>{item.label}</strong><small>{item.description}</small></div><em>↗</em></button>)}</div></div></div>}
    </main>
  );
}
