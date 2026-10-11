// Development-only limited derivation. Never imports/runs a production module.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
export const directory=path.dirname(fileURLToPath(import.meta.url));
export const sourceDirectory=path.resolve(directory,'../final-readiness-supplement');
export const sourceRoot='E:/codex-artifacts/release-integration-review-20261010/AB-final-readiness-20261011-verified-final';
const sha=b=>createHash('sha256').update(b).digest('hex');
export async function copyTemplates(){
  await mkdir(path.join(directory,'legacy'),{recursive:true});const files=[];
  for(const name of ['protocol.mjs','runtime.mjs','execute.mjs','prepare.mjs','status-evidence.mjs','copy-legacy.mjs','legacy/release-readonly-retry.mjs','legacy/release-batch.mjs','legacy/release-batch-admission.mjs','legacy/collector.mjs']){const from=path.join(sourceRoot,name),raw=await readFile(from),to=path.join(directory,name);await writeFile(to,raw,{flag:'wx'});files.push({name,originalPath:from,originalSha256:sha(raw)});}
  await writeFile(path.join(directory,'TEMPLATE_SOURCES.json'),JSON.stringify({version:1,files,productionExecuted:false},null,2)+'\n',{flag:'wx'});return files;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))copyTemplates().then(v=>console.log(JSON.stringify({copied:v.length,productionExecuted:false}))).catch(e=>{console.error(e.name);process.exitCode=1;});
