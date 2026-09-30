/** Bounded synthetic GET transport. No real network or navigation controller. */
import { installOwnerProductFixture } from "./owner-products.mjs";

const users = {
  A: { email: "integrated-a@example.test", displayName: "合成账号A", role: "admin", roleLabel: "管理员", scopeRestricted: false },
  B: { email: "integrated-b@example.test", displayName: "合成账号B", role: "admin", roleLabel: "管理员", scopeRestricted: false },
};
export function installIntegratedTransport() {
  const product = installOwnerProductFixture();
  const prior = JSON.parse(sessionStorage.getItem("integrated-transport") || "null");
  window.__integrated = { calls: prior?.calls || [], blocked: prior?.blocked || [], writeAttempts: prior?.writeAttempts || [], paidAttempts: prior?.paidAttempts || [], user: users[sessionStorage.getItem("integrated-user") || "A"] };
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
    if (["/api/netshop/product-insights", "/api/netshop/product-insights/detail", "/api/netshop/products"].includes(url.pathname)) {
      const body = product(url);
      // Slow A ignores cancellation deliberately; the actual consumer must fence it.
      await new Promise(resolve => setTimeout(resolve, (url.searchParams.get("outlet") || "").endsWith("合成店A") ? 70 : 5));
      return Response.json(body, { headers: { "X-Netshop-Data-Revision": "1:aaaaaaaaaaaa" } });
    }
    // These real classic/01 reads have no owner full fixture in this harness yet.
    // Mounting their real error UI proves entry preservation, not source success.
    if (["/api/sales/summary", "/api/netshop/store-overview", "/api/netshop/product-performance", "/api/netshop/promotion-performance/items", "/api/netshop/promotion-performance/overview"].includes(url.pathname)) return deny("synthetic_source_pending", "本合成工具尚未提供该旧视图完整来源夹具");
    window.__integrated.blocked.push({ ...info, reason: "unknown-get" });
    return deny("synthetic_route_blocked", "未登记合成只读接口已拦截");
  };
}
