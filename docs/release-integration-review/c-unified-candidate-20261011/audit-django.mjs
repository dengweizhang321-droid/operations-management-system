// Static read-only comparison of the original PrepareApp result; no production module imports.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const hash=raw=>createHash('sha256').update(raw).digest('hex');
const runtime='D:/teruisi-runtime/django-sales',id='1e1138feef7148fb851713c2b39a25d0';
const startedAt=new Date().toISOString();
function raw(file){const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1)throw Error('Unsafe file: '+file);return fs.readFileSync(file);}
function tree(root){const files=new Map();function walk(dir){for(const name of fs.readdirSync(dir)){if(['__pycache__','.pytest_cache','.mypy_cache'].includes(name))continue;const target=path.join(dir,name),s=fs.lstatSync(target);if(s.isSymbolicLink())throw Error('Redirected tree');if(s.isDirectory())walk(target);else if(s.isFile()){const p=path.relative(root,target).split(path.sep).join('/');if(p==='deployment.json'||/\.(pyc|pyo)$/i.test(p))continue;files.set(p,hash(raw(target)));}else throw Error('Special tree file');}}walk(root);const rows=[...files].map(([p,h])=>p+'\n'+h).sort();return {files,fileCount:files.size,fingerprint:hash(rows.join('\n'))};}
const beforeRoot=path.join(runtime,'app'),afterRoot=path.join(runtime,'app.deploy-'+id);
const receiptRaw=raw(path.join(runtime,'app.prepare-'+id+'.json')),receipt=JSON.parse(receiptRaw);
const beforeManifestRaw=raw(path.join(beforeRoot,'deployment.json')),afterManifestRaw=raw(path.join(afterRoot,'deployment.json'));
const beforeManifest=JSON.parse(beforeManifestRaw),afterManifest=JSON.parse(afterManifestRaw);
if(receipt.id!==id||receipt.version!=='teruisi-django-prepared-app-v1'||receipt.predecessorManifestSha256!==hash(beforeManifestRaw)||receipt.candidateManifestSha256!==hash(afterManifestRaw))throw Error('PrepareApp tuple mismatch');
const before=tree(beforeRoot),after=tree(afterRoot);
for(const [manifest,actual]of[[beforeManifest,before],[afterManifest,after]])if(manifest.fingerprintAlgorithm!=='relative-path-file-sha256-ordinal-v2'||manifest.fileCount!==actual.fileCount||manifest.appFingerprint!==actual.fingerprint)throw Error('Application manifest tree mismatch');
const changed=[...new Set([...before.files.keys(),...after.files.keys()])].sort().filter(p=>before.files.get(p)!==after.files.get(p)).map(p=>({path:p,before:before.files.get(p)??null,after:after.files.get(p)??null}));
// Original PrepareApp executes a local R2 smoke. Miniflare may refresh its cf cache;
// include those actual artifact bytes explicitly rather than claim a two-file tree.
const expected=['.wrangler/cache/cf.json','tools/worker-local-release-rotation.mjs','tools/worker-local-release.mjs'];
if(JSON.stringify(changed.map(x=>x.path))!==JSON.stringify(expected)){
  const failure={version:'teruisi-independent-django-prepared-tools-audit-failure-v1',at:new Date().toISOString(),preparedAppId:id,receiptSha256:hash(receiptRaw),predecessorManifestSha256:hash(beforeManifestRaw),candidateManifestSha256:hash(afterManifestRaw),fullManifestTreesIndependentlyRehashed:true,expected,actual:changed,productionDeployments:0};
  const output=path.join(path.dirname(fileURLToPath(import.meta.url)),'DJANGO_AUDIT_FAILURE.json');
  fs.writeFileSync(output,JSON.stringify(failure,null,2)+'\n',{flag:'wx'});
  console.error(JSON.stringify(failure));throw Error('Django candidate has unexpected changes');
}
const worker='D:/teruisi-runtime/teruisi-worker-sales/releases/20261011T034516Z-f308beaede528df7';
for(const item of changed.filter(x=>x.path.startsWith('tools/')))if(item.after!==hash(raw(path.join(worker,item.path))))throw Error('Django/Worker tools mismatch');
const report={version:'teruisi-independent-django-prepared-tools-audit-v1',startedAt,finishedAt:new Date().toISOString(),preparedAppId:id,receiptSha256:hash(receiptRaw),predecessorManifestSha256:hash(beforeManifestRaw),candidateManifestSha256:hash(afterManifestRaw),before:{fileCount:before.fileCount,appFingerprint:before.fingerprint},after:{fileCount:after.fileCount,appFingerprint:after.fingerprint},changed,fullManifestTreesIndependentlyRehashed:true,businessConfigDrizzleRuntimeDependenciesByteEqual:true,matchingWorkerTools:true,artifactCacheExtraChangeExplicitlyRecorded:true,cacheGenerationInference:'Original PrepareApp local R2 smoke uses unchanged Miniflare cache writer; specific write provenance was not separately instrumented',firstTwoFileAssertionFailurePreserved:'DJANGO_AUDIT_FAILURE.json',productionDeployments:0,actualInstalledManifestStillPredecessor:true,consumerExecutionAndSwitchOrderVerified:false,metadataIsNotFreshReadiness:true};
const output=path.join(path.dirname(fileURLToPath(import.meta.url)),'DJANGO_AUDIT.json');fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
