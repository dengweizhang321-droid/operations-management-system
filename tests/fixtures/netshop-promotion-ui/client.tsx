import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import PromotionInsightsView from "../../../app/netshop/promotion/PromotionInsightsView";
import { defaultShopLocationContext } from "../../../app/shell/shop-context";
import { drillShopLocation, parseShellLocation, returnShopLocation, serializeShellLocation, updateShopContextLocation, updateModuleViewLocation, type ShellLocationState } from "../../../app/shell/navigation-contract";
import { bindShopPresentationHistory, readBoundShopLocationContext } from "../../../app/shell/shop-presentation-history";
import { rangeForShellPeriod, salesRangeMap, selectedMonthPeriod, skuSalesPeriod, type CurrentUser } from "../../../app/module-view-shared";
import "../../../app/globals.css";
import "./harness.css";

type QAEvent = { at: string; kind: string; message: string };
declare global { interface Window { __promotionUiQA: { events: QAEvent[]; errors: QAEvent[]; location: string }; } }
window.__promotionUiQA = { events: [], errors: [], location: location.pathname + location.search };
function record(kind: string, message: string) {
  const event = { at: new Date().toISOString(), kind, message: message.slice(0, 3000) };
  const log = kind === "error" || kind === "console-error" ? window.__promotionUiQA.errors : window.__promotionUiQA.events;
  log.push(event); if (log.length > 100) log.shift();
  queueMicrotask(() => window.dispatchEvent(new CustomEvent("promotion-qa-event")));
}
window.addEventListener("error", event => record("error", event.message));
window.addEventListener("unhandledrejection", event => record("error", event.reason instanceof Error ? event.reason.message : String(event.reason)));
const originalError = console.error.bind(console), originalWarn = console.warn.bind(console);
console.error = (...args: unknown[]) => { record("console-error", args.map(value => value instanceof Error ? value.message : String(value)).join(" ")); originalError(...args); };
console.warn = (...args: unknown[]) => { record("console-warning", args.map(value => value instanceof Error ? value.message : String(value)).join(" ")); originalWarn(...args); };

const currentUser: CurrentUser & { scope: null } = { email: "synthetic-promotion-ui@example.test", displayName: "合成验收管理员", role: "admin", roleLabel: "合成管理员", scopeRestricted: false, scope: null };
const presentationPrincipal = `${JSON.stringify([currentUser.email, currentUser.role, currentUser.scopeRestricted])}`;
const initial = serializeShellLocation({ module: "shop", view: "promotion", period: { kind: "custom", from: "2026-09-01", to: "2026-09-07" }, shop: { ...defaultShopLocationContext, platforms: ["京东"], dimension: "sku", section: "product" } });
if (!new URL(location.href).searchParams.has("module")) history.replaceState(bindShopPresentationHistory(history.state, initial, presentationPrincipal), "", initial);
function readState(input: string): ShellLocationState {
  const parsed = parseShellLocation(input);
  return parsed.module === "shop" ? { ...parsed, shop: readBoundShopLocationContext(input, history.state, presentationPrincipal) } : parsed;
}
function currentBoundLocation(): string {
  const state = readState(location.href);
  return state.module === "shop" ? serializeShellLocation(state, location.href) : location.href;
}

