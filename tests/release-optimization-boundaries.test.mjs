import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
import {createHash} from 'node:crypto';
const base=process.env.TERUISI_COMPATIBILITY_BASE??'7ca85e40c2857ede3a55c4fffda1b3945aeb4f1f';
function statements(text,allowed){
 const file=ts.createSourceFile('fixture.mjs',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 assert.equal(file.parseDiagnostics.length,0);
 return file.statements.filter(node=>!ts.isFunctionDeclaration(node)||!allowed.has(node.name?.text)).map(node=>node.getText(file).replaceAll('\r\n','\n'));
}
test('Worker static source reader changes leave all other runtime behavior byte-identical',async()=>{
 const file='tools/worker-local-release.mjs',before=execFileSync('git',['show',base+':'+file],{encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024}),after=await fs.readFile(file,'utf8');
 const allowed=new Set(['verifyBoundWorkerSource','workerPreparationIdentity']);
 assert.deepEqual(statements(after,allowed),statements(before,allowed));
});
// C 项 S16 (2026-10-26): the rotation producer gains log-only preparation stage
// timing. `statements()` pins every top-level statement outside `allowed`, so
// the timing would fail closed. Widening `allowed` was rejected: that would
// drop planWorkerReleaseRotation out of this gate for good, and with it the
// predecessor-boundary, head-unchanged and chainStateSha256 checks it carries.
// Instead the log-only timing is stripped back out at the AST level and the
// exact set of timing additions is pinned; anything beyond that fails closed.
const timingHelpers=['preparationTimingLine','logPreparationTiming','timePreparationStage'];
const timingCounters=/^(predecessorCheckCount|sourceSampleCount|planPublicationStarted)$/;
const parseSource=text=>ts.createSourceFile('fixture.mjs',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const printSource=file=>ts.createPrinter({removeComments:true}).printFile(file);
function transformSource(text,maker){const file=parseSource(text);assert.equal(file.parseDiagnostics.length,0);return printSource(ts.transform(file,[maker]).transformed[0]);}
// Pass 1: drop logPreparationTiming(...) statements and the timing-only
// declarations, and unwrap `timePreparationStage(key,label,fn)` back to `fn`.
const dropTiming=context=>root=>{
 const visit=node=>{
  if(ts.isExpressionStatement(node)&&ts.isCallExpression(node.expression)&&ts.isIdentifier(node.expression.expression)&&node.expression.expression.text==='logPreparationTiming')return undefined;
  if(ts.isVariableStatement(node)){
   const names=node.declarationList.declarations.map(d=>d.name.getText(root));
   if(names.length===1&&timingCounters.test(names[0]))return undefined;
   if(names.length===2&&names.includes('stage')&&names.includes('label'))return undefined;
  }
  if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='timePreparationStage'){
   assert.equal(node.arguments.length,3,'timePreparationStage takes exactly (stage,label,operation)');
   const operation=node.arguments[2];
   assert.ok(ts.isArrowFunction(operation),'the timed operation must stay an arrow function');
   return ts.isBlock(operation.body)
    ?ts.visitNode(ts.factory.createCallExpression(ts.factory.createParenthesizedExpression(operation),undefined,[]),visit)
    :ts.visitNode(operation.body,visit);
  }
  return ts.visitEachChild(node,visit,context);
 };
 return ts.visitNode(root,visit);
};
// Pass 2: `async()=>(async()=>{...})()` collapses back to `async()=>{...}`,
// the one place S16 changed a function body's structure (sampleSource).
const collapseImmediate=context=>root=>{
 const visit=node=>{
  node=ts.visitEachChild(node,visit,context);
  if(ts.isArrowFunction(node)&&!ts.isBlock(node.body)&&ts.isCallExpression(node.body)&&node.body.arguments.length===0){
   let callee=node.body.expression;
   if(ts.isParenthesizedExpression(callee))callee=callee.expression;
   if(ts.isArrowFunction(callee)&&ts.isBlock(callee.body))return ts.factory.updateArrowFunction(node,node.modifiers,node.typeParameters,node.parameters,node.type,node.equalsGreaterThanToken,callee.body);
  }
  return node;
 };
 return ts.visitNode(root,visit);
};
export function comparePreparationTimingChange(before,after){
 const baseline=printSource(parseSource(before));
 const stripped=transformSource(transformSource(after,dropTiming),collapseImmediate);
 const declared=text=>{const file=parseSource(text),out=new Set();
  for(const node of file.statements)if(ts.isFunctionDeclaration(node)&&node.name)out.add(node.name.text);
  return out;};
 const basis=declared(baseline),candidate=declared(printSource(parseSource(after)));
 // The three timing helpers must be new in the candidate and absent from the base.
 for(const name of timingHelpers){if(basis.has(name)||!candidate.has(name))return false;}
 // Every statement — planWorkerReleaseRotation included — must be identical once
 // the timing is stripped. Only the three new helpers are exempt.
 const remaining=text=>{const file=parseSource(text);
  return file.statements.filter(node=>!ts.isFunctionDeclaration(node)||!timingHelpers.includes(node.name?.text)).map(node=>node.getText(file));};
 const want=remaining(baseline),got=remaining(stripped);
 if(want.length!==got.length)return false;
 return want.every((text,index)=>text===got[index]);
}
const timingHelperSha256={
 preparationTimingLine:'0c1811a62e32fe73d6264e9208648eb776e6ef3352b7f5dcffc013b17e0427dd',
 logPreparationTiming:'3b9d55cdcb99be51bfac7b60a39014394bccbbc210fef5da5ae3cc3f7f4621fa',
 timePreparationStage:'4aaaba843895856dc8401bb367ff6a7749afed1cf596d8d339bff220877cbc66'
};
const timingSha=text=>createHash('sha256').update(Buffer.from(text.replaceAll('\r\n','\n'),'utf8')).digest('hex');
function timingHelperTexts(text){const file=parseSource(text),out={};
 for(const node of file.statements)if(ts.isFunctionDeclaration(node)&&timingHelpers.includes(node.name?.text))out[node.name.text]=node.getText(file);
 return out;}
test('rotation waiting does not change apply/CAS/fence/process/entrypoint/startup boundaries',async()=>{
 const file='tools/worker-local-release-rotation.mjs',before=execFileSync('git',['show',base+':'+file],{encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024}),after=await fs.readFile(file,'utf8');
 const allowed=new Set(['withRotationLock','acquireRotationLock','acquirePreparationRotationLock']);
 const original=statements(before,allowed),current=statements(after,allowed);
 let unchanged=original.length===current.length&&original.every((text,index)=>text===current[index]);
 if(unchanged)return; // the base already carries S16; there is nothing to strip.
 // Layer 1: stripping the log-only timing restores the baseline exactly.
 assert.equal(comparePreparationTimingChange(before,after),true,'准备侧计时之外的语句发生变化');
 // Layer 2: the exact timing additions are pinned, so a different shape fails.
 const helpers=timingHelperTexts(after);
 assert.deepEqual(Object.keys(helpers).sort(),[...timingHelpers].sort());
 for(const name of timingHelpers)assert.equal(timingSha(helpers[name]),timingHelperSha256[name],name);
 // The 13 stage keys and their order are asserted in worker-preparation-timing.test.mjs;
 // here the wrapped call-site count is pinned so adding or dropping one fails.
 assert.equal((after.match(/timePreparationStage\(/g)||[]).length,15); // 1 declaration + 14 wrapped call sites
 assert.equal((after.match(/logPreparationTiming\(/g)||[]).length,3);
});
test('C 项: the timing comparator refuses any non-timing edit, a changed helper, and a moved wrapper',async()=>{
 const file='tools/worker-local-release-rotation.mjs',before=execFileSync('git',['show',base+':'+file],{encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024}),after=await fs.readFile(file,'utf8');
 if(!after.includes('timePreparationStage'))return; // the base already carries S16
 assert.equal(comparePreparationTimingChange(before,after),true);
 // A non-timing statement inside planWorkerReleaseRotation: refused.
 const inPlan='serviceLock = await timePreparationStage("tail.service-lock", "尾段服务锁等待", () => acquireWorkerServiceMutex());';
 assert.ok(after.includes(inPlan));
 assert.equal(comparePreparationTimingChange(before,after.replace(inPlan,'serviceLock = await timePreparationStage("tail.service-lock", "尾段服务锁等待", () => acquireWorkerServiceMutex({ force: true }));')),false);
 // A non-timing statement in any other function or at the top level: refused.
 const other='export const rotationPlanVersion = "teruisi-local-worker-release-rotation-plan-v1";';
 assert.ok(after.includes(other));
 assert.equal(comparePreparationTimingChange(before,after.replace(other,other.replace('plan-v1','plan-v2'))),false);
 // An edit to a timing helper's own body: layer 1 still holds (it is exempt
 // there), so layer 2's pinned hashes are what must catch it.
 const tampered=after.replace('    outcome = "ok";','    outcome = "fine";');
 assert.notEqual(tampered,after);
 assert.notEqual(timingSha(timingHelperTexts(tampered).timePreparationStage),timingHelperSha256.timePreparationStage);
 // Dropping one wrapped call site: the pinned call-site count catches it.
 const unwrapOne=after.replace('await timePreparationStage("rotation-lock", "轮换锁获取", () => lockForOperation(rotationLease))','await lockForOperation(rotationLease)');
 assert.notEqual(unwrapOne,after);
 assert.equal((unwrapOne.match(/timePreparationStage\(/g)||[]).length,14);
 // Wrapping a call the base did not have wrapped there: refused, because the
 // unwrapped text then carries a statement the baseline does not have.
 const plain='serviceLock = await acquireWorkerServiceMutex();';
 assert.ok(after.includes(plain));
 const extra=after.replace(plain,'serviceLock = await timePreparationStage("extra", "额外", () => acquireWorkerServiceMutex({ extra: true }));');
 assert.notEqual(extra,after);
 assert.equal(comparePreparationTimingChange(before,extra),false);
 // Removing the helper declarations while keeping the call sites: refused.
 const withoutLine=after.replace(/export function preparationTimingLine[\s\S]*?\n}\n/,'');
 assert.notEqual(withoutLine,after);
 assert.equal(comparePreparationTimingChange(before,withoutLine),false);
 // The base compared against itself: refused, because the helpers are not new.
 assert.equal(comparePreparationTimingChange(before,before),false);
 // A timed operation that is not an arrow function is rejected outright.
 const indirect=after.replace('timePreparationStage("rotation-lock", "轮换锁获取", () => lockForOperation(rotationLease))','timePreparationStage("rotation-lock", "轮换锁获取", lockForOperation)');
 assert.notEqual(indirect,after);
 assert.throws(()=>comparePreparationTimingChange(before,indirect),/arrow function/);
});
test('readiness changes preserve the native deploy/apply/start/ready callback after admitted maintenance',async()=>{
 const file='tools/publish-prepared-main.mjs',before=execFileSync('git',['show',base+':'+file],{encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024}).replaceAll('\r\n','\n');
 const after=(await fs.readFile(file,'utf8')).replaceAll('\r\n','\n');
 const policy=` const preparationDeadline=Math.min(Date.now()+1800000,Number(process.env.TERUISI_PROCESS_DEADLINE_UNIX_MS)||Infinity);
 const preparationWait=context.prepareOnly?{requestId:digest(Buffer.from(JSON.stringify(request))),deadlineUnixMs:preparationDeadline}:undefined;
`;
 assert.ok(after.includes(policy));
 // Once the base already carries this reviewed policy, the whole file must
 // remain identical; stripping only the candidate would reject an unchanged file.
 const tail='    assert.equal(entered.status,\'maintenance\');assert.equal(entered.maintenanceId,maintenanceId);assert.equal(entered.postgresPreserved,true);';
 const oldTail=before.slice(before.indexOf(tail)),nextTail=after.slice(after.indexOf(tail));
 assert.ok(before.includes(tail)&&after.includes(tail));
 // The bounded release-lease refresh/cleanup calls are the only permitted
 // additions after the admitted-maintenance boundary. Strip those exact calls
 // so the original deploy/apply/start/ready callback equality still holds.
 const stripLease=text=>text
  .replace(/^[ \t]*await (?:refreshLease|endLease)\([^\n]*?\);[ \t]*\n/gm,'')
  .replace(/await (?:refreshLease|endLease)\([^\n]*?\);/g,'');
 assert.equal(stripLease(nextTail).replace(' },preparationWait);',' });'),stripLease(oldTail).replace(' },preparationWait);',' });'));
});
