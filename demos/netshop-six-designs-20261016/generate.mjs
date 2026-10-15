import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
const dir=path.dirname(fileURLToPath(import.meta.url));
const read=name=>fs.readFileSync(path.join(dir,name),'utf8');
const layouts=read('layouts-a.js')+'\n'+read('layouts-b.js');
const context=vm.createContext({});
vm.runInContext(layouts+';this.extraCss=extraCssA+extraCssB;',context);
const css=read('style.css')+context.extraCss+`.v3-detail>.panel,.v4-comparison>.panel{border-top-color:#73977e}.v3-trend>.panel,.v4-structure>.panel{background:white}.v4-comparison thead th{background:#f3f7f4}.v5-layout .panel>.panel,.v6-layout .panel>.panel{border:0;padding:0;background:transparent}.object-list{max-height:550px;overflow:auto}.v5-insights .insights{display:grid;gap:11px}.v6-insights>.insights{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}@media(max-width:900px){.v6-insights>.insights{grid-template-columns:1fr}}`;
const runtime=read('runtime.js');
new vm.Script(layouts+'\nconst VARIANT=1;\n'+runtime);
const files=['01-balanced.html','02-workbench.html','03-object-focus.html','04-comparison.html','05-diagnostics.html','06-review.html'];
const titles=['经营双栏','紧凑数据台','对象诊断','两期对照','异常巡检','章节复盘'];
for(let i=0;i<6;i++){
 const html=`<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="网店分析布局候选，所有数值为合成示例。离线单文件原型，不连接业务接口。"><title>0${i+1} ${titles[i]} · 网店分析</title><style>${css}</style></head><body><div id="app"></div><dialog class="drawer" id="dialog" aria-labelledby="dialog-title"><div class="drawer-head"><h2 id="dialog-title"></h2><button data-action="close" aria-label="关闭弹窗">×</button></div><div id="dialog-body"></div></dialog><div class="toast" id="toast" role="status" hidden></div><script>const VARIANT=${i+1};\n${layouts}\n${runtime}</script></body></html>`;
 fs.writeFileSync(path.join(dir,files[i]),html,'utf8');
}
console.log('Generated 6 standalone HTML files.');
