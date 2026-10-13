import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectBusiness,inspectPermissions,classifyPublication} from '../docs/jackyun-unified-recovery-20261013/adoption-checks.mjs';
test('postconditions perform only bounded reads and keep replay distinct',async()=>{
 const calls=[];const r=await inspectBusiness(async(port,route)=>{calls.push([port,route]);return {status:200,text:JSON.stringify(route.includes('recovery')?{ok:true,state:'failed',newCollectionAllowed:false}:{items:[]})};});
 assert.equal(calls.length,6);assert.equal(r.businessReplayPerformed,false);assert.equal(r.productionWrites,0);
 for(const status of [401,500])await assert.rejects(inspectBusiness(async()=>({status,text:'{}'})));
 await assert.rejects(inspectBusiness(async()=>({status:200,text:JSON.stringify({items:[{},{}]})})));
 await assert.rejects(inspectBusiness(async(_p,r)=>({status:200,text:JSON.stringify(r.includes('recovery')?{ok:true}:{items:[]})})));
});
test('publication gate requires actual version and exact definition, never a saved draft or unknown drift',()=>{
 const e={id:'fixed',beforeVersionId:'old',before:{nodes:[1],connections:{},settings:{}},after:{nodes:[2],connections:{},settings:{saveProgress:true}}};
 const base={id:'fixed',active:true,pinDataEmpty:true,running:0,activeVersionId:'old',definition:e.before};
 assert.equal(classifyPublication(e,base),'pending');assert.equal(classifyPublication(e,{...base,activeVersionId:'new',definition:e.after}),'published');
 assert.equal(classifyPublication(e,{...base,definition:{...e.before,settings:e.after.settings}}),'pending');
 for(const bad of [{id:'other'},{active:false},{pinDataEmpty:false},{running:1},{activeVersionId:'unrelated'},{definition:e.after},{definition:{nodes:[3]}}])assert.throws(()=>classifyPublication(e,{...base,...bad}));
});
test('permission postconditions reject success from unsigned or malformed requests',async()=>{
 const request=async port=>({status:port===8091||port===8092?401:400,text:'{}'});
 assert.equal((await inspectPermissions(request)).productionWrites,0);
 for(const port of [8091,8092,3000,5791])await assert.rejects(inspectPermissions(async(p,r)=>p===port?{status:200,text:'{}'}:request(p,r)));
});
