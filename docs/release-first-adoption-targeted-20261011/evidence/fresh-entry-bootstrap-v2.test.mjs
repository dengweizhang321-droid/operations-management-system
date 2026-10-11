import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFileSync,createReadStream as nativeStream} from 'node:fs';
import {readFile,writeFile,mkdir,mkdtemp,lstat,readdir,realpath,link,symlink} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const evidence='E:/codex-artifacts/release-first-adoption-targeted-20261011',entry=path.join(evidence,'fresh-adoption-entry-v2.mjs'),source=readFileSync(entry,'utf8');
const canonical=v=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:v&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`:JSON.stringify(v);
const hash=v=>createHash('sha256').update(typeof v==='string'||Buffer.isBuffer(v)?v:canonical(v)).digest('hex');
const moduleNames=new Function(source.match(/^const moduleNames=.*;$/m)[0]+'return moduleNames;')();
const body=source.slice(source.indexOf('async function physical('),source.indexOf('export async function executeFreshAdoption(')).replaceAll('await import(','await loadModule(');
const worker=await import('file:///D:/teruisi-runtime/teruisi-worker-sales/releases/20261011T090355Z-21c2645a63247749/tools/worker-local-release.mjs');
async function fixture(options={}) {
 const root=await mkdtemp(path.join(evidence,'bootstrap-private-')),candidate=path.join(root,'candidate'),tools=path.join(candidate,'tools'),modules=path.join(candidate,'node_modules');await mkdir(tools,{recursive:true});await mkdir(path.join(modules,'typescript/lib'),{recursive:true});
 const benign='export const fixture=true;\n',keys=[];for(const name of moduleNames){await writeFile(path.join(tools,name),benign);keys.push({relativePath:'tools/'+name,sha256:hash(benign)});}
 const pkg=JSON.stringify({name:'private',type:'module'});await writeFile(path.join(candidate,'package.json'),pkg);keys.push({relativePath:'package.json',sha256:hash(pkg)});
 const tsPackage=JSON.stringify({main:'./lib/typescript.js'}),tsCode='module.exports={};';await writeFile(path.join(modules,'typescript/package.json'),tsPackage);await writeFile(path.join(modules,'typescript/lib/typescript.js'),tsCode);
 const manifest={artifacts:{keyFiles:keys},build:{nodeModulesTree:await worker.hashTree(modules)}},manifestRaw=JSON.stringify(manifest),expectedManifest=hash(manifestRaw),expectedPlan='1'.repeat(64);await writeFile(path.join(candidate,'deployment-manifest.json'),manifestRaw);
 const node=path.join(root,'private-node.exe');await writeFile(node,'private executable bytes, never executed');const self=entry,testsPath=path.join(root,'tests.json'),specPath=path.join(root,'spec.json'),workerRuntimeRoot=path.join(root,'runtime');
 const tests={evidence:[{kind:'first-adoption-execution',mode:'fresh-no-reuse-v1',path:self,sha256:hash(source)}]},testRaw=JSON.stringify(tests);await writeFile(testsPath,testRaw);
 const names=[...moduleNames.map(n=>path.join(tools,n)),path.join(modules,'typescript/lib/typescript.js'),path.join(modules,'typescript/package.json'),node,testsPath];
 const collector={transport:'in-process-content-evidence-v1',executable:node,args:[path.join(tools,'release-batch-admission.mjs'),'collect',specPath,testsPath],files:await Promise.all(names.map(async p=>({path:p,sha256:hash(await readFile(p))})))};
 const batch={version:'teruisi-release-batch-v4',binding:{artifactSha256:expectedManifest,workerPlanSha256:expectedPlan,testsSha256:hash(tests)},tests,collectorSha256:hash(collector)};batch.batchSha256=hash(batch);const spec={batch,collector,journalRoot:path.join(workerRuntimeRoot,'state','release-batches')};await writeFile(specPath,JSON.stringify(spec));
 const imports=[],context={assert,path,createHash,lstat,readdir,realpath,createReadStream:options.stream??nativeStream,Buffer,hash,canonical,digestPattern:/^[a-f0-9]{64}$/,moduleNames,candidate,expectedManifest,expectedPlan,self,mode:'fresh-no-reuse-v1',workerRuntimeRoot,process:{execPath:node,cwd:()=>process.cwd()},pathToFileURL,
  loadModule:async url=>{imports.push(url);return import(url);}};
 const functions=new Function(...Object.keys(context),body+';return {bootstrapFreshEntry,completeTree,checkedFile,relativePath};')(...Object.values(context));
 return{root,candidate,tools,modules,specPath,testsPath,imports,spec,...functions,run:()=>functions.bootstrapFreshEntry(specPath,batch.batchSha256)};
}
test('builtins bootstrap checks full small dependency tree before real private module import',async()=>{const f=await fixture();assert.deepEqual(await f.completeTree(f.modules),await worker.hashTree(f.modules));await f.run();assert.equal(f.imports.length,3);});
for(const mutation of ['module','manifest','extra-dependency','dependency-bytes','tests','unknown-member'])test('bootstrap rejects '+mutation+' before any candidate code executes',async()=>{
 const f=await fixture();if(mutation==='module')await writeFile(path.join(f.tools,'release-batch.mjs'),'throw Error("untrusted module executed");');
 if(mutation==='manifest')await writeFile(path.join(f.candidate,'deployment-manifest.json'),'{}');
 if(mutation==='extra-dependency')await writeFile(path.join(f.modules,'unexpected.js'),'unapproved');
 if(mutation==='dependency-bytes')await writeFile(path.join(f.modules,'typescript/lib/typescript.js'),'module.exports={altered:true};');
 if(mutation==='tests')await writeFile(f.testsPath,'{}');
 if(mutation==='unknown-member'){f.spec.collector.files.push({path:path.join(f.root,'extra'),sha256:'0'.repeat(64)});f.spec.batch.collectorSha256=hash(f.spec.collector);const b={...f.spec.batch};delete b.batchSha256;f.spec.batch.batchSha256=hash(b);await writeFile(f.specPath,JSON.stringify(f.spec));}
 await assert.rejects(f.run());assert.equal(f.imports.length,0);
});
test('early tree member changing after its read is rejected by final physical-identity enumeration',async()=>{
 let changed=false;const stream=target=>(async function*(){for await(const chunk of nativeStream(target))yield chunk;if(target.endsWith('z.txt')&&!changed){changed=true;await writeFile(path.join(path.dirname(target),'a.txt'),'changed after read');}})();
 const f=await fixture({stream}),tree=path.join(f.root,'tiny-tree');await mkdir(tree);await writeFile(path.join(tree,'a.txt'),'before');await writeFile(path.join(tree,'z.txt'),'last');await assert.rejects(f.completeTree(tree),/physical identity/);
});
test('hardlinked code and redirected ancestor are rejected without loading code',async()=>{
 const f=await fixture();await link(path.join(f.tools,'release-batch.mjs'),path.join(f.root,'alias'));await assert.rejects(f.run());assert.equal(f.imports.length,0);
 const real=path.join(f.root,'real');await mkdir(real);await writeFile(path.join(real,'file'),'value');const redirect=path.join(f.root,'redirect');await symlink(real,redirect,'junction');await assert.rejects(f.checkedFile(path.join(redirect,'file')));
});
test('path validation accepts normal JS paths but rejects escapes and alternate streams',async()=>{const f=await fixture();assert.equal(f.relativePath('typescript/lib/typescript.js'),'typescript/lib/typescript.js');for(const s of ['../escape','a\\b','a:b','/absolute','a\u0000b'])assert.throws(()=>f.relativePath(s));});
