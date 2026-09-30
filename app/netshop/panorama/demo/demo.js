/* Isolated design fixture. This file is never imported by a production route. */
(() => {
  'use strict';
  const $ = (q) => document.querySelector(q);
  const titles = ['经营成绩与变化','流量与成交','商品结构','推广经营','毛利与退货','客户与企业购','目标与复盘','数据与口径'];
  const shops = {'jd-demo':{platform:'京东',name:'演示商用设备旗舰店',factor:1,seed:3},'tm-demo':{platform:'天猫',name:'演示厨电旗舰店',factor:.74,seed:7}};
  const params = new URLSearchParams(location.search);
  const state = {layout:1,shop:shops[params.get('shop')] ? params.get('shop') : '',start:'2026-09-01',end:'2026-09-29',compare:'previous',scenario:'complete',chapter:1,productQuery:'',productDraft:'',productPage:1,productPageSize:5,day:'2026-09-29',generation:0,ready:false};
  let calendarMonth = 2026*12+8, dateAnchor = null;
  const escape = (s) => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const d = (iso) => new Date(iso+'T00:00:00Z');
  const iso = (v) => v.toISOString().slice(0,10);
  const add = (date,n) => {const v=d(date);v.setUTCDate(v.getUTCDate()+n);return iso(v)};
  const days = (start,end) => {const count=Math.round((d(end)-d(start))/86400000)+1;return Array.from({length:count},(_,i)=>add(start,i))};
  const amount = (cents) => cents===null||!Number.isFinite(cents)?'—':(cents/1000000).toFixed(2);
  const count = (v) => v===null||!Number.isFinite(v)?'—':Math.round(v).toLocaleString('zh-CN');
  const pct = (v) => v===null||!Number.isFinite(v)?'—':(v*100).toFixed(2)+'%';
  const money = (v) => v===null||!Number.isFinite(v)?'—':(v/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
  const multiple = (v) => !Number.isFinite(v)?'—':v.toFixed(2)+' 倍';
  const missingDay = () => {const selected=days(state.start,state.end);return state.scenario==='missing'?selected[Math.floor(selected.length/2)]:null};
  const adCoverage = () => state.scenario==='missing'?`仅已覆盖 ${Math.max(0,days(state.start,state.end).length-1)} 天，缺 ${missingDay()}`:'广告源本期完整覆盖示例';
  // Keep SVG captions at the system's actual 12px size at every panel width.
  const chartGeometry = new WeakMap();
  const chartResize = new ResizeObserver(entries=>entries.forEach(({target:svg})=>{
    const width=Math.max(180,Math.round(svg.getBoundingClientRect().width));
    if(!chartGeometry.has(svg))chartGeometry.set(svg,[...svg.querySelectorAll('[x],[x1],[x2],[cx],[points]')].map(el=>({el,attrs:['x','x1','x2','cx','points'].filter(key=>el.hasAttribute(key)).map(key=>[key,el.getAttribute(key)])})));
    const mapX=x=>x<42?x:42+(x-42)/560*(width-64);
    chartGeometry.get(svg).forEach(({el,attrs})=>attrs.forEach(([key,value])=>el.setAttribute(key,key==='points'?(value.trim()?value.trim().split(/\s+/).map(point=>{const [x,y]=point.split(',').map(Number);return mapX(x)+','+y}).join(' '):''):String(mapX(Number(value))))));
    svg.setAttribute('viewBox','0 0 '+width+' 215');
  }));
  function shiftedMonth(date,delta){const v=d(date),day=v.getUTCDate(),year=v.getUTCFullYear(),month=v.getUTCMonth()+delta;const max=new Date(Date.UTC(year,month+1,0)).getUTCDate();return iso(new Date(Date.UTC(year,month,Math.min(day,max))))}
  function basePeriod(){
    if(state.compare==='none')return null;
    if(state.compare==='year'){const shift=(s)=>{const v=d(s);return iso(new Date(Date.UTC(v.getUTCFullYear()-1,v.getUTCMonth(),Math.min(v.getUTCDate(),new Date(Date.UTC(v.getUTCFullYear()-1,v.getUTCMonth()+1,0)).getUTCDate()))))};return {start:shift(state.start),end:shift(state.end),rule:'去年同期'}}
    const n=days(state.start,state.end).length;
    if(n===1)return {start:add(state.start,-1),end:add(state.end,-1),rule:'前一日'};
    const a=d(state.start),b=d(state.end);
    if(a.getUTCMonth()===b.getUTCMonth()&&a.getUTCFullYear()===b.getUTCFullYear()){
      if(a.getUTCDate()===1&&b.getUTCDate()===new Date(Date.UTC(b.getUTCFullYear(),b.getUTCMonth()+1,0)).getUTCDate()){return {start:shiftedMonth(state.start,-1),end:iso(new Date(Date.UTC(a.getUTCFullYear(),a.getUTCMonth(),0))),rule:'上个完整自然月'}}
      return {start:shiftedMonth(state.start,-1),end:shiftedMonth(state.end,-1),rule:'上月对应日'};
    }
    return {start:add(state.start,-n),end:add(state.start,-1),rule:'前等长区间'};
  }
  function row(date,shopKey=state.shop){
    const s=shops[shopKey],v=d(date),i=v.getUTCDate(),month=v.getUTCMonth();
    const season=month===8?1.15:month===7?1:1.04;
    const sales=Math.round((1720000+i*31500+Math.sin((i+s.seed)*.72)*260000)*s.factor*season);
    const visitors=Math.round((1450+i*17+Math.cos(i*.4)*240)*s.factor*season);
    const buyers=Math.round(visitors*(.028+Math.sin(i*.3)*.004));
    const orders=buyers+4,quantity=Math.round(orders*1.28);
    const spend=Math.round(sales*(.10+Math.cos(i*.3)*.014));
    const clicks=Math.round(spend/142),attributed=Math.round(spend*(3.8+Math.sin(i*.4)*.5));
    const erp=Math.round(sales*.925),cost=Math.round(erp*.617),returns=Math.round(sales*.036);
    const gap=date===missingDay();
    return {date,sales,visitors,buyers,orders,quantity,spend:gap?null:spend,clicks:gap?null:clicks,attributed:gap?null:attributed,erp,cost,returns,gross:Math.round(erp*.292),views:Math.round(visitors*2.34),cart:Math.round(visitors*.09),favorites:Math.round(visitors*.058),placed:Math.round(orders*1.22)};
  }
  function totals(start=state.start,end=state.end){const total=days(start,end).reduce((a,day)=>{const r=row(day);Object.entries(r).forEach(([k,v])=>{if(k!=='date'&&v!==null)a[k]=(a[k]||0)+v});return a},{});for(const key of ['spend','clicks','attributed'])if(!(key in total))total[key]=null;return total}
  function change(current,base){if(state.compare==='none')return '未启用比较';return (current-base>=0?'↑ ':'↓ ')+pct(Math.abs((current-base)/base))}
  function metric(label,value,unit,note,chapter,delta='',down=false){return `<button class="metric" data-chapter="${chapter}"><span>${label}</span><strong>${value}<span class="unit">${unit}</span></strong><em class="${down?'down':''}">${delta||note}</em><small>${delta?note:'点击查看所属章节'}</small></button>`}
  function metrics(){const a=totals(),p=basePeriod(),b=p?totals(p.start,p.end):a;return `<div class="kpis">${metric('平台成交',amount(a.sales),'万元','商品 SPU 日报 · 商品支付金额',1,change(a.sales,b.sales))}${metric('ERP 净销售',amount(a.erp),'万元','ERP 销售 · 正负分摊净额',5,change(a.erp,b.erp))}${metric('商品访客累计',count(a.visitors),'','商品 × 日累计，非去重 UV',2,change(a.visitors,b.visitors))}${metric('推广花费',amount(a.spend),'万元',adCoverage(),4,state.scenario==='missing'?'整期增幅不可比较':change(a.spend,b.spend))}${metric('推广费率',pairAvailable()?pct(a.spend/a.sales):'—','','同店同日匹配',4,pairAvailable()?(state.compare==='none'?'未启用比较':'差额 '+((a.spend/a.sales-b.spend/b.sales)*100).toFixed(2)+' 个百分点'):pairReason())}</div>`}
  const pairAvailable = () => !['missing','revision'].includes(state.scenario);
  const pairReason = () => state.scenario==='revision'?'来源修订变化，暂停组合':'推广缺日，整期不可计算';
  function nav(vertical=false){return `<nav class="${vertical?'side-index':'chapter-nav'}" aria-label="八个经营章节">${vertical?'<strong>本页章节</strong>':''}${titles.map((name,i)=>`<button data-chapter="${i+1}" aria-pressed="${state.chapter===i+1}"><span>${String(i+1).padStart(2,'0')} </span>${name}</button>`).join('')}</nav>`}
  function chart(field='sales',label='平台成交',unit='元'){
    const period=days(state.start,state.end),p=basePeriod(),base=p?days(p.start,p.end):[];
    const sampled=period.length>35?period.filter((_,i)=>i%Math.ceil(period.length/30)===0):period;const gapDay=missingDay();const sample=[...new Set([...sampled,...(gapDay&&field==='spend'?[add(gapDay,-1),gapDay,add(gapDay,1)].filter(day=>period.includes(day)):[])])].sort();
    const vals=sample.map(day=>row(day)[field]),old=sample.map((_,i)=>base.length?row(base[Math.min(base.length-1,Math.round(i*(base.length-1)/Math.max(1,sample.length-1)))])[field]:0),max=Math.max(...vals,...old)*1.15;
    const x=(i)=>42+i*560/Math.max(1,sample.length-1),y=(v)=>178-v/max*149;
    const points=(values)=>values.map((v,i)=>`${x(i)},${y(v)}`).join(' ');
    const missing=state.scenario==='missing'&&field==='spend',gap=sample.indexOf(missingDay());
    const poly=missing?`<polyline class="now" points="${points(vals.slice(0,gap))}"/><polyline class="now" points="${vals.slice(gap+1).map((v,i)=>`${x(i+gap+1)},${y(v)}`).join(' ')}"/>`:`<polygon class="area" points="42,178 ${points(vals)} ${x(vals.length-1)},178"/><polyline class="now" points="${points(vals)}"/>`;
    return `<div class="chart-legend"><span>${label} · ${unit}</span>${p?'<span class="base-legend">实际基期</span>':''}<small>点日期查看明细</small></div><svg class="chart" viewBox="0 0 625 215" role="img" aria-label="${label}趋势，示例数据"><title>${escape(label)}趋势</title>${[0,.5,1].map(f=>`<line class="gridline" x1="42" x2="605" y1="${178-f*149}" y2="${178-f*149}"/><text x="35" y="${182-f*149}" text-anchor="end">${field==='visitors'?Math.round(max*f/1000)+'千':field==='spend'?count(max*f/100):(max*f/1000000).toFixed(0)+'万'}</text>`).join('')}${poly}${p?`<polyline class="base" points="${points(old)}"/>`:''}${vals.map((v,i)=>missing&&i===gap?'':`<circle cx="${x(i)}" cy="${y(v)}" r="3" data-day="${sample[i]}"><title>${sample[i]} · ${field==='visitors'?count(v):money(v)} ${unit}</title></circle>`).join('')}${[0,Math.floor((sample.length-1)/2),sample.length-1].filter((v,i,a)=>a.indexOf(v)===i).map(i=>`<text x="${x(i)}" y="202" text-anchor="${i===0?'start':i===sample.length-1?'end':'middle'}">${sample[i].slice(5)}</text>`).join('')}</svg><div class="daily-buttons">${sample.filter((_,i)=>i%Math.max(1,Math.floor(sample.length/7))===0).map(day=>`<button data-day="${day}">${day.slice(5)}</button>`).join('')}</div>`;
  }
  function stat(label,value,note=''){return `<div><span>${label}</span><b>${value}</b><small>${note}</small></div>`}
  const products = [
    {id:'P-DEMO-101',name:'商用开水设备',cat:'饮水设备',share:.32},
    {id:'P-DEMO-102',name:'多功能切配设备',cat:'食品加工',share:.24},
    {id:'P-DEMO-103',name:'节能蒸煮设备',cat:'厨房设备',share:.17},
    {id:'P-DEMO-104',name:'不锈钢备餐设备',cat:'厨房设备',share:.12},
    {id:'P-DEMO-105',name:'台式饮水设备',cat:'饮水设备',share:.08},
    ...['商用保温设备','单门保鲜工作台','台式搅拌设备','立式绞肉设备','不锈钢操作台','双层餐盘推车','商用电磁加热设备','食品加工配件套装','台式封口设备','商用保温汤桶','厨房清洁配件','替换滤芯组件','设备安装配件'].map((name,i)=>({id:'P-DEMO-'+(106+i),name,cat:'未分类',share:i<5?.008:.00375}))
  ];
  function productPageData(){
    const query=state.productQuery.trim().toLowerCase();
    const filtered=products.filter(p=>!query||p.id.toLowerCase().includes(query)||p.name.toLowerCase().includes(query));
    const pages=Math.max(1,Math.ceil(filtered.length/state.productPageSize));
    state.productPage=Math.min(Math.max(1,state.productPage),pages);
    const start=(state.productPage-1)*state.productPageSize;
    return {filtered,pages,start,items:filtered.slice(start,start+state.productPageSize)};
  }
  function productTableInner(){
    const a=totals(),base=basePeriod(),b=base?totals(base.start,base.end):a;
    const {filtered,pages,start,items}=productPageData();
    return `<div class="product-list-toolbar"><form id="product-search-form" role="search" aria-label="搜索商品明细"><label for="product-search-input">商品搜索</label><div class="product-search-controls"><input id="product-search-input" type="search" value="${escape(state.productDraft)}" maxlength="120" placeholder="搜索商品 ID / 标题名称" aria-label="搜索商品ID或标题名称"><button type="submit" class="primary-button">搜索</button><button type="button" data-product-clear="true">清空</button></div></form><p>仅筛选商品明细，上方经营汇总不变。</p></div><div class="table-wrap"><table class="panorama-product-table"><thead><tr><th>商品 / 精确 ID</th><th>类目</th><th>平台成交 · 万元</th><th>件数</th><th>访客累计</th><th>累计转化</th><th>贡献</th><th>${state.compare==='year'?'同比':state.compare==='none'?'比较关闭':'环比'}</th><th>推广花费 · 万元</th><th>平台退款 · 万元</th><th>映射 / 覆盖</th></tr></thead><tbody>${items.map(p=>{const i=products.indexOf(p);return `<tr><td><button class="product-link" data-product="${p.id}"><span class="product-thumb" aria-label="演示商品图">${['▥','▧','▤','▣','▦'][i%5]}</span><span>${p.name}<small>${state.shop} / SPU / ${p.id}</small></span></button></td><td>${p.cat}</td><td class="number">${amount(a.sales*p.share)}</td><td class="number">${count(a.quantity*p.share)}</td><td class="number">${count(a.visitors*p.share)}</td><td class="number">${pct(a.buyers/a.visitors)}</td><td class="number">${pct(p.share)}</td><td class="number" style="color:var(--${a.sales>=b.sales?'up':'down'})">${state.compare==='none'?'—':change(a.sales*p.share,b.sales*p.share)}</td><td class="number">${a.spend===null?'—':amount(a.spend*p.share)}${state.scenario==='missing'?'<small>已覆盖范围</small>':''}</td><td class="number">${amount(a.returns*p.share)}</td><td><span class="pill ${i===4?'warn':''}">${i===4?'ERP 未关联':'精确关联'}</span><small>平台期内完整</small></td></tr>`}).join('')||'<tr><td colspan="11" class="product-list-empty">没有匹配的商品，请更换ID或标题名称。</td></tr>'}</tbody></table></div><div class="product-pagination"><span id="product-page-status" role="status" aria-live="polite">共 ${filtered.length} 条 · ${filtered.length?start+1:0}—${Math.min(start+items.length,filtered.length)} 条 · 第 ${filtered.length?state.productPage:0} / ${filtered.length?pages:0} 页</span><label>每页<select id="product-page-size" aria-label="每页商品条数">${[5,10,20].map(size=>`<option value="${size}" ${state.productPageSize===size?'selected':''}>${size} 条</option>`).join('')}</select></label><div class="product-page-buttons"><button type="button" data-product-page="${state.productPage-1}" ${state.productPage<=1?'disabled':''}>上一页</button>${Array.from({length:pages},(_,i)=>`<button type="button" data-product-page="${i+1}" ${state.productPage===i+1?'aria-current="page" class="active"':''} ${!filtered.length?'disabled':''}>${i+1}</button>`).join('')}<button type="button" data-product-page="${state.productPage+1}" ${state.productPage>=pages||!filtered.length?'disabled':''}>下一页</button></div></div><p class="inline-note">18 条合成商品用于搜索与分页预览。TOP5 / TOP10分别占93% / 97%，排行与贡献按完整集合呈现；未关联商品保留。</p>`;
  }
  function productTable(){return `<div id="product-list">${productTableInner()}</div>`}
  function updateProductList(){const container=$('#product-list');if(container)container.innerHTML=productTableInner()}

  function bars(items){return `<div class="contributions">${items.map(([name,val,extra])=>`<div class="contribution"><span>${name}</span><div class="track"><i style="width:${val}%" class="${extra?'alt':''}"></i></div><b>${val}%</b></div>`).join('')}</div>`}
  function sourceTable(){const gap=state.scenario==='missing',mix=state.scenario==='revision';return `<div class="table-wrap"><table><thead><tr><th>来源</th><th>实际截止日</th><th>选期覆盖</th><th>能力与限制</th></tr></thead><tbody><tr><td>平台商品 SPU 日报</td><td>${state.end}</td><td><span class="pill">完整</span></td><td>商品访客累计，非去重店铺 UV</td></tr><tr><td>${shops[state.shop].platform}推广日报</td><td>${state.end}</td><td><span class="pill ${gap?'warn':''}">${gap?'中间缺1日':'完整'}</span></td><td>${mix?'修订变化，组合暂停':'归因金额独立；归因窗口待披露'}</td></tr><tr><td>ERP 销售与成本</td><td>${state.end}</td><td><span class="pill">示例已覆盖</span></td><td>发货时间；成本/费用规则沿用销售域</td></tr><tr><td>月度财报</td><td>2026-08</td><td><span class="pill warn">月度来源</span></td><td>不插值成选期日利润</td></tr><tr><td>商品档案 / 库存</td><td>2026-09-30</td><td>当前快照</td><td>不回填历史状态</td></tr></tbody></table></div>`}
  function panel(id,body,subtitle=''){return `<section class="panel chapter" id="chapter-${id}" data-section="${id}"><div class="panel-heading"><div><h2>${titles[id-1]}</h2><p>${subtitle}</p></div><span class="index">2.${id}</span></div>${body}</section>`}
  function section(id){const a=totals(),p=basePeriod(),b=p?totals(p.start,p.end):a;
    if(id===1)return panel(1,`<div class="money-groups"><div><span>平台成交</span><b>${amount(a.sales)} 万元</b><p>商品 SPU 日报支付口径</p></div><div><span>ERP 净销售</span><b>${amount(a.erp)} 万元</b><p>正负分摊净额 · 发货时间</p></div><div><span>广告归因成交</span><b>${amount(a.attributed)} 万元</b><p>${shops[state.shop].platform==='京东'?'京东总订单金额':'天猫净成交金额'} · ${adCoverage()}</p></div></div><div class="mini-stats">${stat('支付订单',count(a.orders),'独立订单口径示例')}${stat('正向成交件数',count(a.quantity),'与 ERP 净销量分开')}${stat('支付客单价',money(a.sales/a.orders)+' 元','支付金额 / 支付订单')}${stat('本期与基期差额',state.compare==='none'?'—':(a.sales-b.sales>=0?'+':'')+amount(a.sales-b.sales)+' 万元',p?p.start+' 至 '+p.end:'未比较')}${stat('平台商品退款',amount(a.returns)+' 万元','与 ERP 退货金额分列')}${stat('ERP 订单毛利',amount(a.gross)+' 万元','不等于财报净利润')}</div><div style="margin-top:23px">${chart()}</div><div class="section-actions"><button data-chapter="3">查看商品变化贡献 →</button><button data-action="daily">逐日明细 →</button></div>`,'三条金额链分别展示；展示本期、实际基期和差额');
    if(id===2)return panel(2,`<div class="mini-stats">${stat('商品浏览累计',count(a.views),'商品 × 日浏览量')}${stat('商品访客累计',count(a.visitors),'商品 × 日累计，非去重人数')}${stat('商品收藏累计',count(a.favorites),'来源字段累计')}${stat('加购累计',count(a.cart),'来源字段累计')}${stat('下单订单累计',count(a.placed),'与支付分开')}${stat('支付客户累计',count(a.buyers),'非店铺去重客户')}${stat('商品累计转化',pct(a.buyers/a.visitors),'同源同维度客户累计 / 访客累计')}${stat('商品访客价值',money(a.sales/a.visitors)+' 元','平台成交 / 商品访客累计')}</div><p class="empty-metric">搜索、停留与跳失：按平台字段与加权口径核验后展示。缺字段时保持缺口，不用广告点击推算访客。</p><div style="margin-top:20px">${chart('visitors','商品访客累计','累计次数')}</div><div class="section-actions"><button data-product="P-DEMO-105">查看高访客低成交商品 →</button></div>`,'独立指标累计展示；不表示同一批用户的转化路径');
    if(id===3)return panel(3,`<div class="mini-stats">${stat('成交商品',18,'示例有成交 SPU 数')}${stat('TOP5 / TOP10', '93% / 97%','完整集合贡献示例')}${stat('增长 / 下降',state.compare==='none'?'未比较':a.sales>=b.sales?'18 / 0':'0 / 18','合成商品按两期精确 ID 配对')}</div><div style="margin:22px 0">${bars([['饮水设备',40],['食品加工',24],['厨房设备',29],['未分类',7,true]])}</div>${productTable()}<div class="section-actions"><button data-action="products">进入同店商品表现 →</button></div>`,'身份、贡献、流量与映射分别核验；点击商品进入详情');
    if(id===4)return panel(4,`<div class="mini-stats">${stat('推广花费',amount(a.spend)+' 万元',adCoverage())}${stat('归因成交',amount(a.attributed)+' 万元',(shops[state.shop].platform==='京东'?'京东总订单金额':'天猫净成交金额')+'；'+adCoverage())}${stat('ROAS',multiple(a.attributed/a.spend),'归因成交 / 花费，非利润 ROI；'+adCoverage())}${stat('广告点击',count(a.clicks),'不当作付费访客；'+adCoverage())}${stat('点击成本',money(a.spend/a.clicks)+' 元','已覆盖范围花费 / 点击')}${stat('推广费率',pairAvailable()?pct(a.spend/a.sales):'—',pairAvailable()?'同平台 × 店 × 日完整匹配':pairReason())}</div><div style="margin-top:22px">${chart('spend','推广花费')}</div><div style="margin-top:19px">${bars([['主推设备',55],['成长商品',29],['长尾商品',16,true]])}</div><div class="section-actions"><button data-action="promotion">进入同店同周期推广专题 →</button></div>`,'复用推广专题结果；归因成交与平台成交独立');
    if(id===5)return panel(5,`<div class="mini-stats">${stat('ERP 净销售',amount(a.erp)+' 万元','正负分摊净额')}${stat('货品成本',amount(a.cost)+' 万元','现有销售成本源')}${stat('订单毛利',amount(a.gross)+' 万元','导入订单毛利字段合计')}${stat('大毛利率',pct((a.erp-a.cost)/a.erp),'(净销售 − 成本) / 净销售')}${stat('ERP 退货金额',amount(a.returns*.83)+' 万元','ERP 原退款口径示例')}${stat('ERP 退货件数',count(a.quantity*.032),'退货量，非净销量')}</div><div style="margin-top:25px">${bars([['开水设备毛利贡献',43],['切配设备毛利贡献',35],['蒸煮设备毛利贡献',22,true]])}</div><p class="inline-note">财报利润来自月度财务来源，留在目标复盘章节；不向日或商品分摊。单品毛利须精确 ERP 映射。</p><div class="section-actions"><button data-action="sales">原销售分析 →</button><button data-action="erp-products">原商品经营 →</button></div>`,'订单毛利与大毛利率各自沿用 ERP 口径，不称净利润');
    if(id===6)return panel(6,`<div class="mini-stats">${stat('新买家累计','—','需商品日报字段、覆盖及原定义')}${stat('老买家累计','—','商品级累计，不能当复购人数')}${stat('企业购金额 / 订单','—','需专用来源与本店同期覆盖')}${stat('企业购件数 / 结构','—','商品关联成立后启用')}${stat('去重客户 / 复购','—','缺匿名身份与完整历史规则')}${stat('B 端占比','—','缺企业购与平台分母子集证据')}</div><div class="empty-metric">这部分有条件启用。商用品类、企业购目录或买家累计不能证明 B 端占比；其余章节可继续查看。</div>`,'明确来源门槛与缺口；不从品类或广告指标推断客户结构');
    if(id===7)return panel(7,`<div class="grid2"><div><h3>年度目标 · 月度财报</h3><p class="inline-note">财报截止 2026 年 8 月；与页面选择的日区间分别呈现。</p><div class="money-groups"><div><span>年度销售目标</span><b>960 万元</b><p>既有目标示例 · 只读</p></div><div><span>财报年累计销售</span><b>618 万元</b><p>64.38% 达成 · 不推算月目标</p></div><div><span>财报年累计利润</span><b>86 万元</b><p>财务来源 · 独立利润口径</p></div></div></div><div><h3>已记录经营事件</h3><div class="timeline"><div><time>09-05</time><p>主图调整完成<small>合成已记录事件；与销售变化仅作对照</small></p></div><div><time>09-16</time><p>某商品补货到仓<small>事件日期，不自动解释增长原因</small></p></div><div><time>09-23</time><p>本月商品结构复盘<small>原运营事务入口，只读查看</small></p></div></div></div></div><div class="section-actions"><button data-action="finance">原月度财报 →</button><button data-action="events">原经营事件 →</button></div>`,'引用既有目标、财报和事件；不新增编辑系统、不推断因果');
    return panel(8,`${sourceTable()}<div class="grid2" style="margin-top:20px"><div><h3>本范围字段能力</h3><div class="availability"><div><span>平台成交 / 商品访客</span><span class="pill">可用示例</span></div><div><span>整期推广费率</span><span class="pill ${pairAvailable()?'':'warn'}">${pairAvailable()?'完整配对':pairReason()}</span></div><div><span>去重 UV / 复购 / B 端占比</span><span class="pill warn">条件未成立</span></div></div></div><div><h3>映射与可比较性</h3><p class="inline-note">商品身份包含平台、店铺、SPU / SKU 和精确 ID。未关联商品保留；当前库存仅显示快照。</p><details style="margin-top:15px"><summary>展开来源版本与证据示例</summary><p class="identity-code">商品 revision demo:12 · 推广 demo:${state.scenario==='revision'?'8 → 9':'8'} · ERP demo:6</p><p class="inline-note">独立来源，不声称分布式原子快照。正式组合指标须前后复验参与来源 revision。</p></details></div></div><div class="section-actions"><button data-action="imports">查看原导入记录 →</button><button data-action="workflow">查看工作流记录 →</button></div>`,'各源独立披露截止、缺日与字段能力；记录入口只读');
  }
  function cockpit(){const a=totals();return `<div class="cockpit-layout">${nav(true)}<div>${metrics()}<div class="cockpit-top"><div class="panel"><div class="panel-heading"><div><h2>本期经营轨迹</h2><p>平台成交 · 逐日与实际基期</p></div><span class="pill">SPU 日报</span></div>${chart()}</div><div class="panel summary-rail"><h3>本店经营侧写</h3><div><span>商品累计转化</span><br><strong>${pct(a.buyers/a.visitors)}</strong><small>同源买家累计 / 商品访客累计</small></div><div><span>TOP5 成交贡献</span><br><strong>93.00%</strong><small>示例全店商品集合</small></div><div><span>数据与口径</span><p class="subtle">${pairAvailable()?'各来源独立可信':'组合指标有缺口'}</p><button data-chapter="8">查看来源 →</button></div></div></div>${section(1)}<div class="grid2">${section(2)}${section(4)}</div>${section(3)}<div class="grid2">${section(5)}${section(6)}</div>${section(7)}${section(8)}</div></div>`}
  function dailyTable(){const rows=days(state.start,state.end).reverse();return `<div class="table-wrap"><table><thead><tr><th>日期</th><th>平台成交 · 元</th><th>访客累计</th></tr></thead><tbody>${rows.map(day=>{const a=row(day);return `<tr class="${day===state.day?'selected':''}"><td><button data-select-day="${day}">${day.slice(5)}</button></td><td class="number">${money(a.sales)}</td><td class="number">${count(a.visitors)}</td></tr>`}).join('')}</tbody></table></div>`}
  function syncUrl(){const u=new URL(location.href);u.searchParams.set('layout',state.layout);if(state.shop)u.searchParams.set('shop',state.shop);else u.searchParams.delete('shop');history.replaceState(null,'',u)}
  function controls(){
    $('#period-context').textContent=state.start+' → '+state.end;$('#shop').value=state.shop;$('#compare').value=state.compare;$('#scenario').value=state.scenario;$('#date-button').textContent=state.start+' — '+state.end+' ▾';
    const p=basePeriod();$('#scope').innerHTML=state.shop?`<span>${shops[state.shop].platform} · ${shops[state.shop].name}</span><span>本期 ${state.start} — ${state.end}</span><span>${p?`${state.compare==='year'?'同比':'环比'} ${p.start} — ${p.end} · ${p.rule}`:'本次不比较'}</span>`:'<span>请选择一个店铺后查看；不会自动选择第一家店。</span>';
    $('#references').innerHTML='<article><h3>01 章节驾驶舱</h3><p>保留八个单店经营章节；平台、ERP和推广来源分别披露。</p><p>店铺筛选区随页面滚动。商品明细支持ID/标题名称搜索及分页，上方经营汇总不受表内筛选影响。</p></article>';
  }
  function render(){
    chartResize.disconnect();
    controls();syncUrl();$('#feedback').innerHTML='';
    if(!state.shop){$('#content').innerHTML='<div class="empty-state"><div><span class="pill">单店分析</span><h2>先选择要了解的店铺</h2><p>选择平台、精确店名和统计期间，八个章节在同一店铺范围内展开。</p></div></div>';return}
    if(!state.ready){$('#content').innerHTML='<div class="empty-state"><div><h2>正在加载当前店铺示例…</h2><p>上一次范围已清空，旧请求不能覆盖新选择。</p></div></div>';return}
    if(state.scenario==='denied'){$('#content').innerHTML='<div class="empty-state" role="alert"><div><h2>没有这家店铺的查看权限</h2><p>未显示受限店铺数据。此状态为 UI 设计示例，正式鉴权须由公共底座与只读服务验收。</p></div></div>';return}
    if(state.scenario==='failure'){$('#content').innerHTML='<div class="empty-state" role="alert"><div><h2>当前范围刷新失败</h2><p>所选店铺与日期已保留；当前范围没有可用的新结果。</p><button data-retry="true" class="primary-button" style="margin-top:17px">重试当前范围</button></div></div>';return}
    if(!pairAvailable())$('#feedback').innerHTML=`<div class="notice">${pairReason()}。平台、ERP 与广告章节继续展示各自可信示例；整期推广费率主值为 —。</div>`;
    $('#content').innerHTML=cockpit();
    document.querySelectorAll('#content .chart').forEach(svg=>chartResize.observe(svg));
  }
  function load(){state.ready=false;const g=++state.generation;render();setTimeout(()=>{if(g!==state.generation)return;state.ready=true;render()},160)}
  function chapter(id){state.chapter=id;document.querySelector('#chapter-'+id)?.scrollIntoView({behavior:'smooth',block:'start'});document.querySelectorAll('[data-chapter]').forEach(btn=>btn.setAttribute('aria-pressed',btn.dataset.chapter===String(id)))}
  function detail(title,html){$('#detail-title').textContent=title;$('#detail-content').innerHTML=html;if(!$('#detail-dialog').open)$('#detail-dialog').showModal()}
  function dayDetail(day){const a=row(day);detail(day+' · 逐日经营明细',`<p>${shops[state.shop].platform} · ${shops[state.shop].name}</p><p class="subtle">所属选期 ${state.start} — ${state.end}</p><div class="detail-grid">${stat('平台商品支付金额',money(a.sales)+' 元','商品 SPU 日报')}${stat('ERP 净销售',money(a.erp)+' 元','ERP 发货时间')}${stat('广告花费',money(a.spend)+(a.spend===null?'':' 元'),a.spend===null?'该店该日缺数据':'独立广告来源')}${stat('商品访客累计',count(a.visitors),'商品 × 日累计')}</div><p class="inline-note">日期明细保留当前店铺身份；关闭后回到原章节与滚动位置。</p>`)}
  function drill(action,id=''){
    const target={products:'商品表现',promotion:'推广分析',sales:'销售分析','erp-products':'商品经营',finance:'月度财报',events:'经营事件',imports:'原导入记录',workflow:'工作流记录'}[action]||'商品详情';
    const identity=`${shops[state.shop].platform} / ${shops[state.shop].name} / SPU${id?' / '+id:''}`;
    detail(target+' · 交互预览',`<span class="pill">目标页交互示例</span><h2 style="margin-top:15px">${id?products.find(x=>x.id===id)?.name:target}</h2><p class="identity-code" style="margin-top:12px">${escape(identity)}</p><p class="inline-note">携带日期 ${state.start} — ${state.end}；返回章节 2.${state.chapter}，保留当前滚动位置。</p><div class="detail-grid">${stat('店铺',shops[state.shop].name,'精确平台与店铺')}${stat('商品身份',id||'专题整店','不按模糊名称合并')}</div><p class="empty-metric">目标专业页尚未接线。此处只演示上下文与返回；正式接口由对应 Lead 交付后再联调。</p><button data-close="detail-dialog" class="primary-button" style="margin-top:18px">返回店铺全景</button>`)
  }
  function calendars(){
    const renderMonth=(month)=>{const first=new Date(Date.UTC(Math.floor(month/12),month%12,1)),year=first.getUTCFullYear(),m=first.getUTCMonth(),n=new Date(Date.UTC(year,m+1,0)).getUTCDate(),offset=(first.getUTCDay()+6)%7,start=$('#start').value,end=$('#end').value;return `<div><div class="calendar-head"><button data-month="-1" aria-label="上个月">‹</button><strong>${year} 年 ${m+1} 月</strong><button data-month="1" aria-label="下个月">›</button></div><div class="weekdays">${['一','二','三','四','五','六','日'].map(x=>`<span>${x}</span>`).join('')}</div><div class="calendar-days">${'<span></span>'.repeat(offset)}${Array.from({length:n},(_,i)=>{const date=iso(new Date(Date.UTC(year,m,i+1)));return `<button data-calendar-day="${date}" class="${date===start||date===end?'endpoint':date>start&&date<end?'in-range':''}" ${date>'2026-09-30'?'disabled':''}>${i+1}</button>`}).join('')}</div></div>`};
    $('#calendars').innerHTML=renderMonth(calendarMonth-1)+renderMonth(calendarMonth);
  }
  function openDate(){$('#start').value=state.start;$('#end').value=state.end;calendarMonth=d(state.end).getUTCFullYear()*12+d(state.end).getUTCMonth();dateAnchor=null;$('#date-error').textContent='';calendars();$('#date-dialog').showModal()}
  document.addEventListener('click',(event)=>{
    const mark=event.target.closest('circle[data-day]');if(mark){dayDetail(mark.dataset.day);return}const button=event.target.closest('button');if(!button)return;
    if(button.dataset.productClear){state.productQuery='';state.productDraft='';state.productPage=1;updateProductList();$('#product-search-input')?.focus({preventScroll:true});return}
    if(button.dataset.productPage){const page=Number(button.dataset.productPage),max=productPageData().pages;if(Number.isInteger(page)&&page>=1&&page<=max){state.productPage=page;updateProductList();document.querySelector('#product-list [aria-current="page"]')?.focus({preventScroll:true})}return}
    if(button.dataset.close){document.getElementById(button.dataset.close).close();return}
    if(button.dataset.chapter){if($('#detail-dialog').open)$('#detail-dialog').close();chapter(Number(button.dataset.chapter));return}
    if(button.dataset.day){dayDetail(button.dataset.day);return}
    if(button.dataset.selectDay){state.day=button.dataset.selectDay;if(button.closest('#detail-dialog'))dayDetail(state.day);else render();return}
    if(button.dataset.product){state.chapter=Number(button.closest('[data-section]')?.dataset.section)||state.chapter;drill('detail',button.dataset.product);return}
    if(button.dataset.action){state.chapter=Number(button.closest('[data-section]')?.dataset.section)||state.chapter;if(button.dataset.action==='daily')detail('逐日明细 · '+shops[state.shop].name,dailyTable());else drill(button.dataset.action);return}
    if(button.dataset.retry){state.scenario='complete';load();return}
    if(button.dataset.month){calendarMonth+=Number(button.dataset.month);calendars();return}
    if(button.dataset.calendarDay){const day=button.dataset.calendarDay;if(!dateAnchor){dateAnchor=day;$('#start').value=day;$('#end').value=day}else{$('#start').value=day<dateAnchor?day:dateAnchor;$('#end').value=day>dateAnchor?day:dateAnchor;dateAnchor=null}calendars();return}
    if(button.dataset.preset){const vals={month:['2026-09-01','2026-09-29'],last:['2026-08-01','2026-08-31'],seven:['2026-09-23','2026-09-29']}[button.dataset.preset];$('#start').value=vals[0];$('#end').value=vals[1];dateAnchor=null;calendarMonth=d(vals[1]).getUTCFullYear()*12+d(vals[1]).getUTCMonth();calendars();return}
  });
  document.addEventListener('input',event=>{if(event.target.id==='product-search-input')state.productDraft=event.target.value});
  document.addEventListener('submit',event=>{if(event.target.id!=='product-search-form')return;event.preventDefault();state.productDraft=$('#product-search-input').value.slice(0,120);state.productQuery=state.productDraft.trim();state.productPage=1;updateProductList();$('#product-search-input')?.focus({preventScroll:true})});
  document.addEventListener('change',event=>{if(event.target.id!=='product-page-size')return;const size=Number(event.target.value);if([5,10,20].includes(size)){state.productPageSize=size;state.productPage=1;updateProductList();$('#product-page-size')?.focus({preventScroll:true})}});
  $('#shop').addEventListener('change',()=>{state.shop=$('#shop').value;state.productPage=1;state.day=state.end;state.chapter=1;load()});
  $('#compare').addEventListener('change',()=>{state.compare=$('#compare').value;state.productPage=1;load()});
  $('#scenario').addEventListener('change',()=>{state.scenario=$('#scenario').value;load()});
  $('#refresh').addEventListener('click',load);
  $('#reference-button').addEventListener('click',()=>$('#reference-dialog').showModal());
  $('#date-button').addEventListener('click',openDate);
  ['#start','#end'].forEach(id=>$(id).addEventListener('change',calendars));
  $('#apply-date').addEventListener('click',()=>{const start=$('#start').value,end=$('#end').value;if(!start||!end||start>end||end>'2026-09-30'||days(start,end).length>366){$('#date-error').textContent='请选择有效起止日期：不晚于演示基准日，最长366天。';return}state.start=start;state.end=end;state.day=end;state.productPage=1;$('#date-dialog').close();load()});
  document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close()}}));
  window.addEventListener('popstate',()=>{const p=new URLSearchParams(location.search);state.layout=1;state.productPage=1;state.shop=shops[p.get('shop')]?p.get('shop'):'';load()});
  const navigationSizes = new ResizeObserver(entries=>entries.forEach(entry=>document.documentElement.style.setProperty(entry.target.classList.contains('system-masthead')?'--masthead-height':entry.target.classList.contains('module-nav')?'--module-nav-height':'--filterbar-height',Math.ceil(entry.target.getBoundingClientRect().height)+'px')));
  ['.system-masthead','.module-nav','.filterbar'].forEach(selector=>navigationSizes.observe(document.querySelector(selector)));
  load();
})();
