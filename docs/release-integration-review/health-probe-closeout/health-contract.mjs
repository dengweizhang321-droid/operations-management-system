import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const newOperationId='health-probe-contract-readiness-supplement';
export const sourceScriptRoot='D:/运营管理系统/tools';
export const derivedControllerPath=fileURLToPath(new URL('./readonly-control.ps1',import.meta.url));
export function makeDerivedOperation(original,scope){
  assert.equal(original.id,'exact-final-readiness');assert.equal(original.mutating,false);assert.equal(original.phase,'closeout');
  assert.equal(path.resolve(scope.derivedControllerPath),path.resolve(scope.outputRoot,'readonly-control.ps1'));
  const files=new Map(original.command.files.map(f=>[path.resolve(f.path),f]));files.set(path.resolve(scope.derivedControllerPath),{path:scope.derivedControllerPath,sha256:scope.derivedControllerSha256});
  return{...original,id:newOperationId,command:{...original.command,args:[...original.command.args.slice(0,3),scope.derivedControllerPath,...original.command.args.slice(4),'-SourceScriptRoot',sourceScriptRoot],files:[...files.values()]}};
}
export function assertHealthyContract(value){
  assert.equal(value?.version,1);assert.ok(value.checkedAt&&Number.isFinite(Date.parse(value.checkedAt)));assert.deepEqual(Object.keys(value.probes).sort(),['helper','live','ready']);
  for(const [name,budget]of [['live',3000],['helper',3000],['ready',5000]]){const p=value.probes[name];for(const k of ['called','requested','parsedObject','okMatches','markerMatches','passed','beforeDeadline'])assert.equal(p?.[k],true);assert.equal(p.statusCode,200);assert.equal(p.errorKind,'none');assert.equal(p.degradedMatches,false);assert.equal(p.timeoutMs,budget);assert.ok(Number.isSafeInteger(p.effectiveTimeoutMs)&&p.effectiveTimeoutMs>=1&&p.effectiveTimeoutMs<=budget);assert.ok(Number.isFinite(p.elapsedMs)&&p.elapsedMs>=0&&p.elapsedMs<=p.effectiveTimeoutMs,'Actual whole probe exceeded effective budget');}
  return value;
}
