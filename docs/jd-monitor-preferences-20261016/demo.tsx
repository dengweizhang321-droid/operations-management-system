import { useState } from "react";
import { createRoot } from "react-dom/client";
import Workspace from "../../app/jd-logistics-cwarehouse-view";
import AppShell from "../../app/shell/app-shell";
import SidebarNavigation from "../../app/shell/sidebar-navigation";
import type { CurrentUser } from "../../app/module-view-shared";
import type { JdLogisticsOptions } from "../../lib/inventory/jd-logistics-contract";
import type { CwarehouseProductMonitor } from "../../app/jd-logistics-product-matrix";
import "../../app/globals.css";
import "../../app/shell/top-navigation.css";
import "../../app/styles/shared-theme.css";

async function start() {
  const payload = document.getElementById("demo-data")!.textContent!;
  const bytes = Uint8Array.from(atob(payload), character => character.charCodeAt(0));
  const data = JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text()) as { options: JdLogisticsOptions; projections: Record<string, CwarehouseProductMonitor> };
  const department = data.options.departments[0];
  const storageKey = "jd-monitor-synthetic-demo-v1";
  try { const stored = JSON.parse(localStorage.getItem(storageKey) ?? "null"); if (stored) Object.assign(department, stored); } catch { /* File storage can be disabled. */ }
  const reply = (value: unknown, status = 200) => Response.json(status === 200 ? { success: true, data: { contractVersion: "jd-logistics-v1", mode: "live", ...value as object } } : { success: false, error: value }, { status });
  // This replaces fetch completely. No request leaves the file, including writes.
  window.fetch = async (input, init = {}) => {
    const url = new URL(String(input), "https://synthetic.invalid");
    if (url.pathname !== "/api/inventory/jd-logistics") return reply("演示文件不访问网络", 403);
    if (init.method === "PATCH") {
      const body = JSON.parse(String(init.body));
      if (body.expectedRevision !== department.revision) return reply("设置版本已变化，请刷新后重试", 409);
      if (body.warehousePreferences) department.warehousePreferences = body.warehousePreferences;
      if (body.productMove) {
        const order = department.productOrder?.length ? [...department.productOrder] : ["A", "B", "C", "D"];
        const { goodsCode, targetGoodsCode, placement } = body.productMove;
        order.splice(order.indexOf(goodsCode), 1); order.splice(order.indexOf(targetGoodsCode) + (placement === "after" ? 1 : 0), 0, goodsCode); department.productOrder = order;
      }
      if (body.replenishmentCycleDays || body.stockoutThresholdDays !== undefined) return reply("本文件只演示仓库设置与商品排序", 400);
      department.revision += 1;
      try { localStorage.setItem(storageKey, JSON.stringify({ warehousePreferences: department.warehousePreferences, productOrder: department.productOrder, revision: department.revision })); } catch { /* Current session still works. */ }
      return reply(department);
    }
    if ((init.method ?? "GET") !== "GET") return reply("演示文件不执行外部写入", 403);
    if (url.searchParams.get("operation") === "options") return reply(data.options);
    if (url.searchParams.get("operation") !== "inventory_monitor") return reply({ items: [], total: 0, page: 1, pageSize: 25 });
    const preferences = new Map((department.warehousePreferences ?? []).map((row, index) => [row.warehouseKey, { ...row, index }]));
    const warehouse = url.searchParams.get("warehouseKey");
    const warehouseMask = [1, 2, 3].reduce((mask, index) => preferences.get(`code:W${index}`)?.enabled === false || warehouse && warehouse !== `code:W${index}` ? mask : mask | (1 << (index - 1)), 0);
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    const productMask = ["A", "B", "C", "D"].reduce((mask, code, index) => `${code} 合成商品${code}`.toLowerCase().includes(q) ? mask | (1 << index) : mask, 0);
    const matrix = structuredClone(data.projections[`${warehouseMask}:${productMask}:${url.searchParams.get("salesWindow") ?? "30"}:${url.searchParams.get("healthState") ?? "all"}`]);
    const ranks = new Map((department.productOrder ?? []).map((code, index) => [code, index]));
    matrix.items.sort((a, b) => (ranks.get(a.goodsCode) ?? 20000) - (ranks.get(b.goodsCode) ?? 20000) || a.goodsCode.localeCompare(b.goodsCode));
    matrix.columns.forEach(column => { const preference = preferences.get(column.warehouseKeys[0]); if (preference?.displayName) column.label = preference.displayName; });
    matrix.columns.sort((a, b) => (preferences.get(a.warehouseKeys[0])?.index ?? 500) - (preferences.get(b.warehouseKeys[0])?.index ?? 500) || a.label.localeCompare(b.label));
    matrix.items.forEach(product => {
      product.details.forEach(row => { row.warehouseDisplayName = preferences.get(String(row.warehouseKey))?.displayName ?? ""; });
      product.details.sort((a, b) => (preferences.get(String(a.warehouseKey))?.index ?? 500) - (preferences.get(String(b.warehouseKey))?.index ?? 500) || String(a.warehouseName).localeCompare(String(b.warehouseName)));
    });
    matrix.page = Number(url.searchParams.get("page")) || 1;
    matrix.items = matrix.items.slice((matrix.page - 1) * matrix.pageSize, matrix.page * matrix.pageSize);
    return reply(matrix);
  };
  const initial = new URL(location.href);
  initial.searchParams.set("module", "inventory"); initial.searchParams.set("view", "inbound"); initial.searchParams.set("jdDepartment", department.id);
  history.replaceState(null, "", initial.href);
  function Demo() {
    const [collapsed, setCollapsed] = useState(false);
    const user = { id: "synthetic-admin", email: "synthetic@example.invalid", name: "演示管理员", role: "admin" } as CurrentUser;
    return <AppShell collapsed={collapsed} mobileOpen={false} onCloseMobile={() => undefined} sidebar={<SidebarNavigation active="inventory" activeView="inbound" collapsed={collapsed} hrefForModule={() => "#"} onNavigate={event => event.preventDefault()} onToggleCollapsed={() => setCollapsed(value => !value)} />} header={<div style={{ padding: "8px 20px", color: "var(--color-text-secondary)" }}>库存管理 / 京东入仓监控 · 功能演示</div>}>
      <div className="subnav outlet-subnav" role="tablist" aria-label="库存管理">{["库存总览", "库龄分析", "备货计划", "滞销清理", "京东入仓监控", "广东入仓监控"].map(label => <button key={label} className={label === "京东入仓监控" ? "active" : ""}>{label}</button>)}</div>
      <div className="inventory-feedback inventory-feedback-warning"><p>合成数据演示 · 所有数据、样式和脚本已内嵌。仓库开关、别名、排序和商品拖拽仅保存在此文件的浏览器本地；不连接正式系统。<button type="button" className="row-action" onClick={() => { try { localStorage.removeItem(storageKey); } catch { /* optional storage */ } location.reload(); }}>重置演示</button></p></div>
      <Workspace currentUser={user} />
    </AppShell>;
  }
  createRoot(document.getElementById("app")!).render(<Demo />);
}
void start();
