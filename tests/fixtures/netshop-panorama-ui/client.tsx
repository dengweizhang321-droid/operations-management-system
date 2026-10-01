/// <reference types="vite/client" />
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import StorePanoramaView from "../../../app/netshop/panorama/StorePanoramaView";
import ProductsColumn from "../../../app/netshop/products/ProductsColumn";
import PromotionInsightsView from "../../../app/netshop/promotion/PromotionInsightsView";
import { defaultShopLocationContext } from "../../../app/shell/shop-context";
import { drillShopLocation, parseShellLocation, returnShopLocation, serializeShellLocation, updateShopContextLocation, updateModuleViewLocation } from "../../../app/shell/navigation-contract";
import { bindShopPresentationHistory, readBoundShopLocationContext } from "../../../app/shell/shop-presentation-history";
import type { CurrentUser } from "../../../app/module-view-shared";
import type { NetshopColumnProps } from "../../../app/netshop/shared/module-slots";
import type { NetshopView } from "../../../app/netshop/shared/navigation";
import "../../../app/globals.css";
import "../../../app/shell/top-navigation.css";
import "../../../app/styles/shared-theme.css";
import "./harness.css";

type QAEvent = { kind: string; text: string };
declare global { interface Window { __panoramaUiQA: { events: QAEvent[]; errors: string[] }; } }
window.__panoramaUiQA = { events: [], errors: [] };
const errors = (event: ErrorEvent) => window.__panoramaUiQA.errors.push(event.message.slice(0, 2000));
const rejected = (event: PromiseRejectionEvent) => window.__panoramaUiQA.errors.push(String(event.reason).slice(0, 2000));
addEventListener("error", errors); addEventListener("unhandledrejection", rejected);
function record(kind: string, value: unknown) { const events = window.__panoramaUiQA.events; events.push({ kind, text: JSON.stringify(value).slice(0, 3000) }); if (events.length > 100) events.shift(); }
const currentUser: CurrentUser = { email: "panorama-ui@example.test", displayName: "隔离验收管理员", role: "admin", roleLabel: "管理员", scopeRestricted: false };
const principal = JSON.stringify([currentUser.email, currentUser.role, currentUser.scopeRestricted]);
const initial = serializeShellLocation({ module: "shop", view: "analysis", period: { kind: "custom", from: "2026-09-01", to: "2026-09-07" }, shop: { ...defaultShopLocationContext, platforms: ["京东"], outlets: ["京东\u001f合成店A"], pageSize: 5 } });
if (!location.search) history.replaceState(null, "", initial);
function boundLocation() { const url = location.pathname+location.search; return serializeShellLocation({ ...parseShellLocation(url), shop: readBoundShopLocationContext(url, history.state, principal) }); }
function App() {
  const [state, setState] = useState(() => parseShellLocation(boundLocation())), [control, setControl] = useState("");
  const navigate = (url: string) => { history.pushState(bindShopPresentationHistory(history.state, url, principal), "", url); setState(parseShellLocation(boundLocation())); record("navigate", url); };
  useEffect(() => { const pop = () => setState(parseShellLocation(boundLocation())); addEventListener("popstate", pop); return () => removeEventListener("popstate", pop); }, []);
  const context = state.shop ?? defaultShopLocationContext, period = state.period;
  const from = "from" in period ? period.from : "2026-09-01", to = "to" in period ? period.to : "2026-09-07";
  const props: NetshopColumnProps = { startDate: from, endDate: to, periodKind: period.kind === "custom" ? period.intent ?? "custom" : "custom", context, currentUser,
    onContextChange: next => navigate(updateShopContextLocation(boundLocation(), next)),
    onModuleViewChange: view => navigate(updateModuleViewLocation(boundLocation(), "shop", view)),
    onDrill: (view, product, section) => { record("drill", { view, product, section, from, to }); navigate(drillShopLocation(boundLocation(), view, product, section)); },
    onReturn: () => navigate(returnShopLocation(boundLocation())),
    onApplyPeriod: (start, end, intent) => navigate(serializeShellLocation({ module: "shop", view: state.view as NetshopView, period: { kind: "custom", from: start, to: end, ...(intent ? { intent } : {}) }, shop: context }, boundLocation())),
    onNavigate: (module, source) => record("external-existing-module", { module, source }), supportsPromotionProductDrill: true };
  async function fixture(path: string, body: unknown) {
    try { const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" }); if (!response.ok) throw new Error(`隔离控制失败(${response.status})`); record("fault-control", { path, body }); setControl("隔离测试控制已生效；重新读取触发验证"); }
    catch (error) { setControl(error instanceof Error ? error.message : "隔离控制失败"); }
  }
  return <div className="panorama-qa-shell"><header className="panorama-qa-header"><strong>TERUISI 运营管理系统</strong><nav aria-label="验收顶部导航"><span>经营总览</span><span>库存管理</span><span>销售分析</span><b>网店分析</b><span>财务管理</span></nav><span className="panorama-qa-label">隔离合成 PostgreSQL · 实际只读组件</span></header>
    <aside className="panorama-qa-tools" aria-label="隔离验收工具"><button onClick={() => void fixture("/fixture/advance-revision", {})}>推进隔离来源版本</button><button onClick={() => void fixture("/fixture/account-status", { status: "disabled" })}>暂停隔离账号权限</button><button onClick={() => void fixture("/fixture/account-status", { status: "active" })}>恢复隔离账号权限</button><label>来源故障注入<select defaultValue="none" onChange={event => void fixture("/fixture/source-failure", { source: event.target.value === "none" ? null : event.target.value })}><option value="none">关闭</option><option value="products">商品503</option><option value="promotion">推广503</option></select></label><button onClick={() => void fixture("/fixture/delay", { shopName: "合成店A", milliseconds: 1200 })}>延迟店A读取</button><button onClick={() => void fixture("/fixture/delay", { shopName: null, milliseconds: 0 })}>关闭延迟</button><span role="status">{control}</span></aside>
    <main className="panorama-qa-workspace">{state.view === "analysis" ? <StorePanoramaView {...props}/> : state.view === "products" ? <ProductsColumn {...props}/> : state.view === "promotion" ? <PromotionInsightsView {...props}/> : <section className="panorama-qa-target"><h1>原功能跳转目标</h1><pre>{JSON.stringify({ view: state.view, period, context }, null, 2)}</pre><button onClick={props.onReturn}>返回店铺全景</button></section>}
      <details className="panorama-qa-console"><summary>隔离验收事件</summary><pre>{JSON.stringify(window.__panoramaUiQA, null, 2)}</pre><p>这里使用测试管理员和合成事实，只读处理器实际查询私有 PostgreSQL。公共 Home／gateway 接线另由总控验收。</p></details>
    </main></div>;
}
const root = createRoot(document.getElementById("root")!); root.render(<App/>);
import.meta.hot?.dispose(() => { root.unmount(); removeEventListener("error", errors); removeEventListener("unhandledrejection", rejected); });
