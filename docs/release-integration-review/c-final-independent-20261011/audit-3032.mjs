// Independent static byte audit. No runtime imports, services, database, locks,
// lifecycle, production CLI, or configuration plaintext is read/exported.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const hash=x=>createHash('sha256').update(x).digest('hex');
const canonical=v=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:v&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`:JSON.stringify(v);
const startedAt=new Date().toISOString(),runtime='D:/teruisi-runtime/teruisi-worker-sales';
const releaseId='20261011T051645Z-3032ae332a32f1a0',root=path.join(runtime,'releases',releaseId);
const evidence='E:/codex-artifacts/release-no-data-adoption-20261011';
const stableFiles=new Map();
function fingerprint(s){return [s.dev,s.ino,s.nlink,s.size,s.mtimeNs,s.ctimeNs].join(':');}
function read(file){const before=fs.lstatSync(file,{bigint:true});if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1n)throw Error('Unsafe non-secret audit file: '+file);const raw=fs.readFileSync(file);if(fingerprint(before)!==fingerprint(fs.lstatSync(file,{bigint:true})))throw Error('File changed while read: '+file);stableFiles.set(file,fingerprint(before));return raw;}
const json=file=>{const raw=read(file);return {raw,sha256:hash(raw),value:JSON.parse(raw)};};
function tree(base,excluded=[]){const names=[];function walk(dir){for(const name of fs.readdirSync(dir)){const file=path.join(dir,name),relative=path.relative(base,file).split(path.sep).join('/');if(excluded.includes(relative))continue;const s=fs.lstatSync(file);if(s.isSymbolicLink())throw Error('Redirected payload: '+relative);if(s.isDirectory())walk(file);else if(s.isFile())names.push(relative);else throw Error('Special payload object: '+relative);}}walk(base);names.sort();const digest=createHash('sha256'),inventory={};for(const name of names){const raw=read(path.join(base,name)),label=Buffer.from(name),a=Buffer.alloc(4),b=Buffer.alloc(8);a.writeUInt32BE(label.length);b.writeBigUInt64BE(BigInt(raw.length));digest.update(a).update(label).update(b).update(raw);inventory[name]=hash(raw);}return {algorithm:'sha256-ordinal-path-length-content-v1',fileCount:names.length,sha256:digest.digest('hex'),inventorySha256:hash(canonical(inventory)),inventory};}
const manifest=json(path.join(root,'deployment-manifest.json'));
if(manifest.sha256!=='58cc236e09f097f2c7aec054af9699fc7c0aca3bda1cd79d1c47cbf06efd1a8f')throw Error('Different review candidate');
const planSha='3fb9b0fe083862da5a1a426b444a91365b2ec4fdecb0c4191c2c18f0a12ccb5b';
const planPath=path.join(runtime,'state/worker-release-rotation-plans',planSha+'.json'),plan=json(planPath);
const receiptPath=path.join(runtime,'state/worker-prepared-builds',planSha+'.json'),receipt=json(receiptPath);
if(plan.sha256!==planSha||!read(planPath+'.sha256').equals(Buffer.from(planSha+'\n'))||!read(receiptPath+'.sha256').equals(Buffer.from(receipt.sha256+'\n')))throw Error('Original plan/receipt sidecar mismatch');
if(plan.value.candidate.manifestSha256!==manifest.sha256||plan.value.candidate.releaseId!==releaseId||receipt.value.planSha256!==planSha||receipt.value.candidateManifestSha256!==manifest.sha256)throw Error('Original tuple mismatch');
const envelope=manifest.value.source.sourceBinding,binding=JSON.parse(envelope.raw);
if(hash(envelope.raw)!==envelope.sha256||canonical(envelope)!==canonical(plan.value.sourceBinding)||canonical(envelope)!==canonical(receipt.value.sourceBinding)||canonical(binding.identity)!==canonical(receipt.value.identity)||canonical(binding.predecessor)!==canonical(plan.value.predecessor)||binding.predecessorChainStateSha256!==plan.value.predecessorChainStateSha256)throw Error('Source/identity/predecessor envelope mismatch');
console.log(JSON.stringify({stage:'complete-source-and-payload-rehash',startedAt,releaseId}));
const before=tree(path.join(runtime,'releases',plan.value.predecessor.releaseId,'source-snapshot')),after=tree(path.join(root,'source-snapshot'));
if(after.sha256!==manifest.value.source.tree.sha256||after.fileCount!==manifest.value.source.tree.fileCount||after.inventorySha256!==binding.identity.sourceInventorySha256)throw Error('Complete snapshot differs from original receipt');
const changed=[...new Set([...Object.keys(before.inventory),...Object.keys(after.inventory)])].sort().filter(p=>before.inventory[p]!==after.inventory[p]).map(p=>({path:p,before:before.inventory[p]??null,after:after.inventory[p]??null}));
const composition=json(path.join(evidence,'WORKER_SOURCE_COMPOSITION_V3.json'));
if(canonical(changed.map(x=>x.path))!==canonical(composition.value.changed.map(x=>x.path).sort())||changed.length!==10)throw Error('Complete predecessor delta differs from ten selected controls');
for(const pin of composition.value.changed)if(after.inventory[pin.path]!==pin.sha256||hash(read(path.join(root,pin.path)))!==pin.sha256)throw Error('Packaged control differs from snapshot: '+pin.path);
const payload=[];
for(const [name,expected,excluded]of [['dist',manifest.value.build.distTree,['server/.dev.vars']],['helper',manifest.value.build.helperTree,[]],['node_modules',manifest.value.build.nodeModulesTree,[]]]){
  const actual=tree(path.join(root,name),excluded);if(actual.sha256!==expected.sha256||actual.fileCount!==expected.fileCount||actual.algorithm!==expected.algorithm)throw Error('Complete '+name+' payload mismatch');
  payload.push({name,algorithm:actual.algorithm,fileCount:actual.fileCount,sha256:actual.sha256,excluded});
}
// Confirm prescribed secret links only by filesystem identity; never read values.
const linkPaths=[manifest.value.runtime.devVars.sourcePath,path.join(root,manifest.value.runtime.devVars.releaseLink),path.join(root,manifest.value.runtime.devVars.workerLink)];
const linkStats=linkPaths.map(p=>fs.lstatSync(p,{bigint:true}));
if(linkStats.some(s=>!s.isFile()||s.isSymbolicLink()||s.dev!==linkStats[0].dev||s.ino!==linkStats[0].ino))throw Error('Prescribed configuration hard-link identity differs');
const keyFiles=manifest.value.artifacts.keyFiles.map(pin=>{if(hash(read(path.join(root,pin.relativePath)))!==pin.sha256)throw Error('Key file differs: '+pin.relativePath);return pin;});
const regression=json(path.join(evidence,'CANDIDATE_REGRESSION_FINAL_V3.json')),harness=json(path.join(evidence,'CANDIDATE_REGRESSION_HARNESS_V3.json'));
if(regression.value.candidateManifestSha256!==manifest.sha256||regression.value.sourceSha256!==after.sha256||harness.value.candidateManifestSha256!==manifest.sha256||harness.sha256!==regression.value.harnessSha256)throw Error('Candidate regression tuple mismatch');
const candidateLog=read(path.join(evidence,'CANDIDATE_REGRESSION_V3.stdout.log'));
if(hash(candidateLog)!==regression.value.logSha256||!/pass 166/.test(candidateLog.toString())||!/fail 0/.test(candidateLog.toString()))throw Error('Candidate log mismatch');
for(const pin of harness.value.pins)if(hash(read(path.join(harness.value.root,pin.name)))!==pin.harnessSha256)throw Error('Executed harness drift: '+pin.name);
const delivery=json(path.join(evidence,'DELIVERY.json'));
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
for(const commit of [delivery.value.sourceCommit,delivery.value.mergeCommit,delivery.value.deliveryCommit]){
  execFileSync('git',['cat-file','-e',commit+'^{commit}'],{cwd:repo});
  execFileSync('git',['merge-base','--is-ancestor',commit,'030024542ef76be081f69023fefb0601dd4d06b5'],{cwd:repo});
}
const drift=[...stableFiles].filter(([file,expected])=>fingerprint(fs.lstatSync(file,{bigint:true}))!==expected).map(([file])=>file);
if(drift.length)throw Error('Audit input changed before closure: '+drift[0]);
const record={version:'teruisi-c-3032-independent-byte-audit-v1',startedAt,finishedAt:new Date().toISOString(),releaseId,manifestSha256:manifest.sha256,planSha256:plan.sha256,preparedReceiptSha256:receipt.sha256,sourceBindingSha256:envelope.sha256,predecessor:plan.value.predecessor,predecessorChainStateSha256:plan.value.predecessorChainStateSha256,source:{before:{fileCount:before.fileCount,sha256:before.sha256},after:{fileCount:after.fileCount,sha256:after.sha256,inventorySha256:after.inventorySha256}},changed,payload,keyFiles,configurationHardLinkIdentityVerifiedWithoutReadingValues:true,bindingTupleAndSidecarsMatch:true,fullBuiltPayloadIndependentlyRehashed:true,stableInputFiles:stableFiles.size,inputDrift:[],git:{sourceCommit:delivery.value.sourceCommit,mergeCommit:delivery.value.mergeCommit,deliveryCommit:delivery.value.deliveryCommit,commitsExistAndIncluded:true},candidateRegression:{passed:regression.value.passed,failed:regression.value.failed,logSha256:hash(candidateLog),harnessSha256:harness.sha256,rerunByThisAudit:false,assertionPreservationNeedsReview:true},newProtectionSchemeUserInstruction:'One pre-release backup plus one isolated rehearsal of new recovery-tool consumption chain; no post-release repeat',V4FourDatabaseBatchNotApprovedForNewInstruction:true,newProtectionSourceAndBatchNotAccepted:true,productionActions:0,livePermissionsMaintenanceDrainAndProcessIdentityNotCollected:true,noPerformanceBenefitClaimed:true};
const out=path.join(path.dirname(fileURLToPath(import.meta.url)),'BYTE_AUDIT_3032.json');fs.writeFileSync(out,JSON.stringify(record,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({out,sourceSha256:after.sha256,payload:payload.map(x=>({name:x.name,fileCount:x.fileCount})),finishedAt:record.finishedAt}));
