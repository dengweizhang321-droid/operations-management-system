import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import JdLogisticsView from "../../app/jd-logistics-view";
import Cwarehouse from "../../app/jd-logistics-cwarehouse-view";
import { canonicalizeJdLogisticsLocation, readJdLogisticsLocation, type JdLogisticsOptions, type JdLogisticsList, type JdCwarehouseTab } from "../../lib/inventory/jd-logistics-contract";
import type { CwarehouseProductMonitor } from "../../app/jd-logistics-product-matrix";
import type { CurrentUser } from "../../app/module-view-shared";

type Snapshot = { options: JdLogisticsOptions; lists: Record<string, JdLogisticsList>; matrices: Record<string, CwarehouseProductMonitor>; catalog: { code: string; name: string }[] };
const data = JSON.parse(document.getElementById("offline-data")!.textContent!) as Snapshot;
const department = "synthetic-matrix-dept";
window.fetch = async (input, init) => {
  if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (url.pathname !== "/api/inventory/jd-logistics" || method !== "GET") return Response.json({ success: false, error: "离线HTML不执行真实导入、保存或推送。" }, { status: 403 });
  const operation = url.searchParams.get("operation"); let value: unknown;
  if (operation === "options") value = data.options;
  else if (operation === "inventory_monitor") {
    const q = (url.searchParams.get("q") ?? "").toLocaleLowerCase();
    const mask = data.catalog.reduce((bits, item, index) => `${item.code} ${item.name}`.toLocaleLowerCase().includes(q) ? bits | (1 << index) : bits, 0);
    value = data.matrices[JSON.stringify([url.searchParams.get("warehouseKey") ?? "", Number(url.searchParams.get("salesWindow")) === 7 ? 7 : 30, mask])];
  } else {
    const list = data.lists[operation ?? ""] ? structuredClone(data.lists[operation ?? ""]) : null;
    if (list && Array.isArray(list.items)) {
      const q = (url.searchParams.get("q") ?? "").toLocaleLowerCase(), warehouse = url.searchParams.get("warehouseCode");
      list.items = list.items.filter(row => (!q || JSON.stringify(row).toLocaleLowerCase().includes(q)) && (!warehouse || row.warehouseCode === warehouse));
      list.total = list.items.length; list.page = 1;
    }
    value = list;
  }
  return value ? Response.json({ success: true, data: structuredClone(value) }) : Response.json({ success: false, error: "该范围没有离线合成快照" }, { status: 400 });
};

function initializeLocation() {
  const url = new URL(location.href);
  if (!url.searchParams.has("module")) { url.searchParams.set("module", "inventory"); url.searchParams.set("view", "inbound"); }
  if (!url.searchParams.has("jdDepartment")) url.searchParams.set("jdDepartment", department);
  try { history.replaceState(null, "", canonicalizeJdLogisticsLocation(url.href)); } catch { /* Browser file history may be restricted. */ }
}
initializeLocation();
// This synthetic actor reveals the existing forms; document submit capture,
// the in-memory GET-only adapter and CSP independently prevent real writes.
const user = { id: "offline-demo", email: "offline@example.invalid", displayName: "离线演示", role: "admin", scope: null } as unknown as CurrentUser;
type Target = { module: "inventory"; inbound: "pop" | "cwarehouse"; cTab?: JdCwarehouseTab } | { module: "import"; view: "files" | "history" } | { module: "workflow" };

