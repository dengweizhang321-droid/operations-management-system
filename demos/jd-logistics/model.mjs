// Synthetic examples only. These are proposed display calculations, not JD API adapters.
export const initialAccounts = [
  {id:'a',name:'京东示例店 A',owner:'物流货主 A',collect:false,monitor:false,push:false},
  {id:'b',name:'京东示例店 B',owner:'物流货主 A',collect:false,monitor:false,push:false},
  {id:'c',name:'京东示例新店 C',owner:null,collect:false,monitor:false,push:false},
];
export const initialMappings = [
  {id:'m1',owner:'owner-a',goods:'EMG-DEMO-01',account:'a',sku:'JD-DEMO-01',name:'商用切片机',erp:'ERP-DEMO-01',erpName:'商用切片机 / 标准款'},
  {id:'m2',owner:'owner-a',goods:'EMG-DEMO-02',account:'a',sku:'JD-DEMO-02',name:'台式净水机',erp:'ERP-DEMO-02',erpName:'台式净水机 / 白色'},
  {id:'m3',owner:'owner-a',goods:'EMG-DEMO-03',account:'a',sku:'JD-DEMO-03',name:'商用料理机',erp:'',erpName:''},
  {id:'m4',owner:'owner-a',goods:'EMG-DEMO-04',account:'b',sku:'JD-DEMO-01',name:'设备 B',erp:'ERP-DEMO-B1',erpName:'设备 B / 标准款'},
];
export const flows = [
  {id:'f1',account:'a',sku:'JD-DEMO-01',time:'10-14 09:42',type:'调拨出库',warehouse:'华南 POP 物流仓',qty:-24,order:'DB-DEMO-001',erp:'未建单',age:26},
  {id:'f2',account:'a',sku:'JD-DEMO-02',time:'10-14 13:18',type:'采购入库',warehouse:'华东 POP 物流仓',qty:40,order:'RK-DEMO-002',erp:'待核对',age:22},
  {id:'f3',account:'a',sku:'JD-DEMO-03',time:'10-15 08:36',type:'调拨入库',warehouse:'华北 POP 物流仓',qty:12,order:'DB-DEMO-003',erp:'待核对',age:3},
  {id:'f4',account:'a',sku:'JD-DEMO-01',time:'10-15 09:15',type:'销售出库',warehouse:'华南 POP 物流仓',qty:-6,order:'CK-DEMO-004',erp:'已建单',age:2},
  {id:'f5',account:'b',sku:'JD-DEMO-01',time:'10-15 09:20',type:'调拨出库',warehouse:'华东 POP 物流仓',qty:-10,order:'DB-DEMO-B01',erp:'已建单',age:2},
  {id:'f6',account:'a',sku:'JD-DEMO-01',time:'10-15 09:30',type:'调拨入库',warehouse:'华东 POP 物流仓',qty:12,order:'DB-DEMO-001',erp:'未建单',age:2},
].map(f=>({...f,owner:'owner-a',goods:initialMappings.find(m=>m.account===f.account&&m.sku===f.sku).goods}));
export const sources = [
  {id:'flow',number:'01',title:'仓库库存流水',url:'https://wl.jdl.com/bsc-inventory/flow',grain:'货主 × 仓库 × 商品 × 流水',use:'ERP 建单核对、调拨追踪',state:'页面待核验'},
  {id:'products',number:'04',title:'店铺商品',url:'https://wl.jdl.com/supplychain-bbi/esg',grain:'账号 × 店铺 × 销售平台商品编码',use:'SKU 归属与商品对照的辅助数据源',state:'页面待核验'},
];
export function newAccount(id,name) { return {id,name,owner:null,collect:false,monitor:false,push:false}; }
export function flowRisk(flow,mapping,waitHours=24) {
  if (!flow.type.includes('调拨')) return '本轮不核对';
  if (!mapping?.erp || !mapping?.erpName) return '待补映射';
  if (flow.erp === '已建单') return '人工标记已建单';
  if (flow.erp === '未建单') return flow.age >= waitHours ? '超时未建单' : '未建单';
  return '待核对';
}
// The annotation identity survives sorting and includes the owning logistics entity.
export function transferKey(row) { return JSON.stringify([row.owner,row.order,row.goods]); }
export function groupTransfers(rows) {
  const groups=new Map();
  for(const row of rows.filter(r=>r.type.includes('调拨'))) {
    const key=transferKey(row);
    if(!groups.has(key)) groups.set(key,{...row,key,sourceIds:[],out:0,received:0,from:null,to:null});
    const group=groups.get(key);group.sourceIds.push(row.id);group.age=Math.max(group.age,row.age);
    if(row.type==='调拨出库'&&row.qty<0){group.out-=row.qty;group.from=row.warehouse;}
    if(row.type==='调拨入库'&&row.qty>0){group.received+=row.qty;group.to=row.warehouse;}
  }
  return [...groups.values()].map(g=>({...g,jdStatus:g.received>0&&g.out===0?'调出缺源':g.received>g.out?'收货量异常':g.out===0?'待出库':g.received===g.out?'已完成':g.received>0?'部分入库':'已出库在途'}));
}
export function summarize(rows,mappings,waitHours=24) {
  const transfers=groupTransfers(rows);
  const states=transfers.map(r=>flowRisk(r,mappings.find(m=>m.owner===r.owner&&m.goods===r.goods),waitHours));
  return {
    count:rows.length,
    transferCount:transfers.length,
    overdue:states.filter(s=>s==='超时未建单').length,
    unmapped:states.filter(s=>s==='待补映射').length,
    pending:states.filter(s=>['待核对','未建单'].includes(s)).length,
    confirmed:states.filter(s=>s==='人工标记已建单').length,
  };
}
