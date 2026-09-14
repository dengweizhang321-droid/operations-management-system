"use client";

import { useEffect, useState } from "react";
import type { FinanceTarget } from "./module-view-shared";
import { formatCurrencyFromCents } from "./module-view-shared";
import { requestJson } from "@/lib/http/api-client";

type AnnualShop = {
  key: string; platform: string; shopName: string; manager: string; target: FinanceTarget | null;
  netSalesCents: number | null; profitCents: number | null; salesProgress: number | null; profitProgress: number | null;
  availableMonths: string[]; missingMonths: string[];
};
type AnnualProgress = {
  year: string; cutoffMonth: string | null; missingMonths: string[]; items: AnnualShop[];
  pagination: { total: number; truncated: boolean };
};
const amount = (value: number | null) => value === null ? "暂无财报" : formatCurrencyFromCents(value);
function Progress({ value, target }: { value: number | null; target: number }) {
  return <div className="table-progress"><span><i style={{ width: `${Math.min(100, Math.max(0, (value ?? 0) * 100))}%` }} /></span><small>{target <= 0 ? "未设目标" : value === null ? "暂无财报" : `${(value * 100).toFixed(1)}%`}</small></div>;
}

export default function FinanceAnnualProgressView({ year, refreshKey, canManageTargets, onEdit }: {
  year: string; refreshKey: number; canManageTargets: boolean; onEdit: (row: AnnualShop) => void;
}) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AnnualProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(() => { if (active) { setError("年度进度读取超时，请重试。"); setLoading(false); controller.abort(); } }, 30_000);
    setLoading(true); setError(""); setData(null);
    void requestJson<AnnualProgress>(`/api/finance/targets?view=annual&year=${year}&page=${page}&pageSize=100`, { signal: controller.signal })
      .then((result) => {
        if (!Array.isArray(result.items) || !Array.isArray(result.missingMonths) || !result.pagination || result.year !== year) throw new Error("年度进度响应格式不完整，请重试。");
        if (active && !controller.signal.aborted) setData(result);
      })
      .catch((reason) => { if (active && !controller.signal.aborted) setError(reason instanceof Error ? reason.message : "年度进度读取失败。"); })
      .finally(() => { window.clearTimeout(timeout); if (active && !controller.signal.aborted) setLoading(false); });
    return () => { active = false; window.clearTimeout(timeout); controller.abort(); };
  }, [year, page, refreshKey, retry]);
  return <section className="panel finance-shop-panel" aria-busy={loading}>
    <div className="finance-panel-heading"><div><span className="eyebrow">ANNUAL SHOP TARGETS</span><h2>店铺年度目标进度</h2><p>{year} 年累计实际完成额对照全年目标；销售额采用财报净销售额。</p></div><span className="soft-tag">{data?.cutoffMonth ? `财报截至 ${data.cutoffMonth}` : "暂无财报截止月份"}</span></div>
    {data && data.missingMonths.length > 0 && <p className="inline-feedback warning">缺少财报月份：{data.missingMonths.join("、")}。当前金额仅累计已导入月份。</p>}
    {error && <div className="inline-feedback error" role="alert">{error}<button type="button" className="row-action" onClick={() => setRetry((value) => value + 1)}>重试</button></div>}
    {loading ? <div className="table-state">正在读取年累计进度…</div> : data && <>
      <div className="data-table-wrap"><table className="data-table finance-shop-table" data-column-filter-scope={page === 1 && !data.pagination.truncated ? "full" : "none"}><thead><tr><th>平台 / 店铺</th><th>负责人</th><th>全年销售目标</th><th>年累计销售额</th><th>销售完成率</th><th>全年利润目标</th><th>年累计利润</th><th>利润完成率</th><th>数据覆盖</th>{canManageTargets && <th>操作</th>}</tr></thead><tbody>
        {data.items.map((row) => <tr key={row.key}><td><strong>{row.shopName}</strong><small>{row.platform}</small></td><td>{row.manager || "—"}</td><td>{row.target?.salesTargetCents ? amount(row.target.salesTargetCents) : "未设目标"}</td><td>{amount(row.netSalesCents)}</td><td><Progress value={row.salesProgress} target={row.target?.salesTargetCents ?? 0} /></td><td>{row.target?.profitTargetCents ? amount(row.target.profitTargetCents) : "未设目标"}</td><td>{amount(row.profitCents)}</td><td><Progress value={row.profitProgress} target={row.target?.profitTargetCents ?? 0} /></td><td><small>{row.availableMonths.length ? `已计 ${row.availableMonths.length} 个月` : "暂无财报"}</small>{row.missingMonths.length > 0 && <small title={row.missingMonths.join("、")}>缺 {row.missingMonths.map((month) => Number(month.slice(5))).join("、")} 月</small>}</td>{canManageTargets && <td><button type="button" className="row-action" onClick={() => onEdit(row)}>{row.target ? "编辑目标" : "填写目标"}</button></td>}</tr>)}
        {data.items.length === 0 && <tr><td colSpan={canManageTargets ? 10 : 9}><div className="table-state">该年份暂无店铺财报或年度目标。</div></td></tr>}
      </tbody></table></div>
      {(page > 1 || data.pagination.truncated) && <div className="customer-service-pagination"><button type="button" className="row-action" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>上一页</button><span>第 {page} 页 · 共 {data.pagination.total} 家店铺</span><button type="button" className="row-action" disabled={!data.pagination.truncated} onClick={() => setPage((value) => value + 1)}>下一页</button></div>}
    </>}
  </section>;
}
