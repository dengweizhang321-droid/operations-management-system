// Create new observation scripts only; no request, process, or lifecycle action here.
import{readFile,writeFile}from'node:fs/promises';import{createHash}from'node:crypto';
const entries=[];
for(const [from,to]of [['sample-resumed-availability.mjs','sample-backup-resume-availability.mjs'],['observe-resumed-batch.mjs','observe-backup-resume-batch.mjs']]){
 const raw=await readFile(new URL(from,import.meta.url)),next=raw.toString().replaceAll('production-f15d06a/resume1/','production-f15d06a/resume2/');
 if(next===raw.toString())throw new Error('Observer root was not replaced');
 await writeFile(new URL(to,import.meta.url),next,{flag:'wx'});entries.push({from,to,sha256:createHash('sha256').update(next).digest('hex')});
}console.log(JSON.stringify({entries,productionActions:0}));
