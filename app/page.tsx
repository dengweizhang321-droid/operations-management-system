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
  grossMarginRate: number;
  shareRate: number;
  orderCount: number;
  lineCount: number;
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
  latestBatch?: {
    id: string;
    fileName: string;
    completedAt?: string | null;
  } | null;
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
const MAX_IMPORT_FILE_SIZE = 60 * 1024 * 1024;
const SALES_UPLOAD_CHUNK_SIZE = 2 * 1024 * 1024;

const navItems: NavItem[] = [
  { key: "dashboard", label: "BI 看板", short: "BI", description: "经营驾驶舱" },
  { key: "shop", label: "网店分析", short: "店", description: "多平台经营分析" },
  { key: "sales", label: "销售分析", short: "销", description: "利润与渠道表现" },
  { key: "inventory", label: "库存管理", short: "库", description: "库存健康与备货", badge: "12" },
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
const rateAsPercent = (value = 0) => Math.abs(value) <= 1 ? value * 100 : value;
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

const inventoryRows = [
  { sku: "TRS-CM-2407", name: "云感轻柔乳霜 50g", warehouse: "上海一号仓", stock: 128, days: 6, status: "紧急补货", tone: "danger" },
  { sku: "TRS-SM-1182", name: "净透焕亮精华液 30ml", warehouse: "京东华东 RDC", stock: 246, days: 11, status: "建议补货", tone: "warning" },
  { sku: "TRS-MK-0316", name: "深润修护面膜 10片", warehouse: "广州二号仓", stock: 864, days: 58, status: "低周转", tone: "purple" },
  { sku: "TRS-CL-0928", name: "氨基酸洁面慕斯 150ml", warehouse: "京东华北 RDC", stock: 1524, days: 32, status: "库存健康", tone: "success" },
  { sku: "TRS-ES-2011", name: "塑颜紧致眼霜 20g", warehouse: "上海一号仓", stock: 97, days: 4, status: "紧急补货", tone: "danger" },
];

const products = [
  { sku: "TRS-SM-1182", name: "净透焕亮精华液 30ml", category: "面部精华", price: 269, cost: 76.4, margin: "48.6%", sales: 684200 },
  { sku: "TRS-CM-2407", name: "云感轻柔乳霜 50g", category: "面霜", price: 239, cost: 68.2, margin: "46.1%", sales: 521600 },
  { sku: "TRS-MK-0316", name: "深润修护面膜 10片", category: "面膜", price: 159, cost: 42.8, margin: "43.7%", sales: 446300 },
  { sku: "TRS-CL-0928", name: "氨基酸洁面慕斯 150ml", category: "洁面", price: 129, cost: 31.6, margin: "41.9%", sales: 318900 },
  { sku: "TRS-ES-2011", name: "塑颜紧致眼霜 20g", category: "眼部护理", price: 299, cost: 88.5, margin: "45.3%", sales: 287400 },
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

function SalesView({ range, customStartDate, customEndDate }: { range: SalesRangeLabel; customStartDate: string; customEndDate: string }) {
  const apiRange = salesRangeMap[range];
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
        const payload = await response.json().catch(() => null) as (SalesSummaryResponse & { message?: string }) | null;
        if (!response.ok) throw new Error(payload?.message || `销售汇总读取失败（${response.status}）`);
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

  if (loading) {
    return (
      <section className="panel data-state sales-data-state" role="status" aria-live="polite">
        <span className="state-spinner" aria-hidden="true" />
        <strong>正在读取{range}销售数据</strong>
        <p>正在汇总销售额、毛利与渠道构成…</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="panel data-state sales-data-state data-state-error" role="alert">
        <span className="state-symbol" aria-hidden="true">!</span>
        <strong>销售数据加载失败</strong>
        <p>{error}</p>
        <button className="secondary-button" onClick={() => setRetryKey((key) => key + 1)}>重新加载</button>
      </section>
    );
  }

  if (!hasData || !current) {
    return (
      <section className="panel data-state sales-data-state">
        <span className="state-symbol" aria-hidden="true">∅</span>
        <strong>{range}暂无销售数据</strong>
        <p>请先在“数据导入”中上传吉客云销售单明细账，或切换其他统计周期。</p>
      </section>
    );
  }

  const rangeNote = summary?.startDate && summary?.endDate
    ? `${summary.startDate} 至 ${summary.endDate}`
    : `${range}实时汇总`;

  return (
    <>
      <div className="subnav"><button className="active">销售总览</button><button>渠道分析</button><button>财报分析</button><button>参数配置</button></div>
      <div className="sales-period-note">
        <span><Dot tone="green" />已加载真实明细</span>
        <strong>{rangeNote}</strong>
        {summary?.latestBatch?.fileName && <small>最近批次：{summary.latestBatch.fileName}</small>}
      </div>
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
    </>
  );
}

function InventoryView() {
  return (
    <>
      <div className="subnav"><button className="active">库存总览</button><button>库龄分析</button><button>备货计划</button><button>滞销清理</button></div>
      <section className="metrics-grid">
        <MetricCard label="库存总货值" value="¥ 2,684,700" change="3.1%" hint="共 18,642 件商品" tone="blue" />
        <MetricCard label="库存周转天数" value="31.6 天" change="-2.4%" hint="周转效率持续改善" tone="green" />
        <MetricCard label="待补货货品" value="12 个" change="20.0%" hint="其中 5 个需要紧急处理" tone="orange" />
        <MetricCard label="低周转货值" value="¥ 386,200" change="-5.8%" hint="占库存总额 14.4%" tone="purple" />
      </section>
      <section className="panel table-panel">
        <div className="table-toolbar"><div><h2>库存健康明细</h2><p>自有仓与京东 RDC 库存统一监控</p></div><button className="primary-button">＋ 新建备货计划</button></div>
        <div className="filter-row"><div className="search-box compact">⌕ <input placeholder="搜索货品编号或名称" /></div><button className="filter-button">全部仓库⌄</button><button className="filter-button">全部状态⌄</button><button className="filter-button">导出明细</button></div>
        <div className="data-table-wrap"><table className="data-table"><thead><tr><th>货品</th><th>所在仓库</th><th>可用库存</th><th>预计可售</th><th>库存状态</th><th>建议操作</th></tr></thead>
          <tbody>{inventoryRows.map((row) => <tr key={row.sku}><td><div className="product-cell"><span className="product-thumb">{row.name[0]}</span><span><strong>{row.name}</strong><small>{row.sku}</small></span></div></td><td>{row.warehouse}</td><td><strong>{row.stock.toLocaleString()}</strong> 件</td><td>{row.days} 天</td><td><span className={`status status-${row.tone}`}><Dot tone={row.tone === "danger" ? "red" : row.tone === "warning" ? "orange" : row.tone} />{row.status}</span></td><td><button className="row-action">{row.tone === "danger" || row.tone === "warning" ? "创建补货" : "查看详情"}</button></td></tr>)}</tbody>
        </table></div>
      </section>
    </>
  );
}

function ProductView() {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => products.filter((p) => `${p.name}${p.sku}${p.category}`.toLowerCase().includes(query.toLowerCase())), [query]);
  return (
    <>
      <div className="subnav"><button className="active">货品查询</button><button>毛利测算</button><button>参数查询</button><button>参数配置</button></div>
      <section className="product-search-hero"><div><span className="eyebrow">统一商品中心</span><h2>快速查询货品经营信息</h2><p>整合销售、成本、库存与平台商品映射，一处查看完整数据。</p></div><div className="hero-search">⌕<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="输入货品编号、名称或品类" /><button>查询</button></div></section>
      <section className="panel table-panel">
        <div className="table-toolbar"><div><h2>货品列表</h2><p>共收录 286 个有效货品</p></div><button className="secondary-button">批量导出</button></div>
        <div className="data-table-wrap"><table className="data-table"><thead><tr><th>货品信息</th><th>品类</th><th>建议零售价</th><th>最新成本</th><th>实际毛利率</th><th>近30日销售额</th><th></th></tr></thead><tbody>
          {filtered.map((row) => <tr key={row.sku}><td><div className="product-cell"><span className="product-thumb gradient-thumb">{row.name[0]}</span><span><strong>{row.name}</strong><small>{row.sku}</small></span></div></td><td><span className="soft-tag">{row.category}</span></td><td>¥ {row.price}</td><td>¥ {row.cost}</td><td className="green-text"><strong>{row.margin}</strong></td><td><strong>{formatCurrency(row.sales)}</strong></td><td><button className="row-action">查看详情</button></td></tr>)}
        </tbody></table></div>
      </section>
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
        title: "文件超过 60MB",
        message: `当前文件为 ${formatFileSize(candidate.size)}。单个销售明细账最大支持 60MB。`,
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
          <span className="eyebrow">第 2 步</span><h2>上传报表文件</h2><p>仅支持 .xlsx，单文件最大 60MB；超过 2MB 会自动按 2MB 分片上传，网络中断后可续传。</p>
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
  const [active, setActive] = useState<ModuleKey>("dashboard");
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [range, setRange] = useState<SalesRangeLabel>("本月");
  const [customStartDate, setCustomStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [customEndDate, setCustomEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [searchOpen, setSearchOpen] = useState(false);
  const current = navItems.find((item) => item.key === active) ?? navItems[0];
  const View = viewMap[active];

  const selectModule = (key: ModuleKey) => {
    setActive(key);
    setMobileMenu(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

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
        <div className="sidebar-user"><span>林</span><div><strong>林晓 · 管理员</strong><small>拥有全部模块权限</small></div><button>⋮</button></div>
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
          <div className="page-intro"><div><p>{active === "dashboard" ? "经营数据中心" : current.label}</p><h2>{current.description}</h2><span>{active === "sales" ? `${range} · 数据来自已导入销售明细` : active === "import" ? "导入批次实时记录，销售分析自动更新" : "业务数据视图 · 以系统最近同步为准"}</span></div><div className="intro-actions"><button className="secondary-button">↗ 导出报表</button>{active !== "dashboard" && active !== "settings" && active !== "sales" && active !== "import" && <button className="primary-button">＋ 新建</button>}</div></div>
          <View range={range} customStartDate={customStartDate} customEndDate={customEndDate} />
          <footer className="page-footer"><span>TERUISI 电商运营中台 · 业务数据中心</span><span>销售分析以最近成功导入批次为准</span></footer>
        </div>
      </section>

      {searchOpen && <div className="modal-backdrop" onClick={() => setSearchOpen(false)}><div className="search-modal" onClick={(event) => event.stopPropagation()}><div className="modal-search">⌕<input autoFocus placeholder="搜索货品、订单或功能…" /><button onClick={() => setSearchOpen(false)}>ESC</button></div><p>快速访问</p><div className="quick-links">{navItems.slice(0, 5).map((item) => <button key={item.key} onClick={() => { selectModule(item.key); setSearchOpen(false); }}><span>{item.short}</span><div><strong>{item.label}</strong><small>{item.description}</small></div><em>↗</em></button>)}</div></div></div>}
    </main>
  );
}
