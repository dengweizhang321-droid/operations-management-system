import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import path from "node:path";
import { build } from "esbuild";

const fixture = { options: { departments: [{ id: "fixture-dept" }] }, lists: {}, matrices: {}, catalog: [] };
const bundle = build({
  entryPoints: ["tools/html/jd-logistics-offline.tsx"], bundle: true, write: false, outdir: ".codex-tmp/offline-file-test", format: "iife", platform: "browser", target: "es2022", define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "skip-render", setup(api) {
    api.onResolve({ filter: /^react-dom\/client$/ }, () => ({ path: "root", namespace: "test" }));
    api.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "test" }));
    api.onLoad({ filter: /.*/, namespace: "test" }, args => ({ contents: args.path === "root" ? "export const createRoot=()=>({render(){}})" : "export default function Link(){return null}", resolveDir: path.resolve("."), loader: "js" }));
  } }],
}).then(result => result.outputFiles.find(file => file.path.endsWith(".js"))!.text);

async function adapter(href: string) {
  const location = { href };
  const history = { replaceState(_state: unknown, _unused: string, value: string) { location.href = new URL(value, location.href).href; } };
  const window: Record<string, unknown> = { location, history };
  const context = vm.createContext({ window, location, history, document: { getElementById: (id: string) => id === "offline-data" ? { dataset: {}, textContent: JSON.stringify(fixture) } : {} }, URL, URLSearchParams, Response, Request, structuredClone, DOMException, console, setTimeout, clearTimeout });
  vm.runInContext(await bundle, context);
  for (let count = 0; count < 20 && typeof window.fetch !== "function"; count++) await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(typeof window.fetch, "function");
  return window.fetch as typeof fetch;
}

test("Windows file URL diagnosis: the previous parser inherited the drive", () => {
  assert.equal(new URL("/api/inventory/jd-logistics?operation=options", "file:///D:/报告/京东.html").pathname, "/D:/api/inventory/jd-logistics");
});

for (const href of ["file:///D:/报告/京东.html", "file:///E:/目录/京东.html?jdTab=monitor", "file://server/share/京东.html", "https://offline.example.invalid/report.html"]) {
  test(`actual offline adapter reads under ${href.split("/报告")[0]}`, async () => {
    const fetchSnapshot = await adapter(href);
    const response = await fetchSnapshot("/api/inventory/jd-logistics?operation=options");
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.departments[0].id, "fixture-dept");
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) assert.equal((await fetchSnapshot("/api/inventory/jd-logistics?operation=options", { method })).status, 403);
    assert.equal((await fetchSnapshot(new Request("https://offline.example.invalid/api/inventory/jd-logistics?operation=options", { method: "PATCH" }))).status, 403);
    assert.equal((await fetchSnapshot("/api/other?operation=options")).status, 403);
    assert.equal((await fetchSnapshot("/D:/api/inventory/jd-logistics?operation=options")).status, 403);
  });
}
