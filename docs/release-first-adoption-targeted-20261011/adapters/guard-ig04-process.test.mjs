import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import path from 'node:path';
import {readFileSync} from 'node:fs';
const old=readFileSync('E:/codex-artifacts/release-no-data-adoption-20261011/adoption-scope-guard-v4.mjs','utf8');
const current=readFileSync(new URL('./adoption-scope-guard.mjs',import.meta.url),'utf8');
const target=String.raw`d:\teruisi-runtime\django-sales\app.previous`;
const shell=String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`;
const related={ProcessId:47936,SessionId:1,Name:'powershell.exe',ExecutablePath:shell,CommandLine:null};
const normalize=v=>path.win32.normalize(v).toLowerCase();
function fixture(source=current,changes={}) {
 const maps=new Map(Object.entries(changes).map(([k,v])=>[normalize(k),v]));
 const realpath=async value=>{const v=maps.get(normalize(value));if(v instanceof Error)throw v;return v??path.win32.normalize(value);};
 const begin=source.indexOf('  const isReference='),end=source.indexOf('  let scanned=',begin);
 assert.ok(begin>0&&end>begin);
 const helpers=source.slice(begin,end);
 const loopStart=source.indexOf('  for(const p of current.processes)'),loopEnd=source.indexOf('\n  for(const task',loopStart);
 assert.ok(loopStart>0&&loopEnd>loopStart);
 const loop=source.slice(loopStart,loopEnd);
 return new Function('path','target','realpath','current',helpers+';const references=[];return (async()=>{'+loop+';return references;})();').bind(null,path.win32,target,realpath);
}
const audit=async processes=>fixture()( {processes} );
test('actual V4 process loop reproduces IG04 null-command zero-reference gap',async()=>{
 assert.deepEqual(await fixture(old)({processes:[related]}),[]);
 const result=await audit([related]);assert.equal(result.length,1);assert.equal(result[0].kind,'process-unknown');assert.equal(result[0].processId,47936);assert.equal(result[0].reason,'related-command-unreadable');
});
for(const [key,value]of [['Name',null],['Name',42],['ExecutablePath',null],['ExecutablePath',{}],['CommandLine',42],['CommandLine','   '],['ProcessId','47936'],['SessionId',null]])test('missing/invalid relevant process field rejects '+key+String(value),async()=>{
 const result=await audit([{...related,[key]:value}]);assert.equal(result[0].kind,'process-unknown');
});
test('Name/ExecutablePath disagreement is unknown even with a nonempty command line',async()=>{
 const result=await audit([{...related,Name:'svchost.exe',CommandLine:'safe-looking text'}]);assert.equal(result[0].reason,'name-executable-mismatch');
});
test('physical managed native actor without command is unknown',async()=>{
 const p={...related,Name:'native.exe',ExecutablePath:String.raw`C:\outside\native.exe`};
 const result=await fixture(current,{[p.ExecutablePath]:String.raw`D:\teruisi-runtime\managed\native.exe`})({processes:[p]});assert.equal(result[0].reason,'related-command-unreadable');
});
test('complete interpreter identity still detects protected command path',async()=>{
 const result=await audit([{...related,CommandLine:`powershell -File "${target}\\tools\\run.ps1"`}]);assert.equal(result[0].kind,'process');
});
test('complete unrelated native process remains inspectable without blanket rejection',async()=>{
 assert.deepEqual(await audit([{ProcessId:222,SessionId:1,Name:'vendor.exe',ExecutablePath:String.raw`C:\Vendor\vendor.exe`,CommandLine:String.raw`"C:\Vendor\vendor.exe" --background`}]),[]);
});
test('missing vendor command is not declared unrelated solely from Program Files',async()=>{
 const result=await audit([{ProcessId:222,SessionId:1,Name:'vendor.exe',ExecutablePath:String.raw`C:\Program Files\Vendor\vendor.exe`,CommandLine:null}]);assert.equal(result[0].kind,'process-unknown');
});
test('only physically exact named Windows native processes get missing-command exception',async()=>{
 const native={ProcessId:200,SessionId:0,Name:'svchost.exe',ExecutablePath:String.raw`C:\Windows\System32\svchost.exe`,CommandLine:null};
 assert.deepEqual(await audit([native]),[]);
 assert.equal((await audit([{...native,ExecutablePath:String.raw`C:\Vendor\svchost.exe`}]))[0].kind,'process-unknown');
 assert.equal((await audit([{...native,ExecutablePath:null}]))[0].kind,'process-unknown');
 assert.equal((await fixture(current,{[native.ExecutablePath]:String.raw`D:\other\svchost.exe`})({processes:[native]}))[0].kind,'process-unknown');
});
test('kernel pseudo-process exception requires exact PID Name Session and no contradicting fields',async()=>{
 for(const p of [{ProcessId:0,SessionId:0,Name:'System Idle Process',ExecutablePath:null,CommandLine:null},{ProcessId:4,SessionId:0,Name:'System',ExecutablePath:null,CommandLine:null}]){
  assert.deepEqual(await audit([p]),[]);assert.equal((await audit([{...p,CommandLine:'unexpected'}]))[0].kind,'process-unknown');assert.equal((await audit([{...p,SessionId:1}]))[0].kind,'process-unknown');
 }
});
test('unreadable executable identity remains unknown and never silently skips actor',async()=>{
 assert.equal((await fixture(current,{[shell]:new Error('denied')})({processes:[related]}))[0].reason,'executable-identity-unreadable');
});
test('query supplies Name and SessionId to the actual process loop',()=>{
 assert.ok(current.includes('Select-Object ProcessId,SessionId,Name,ExecutablePath,CommandLine'));
 assert.ok(current.includes("assert.equal(batch.recovery.mode,'targeted-first-adoption')"));
});
