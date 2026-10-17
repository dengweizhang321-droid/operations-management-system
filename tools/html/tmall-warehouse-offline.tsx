import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import TmallWarehouseView from "../../app/tmall-warehouse-view";
import { navItems } from "../../app/shell/navigation-catalog";
import { tmallWarehouseQuantityKeys, type TmallWarehouseRow } from "../../lib/inventory/tmall-warehouse-contract";
import type { CurrentUser } from "../../app/module-view-shared";

// Synthetic display fixtures only. No production API, credentials or customer data.
const owner = "合成天猫货主", today = "2026-10-17";
const warehouses = ["合成华南仓", "合成华东仓", "合成华北仓"];
const rows = [0, 1, 2].flatMap(goods => warehouses.map((warehouse, index) => ({
  ...Object.fromEntries(tmallWarehouseQuantityKeys.map(key => [key, null])),
  goodsId: `DEMO-00${goods + 1}`, goodsCode: `SKU-00${goods + 1}`, goodsName: ["合成示例 · 多功能切片机", "合成示例 · 商用绞肉机", "合成示例 · 不锈钢切肉机"][goods],
  warehouse, warehouseCode: `W${index}`, warehouseKey: `code:W${index}`, region: ["华南", "华东", "华北"][index], owner, brand: "合成品牌", snapshotDate: today,
  sourceAttributes: {}, sourceRowNumber: goods * 3 + index + 2,
  availableQuantity: [32, 18, 0][goods] + index * 3, onHandQuantity: [35, 18, 0][goods] + index * 3,
  salesOccupiedQuantity: goods === 0 ? 3 : 0, goodAvailableQuantity: [32, 18, 0][goods] + index * 3, goodOccupiedQuantity: goods === 0 ? 3 : 0, defectiveQuantity: 0,
  purchaseInTransitQuantity: goods === 2 ? 10 : 0, transferInTransitQuantity: index === 0 ? 4 : 0,
  turnoverDays: null, suggestedQuantity: null,
}))) as (TmallWarehouseRow & { warehouseKey: string; turnoverDays: null; suggestedQuantity: null; snapshotDate: string })[];
function totals(source: typeof rows) { return Object.fromEntries(tmallWarehouseQuantityKeys.map(key => [key, source.length && source.every(row => row[key] != null) ? source.reduce((sum, row) => sum + row[key]!, 0) : null])); }
window.fetch = async (input, init) => {
  if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "https://offline.invalid");
  if (url.pathname !== "/api/inventory/tmall-warehouse" || (init?.method ?? "GET") !== "GET") return Response.json({ error: "离线展示不连接后台，也不执行导入或采集。" }, { status: 403 });
  let data;
  if (url.searchParams.get("operation") === "options") data = { owners: [owner], warehouses, scopeRevisions: { [owner]: 0 } };
  else if (url.searchParams.get("operation") === "batches") data = { items: [], total: 0, page: 1, pageSize: 30, returned: 0, truncated: false };
  else {
    const selected = rows.filter(row => (!url.searchParams.get("owner") || row.owner === url.searchParams.get("owner")) && (!url.searchParams.get("warehouse") || row.warehouse === url.searchParams.get("warehouse")) && (!url.searchParams.get("q") || `${row.goodsId} ${row.goodsCode} ${row.goodsName}`.includes(url.searchParams.get("q")!)));
    const codes = [...new Set(selected.map(row => row.goodsId))];
    const products = codes.map(goodsId => { const details = selected.filter(row => row.goodsId === goodsId); return { ...details[0], warehouses: details, totals: totals(details) }; });
    data = { items: products, total: products.length, returned: products.length, page: 1, pageSize: 30, totals: totals(selected), asOf: [{ owner, snapshotDate: today }] };
  }
  return Response.json({ success: true, data });
};
const user = { id: "offline", email: "offline@example.invalid", displayName: "离线样例", role: "viewer", scope: null } as unknown as CurrentUser;
function App() {
  const [workflow, setWorkflow] = useState(false);
  const returnToMonitor = () => { const url = new URL(location.href); url.searchParams.delete("tmView"); history.replaceState(history.state, "", url.href); setWorkflow(false); };
  useEffect(() => {
    const intercept = (event: MouseEvent) => { const anchor = event.target instanceof Element ? event.target.closest("a") : null; if (anchor) { event.preventDefault(); setWorkflow(true); } };
    document.addEventListener("click", intercept); return () => document.removeEventListener("click", intercept);
  }, []);
  return <div className="app-shell top-navigation-shell offline-shell"><header className="shell-masthead"><nav className="offline-mainnav" aria-label="系统导航">{navItems.map(item => <span key={item.key} className={item.key === "inventory" ? "selected" : ""}>{item.label}</span>)}</nav><span className="offline-badge">离线 HTML · 合成数据</span></header><main className="workspace offline-workspace"><div className="subnav inventory-subnav" aria-label="库存管理子版块">{["库存总览", "库龄分析", "备货计划", "滞销清理", "京东入仓监控", "天猫入仓监控", "广东入仓监控"].map(label => <span key={label} className={label === "天猫入仓监控" ? "active" : ""}>{label}</span>)}</div><p className="offline-note">此文件展示正式页面组件和合成样例，可筛选、切换指标、展开分仓。所有数据与脚本已内嵌，不执行真实导入或自动化。真实天猫当前导出没有30天销量，相关列保留暂无依据。</p>{workflow ? <section className="panel"><h2>天猫入仓 n8n 导入工作流</h2><div className="offline-steps">{[["A", "冻结来源", "绑定货主、上海采集日与执行身份"], ["B", "导出并导入", "原始XLSX签收、完整校验与原子导入"], ["C", "精确回查", "核对哈希、行数和当前批次归属"], ["D", "资源收尾", "释放专用浏览器与执行权"]].map(([key, title, text]) => <article key={key}><strong>{key}</strong><h3>{title}</h3><p>{text}</p></article>)}</div><p>工作流默认停用，部署后完成专用会话登录再启用。此文件不代表工作流已经运行。</p><button className="secondary-button" onClick={returnToMonitor}>返回监控</button></section> : <TmallWarehouseView currentUser={user} />}</main></div>;
}
createRoot(document.getElementById("app")!).render(<App />);
