import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';
import {prepareNativeStatusDriver} from './prepare-watchdog-native-status-driver.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex'),quote=s=>"'"+s.replaceAll("'","''")+"'";
function once(text,from,to){if(text.indexOf(from)<0||text.indexOf(from)!==text.lastIndexOf(from))throw Error('supervisor_diagnostic_source_shape_changed');return text.replace(from,()=>to);}
export function readonlySupervisor(source){
 const start=source.indexOf('function Resolve-SupervisorProcess {'),end=source.indexOf('\nfunction ',start+1);if(start<0||end<0)throw Error('supervisor_resolver_missing');
 const original=source.slice(start,end),nl=original.includes('\r\n')?'\r\n':'\n';
 const edits=[['$snapshot = Get-ProcessSnapshot ([int]$receipt.processId) 1','$snapshot = Get-ReadonlyDiagnosticSnapshot ([int]$receipt.processId) 1'],['    Remove-Item -LiteralPath $SupervisorPidPath -Force'+nl,'    # A read-only missing snapshot never deletes the supervisor receipt.'+nl],['    if (Remove-PreviousBootProcessRecordIfSafe `'+nl+'          $SupervisorPidPath $receipt.creationDate $receipt.startedAt) {'+nl+'      return $null'+nl+'    }','    # A read-only identity mismatch never performs previous-boot cleanup.']];
 let generated=original;for(const [a,b]of edits)generated=once(generated,a,b);let reversed=generated;for(const [a,b]of [...edits].reverse())reversed=once(reversed,b,a);if(reversed!==original)throw Error('Supervisor ownership predicate changed');
 const statusStart=source.indexOf('    "Status" {\n')>=0?source.indexOf('    "Status" {\n'):source.indexOf('    "Status" {\r\n');
 const statusEnd=source.indexOf(nl+'    }'+nl+'  }'+nl+'  if ($SupervisorRequest.Action',statusStart);if(statusStart<0||statusEnd<0)throw Error('supervisor_status_block_missing');
 const status=source.slice(statusStart+'    "Status" {'.length,statusEnd);
 return{generated,status,proof:{originalSha256:hash(original),generatedSha256:hash(generated),statusBodySha256:hash(status),edits,reversedExact:true}};
}
export async function prepareSupervisorStatusDriver(options){
 const result=await prepareNativeStatusDriver(options),source=await fs.readFile(options.supervisorFile,'utf8'),parts=readonlySupervisor(source),out=options.outputDirectory;
 const binding={...result.binding,assetHashes:{...result.binding.assetHashes,supervisor:hash(Buffer.from(source))}};
 let wrapper=await fs.readFile(path.join(out,'watchdog-status-backend.ps1'),'utf8');
 wrapper=once(wrapper,"[ValidateSet('Backend','Worker')]","[ValidateSet('Backend','Worker','Supervisor')]");
 wrapper=once(wrapper,"if($DiagnosticTarget -eq 'Worker' -and $Action -ne 'Status')","if($DiagnosticTarget -in @('Worker','Supervisor') -and $Action -ne 'Status')");
 wrapper=once(wrapper,'$diagnosticBinding=Get-Content',`$diagnosticSupervisor=${quote(options.supervisorFile)}\n$diagnosticBinding=Get-Content`);
 wrapper=once(wrapper,"-cne $diagnosticBinding.assetHashes.worker){throw",`-cne $diagnosticBinding.assetHashes.worker -or\n    (Get-FileHash -LiteralPath $diagnosticSupervisor -Algorithm SHA256).Hash.ToLowerInvariant() -cne $diagnosticBinding.assetHashes.supervisor){throw`);
 const branch=`if($DiagnosticTarget -eq 'Supervisor'){
 $savedBackend=$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY
 $savedSupervisor=$env:TERUISI_DJANGO_SUPERVISOR_LIBRARY_ONLY
 try{
  $env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY='1';$env:TERUISI_DJANGO_SUPERVISOR_LIBRARY_ONLY='1'
  . $diagnosticBackend -Action Status -RuntimeRoot $diagnosticRoot -Json
  . $diagnosticSupervisor -Action Status -RuntimeRoot $diagnosticRoot
 }finally{$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY=$savedBackend;$env:TERUISI_DJANGO_SUPERVISOR_LIBRARY_ONLY=$savedSupervisor}
 . (Join-Path $PSScriptRoot 'watchdog-core-overlay.ps1')
 $canonicalRuntime=Get-SupervisorCanonicalPath $diagnosticRoot
 if($canonicalRuntime -ine $SupervisorFixedRuntimeRoot){throw 'supervisor_runtime_changed'}
 $ServiceScriptPath=$diagnosticBackend;$SupervisorScriptPath=$diagnosticSupervisor
 $SupervisorMonitorDirectory=Assert-RuntimeChildPath (Join-Path $canonicalRuntime 'monitoring\\django-runtime')
 $SupervisorAlertDirectory=Assert-RuntimeChildPath (Join-Path $SupervisorMonitorDirectory 'alerts\\pending')
 $SupervisorStatePath=Assert-RuntimeChildPath (Join-Path $SupervisorMonitorDirectory 'state.json')
 $SupervisorPidPath=Assert-RuntimeChildPath (Join-Path $RunDirectory 'django-supervisor.pid.json')
 $diagnosticResult=Invoke-ReadonlyMetadataObservation {${parts.status}
 }
 Assert-NativeDiagnosticSources
 $diagnosticResult|ConvertTo-Json -Depth 10 -Compress
}elseif($DiagnosticTarget -eq 'Worker'){`;
 wrapper=once(wrapper,"if($DiagnosticTarget -eq 'Worker'){",branch);
 await fs.writeFile(path.join(out,'watchdog-status-backend.ps1'),wrapper);
 await fs.appendFile(path.join(out,'watchdog-core-overlay.ps1'),'\n'+parts.generated+'\n');
 await fs.writeFile(path.join(out,'driver-binding.json'),JSON.stringify(binding,null,2));
 let watchdog=await fs.readFile(options.watchdogTemplateFile,'utf8');
 const from="Invoke-WatchScript $SupervisorPath @('-Action','Status')",to="Invoke-WatchScript (Join-Path $PSScriptRoot 'watchdog-status-backend.ps1') @('-Action','Status','-DiagnosticTarget','Supervisor')";
 if(watchdog.split(from).length!==3)throw Error('Expected exactly two original supervisor Status calls');
 watchdog=watchdog.replaceAll(from,to);
 // Original Run path is deliberately unchanged: no lifecycle wrapper is used.
 await fs.writeFile(path.join(out,'operations-system-watchdog.ps1'),watchdog);
 return{...result,binding,proof:{...result.proof,supervisor:parts.proof,supervisorSourceSha256:hash(Buffer.from(source)),watchdogRouting:{count:2,from,to,runUnchanged:true}}};
}
