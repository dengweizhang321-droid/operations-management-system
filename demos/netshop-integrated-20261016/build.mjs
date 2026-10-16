import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
const dir=path.dirname(fileURLToPath(import.meta.url));
const css=fs.readFileSync(path.join(dir,'style.css'),'utf8');
const js=fs.readFileSync(path.join(dir,'app.js'),'utf8');
new vm.Script(js);
const html=`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="TERUISI网店分析整合候选：店铺、商品与推广连续分析。所有数值为合成示例，离线单文件。"><title>网店分析 · 三版本整合稿</title><style>${css}</style></head><body><div id="app"></div><dialog id="dialog" class="drawer" aria-labelledby="dialog-title"><div class="dialog-head"><h2 id="dialog-title"></h2><button data-act="close" aria-label="关闭弹窗">×</button></div><div id="dialog-content"></div></dialog><div id="toast" class="toast" role="status" hidden></div><script>${js}</script></body></html>
`;
fs.writeFileSync(path.join(dir,'netshop-integrated.html'),html,'utf8');
console.log('Generated netshop-integrated.html ('+Buffer.byteLength(html)+' bytes).');
