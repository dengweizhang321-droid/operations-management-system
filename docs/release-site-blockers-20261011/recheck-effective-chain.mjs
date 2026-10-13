import {readFile,lstat,realpath,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const hash=v=>createHash('sha256').update(v).digest('hex'),root='D:/teruisi-runtime/django-sales/app/tools';
const raw=await readFile('E:/codex-artifacts/release-first-adoption-targeted-20261011/ADOPTION_BATCH_FRESH_V1.json');assert.equal(hash(raw),'eec240464811a6e954f489d8504aa6b77880f99187340b5899509a2093a5d639');
const spec=JSON.parse(raw),inventory=spec.batch.tests.scopeValidation.before.inventory??spec.batch.tests.scopeValidation.beforeInventory;
assert.ok(inventory);
const pins=[];
for(const name of ['worker-local-release-rotation.mjs','worker-local-release.mjs','d1-retirement-proof.mjs']){const file=path.resolve(root,name);let cursor=path.parse(file).root;for(const part of file.slice(cursor.length).split(path.sep).filter(Boolean)){cursor=path.join(cursor,part);assert.equal((await lstat(cursor)).isSymbolicLink(),false);}assert.equal((await realpath(file)).toLowerCase(),file.toLowerCase());const a=await lstat(file,{bigint:true});assert.ok(a.isFile()&&a.nlink===1n);const bytes=await readFile(file);assert.equal(hash(bytes),inventory['tools/'+name]);const b=await lstat(file,{bigint:true});for(const k of ['dev','ino','nlink','size','mtimeNs','ctimeNs'])assert.equal(a[k],b[k]);pins.push({name,sha256:hash(bytes)});}
const {resolveEffectiveReleaseChain}=await import(pathToFileURL(root+'/worker-local-release-rotation.mjs'));
const chain=await resolveEffectiveReleaseChain({verifyInstalledHead:true});assert.equal(chain.head.manifestSha256,spec.batch.impactProof.predecessor?.artifactSha256??'f4e537eb20dfa60127cf588db0ed911223c0b59c44fc8b839e5df196428e7113');
assert.equal(chain.head.releaseId,'20261010T014638Z-97833d2f2b7e7bc9');assert.equal(chain.chainStateSha256,'aaf62994c75c3ca46362328fed6acc76f812808a2e852566782e5e0ba897e0d9');
const record={version:'teruisi-site-original-effective-chain-recheck-v1',at:new Date().toISOString(),head:chain.head,chainStateSha256:chain.chainStateSha256,records:chain.records.length,headGuard:chain.headGuard,pins,sourceTree:chain.headManifest.source.tree,productionActions:0,scope:'Original installed metadata/guard/chain resolver; not whole payload, new restore or installed successor acceptance.'};
await writeFile('E:/codex-artifacts/release-site-blockers-20261011/EFFECTIVE_CHAIN_FIRST.json',JSON.stringify(record,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:'passed',head:chain.head.releaseId,records:chain.records.length,source:chain.headManifest.source.tree.sha256,productionActions:0}));