function App() {
  const [state, setState] = useState<ShellLocationState>(() => readState(location.href));
  const [events, setEvents] = useState<QAEvent[]>([]);
  const [control, setControl] = useState("版本控制就绪");
  const [accountControl, setAccountControl] = useState("合成账号权限控制就绪");
  const [accountBusy, setAccountBusy] = useState(false);
  const navigate = useCallback((url: string) => { history.pushState(bindShopPresentationHistory(history.state, url, presentationPrincipal), "", url); setState(readState(url)); record("navigation", url); }, []);
  useEffect(() => {
    const pop = () => { setState(readState(location.href)); record("history", location.pathname + location.search); };
    const updated = () => setEvents([...window.__promotionUiQA.events, ...window.__promotionUiQA.errors].sort((a, b) => a.at.localeCompare(b.at)).slice(-40));
    addEventListener("popstate", pop); addEventListener("promotion-qa-event", updated);
    return () => { removeEventListener("popstate", pop); removeEventListener("promotion-qa-event", updated); };
  }, []);
  useEffect(() => { window.__promotionUiQA.location = location.pathname + location.search; }, [state]);
  const context = state.shop ?? defaultShopLocationContext;
  const period = state.period;
  const range = rangeForShellPeriod(period);
  const windowPeriod = period.kind === "calendar_month" ? selectedMonthPeriod(period.month) : skuSalesPeriod(range, "from" in period ? period.from : "2026-09-01", "to" in period ? period.to : "2026-09-07");
  const periodKind = period.kind === "custom" ? period.intent ?? "custom" : salesRangeMap[range];
  async function advance() {
    setControl("正在推进合成来源版本…");
    try {
      const response = await fetch("/fixture/advance-revision", { method: "POST", headers: { "content-type": "application/json" }, body: "{}", cache: "no-store" });
      if (!response.ok) throw new Error(`合成版本控制失败（${response.status}）`);
      record("fixture-version", "私有 PostgreSQL 来源版本已推进"); setControl("版本已推进；触发下一次读取以核验旧版本失效");
    } catch (error) { const message = error instanceof Error ? error.message : "合成版本控制失败"; record("error", message); setControl(message); }
  }
  async function accountStatus(status: "disabled" | "active") {
    if (accountBusy) return;
    setAccountBusy(true); setAccountControl(status === "disabled" ? "正在暂停合成账号权限…" : "正在恢复合成账号权限…");
    try {
      const response = await fetch("/fixture/account-status", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }), cache: "no-store" });
      if (!response.ok) throw new Error(`合成账号权限控制失败（${response.status}）`);
      record("fixture-account-status", status === "disabled" ? "私有 PostgreSQL 合成账号已暂停；前端缓存管理员保持不变" : "私有 PostgreSQL 合成账号已恢复；前端缓存管理员保持不变");
      setAccountControl(status === "disabled" ? "合成账号权限已暂停；触发实际读取核验 403 与旧结果清空" : "合成账号权限已恢复；手动重新读取核验恢复");
    } catch (error) { const message = error instanceof Error ? error.message : "合成账号权限控制失败"; record("error", message); setAccountControl(message); }
    finally { setAccountBusy(false); }
  }
  return <div className="promotion-qa-shell">
    <header className="promotion-qa-header"><strong>运营管理系统</strong><span>网店分析 / 推广分析</span><span className="promotion-qa-label">隔离合成验收</span></header>
    <aside className="promotion-qa-tools" aria-label="隔离验收工具"><span>实际 React 页面 + 私有 PostgreSQL 读取器 · 前端缓存合成管理员</span><button type="button" onClick={() => void advance()}>推进合成来源版本</button><span role="status">{control}</span><button type="button" disabled={accountBusy} onClick={() => void accountStatus("disabled")}>暂停合成账号权限</button><button type="button" disabled={accountBusy} onClick={() => void accountStatus("active")}>恢复合成账号权限</button><span role="status">{accountControl}</span></aside>
    <main className="promotion-qa-workspace">
      {state.module === "shop" && state.view === "promotion" ? <PromotionInsightsView startDate={windowPeriod.startDate} endDate={windowPeriod.endDate} periodKind={periodKind} context={context} currentUser={currentUser}
        onContextChange={next => navigate(updateShopContextLocation(currentBoundLocation(), next))}
        onModuleViewChange={view => navigate(updateModuleViewLocation(currentBoundLocation(), "shop", view))}
        onDrill={(view, product, section) => { record("drill", JSON.stringify({ view, product, section, startDate: windowPeriod.startDate, endDate: windowPeriod.endDate })); navigate(drillShopLocation(currentBoundLocation(), view, product, section)); }}
        onReturn={() => navigate(returnShopLocation(currentBoundLocation()))}
        onApplyPeriod={(from, to, intent) => navigate(serializeShellLocation({ module: "shop", view: "promotion", period: { kind: "custom", from, to, ...(intent ? { intent } : {}) }, shop: context }, currentBoundLocation()))}
        onNavigate={(module, source) => record("external-module-target", JSON.stringify({ module, source }))}/>
      : <section className="panel" aria-label="钻取目标验收"><h1>商品钻取目标</h1><p>只核验精确参数与返回合同，商品栏目由总控在组合环境核验。</p><pre id="promotion-qa-drill-target">{JSON.stringify({ view: state.view, product: context.product, period: state.period, returnTo: context.returnTo }, null, 2)}</pre><button type="button" className="secondary-button" onClick={() => navigate(returnShopLocation(currentBoundLocation()))}>返回原推广列表</button></section>}
      <details className="promotion-qa-console"><summary>验收事件与页面异常（{window.__promotionUiQA.errors.length} 条异常）</summary><pre id="promotion-qa-events">{JSON.stringify(events, null, 2)}</pre><p>控制台原始错误仍同步输出；这里只保留有界文本，不保存接口 DTO。</p></details>
    </main>
  </div>;
}
createRoot(document.getElementById("root")!).render(<App/>);
