import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

// Reuse the established demo's real shell, monitor, filters, and local settings.
const result = await build({
  entryPoints: ["docs/jd-monitor-preferences-20261016/demo.tsx"], bundle: true, write: false,
  conditions: ["style", "browser"], outdir: ".codex-tmp/jd-monitor-no-values", format: "iife",
  platform: "browser", target: "es2022", minify: true, define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "file-only-preview", setup(api) {
    api.onLoad({ filter: /jd-monitor-preferences-20261016[/\\]demo\.tsx$/ }, args => ({
      contents: readFileSync(args.path, "utf8").replace("jd-monitor-synthetic-demo-v1", "jd-monitor-no-values-20261017")
        .replace("合成数据演示 · 所有数据、样式和脚本已内嵌。", "合成数据演示 · 商品A可用3+5，合计8；无库存数值的商品D自动隐藏。"),
      loader: "tsx", resolveDir: resolve("docs/jd-monitor-preferences-20261016"),
    }));
    api.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "demo" }));
    api.onLoad({ filter: /.*/, namespace: "demo" }, () => ({ contents: "import React from 'react';export default function Link({prefetch,...props}){return React.createElement('a',props)}", resolveDir: process.cwd(), loader: "js" }));
  } }],
});
const js = result.outputFiles.find(file => file.path.endsWith(".js")).text;
const css = result.outputFiles.find(file => file.path.endsWith(".css")).text;
const data = readFileSync(".codex-tmp/jd-monitor-no-values.json.gz").toString("base64");
const directory = resolve("D:/codex-artifacts/jd-monitor-hide-no-warehouse-20261017");
mkdirSync(directory, { recursive: true });
const output = resolve(directory, "京东入仓监控-隐藏空仓商品与范围合计.html");
writeFileSync(output, `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>京东入仓监控 · 隐藏空仓商品与范围合计</title><style>${css.replace(/<\/style/gi, "<\\/style")}</style></head><body><div id="app"></div><script id="demo-data" type="application/octet-stream">${data}</script><script>${js.replace(/<\/script/gi, "<\\/script")}</script></body></html>`);
console.log(output);
