import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const hash=b=>createHash('sha256').update(b).digest('hex');
const raw=await readFile(new URL('./evaluate-reference-capture.mjs',import.meta.url));
const code=raw.toString(),begin=code.indexOf('const selectedCwd='),end=code.indexOf('for(const p of capture.processes)',begin);
assert.ok(begin>=0&&end>begin);
const guardRaw=await readFile('E:/codex-artifacts/release-first-adoption-targeted-20261011/adoption-scope-guard-ig04.mjs');
const guard=guardRaw.toString(),a=guard.indexOf('  const isReference='),b=guard.indexOf('  // A missing command line',a);
const target='d:\\teruisi-runtime\\django-sales\\app.previous';
const predicate=vm.runInNewContext(guard.slice(a,b)+';inspectReferences',{path,target,realpath:async p=>p,Error});
const cases=[
 {name:'ordinary-absolute',input:{processId:47936,identityStable:true,readable:true,CurrentDirectory:'C:\\safe'}},
 {name:'target-reference',input:{processId:47936,identityStable:true,readable:true,CurrentDirectory:target}},
 {name:'invalid-newline',input:{processId:47936,identityStable:true,readable:true,CurrentDirectory:'C:\\safe\n'}},
 {name:'wrong-identity',input:{processId:1,identityStable:false,readable:true,CurrentDirectory:'C:\\safe'}},
 {name:'unreadable',input:{processId:47936,identityStable:true,readable:false}}
];
const results=[];
for(const c of cases){
 let result,error;
 try{result=await vm.runInNewContext('(async()=>{'+code.slice(begin,end)+';return selectedCwd;})()', {capture:{selectedCwd:c.input},inspectReferences:predicate,hash,assert});}
 catch(e){error=e.message;}
 const blocked=!!error||result?.readable!==true||!!result?.failure||result?.refersToPrevious===true;
 results.push({name:c.name,blocked,error:error??null,result});
}
assert.equal(results[0].blocked,false);assert.equal(results[1].blocked,true);assert.equal(results[4].blocked,true);
const record={version:'astra-cwd-consumer-control-v1',sourceSha256:hash(raw),guardSha256:hash(guardRaw),results,nativeCalls:0,uacInvocations:0,scope:'Actual selectedCwd consumer and frozen path predicate; synthetic physical resolver returns input, no live path or process proof.'};
await writeFile(process.argv[2],JSON.stringify(record,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(record,null,2));
