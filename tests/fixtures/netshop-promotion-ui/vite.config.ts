import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig, type Plugin, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";

const directory = fileURLToPath(new URL(".", import.meta.url));
const project = resolve(directory, "../../..");
const reads = new Set(["/api/netshop/promotion-insights", "/api/netshop/promotion-insights/detail", "/api/netshop/promotion-diagnostic"]);
const revisionControl = "/fixture/advance-revision";
const accountControl = "/fixture/account-status";
const csp = "default-src 'self'; connect-src 'self' ws://127.0.0.1:3150 ws://localhost:3150; img-src 'self' data:; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'self'";
function guard(): Plugin {
  return { name: "promotion-private-ui-guard", configureServer(server) {
    server.middlewares.use((request, response, next) => {
      response.setHeader("Content-Security-Policy", csp);
      response.setHeader("X-Promotion-QA", "synthetic-private-reader-only");
      const path = new URL(request.url ?? "/", "http://127.0.0.1:3150").pathname;
      if (path.startsWith("/api/") || path.startsWith("/fixture/")) {
        const read = reads.has(path) && (request.method === "GET" || request.method === "HEAD");
        const control = (path === revisionControl || path === accountControl) && request.method === "POST";
        if (!read && !control) { response.writeHead(403, { "content-type": "application/json;charset=utf-8" }); response.end(JSON.stringify({ code: "qa_route_blocked", error: "隔离验收仅开放推广只读接口与固定合成控制" })); return; }
      }
      next();
    });
  } };
}
function proxy(): ProxyOptions {
  return { target: "http://127.0.0.1:18150", changeOrigin: false, followRedirects: false, ws: false,
    configure(instance) {
      instance.on("proxyRes", response => {
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) { response.statusCode = 502; delete response.headers.location; }
      });
    },
  };
}
export default defineConfig({
  root: directory, envDir: false, envPrefix: [], plugins: [guard(), react()],
  resolve: { alias: { "@": project } },
  cacheDir: resolve(project, ".runtime/promotion-ui/vite-cache"),
  server: { host: "127.0.0.1", port: 3150, strictPort: true, allowedHosts: ["localhost", "127.0.0.1"],
    fs: { allow: [project], deny: ["**/.env*", "**/.dev.vars*", "**/*.pem", "**/*.key", "**/.git/**"] },
    proxy: Object.fromEntries([...reads, revisionControl, accountControl].map(path => [path, proxy()])),
  },
  build: { outDir: resolve(project, ".runtime/promotion-ui/build"), emptyOutDir: true },
});
