import test from 'node:test';
import assert from 'node:assert/strict';
import {flows,initialMappings,groupTransfers,transferKey,flowRisk,newAccount,summarize} from './model.mjs';

test('paired events form one partial transfer; inbound without outbound remains unknown',()=>{
 const groups=groupTransfers(flows.filter(f=>f.account==='a'));
 assert.equal(groups.length,2);
 const partial=groups.find(g=>g.order==='DB-DEMO-001');
 assert.equal(partial.out,24);assert.equal(partial.received,12);assert.equal(partial.jdStatus,'部分入库');
 assert.equal(groups.find(g=>g.order==='DB-DEMO-003').jdStatus,'调出缺源');
});
test('manual annotation identity survives source order and separates owner and goods',()=>{
 const source=flows[0];
 assert.equal(transferKey(source),transferKey(flows.find(f=>f.id==='f6')));
 assert.notEqual(transferKey(source),transferKey({...source,owner:'owner-b'}));
 assert.notEqual(transferKey(source),transferKey({...source,goods:'EMG-other'}));
 const normalize=rows=>groupTransfers(rows).map(r=>[r.key,r.out,r.received,r.jdStatus]).sort();
 assert.deepEqual(normalize(flows),normalize([...flows].reverse()));
});
test('missing mapping and unconfirmed ERP do not turn into successful or overdue matches',()=>{
 const f=flows[0],m=initialMappings[0];
 assert.equal(flowRisk(f,{...m,erpName:''}),'待补映射');
 assert.equal(flowRisk({...f,erp:'待核对',age:99},m),'待核对');
 assert.equal(flowRisk({...f,erp:'已建单'},m),'人工标记已建单');
 assert.equal(flowRisk(f,m,27),'未建单');
 assert.equal(flowRisk(f,m,26),'超时未建单');
 assert.equal(flowRisk(flows.find(f=>f.type==='销售出库'),m),'本轮不核对');
});
test('new account starts disabled and transfer counts do not count each event twice',()=>{
 assert.deepEqual(newAccount('x','test'),{id:'x',name:'test',owner:null,collect:false,monitor:false,push:false});
 const a=summarize(flows.filter(f=>f.account==='a'),initialMappings);
 assert.equal(a.count,5);assert.equal(a.transferCount,2);assert.equal(a.overdue,1);assert.equal(a.unmapped,1);
});
