/** Three fixed absent-root read-only trial; never a history qualification. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';
const start=performance.now(),deadline=start+14000,sha=b=>createHash('sha256').update(b).digest('hex'),execute=promisify(execFile),here=path.dirname(fileURLToPath(import.meta.url)),repo=path.resolve(here,'../..');
const rows=JSON.parse(await fs.readFile(path.join(here,'protected-history-shapes.json'),'utf8')).rows.filter(r=>!r.present).slice(0,3),source=JSON.parse(await fs.readFile(path.join(here,'candidate-reference-observation.json'),'utf8')).needles.originalSource;
assert.equal(rows.length,3);assert.equal(source,'D:/codex-isolated/main-release-packages/36668589cab0-71ecf390-bbc9a5ef/source');for(const r of rows){assert.equal(path.resolve(r.snapshot),path.resolve('D:/teruisi-runtime/teruisi-worker-sales/releases',r.releaseId,'source-snapshot'));await assert.rejects(fs.lstat(r.snapshot),{code:'ENOENT'});}
const env={...process.env,GIT_OPTIONAL_LOCKS:'0'};for(const k of Object.keys(env))if(/^GIT_/i.test(k)&&k!=='GIT_OPTIONAL_LOCKS')delete env[k];
const output=await execute('git',['-C',source,'ls-files','-z','--cached','--others','--exclude-standard'],{env,windowsHide:true,encoding:'utf8',timeout:3000,maxBuffer:4*1024*1024});
const names=output.stdout.split('\0').filter(Boolean).map(n=>n.replaceAll('\\','/')).filter(n=>n!=='.dev.vars'&&!['dist/','node_modules/','.git/','.runtime/','outputs/','tmp/'].some(p=>n.startsWith(p))).sort();assert.ok(names.length>0&&names.length<30000);assert.equal(new Set(names).size,names.length);
// Values are deliberately inert: every measured root is absent. No file is read.
const inventory=Object.fromEntries(names.map(n=>[n,'0'.repeat(64)]));
const {retirementSourceDifference}=await import(pathToFileURL(path.join(repo,'tools/preparation-retirement-collector.mjs'))),{retirementEntity}=await import(pathToFileURL(path.join(repo,'tools/preparation-retirement-fs.mjs')));
const original={},counts={};let current=null;const inside=file=>rows.some(r=>{const rel=path.relative(r.snapshot,path.resolve(String(file)));return rel===''||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel));});
for(const method of ['lstat','realpath','readFile','open','readdir']){original[method]=fs[method];fs[method]=async(...args)=>{if(performance.now()>=deadline)throw Error('Fourteen-second profile deadline');assert.ok(inside(args[0]),'Profile escaped its three fixed absent roots');if(current){current[method]=(current[method]??0)+1;counts[method]=(counts[method]??0)+1;}return original[method](...args);};}
const results=[];try{for(const r of rows){current={};const before=performance.now(),value=await retirementSourceDifference(r.snapshot,inventory,{maxFiles:64,maxBytes:16*1024*1024});assert.equal(value,null);const scan={ms:performance.now()-before,calls:current};current={};const beforeGuard=performance.now();assert.equal(await retirementEntity(r.snapshot),null);const absent={ms:performance.now()-beforeGuard,calls:current};results.push({releaseId:r.releaseId,scan,rootAbsenceProbe:absent});}assert.ok(performance.now()<deadline);}finally{current=null;for(const[method,fn]of Object.entries(original))fs[method]=fn;}
console.log(JSON.stringify({version:'s05d-history-missing-root-profile-v1',readOnly:true,historyQualified:false,retirementProved:false,actualToolSHAReads:0,payloadReads:0,sourceQuery:'git ls-files names only; native exclusion prefixes',sourceNames:names.length,sourceNamesSha256:sha(Buffer.from(JSON.stringify(names))),profileInventoryValues:'inert zero hashes; never dereferenced for absent roots',configuredMaxFiles:64,results,totalCalls:counts,elapsedMs:performance.now()-start},null,2));
