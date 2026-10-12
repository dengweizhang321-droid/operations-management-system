import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
import {prepareStatusDriver} from './prepare-watchdog-status-driver.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const quote=x=>"'"+x.replaceAll("'","''")+"'";
function once(text,from,to){if(!text.includes(from)||text.indexOf(from)!==text.lastIndexOf(from))throw Error('native_diagnostic_source_shape_changed');return text.replace(from,()=>to);}
export function body(text,name){const at=text.indexOf('function '+name+'(');if(at<0)throw Error('missing_function_'+name);const end=text.indexOf('\nfunction ',at+1);if(end<0)throw Error('unbounded_function_'+name);return text.slice(at,end);}
export function readonlyBodies(backend,worker){
 const resolver=body(backend,'Resolve-OwnedProcess'),workerStatus=body(worker,'Get-WorkerStatusInternal');
 const newline=resolver.includes('\r\n')?'\r\n':'\n';
 const edits=[
  ['  [string]$ExpectedFingerprint = ""','  [string]$ExpectedFingerprint = "",'+newline+'  [switch]$ReadOnly'],
  ['  $snapshot = Get-ProcessSnapshot $processId 1','  $snapshot = Get-ReadonlyDiagnosticSnapshot $processId 1'],
  ['    Remove-Item -LiteralPath $PidPath -Force'+newline+'    Write-LauncherEvent "WARN" "stale_process_record_removed" $PidPath','    # Diagnostic absence never deletes the ownership record.'],
  ['    if (Remove-PreviousBootProcessRecordIfSafe $PidPath $record.creationDate $record.startedAt) {'+newline+'      return $null'+newline+'    }','    # Diagnostic mismatch never invokes previous-boot cleanup.'],
 ];
 let readResolver=resolver;for(const [from,to]of edits)readResolver=once(readResolver,from,to);
 const workerFrom='$processes = @(Get-CimInstance Win32_Process -ErrorAction Stop)',workerTo='$processes = @(Get-ReadonlyWorkerCensus $Identity)';
 const readWorker=once(workerStatus,workerFrom,workerTo);
 let reverted=readResolver;for(const [from,to]of [...edits].reverse())reverted=once(reverted,to,from);
 if(reverted!==resolver||once(readWorker,workerTo,workerFrom)!==workerStatus)throw Error('original_predicate_changed');
 return {readResolver,readWorker,proof:{backend:{originalBodySha256:hash(resolver),generatedBodySha256:hash(readResolver),revertedExact:true,edits},worker:{originalBodySha256:hash(workerStatus),generatedBodySha256:hash(readWorker),revertedExact:true,edits:[[workerFrom,workerTo]]}}};
}
export async function prepareNativeStatusDriver(options){
 const [backend,worker,native]=await Promise.all([readFile(options.backendFile,'utf8'),readFile(options.workerFile,'utf8'),readFile(options.nativeTemplateFile??new URL('./watchdog-native-metadata.ps1',import.meta.url),'utf8')]);
 const bodies=readonlyBodies(backend,worker);
 const binding=await prepareStatusDriver(options);
 const output=options.outputDirectory,controlPath=path.join(output,'watchdog-status-control.ps1'),overlayPath=path.join(output,'watchdog-core-overlay.ps1');
 let control=await readFile(controlPath,'utf8');
 control=once(control,'$releaseStatus = Invoke-JsonServiceAction -ScriptPath $LocalWorkerStarter -Arguments @("-Action", "Status") -Label',
  '$releaseStatus = Invoke-JsonServiceAction -ScriptPath (Join-Path $PSScriptRoot "watchdog-status-backend.ps1") -Arguments @("-Action", "Status", "-DiagnosticTarget", "Worker") -Label');
 const overlay=(await readFile(overlayPath,'utf8'))+'\n'+native.replace(/^\ufeff/,'')+'\n'+bodies.readResolver+'\n'+bodies.readWorker+'\n';
 const wrapper=`[CmdletBinding()]
param([ValidateSet('Status','AggregateStatus')][string]$Action='Status',[switch]$Json,[ValidateSet('Backend','Worker')][string]$DiagnosticTarget='Backend')
$ErrorActionPreference='Stop'
$diagnosticRequestedAction=$Action
if($DiagnosticTarget -eq 'Worker' -and $Action -ne 'Status'){throw 'readonly_worker_status_only'}
$diagnosticBackend=${quote(options.backendFile)}
$diagnosticWorker=${quote(options.workerFile)}
$diagnosticRoot=${quote(path.dirname(path.dirname(path.dirname(options.backendFile))))}
$diagnosticBinding=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'driver-binding.json') -Raw|ConvertFrom-Json
function Assert-NativeDiagnosticSources {
 if((Get-FileHash -LiteralPath $diagnosticBackend -Algorithm SHA256).Hash.ToLowerInvariant() -cne $diagnosticBinding.assetHashes.backend -or
    (Get-FileHash -LiteralPath $diagnosticWorker -Algorithm SHA256).Hash.ToLowerInvariant() -cne $diagnosticBinding.assetHashes.worker){throw 'diagnostic_predecessor_changed'}
}
Assert-NativeDiagnosticSources
if($DiagnosticTarget -eq 'Worker'){
 . $diagnosticWorker -Action Status -FunctionsOnly -Json
 . (Join-Path $PSScriptRoot 'watchdog-core-overlay.ps1')
 $diagnosticManifest=Get-CurrentManifestPath
 $diagnosticIdentity=if($diagnosticManifest){Get-ManifestIdentity $diagnosticManifest}else{$null}
 $diagnosticResult=Get-PublicStatus (Get-WorkerStatusInternal $diagnosticIdentity)
 Assert-NativeDiagnosticSources
 $diagnosticResult|ConvertTo-Json -Depth 8 -Compress
}else{
 $savedLibrary=$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY
 try{$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY='1';. $diagnosticBackend -Action Status -RuntimeRoot $diagnosticRoot -Json}finally{$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY=$savedLibrary}
 . (Join-Path $PSScriptRoot 'watchdog-core-overlay.ps1')
 # Capability markers required by the original controller:
 # "AggregateStatus" { Show-AggregateServiceStatus }
 # teruisi-django-aggregate-status-v1
 $script:Json=[switch]$true
 $diagnosticResult=if($diagnosticRequestedAction -eq 'AggregateStatus'){Show-AggregateServiceStatus}else{Show-ServiceStatus}
 Assert-NativeDiagnosticSources
 $diagnosticResult
}
`;
 await writeFile(controlPath,control);
 await writeFile(overlayPath,overlay);
 await writeFile(path.join(output,'watchdog-status-backend.ps1'),'\ufeff'+wrapper);
 return {binding,proof:{...bodies.proof,backendSourceSha256:hash(Buffer.from(backend)),workerSourceSha256:hash(Buffer.from(worker)),nativeTemplateSha256:hash(Buffer.from(native)),controlRouting:'one fixed Worker Status target replacement; other controller predicates unchanged'},files:await Promise.all(['watchdog-status-control.ps1','watchdog-status-backend.ps1','watchdog-core-overlay.ps1','driver-binding.json'].map(async name=>({name,sha256:hash(await readFile(path.join(output,name)))})))};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==3)throw Error('Exact options file required');
 console.log(JSON.stringify(await prepareNativeStatusDriver(JSON.parse(await readFile(process.argv[2],'utf8')))));
}
