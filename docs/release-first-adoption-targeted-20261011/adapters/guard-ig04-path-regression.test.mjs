import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
const old=readFileSync('E:/codex-artifacts/release-no-data-adoption-20261011/adoption-scope-guard.mjs','utf8');
const current=readFileSync(new URL('./adoption-scope-guard.mjs',import.meta.url),'utf8');
const target=String.raw`d:\teruisi-runtime\django-sales\app.previous`;
function fixture(source=current,entries=[],errors=[]) {
 const calls=[],map=new Map(entries.map(([a,b])=>[a.toLowerCase(),b]));
 const failures=new Map(errors.map(([a,b])=>[a.toLowerCase(),b]));
 const realpath=async p=>{calls.push(p);const key=p.toLowerCase();if(map.has(key))return map.get(key);throw Object.assign(new Error('fixture resolution failure'),{code:failures.get(key)??'ENOENT'});};
 const begin=source.indexOf('  const isReference='),end=source.indexOf('  let scanned=',begin);
 assert.ok(begin>0&&end>begin);
 const functions=vm.runInNewContext(source.slice(begin,end)+';({inspectReferences,visitValue})',{path:path.win32,target,Error,realpath});
 return {...functions,calls};
}
const pairs=[
 [String.raw`C:\CROSS~1\run.ps1`,target+String.raw`\run.ps1`],
 [String.raw`C:\External Junction\run.ps1`,target+String.raw`\run.ps1`],
 [String.raw`D:\External Junction\run.ps1`,target+String.raw`\run.ps1`],
 [String.raw`C:\A Working Directory`,target],
];
for(const [input,physical]of pairs)test(`V3 gap reproduced then V4 rejected reference: ${input}`,async()=>{
 assert.equal(await fixture(old,[[input,physical]]).inspectReferences(input),false);
 assert.equal(await fixture(current,[[input,physical]]).inspectReferences(input),true);
});
test('long canonical paths, slash and case remain detected',async()=>{
 for(const p of [target,target+String.raw`\run.ps1`,target.toUpperCase().replaceAll('\\','/')])assert.equal(await fixture().inspectReferences(p),true);
});
test('quoted command and arguments inspect full tokens on any drive',async()=>{
 for(const text of [String.raw`powershell -File "C:\External Junction\run.ps1" -Json`,String.raw`-File 'C:\External Junction\run.ps1'`,String.raw`--script=C:\CROSS~1\run.ps1`])assert.equal(await fixture(current,pairs).inspectReferences(text,{commandLine:true}),true);
});
test('single Execute/ExecutablePath/WorkingDirectory path with spaces is not truncated',async()=>{
 const f=fixture(current,pairs);assert.equal(await f.inspectReferences(String.raw`C:\A Working Directory`),true);assert.deepEqual(f.calls,[String.raw`C:\A Working Directory`]);
});
test('missing long child resolves through nearest cross-volume junction ancestor',async()=>{
 const f=fixture(current,[[String.raw`C:\External Junction`,target]]);
 assert.equal(await f.inspectReferences(String.raw`C:\External Junction\missing dir\run.ps1`),true);
 assert.deepEqual(f.calls,[String.raw`C:\External Junction\missing dir\run.ps1`,String.raw`C:\External Junction\missing dir`,String.raw`C:\External Junction`]);
});
test('known long missing path outside package can be ruled out via real ancestor',async()=>{
 assert.equal(await fixture(current,[[String.raw`C:\Ordinary`,String.raw`E:\Ordinary`]]).inspectReferences(String.raw`C:\Ordinary\missing dir\file`),false);
});
test('unresolved short component below existing ancestor fails closed',async()=>{
 await assert.rejects(fixture(current,[['C:\\','C:\\']]).inspectReferences(String.raw`C:\MISSING~1\run.ps1`),/Cannot resolve/);
});
test('resolved unrelated short alias and literal tilde name remain allowed',async()=>{
 for(const p of [String.raw`C:\PROGRA~1\tool.exe`,String.raw`D:\name~1\run.ps1`])assert.equal(await fixture(current,[[p,String.raw`E:\unrelated\file`]]).inspectReferences(p),false);
});
test('access denied never falls back to a parent',async()=>{
 const p=String.raw`C:\Denied\file`,f=fixture(current,[[String.raw`C:\Denied`,String.raw`E:\Safe`]],[[p,'EACCES']]);
 await assert.rejects(f.inspectReferences(p),/Cannot resolve/);assert.deepEqual(f.calls,[p]);
});
test('unresolvable drive root is unknown and blocks',async()=>{
 await assert.rejects(fixture().inspectReferences(String.raw`Z:\missing\file`),/Cannot resolve/);
});
test('extended DOS physical prefix is recognized',async()=>{
 assert.equal(await fixture(current,[[String.raw`C:\alias`,String.raw`\\?\D:\teruisi-runtime\django-sales\app.previous`]]).inspectReferences(String.raw`C:\alias`),true);
});
test('nested metadata uses complete single paths with spaces',async()=>{
 assert.equal(await fixture(current,pairs).visitValue({candidate:{sourceRoot:String.raw`C:\A Working Directory`}}),true);
});
test('non-path text and URLs are not arbitrary script parsing',async()=>{
 const f=fixture();assert.equal(await f.inspectReferences('https://example.invalid',{commandLine:true}),false);assert.equal(await f.inspectReferences('powershell -EncodedCommand BASE64',{commandLine:true}),false);assert.deepEqual(f.calls,[]);
});
