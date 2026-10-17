import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = process.argv[2];
if (!output || !path.isAbsolute(output) || !output.endsWith(".html")) throw new Error("请提供输出HTML绝对路径");
const bundle = await build({ absWorkingDir: root, entryPoints: ["tools/html/tmall-warehouse-offline.tsx"], bundle: true, write: false, outdir: ".codex-tmp/tmall-html", format: "iife", platform: "browser", target: "es2022", minify: true, define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "offline-link", setup(api) {
  api.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "offline" }));
  api.onLoad({ filter: /.*/, namespace: "offline" }, () => ({ contents: "import React from 'react';export default function Link({prefetch,...props}){return React.createElement('a',props)}", resolveDir: root, loader: "js" }));
} }] });
const js = bundle.outputFiles.find(file => file.path.endsWith(".js")).text;
let css = (await Promise.all(["app/styles/tokens.css", "app/globals.css", "app/shell/top-navigation.css", "app/tmall-warehouse.css"].map(name => readFile(path.join(root, name), "utf8")))).join("\n");
css = css.replace(/@import\s+[^;]+;/g, "").replace(/url\((?!["']?data:)[^)]+\)/g, "none");
css += `.offline-shell{display:block;min-height:100vh}.offline-workspace{padding:18px 24px;max-width:1920px;margin:0 auto!important}.offline-mainnav{display:flex;align-items:center;gap:5px;flex:1;overflow:auto;color:#dfece3;font-size:12px}.offline-mainnav span{white-space:nowrap;padding:9px 11px;border-radius:7px}.offline-mainnav .selected{background:#ffffff20;color:white;font-weight:600}.offline-badge{color:#eef5f0;font-size:11px;white-space:nowrap}.offline-note{font-size:12px;color:#718176;padding:12px 16px;background:#edf4ef;border-radius:8px;line-height:1.7}.offline-workspace .inventory-subnav{position:static!important}.offline-workspace .inventory-subnav>span{padding:10px 15px;font-size:13px}.offline-workspace .inventory-subnav .active{color:#287b4d;border-bottom:2px solid #287b4d}.offline-steps{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;padding:16px}.offline-steps article{padding:18px;background:#f4f7f5;border-radius:9px}.offline-steps strong{font-size:22px;color:#287b4d}.offline-steps p{font-size:13px;color:#718176}`;
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'unsafe-inline';style-src 'unsafe-inline';img-src data:;font-src data:;connect-src 'none';base-uri 'none';form-action 'none'"><title>天猫入仓监控 · 合成展示</title><style>${css.replaceAll("</style", "<\\/style")}</style></head><body><div id="app">正在加载…</div><script>${js.replaceAll("</script", "<\\/script")}</script></body></html>`;
await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, html, "utf8"); console.log(JSON.stringify({ output, bytes: Buffer.byteLength(html), mode: "synthetic", network: false }));