function App() {
  const [route, setRoute] = useState(() => readJdLogisticsLocation(location.href));
  const [workflow, setWorkflow] = useState(new URL(location.href).searchParams.get("module") === "n8n_workflows");
  const [notice, setNotice] = useState("");
  const restore = useCallback(() => { setRoute(readJdLogisticsLocation(location.href)); setWorkflow(new URL(location.href).searchParams.get("module") === "n8n_workflows"); }, []);
  const navigate = useCallback((target: Target) => {
    const url = new URL(location.href), p = url.searchParams;
    const before = readJdLogisticsLocation(url.href), wasWorkflow = p.get("module") === "n8n_workflows";
    if (target.module === "workflow" && wasWorkflow) return;
    if (!wasWorkflow && target.module === "import" && before.workspace === "import" && target.view === before.importView) return;
    if (!wasWorkflow && target.module === "inventory" && before.workspace === "inventory" && target.inbound === before.inbound && (!target.cTab || target.cTab === before.cTab)) return;
    p.set("jdDepartment", department); p.set("jdPage", "1");
    for (const key of ["jdWarehouse", "jdQuery", "jdStart", "jdEnd"]) p.delete(key);
    if (target.module === "inventory") {
      p.set("module", "inventory"); p.set("view", "inbound"); p.set("jdInbound", target.inbound); p.delete("jdImport");
      if (target.inbound === "pop") { p.set("jdPopTab", "mappings"); p.delete("jdCTab"); }
      else { p.set("jdCTab", target.cTab ?? "monitor"); p.delete("jdPopTab"); }
    } else if (target.module === "import") {
      p.set("module", "import"); p.set("view", target.view); p.set("jdImport", "logistics");
      for (const key of ["jdInbound", "jdCTab", "jdPopTab"]) p.delete(key);
    } else { p.set("module", "n8n_workflows"); p.set("view", "jd_logistics"); }
    history.pushState(null, "", canonicalizeJdLogisticsLocation(url.href)); setNotice(""); restore(); window.dispatchEvent(new PopStateEvent("popstate"));
  }, [restore]);
  useEffect(() => {
    const handleLink = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest("a") : null; if (!anchor) return;
      event.preventDefault(); event.stopPropagation();
      const target = readJdLogisticsLocation(new URL(anchor.getAttribute("href") ?? "/", location.href).href);
      navigate(target.workspace === "import" ? { module: "import", view: target.importView } : { module: "inventory", inbound: target.inbound, cTab: target.cTab });
    };
    const blockSubmit = (event: Event) => { const form = event.target; if (!(form instanceof HTMLFormElement) || !form.querySelector('input[type="file"],button[type="submit"]')) return; event.preventDefault(); event.stopPropagation(); setNotice("离线HTML仅展示表单；保存、文件导入和推送均不会执行。"); };
    window.addEventListener("popstate", restore); document.addEventListener("click", handleLink, true); document.addEventListener("submit", blockSubmit, true);
    return () => { window.removeEventListener("popstate", restore); document.removeEventListener("click", handleLink, true); document.removeEventListener("submit", blockSubmit, true); };
  }, [navigate, restore]);
  const imported = !workflow && route.workspace === "import";
  return <div className="app-shell top-navigation-shell offline-shell">
    <header className="shell-masthead"><nav className="offline-mainnav" aria-label="系统导航">{["AI 对话", "运营事务", "自动化中心", "BI 看板", "网店分析", "市场分析", "客服分析", "销售分析", "库存管理", "商品经营", "数据导入", "系统设置"].map(label => label === "库存管理" || label === "数据导入" || label === "自动化中心" ? <button key={label} className={(label === "库存管理" && !imported && !workflow) || (label === "数据导入" && imported) || (label === "自动化中心" && workflow) ? "selected" : ""} onClick={() => navigate(label === "数据导入" ? { module: "import", view: "files" } : label === "自动化中心" ? { module: "workflow" } : { module: "inventory", inbound: "pop" })}>{label}</button> : <span key={label}>{label}</span>)}</nav><span className="offline-badge">离线HTML · 合成数据</span></header>
    <main className="workspace offline-workspace">
      {!workflow && (imported ? <nav className="subnav outlet-subnav offline-parent" aria-label="数据导入子版块"><button className={route.importView === "files" ? "active" : ""} onClick={() => navigate({ module: "import", view: "files" })}>文件导入</button><button className={route.importView === "history" ? "active" : ""} onClick={() => navigate({ module: "import", view: "history" })}>运行记录</button></nav> : <><nav className="subnav outlet-subnav offline-parent" aria-label="库存管理子版块">{["库存总览", "库龄分析", "备货计划", "滞销清理", "京东入仓监控", "广东入仓监控"].map(label => <span key={label} className={label === "京东入仓监控" ? "active" : ""}>{label}</span>)}</nav><nav className="subnav outlet-subnav offline-sources" aria-label="京东入仓监控来源"><button role="tab" aria-selected={route.inbound === "pop"} className={route.inbound === "pop" ? "active" : ""} onClick={() => navigate({ module: "inventory", inbound: "pop" })}>京东 POP</button><button role="tab" aria-selected={route.inbound === "cwarehouse"} className={route.inbound === "cwarehouse" ? "active" : ""} onClick={() => navigate({ module: "inventory", inbound: "cwarehouse" })}>C仓监控</button></nav></>)}
      <div className="offline-note">样式、脚本与合成样例均已内嵌，可直接打开。此HTML不连接后台，不执行真实导入、保存、采集或推送。</div>
      {notice && <div className="inventory-feedback" role="status">{notice}</div>}
      {workflow ? <section className="panel offline-workflow"><h2>京东物流四源工作流说明</h2><p>原系统工作流为未发布草稿，此处只展示流程。</p><div className="offline-steps">{[["A", "冻结来源与日期", "核对事业部、来源能力、采集范围及执行所有者"], ["B", "下载、校验、导入", "库存流水 / 店铺商品 / C仓实时库存 / 分仓快照"], ["C", "精确批次回查", "核对原文件、内容摘要、行数及当前有效批次"], ["D", "缺货提醒", "按固定30日可用库存可售天数判断，结果未知不重发"]].map(([n, title, note]) => <article key={n}><strong>{n}</strong><h3>{title}</h3><p>{note}</p></article>)}</div></section>
        : imported ? <JdLogisticsView key={`import:${route.importView}`} currentUser={user} fixedTab="batches" presentation={route.importView === "history" ? "records" : "import"} />
          : route.inbound === "pop" ? <JdLogisticsView key="pop:mappings" currentUser={user} fixedTab="mappings" presentation="table" />
            : <Cwarehouse key="cwarehouse" currentUser={user} />}
      <footer className="offline-footer">TERUISI 京东物流 · 2026-10-15 · 缺货依据：可用库存 ÷ 近30日销售出库件数 × 30</footer>
    </main>
  </div>;
}
createRoot(document.getElementById("app")!).render(<App />);
