// Task-only read-only diagnostics. Never invokes watchdog Check/recovery/notifications.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {runReadOnlyPowerShell} from 'file:///D:/运营管理系统-sales-django-release/tools/release-batch-admission.mjs';
const evidence=new URL('../../docs/runtime-risk-readonly-audit-20261009/evidence/',import.meta.url);
await mkdir(evidence,{recursive:true});
const phase=process.argv[2];
const paths={supervisor:'D:\\teruisi-runtime\\django-sales\\app\\tools\\django-runtime-supervisor.ps1',controller:'D:\\运营管理系统\\tools\\operations-system-control.ps1',aggregate:'D:\\teruisi-runtime\\django-sales\\app\\tools\\django-local-service.ps1',worker:'D:\\运营管理系统\\tools\\worker-local-service.ps1'};
if(!Object.hasOwn(paths,phase))throw Error('Only supervisor/controller Status permitted');
const script=paths[phase],args=phase==='aggregate'?['-Action','AggregateStatus','-Json']:phase==='supervisor'?['-Action','Status']:['-Action','Status','-Json'];
const startedAt=new Date().toISOString(),began=performance.now();
const receipt={phase,startedAt,script,args,scriptSha256:createHash('sha256').update(await readFile(script)).digest('hex'),readOnly:true,environment:'Existing PS5 readonly transport, native nested processes unchanged; natural watchdog/jobs remain active; no additional workload injected.'};
try{
 const r=await runReadOnlyPowerShell(script,args,'runtime-risk '+phase+' readonly Status');receipt.status='returned';const raw=JSON.parse(r.stdout.trim());
 if(phase==='aggregate'){
  receipt.data={version:raw.Version,domains:{}};
  for(const domain of ['Core','Finance','Netshop','Market','Products','Workflow','Inventory','CustomerService','AccessControl','ErpReference','Bi','Ai']){
   const value=raw[domain]??{},selected={};
   for(const [key,item] of Object.entries(value))if(key==='PostgreSQL'||key==='ReaderReadiness'||key==='WriterReadiness'||key==='RuntimeAcl'||key==='RuntimeAclVerification'||/^(Django|Finance|Netshop|Market|Products|Workflow|Inventory|CustomerService|AccessControl|ErpReference|Bi|Ai)(Reader|Writer)$/.test(key))selected[key]=item;
   receipt.data.domains[domain]=selected;
  }
 }else if(phase==='worker')receipt.data=Object.fromEntries(['version','state','reason','releaseId','supervisorProcessId','portProcessId'].map(k=>[k,raw[k]??null]));
 else receipt.data=raw;
}
catch(e){receipt.status='failed';receipt.error=String(e.message).slice(0,1600);}
receipt.completedAt=new Date().toISOString();receipt.elapsedMs=performance.now()-began;
await writeFile(new URL(phase+'-status-01.json',evidence),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(receipt));
