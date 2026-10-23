import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const work='D:/codex-worktrees/s05d-field-validation-20261023';
const base='D:/codex-artifacts/s05d-field-validation-20261023';
const old='D:/codex-artifacts/s05d-residual-classification-20261023';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const oldPins=JSON.parse(await fs.readFile(old+'/inspect-code-d1468c7b-6ba6-4565-a5d3-9b6dd41369aa/PINS.json','utf8'));
const root=base+'/inspect-code-'+crypto.randomUUID(),files={};
await fs.mkdir(root,{recursive:false});
for(const name of Object.keys(oldPins.files)){
 const raw=await fs.readFile(work+'/'+name);
 const committed=execFileSync('D:/git/Git/cmd/git.exe',['-C',work,'show','9925e6ac0a616f7c83c710f2a98993a7a58dad42:'+name],{windowsHide:true,maxBuffer:8*1024*1024});
 assert.ok(raw.equals(committed),'Candidate differs from committed file: '+name);
 await fs.mkdir(path.dirname(root+'/'+name),{recursive:true});await fs.writeFile(root+'/'+name,raw,{flag:'wx'});
 files[name]={size:raw.length,sha256:hash(raw)};
}
assert.equal(Object.keys(files).length,33);
const pins={version:'s05d-readonly-field-pins-v1',commit:'9925e6ac0a616f7c83c710f2a98993a7a58dad42',writeAuthority:false,productionWriterReady:false,files};
await fs.writeFile(root+'/PINS.json',JSON.stringify(pins,null,2)+'\n',{flag:'wx'});
let driver=await fs.readFile(old+'/inspect-closure-cas-180.mjs','utf8');
function replace(a,b){assert.equal(driver.split(a).length,2,'Expected unique driver segment');driver=driver.replace(a,b);}
replace("const base='"+old+"';","const base='"+base+"';");
replace("const working='D:/codex-worktrees/s05d-residual-classification-20261023';","const working='"+work+"';");
driver=driver.replaceAll('180000ms','1200000ms');
replace('},180000);','},1200000);');
replace("const includeSnapshots=process.argv[3]==='--snapshots';","const includeSnapshots=process.argv[3]==='--snapshots';assert.equal(includeSnapshots,true,'This run requires full snapshots');");
const checks=`
  const expected=JSON.parse(await fs.readFile('${old}/inspect-b0a2ddc1-7453-4cbf-b580-eb1e7dd3ab88.observation.json','utf8'));
  assert.deepEqual(actions.map(x=>path.resolve(x.source).toLowerCase()).sort(),[...expected.sourceActions,...expected.artifactActions].map(x=>path.resolve(x.source).toLowerCase()).sort(),'Current action scope changed; no additional object scan');
`;
replace('result.snapshotMeasurements=[];','result.snapshotMeasurements=[];'+checks);
const driverFile=work+'/docs/s05d-field-validation-20261023/readonly-field-scan.mjs';
await fs.writeFile(driverFile,driver,{flag:'wx'});
const result={root,driver:driverFile,driverSha256:hash(driver),pinsSha256:hash(await fs.readFile(root+'/PINS.json')),files:Object.keys(files).length,budgetMs:1200000,productionBudgetsChanged:false};
await fs.writeFile(work+'/docs/s05d-field-validation-20261023/readonly-input.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(result));
