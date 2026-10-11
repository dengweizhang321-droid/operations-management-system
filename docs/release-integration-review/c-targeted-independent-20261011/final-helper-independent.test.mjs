import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {readFileSync,lstatSync,realpathSync,watch as realWatch} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
const frozen='D:/codex-isolated/release-first-adoption-targeted-20261011/adoption-source-v3/tools';
const raw=readFileSync(path.join(frozen,'release-preparation-evidence.mjs'),'utf8');
const impact=readFileSync(path.join(frozen,'release-impact.mjs'),'utf8');
const worker=readFileSync(path.join(frozen,'worker-local-release.mjs'),'utf8');
const canonical=v=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:v&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`:JSON.stringify(v);
const hash=v=>createHash('sha256').update(typeof v==='string'||Buffer.isBuffer(v)?v:canonical(v)).digest('hex');
assert.equal(hash(raw),'b7355e8f36efe8be54dc1980334f87f109372b1bd743639160064d4034235bf6');
const body=raw.slice(raw.indexOf('const lifetimeMs')).replace(/^export /gm,'');
const safe=impact.slice(impact.indexOf('export async function safeRead('),impact.indexOf('\nexport async function safeFileDigest(')).replace(/^export /,'');
const win=worker.slice(worker.indexOf('export function canonicalWindowsPath('),worker.indexOf('\nfunction isWithinWindowsPath(')).replace(/^export /gm,'');
async function fixture(action,options={}){
 const root=path.resolve(await fs.mkdtemp(path.join(tmpdir(),'teruisi-final-helper-'))),handles=[];
 try{
  const config=path.join(root,'.dev.vars'),source=path.join(root,'source'),bin=path.join(root,'bin'),npm=path.join(bin,'node_modules/npm');
  await fs.writeFile(config,'public synthetic configuration');await fs.link(config,path.join(root,'config-link'));await fs.mkdir(source);await fs.mkdir(path.join(npm,'bin'),{recursive:true});
  await fs.writeFile(path.join(source,'fixture.mjs'),'public source');await fs.writeFile(path.join(bin,'node.exe'),'public node bytes');await fs.writeFile(path.join(npm,'package.json'),'{}');await fs.writeFile(path.join(npm,'bin/npm-cli.js'),'public npm cli');
  const user=path.join(root,'user.npmrc'),global=path.join(root,'global.npmrc');await fs.writeFile(user,'public user');await fs.writeFile(global,'public global');
  let reads=0,registrationsBeforeBaseline=0,environment='public environment',realConfigEvents=0;
  const registrations=[];
  const ctx={path,Buffer,Number,Map,Error,performance,structuredClone,setImmediate,hash,canonical,sha256Bytes:hash,fail:m=>{throw Error(m);},requireHash:v=>assert.match(v,/^[a-f0-9]{64}$/),
   workerDevVarsSource:config,lstat:fs.lstat,lstatSync,realpathSync,readFileSync:p=>{assert.ok(path.resolve(p).startsWith(root+path.sep));reads++;return readFileSync(p);},
   process:{execPath:path.join(bin,'node.exe'),version:'v24.private',env:{}},
   runProcess:()=>{throw Error('Product/native execution forbidden');},workerPreparationIdentity:()=>{throw Error('Product identity forbidden');},
   preparationEnvironmentSha256:()=>hash(environment),
   watch:(directory,o,callback)=>{
    if(reads===0)registrationsBeforeBaseline++;
    registrations.push({directory,options:o,callback});
    const handle=options.nativeWatch?realWatch(directory,o,(event,name)=>{if(event==='change'&&name?.toString()==='.dev.vars')realConfigEvents++;callback(event,name);}):{on(){return this;},close(){}};
    handles.push(handle);return handle;
   }};
  Object.assign(ctx,vm.runInNewContext(win+';({windowsPathSha256})',ctx));
  ctx.safeRead=vm.runInNewContext(safe+';safeRead',{...ctx,readFile:fs.readFile,realpath:fs.realpath});
  ctx.safeFileDigest=async p=>hash(await ctx.safeRead(p));ctx.readSourceTree=async()=>({'fixture.mjs':await fs.readFile(path.join(source,'fixture.mjs'),'utf8')});ctx.sourceTreeDigest=hash;ctx.sourceInventory=v=>Object.fromEntries(Object.entries(v).map(([k,x])=>[k,hash(x)]));
  ctx.hashTree=async()=>({fileCount:2,sha256:hash([hash(await ctx.safeRead(path.join(npm,'package.json'))),hash(await ctx.safeRead(path.join(npm,'bin/npm-cli.js')))])});
  const api=vm.runInNewContext(body+';({createPreparationEvidenceSession,readSessionRuntimeConfiguration})',ctx);
  const identify=async()=>{const tree=await ctx.readSourceTree();return{sourceTree:{sha256:hash(tree)},sourceInventorySha256:hash(ctx.sourceInventory(tree)),nodeExecutableSha256:hash(await ctx.safeRead(ctx.process.execPath)),runtimeConfigurationSha256:hash('public synthetic configuration'),environmentSha256:ctx.preparationEnvironmentSha256(),toolchain:{npmPackageTree:await ctx.hashTree()},externalNpmConfiguration:{userconfig:{pathSha256:ctx.windowsPathSha256(user),contentSha256:hash('public user')},globalconfig:{pathSha256:ctx.windowsPathSha256(global),contentSha256:hash('public global')}}};};
  const batchSha256=hash('private batch'),session=api.createPreparationEvidenceSession({batchSha256,sourceRoot:source,identify,execute:async(_e,args)=>({stdout:(args.at(-1)==='userconfig'?user:global)+'\n'})});
  const emit=(target,event='change',name=path.basename(target))=>{const r=registrations.find(x=>x.directory===path.dirname(target)&&!x.options.recursive);assert.ok(r);r.callback(event,name);};
  const subject={root,config,source,bin,npm,user,global,session,batchSha256,api,emit,registrations,reads:()=>reads,baselineBeforeWatch:()=>registrationsBeforeBaseline===0,realEvents:()=>realConfigEvents,setEnvironment:v=>{environment=v;}};
  try{await action(subject);}finally{session.dispose();}
 }finally{
  for(const h of handles)h.close();assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('teruisi-final-helper-'));assert.ok(!lstatSync(root).isSymbolicLink());await fs.rm(root,{recursive:true});
 }
}
test('fixed baseline precedes watcher installation; matching access-only notification is re-read, not ignored',()=>fixture(async f=>{
 await f.session.collect({approvedBatchSha256:f.batchSha256,full:true});assert.equal(f.baselineBeforeWatch(),true);
 const before=f.reads();f.emit(f.config);f.session.assertStable();assert.ok(f.reads()>before);
 await f.session.collect({approvedBatchSha256:f.batchSha256});await f.session.recheck();
}));
test('notification after runtime hash and after collection remains pending until complete synchronous validation',()=>fixture(async f=>{
 let injected=false;
 await f.session.collect({approvedBatchSha256:f.batchSha256,full:true,measure:async(stage,_kind,action)=>{const v=await action();if(stage==='source-content-final'&&!injected){injected=true;f.emit(f.config);}return v;}});assert.equal(injected,true);assert.ok(f.reads()>=3);
 const count=f.reads();f.emit(f.config);f.session.assertStable();assert.ok(f.reads()>count);
 await fs.writeFile(f.config,'changed public configuration');f.emit(f.config);assert.throws(()=>f.session.assertStable(),/differs from session baseline/);assert.throws(()=>f.session.assertStable(),/Inputs changed/);
}));
test('same-content new inode with unchanged link count is not accepted as access metadata',()=>fixture(async f=>{
 await f.session.collect({approvedBatchSha256:f.batchSha256,full:true});const before=lstatSync(f.config,{bigint:true}),replacement=path.join(f.root,'replacement');await fs.writeFile(replacement,'public synthetic configuration');await fs.link(replacement,path.join(f.root,'replacement-link'));await fs.rename(f.config,path.join(f.root,'old-held'));await fs.rename(replacement,f.config);const after=lstatSync(f.config,{bigint:true});assert.notEqual(after.ino,before.ino);assert.equal(after.nlink,before.nlink);f.emit(f.config);assert.throws(()=>f.session.assertStable(),/differs from session baseline/);
}));
test('source/npm/unknown and fixed rename notifications remain irreversible invalidation',async()=>{
 for(const type of ['source','npm','unknown','rename'])await fixture(async f=>{
  await f.session.collect({approvedBatchSha256:f.batchSha256,full:true});
  if(type==='source')f.registrations.find(r=>r.directory===f.source).callback('change','fixture.mjs');
  else if(type==='npm')f.registrations.find(r=>r.directory===f.npm).callback('change','package.json');
  else f.emit(f.config,type==='rename'?'rename':'change',type==='unknown'?null:'.dev.vars');
  assert.throws(()=>f.session.assertStable(),/Inputs changed/);await assert.rejects(f.session.recheck(),/Inputs changed/);
 });
});
test('genuine private Windows file change notification cannot bless unchanged bytes with changed identity timestamps',()=>fixture(async f=>{
 await f.session.collect({approvedBatchSha256:f.batchSha256,full:true});await fs.writeFile(f.config,'public synthetic configuration');
 const end=Date.now()+2000;while(f.realEvents()===0&&Date.now()<end)await new Promise(r=>setTimeout(r,10));assert.ok(f.realEvents()>0,'private OS configuration change event required');
 assert.throws(()=>f.session.assertStable(),/differs from session baseline|Inputs changed/);
},{nativeWatch:true}));
test('same-inode alternative path and external npmrc links retain strict single-link read rules',()=>fixture(async f=>{
 await assert.rejects(f.api.readSessionRuntimeConfiguration(path.join(f.root,'config-link')),/Unsafe evidence\/source file/);
 await f.session.collect({approvedBatchSha256:f.batchSha256,full:true});await fs.link(f.user,path.join(f.root,'user-link'));await assert.rejects(f.session.recheck(),/Unsafe evidence\/source file/);
}));
test('without watch events Node/source/npm/environment drift still invalidates reused complete input snapshots',async()=>{
 for(const type of ['node','source','npm','environment'])await fixture(async f=>{
  await f.session.collect({approvedBatchSha256:f.batchSha256,full:true});
  if(type==='environment')f.setEnvironment('changed public environment');
  else await fs.writeFile(type==='node'?path.join(f.bin,'node.exe'):type==='source'?path.join(f.source,'fixture.mjs'):path.join(f.npm,'package.json'),'changed public bytes');
  await assert.rejects(f.session.collect({approvedBatchSha256:f.batchSha256}),/Reused evidence invalidated/);
 });
});
