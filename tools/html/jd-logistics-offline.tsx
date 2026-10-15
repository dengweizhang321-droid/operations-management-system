import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import JdLogisticsView from "../../app/jd-logistics-view";
import InboundMonitor from "../../app/jd-logistics-cwarehouse-view";
import { canonicalizeJdLogisticsLocation, readJdLogisticsLocation, type JdLogisticsOptions, type JdLogisticsList } from "../../lib/inventory/jd-logistics-contract";
import type { CwarehouseProductMonitor } from "../../app/jd-logistics-product-matrix";
import type { CurrentUser } from "../../app/module-view-shared";

type Aggregate = Pick<CwarehouseProductMonitor, "totals" | "summary">;
type Snapshot = {
  options: JdLogisticsOptions; lists: Record<string, JdLogisticsList>; matrices: Record<string, CwarehouseProductMonitor>; catalog: { code: string; name: string }[];
  provenance?: { mode: "local-files"; departmentId: string; notes: string[]; sources: { kind: string; fileName: string; rows: number; startDate: string; endDateExclusive: string; collectedAt: string }[] };
  aggregateValues?: Aggregate[]; searchScopes?: Record<string, Record<string, number>>; transferScopes?: Record<string, JdLogisticsList>;
  replenishmentPreviews?: Record<string, Record<string, { quantity: number | null; days: number | null; cycles: number[]; reasons: string[] }>>;
};

async function loadSnapshot(): Promise<Snapshot> {
  const element = document.getElementById("offline-data")!;
  if (element.dataset.compression !== "gzip-base64") return JSON.parse(element.textContent!);
  const bytes = Uint8Array.from(atob(element.textContent!), character => character.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(stream).text());
}

