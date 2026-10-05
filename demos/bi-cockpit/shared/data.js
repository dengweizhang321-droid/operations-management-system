// Deterministic synthetic facts only. Money is integer cents until presentation.
export const shops = [
 {id:'s1',name:'TERUISI 京东旗舰店',platform:'京东',weight:1.5,growth:1.24,margin:.27},
 {id:'s2',name:'TERUISI 商用设备及餐饮厨房工程京东专营店（长名称示例）',platform:'京东',weight:1.05,growth:1.16,margin:.11},
 {id:'s3',name:'TERUISI 天猫旗舰店',platform:'天猫',weight:1.2,growth:.86,margin:.25},
 {id:'s4',name:'TERUISI 厨房生活店',platform:'天猫',weight:.7,growth:1.28,margin:.19},
 {id:'s5',name:'TERUISI 企业采购店',platform:'企业采购',weight:.55,growth:1.1,margin:.3},
 {id:'s6',name:'新渠道试运营店',platform:'企业采购',weight:.12,growth:1,margin:.2},
 {id:'s7',name:'待接入示例店',platform:'天猫',weight:0,growth:1,margin:0},
 {id:'s8',name:'零成交示例店',platform:'京东',weight:0,growth:1,margin:0},
];
export const products = [
 {id:'K01',name:'商用切肉机 旗舰款',category:'食品机械',weight:1.5,margin:.3},
 {id:'K02',name:'节能蒸箱 12层',category:'商用厨具',weight:1.15,margin:.23},
 {id:'K03',name:'双缸电炸炉',category:'商用厨具',weight:.72,margin:.06},
 {id:'K04',name:'促销绞肉机（负毛利示例）',category:'食品机械',weight:.42,margin:-.08},
 {id:'K05',name:'净水机 工程款',category:'净水设备',weight:.55,margin:.31},
];
export const addDays=(s,n)=>new Date(Date.parse(s+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
export const dayCount=(s,e)=>Math.round((Date.parse(e)-Date.parse(s))/86400000)+1;
export const ratio=(a,b)=>a===null||b===null||b<=0?null:a/b;
export const change=(a,b)=>a===null||b===null||b<=0?null:(a-b)/b;
export const money=v=>v===null||!Number.isFinite(v)?'未覆盖':Math.abs(v)>=10000?(v/10000).toLocaleString('zh-CN',{maximumFractionDigits:2})+' 万元':v.toLocaleString('zh-CN',{maximumFractionDigits:2})+' 元';
export const percent=v=>v===null||!Number.isFinite(v)?'不可比较':(v*100).toFixed(1)+'%';
export const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function fact(date,shop,product) {
 if(shop.id==='s7'||date<'2025-01-01'||date>'2026-10-04'||(shop.id==='s6'&&date<'2026-09-01')) return null;
 const idx=Number(shop.id.slice(1)),pidx=Number(product.id.slice(1));
 const day=Number(date.slice(-2)),month=Number(date.slice(5,7)),year=Number(date.slice(0,4));
 let factor=year===2026?shop.growth:1;
 if(year===2026&&month===9) factor*=shop.id==='s3'?.82:shop.id==='s4'?1.11:1.04;
 if(product.id==='K02'&&year===2026) factor*=1.2;
 if(product.id==='K05'&&year===2026) factor*=month>=9?.6:.78;
 const positive=Math.round((2100+((day*17+idx*13+pidx*7)%19)*85)*shop.weight*product.weight*factor*100);
 const returned=Math.round(positive*(.028+(idx===3?.025:0)+(pidx===4?.03:0)));
 const net=positive-returned;
 const margin=product.margin+(shop.margin-.24)-(shop.id==='s2'&&year===2026&&month>=9?.11:0);
 const cost=Math.round(net*(1-margin));
 return {date,shop:shop.id,product:product.id,sales:net,cost,profit:net-cost,returns:returned,positiveSales:positive,target:Math.round(2400*shop.weight*product.weight*1.2*100)};
}
export function aggregate(start,end,selectedShops,selectedProducts=products) {
 const sums={sales:0,cost:0,profit:0,returns:0,positiveSales:0,target:0},missing=[];
 let expected=0,covered=0;
 for(let date=start;date<=end;date=addDays(date,1)) for(const s of selectedShops) {
  expected++; let valid=true;
  for(const p of selectedProducts){const row=fact(date,s,p);if(!row){valid=false;continue;} for(const k of Object.keys(sums)) sums[k]+=row[k];}
  if(valid)covered++;else missing.push({date,shop:s.id});
 }
 const any=covered>0;
 const out=Object.fromEntries(Object.entries(sums).map(([k,v])=>[k,any?v/100:null]));
 return {...out,margin:ratio(out.profit,out.sales),returnRate:ratio(out.returns,out.positiveSales),coverage:{expected,covered,complete:covered===expected,missing},hasData:any};
}
export function promotion(start,end,selectedShops) {
 let spend=0,attributed=0,covered=0,expected=0;
 for(let date=start;date<=end;date=addDays(date,1))for(const s of selectedShops){
  expected++;
  if(date<'2025-01-01'||date>'2026-10-02'||s.id==='s5'||s.id==='s6'||s.id==='s7')continue;
  covered++;
  const d=Number(date.slice(-2)),current=date>='2026-09-01';
  const amount=Math.round((550+d%7*40)*s.weight*(current?1.38:1)*100);
  spend+=amount; attributed+=Math.round(amount*(current?(s.id==='s2'?1.9:3.2):4.5));
 }
 return {spend:covered?spend/100:null,attributed:covered?attributed/100:null,roas:ratio(attributed,spend),promotionCoverage:{covered,expected,complete:covered===expected}};
}
export function periods(state){
 const days=dayCount(state.start,state.end);
 const baseline=state.compare==='year'?{start:(Number(state.start.slice(0,4))-1)+state.start.slice(4),end:(Number(state.end.slice(0,4))-1)+state.end.slice(4)}:{start:addDays(state.start,-days),end:addDays(state.start,-1)};
 return {current:{start:state.start,end:state.end},baseline:state.compare==='none'?null:baseline};
}
export const inventory={snapshot:'2026-10-01',ageSnapshot:'2026-10-01',demandStart:'2026-09-05',demandEnd:'2026-10-04',value:1846000,agedValue:426000,uniqueProducts:5,warehousePositions:8,stale:true,unmatched:1,items:[
 {id:'K01',name:'商用切肉机 旗舰款',warehouse:'华南仓',qty:8,days:3,needed:42,value:24000,age:20,risk:'临界',matched:true},
 {id:'K01',name:'商用切肉机 旗舰款',warehouse:'华东仓',qty:0,days:0,needed:30,value:0,age:0,risk:'缺货',matched:true},
 {id:'K02',name:'节能蒸箱 12层',warehouse:'华南仓',qty:95,days:28,needed:0,value:285000,age:45,risk:'正常',matched:true},
 {id:'K02',name:'节能蒸箱 12层',warehouse:'华东仓',qty:80,days:24,needed:0,value:240000,age:50,risk:'正常',matched:true},
 {id:'K03',name:'双缸电炸炉',warehouse:'华南仓',qty:300,days:180,needed:0,value:426000,age:210,risk:'积压',matched:true},
 {id:'K04',name:'促销绞肉机',warehouse:'华南仓',qty:180,days:65,needed:0,value:216000,age:100,risk:'关注',matched:true},
 {id:'K05',name:'净水机 工程款',warehouse:'华南仓',qty:100,days:null,needed:null,value:355000,age:80,risk:'销量未匹配',matched:false},
 {id:'K05',name:'净水机 工程款',warehouse:'华东仓',qty:100,days:40,needed:0,value:300000,age:65,risk:'正常',matched:true},
]};
export const finance={month:'2026-08',status:'已完成',profit:286000,previousProfit:310000,revenue:2350000,expenses:[{name:'推广费用',value:312000,previous:282000},{name:'仓储物流',value:176000,previous:164000},{name:'人员费用',value:208000,previous:203000},{name:'其他费用',value:86000,previous:81000}],target:320000,missing:['2026-09'],scope:'公司完整财报月（不随店铺/日范围切分）'};
export function createModel(state){
 const selected=shops.filter(s=>(!state.platform||s.platform===state.platform)&&(!state.shop||s.id===state.shop));
 const pr=periods(state),base=pr.baseline;
 const t=aggregate(state.start,state.end,selected),b=base?aggregate(base.start,base.end,selected):null;
 const ad=promotion(state.start,state.end,selected),bad=base?promotion(base.start,base.end,selected):null;
 const comparable=!!b&&t.coverage.complete&&b.coverage.complete;
 const adComparable=bad&&ad.promotionCoverage.covered===bad.promotionCoverage.covered&&ad.promotionCoverage.covered>0;
 const totals={...t,...ad,delta:comparable&&t.sales!==null&&b.sales!==null?t.sales-b.sales:null,change:comparable?change(t.sales,b.sales):null,profitChange:comparable?change(t.profit,b.profit):null,marginPp:comparable&&t.margin!==null&&b.margin!==null?(t.margin-b.margin)*100:null,returnPp:comparable&&t.returnRate!==null&&b.returnRate!==null?(t.returnRate-b.returnRate)*100:null,spendChange:adComparable?change(ad.spend,bad.spend):null,roasPp:adComparable&&ad.roas!==null&&bad.roas!==null?ad.roas-bad.roas:null,comparable,adComparable};
 const shopRows=selected.map(s=>{const a=aggregate(state.start,state.end,[s]),z=base?aggregate(base.start,base.end,[s]):null;const c=z&&a.coverage.complete&&z.coverage.complete;return {...s,...a,...promotion(state.start,state.end,[s]),delta:c&&a.sales!==null&&z.sales!==null?a.sales-z.sales:null,change:c?change(a.sales,z.sales):null,share:ratio(a.sales,t.sales),growthContribution:comparable&&a.sales!==null&&z?.sales!==null&&totals.delta!==0?(a.sales-z.sales)/totals.delta:null};});
 const productRows=products.map(p=>{const a=aggregate(state.start,state.end,selected,[p]),z=base?aggregate(base.start,base.end,selected,[p]):null;return {...p,...a,delta:z&&a.coverage.complete&&z.coverage.complete&&a.sales!==null&&z.sales!==null?a.sales-z.sales:null,change:z&&a.coverage.complete&&z.coverage.complete?change(a.sales,z.sales):null,share:ratio(a.sales,t.sales)};});
 const trend=[];
 for(let d=state.start;d<=state.end;){let end=d;if(state.grain==='week')end=addDays(d,6);if(state.grain==='month')end=addDays(d.slice(0,7)+'-01',32).slice(0,7)+'-01',end=addDays(end,-1);if(end>state.end)end=state.end;trend.push({date:d,end,...aggregate(d,end,selected),...promotion(d,end,selected)});d=addDays(end,1);}
 if(state.status==='missing'){for(const k of ['spend','attributed','roas','spendChange','roasPp'])totals[k]=null;totals.promotionCoverage={...totals.promotionCoverage,covered:0,complete:false};totals.adComparable=false;for(const r of [...shopRows,...trend]){for(const k of ['spend','attributed','roas'])r[k]=null;r.promotionCoverage={...r.promotionCoverage,covered:0,complete:false};}}
 if(state.status==='empty'){for(const k of ['sales','profit','margin','returns','returnRate','target','spend','attributed','roas','delta','change','profitChange','marginPp','returnPp','spendChange','roasPp'])totals[k]=null;totals.comparable=false;totals.adComparable=false;totals.coverage={...totals.coverage,covered:0,complete:false};totals.promotionCoverage={...totals.promotionCoverage,covered:0,complete:false};return {totals,baseline:b,periods:pr,shops:[],products:[],trends:[],inventory,finance,selectedShops:[]};}
 return {totals,baseline:b,periods:pr,shops:shopRows,products:productRows,trends:trend,inventory,finance,selectedShops:selected};
}
