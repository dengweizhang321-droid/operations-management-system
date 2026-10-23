import test from 'node:test';
import assert from 'node:assert/strict';
import {handoffTaskRegistrationSddl,projectHandoffTaskSecurityDescriptor,assertHandoffTaskSecurity} from '../tools/preparation-retirement-handoff.mjs';
test('fixed Task owner/RX descriptor qualifies only the observed Scheduler ACE semantics',async()=>{
 const sid='S-1-5-21-101-202-303-1001';
 assert.equal(handoffTaskRegistrationSddl(sid),'O:'+sid+'G:'+sid+'D:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;GRGX;;;'+sid+')');
 // Pure .NET SDDL parsing in PS5 only: no Task Scheduler, token handoff or run.
 const actual=await projectHandoffTaskSecurityDescriptor('O:'+sid+'G:'+sid+'D:(A;;FA;;;SY)(A;;FA;;;BA)(A;;0x1200a9;;;'+sid+')(A;;FR;;;'+sid+')');
 assert.equal(actual.controlFlags,32772);assert.equal(assertHandoffTaskSecurity(actual,sid),actual);assertHandoffTaskSecurity({...actual,aces:[...actual.aces].reverse()},sid);
 for(const mutate of [x=>{x.owner='S-1-5-32-544';},x=>{x.group='S-1-5-18';},x=>{x.controlFlags=32768;},x=>{x.aces.pop();},x=>{x.aces.push({...x.aces[0]});},x=>{x.aces[2].mask=2032127;},x=>{x.aces[2].flags=16;},x=>{x.aces[2].type=1;},x=>{x.aces[2].sid='S-1-1-0';},x=>{x.aces[2].mask|=2;}]){const changed=structuredClone(actual);mutate(changed);assert.throws(()=>assertHandoffTaskSecurity(changed,sid));}
 for(const value of ['',sid+';injected','S-1-5-18','S-1-5-32-544'])assert.throws(()=>handoffTaskRegistrationSddl(value));
});