function start(data: Snapshot) {
  const real = data.provenance?.mode === "local-files";
  const department = data.options.departments[0].id;
  window.fetch = async (input, init) => {
    if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    // Resolve virtual API paths without inheriting a Windows file URL's drive.
    // This origin is a parser base only; this adapter never performs a network fetch.
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "https://offline.invalid");
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (url.pathname !== "/api/inventory/jd-logistics" || method !== "GET") return Response.json({ success: false, error: "离线HTML不执行导入、保存、采集或推送。" }, { status: 403 });
    if (url.searchParams.has("departmentId") && url.searchParams.get("departmentId") !== department) return Response.json({ success: false, error: "文件不包含该事业部范围" }, { status: 403 });
    const operation = url.searchParams.get("operation"), q = (url.searchParams.get("q") ?? "").toLowerCase();
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1), pageSize = Math.min(20000, Math.max(1, Number(url.searchParams.get("pageSize")) || 25));
    let value: unknown;
    if (operation === "options") value = data.options;
    else if (operation === "inventory_monitor") {
      const warehouse = url.searchParams.get("warehouseKey") ?? "", windowDays = Number(url.searchParams.get("salesWindow")) === 7 ? 7 : 30;
      if (real) {
        const scope = JSON.stringify([warehouse, windowDays]), base = data.matrices[scope];
        if (base) {
          const matches = new Set(data.catalog.filter(item => `${item.code} ${item.name}`.toLowerCase().includes(q)).map(item => item.code));
          const items = base.items.filter(item => matches.has(item.goodsCode));
          const scopeCodes = new Set(items.map(item => item.goodsCode));
          const mask = data.catalog.reduce((bits, item, index) => scopeCodes.has(item.code) ? bits | (BigInt(1) << BigInt(index)) : bits, BigInt(0)).toString(16);
          const aggregateId = data.searchScopes?.[scope]?.[mask];
          const aggregate = aggregateId === undefined ? undefined : data.aggregateValues?.[aggregateId];
          if (!aggregate) return Response.json({ success: false, error: "该搜索范围的后台汇总快照缺失，请清空搜索。" }, { status: 400 });
          const columns = new Set(items.flatMap(item => item.cells.map(cell => cell.columnKey)));
          value = { ...base, ...aggregate, items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize, columns: base.columns.filter(column => columns.has(column.key)) };
        }
      } else {
        const mask = data.catalog.reduce((bits, item, index) => `${item.code} ${item.name}`.toLowerCase().includes(q) ? bits | (1 << index) : bits, 0);
        value = data.matrices[JSON.stringify([warehouse, windowDays, mask])];
      }
    } else {
      const warehouseScope = url.searchParams.get("warehouseCode") ?? "";
      const source = real && operation === "transfers" ? data.transferScopes?.[warehouseScope] : data.lists[operation ?? ""];
      const list = source ? structuredClone(source) : null;
      if (list && Array.isArray(list.items)) {
        const warehouse = url.searchParams.get("warehouseCode"), startDate = url.searchParams.get("startDate"), endDate = url.searchParams.get("endDate");
        list.items = list.items.filter(row => {
          const day = String(row.businessTime ?? row.lastBusinessTime ?? "").slice(0, 10);
          const searchText = [row.goodsCode, row.goodsName, row.documentNo].join(" ").toLowerCase();
          return (!q || searchText.includes(q)) && (!warehouse || operation === "transfers" && real || row.warehouseCode === warehouse) && (!startDate || !day || day >= startDate) && (!endDate || !day || day < endDate);
        });
        list.total = list.items.length; list.items = list.items.slice((page - 1) * pageSize, page * pageSize); list.page = page; list.pageSize = pageSize;
      }
      value = list;
    }
    if (!value) return Response.json({ success: false, error: "该范围没有离线文件快照" }, { status: 400 });
    const projected = structuredClone(value);
    if (real && operation === "inventory_monitor" && data.replenishmentPreviews) {
      const cycle = url.searchParams.get("replenishmentCycleDays") ?? "30", preview = data.replenishmentPreviews[cycle];
      if (!preview) return Response.json({ success: false, error: "该周期没有离线试算结果，请选择列表中的周期。" }, { status: 400 });
      const apply = (object: unknown) => {
        if (!object || typeof object !== "object") return;
        if (Array.isArray(object)) { object.forEach(apply); return; }
        const row = object as Record<string, unknown>;
        if (typeof row.replenishmentPreviewKey === "string") {
          const selected = preview[row.replenishmentPreviewKey];
          if (!selected) throw new Error("补货试算范围缺失");
          row.suggestedReplenishmentQuantity = selected.quantity; row.replenishmentCycleDays = selected.days; row.replenishmentCycleDaysValues = selected.cycles;
          (row.metricQualifications as Record<string, string[]>).suggestedReplenishmentQuantity = selected.reasons;
        }
        Object.values(row).forEach(apply);
      };
      apply(projected);
    }
    return Response.json({ success: true, data: projected });
  };
  const initial = new URL(location.href);
  if (!initial.searchParams.has("module")) { initial.searchParams.set("module", "inventory"); initial.searchParams.set("view", "inbound"); }
  initial.searchParams.set("jdDepartment", department);
  try { history.replaceState(null, "", canonicalizeJdLogisticsLocation(initial.href)); } catch { /* Some file browsers restrict history replacement. */ }
  // Local display identity only. It is never sent to an operating service.
  const user = { id: "offline-viewer", email: "offline@example.invalid", displayName: "文件快照", role: real ? "viewer" : "admin", scope: null } as unknown as CurrentUser;
  type Target = { module: "inventory" } | { module: "import"; view: "files" | "history" } | { module: "workflow" };
  const readCycle = () => { const value = new URL(location.href).searchParams.get("jdReplenishmentDays") ?? "30"; return data.replenishmentPreviews?.[value] ? Number(value) : 30; };

  function App() {
    const [route, setRoute] = useState(() => readJdLogisticsLocation(location.href));
    const [workflow, setWorkflow] = useState(new URL(location.href).searchParams.get("module") === "n8n_workflows");
    const [notice, setNotice] = useState("");
    const [cycleDays, setCycleDays] = useState(readCycle);
    const restore = useCallback(() => { setRoute(readJdLogisticsLocation(location.href)); setWorkflow(new URL(location.href).searchParams.get("module") === "n8n_workflows"); setCycleDays(readCycle()); }, []);
    const navigate = useCallback((target: Target) => {
      const url = new URL(location.href), p = url.searchParams;
      const before = readJdLogisticsLocation(url.href), wasWorkflow = p.get("module") === "n8n_workflows";
      if (target.module === "workflow" && wasWorkflow) return;
      if (!wasWorkflow && target.module === "import" && before.workspace === "import" && target.view === before.importView) return;
      if (!wasWorkflow && target.module === "inventory" && before.workspace === "inventory") return;
      p.set("jdDepartment", department); p.set("jdPage", "1");
      for (const key of ["jdWarehouse", "jdQuery", "jdStart", "jdEnd"]) p.delete(key);
      if (target.module === "inventory") { p.set("module", "inventory"); p.set("view", "inbound"); p.set("jdTab", "monitor"); p.delete("jdImport"); }
      else if (target.module === "import") { p.set("module", "import"); p.set("view", target.view); p.set("jdImport", "logistics"); p.delete("jdTab"); }
      else { p.set("module", "n8n_workflows"); p.set("view", "jd_logistics"); }
      history.pushState(null, "", canonicalizeJdLogisticsLocation(url.href)); setNotice(""); restore(); window.dispatchEvent(new PopStateEvent("popstate"));
    }, [restore]);
    useEffect(() => {
      const handleLink = (event: MouseEvent) => {
        if (event.target instanceof Element && event.target.closest('[aria-label="京东入仓监控工作区"] button')) { queueMicrotask(restore); return; }
        const anchor = event.target instanceof Element ? event.target.closest("a") : null; if (!anchor) return;
        event.preventDefault(); event.stopPropagation();
        const target = readJdLogisticsLocation(new URL(anchor.getAttribute("href") ?? "/", location.href).href);
        navigate(target.workspace === "import" ? { module: "import", view: target.importView } : { module: "inventory" });
      };
      const blockSubmit = (event: Event) => { const form = event.target; if (!(form instanceof HTMLFormElement) || !form.querySelector('input[type="file"],button[type="submit"]')) return; event.preventDefault(); event.stopPropagation(); setNotice("离线HTML仅展示文件快照；保存、文件导入和推送均不会执行。"); };
      window.addEventListener("popstate", restore); document.addEventListener("click", handleLink, true); document.addEventListener("submit", blockSubmit, true);
      return () => { window.removeEventListener("popstate", restore); document.removeEventListener("click", handleLink, true); document.removeEventListener("submit", blockSubmit, true); };
    }, [navigate, restore]);
    const imported = !workflow && route.workspace === "import";
    return <div className="app-shell top-navigation-shell offline-shell">
      <header className="shell-masthead"><nav className="offline-mainnav" aria-label="系统导航">{["AI 对话", "运营事务", "自动化中心", "BI 看板", "网店分析", "市场分析", "客服分析", "销售分析", "库存管理", "商品经营", "数据导入", "系统设置"].map(label => label === "库存管理" || label === "数据导入" || label === "自动化中心" ? <button key={label} className={(label === "库存管理" && !imported && !workflow) || (label === "数据导入" && imported) || (label === "自动化中心" && workflow) ? "selected" : ""} onClick={() => navigate(label === "数据导入" ? { module: "import", view: "files" } : label === "自动化中心" ? { module: "workflow" } : { module: "inventory" })}>{label}</button> : <span key={label}>{label}</span>)}</nav><span className="offline-badge">离线HTML · {real ? "真实文件快照" : "合成数据"}</span></header>
      <main className="workspace offline-workspace">
        {!workflow && (imported ? <nav className="subnav outlet-subnav offline-parent" aria-label="数据导入子版块"><button className={route.importView === "files" ? "active" : ""} onClick={() => navigate({ module: "import", view: "files" })}>文件导入</button><button className={route.importView === "history" ? "active" : ""} onClick={() => navigate({ module: "import", view: "history" })}>运行记录</button></nav> : <nav className="subnav outlet-subnav offline-parent" aria-label="库存管理子版块">{["库存总览", "库龄分析", "备货计划", "滞销清理", "京东入仓监控", "广东入仓监控"].map(label => <span key={label} className={label === "京东入仓监控" ? "active" : ""}>{label}</span>)}</nav>)}
        <div className="offline-note">{real ? <>真实报表文件快照：实时库存 2026-10-15，销售出库快照截至 2026-10-14。未读取正式ERP对照与导入记录；缺货阈值未配置，当前未判定缺货风险。<details><summary>数据来源与范围</summary>{data.provenance!.sources.map(source => <p key={source.kind}>{source.fileName} · {source.rows} 行</p>)}{data.provenance!.notes.map(note => <p key={note}>{note}</p>)}</details></> : "样式、脚本与合成样例均已内嵌，可直接打开。此HTML不连接后台，不执行真实导入、保存、采集或推送。"}</div>
        {notice && <div className="inventory-feedback" role="status">{notice}</div>}
        {real && !imported && !workflow && route.jdTab === "monitor" && data.replenishmentPreviews && <div className="offline-note offline-cycle-control"><label>补货周期（离线试算） <select aria-label="补货周期离线试算" value={cycleDays} onChange={event => { const value = Number(event.target.value); setCycleDays(value); const url = new URL(location.href); url.searchParams.set("jdReplenishmentDays", String(value)); history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`); }}>{Object.keys(data.replenishmentPreviews).map(value => <option key={value} value={value}>{value}天</option>)}</select></label><span>只在本文件试算，不修改系统设置。正式页面可设置1至3650天。</span></div>}
        {workflow ? <section className="panel offline-workflow"><h2>京东物流四源工作流说明</h2><p>此处仅展示流程，不表示已经执行。</p><div className="offline-steps">{[["A", "冻结来源与日期", "核对事业部、来源能力、采集范围及执行所有者"], ["B", "下载、校验、导入", "库存流水 / 店铺商品 / 实时库存 / 分仓快照"], ["C", "精确批次回查", "核对原文件、内容摘要、行数及当前有效批次"], ["D", "缺货提醒", "按固定30日可用库存可售天数判断，结果未知不重发"]].map(([n, title, note]) => <article key={n}><strong>{n}</strong><h3>{title}</h3><p>{note}</p></article>)}</div></section>
          : imported ? <><JdLogisticsView key={`import:${route.importView}`} currentUser={user} fixedTab="batches" fileSnapshot={real} presentation={route.importView === "history" ? "records" : "import"} />{real && <p className="offline-note">此文件没有查询正式系统导入批次；源文件行数不代表已导入成功。</p>}</>
            : <InboundMonitor key="inbound" currentUser={user} fileSnapshot={real} fileCycleDays={real ? cycleDays : undefined} />}
        <footer className="offline-footer">TERUISI 京东入仓监控 · 2026-10-15 · 缺货依据：可用库存 ÷ 近30日销售出库件数 × 30</footer>
      </main>
    </div>;
  }
  createRoot(document.getElementById("app")!).render(<App />);
}
void loadSnapshot().then(start).catch(() => { document.getElementById("app")!.textContent = "文件快照加载失败；请使用支持 gzip 解压的现代浏览器打开HTML。"; });
