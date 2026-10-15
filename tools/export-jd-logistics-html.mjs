import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseArgs } from "node:util";
import { build } from "esbuild";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";

const root = fileURLToPath(new URL("../", import.meta.url));
const { values } = parseArgs({ options: { snapshot: { type: "string" }, output: { type: "string" }, "styles-root": { type: "string" }, "real-data": { type: "boolean", default: false } } });
if (!values.snapshot || !values.output || !path.isAbsolute(values.output) || !values.output.endsWith(".html")) throw new Error("需要 --snapshot 合成快照路径和 --output 绝对HTML路径");
const snapshot = JSON.parse(await readFile(path.resolve(values.snapshot), "utf8"));
delete snapshot.lists?.settings;
if (values["real-data"]) {
  const provenance = snapshot.provenance;
  if (provenance?.mode !== "local-files" || snapshot.options?.departments?.length !== 1 || snapshot.options.departments[0].id !== provenance.departmentId || provenance.businessWrites !== false || provenance.sources?.length !== 4 || !Array.isArray(snapshot.aggregateValues) || !snapshot.searchScopes || !snapshot.catalog?.length) throw new Error("真实文件导出需要独立文件来源证明和完整后台预计算快照");
  if (snapshot.options.departments.some(row => row.logisticsEnabled || row.monitorEnabled || row.pushEnabled || row.stockoutThresholdDays != null) || snapshot.lists?.batches?.items?.length) throw new Error("文件展示不得冒充正式配置或导入批次");
  for (const source of provenance.sources) {
    if (!/^[a-f0-9]{64}$/.test(source.sha256) || !Number.isInteger(source.rows) || source.rows < 1) throw new Error("文件来源摘要无效");
  }
  for (const matrix of Object.values(snapshot.matrices ?? {})) if (!Array.isArray(matrix.items) || matrix.items.some(row => row.departmentId !== provenance.departmentId)) throw new Error("文件快照混入其他事业部");
} else {
if (snapshot.options?.departments?.length !== 1 || snapshot.options.departments[0].businessUnitCode !== "SYNTHETIC-MATRIX"
  || !Array.isArray(snapshot.catalog) || snapshot.catalog.some(item => !item.code?.startsWith("MATRIX-JD-"))
  || Object.keys(snapshot.matrices ?? {}).length !== 96) throw new Error("HTML仅接受本任务明确的合成演示快照");
for (const matrix of Object.values(snapshot.matrices)) {
  if (!Array.isArray(matrix.items) || matrix.items.some(item => item.departmentId !== "synthetic-matrix-dept" || !item.goodsCode?.startsWith("MATRIX-JD-"))) throw new Error("快照混入其他范围，拒绝导出");
}
}
const bundled = await build({
  absWorkingDir: root, entryPoints: ["tools/html/jd-logistics-offline.tsx"], bundle: true, format: "iife", platform: "browser", target: "es2022", minify: true, write: false,
  outdir: path.join(root, ".codex-tmp/html-bundle"), define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "offline-link", setup(api) {
    api.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "offline" }));
    api.onLoad({ filter: /.*/, namespace: "offline" }, () => ({ contents: "import React from 'react';export default function Link({prefetch,...props}){return React.createElement('a',props)}", resolveDir: root, loader: "js" }));
  } }],
});
const js = bundled.outputFiles.find(file => file.path.endsWith(".js")).text;
let css = "";
const stylesRoot = values["styles-root"] ? path.resolve(values["styles-root"]) : root;
for (const name of await readdir(path.join(stylesRoot, "dist/client/assets"))) if ((name.startsWith("index-") || name.startsWith("inventory-module-view-") || name.startsWith("import-module-view-")) && name.endsWith(".css")) css += await readFile(path.join(stylesRoot, "dist/client/assets", name), "utf8");
css += await readFile(path.join(root, "app/jd-logistics.css"), "utf8");
css = css.replace(/@import\s+[^;]+;/g, "").replace(/url\((?!["']?data:)[^)]+\)/g, "none");
css += `.offline-shell{display:block;min-height:100vh}.offline-workspace{padding:18px 24px;max-width:1920px;margin:0 auto!important}.offline-mainnav{display:flex;align-items:center;gap:5px;flex:1;overflow:auto;color:#dfece3;font-size:12px}.offline-mainnav span,.offline-mainnav button{white-space:nowrap;padding:9px 11px;border-radius:7px}.offline-mainnav button{border:0;background:transparent;color:inherit;font:inherit;cursor:pointer}.offline-mainnav .selected{background:#ffffff20;color:white;font-weight:600}.offline-badge{color:#eef5f0;font-size:11px;white-space:nowrap}.offline-parent,.offline-sources{position:static!important;display:flex!important;gap:6px;margin:0 0 14px!important;overflow:auto}.offline-parent span{white-space:nowrap;padding:10px 17px;color:var(--color-text-secondary)}.offline-parent .active{color:var(--color-brand);border-bottom:2px solid var(--color-brand);font-weight:600}.offline-note{margin:0 0 14px;padding:10px 14px;border:1px solid #dce9df;border-radius:8px;background:#edf5ef;color:#506b59;font-size:12px}.offline-footer{padding:24px 0;color:#7b8b82;font-size:11px;text-align:center}.offline-workflow{padding:24px}.offline-workflow p{line-height:1.8;color:var(--color-text-secondary)}.offline-steps{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin:24px 0}.offline-steps article{border:1px solid var(--color-border-default);border-radius:12px;padding:22px;background:var(--surface)}.offline-steps article>strong{display:grid;place-items:center;width:40px;height:40px;border-radius:12px;background:var(--color-brand-soft);color:var(--color-brand);font-size:20px}.offline-steps h3{margin:15px 0 8px}.offline-shell .shell-masthead{background:#263f32}.offline-shell .jd-logistics-heading{margin:0}.offline-shell .subnav button{font-size:13px}.offline-shell input,.offline-shell select{font-size:13px}@media(max-width:800px){.offline-workspace{padding:12px}.offline-steps{grid-template-columns:1fr}.offline-badge{display:none}}`;
const json = values["real-data"] ? gzipSync(Buffer.from(JSON.stringify(snapshot)), { level: 9 }).toString("base64") : JSON.stringify(snapshot).replaceAll("<", "\\u003c");
const compression = values["real-data"] ? ' data-compression="gzip-base64"' : "";
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'unsafe-inline';style-src 'unsafe-inline';img-src data:;font-src data:;connect-src 'none';base-uri 'none';form-action 'none'"><title>京东入仓监控 · ${values["real-data"] ? "真实文件数据" : "合成演示"} · 离线HTML</title><style>${css.replaceAll("</style", "<\\/style")}</style></head><body><div id="app">正在加载内嵌文件快照…</div><noscript>请启用JavaScript以切换页面及展开分仓明细。</noscript><script type="application/json" id="offline-data"${compression}>${json}</script><script>${js.replaceAll("</script", "<\\/script")}</script></body></html>`;
await mkdir(path.dirname(values.output), { recursive: true });
await writeFile(values.output, html, "utf8");
console.log(JSON.stringify({ file: values.output, bytes: Buffer.byteLength(html), sha256: createHash("sha256").update(html).digest("hex"), selfContained: true, syntheticOnly: !values["real-data"], sourceMode: values["real-data"] ? "local-files" : "synthetic", externalConnections: false }));
