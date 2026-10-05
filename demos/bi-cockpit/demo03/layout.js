import {createModel,ratio} from '../shared/data.js';
import {createUI,movement} from '../shared/ui.js';

export function render(ctx){
 const {state:s,model:m,ui,escape:e,money,percent}=ctx;
 const mode=s.matrixMode||'shops';
 const platforms=[...new Set(m.selectedShops.map(r=>r.platform))];
 const platformRows=platforms.map(platform=>({id:platform,name:platform,platform,...createModel({...s,platform}).totals}));
 const key=s.rank==='profit'?'profit':s.rank==='delta'?'delta':'sales';
 let rows=(mode==='platforms'?platformRows:m.shops).filter(r=>r.name.includes(s.qShop||''));
 rows.sort((a,b)=>(b[key]??-Infinity)-(a[key]??-Infinity));
 const all=s.allShops||mode==='platforms',shown=all?rows:rows.slice(0,5);
 const title=mode==='platforms'?'平台经营对照':'店铺经营对照';
 const rowHTML=r=>{
  const selected=mode==='shops'&&s.selectedShop===r.id;
  const action=mode==='shops'?'select-shop':'matrix-platform';
  return `<tr class="${selected?'selected':''}"><th scope="row"><button class="text-button" data-action="${action}" data-value="${e(r.id)}" ${selected?'aria-pressed="true"':''}>${e(r.name)}</button><small>${mode==='shops'?e(r.platform):'点击进入该平台店铺矩阵'}${r.coverage.complete?'':' · 来源不足'}</small></th><td>${money(r.sales)}</td><td>${money(r.profit)}<small>${percent(r.margin)}</small></td><td>${percent(mode==='shops'?r.share:ratio(r.sales,m.totals.sales))}</td><td>${r.coverage.complete?money(r.delta):'来源/基期不足'}<small>${movement(r.change)}</small></td><td>${mode==='shops'?percent(r.growthContribution):'进入店铺查看'}</td><td>${money(r.spend)}<small>归因 ${money(r.attributed)}</small></td><td>${r.roas===null?'未覆盖':r.roas.toFixed(2)+' 倍'}</td><td><span class="tag">${r.coverage.covered}/${r.coverage.expected} 店日</span>${mode==='shops'?`<button data-action="detail-shop" data-value="${e(r.id)}">详情</button>`:''}</td></tr>`;
 };
 const matrix=`<section class="panel matrix-main" id="shops" data-domain="shops"><header class="section-head"><div><h2>${title}</h2><p class="caption">一行一个经营对象，同一选期、口径与尺度。选行查看局部证据，经营总计保留原筛选。</p></div><button data-action="module" data-value="?module=shop&view=platforms">店铺与平台对比 · 演示</button></header><div class="row matrix-switch"><div class="chips" aria-label="矩阵对象"><button data-action="matrix-mode" data-value="shops" aria-pressed="${mode==='shops'}">店铺矩阵</button><button data-action="matrix-mode" data-value="platforms" aria-pressed="${mode==='platforms'}">平台汇总</button></div><span class="caption">库存与财报保持公司范围，未按店分摊。</span></div><div class="table-tools"><label>排名指标<select data-field="rank"><option value="sales" ${s.rank==='sales'?'selected':''}>ERP 净销售额</option><option value="profit" ${s.rank==='profit'?'selected':''}>综合大毛利额</option><option value="delta" ${s.rank==='delta'?'selected':''}>销售增减额</option></select></label><label>对象名称<input data-field="qShop" value="${e(s.qShop)}" placeholder="筛选当前对象名称" /></label><button data-action="all-shops">${s.allShops?'查看前五店铺':'查看全部店铺'}</button><button data-action="matrix-clear">恢复全部平台 / 店铺</button></div><div class="table-scroll"><table><thead><tr><th scope="col">${mode==='shops'?'平台 / 店铺':'平台'}</th><th>ERP 净销售</th><th>毛利额 / 率</th><th>销售贡献</th><th>增减额 / 幅</th><th>增长贡献</th><th>花费 / 归因</th><th>ROAS</th><th>覆盖 / 详情</th></tr></thead><tbody>${shown.map(rowHTML).join('')||'<tr><td colspan="9">无匹配对象。保留筛选，可清除名称后重试；无数据不计为零。</td></tr>'}</tbody></table></div><p class="caption">显示 ${shown.length}/${rows.length} 个对象。毛利率和 ROAS 使用汇总分子 / 分母；销售贡献分母为当前筛选已覆盖净销售。增长贡献可为负数或超过100%，严格比较不成立时不展示。颜色只表示数值方向，退货率下降可改善经营。</p></section>`;
 const selected=m.shops.find(r=>r.id===s.selectedShop);
 const localUI=selected?createUI({...ctx,model:createModel({...s,shop:selected.id})}):ui;
 const evidence=`<section class="panel matrix-evidence" id="matrix-evidence" data-domain="trend"><header class="section-head"><div><h2>${selected?e(selected.name)+' · 局部经营证据':'选中对象证据'}</h2><p class="caption">${selected?'下方趋势只展示选中店铺；点击趋势点继续缩小证据期间。':'点击矩阵店名选择店铺，或点击趋势点选择证据期间。'}</p></div></header>${localUI.trend()}${ui.evidence()}<div class="notice">${selected?'该店':'当前范围'}推广归因不等于 ERP 成交。公司库存与完整财报月不属于店铺归属事实，不据此生成单店库存货值或单店财报利润。</div></section>`;
 return `<div class="demo03 stack"><div class="notice matrix-intro"><strong>先对照，再查看证据</strong><span>结果与目标 → 对象矩阵 → 选店趋势 → 专业来源。所有数字来自五套共用合成数据。</span></div><section id="results" data-domain="results">${ui.kpis()}</section>${matrix}${evidence}<div class="matrix-domain-index chips"><button data-action="section" data-value="products">商品与品类</button><button data-action="section" data-value="promotion">推广效率</button><button data-action="section" data-value="inventory">公司库存风险</button><button data-action="section" data-value="finance">公司完整月财报</button><button data-action="section" data-value="quality">来源与质量</button></div><div class="grid2 matrix-support">${ui.section('products')}${ui.section('promotion')}</div><div class="grid2 matrix-support">${ui.section('inventory')}${ui.section('finance')}</div>${ui.section('quality')}</div>`;
}

export function onAction(action,value,ctx){
 if(action==='matrix-mode'){ctx.set({matrixMode:value,qShop:''});return true;}
 if(action==='matrix-platform'){ctx.set({platform:value,shop:'',matrixMode:'shops',qShop:'',selectedShop:'',evidenceDate:'',allShops:true});return true;}
 if(action==='matrix-clear'){ctx.set({platform:'',shop:'',qShop:'',selectedShop:'',evidenceDate:''});return true;}
 return false;
}
