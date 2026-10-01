/** Bounded synthetic GET transport. No real network or navigation controller. */
import { installOwnerProductFixture } from "./owner-products.mjs";
import { m4OwnerRevision, projectM4Promotion, projectM4Product, projectM4Diagnostic } from "./m4-promotion-fixtures.mjs";

const users = {
  A: { email: "integrated-a@example.test", displayName: "合成账号A", role: "admin", roleLabel: "管理员", scopeRestricted: false },
  B: { email: "integrated-b@example.test", displayName: "合成账号B", role: "admin", roleLabel: "管理员", scopeRestricted: false },
};
export function installIntegratedTransport({ phase = "M3" } = {}) {
  const product = installOwnerProductFixture();
  const prior = JSON.parse(sessionStorage.getItem("integrated-transport") || "null");
  window.__integrated = { phase, calls: prior?.calls || [], blocked: prior?.blocked || [], writeAttempts: prior?.writeAttempts || [], paidAttempts: prior?.paidAttempts || [], projections: prior?.projections || [], fixturePending: prior?.fixturePending || [], injectedResponses: prior?.injectedResponses || [], user: users[sessionStorage.getItem("integrated-user") || "A"] };
  window.__integratedControl = { error: null, childFailure: null, pending: null };
  if (phase === "M4") {
    window.__syntheticDownloads = [];
    URL.createObjectURL = blob => { const record = { url: `blob:synthetic-${window.__syntheticDownloads.length}`, name: null, type: blob.type, bytes: null }; window.__syntheticDownloads.push(record); blob.arrayBuffer().then(buffer => { record.bytes = Array.from(new Uint8Array(buffer)); }); return record.url; };
    URL.revokeObjectURL = () => {};
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { const record = window.__syntheticDownloads.find(item => item.url === this.href); if (record && this.download) { record.name = this.download; return; } return originalClick.call(this); };
  }
  const remember = () => sessionStorage.setItem("integrated-transport", JSON.stringify(window.__integrated));
  window.fetch = async (input, init = {}) => {
    const raw = input instanceof Request ? input.url : String(input);
    const url = new URL(raw, location.href);
    const method = String(init.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    const info = { path: url.pathname, method, query: [...url.searchParams], at: Date.now() };
    window.__integrated.calls.push(info);
    remember();
    const deny = (code, error, status = 503) => { remember(); return Response.json({ code, error }, { status }); };
    if (url.origin !== location.origin) { window.__integrated.blocked.push({ ...info, reason: "external" }); return deny("synthetic_external_blocked", "合成环境禁止外部服务"); }
    if (!["GET", "HEAD"].includes(method)) {
      window.__integrated.writeAttempts.push(info);
      if (/interpret|\/api\/ai\//.test(url.pathname)) window.__integrated.paidAttempts.push(info);
      return deny("synthetic_write_blocked", "合成环境禁止写入与模型派发", 405);
    }
    if (init.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (url.pathname === "/api/auth/me") return Response.json({ user: window.__integrated.user });
    if (["/api/ai/models", "/api/ai/channels"].includes(url.pathname)) return Response.json({ items: [] });
    if (url.pathname === "/api/ai/conversations") return Response.json({ items: [], models: [], pagination: { page: 1, pageSize: 30, total: 0, returned: 0, hasMore: false, truncated: false } });
    if (url.pathname === "/api/ai/chat") return Response.json({ items: [], pagination: { pageSize: 30, total: 0, returned: 0, hasMore: false, truncated: false, nextBefore: null } });
    if (phase === "M4" && url.pathname === "/api/netshop/promotion-insights/detail" && window.__integratedControl.childFailure) {
      const failure = window.__integratedControl.childFailure;
      const record = { ...info, status: failure.status, shape: failure.shape, deferred: !!failure.deferred, releasedAfterAbort: false };
      window.__integrated.injectedResponses.push(record); remember();
      const response = () => new Response(failure.shape === "html" ? "<html><body>Synthetic proxy failure</body></html>" : failure.shape === "invalidUTF8" ? Uint8Array.of(0xc3, 0x28) : null, { status: failure.status, headers: { "Content-Type": failure.shape === "html" ? "text/html" : "application/json" } });
      if (failure.deferred) return new Promise(resolve => { window.__integratedControl.pending = { signal: init.signal, release() { record.releasedAfterAbort = !!init.signal?.aborted; remember(); resolve(response()); } }; });
      return response();
    }
    if (phase === "M4" && url.pathname.startsWith("/api/netshop/") && window.__integratedControl.error) {
      const error = window.__integratedControl.error;
      return deny(error === "epoch" ? "promotion_revision_changed" : "access_denied", `合成${error}失效：旧数据须清空`, error === "epoch" ? 409 : 403);
    }
    if (phase === "M4" && ["/api/netshop/promotion-insights", "/api/netshop/promotion-insights/detail"].includes(url.pathname)) {
      try { const body = projectM4Promotion(url, window.__integrated); remember(); return Response.json(body, { headers: { "X-Netshop-Data-Revision": m4OwnerRevision } }); }
      catch (error) {
        if (error.message === "promotion_revision_changed") return deny(error.message, "合成原版本失效", 409);
        window.__integrated.fixturePending.push({ ...info, error: error.message }); return deny("synthetic_fixture_pending", error.message);
      }
    }
    if (phase === "M4" && url.pathname === "/api/netshop/promotion-diagnostic") {
      try { const body = projectM4Diagnostic(url, window.__integrated); remember(); return Response.json(body, { headers: { "X-Netshop-Data-Revision": m4OwnerRevision } }); }
      catch(error) { window.__integrated.fixturePending.push({ ...info, error: error.message }); return deny("synthetic_fixture_pending", error.message); }
    }
    if (["/api/netshop/product-insights", "/api/netshop/product-insights/detail", "/api/netshop/products"].includes(url.pathname)) {
      const body = phase === "M4" ? projectM4Product(product(url), url, window.__integrated) : product(url);
      // Slow A ignores cancellation deliberately; the actual consumer must fence it.
      await new Promise(resolve => setTimeout(resolve, (url.searchParams.get("outlet") || "").endsWith("合成店A") ? 70 : 5));
      remember(); return Response.json(body, { headers: { "X-Netshop-Data-Revision": phase === "M4" ? m4OwnerRevision : "1:aaaaaaaaaaaa" } });
    }
    // These real classic/01 reads have no owner full fixture in this harness yet.
    // Mounting their real error UI proves entry preservation, not source success.
    if (["/api/sales/summary", "/api/netshop/store-overview", "/api/netshop/product-performance", "/api/netshop/promotion-performance/items", "/api/netshop/promotion-performance/overview", "/api/netshop/promotion-insights", "/api/netshop/promotion-insights/detail"].includes(url.pathname)) return deny("synthetic_source_pending", "本合成工具尚未提供该模式/旧视图完整来源夹具");
    window.__integrated.blocked.push({ ...info, reason: "unknown-get" });
    return deny("synthetic_route_blocked", "未登记合成只读接口已拦截");
  };
}
