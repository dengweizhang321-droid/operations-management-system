import test from 'node:test';import assert from 'node:assert/strict';
import {fixed,makeRecoveryMarker,assertOwnGates,assertRecoveryStageContext} from '../docs/startup-recovery-integration-20261012/recovery-context.mjs';
const sha='a'.repeat(64),marker=()=>makeRecoveryMarker(sha),drain=()=>({version:'teruisi-automation-drain-v1',id:fixed.repairId,runtimeRoot:'D:\\teruisi-runtime\\django-sales',keepPostgres:true,phase:'requests'}),desired=state=>({version:'teruisi-django-supervisor-desired-state-v1',desiredState:state,serviceScriptSha256:fixed.serviceSha256});
test('gate phase transition follows original stopped maintenance and preserves unknown Start',()=>{
 const before={marker:null,drain:null,desired:desired('running'),desiredSha256:fixed.desiredSha256};assertRecoveryStageContext('preflight',before,sha);
 const closed={...before,marker:marker(),drain:drain()};assertRecoveryStageContext('stop-declared-instances',closed,sha);
 const stopped={...closed,marker:{...marker(),drainedStopped:true},desired:desired('stopped')};assertRecoveryStageContext('exit-stopped-maintenance',stopped,sha);
 assertRecoveryStageContext('start-original-stack',{...before,desired:desired('stopped')},sha);
 assertRecoveryStageContext('verify-ready',before,sha);
});
for(const [name,change]of [['foreign-owner',x=>x.id='b'.repeat(32)],['wrong-intent',x=>x.repairIntentSha256='b'.repeat(64)],['fake-drained',x=>x.drainedStopped='true'],['array-bool',x=>x.keepPostgres=[true]],['runtime-root',x=>x.runtimeRoot='D:\\elsewhere'],['unknown-field',x=>x.bypass=true]])test('reject own marker '+name,()=>{const x=marker();change(x);assert.throws(()=>assertOwnGates(x,null,sha));});
test('failure containment permits only own extant gate, never treats missing gate as stopped',()=>{assertRecoveryStageContext('failure-containment',{marker:null,drain:drain(),desired:desired('stopped')},sha);assert.throws(()=>assertRecoveryStageContext('exit-stopped-maintenance',{marker:null,drain:drain(),desired:desired('stopped')},sha));assert.throws(()=>assertOwnGates(marker(),{...drain(),id:'0'.repeat(32)},sha));});
test('start and install refuse leftover admission; typed service binding remains fixed',()=>{for(const stage of ['start-original-stack','verify-ready','install-diagnostic'])assert.throws(()=>assertRecoveryStageContext(stage,{marker:marker(),drain:drain(),desired:desired('running')},sha));assert.throws(()=>assertRecoveryStageContext('verify-ready',{marker:null,drain:null,desired:{...desired('running'),serviceScriptSha256:'0'.repeat(64)}},sha));});
