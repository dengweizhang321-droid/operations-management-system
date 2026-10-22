/** Fixed-leaf static reading only. Does not import or execute dependency code. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const taskRoot=path.dirname(fileURLToPath(import.meta.url)),repo=path.resolve(taskRoot,'../..');
const stage='D:/teruisi-runtime/teruisi-worker-sales/.staging/deploy-fca7de7a-978e-42f6-a752-b168d69903ea/build';
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const lockRaw=await fs.readFile(path.join(repo,'package-lock.json')),lock=JSON.parse(lockRaw),files=[];let bytes=0,attempts=0;
async function leaf(root,relative,kind){
 assert.ok(++attempts<=24,'Fixed leaf count exceeded');const file=path.resolve(root,relative);assert.ok(file.startsWith(path.resolve(root)+path.sep));
 try{
  const stat=await fs.lstat(file);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=128*1024,'Unsafe or oversized source leaf');
  assert.equal((await fs.realpath(file)).toLowerCase(),file.toLowerCase(),'Redirected source leaf');
  const raw=await fs.readFile(file);assert.ok(raw.length<=128*1024);bytes+=raw.length;assert.ok(bytes<=256*1024,'Aggregate source byte bound exceeded');
  const row={path:file,kind,present:true,bytes:raw.length,sha256:sha(raw)};files.push(row);return {row,text:raw.toString('utf8')};
 }catch(error){if(error.code!=='ENOENT')throw error;files.push({path:file,kind,present:false});return null;}
}
const packages=[];
for(const[relative,locked]of Object.entries(lock.packages).filter(([p,v])=>p&&v.hasInstallScript)){
 const read=await leaf(stage,relative+'/package.json','locked-package-manifest');
 if(read){const value=JSON.parse(read.text);assert.equal(value.version,locked.version);packages.push({path:relative,version:value.version,manifestSha256:read.row.sha256,lifecycle:Object.fromEntries(Object.entries(value.scripts??{}).filter(([name])=>/^(?:preinstall|install|postinstall|prepare)$/.test(name)))});}
 else packages.push({path:relative,version:locked.version,present:false,lockOs:locked.os??null});
}
const dependencySources=[
 'node_modules/@esbuild-kit/core-utils/node_modules/esbuild/install.js','node_modules/drizzle-kit/node_modules/esbuild/install.js','node_modules/esbuild/install.js','node_modules/workerd/install.js','node_modules/wrangler/node_modules/esbuild/install.js',
 'node_modules/sharp/install/check.js','node_modules/sharp/install/build.js','node_modules/sharp/lib/libvips.js',
 'node_modules/napi-postinstall/package.json','node_modules/napi-postinstall/lib/cli.js','node_modules/napi-postinstall/lib/index.js','node_modules/napi-postinstall/lib/helpers.js','node_modules/napi-postinstall/lib/constants.js'
];
for(const relative of dependencySources){const read=await leaf(stage,relative,'direct-lifecycle-or-bounded-helper');if(read){if(relative.endsWith('package.json')){const value=JSON.parse(read.text);read.row.package={name:value.name,version:value.version,bin:value.bin};}else read.row.selectedLines=read.text.split('\n').flatMap((text,i)=>/https?\b|get\(url|execSync|execFile|spawnSync|writeFile|mkdirSync|downloadDirectly|node-gyp|require\(.+target|createWriteStream/i.test(text)?[{line:i+1,text:text.trim()}]:[]);}}
for(const relative of ['tools/install-workerd-heap-patch.mjs','tools/install-wrangler-inspector-patch.mjs','package.json']){const read=await leaf(repo,relative,'project-lifecycle');if(read&&relative==='package.json'){const value=JSON.parse(read.text);read.row.lifecycle=Object.fromEntries(Object.entries(value.scripts??{}).filter(([name])=>/^(?:preinstall|install|postinstall|prepare)$/.test(name)));}}
const result={version:'s05d-bounded-lifecycle-source-inspection-v1',stage,lockSha256:sha(lockRaw),budget:{maxLeafAttempts:24,maxLeafBytes:128*1024,maxTotalBytes:256*1024},actual:{attempts,present:files.filter(f=>f.present).length,bytes},packages,files,
 classifications:[
  {group:'Four esbuild install.js and workerd install.js',observed:'Local install directories/binary writes and binary version checks; npm-install fallback; direct HTTPS GET tarball fallback. No explicit remote mutating request, daemon or scheduler registration in these entry files.'},
  {group:'unrs-resolver -> napi-postinstall',observed:'CLI dispatches checkAndPreparePackage. Bounded index/helper files use npm config lookup, local install/write and HTTP(S) GET download fallback. Platform target table and downstream npm internals were not followed.'},
  {group:'sharp',observed:'Install check can request source build; bounded build/libvips files use local pkg-config/node-gyp subprocesses. Node-gyp implementation and compiler transitive actions were not followed.'},
  {group:'fsevents',observed:'Not installed at the named stage; lockfile OS is darwin. Missing on Windows is a platform-selection fact, not a proof of the historical lifecycle trace.'},
  {group:'Project postinstall',observed:'Named heap/inspector patch source reads and rewrites known dependency entry bytes locally.'}
 ],
 limits:['Read-only fixed leaves; no dependency script, npm, network request, build, daemon or task operation executed.','Current stage bytes/name-version agreement are not a historical execution or unique dispatch ownership proof.','No infinite import closure claim: node-gyp, napi platform table, npm internals, native binaries and compile-plugin internals remain separately bounded work if necessary.','No observed remote write is not equivalent to a complete remote zero-effect proof.']};
await fs.writeFile(path.join(taskRoot,'lifecycle-sources.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({version:result.version,...result.actual,lockedInstallPackages:packages.length,missing:files.filter(f=>!f.present).map(f=>f.path),remoteWritesObservedInReadEntries:false,historicalExecutionProved:false}));
