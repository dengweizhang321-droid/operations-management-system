/** Paired full candidate-source reads, with synthetic npm/config inputs only. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {parseArgs} from 'node:util';
import assert from 'node:assert/strict';
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export async function benchmarkBoundSource({sourceRoot=root,base='7ca85e40c2857ede3a55c4fffda1b3945aeb4f1f',out}={}){
 assert.ok(out&&path.isAbsolute(out));await fs.mkdir(out,{recursive:false});
 const config=path.join(out,'synthetic.vars');await fs.writeFile(config,'SYNTHETIC_ONLY=1');
 const current=await fs.readFile(path.join(root,'tools/worker-local-release.mjs'),'utf8');
 const before=execFileSync('git',['-C',root,'show',base+':tools/worker-local-release.mjs'],{encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024});
 const provenance={nodeVersion:process.version,nodeExecutablePathSha256:sha('node'),npmVersion:'fixture',npmPackageRootRelativePath:'npm',npmPackageRootPathSha256:sha('root'),npmCliRelativePath:'npm/cli',npmCliPathSha256:sha('cli'),npmCliSha256:sha('cli-bytes'),npmPackageJsonRelativePath:'npm/package.json',npmPackageJsonPathSha256:sha('package'),npmPackageJsonSha256:sha('package-bytes'),npmPackageTree:{algorithm:'sha256-ordinal-path-length-content-v1',fileCount:1,sha256:sha('tree')},npmCiArguments:[]};
 const contexts=[];
 for(const [variant,original] of [['baseline',before],['candidate',current]]){
  const key='boundBenchmark'+randomUUID().replaceAll('-',''),counts={opens:0,wholeReads:0,readBytes:0,sourceReads:0};
  const sourcePath=target=>path.relative(sourceRoot,target)&&!path.relative(sourceRoot,target).startsWith('..')&&!path.isAbsolute(path.relative(sourceRoot,target));
  const state={config,open:async(target,...args)=>{
   const handle=await fs.open(target,...args);if(sourcePath(target)){counts.opens++;counts.sourceReads++;}
   return {stat:()=>handle.stat(),close:()=>handle.close(),read:async(...args)=>{const result=await handle.read(...args);if(sourcePath(target))counts.readBytes+=result.bytesRead;return result;}};
  },readFile:async(target,...args)=>{const value=await fs.readFile(target,...args);if(sourcePath(target)){counts.wholeReads++;counts.sourceReads++;counts.readBytes+=Buffer.byteLength(value);}return value;}};
  globalThis[key]=state;
  let code=original.replace(/\n  open,\r?\n/,'\n  open as nativeOpen,\n').replace(/\n  readFile,\r?\n/,'\n  readFile as nativeReadFile,\n');
  code+='\nconst {open,readFile}=globalThis['+JSON.stringify(key)+'];\n';
  code=code.replace('const toolchain = await resolveBundledNpmToolchain();','const toolchain = {nodeExecutablePath:process.execPath,npmCliPath:"private-fixture",provenance:'+JSON.stringify(provenance)+'};');
  code=code.replace('const result = await runProcess(toolchain.nodeExecutablePath, [toolchain.npmCliPath, "config", "get", key], { cwd: sourceRoot, label: "npm configuration identity" });','const result = {stdout:path.join(sourceRoot,"missing-private-npm-"+key)};');
  code=code.replace('const identity=await workerPreparationIdentity(value.sourceRoot);','const identity=await workerPreparationIdentity(value.sourceRoot,globalThis['+JSON.stringify(key)+'].config);');
  const file=path.join(out,variant+'.mjs');await fs.writeFile(file,code);contexts.push({variant,key,counts,api:await import(pathToFileURL(file)),sourceSha256:sha(original),instrumentedSha256:sha(code)});
 }
 try{
  const api=contexts[1].api,identity=await api.workerPreparationIdentity(sourceRoot,config);
  const predecessor={version:'teruisi-local-worker-release-binding-v1',releaseId:'20261010T014638Z-97833d2f2b7e7bc9',manifestSha256:sha('manifest'),guardReceiptSha256:sha('guard')};predecessor.bindingSha256=api.sha256Canonical(predecessor);
  const value={version:api.workerSourceBindingVersion,sourceRoot,sourceRootPathSha256:api.windowsPathSha256(sourceRoot),predecessor,predecessorChainStateSha256:sha('chain'),identity};
  const raw=api.canonicalJson(value)+'\n',binding={raw,sha256:sha(raw)},samples=[];
  for(let pair=0;pair<3;pair++)for(const item of contexts){
   Object.assign(item.counts,{opens:0,wholeReads:0,readBytes:0,sourceReads:0});
   const started=performance.now(),cpu=process.cpuUsage(),result=await item.api.verifyBoundWorkerSource(binding);
   assert.deepEqual(result.identity,identity,'Old/new complete identity differs');
   samples.push({pair,variant:item.variant,elapsedMs:performance.now()-started,cpuMicroseconds:process.cpuUsage(cpu),...item.counts});
   await fs.writeFile(path.join(out,'MEASUREMENTS.json'),JSON.stringify({scope:'Full same candidate source, synthetic npm/config only; fixed baseline-then-candidate order, desktop warm-cache samples; no native publication or P95 claim',sourceTree:identity.sourceTree,sourceInventorySha256:identity.sourceInventorySha256,modules:contexts.map(({variant,sourceSha256,instrumentedSha256})=>({variant,sourceSha256,instrumentedSha256})),samples},null,2));
  }
  return {status:'passed',report:path.join(out,'MEASUREMENTS.json')};
 }finally{for(const item of contexts)delete globalThis[item.key];}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const {values}=parseArgs({options:{out:{type:'string'},base:{type:'string'},source:{type:'string'}}});
 benchmarkBoundSource({out:values.out,base:values.base,sourceRoot:values.source}).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error);process.exitCode=1;});
}
