"use client";

import { useEffect, useState } from "react";
import { requestJdLogistics } from "./jd-logistics-view";
import ProductMatrix, { decodeCwarehouseProductMonitor, type CwarehouseProductMonitor } from "./jd-logistics-product-matrix";

export default function JdMonitorInactiveProducts({ count, departmentId, businessUnitCode, warehouseKey, query, salesWindow, refresh, disabled, onMonitoringChange }: {
  count: number; departmentId: string; businessUnitCode: string; warehouseKey: string; query: string;
  salesWindow: 7 | 30; refresh: number; disabled: boolean;
  onMonitoringChange?: (goodsCode: string, enabled: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ page: number; value: CwarehouseProductMonitor } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const result = data?.page === page ? data.value : null;
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ operation: "inventory_monitor", layout: "product", monitoringState: "inactive", healthState: "all",
      departmentId, businessUnitCode, salesWindow: String(salesWindow), page: String(page), pageSize: "25" });
    if (warehouseKey) params.set("warehouseKey", warehouseKey);
    if (query) params.set("q", query);
    setLoading(true); setError("");
    requestJdLogistics<unknown>(params, { signal: controller.signal }).then(value => {
      if (controller.signal.aborted) return;
      const decoded = decodeCwarehouseProductMonitor(value);
      if (decoded.monitoringState !== "inactive" || decoded.healthState !== "all" || decoded.salesWindow !== salesWindow) throw new Error("取消监控列表响应与当前范围不一致");
      setData({ page, value: decoded });
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "取消监控商品读取失败"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, page, departmentId, businessUnitCode, warehouseKey, query, salesWindow, refresh, retry]);
  const toggle = (id: string) => setExpanded(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  return <details className="panel jd-monitor-inactive" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>已取消监控（{count}）<small className="cell-note">展开查看，可重新添加监控</small></summary>
    {open && <div aria-busy={loading}>
      <p>按当前事业部、仓库和搜索显示全部取消项；不参与上方健康筛选、统计和监控提醒。</p>
      {error && <p role="alert" className="jd-logistics-error">{error} <button className="row-action" onClick={() => setRetry(value => value + 1)}>重试</button></p>}
      {result ? <ProductMatrix data={result} expandedIds={expanded} onToggle={toggle} onMonitoringChange={onMonitoringChange} monitoringDisabled={disabled || loading} />
        : <div className="table-state">{loading ? "正在读取已取消监控商品…" : error ? "当前范围无法核实。" : "暂无已取消监控商品。"}</div>}
      {result && <footer className="jd-sku-pagination"><span>{result.total} 个商品 · 第 {page} / {Math.max(1, Math.ceil(result.total / result.pageSize))} 页</span><div>
        <button className="row-action" disabled={loading || page <= 1} onClick={() => { setPage(value => value - 1); setExpanded(new Set()); }}>上一页</button>
        <button className="row-action" disabled={loading || page * result.pageSize >= result.total} onClick={() => { setPage(value => value + 1); setExpanded(new Set()); }}>下一页</button>
      </div></footer>}
    </div>}
  </details>;
}
