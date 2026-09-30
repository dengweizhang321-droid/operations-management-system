/* Isolated synthetic design fixture. No requests, imports, real credentials or business API. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const COLORS = ['#396149', '#779988', '#b6a27a', '#758da3'];
  const DESIGNS = [
    { id: 1, name: 'balanced', title: '均衡对比看板', desc: '摘要 · 趋势 · 结构 · 排名', ref: 'Tremor', url: 'https://blocks.tremor.so/templates' }
  ];
  const CATEGORIES=[{id:'all',name:'全部类目'},{id:'commercial',name:'商用设备'},{id:'cooking',name:'炊事设备'},{id:'parts',name:'配件'},{id:'unknown',name:'未知类目'}];
  const categoryLabel=()=>CATEGORIES.find(category=>category.id===state.categoryId).name;
  const SHOPS = [
    {id:'JD:A', platform:'JD', name:'演示京东 A 店', code:'A', rate:15480, orders:26, visitors:540, spend:1320, cost:.68, prev: .83, categories:[.46,.25,.21,.08], products:58},
    {id:'JD:B', platform:'JD', name:'演示京东 B 店', code:'B', rate:12220, orders:23, visitors:650, spend:1080, cost:.73, prev:1.18, categories:[.29,.44,.19,.08], products:46},
    {id:'JD:C', platform:'JD', name:'演示京东 C 店', code:'C', rate:6980, orders:14, visitors:480, spend:930, cost:.77, prev:0, categories:[.19,.31,.38,.12], products:31},
    {id:'TMALL:D', platform:'TMALL', name:'演示天猫 D 店', code:'D', rate:19320, orders:31, visitors:820, spend:1840, cost:.66, prev:.9, categories:[.54,.18,.23,.05], products:65},
    {id:'TMALL:E', platform:'TMALL', name:'演示天猫 E 店', code:'E', rate:8450, orders:18, visitors:580, spend:760, cost:.76, prev:.97, categories:[.2,.33,.35,.12], products:39}
  ];
  const DEFAULT = {design:1,mode:'shops',platform:'JD',source:'platform',categoryId:'all',grain:'day',coverage:'all',currentStart:'2026-09-01',currentEnd:'2026-09-28',previousStart:'2026-08-01',previousEnd:'2026-08-28',selectedIds:['JD:A','JD:B','JD:C'],page:1,pageSize:3,normalized:false,focusId:'JD:A',expanded:[],permission:'full'};
  let state = {...DEFAULT,selectedIds:[...DEFAULT.selectedIds],expanded:[]};
  let drawer = null;
  let lastData = null;
  let noticeTimer;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const n = (value, digits=0) => value === null || value === undefined || !Number.isFinite(value) ? '—' : value.toLocaleString('zh-CN',{minimumFractionDigits:digits,maximumFractionDigits:digits});
  const money = value => value === null ? '—' : n(value/1000000,2);
  const pct = value => value === null ? '—' : `${n(value*100,1)}%`;
  const yuan = value => value === null ? '—' : n(value/100,1);
  const ratio = (a,b) => a === null || b === null || b <= 0 ? null : a/b;
  const sum = (array,key) => array.reduce((total,row)=>total+(row[key] ?? 0),0);
  const sumKnown = (array,key) => array.length && array.every(row=>row[key] !== null) ? sum(array,key) : null;
  const platformName = p => p === 'JD' ? '京东' : '天猫';
  const amountLabel = () => state.source === 'platform' ? '平台成交金额' : 'ERP 净销售';
  const day = date => new Date(`${date}T00:00:00Z`);
  const iso = date => date.toISOString().slice(0,10);
  const add = (date,days) => {const result=day(date);result.setUTCDate(result.getUTCDate()+days);return iso(result);};
  function dates(start,end){const result=[];for(let date=start;date<=end;date=add(date,1)){result.push(date);if(result.length>366)break;}return result;}
  const currentDates = () => dates(state.currentStart,state.currentEnd);
  const previousDates = () => dates(state.previousStart,state.previousEnd);
  function statusPill(status){return `<span class="pill ${status === 'available' ? '' : status}">${status === 'available' ? '完整覆盖' : status === 'partial' ? '部分覆盖' : '来源缺失'}</span>`;}
  function change(current,previous,currentStatus='available',previousStatus='available'){
    if(previous===null)return {value:null,difference:null,reason:'基期缺失'};
    if(current===null)return {value:null,difference:null,reason:'本期缺失'};
    if(currentStatus !== 'available' || previousStatus !== 'available')return {value:null,difference:null,reason:'覆盖不完整，增长不可计算'};
    if(previous===0)return {value:null,difference:current,reason:'基期为 0，仅显示差额'};
    if(previous<0)return {value:null,difference:current-previous,reason:'负基期，仅显示差额'};
    return {value:(current-previous)/previous,difference:current-previous,reason:null};
  }
  function growthHTML(object){const g=object.growth;return g.value===null?`<span class="muted small" title="${esc(g.reason)}">${g.reason=== '基期为 0，仅显示差额'?'基期 0':g.reason=== '负基期，仅显示差额'?'负基期':g.reason==='基期缺失'?'基期缺失':'不可比'}</span>`:`<span class="${g.value>=0?'up':'down'}">${g.value>=0?'+':''}${pct(g.value)}</span>`;}
  // Synthetic category facts only. Conserves every integer, including negative ERP values.
  function categoryParts(value,shares){
    if(value===null)return shares.map(()=>null);
    const sign=value<0?-1:1,total=Math.abs(value),parts=shares.slice(0,-1).map(share=>Math.floor(total*share));
    parts.push(total-parts.reduce((a,b)=>a+b,0));return parts.map(part=>part*sign);
  }
  const categoryIndex=()=>CATEGORIES.findIndex(category=>category.id===state.categoryId)-1;
  function fixture(shop,date,categoryId=state.categoryId){
    const stamp=day(date),d=stamp.getUTCDate(),m=stamp.getUTCMonth()+1,index=SHOPS.findIndex(item=>item.id===shop.id);
    const baseline=m<9, wave=1+Math.sin((d+index*4)*.63)*.15+Math.cos(d*.18)*.06;
    const factor=(baseline?shop.prev:1)*(m===9&&d>17?1.09:1)*(1+(m-9)*.025);
    const missingProduct=shop.id==='JD:C'&&m===9&&(d===15||d===21) || shop.id==='TMALL:E'&&m===9&&d%7===0;
    const missingERP=shop.id==='TMALL:E'&&baseline;
    const missingPromotion=shop.id==='JD:C'&&m===9&&(d===4||d===16) || shop.id==='TMALL:E'&&m===9&&d%6===0;
    const platformAmount=missingProduct?null:Math.round(shop.rate*100*wave*factor);
    let net=missingERP?null:Math.round(shop.rate*100*wave*factor*.915);
    if(shop.id==='JD:B'&&baseline)net=-Math.round(shop.rate*100*wave*.055);
    const orders=missingProduct?null:Math.round(shop.orders*wave*factor);
    const erpOrders=missingERP?null:Math.round(shop.orders*wave*(baseline?Math.max(shop.prev,.15):1));
    const units=orders===null?null:Math.round(orders*1.17);
    const erpUnits=erpOrders===null?null:Math.round(erpOrders*1.22);
    const spend=missingPromotion?null:Math.round(shop.spend*100*wave*(baseline?Math.max(shop.prev,.3):1));
    const attribution=spend===null?null:Math.round(spend*(shop.platform==='JD'?5.6:6.1)*(1+Math.sin(d*.3+index)*.12));
    const impressions=spend===null?null:Math.round(spend/100*37);
    const clicks=spend===null?null:Math.round(impressions*(.015+index*.0013));
    const cost=net===null?null:Math.round(Math.abs(net)*shop.cost);
    const grossBeforeReturns=net===null?null:Math.round(Math.abs(net)/.953);
    const refund=net===null?null:Math.round(grossBeforeReturns*(.032+index*.005));
    // Independent source fixture: aggregated order margin, deliberately distinct from net minus cost.
    const grossProfit=erpOrders===null||net===null?null:Math.round(erpOrders*(11000+index*2700)*(net<0?-1:1));
    const visitors=platformAmount===null?null:Math.round(shop.visitors*wave*Math.max(factor,.3));
    const facts={date,platformAmount,net,cost,grossProfit,grossBeforeReturns,refund,orders,erpOrders,units,erpUnits,spend,attribution,impressions,clicks,visitors,customers:orders};
    if(categoryId!=='all')for(const key of Object.keys(facts)){if(key!=='date')facts[key]=categoryParts(facts[key],SHOPS[index].categories)[CATEGORIES.findIndex(category=>category.id===categoryId)-1];}
    return facts;
  }
  function period(shop,start,end){
    const all=dates(start,end).map(date=>fixture(shop,date));
    const key=state.source==='platform'?'platformAmount':'net';
    const count=all.filter(row=>row[key]!==null).length;
    const status=count===all.length?'available':count?'partial':'unavailable';
    const promoCount=all.filter(row=>row.spend!==null).length;
    const productCount=all.filter(row=>row.platformAmount!==null).length;
    const erpCount=all.filter(row=>row.net!==null).length;
    const knownSum=k=>all.some(row=>row[k]!==null)?sum(all,k):null;
    return {grossProfitBasis:'synthetic_source_order_margin_sum',amount:knownSum(key),orders:knownSum(state.source==='platform'?'orders':'erpOrders'),units:knownSum(state.source==='platform'?'units':'erpUnits'),net:knownSum('net'),cost:knownSum('cost'),grossProfit:knownSum('grossProfit'),platformAmount:knownSum('platformAmount'),refund:knownSum('refund'),grossBeforeReturns:knownSum('grossBeforeReturns'),spend:knownSum('spend'),attribution:knownSum('attribution'),impressions:knownSum('impressions'),clicks:knownSum('clicks'),visitors:knownSum('visitors'),customers:knownSum('customers'),status,coverage:{requested:all.length,selected:count,product:productCount,erp:erpCount,promotion:promoCount},days:all};
  }
  function attachRatios(object){
    const c=object.current;
    object.ratios={aov:c.status==='available'?ratio(c.amount,c.orders):null,grossMargin:c.coverage.erp===c.coverage.requested?ratio(c.net===null||c.cost===null?null:c.net-c.cost,c.net):null,returnRate:c.coverage.erp===c.coverage.requested?ratio(c.refund,c.grossBeforeReturns):null,conversion:c.coverage.product===c.coverage.requested?ratio(c.customers,c.visitors):null,roas:c.coverage.promotion===c.coverage.requested?ratio(c.attribution,c.spend):null,ctr:c.coverage.promotion===c.coverage.requested?ratio(c.clicks,c.impressions):null,cpc:c.coverage.promotion===c.coverage.requested?ratio(c.spend,c.clicks):null,promotionRate:c.coverage.promotion===c.coverage.requested&&c.coverage.product===c.coverage.requested?ratio(c.spend,c.platformAmount):null};
    object.growth=change(c.amount,object.previous.amount,c.status,object.previous.status);
    object.status=c.status==='available'&&object.previous.status==='available'?'available':c.status==='unavailable'&&object.previous.status==='unavailable'?'unavailable':'partial';
    object.growthReason=object.growth.reason;
    object.coverage=c.coverage;
    return object;
  }
  function aggregatePeriods(periods){
    const keys=['amount','orders','units','net','cost','grossProfit','platformAmount','refund','grossBeforeReturns','spend','attribution','impressions','clicks','visitors','customers'];
    const result={};keys.forEach(key=>result[key]=periods.some(row=>row[key]!==null)?sum(periods,key):null);
    result.coverage={};['requested','selected','product','erp','promotion'].forEach(key=>result.coverage[key]=sum(periods.map(p=>p.coverage),key));
    result.status=periods.length===0?'unavailable':periods.every(p=>p.status==='available')?'available':periods.some(p=>p.status!=='unavailable')?'partial':'unavailable';
    result.reasonCode=periods.length===0?'NO_COMPLETE_OBJECTS':null;
    result.days=[];
    return result;
  }
  function allObjects(){
    let shops=SHOPS.filter(shop=>state.platform==='all'||shop.platform===state.platform);
    if(state.permission==='limited')shops=shops.filter(shop=>['JD:A','TMALL:D'].includes(shop.id));
    const storeObjects=shops.map(shop=>{
      const current=period(shop,state.currentStart,state.currentEnd),previous=period(shop,state.previousStart,state.previousEnd);
      const productFacts=currentDates().map(date=>fixture(shop,date,'all'));
      let products=null;
      if(productFacts.every(row=>row.units!==null)){
        const available=categoryParts(shop.products,shop.categories),sold=categoryParts(sum(productFacts,'units'),shop.categories);
        const counts=available.map((count,index)=>Math.min(count,sold[index]));
        products=state.categoryId==='all'?counts.reduce((a,b)=>a+b,0):counts[categoryIndex()];
      }
      return attachRatios({...shop,type:'shop',children:[],categories:state.categoryId==='all'?shop.categories:shop.categories.map((_,index)=>index===categoryIndex()?1:0),products,current,previous});
    });
    if(state.mode==='shops')return storeObjects;
    return ['JD','TMALL'].map(platform=>{
      const children=storeObjects.filter(shop=>shop.platform===platform);
      if(!children.length)return null;
      const weightTotal=sum(children.map(child=>child.current),'platformAmount');
      const categories=[0,1,2,3].map(index=>weightTotal>0?children.reduce((total,child)=>total+(child.current.platformAmount??0)*child.categories[index],0)/weightTotal:0);
      return attachRatios({id:platform,platform,name:`${platformName(platform)}平台`,code:platformName(platform).slice(0,1),type:'platform',children,current:aggregatePeriods(children.map(c=>c.current)),previous:aggregatePeriods(children.map(c=>c.previous)),categories,categoryBasis:'covered_platform_transaction_weighted',products:sumKnown(children,'products')});
    }).filter(Boolean);
  }
  function compute(){
    const candidates=allObjects();
    const objects=candidates.filter(object=>state.coverage==='all'||(state.coverage==='complete'?object.status==='available':object.status!=='available'));
    const eligible=objects.filter(object=>object.current.status==='available'&&object.previous.status==='available');
    const selected=objects.filter(object=>state.selectedIds.includes(object.id)).slice(0,4);
    const selectedComplete=selected.filter(object=>object.current.status==='available'&&object.previous.status==='available');
    const totalCurrent=aggregatePeriods(selectedComplete.map(object=>object.current));
    const totalPrevious=aggregatePeriods(selectedComplete.map(object=>object.previous));
    const totals=attachRatios({id:'total',current:totalCurrent,previous:totalPrevious});
    if(new Set(selectedComplete.map(object=>object.platform)).size>1){totals.current.attribution=null;totals.previous.attribution=null;totals.ratios.roas=null;totals.ratios.ctr=null;totals.ratios.cpc=null;totals.promotionReason='不同平台归因，仅分组观察，不生成合并推广效率';}
    const previousRank=[...eligible].sort((a,b)=>(b.previous.amount??-Infinity)-(a.previous.amount??-Infinity)).map(o=>o.id);
    const currentRank=[...eligible].sort((a,b)=>(b.current.amount??-Infinity)-(a.current.amount??-Infinity)).map(o=>o.id);
    eligible.forEach(object=>{object.previousRank=previousRank.indexOf(object.id)+1;object.currentRank=currentRank.indexOf(object.id)+1;object.contribution=ratio(object.current.amount,sum(eligible.map(o=>o.current),'amount'));});
    const scopeRows=candidates.flatMap(object=>object.type==='platform'?object.children:[object]);
    const continued=scopeRows.filter(object=>object.previous.amount!==null&&object.previous.amount!==0&&object.current.amount!==null);
    const added=scopeRows.filter(object=>object.previous.amount===0&&object.previous.status==='available'&&object.current.status==='available');
    const unknown=scopeRows.filter(object=>object.previous.amount===null||object.status!=='available');
    return {candidates,objects,eligible,selected,totals,currentRank,previousRank,candidateSets:{current:scopeRows.map(o=>o.id),previous:scopeRows.filter(o=>o.previous.amount!==null).map(o=>o.id),continued:continued.map(o=>o.id),added:added.map(o=>o.id),unknown:unknown.map(o=>o.id)},series:selected.map(seriesFor)};
  }
  function groups(){
    const ds=currentDates(),result=[];
    ds.forEach(date=>{let key=date;if(state.grain==='week'){const d=day(date),offset=(d.getUTCDay()+6)%7;key=add(date,-offset);}if(state.grain==='month')key=date.slice(0,7);let group=result.find(item=>item.key===key);if(!group){group={key,start:date,end:date,dates:[]};result.push(group);}group.end=date;group.dates.push(date);});
    return result;
  }
  function seriesFor(object){
    const buckets=groups(),shops=object.type==='shop'?[object]:object.children;
    const baseline=object.previous.status==='available'&&object.previous.amount!==null&&object.previous.amount>0?object.previous.amount/previousDates().length:null;
    const points=buckets.map(bucket=>{const rows=shops.flatMap(shop=>bucket.dates.map(date=>fixture(shop,date)));const key=state.source==='platform'?'platformAmount':'net';const complete=rows.every(row=>row[key]!==null);const amount=complete?sum(rows,key):null;return {start:bucket.start,end:bucket.end,days:bucket.dates.length,value:state.normalized?(baseline===null||amount===null?null:amount/bucket.dates.length/baseline*100):amount};});
    return {id:object.id,name:object.name,baseline,normalizable:baseline!==null,points};
  }
  const opts=(items,value)=>items.map(([id,label])=>`<option value="${id}" ${id===value?'selected':''}>${label}</option>`).join('');
  function openCustomPeriod(target='current'){
    if(!window.comparisonDatePicker){toast('日期组件正在准备，请稍后刷新。');return;}
    const current=target==='current',opener=document.activeElement;
    window.comparisonDatePicker.open({label:current?'本期自定义时间':'基期自定义时间',startDate:current?state.currentStart:state.previousStart,endDate:current?state.currentEnd:state.previousEnd,minDate:'2025-01-01',maxDate:'2026-09-30',maxDays:366,onApply:(start,end)=>{const result=setState(current?{currentStart:start,currentEnd:end}:{previousStart:start,previousEnd:end});if(opener&&!opener.isConnected)setTimeout(()=>document.querySelector(`[data-testid="custom-${target}"]`)?.focus({preventScroll:true}),0);return result;}});
  }
  function renderFilters(){
    $('filters').innerHTML=`
      <div class="filter-row">
        <div class="field"><span class="field-label">对比模式</span><div class="segment">${[['shops','店铺对比'],['platforms','平台对比']].map(([id,label])=>`<button data-action="mode" data-id="${id}" data-testid="mode-${id}" class="${state.mode===id?'active':''}" aria-pressed="${state.mode===id}">${label}</button>`).join('')}</div></div>
        <div class="field"><label for="category-filter">类目分类</label><select id="category-filter" data-field="categoryId" data-testid="category-filter">${opts(CATEGORIES.map(category=>[category.id,category.name]),state.categoryId)}</select></div>
        <div class="field"><label for="platform-filter">平台</label><select id="platform-filter" data-field="platform" data-testid="platform-filter">${opts([['JD','京东'],['TMALL','天猫'],['all','京东 + 天猫']],state.platform)}</select></div>
        <div class="field"><label for="source-filter">指标来源</label><select id="source-filter" data-field="source" data-testid="source-filter">${opts([['platform','平台成交口径'],['erp','ERP 净销售口径']],state.source)}</select></div>
        <div class="field"><label for="coverage-filter">覆盖状态</label><select id="coverage-filter" data-field="coverage" data-testid="coverage-filter">${opts([['all','全部 · 披露缺口'],['complete','两期完整覆盖'],['partial','任一期部分 / 缺失']],state.coverage)}</select></div>
        <div class="field filter-right"><span class="field-label">趋势粒度</span><div class="segment">${[['day','日'],['week','周'],['month','月']].map(([id,label])=>`<button data-action="grain" data-id="${id}" data-testid="grain-${id}" class="${state.grain===id?'active':''}" aria-pressed="${state.grain===id}">${label}</button>`).join('')}</div></div>
      </div>
      <div class="filter-row period-filter-row">
        <div class="field date-field"><span class="field-label">本期</span><button type="button" class="period-range-button" data-action="custom-period" data-id="current" data-testid="custom-current" aria-label="本期自定义时间"><span>${state.currentStart} 至 ${state.currentEnd}</span><small>自定义时间 ⌄</small></button></div>
        <div class="field date-field"><span class="field-label">基期</span><button type="button" class="period-range-button" data-action="custom-period" data-id="previous" data-testid="custom-previous" aria-label="基期自定义时间"><span>${state.previousStart} 至 ${state.previousEnd}</span><small>自定义时间 ⌄</small></button></div>
        <button class="outline-button" data-action="range" data-id="7" data-testid="range-7">近 7 天</button>
        <button class="text-button filter-right" data-action="reset" data-testid="reset-filters">重置筛选</button>
      </div><div id="filter-error" class="error-line" role="alert"></div>`;
  }
  function renderSelection(data){
    $('selection-bar').innerHTML=`<div class="selection-bar"><div class="object-chips"><span class="small muted">主图对象</span>${data.objects.map(object=>{const index=state.selectedIds.indexOf(object.id),selected=index>=0;return `<button class="object-chip ${selected?'selected':''}" data-action="object" data-id="${object.id}" data-testid="object-${object.id.replace(':','-')}" aria-pressed="${selected}"><i style="background:${selected?COLORS[index%4]:'#becbc2'}"></i>${object.name}${object.status==='partial'?' · 缺日':''}</button>`;}).join('')}<span class="small muted">2–4 个对象${data.objects.length<2?' · 当前筛选不足 2 个':''}</span></div><div class="scope-summary">${state.source==='platform'?'商品 SPU 日成交（演示同维度）':'ERP 净销售（演示可信订单）'}<br>类目：${categoryLabel()} · 本期${currentDates().length}天 / 基期${previousDates().length}天<br>完整排名 ${data.eligible.length} 个 / 候选 ${data.candidates.length} 个</div></div>`;
  }
  function card(title,number,body,span='span-6',subtitle='',tools=''){return `<section class="card ${span}" data-section="3.${number}"><div class="card-head"><div><h2><span class="section-no">3.${number}</span>${title}</h2>${subtitle?`<p>${subtitle}</p>`:''}</div>${tools?`<div class="card-tools">${tools}</div>`:''}</div>${body}</section>`;}
  function kpis(data){
    const t=data.totals,erpComplete=t.current.coverage.requested>0&&t.current.coverage.erp===t.current.coverage.requested;
    const erpLabel=t.current.grossProfit===null?'ERP 订单毛利 · 缺源':erpComplete?'ERP 订单毛利':'ERP 订单毛利 · 已覆盖';
    const erpFoot=erpComplete?'模拟源订单毛利合计 · 非净利润':`ERP 来源 ${t.current.coverage.erp}/${t.current.coverage.requested} 店日 · 其余未提供`;
    const rows=[['完整对象 · '+amountLabel(),money(t.current.amount),'万元',growthHTML(t)],['合成可信订单',n(t.current.orders),'单','同源订单数 · 非客户累计'],['销量',n(t.current.units),'件','订单与件数分别展示'],[erpLabel,money(t.current.grossProfit),'万元',erpFoot],['同源客单价',yuan(t.ratios.aov),'元','合计金额 ÷ 合计订单数']];
    return `<div class="kpi-row">${rows.map(([label,value,unit,foot])=>`<div class="kpi-card"><div class="kpi-label">${label}</div><div class="kpi-value">${value}<small>${unit}</small></div><div class="kpi-foot">${foot}</div></div>`).join('')}</div>`;
  }
  function trend(data,large=false){
    const series=data.selected.map(seriesFor),valid=series.flatMap(s=>s.points.map(p=>p.value)).filter(v=>v!==null);
    const min=valid.length?Math.min(0,...valid):0,max=valid.length?Math.max(...valid)*1.15:1;
    const range=max-min||1,W=720,H=large?300:250,L=57,R=18,T=18,B=44;
    const buckets=groups(),x=i=>L+(W-L-R)*(buckets.length===1?.5:i/(buckets.length-1)),y=v=>T+(max-v)/range*(H-T-B);
    let svg=`<svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(amountLabel())} ${state.normalized?'有效基准归一趋势':'绝对值趋势'}" data-testid="trend-chart">`;
    for(let i=0;i<5;i++){const v=min+range*i/4,yy=y(v);svg+=`<line class="gridline" x1="${L}" x2="${W-R}" y1="${yy}" y2="${yy}"/><text class="axis-label" x="${L-9}" y="${yy+4}" text-anchor="end">${state.normalized?n(v):n(v/1000000,1)}</text>`;}
    const labelIndexes=[...new Set(Array.from({length:Math.min(6,buckets.length)},(_,i)=>Math.round(i*(buckets.length-1)/Math.max(1,Math.min(6,buckets.length)-1))))];
    labelIndexes.forEach(i=>{const bucket=buckets[i];svg+=`<text x="${x(i)}" y="${H-17}" text-anchor="middle">${bucket.start.slice(5)}${bucket.start!==bucket.end?'–'+bucket.end.slice(5):''}</text>`;});
    series.forEach((s,index)=>{let path='',connected=false;s.points.forEach((point,i)=>{if(point.value===null){connected=false;return;}path+=`${connected?'L':'M'}${x(i).toFixed(2)},${y(point.value).toFixed(2)} `;connected=true;});svg+=`<path d="${path}" fill="none" stroke="${COLORS[index]}" stroke-width="2.6" stroke-linejoin="round"/>`;s.points.forEach((point,i)=>{if(point.value===null)return;const value=state.normalized?n(point.value,1):`${money(point.value)} 万元`;svg+=`<circle class="point" cx="${x(i)}" cy="${y(point.value)}" r="${buckets.length>40?2:3.5}" fill="${COLORS[index]}" data-tip="${esc(s.name+'|'+point.start+(point.end!==point.start?' 至 '+point.end+' · '+point.days+'天':'')+'|'+value)}"><title>${esc(s.name)} · ${point.start}：${value}</title></circle>`;});});
    svg+='</svg>';
    const invalid=state.normalized?series.filter(s=>!s.normalizable):[];
    return `<div class="summary-strip"><span>纵轴：<strong>${state.normalized?'指数（基期日均 = 100）':'万元'}</strong></span><span>横轴：${state.grain==='week'?'自然周 · 首尾截段':state.grain==='month'?'自然月 · 实际范围':'业务日期'}</span></div><div class="chart-wrap">${svg}</div><div class="legend">${series.map((s,index)=>`<span class="${state.normalized&&!s.normalizable?'legend-invalid':''}"><i style="background:${COLORS[index]}"></i>${s.name}${state.normalized&&!s.normalizable?' · 基准无效':''}</span>`).join('')}</div><p class="plain-note">缺日折线断开，不补 0。归一化按每桶日均 / 同对象完整基期日均 × 100，截段天数已披露。</p>${invalid.length?`<div class="warning-note">${invalid.map(s=>s.name).join('、')}：基期为 0、负值、缺失或覆盖不足，不绘制指数。</div>`:''}`;
  }
  function trendCard(data,span='span-7'){return card('趋势对比',3,trend(data),span,'统一指标和日期；相对走势仅使用有效基准',`<div class="segment"><button data-action="normalize" data-id="false" class="${!state.normalized?'active':''}">绝对值</button><button data-action="normalize" data-id="true" data-testid="normalize-toggle" class="${state.normalized?'active':''}">基准 100</button></div>`);}
  function scatter(data){
    const objects=data.selected.filter(o=>o.status==='available'&&o.ratios.aov!==null&&o.current.amount!==null&&o.current.amount>=0);
    const W=440,H=248,L=52,R=25,T=20,B=48,maxX=Math.max(1,...objects.map(o=>Math.abs(o.current.amount)))*1.18,maxY=Math.max(1,...objects.map(o=>o.ratios.aov))*1.3;
    let svg=`<svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="规模与客单价分布"><text x="${L}" y="13">客单价（元）</text>`;
    for(let i=0;i<4;i++){const yy=H-B-i*(H-T-B)/3;svg+=`<line class="gridline" x1="${L}" x2="${W-R}" y1="${yy}" y2="${yy}"/><text x="${L-8}" y="${yy+4}" text-anchor="end">${n(maxY*i/3/100)}</text>`;}
    objects.forEach(o=>{const index=data.selected.indexOf(o),xx=L+Math.max(0,o.current.amount)/maxX*(W-L-R),yy=H-B-o.ratios.aov/maxY*(H-T-B);svg+=`<circle cx="${xx}" cy="${yy}" r="${8+Math.sqrt(o.current.orders||0)/5}" fill="${COLORS[index]}" fill-opacity=".7"/><text x="${xx}" y="${yy-22}" text-anchor="middle">${o.name.replace('演示','')}</text>`;});
    svg+=`<text x="${L}" y="${H-24}">0</text><text x="${W-R}" y="${H-24}" text-anchor="end">${money(maxX)}</text><text x="${W-R}" y="${H-3}" text-anchor="end">${esc(amountLabel())}（万元）</text></svg>`;
    return `<div class="chart-wrap">${svg}</div>`+`<p class="plain-note">气泡大小：订单数。仅对完整覆盖对象绘图；不计算综合评分。负值净销售不用于规模气泡。</p>`;
  }
  function efficiencyTable(data){return `<div class="table-wrap"><table><thead><tr><th>对象</th><th>客单价 / 元</th><th>大毛利率</th><th>退货金额率</th><th>商品累计转化率</th></tr></thead><tbody>${data.selected.map(o=>`<tr><td>${o.name}</td><td>${yuan(o.ratios.aov)}</td><td>${pct(o.ratios.grossMargin)}</td><td>${pct(o.ratios.returnRate)}</td><td>${pct(o.ratios.conversion)}</td></tr>`).join('')}</tbody></table></div><p class="plain-note">客单价=同源金额/可信订单数；大毛利率=(ERP净销售−成本)/ERP净销售；退货金额率=退货金额/退货前销售金额。商品累计转化率仅演示同 SPU 维度，不当店铺去重转化。</p>`;}
  function efficiencyCard(data,span='span-5'){return card('经营效率',2,scatter(data),span,'横轴规模，纵轴效率；比率按分子分母重算',`<button class="text-button" data-action="efficiency-detail">指标矩阵 ↗</button>`);}
  function structure(data){
    const cats=['商用设备','炊事设备','配件','未知类目'];
    const priceDistributions=[[10,20,40,30],[20,45,25,10],[70,25,4,1],[18,36,29,17]];
    const bands=state.categoryId==='all'?[18,36,29,17]:priceDistributions[categoryIndex()];
    const objects=data.selected;
    const total=sum(objects.filter(o=>o.status==='available').map(o=>o.current),'amount');
    const leafIds=objects.flatMap(o=>o.type==='platform'?o.children:[o]).map(o=>o.id);
    const mapped=leafIds.includes('JD:A')&&leafIds.includes('JD:B')&&['all','commercial'].includes(state.categoryId);
    return `<div class="legend">${cats.map((c,i)=>`<span><i style="background:${COLORS[i]}"></i>${c}</span>`).join('')}</div>${objects.map(o=>`<div class="stacked-row"><span>${o.name.replace('演示','')}</span><div class="stacked-bar">${o.categories.map((share,i)=>`<span style="width:${share*100}%;background:${COLORS[i]}" title="${cats[i]} ${pct(share)}">${share>=.18?n(share*100)+'%':''}</span>`).join('')}</div><span>${o.coverage.product===o.coverage.requested?'成交占比':'已覆盖范围'}</span></div>`).join('')}<div class="structure-detail"><div class="structure-stat">完整对象成交商品<strong>${n(sumKnown(objects.filter(o=>o.status==='available'),'products'))}</strong>SPU · 店铺内唯一</div><div class="structure-stat">TOP 5 集中度<strong>${total>0?(state.categoryId==='all'?'54.6%':['62.4%','48.1%','71.2%','54.6%'][categoryIndex()]):'—'}</strong>合成完整商品全集</div><div class="structure-stat">未知类目<strong>保留</strong>不归入其他已知类目</div></div><div class="pricebands"><span>价格带：成交均价（元/件）</span><span>≤200 · (200,500] · (500,1000] · &gt;1000</span></div><div class="mini-bars" style="margin-top:12px">${['≤200','200–500','500–1000','>1000'].map((label,index)=>[label,bands[index]]).map(([label,value])=>`<div class="mini-bar-row"><span>${label} 元 / 件</span><div class="bar-track"><div class="bar-fill" style="width:${value}%;opacity:.75"></div></div><span>${value}%</span></div>`).join('')}</div><p class="plain-note">类目与价格带为本期合成商品事实占比；平台类目按各店已覆盖成交金额加权，缺覆盖仅代表已覆盖范围；未知保留。跨店同款仅使用验证映射 M-001，商品 ID 相同也不合并。</p><div class="link-actions"><button class="text-button" data-action="${mapped?'product-detail':'product-unmapped'}" data-id="${objects[0]?.id||''}">${mapped?'查看同款 M-001':'缺少同款映射'} ↗</button><button class="text-button" data-action="product-unmapped">无同款映射示例 ↗</button></div>`;
  }
  function structureCard(data,span='span-6'){return card('商品与类目结构',4,structure(data),span,'类目占比、集中度与价格带；不按名称推断同款');}
  function promotion(data){
    const same=data.selected.length?data.selected[0].platform:null;
    const cross=data.selected.some(o=>o.platform!==same);
    return `${cross?'<div class="warning-note" style="margin-top:0;margin-bottom:12px">跨平台仅分组观察。京东总订单金额与天猫净成交归因不同，ROAS、归因成交不混合排名或合并汇总。</div>':''}<div class="table-wrap"><table><thead><tr><th>平台 / 对象</th><th>投入 / 万元</th><th>投入占比</th><th>归因成交 / 万元</th><th>ROAS</th><th>CTR</th><th>CPC / 元</th><th>费率</th><th>变化</th></tr></thead><tbody>${['JD','TMALL'].flatMap(platform=>{const list=data.selected.filter(o=>o.platform===platform);const complete=list.filter(o=>o.coverage.promotion===o.coverage.requested);const spend=sum(complete.map(o=>o.current),'spend');return list.map(o=>{const prevRate=o.previous.coverage.promotion===o.previous.coverage.requested&&o.previous.coverage.product===o.previous.coverage.requested?ratio(o.previous.spend,o.previous.platformAmount):null;const difference=o.ratios.promotionRate!==null&&prevRate!==null?(o.ratios.promotionRate-prevRate)*100:null;return `<tr><td><button class="table-object" data-action="promotion-detail" data-id="${o.id}">${o.name}<small>${platformName(o.platform)} · ${o.platform==='JD'?'总订单金额':'净成交金额'}归因</small></button></td><td>${money(o.current.spend)}</td><td>${o.coverage.promotion===o.coverage.requested?pct(ratio(o.current.spend,spend)):'—'}</td><td>${money(o.current.attribution)}</td><td>${n(o.ratios.roas,2)}</td><td>${pct(o.ratios.ctr)}</td><td>${yuan(o.ratios.cpc)}</td><td>${pct(o.ratios.promotionRate)}</td><td>${difference===null?'—':(difference>=0?'+':'')+n(difference,1)+'pp'}</td></tr>`;});}).join('')}</tbody></table></div><p class="plain-note">投入占比仅在同平台、完整推广覆盖的候选中计算；已覆盖合计显式展示，缺覆盖比率为 —。费率按同店同日完整花费/平台成交，变化为百分点。ROAS=归因成交/花费，非利润 ROI。</p><div class="link-actions"><button class="text-button" data-action="promotion-detail" data-id="${data.selected[0]?.id||''}">打开隔离推广专题 ↗</button></div>`;
  }
  function promotionCard(data,span='span-6'){return card('推广对比',5,promotion(data),span,'优先同平台，归因窗口未验证不推断自然/付费占比');}
  function coverage(data,compact=false){
    const rows=data.candidates.flatMap(o=>o.type==='platform'?o.children:[o]);
    const complete=rows.filter(o=>o.current.status==='available'&&o.previous.status==='available');
    const bothSources=rows.filter(o=>o.current.coverage.product===o.current.coverage.requested&&o.current.coverage.promotion===o.current.coverage.requested);
    const coverageSum=key=>`${n(sum(rows.map(o=>o.current.coverage),key))} / ${n(sum(rows.map(o=>o.current.coverage),'requested'))}`;
    return `<div class="coverage-grid"><div class="coverage-item"><div class="small muted">完整可比较对象</div><strong>${complete.length} / ${rows.length}</strong><p>两期来源覆盖均成立</p></div><div class="coverage-item"><div class="small muted">平台商品日</div><strong>${coverageSum('product')}</strong><p>按店 × 日核验</p></div><div class="coverage-item"><div class="small muted">推广日</div><strong>${coverageSum('promotion')}</strong><p>可算整期费率 ${bothSources.length} 店</p></div></div>${compact?'':`<div class="table-wrap" style="margin-top:12px"><table class="coverage-table"><thead><tr><th>精确身份</th><th>纳入 / 排除原因</th><th>商品日</th><th>ERP 日</th><th>推广日</th><th>基期</th></tr></thead><tbody>${rows.map(o=>`<tr><td>${o.name}<small class="muted" style="display:block">${o.id}</small></td><td>${o.current.status==='available'&&o.previous.status==='available'?'纳入完整排名':'可查看；排除完整排名'}${o.growthReason?`<small style="display:block" class="muted">${o.growthReason}</small>`:''}</td><td>${o.coverage.product}/${o.coverage.requested}</td><td>${o.coverage.erp}/${o.coverage.requested}</td><td>${o.coverage.promotion}/${o.coverage.requested}</td><td>${statusPill(o.previous.status)}</td></tr>`).join('')}</tbody></table></div>`}<p class="plain-note">本期候选 ${data.candidateSets.current.length} 店；基期有来源 ${data.candidateSets.previous.length} 店。先按全部精确身份配对，再排名分页。平台展开店铺只展示解释，不追加到平台合计。</p><div class="warning-note">持续店铺变化与范围变化：${data.candidateSets.unknown.length?'存在覆盖或历史缺口，当前不做完整拆分。':'合成身份与两期均完整，可展示持续对象差额与新增范围差额。'}零基期不自动判新开店。</div>`;
  }
  function coverageCard(data,span='span-12'){return card('可比性与差异',6,coverage(data),span,'来源截止日与覆盖分别核验，不以最后有数据日期代替完整性');}
  function ranking(data,compact=false){
    const ranked=[...data.eligible].sort((a,b)=>b.current.amount-a.current.amount);
    const excluded=data.objects.filter(o=>!data.eligible.some(e=>e.id===o.id));
    const all=[...ranked,...excluded];
    const pageCount=Math.max(1,Math.ceil(all.length/state.pageSize));state.page=Math.min(state.page,pageCount);
    const visible=all.slice((state.page-1)*state.pageSize,state.page*state.pageSize);
    const row=o=>{const eligible=data.eligible.some(e=>e.id===o.id);return `<tr class="${state.focusId===o.id?'selected-row':''}" data-testid="row-${o.id.replace(':','-')}"><td><button class="table-object" data-action="${o.type==='platform'?'expand':state.design===3?'focus':'store-detail'}" data-id="${o.id}" data-testid="${o.type==='platform'?'expand-platform-'+o.id:'store-'+o.id.replace(':','-')}">${o.type==='platform'?(state.expanded.includes(o.id)?'⌄ ':'› '):''}${o.name}<small>${eligible?'#'+o.currentRank+' · 基期 #'+o.previousRank:'排除完整排名'} · ${o.id}</small></button></td><td>${money(o.current.amount)}${o.status==='partial'?'<small class="muted" style="display:block">已覆盖合计</small>':''}</td><td>${money(o.previous.amount)}</td><td>${o.growth.difference===null?'—':money(o.growth.difference)}</td><td>${growthHTML(o)}</td>${compact?'':`<td>${pct(o.contribution??null)}</td><td>${n(o.current.orders)}</td><td>${yuan(o.ratios.aov)}</td><td>${pct(o.ratios.grossMargin)}</td><td>${pct(o.ratios.returnRate)}</td><td>${money(o.current.spend)}</td>`}<td>${statusPill(o.status)}</td></tr>${o.type==='platform'&&state.expanded.includes(o.id)?o.children.map(child=>`<tr class="table-subrow"><td><button class="table-object" data-action="store-detail" data-id="${child.id}">↳ ${child.name}<small>${child.id} · 平台内解释</small></button></td><td>${money(child.current.amount)}</td><td>${money(child.previous.amount)}</td><td>${money(child.growth.difference)}</td><td>${growthHTML(child)}</td>${compact?'':'<td>—</td><td>'+n(child.current.orders)+'</td><td>'+yuan(child.ratios.aov)+'</td><td>'+pct(child.ratios.grossMargin)+'</td><td>'+pct(child.ratios.returnRate)+'</td><td>'+money(child.current.spend)+'</td>'}<td>${statusPill(child.status)}</td></tr>`).join(''):''}`;};
    return `<div class="table-wrap"><table data-testid="ranking-table"><thead><tr><th>对象 / 两期排名</th><th>本期 / 万元</th><th>基期 / 万元</th><th>差额 / 万元</th><th>增长</th>${compact?'':'<th>贡献占比</th><th>订单</th><th>客单价 / 元</th><th>大毛利率</th><th>退货金额率</th><th>推广 / 万元</th>'}<th>覆盖</th></tr></thead><tbody>${visible.map(row).join('')||'<tr><td colspan="12">当前筛选没有候选对象，请调整平台或覆盖筛选。</td></tr>'}</tbody></table></div><div class="pager"><span>共 ${all.length} 个候选 · 完整排名 ${ranked.length} 个 · 缺口对象单列<span class="small">（本地分页演示，正式需服务端分页）</span></span><div class="pager-controls"><button data-action="page" data-id="-1" data-testid="rank-previous" ${state.page<=1?'disabled':''} aria-label="上一页">‹</button><span>${state.page} / ${pageCount}</span><button data-action="page" data-id="1" data-testid="rank-next" ${state.page>=pageCount?'disabled':''} aria-label="下一页">›</button></div></div>`;
  }
  function rankingCard(data,span='span-12',compact=false){return card('规模与增长排名',1,ranking(data,compact),span,'完整候选两期配对后排序；覆盖不完整对象保留可查看',`<button class="text-button" data-action="definitions">列口径 ↗</button>`);}
  function balanced(data){return `${kpis(data)}<div class="content-grid">${trendCard(data)}${efficiencyCard(data)}${structureCard(data)}${promotionCard(data)}${rankingCard(data)}${coverageCard(data)}</div>`;}
  function render(){
    const data=compute();lastData=data;
    renderFilters();renderSelection(data);
    $('content').innerHTML=balanced(data)+`<p class="design-reference">版式参考：<a href="${DESIGNS[state.design-1].url}" target="_blank" rel="noopener noreferrer">${DESIGNS[state.design-1].ref}</a> · 借鉴信息组织方式，使用原系统绿色、字体和涨跌约定。</p>`;
    if(drawer)renderDrawer();
  }
  function definitions(){
    return `<h2>比较集合与指标定义</h2><p class="plain-note">所有数字均为合成夹具；正式口径须复用已验收的共享源与冻结契约。</p><div class="table-wrap"><table class="definition-table"><tbody>${[
      ['对象全集','先按平台+精确店铺身份组成两期候选全集，再配对、计算与分页；平台模式只含父平台聚合。'],
      ['完整 / 部分','部分金额披露已覆盖合计，但增长不填 0 或冒充完整；整期费率与效率缺覆盖主值为空。'],
      ['金额 / 订单','平台商品 SPU 日成交与 ERP 净销售分别展示。合成夹具有可信订单数，客单价=同源金额/同源订单数。正式 ERP 现字段若为净额/净件数，只能称件均净额。'],
      ['订单毛利 / 大毛利率','订单毛利读取独立模拟源字段合计，不等于净销售−成本；合成大毛利率=(净销售−成本)/净销售。正式源复用既有销售定义，不把任意订单毛利率替代。'],
      ['退货金额率','合成退货金额/退货前销售金额；不混用订单率或件数率。'],
      ['加权比例','平台聚合、总体效率、ROAS、CTR、CPC均按合计分子/合计分母重算，不平均店铺百分比。跨平台归因不汇总 ROAS。'],
      ['类目筛选','使用合成商品类目事实演示，全部指标同范围联动；生产需精确商品分类及ERP/推广映射后查询，不用店铺总额按比例估算。未知类目保留。'],
      ['基期','正基期且两期完整时计算增长；0、负值、缺失分别解释，0/负基期仅显示可信差额。'],
      ['归一化','以同对象完整基期日均=100；分桶按日均计算。基期0、负值、缺失或不完整均不强算指数。'],
      ['推广','京东总订单金额、天猫净成交金额保留原口径；优先同平台。整期费率须逐店逐日完整。'],
      ['商品身份 / 结构','平台+店铺+SPU/SKU+ID；ID同为10001也不合并。仅验证映射M-001允许同款对照，未知类目保留。'],
      ['价格带','本期成交均价=商品成交金额/成交件数，区间≤200、(200,500]、(500,1000]、>1000元/件。不是当前标价。'],
      ['权限 / 依赖','Demo控制可演示受限店铺；真实权限、readers、公共路由、字段及全景/商品/推广目标均由总控冻结和接线。']
    ].map(([label,value])=>`<tr><td>${label}</td><td>${value}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function openDetail(kind,id){
    drawer={kind,id,returnState:structuredClone(state)};renderDrawer();
    setTimeout(()=>document.querySelector('.drawer-close')?.focus(),0);
  }
  function renderDrawer(){
    const kind=drawer.kind,data=compute();
    let object=data.candidates.find(o=>o.id===drawer.id)||data.candidates.flatMap(o=>o.children||[]).find(o=>o.id===drawer.id);
    if(!object&&!drawer.id)object=data.selected[0];
    let title='指标与比较口径',body=definitions();
    if(kind==='coverage'){title='可比性完整审计';body=coverage(data);}
    if(kind==='efficiency'){title='经营效率指标矩阵';body=efficiencyTable(data)+scatter(data);}
    if(kind==='store'){
      title='店铺全景 · 隔离详情';
      body=object?`<h2>${object.name}</h2><div class="identity">${object.id} · module=shop · view=analysis<br>本期 ${state.currentStart} — ${state.currentEnd}<br>类目：${categoryLabel()}<br>基期 ${state.previousStart} — ${state.previousEnd}</div><div class="mini-kpis" style="margin-top:16px"><div>${amountLabel()}<strong>${money(object.current.amount)}</strong>万元</div><div>客单价<strong>${yuan(object.ratios.aov)}</strong>元</div><div>大毛利率<strong>${pct(object.ratios.grossMargin)}</strong>ERP</div></div>${trend({...data,selected:[object]})}<div class="link-actions"><button class="text-button" data-action="product-detail" data-id="${object.id}">商品表现 ↗</button><button class="text-button" data-action="promotion-detail" data-id="${object.id}">推广分析 ↗</button></div>`:'<div class="empty-state">未授权或当前范围不存在此对象</div>';
    }
    if(kind==='product'||kind==='unmapped'){
      title='商品表现 · 隔离详情';
      const scope=object?.type==='platform'?object.children[0]:object;
      const authorizedIds=data.candidates.flatMap(o=>o.type==='platform'?o.children:[o]).map(o=>o.id);
      const mappingAvailable=['all','commercial'].includes(state.categoryId)&&scope&&['JD:A','JD:B'].includes(scope.id)&&authorizedIds.includes('JD:A')&&authorizedIds.includes('JD:B');
      const unmapped=kind==='unmapped'||!mappingAvailable;
      if(!scope){
        body='<div class="empty-state">未授权或当前范围不存在此商品对象；不展示其他范围的身份或事实。</div>';
      }else if(!['all','commercial'].includes(state.categoryId)){
        body=`<h2>${categoryLabel()} · 单品明细未提供</h2><div class="identity">${esc(scope.id)} | SPU<br>类目：${categoryLabel()}<br>本期 ${state.currentStart} — ${state.currentEnd}<br>基期 ${state.previousStart} — ${state.previousEnd}</div><div class="empty-state">当前类目的演示数据未提供已验证单品明细，不能用其他类目的商品替代。</div>`;
      }else{
        const rows=unmapped?[{id:scope.id,category:'商用设备',price:'586 元/件'}]:[{id:'JD:A',category:'商用设备',price:'586 元/件'},{id:'JD:B',category:'商用设备',price:'532 元/件'}];
        body=`<h2>${unmapped?'未映射商品：名称相似不合并':'已验证同款：商用设备 M-001'}</h2><div class="identity">${esc(scope.id)} | SPU | 10001<br>当前筛选：${categoryLabel()} · 本期 ${state.currentStart} — ${state.currentEnd}<br>${unmapped?'当前范围缺少已验证映射；只展示该精确商品身份。':'对照 JD:A / JD:B | SPU | 10001；精确身份不同，事实保持隔离。'}</div><div class="warning-note">${unmapped?'同款映射 unavailable / UNMAPPED。禁止按名称、图片或相同ID猜测关联；无法形成同款排名。':'合成映射 M-001 已验证规格与有效期间，仅用于同款演示；正式同款必须依赖P验收映射。'}</div><div class="table-wrap" style="margin-top:16px"><table><thead><tr><th>精确身份</th><th>同款关系</th><th>类目</th><th>当前标价（演示快照）</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${esc(row.id)} / SPU / 10001</td><td>${unmapped?'未关联':'M-001'}</td><td>${row.category}</td><td>${row.price}</td></tr>`).join('')}</tbody></table></div><p class="plain-note">当前标价为2026-09-30合成快照，不替代所选期间的成交均价。类目、日期、来源和精确店铺身份保持。</p>`;
      }
    }
    if(kind==='promotion'){
      title='推广分析 · 隔离详情';body=object?`<div class="identity">module=shop · view=promotion<br>${object.id} · ${state.currentStart} — ${state.currentEnd} · ${categoryLabel()}</div><h2>${object.name} · 推广经营</h2>${promotion({...data,selected:[object]})}<div class="warning-note">归因窗口是合成说明，正式窗口必须由A提供。没有计划/关键词明细来源时保持能力 unavailable。</div>`:'<div class="empty-state">当前范围无推广对象</div>';
    }
    $('drawer-root').innerHTML=`<div class="drawer-backdrop" data-action="close-detail"></div><section class="drawer" role="dialog" aria-modal="true" aria-label="${title}" data-testid="detail-drawer"><div class="drawer-header"><h3>${title}</h3><button class="drawer-close" data-action="close-detail" data-testid="detail-close">返回对比 ×</button></div><div class="demo-notice"><strong>合成详情</strong><span>正式目标与接口待总控确认真实存在后接线。</span></div>${body}<p class="permissions-note" style="margin-top:18px">只读交互示例。关闭详情返回原筛选、对象、版式、章节及页码。</p></section>`;
    document.body.style.overflow='hidden';
  }
  function closeDetail(){drawer=null;$('drawer-root').innerHTML='';document.body.style.overflow='';}
  function toast(message){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$('toast').classList.remove('show'),2500);}
  function validate(next){
    for(const key of ['currentStart','currentEnd','previousStart','previousEnd']){if(!/^\d{4}-\d{2}-\d{2}$/.test(next[key])||!Number.isFinite(day(next[key]).valueOf())||iso(day(next[key]))!==next[key])throw new Error('请选择有效的业务日期。');if(next[key]>'2026-09-30')throw new Error('合成Demo截止日为 2026-09-30，不支持未来日期。');}
    if(next.currentStart>next.currentEnd||next.previousStart>next.previousEnd)throw new Error('开始日期不能晚于结束日期。');
    if((day(next.currentEnd)-day(next.currentStart))/86400000>=366||(day(next.previousEnd)-day(next.previousStart))/86400000>=366)throw new Error('Demo单期最多366天；正式上限由契约冻结。');
    if(![1].includes(+next.design)||!['shops','platforms'].includes(next.mode)||!['JD','TMALL','all'].includes(next.platform)||!['platform','erp'].includes(next.source)||!['day','week','month'].includes(next.grain)||!['all','complete','partial'].includes(next.coverage)||!CATEGORIES.some(category=>category.id===next.categoryId))throw new Error('筛选值无效。');
  }
  function setState(patch={}){
    const next={...state,...patch};validate(next);
    const scopeChanged=['mode','platform','source','categoryId','coverage','currentStart','currentEnd','previousStart','previousEnd','permission'].some(k=>next[k]!==state[k]);
    if(scopeChanged&&!Object.hasOwn(patch,'page'))next.page=1;
    if(next.mode!==state.mode||next.platform!==state.platform){next.expanded=[];if(!Object.hasOwn(patch,'selectedIds'))next.selectedIds=[];}
    state=next;
    const objects=compute().objects,validIds=objects.map(o=>o.id);
    state.selectedIds=[...new Set(state.selectedIds)].filter(id=>validIds.includes(id)).slice(0,4);
    if(state.selectedIds.length<Math.min(2,objects.length))state.selectedIds=[...new Set([...state.selectedIds,...validIds])].slice(0,Math.min(3,objects.length));
    if(!validIds.includes(state.focusId))state.focusId=state.selectedIds[0]||validIds[0]||null;
    render();return snapshot();
  }
  function snapshot(){
    const data=compute();
    return structuredClone({schemaVersion:'comparison-selected-demo-v2',synthetic:true,state,objects:data.objects,eligibleIds:data.eligible.map(o=>o.id),selectedIds:data.selected.map(o=>o.id),totals:data.totals,series:data.series,candidateSets:data.candidateSets,currentRank:data.currentRank,previousRank:data.previousRank,drawer:drawer?{kind:drawer.kind,id:drawer.id}:null});
  }
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-action]');if(!button||button.disabled)return;
    const action=button.dataset.action,id=button.dataset.id;
    try{
      if(action==='system-menu'){const head=document.querySelector('.system-masthead');head.classList.toggle('menu-open');button.setAttribute('aria-expanded',String(head.classList.contains('menu-open')));}
      else if(action==='preview-navigation')toast('当前为店铺与平台对比设计预览，其他栏目等待正式接线。');
      else if(action==='show-period')openCustomPeriod('current');
      else if(action==='custom-period')openCustomPeriod(id);
      else if(action==='design')setState({design:+id});
      else if(action==='mode')setState({mode:id,platform:id==='platforms'?'all':state.platform});
      else if(action==='grain')setState({grain:id});
      else if(action==='normalize')setState({normalized:id==='true'});
      else if(action==='reset')setState({...DEFAULT,design:state.design,selectedIds:[...DEFAULT.selectedIds],expanded:[]});
      else if(action==='range'){const length=+id;setState({currentStart:add('2026-09-30',1-length),currentEnd:'2026-09-30',previousStart:add('2026-09-30',1-length*2),previousEnd:add('2026-09-30',-length)});}
      else if(action==='object'){let selected=[...state.selectedIds];if(selected.includes(id)){if(selected.length<=Math.min(2,lastData.objects.length)){toast('主图保留至少 2 个对象；单对象观察可用工作台或详情。');return;}selected=selected.filter(item=>item!==id);}else{if(selected.length>=4){toast('主图最多同时显示 4 个对象，请先取消一个。');return;}selected.push(id);}setState({selectedIds:selected});}
      else if(action==='page')setState({page:Math.max(1,state.page+Number(id))});
      else if(action==='focus')setState({focusId:id});
      else if(action==='expand')setState({expanded:state.expanded.includes(id)?state.expanded.filter(x=>x!==id):[...state.expanded,id]});
      else if(action==='definitions')openDetail('definitions');
      else if(action==='store-detail')openDetail('store',id);
      else if(action==='product-detail')openDetail('product',id);
      else if(action==='product-unmapped')openDetail('unmapped',id);
      else if(action==='promotion-detail')openDetail('promotion',id);
      else if(action==='coverage-detail')openDetail('coverage');
      else if(action==='efficiency-detail')openDetail('efficiency');
      else if(action==='close-detail')closeDetail();
    }catch(error){toast(error.message);}
  });
  document.addEventListener('change',event=>{const field=event.target.dataset.field;if(!field)return;try{setState({[field]:event.target.value});}catch(error){$('filter-error').textContent=error.message;event.target.value=state[field];}});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')closeDetail();if(event.key==='Tab'&&drawer){const focusable=[...document.querySelectorAll('.drawer button,.drawer a,.drawer input,.drawer select')].filter(el=>!el.disabled);if(!focusable.length)return;const first=focusable[0],last=focusable[focusable.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}});
  document.addEventListener('pointerover',event=>{const point=event.target.closest('[data-tip]');if(!point)return;const wrap=point.closest('.chart-wrap');wrap.querySelector('.chart-tooltip')?.remove();const tooltip=document.createElement('div');tooltip.className='chart-tooltip';const parts=point.dataset.tip.split('|');tooltip.innerHTML=`<strong>${esc(parts[0])}</strong>${esc(parts[1])}<br>${esc(parts[2])}`;const box=wrap.getBoundingClientRect(),pt=point.getBoundingClientRect();tooltip.style.left=Math.min(Math.max(0,pt.left-box.left),Math.max(0,box.width-220))+'px';tooltip.style.top='15px';wrap.append(tooltip);});
  document.addEventListener('pointerout',event=>{if(event.target.closest('[data-tip]'))event.target.closest('.chart-wrap')?.querySelector('.chart-tooltip')?.remove();});
  window.comparisonDemo=Object.freeze({setState,snapshot,openDetail,closeDetail,designs:DESIGNS.map(({id,name,title})=>({id,name,title})),fixtures:SHOPS.map(({id,platform,name})=>({id,platform,name})),reset:()=>setState({...DEFAULT,selectedIds:[...DEFAULT.selectedIds],expanded:[]})});
  const masthead=document.querySelector('.system-masthead');
  const subnav=document.querySelector('.system-subnav');
  const syncShell=()=>{document.documentElement.style.setProperty('--demo-masthead-height',masthead.getBoundingClientRect().height+'px');document.documentElement.style.setProperty('--demo-subnav-height',subnav.getBoundingClientRect().height+'px');};
  const shellObserver=new ResizeObserver(syncShell);shellObserver.observe(masthead);shellObserver.observe(subnav);
  syncShell();
  render();
})();
