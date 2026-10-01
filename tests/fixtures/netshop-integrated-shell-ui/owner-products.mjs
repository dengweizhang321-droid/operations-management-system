/** Synthetic Owner-P mock copied from tools/verify-netshop-products-ui.mjs.
 * Only the complete-v1 additions use Owner's completeProductSectionsFixture.
 * Never import this fixture from production code. No navigation/history owner. */
import { productMetricKeys, extraMetricKeys } from "@/app/netshop/products/contract";
import { compareMetrics } from "@/lib/netshop/insights-contract";
import { resolveNetshopPeriods } from "@/lib/netshop/periods";
import { completeProductSectionsFixture } from "@/tests/netshop-products-test-fixture";
export function installOwnerProductFixture() {
window.__calls=[];window.__mode='ready';window.__revision=1;window.__revisionErrors=0;window.__baseline503=false;window.__navigation=null;
const addDay=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const days=w=>Array.from({length:w.days},(_,i)=>addDay(w.startDate,i));
function apiContext(query){
 const platforms=query.getAll('platform').length?query.getAll('platform').sort():['京东','天猫'];
 const shops=query.getAll('outlet').length?query.getAll('outlet').sort():platforms.map(p=>p+'\u001f合成店A');
 const dimension=query.get('dimension')||'spu',periodKind=query.get('periodKind')||'custom';
 const periods=resolveNetshopPeriods(query.get('startDate'),query.get('endDate'),periodKind);
 const scope={platforms,shopKeys:shops,dimension,periodKind};
 const sourceRevisions=[{domain:'netshop',kind:'owning_revision',scopeKey:'a'.repeat(64),revision:window.__revision+':aaaaaaaaaaaa'}];
 const coverageBySource={},capabilities=[],freshness=[];
 for(const p of platforms){
  sourceRevisions.push({domain:'netshop',kind:p+':promotionManifest',scopeKey:'a'.repeat(64),revision:'absent'});
  for(const shop of shops.filter(s=>s.startsWith(p+'\u001f')))for(const kind of ['product','promotion'])sourceRevisions.push({domain:'netshop',kind:p+':'+kind+':'+shop,scopeKey:'a'.repeat(64),revision:kind==='product'?String(window.__revision):'absent'});
  const sources=p==='京东'?['jd_sku_daily:'+dimension+'_daily:京东','jd_promotion:ad:京东']:['tmall_product_daily:spu_daily:天猫','tmall_promotion:promotion_daily:天猫'];
  for(const sourceId of sources){
   const promotion=sourceId.includes('promotion');freshness.push({sourceId,dataThrough:promotion?null:periods.current.endDate});
   for(const kind of ['current','previous','yearAgo']){
    const sourceShops=shops.filter(s=>s.startsWith(p+'\u001f')),expected=sourceShops.length*periods[kind].days,coverageRef=sourceId+':'+kind;
    coverageBySource[coverageRef]={expectedShopDatePairs:expected,coveredShopDatePairs:promotion?0:expected,complete:!promotion&&expected>0,missingByShop:promotion?sourceShops.map(shopKey=>({shopKey,dates:days(periods[kind])})):[],truncated:false};
    for(const field of promotion?['spend','attributedPayment']:['payment','visitors','customers','quantity','addCartCustomers'])capabilities.push({sourceId,period:kind,field,coverageRef,presentShopDatePairs:promotion?0:expected,status:promotion?'unavailable':'available',reasonCode:promotion?'no_records':null});
   }
  }
 }
 return {schemaVersion:'netshop-insights-v1',requestId:'synthetic-product-ui',scopeKey:'a'.repeat(64),snapshotToken:String(window.__revision%10).repeat(64),requestedScope:{...scope,shopKeys:query.getAll('outlet').sort()},effectiveScope:scope,periods,calendar:days(periods.current).map((date,i)=>({date,previous:i<periods.previous.days?addDay(periods.previous.startDate,i):null,yearAgo:i<periods.yearAgo.days?addDay(periods.yearAgo.startDate,i):null})),sourceRevisions,coverageBySource,capabilities,freshness,limitations:['合成UI API，不是实际来源验收','客户和访客为商品×日累计']};
}
function wireMetric(value,unit='COUNT',basis='product_day_sum',reason=null,source='jd_sku_daily:spu_daily:京东'){
 return {value,unit,status:reason?'unavailable':'available',reasonCode:reason,basis,sourceIds:[source],aggregation:unit==='RATIO'?'ratio_of_sums':'sum',coverageRef:source+':current',...(unit==='RATIO'&&!reason?{numerator:value*100,denominator:100}:{})};
}
function coreMetrics(payment=4800000){return Object.fromEntries(productMetricKeys.map(key=>[key,key==='payment'?wireMetric(payment,'CNY_CENT'):key==='refundPayment'?wireMetric(0,'CNY_CENT'):key==='conversion'?wireMetric(.02,'RATIO'):key==='addCartRate'?wireMetric(.05,'RATIO'):wireMetric(key==='visitors'?100:key==='customers'?2:1)]));}
function missingBaseline(){return Object.fromEntries(Object.entries(coreMetrics()).map(([key,metric])=>[key,{...metric,value:null,status:'unavailable',reasonCode:'incomplete_baseline',...(metric.unit==='RATIO'?{numerator:null,denominator:null}:{})}]));}
function visitorValue(){return {metricSchemaVersion:'netshop-money-per-count-v1',value:101/3,unit:'CNY_CENT_PER_COUNT',status:'available',reasonCode:null,basis:'product_day_sum',sourceIds:['jd_sku_daily:spu_daily:京东'],aggregation:'ratio_of_sums',coverageRef:'jd_sku_daily:spu_daily:京东:current',denominatorKind:'product_day_visitors_sum',numerator:101,denominator:3};}
function pairs(metrics){return Object.fromEntries(productMetricKeys.map(key=>[key,{previous:window.__baseline503?{value:null,method:metrics[key].unit==='RATIO'?'percentage_points':'relative_change',status:'unavailable',reasonCode:'incomplete_baseline'}:compareMetrics(metrics[key],coreMetrics(4000000)[key]),yearAgo:compareMetrics(metrics[key],coreMetrics(4500000)[key])}]));}
function table(query,detail=false){return {q:query.get('q')||'',category:query.get('category')||'',sort:query.get('sort')||'payment_desc',page:Number(query.get('page')||1),pageSize:Number(query.get('pageSize')||20),...(detail?{section:query.get('section')||'overview',source:query.get('source')||'platform'}:{})};}
function pagination(query,total,returned){const page=Number(query.get('page')||1),pageSize=Number(query.get('pageSize')||20);return {page,pageSize,total,returned,hasMore:(page-1)*pageSize+returned<total,truncated:false};}
function metadata(){return {summaryScope:'global_category_filtered',tableSearchScope:'identity_title_code_only',categoryBasis:'source_label_only',priceBasis:'transaction_mean',limitations:['合成来源；推广与ERP映射未具备','类目仅来源标签，不是跨平台字典']};}
function extras(){return Object.fromEntries(extraMetricKeys.map(key=>[key,key==='searchClickRate'?wireMetric(.1,'RATIO'):key==='orderPayment'||key==='visitorValue'?wireMetric(50000,'CNY_CENT'):wireMetric(10)]));}
function unmapped(){return {status:'unmapped',method:'unverified',sourceId:null,version:null,code:null,effectiveFrom:null,effectiveTo:null,reasonCode:'unmapped'};}
function linked(keys,basis){return Object.fromEntries(keys.map(key=>[key,wireMetric(null,key==='largeMarginRate'?'RATIO':key==='roas'?'MULTIPLE':key==='clicks'||key==='returnQuantity'?'COUNT':'CNY_CENT',basis,'unmapped')]));}
function row(context,id){const [platform,shopName]=context.effectiveScope.shopKeys[0].split('\u001f'),metrics=coreMetrics(id==='P01'?4800000:1000000);return {identity:{platform,shopName,dimension:context.effectiveScope.dimension,id},title:'合成商品 '+id,category:'合成类目',imageUrl:null,metrics,comparisons:pairs(metrics),baselineMetrics:{previous:window.__baseline503?missingBaseline():coreMetrics(4000000),yearAgo:coreMetrics(4500000)},paymentDelta:wireMetric(window.__baseline503?null:id==='P01'?800000:-3000000,'CNY_CENT','product_day_sum',window.__baseline503?'incomplete_baseline':null)};}
function envelope(query,detail=false){const context=apiContext(query);return {schemaVersion:'netshop-product-insights-v1',context,sectionToken:String(window.__revision%10).repeat(64),tableScope:table(query,detail),joinedSourceRevisions:context.sourceRevisions,consistency:'revision_vector_checked'};}
function baselines(){return {previous:window.__baseline503?{state:'error',data:null,code:'service_unavailable',message:'合成基期503'}:{state:'ready',data:coreMetrics(4000000)},yearAgo:{state:'ready',data:coreMetrics(4500000)}};}
function insights(query){
 const env=envelope(query),all=Array.from({length:42},(_,i)=>row(env.context,'P'+String(i+1).padStart(2,'0')));
 const search=query.get('q')||'',filtered=all.filter(item=>!search||item.title.includes(search)||item.identity.id.includes(search));
 const page=Number(query.get('page')||1),pageSize=Number(query.get('pageSize')||20),items=filtered.slice((page-1)*pageSize,page*pageSize),p=pagination(query,filtered.length,items.length),metrics=coreMetrics(42000000);
 const count=n=>wireMetric(n),share=n=>wireMetric(n,'RATIO');
 return {...env,sections:{summary:metrics,comparisons:pairs(metrics),items,pagination:p,baselineReads:baselines(),counts:{dataProducts:count(42),tradedProducts:count(42)},growth:{state:'ready',data:{collection:'paired_full_set_before_pagination',items,pagination:p}},structure:{collection:'complete_global_filter_set',denominator:metrics.payment,top5Payment:wireMetric(5000000,'CNY_CENT'),top10Payment:wireMetric(10000000,'CNY_CENT'),top5Share:share(.12),top10Share:share(.24),categories:[{label:'合成类目',payment:metrics.payment,share:share(1),products:count(42)}],priceBands:[{label:'成交均价1000元以上',payment:metrics.payment,share:share(1),products:count(42)}],categoryBasis:'source_label_only',priceBasis:'transaction_mean',classification:{continuous:count(42),newlyTraded:count(0),noLongerTraded:count(0),unknownBaseline:count(0)},qualification:{current:42,paired:42,missingPrevious:0,missingYearAgo:0,incomplete:0}},efficiency:{metrics:extras(),visitorValue:visitorValue(),rules:{id:'synthetic-minimum-visitors',minimumVisitors:100,maximumConversion:.03,requireComplete:true},watchlist:items,pagination:p,scanned:42,qualified:42},dataQuality:{counts:{missingImage:count(42),missingCode:count(0),missingCategory:count(0),conflict:count(0),stale:count(0),unmapped:count(42)},staleAfterDays:30,basis:'current_snapshot'},metadata:metadata()}};
}
function detail(query){
 const env=envelope(query,true),[platform,shopName,dimension,id]=JSON.parse(query.get('productIdentity')),performance=row(env.context,id),source=query.get('source')||'platform';
 const sourceMetrics=source==='platform'?{...coreMetrics(),...extras()}:source==='promotion'?linked(['spend','attributedPayment','roas','clicks'],'platform_attributed'):linked(['netSales','cost','largeMarginRate','orderMargin','returnAmount','returnQuantity'],'erp_net_sales');
 const all=days(env.context.periods.current).map(date=>({date,source,metrics:sourceMetrics})),page=Number(query.get('page')||1),size=Number(query.get('pageSize')||20),items=all.slice((page-1)*size,page*size);
 const daily={source,items,pagination:pagination(query,all.length,items.length),definitions:['合成API字段；平台、归因及ERP分开','缺源不填零'],startDate:env.context.periods.current.startDate,endDate:env.context.periods.current.endDate,sourceRevisions:env.context.sourceRevisions};
 return {...env,identity:{platform,shopName,dimension,id},sections:{performance,baselineReads:baselines(),catalog:{state:'ready',data:null},promotion:{state:'ready',data:{metrics:linked(['spend','attributedPayment','roas','clicks'],'platform_attributed'),mapping:unmapped(),attributionWindow:null}},erp:{state:'ready',data:{metrics:linked(['netSales','cost','largeMarginRate','orderMargin','returnAmount','returnQuantity'],'erp_net_sales'),mapping:unmapped()}},extras:extras(),visitorValue:visitorValue(),daily:{state:'ready',data:daily},trends:{state:'ready',data:daily},skuContribution:{status:'unavailable',reasonCode:'unverified_source',basis:'historical_relation',relationVersion:null,items:[],pagination:{page:1,pageSize:20,total:0,returned:0,hasMore:false,truncated:false}},metadata:metadata()}};
}
function catalog(query){
 const platform=query.get('platform')||'京东',shopName=(query.get('outlet')||platform+'\u001f合成店A').split('\u001f')[1],search=query.get('q')||'',all=Array.from({length:42},(_,i)=>({platform,shopName,spuId:'SPU'+(i+1),skuId:'SKU'+(i+1),productCode:'CODE'+(i+1),productName:'目录合成商品 '+(i+1),imageUrl:i===0?'/api/netshop/product-images/'+'f'.repeat(64):'',saleAttribute:'合成规格',category:'合成类目',brand:'合成品牌',price:10,priceCents:1000,totalInventory:12,availableInventory:10,status:'上架',productUrl:'',createdAt:'2026-09-01',snapshotDate:'2026-09-01',costPriceCents:null,netSalesCents:null,grossMarginRate:null,refundRate:null,salesMatched:false}));
 const filtered=all.filter(item=>!search||item.productName.includes(search)||item.skuId.includes(search)||item.spuId.includes(search)),page=Number(query.get('page')||1),size=Number(query.get('pageSize')||20),items=filtered.slice((page-1)*size,page*size);
 return {snapshotToken:'c'.repeat(64),batch:{fileName:'synthetic-catalog.xlsx',snapshotDate:'2026-09-01',rowCount:42,completedAt:'2026-09-01'},summary:{totalSkus:42,onSaleSkus:42,totalInventory:504,availableInventory:420},shops:[{platform,shopName,snapshotDate:'2026-09-01',completedAt:'2026-09-01'}],sales:{periodStart:query.get('startDate'),periodEnd:query.get('endDate'),dataCutoffDate:query.get('endDate'),platform},items,pagination:{page,pageSize:size,total:filtered.length,returned:items.length,truncated:false}};
}

return (url) => {
 const query=url.searchParams;
 const body=url.pathname.endsWith('/detail')?detail(query):url.pathname==='/api/netshop/products'?catalog(query):insights(query);
 if(body.schemaVersion==='netshop-product-insights-v1') {
  const complete=completeProductSectionsFixture(body.sections.summary ?? body.sections.performance.metrics);
  if(body.sections.items) {
   body.sections.items=body.sections.items.map(item=>({...item,imageStatus:'unverified'}));
   body.sections.growth.data.items=body.sections.growth.data.items.map(item=>({...item,imageStatus:'unverified'}));
   body.sections.efficiency.watchlist=body.sections.efficiency.watchlist.map(item=>({...item,imageStatus:'unverified'}));
   body.sections.structure={...body.sections.structure,changes:complete.structure.changes};
   body.sections.dataQuality=complete.dataQuality;
   body.sections.efficiency.visitorValue=complete.efficiency.visitorValue;
   body.sections.efficiency.visitorValueComparisons=complete.efficiency.visitorValueComparisons;
  } else {
   body.sections.performance.imageStatus='unverified';
   body.sections.visitorValue=complete.efficiency.visitorValue;
   body.sections.visitorValueComparisons=complete.efficiency.visitorValueComparisons;
  }
 }
 return body;
};
}
