import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig, type Plugin, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";

const directory = fileURLToPath(new URL(".", import.meta.url)), project = resolve(directory, "../../..");
const reads = ["/api/netshop/store-panorama", "/api/netshop/insights-context", "/api/netshop/product-insights", "/api/netshop/product-insights/detail", "/api/netshop/promotion-insights", "/api/netshop/promotion-insights/detail"];
const controls = ["/fixture/account-status", "/fixture/advance-revision", "/fixture/source-failure", "/fixture/delay"];
const csp = "default-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'self'";
function guard(): Plugin {
  return { name: "panorama-private-ui-guard", configureServer(server) {
    server.middlewares.use((request, response, next) => {
      response.setHeader("Content-Security-Policy", csp); response.setHeader("X-Panorama-QA", "isolated-synthetic-pg-actual-readers");
      const path = new URL(request.url ?? "/", "http://127.0.0.1:3162").pathname;
      if (path.startsWith("/api/") || path.startsWith("/fixture/")) {
        if (!((reads.includes(path) && request.method === "GET") || (controls.includes(path) && request.method === "POST"))) { response.writeHead(403, { "content-type": "application/json;charset=utf-8" }); response.end(JSON.stringify({ code: "qa_route_blocked", error: "隔离验收仅开放本栏只读路径与固定测试控制" })); return; }
      }
      next();
    });
  } };
}
function proxy(): ProxyOptions { return { target: "http://127.0.0.1:18160", changeOrigin: false, followRedirects: false, ws: false, configure(instance) { instance.on("proxyRes", response => { if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) { response.statusCode = 502; delete response.headers.location; } }); } }; }
export default defineConfig({ root: directory, envDir: false, envPrefix: [], plugins: [guard(), react()],
  resolve: { alias: { "@": project } }, cacheDir: resolve(project, ".runtime/panorama-ui/vite-cache"),
  server: { host: "127.0.0.1", port: 3162, strictPort: true, hmr: false, watch: null, allowedHosts: ["localhost", "127.0.0.1"],
    fs: { allow: [project], deny: ["**/.env*", "**/.dev.vars*", "**/*.pem", "**/*.key", "**/.git/**"] },
    proxy: Object.fromEntries([...reads, ...controls].map(path => [path, proxy()])), },
  build: { outDir: resolve(project, ".runtime/panorama-ui/build"), emptyOutDir: true },
});
