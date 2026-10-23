import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const old='D:/codex-artifacts/s05d-residual-classification-20261023';
const base='D:/codex-artifacts/s05d-field-validation-20261023';
const docs='D:/codex-worktrees/s05d-field-validation-20261023/docs/s05d-field-validation-20261023';
let source=await fs.readFile(old+'/inspect-snapshots.mjs','utf8');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function replace(a,b){assert.equal(source.split(a).length,2);source=source.replace(a,b);}
replace("const base='"+old+"';","const base='"+base+"';");
replace("const codeRoot=base+'/inspect-code-d1468c7b-6ba6-4565-a5d3-9b6dd41369aa';","const codeRoot=base+'/inspect-code-5f1cef12-2d2a-41fc-bf95-7762e7eb349f';");
replace("const input=base+'/inspect-b0a2ddc1-7453-4cbf-b580-eb1e7dd3ab88';","const input='"+old+"/inspect-b0a2ddc1-7453-4cbf-b580-eb1e7dd3ab88';");
replace('budgetMs=300000','budgetMs=1200000');
replace('exceeded 300000ms','exceeded 1200000ms');
replace('actionListObservationSha256:prior.observationSha256,','actionListObservationSha256:prior.observationSha256,globalClosureSucceeded:false,globalClosureFailureFile:base+\'/inspect-3aebf329-c821-457f-8de6-1979a3546e3c.result.json\',');
const file=docs+'/readonly-four-objects.mjs';await fs.writeFile(file,source,{flag:'wx'});
const input={driver:file,driverSha256:hash(source),codeRoot:base+'/inspect-code-5f1cef12-2d2a-41fc-bf95-7762e7eb349f',budgetMs:1200000,scope:'Only the original four object snapshots and same-invocation all-object snapshot CAS; global closure remains blocked',globalClosureSucceeded:false};
await fs.writeFile(docs+'/four-object-input.json',JSON.stringify(input,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(input));
