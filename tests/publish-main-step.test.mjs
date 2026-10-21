import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {runProcess} from '../tools/worker-local-release.mjs';
import {createMainPublicationStep} from '../tools/publish-main-step.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
test('opt-in capture preserves arbitrary bytes and actual nonzero direct exit',async()=>{
 let observed;
 try{await runProcess(process.execPath,['-e','process.stdout.write(Buffer.from([255,0,13,10]));process.stderr.write(Buffer.from([206,210]));process.exit(7)'],{captureOutputBuffers:true,outputProtocol:'direct-exit-files',cleanup:'preserve',timeoutMs:10000});}catch(error){observed=error;}
 assert.ok(observed);assert.equal(observed.processEvidence.exitCode,7);assert.deepEqual(observed.rawOutput.stdout,Buffer.from([255,0,13,10]));assert.deepEqual(observed.rawOutput.stderr,Buffer.from([206,210]));assert.equal(observed.processEvidence.stdoutSha256,sha(observed.rawOutput.stdout));assert.ok(!JSON.stringify(observed).includes('rawOutput'));
});
test('successful direct process reports exit0 and raw buffers; default callers keep old shape',async()=>{
 const value=await runProcess(process.execPath,['-e','process.stdout.write("{}")'],{captureOutputBuffers:true,outputProtocol:'direct-exit-files',cleanup:'preserve',timeoutMs:10000});assert.equal(value.processEvidence.exitCode,0);assert.deepEqual(value.rawOutput.stdout,Buffer.from('{}'));
 const normal=await runProcess(process.execPath,['-e','process.stdout.write("ok")'],{timeoutMs:10000});assert.equal(normal.stdout,'ok');assert.equal(Object.hasOwn(normal,'rawOutput'),false);
});
test('valid JSON with non-UTF8 diagnostic bytes still completes with real exit0',async t=>{
 const out=await fs.mkdtemp(path.join(os.tmpdir(),'publication-diagnostic-'));t.after(()=>fs.rm(out,{recursive:true,force:true}));
 const step=createMainPublicationStep({out,request:{pwshDirectory:out},api:{runProcess:async(_h,_a,options)=>runProcess(process.execPath,['-e','process.stdout.write("{\\\"ok\\\":true}");process.stderr.write(Buffer.from([206,210]))'],{...options,cwd:out,timeoutMs:10000})},transport:{productionCommandArguments:(_h,args)=>args,productionCommandEnvironment:()=>process.env},progress:{begin(){},complete(){}}});
 assert.deepEqual(await step('private',path.join(out,'private.ps1'),'Private'),{ok:true});assert.deepEqual(await fs.readFile(path.join(out,'private.stderr.log')),Buffer.from([206,210]));assert.equal((JSON.parse(await fs.readFile(path.join(out,'private-process.json'),'utf8'))).processEvidence.exitCode,0);
});
for(const kind of ['nonzero','invalid-utf8','invalid-json'])test('step saves original output and exit before '+kind+' failure',async t=>{
 const out=await fs.mkdtemp(path.join(os.tmpdir(),'publication-bytes-'));t.after(()=>fs.rm(out,{recursive:true,force:true}));
 const code=kind==='nonzero'?'process.stdout.write("{\\\"complete\\\":true}");process.stderr.write(Buffer.from([206,210]));process.exit(3)':kind==='invalid-utf8'?'process.stdout.write(Buffer.from([255,254]))':'process.stdout.write("not json")';
 const api={runProcess:async(_command,_args,options)=>runProcess(process.execPath,['-e',code],{...options,cwd:out,timeoutMs:10000})};
 const step=createMainPublicationStep({out,request:{pwshDirectory:out},api,transport:{productionCommandArguments:(_h,args)=>args,productionCommandEnvironment:()=>process.env},progress:{begin(){},complete(){}}});
 await assert.rejects(step('private-step',path.join(out,'private.ps1'),'PrivateOnly'));
 const evidence=JSON.parse(await fs.readFile(path.join(out,'private-step-process.json'),'utf8'));assert.equal(evidence.originalBytesRetained,true);assert.equal(evidence.processEvidence.exitCode,kind==='nonzero'?3:0);
 const stdout=await fs.readFile(path.join(out,'private-step.stdout.log'));assert.equal(evidence.processEvidence.stdoutSha256,sha(stdout));
 if(kind==='nonzero')assert.deepEqual(await fs.readFile(path.join(out,'private-step.stderr.log')),Buffer.from([206,210]));
 if(kind==='invalid-utf8')assert.deepEqual(stdout,Buffer.from([255,254]));
 await assert.rejects(fs.access(path.join(out,'private-step-result.json')));
});
