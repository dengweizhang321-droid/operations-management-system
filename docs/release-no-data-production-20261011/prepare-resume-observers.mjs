import{readFile,writeFile}from'node:fs/promises';
const base=new URL('./',import.meta.url);
for(const [before,after]of [['observe-approved-batch.mjs','observe-resumed-batch.mjs'],['sample-approved-availability.mjs','sample-resumed-availability.mjs']]){
 let s=await readFile(new URL(before,base),'utf8');
 s=s.replaceAll('production-f15d06a/FINISHED.json','production-f15d06a/resume1/FINISHED.json').replace("production-f15d06a/',resource=","production-f15d06a/resume1/',resource=");
 await writeFile(new URL(after,base),s,{flag:'wx'});
}
