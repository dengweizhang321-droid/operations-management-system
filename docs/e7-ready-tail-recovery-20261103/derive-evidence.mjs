/** Read fixed small original files and native read-only identity; write only this candidate recipe. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url)),sha=b=>createHash('sha256').update(b).digest('hex');
const read=async p=>{const s=await fs.stat(p);assert.ok(s.isFile()&&s.size<=4*1024*1024);return fs.readFile(p);};
const json=async p=>JSON.parse(await read(p));
assert.deepEqual(process.argv.slice(2),[],'No configurable target or output');
const mainCommit='e7aaf6c16939770d0941994873747fe301ef0b93',recoveryId='e7aaf6c1-ready-tail-20261103';
const source='D:/codex-isolated/main-release-packages/e7aaf6c16939-f23d8bf6-5aaa7584/source',attempt=path.join(path.dirname(source),'publish-e7aaf6c16939');
const configFile='D:/codex-isolated/main-manual-release-20261016/main-publisher-config.json',config=await json(configFile);
const installationPath=path.join(config.stateDirectory,'CONTROL-INSTALLATION.json'),installation=await json(installationPath);
assert.equal(installation.bundleSha256,'fe4e34dcea03ad77c47c288bd572841ae69428bb05147893f69c452102d45aa6');
assert.equal(path.basename(config.nativeToolsSource),'d08a3c4de4bd04325bd8e63811775934e97a9f63f757e40b6afec4a3166ddf31');
const prepared=await json(path.join(attempt,'preparation/PREPARED.json')),started=await json(path.join(attempt,'STARTED.json')),applied=await json(path.join(attempt,'WorkerApply-result.json'));
assert.equal(started.mainCommit,mainCommit);assert.equal(prepared.sourceIdentity.commit,mainCommit);
const publisher=await import(pathToFileURL(path.join(installation.bundleRoot,'tools/publish-latest-main.mjs')));
// observeLiveIdentity resolves the verified native chain and reads manifests; no health, lifecycle or accounting action.
const live=await publisher.observeLiveIdentity(config);
assert.equal(live.workerCommit,mainCommit);assert.equal(live.djangoCommit,mainCommit);
assert.equal(path.resolve(live.workerSource),path.resolve(source));assert.equal(path.resolve(live.djangoSource),path.resolve(source));
assert.equal(live.workerRelease,prepared.workerPlan.candidateReleaseId);assert.equal(live.workerManifestSha256,prepared.workerPlan.candidateManifestSha256);assert.equal(live.djangoManifestSha256,prepared.djangoManifestSha256);
const r={version:'teruisi-e7-ready-tail-evidence-v1',recordedAt:new Date().toISOString(),mainCommit,recoveryId,programRelative:'docs/e7-ready-tail-recovery-20261103/recover-ready-tail.mjs',source,attempt,configFile,stateDirectory:config.stateDirectory,bundleRoot:installation.bundleRoot,bundleSha256:installation.bundleSha256,nativeRoot:config.nativeToolsSource,installationSha256:sha(await read(installationPath)),nodeSha256:installation.preparationTask.nodeSha256,workerRoot:'D:/teruisi-runtime/teruisi-worker-sales',djangoRoot:'D:/teruisi-runtime/django-sales',workerRelease:live.workerRelease,workerManifestSha256:live.workerManifestSha256,djangoManifestSha256:live.djangoManifestSha256,djangoPreparedId:prepared.djangoPackage.id,planSha256:prepared.workerPlan.planSha256,consumptionSha256:applied.consumptionSha256,targetHead:live.head,chainStateSha256:live.chainStateSha256,sourceContentTree:live.manifest.source.tree,originalCatalogSha256:sha(await read(path.join(config.stateDirectory,'PUBLISHED-MAIN.json')))};
assert.equal(r.originalCatalogSha256,'5746c95af1214d4059f7dfeba7d8635aaef4c54ee098ca50dd34353672ad3007');
r.paths={request:path.join(path.dirname(source),'main-release-request.json'),started:path.join(attempt,'STARTED.json'),failed:path.join(attempt,'FAILED.json'),prepared:path.join(attempt,'preparation/PREPARED.json'),workerApply:path.join(attempt,'WorkerApply-result.json'),workerApplyStarted:path.join(attempt,'WorkerApply-started.json'),consumption:path.join(r.workerRoot,'state/worker-release-rotation-consumptions',r.planSha256+'.json'),djangoPrepared:path.join(r.djangoRoot,'app.prepare-'+r.djangoPreparedId+'.json')};
r.steps=Object.fromEntries(['部署后台','应用后台权限','退出维护','启动服务','确认启动版本'].map(label=>[label,Object.fromEntries(['started','result','process'].map(kind=>[kind,path.join(attempt,label+'-'+kind+'.json')]))]));
r.pins=await Promise.all([...Object.values(r.paths),...Object.values(r.steps).flatMap(Object.values),configFile,installationPath].map(async p=>({path:p,sha256:sha(await read(p))})));
assert.equal(r.pins.find(p=>p.path===r.paths.prepared).sha256,'27c28eb34df8fa24940582072937346d5277d328cd9482663d086d22c9d0b66b');
assert.equal(r.pins.find(p=>p.path===r.paths.failed).sha256,'5c38e81989b993426d18bd96f0ec783294fd9617702a1dd6df920a488c859ead');
// Only reuse the reviewed dependency path inventory. Every byte digest is freshly read from its actual file.
const previous=await json(path.join(here,'../eab-ready-tail-recovery-20261103/EVIDENCE.json'));
r.codePins=await Promise.all(previous.codePins.map(async pin=>{const p=pin.path.replace('eab998f81c98-ea046c0d-b29a775d','e7aaf6c16939-f23d8bf6-5aaa7584');return {path:p,sha256:sha(await read(p))};}));
await fs.writeFile(path.join(here,'EVIDENCE.json'),JSON.stringify(r,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:'candidate-evidence-derived',mainCommit,pins:r.pins.length,codePins:r.codePins.length,sourceContentTree:r.sourceContentTree,chainStateSha256:r.chainStateSha256,productionWritten:false}));
