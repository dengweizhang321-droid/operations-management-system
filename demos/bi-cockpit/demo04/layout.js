import {createModel,aggregate,products} from '../shared/data.js';

const views=[['trend','趋势变化'],['shops','店铺贡献'],['products','商品结构']];
const sources=[['promotion','推广投入与效率','广告归因证据，独立于ERP销售'],['inventory','库存与供货风险','公司当前快照，独立于证据日期'],['finance','月度盈利摘要','公司完整财报月，不拆日利润'],['quality','数据质量与经营提示','来源覆盖、缺失与可比较资格']];

export function render(ctx){
 const {state:s,model:m,ui,escape:e,money,percent}=ctx;
 const view=s.linkedView||'trend';
 const chosen=m.shops.find(r=>r.id===s.selectedShop);
 const period=m.trends.find(r=>r.date===s.evidenceDate);
 const from=period?.date||s.start,to=period?.end||s.end;
 const local=createModel({...s,start:from,end:to,shop:chosen?.id||s.shop});
 const metric=s.rank==='profit'?'profit':s.rank==='delta'?'delta':'sales';
 const max=Math.max(1,...m.shops.map(r=>Math.abs(r[metric]||0)));
 const storeContribution=`<div class="linked-contributions"><p class="caption">${metric==='profit'?'综合大毛利':metric==='delta'?'销售增减额':'ERP净销售'}（元）· 左负右正，共用零线。点店铺筛选右侧证据。</p>${[...m.shops].sort((a,b)=>(b[metric]??-Infinity)-(a[metric]??-Infinity)).map(r=>`<button class="linked-store ${s.selectedShop===r.id?'selected':''}" data-action="select-shop" data-value="${e(r.id)}" aria-pressed="${s.selectedShop===r.id}"><span>${e(r.name)}<small>${e(r.platform)}</small></span><span class="linked-signed-bar" aria-hidden="true"><i class="${r[metric]<0?'negative':''}" style="width:${Math.abs(r[metric]||0)/max*48}%;${r[metric]<0?'right:50%':'left:50%'}"></i></span><span>${money(r[metric])}<small>毛利率 ${percent(r.margin)}</small></span></button>`).join('')||'<div class="empty">无店铺贡献记录，未导入不计为零。</div>'}<p class="caption">可查看零值、负毛利与缺源；不把金额变化解释为利润率变化。</p></div>`;
 const tabs=`<div class="chips linked-tabs" role="tablist" aria-label="分析视图">${views.map(([id,name])=>`<button role="tab" aria-selected="${view===id}" aria-controls="linked-analysis" data-action="linked-view" data-value="${id}">${name}</button>`).join('')}</div>`;
 const productFocus=`<div class="chips linked-product-focus"><span class="caption">聚焦局部商品证据：</span>${products.map(p=>`<button data-action="linked-product" data-value="${e(p.id)}" aria-pressed="${s.linkedProduct===p.id}">${e(p.id)} ${e(p.name)}</button>`).join('')}</div>`;
 const leftBody=view==='shops'?`${storeContribution}${ui.shopTable()}`:view==='products'?`${productFocus}${ui.productTable()}`:`<div class="notice">点击趋势点，右侧按该日 / 周 / 月期间更新。趋势保留全选期，方便比较变化前后。</div>${ui.trend()}`;
 const focused=products.find(p=>p.id===s.linkedProduct);
 const selectedShops=local.selectedShops;
 const focusData=focused?(s.status==='empty'?{sales:null,profit:null,margin:null}:aggregate(from,to,selectedShops,[focused])):null;
 const productEvidence=focused?`<div class="linked-product-evidence"><div class="row"><h3>${e(focused.name)} · 局部 SKU</h3><button data-action="linked-product" data-value="">取消商品聚焦</button></div><div class="grid2"><div class="fact"><span>局部净销售</span><b>${money(focusData.sales)}</b></div><div class="fact"><span>局部综合大毛利</span><b>${money(focusData.profit)}</b><small>毛利率 ${percent(focusData.margin)}</small></div></div><p class="caption">${e(focused.id)} · ${e(focused.category)} · ${from}—${to} · 不与平台SPU混加</p><button data-action="detail-product" data-value="${e(focused.id)}">打开商品详情（演示）</button></div>`:'';
 const right=`<aside class="panel linked-detail" aria-label="局部联动证据" data-evidence-scope="local"><header class="section-head"><div><h2>联动证据</h2><p class="caption">${chosen?e(chosen.name):'当前筛选全部店铺'} · ${from}—${to}</p></div></header><div class="linked-selection chips"><span class="tag">店铺：${chosen?e(chosen.name):'当前全范围'}</span><span class="tag">证据期：${from}—${to}</span>${focused?`<span class="tag">聚焦SKU：${e(focused.id)}</span>`:''}<button data-action="linked-clear">清除全部局部选择</button></div>${productEvidence}${ui.evidence()}<div class="linked-ad-facts"><h3>同期间广告来源</h3><div class="grid2"><div class="fact"><span>推广花费</span><b>${s.status==='missing'?'未覆盖':money(local.totals.spend)}</b></div><div class="fact"><span>广告归因成交</span><b>${s.status==='missing'?'未覆盖':money(local.totals.attributed)}</b><small>ROAS ${s.status==='missing'||local.totals.roas===null?'未覆盖':local.totals.roas.toFixed(2)+' 倍'}</small></div></div><p class="caption">广告覆盖 ${s.status==='missing'?0:local.totals.promotionCoverage.covered}/${local.totals.promotionCoverage.expected} 店日。来源缺失时不推断零花费；ROAS不是利润率。</p></div><p class="notice warning">联动到此停止：库存仅公司快照 ${m.inventory.snapshot}；财报仅公司完整 ${m.finance.month} 月。没有单店、所选日或广告利润归属证据。</p><div class="chips"><button data-action="section" data-value="inventory">查看公司库存</button><button data-action="section" data-value="finance">查看完整财报月</button></div></aside>`;
 return `<div class="demo04 stack"><div class="notice linked-intro"><strong>全局结果与局部证据分开</strong><span>全局：${s.start}—${s.end} · ${s.platform?e(s.platform):'全部平台'}。图表选择只更新右侧；上方统一筛选更新全局。</span></div><section id="results" data-domain="results">${ui.kpis()}</section><div class="linked-workspace"><section class="panel linked-analysis" id="linked-analysis"><header class="section-head"><div><h2>变化与贡献</h2><p class="caption">全选期 ${s.start}—${s.end} · 当前筛选 ${m.selectedShops.length} 店 · 返回详情保留筛选</p></div></header>${tabs}<div class="linked-view-content" role="tabpanel" data-domain="${view==='trend'?'trend':view==='shops'?'shops':'products'}">${leftBody}</div></section>${right}</div><section class="linked-source-intro"><h2>专业来源与完整经营摘要</h2><p class="caption">展开下方来源，查看全选期商品 / 广告与独立公司库存 / 月报。折叠不代表缺源；缺源已在对应数值标注。</p></section>${view!=='products'?`<details class="linked-source"><summary>商品与品类贡献 · 全选期完整明细</summary>${ui.section('products')}</details>`:''}${view!=='shops'?`<details class="linked-source"><summary>平台与店铺贡献 · 全部店铺明细</summary>${ui.section('shops')}</details>`:''}${view!=='trend'?`<details class="linked-source"><summary>关键经营趋势 · 全选期销售与毛利</summary>${ui.section('trend')}</details>`:''}${sources.map(([id,title,note])=>`<details class="linked-source" ${id==='quality'?'open':''}><summary>${title}<span class="caption">${note}</span></summary>${ui.section(id)}</details>`).join('')}</div>`;
}

export function onAction(action,value,ctx){
 if(action==='linked-view'){ctx.set({linkedView:value});return true;}
 if(action==='linked-product'){ctx.set({linkedProduct:value});return true;}
 if(action==='linked-clear'){ctx.set({selectedShop:'',evidenceDate:'',linkedProduct:''});return true;}
 if(action==='section'&&typeof document!=='undefined'){const node=document.getElementById(value);const fold=node?.closest('details');if(fold)fold.open=true;}
 return false;
}
