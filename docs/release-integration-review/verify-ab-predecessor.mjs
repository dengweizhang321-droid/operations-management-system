import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const source='D:\\运营管理系统-sales-django-release';
const {readSourceTree,sourceTreeDigest,sourceInventory,hash}=await import(pathToFileURL(path.join(source,'tools/release-impact.mjs')));
const predecessor='D:\\teruisi-runtime\\teruisi-worker-sales\\releases\\20261009T080026Z-d5fb5b62de630ae2';
const manifest=JSON.parse(await readFile(path.join(predecessor,'deployment-manifest.json')));
const before=await readSourceTree(path.join(predecessor,'source-snapshot'));
const sourceSha256=sourceTreeDigest(before),inventory=sourceInventory(before);
const result={status:sourceSha256===manifest.source.sourceFingerprint&&Object.keys(before).length===manifest.source.tree.fileCount?'passed':'failed',
  expectedSourceSha256:manifest.source.sourceFingerprint,sourceSha256,expectedFiles:manifest.source.tree.fileCount,files:Object.keys(before).length,
  inventorySha256:hash(inventory),publicEnvironmentExampleSha256:inventory['backend/.env.example'],productionWrites:false};
await writeFile(path.join(path.dirname(fileURLToPath(import.meta.url)),'evidence','ab-full-predecessor-inventory.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));if(result.status!=='passed')throw Error('Complete actual predecessor inventory not proven');
