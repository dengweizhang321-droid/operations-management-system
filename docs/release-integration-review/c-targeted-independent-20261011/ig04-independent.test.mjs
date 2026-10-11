import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import vm from 'node:vm';
const current=readFileSync('E:/codex-artifacts/release-first-adoption-targeted-20261011/adoption-scope-guard-ig04.mjs','utf8');
const old=readFileSync('E:/codex-artifacts/release-no-data-adoption-20261011/adoption-scope-guard-v4.mjs','utf8');
const h=s=>createHash('sha256').update(s).digest('hex');
assert.equal(h(current),'eb01db494d47d8e376af8d4a5fc69e823bbcf72672bdfbaf7f80a1cc914882bd');
assert.equal(h(old),'04655a323af97453b7ae38670a6470e495226e85c337fb9b0a72684726a54edd');
const target=String.raw`d:\teruisi-runtime\django-sales\app.previous`;
const shell=String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`;
const related={ProcessId:12345,SessionId:1,Name:'powershell.exe',ExecutablePath:shell,CommandLine:null};
function fixture(source=current,mappings={}){
 const begin=source.indexOf('  const isReference='),end=source.indexOf('  let scanned=',begin);
 const lb=source.indexOf('  for(const p of current.processes)'),le=source.indexOf('\n  for(const task',lb);
 assert.ok(begin>0&&end>begin&&lb>end&&le>lb);
 const map=new Map(Object.entries(mappings).map(([k,v])=>[path.win32.normalize(k).toLowerCase(),v]));
 const realpath=async p=>{const v=map.get(path.win32.normalize(p).toLowerCase());if(v instanceof Error)throw v;return v??path.win32.normalize(p);};
 return async processes=>{
  const references=[];
  await vm.runInNewContext(source.slice(begin,end)+'\n(async()=>{'+source.slice(lb,le)+';})()',
   {path:path.win32,target,Error,realpath,current:{processes},references});
  return JSON.parse(JSON.stringify(references));
 };
}
const reject=async p=>{const refs=await fixture()([p]);assert.equal(refs.length,1);assert.equal(refs[0].kind,'process-unknown');assert.throws(()=>assert.deepEqual(refs,[]));return refs[0];};
test('same old null-command counterexample is retained; current exact guard blocks unknown',async()=>{
 assert.deepEqual(await fixture(old)([related]),[]);
 assert.equal((await reject(related)).reason,'related-command-unreadable');
});
test('related host missing fields and contradictory typed identity never clear the guard',async()=>{
 for(const change of [{ExecutablePath:null},{Name:null},{CommandLine:[]},{ProcessId:'12345'},{SessionId:NaN},{Name:'svchost.exe',CommandLine:'safe looking text'}])await reject({...related,...change});
});
test('different relevant interpreters with empty or missing argv remain unknown',async()=>{
 for(const name of ['node.exe','pythonw.exe','cmd.exe','dotnet.exe'])await reject({...related,Name:name,ExecutablePath:'C:\\fixture-hosts\\'+name,CommandLine:''});
});
test('physical managed actor cannot borrow unrelated lexical executable identity',async()=>{
 const p={...related,Name:'native.exe',ExecutablePath:'E:\\alias\\native.exe'};
 const refs=await fixture(current,{[p.ExecutablePath]:'D:\\teruisi-runtime\\django-sales\\app\\native.exe'})([p]);
 assert.equal(refs[0].kind,'process-unknown');assert.equal(refs[0].reason,'related-command-unreadable');
});
test('only exact kernel and physical native Windows exceptions clear missing argv',async()=>{
 const accepted=[{ProcessId:0,SessionId:0,Name:'System Idle Process',ExecutablePath:null,CommandLine:null},{ProcessId:4,SessionId:0,Name:'System',ExecutablePath:null,CommandLine:null},{ProcessId:333,SessionId:0,Name:'svchost.exe',ExecutablePath:'C:\\Windows\\System32\\svchost.exe',CommandLine:null}];
 assert.deepEqual(await fixture()(accepted),[]);
 for(const p of accepted.slice(0,2)){await reject({...p,SessionId:2});await reject({...p,CommandLine:'contradiction'});}
 await reject({...accepted[2],ExecutablePath:'E:\\Windows\\System32\\svchost.exe'});
});
test('unreadable native executable and redirected native-name host remain unknown',async()=>{
 const p={ProcessId:333,SessionId:0,Name:'svchost.exe',ExecutablePath:'C:\\Windows\\System32\\svchost.exe',CommandLine:null};
 for(const value of [new Error('fixture EACCES'),'E:\\vendor\\svchost.exe']){
  const refs=await fixture(current,{[p.ExecutablePath]:value})([p]);assert.equal(refs[0].kind,'process-unknown');
 }
});
test('complete harmless native identity clears; complete interpreter reference is retained',async()=>{
 assert.deepEqual(await fixture()([{...related,Name:'fixture.exe',ExecutablePath:'E:\\private\\fixture.exe',CommandLine:'"E:\\private\\fixture.exe" --synthetic'}]),[]);
 const refs=await fixture()([{...related,CommandLine:'powershell -File "'+target+'\\tools\\run.ps1"'}]);assert.equal(refs[0].kind,'process');
});
