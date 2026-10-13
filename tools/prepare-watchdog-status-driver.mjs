import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const hash=x=>createHash('sha256').update(x).digest('hex');
const ps=x=>"'"+x.replaceAll("'","''")+"'";
function segment(text,start,end){const a=text.indexOf(start),b=text.indexOf(end,a);if(a<0||b<a)throw new Error('diagnostic_source_shape_changed');return text.slice(a,b);}
function replaceOnce(text,from,to){if(!text.includes(from)||text.indexOf(from)!==text.lastIndexOf(from))throw new Error('diagnostic_source_shape_changed');return text.replace(from,to);}
export async function prepareStatusDriver({outputDirectory,controlFile,backendFile,workerFile,transportFile,coreTemplateFile,controlTemplateFile}){
  const original=await readFile(controlFile), backend=await readFile(backendFile), worker=await readFile(workerFile), transport=await readFile(transportFile);
  const core=await readFile(coreTemplateFile,'utf8'),controller=await readFile(controlTemplateFile,'utf8');
  const overlay=segment(core,'function Get-CoreStatusReadinessProbe(','function Show-FinanceServiceStatus');
  const coreDiagnostic=segment(controller,'function Get-CoreReadinessDiagnostic(','function Get-DjangoAggregateState');
  let mirror=original.toString('utf8').replace(/^\ufeff/,'');
  mirror=replaceOnce(mirror,'[ValidateSet("Panel", "Start", "Status", "StopWorker")]','[ValidateSet("Status")]');
  mirror=replaceOnce(mirror,'[string]$Action = "Panel"','[string]$Action = "Status"');
  mirror=replaceOnce(mirror,'$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path','$ProjectRoot = '+ps(path.dirname(path.dirname(controlFile))));
  mirror=replaceOnce(mirror,'$DjangoService = Join-Path $DjangoRuntimeTools "django-local-service.ps1"','$DjangoService = Join-Path $PSScriptRoot "watchdog-status-backend.ps1"');
  mirror=replaceOnce(mirror,'function Get-DjangoAggregateState {',coreDiagnostic+'\nfunction Get-DjangoAggregateState {');
  mirror=replaceOnce(mirror,'Components = [pscustomobject]$componentReadiness','Components = [pscustomobject]$componentReadiness\n      CoreDiagnostics = Get-CoreReadinessDiagnostic $coreStatus');
  mirror=replaceOnce(mirror,'components = $backendState.Components','components = $backendState.Components\n    coreDiagnostics = $backendState.CoreDiagnostics');
  mirror=replaceOnce(mirror,'$backendState = Get-DjangoAggregateState -Refresh:$Refresh','$diagnosticClock = [Diagnostics.Stopwatch]::StartNew()\n  $backendState = Get-DjangoAggregateState -Refresh:$Refresh\n  $diagnosticBackendMs = $diagnosticClock.ElapsedMilliseconds\n  $diagnosticClock.Restart()');
  mirror=replaceOnce(mirror,'$workerStatus = Get-WorkerReleaseStatus -Refresh:$Refresh','$workerStatus = Get-WorkerReleaseStatus -Refresh:$Refresh\n  $diagnosticWorkerMs = $diagnosticClock.ElapsedMilliseconds\n  $diagnosticClock.Restart()');
  mirror=replaceOnce(mirror,'components = $backendState.Components','components = $backendState.Components\n    statusTimings = [pscustomobject]@{backendMs=$diagnosticBackendMs;workerMs=$diagnosticWorkerMs;httpMs=$diagnosticClock.ElapsedMilliseconds}');
  const checks=`\nif($Open -or $StopWorker){throw 'readonly_status_only'}
$diagnosticSources=@{control=${ps(controlFile)};backend=${ps(backendFile)};worker=${ps(workerFile)};transport=${ps(transportFile)}}
function Assert-DiagnosticSources {
 $binding=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'driver-binding.json') -Raw|ConvertFrom-Json
 foreach($name in $diagnosticSources.Keys){if((Get-FileHash -LiteralPath $diagnosticSources[$name] -Algorithm SHA256).Hash.ToLowerInvariant() -cne $binding.assetHashes.$name){throw 'diagnostic_predecessor_changed'}}
}
Assert-DiagnosticSources
`;
  mirror=replaceOnce(mirror,'$ErrorActionPreference = "Stop"','$ErrorActionPreference = "Stop"'+checks);
  mirror=replaceOnce(mirror,'"Status" { Write-ControlResult (Get-SystemState -Refresh) }','"Status" { $diagnosticResult=Get-SystemState -Refresh; Assert-DiagnosticSources; Write-ControlResult $diagnosticResult }');
  const wrapper=`[CmdletBinding()]
param([ValidateSet('Status','AggregateStatus')][string]$Action='Status',[switch]$Json)
$ErrorActionPreference='Stop'
$diagnosticRequestedAction=$Action
$diagnosticOriginal=${ps(backendFile)}
$diagnosticRoot=${ps(path.dirname(path.dirname(path.dirname(backendFile))))}
$binding=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'driver-binding.json') -Raw|ConvertFrom-Json
if((Get-FileHash -LiteralPath $diagnosticOriginal).Hash.ToLowerInvariant() -cne $binding.assetHashes.backend){throw 'diagnostic_predecessor_changed'}
$savedLibrary=$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY
try{$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY='1';. $diagnosticOriginal -Action Status -RuntimeRoot $diagnosticRoot -Json}finally{$env:TERUISI_DJANGO_SERVICE_LIBRARY_ONLY=$savedLibrary}
. (Join-Path $PSScriptRoot 'watchdog-core-overlay.ps1')
# Native controller capability markers. Contract stays unchanged:
# "AggregateStatus" { Show-AggregateServiceStatus }
# teruisi-django-aggregate-status-v1
$script:Json=[switch]$true
$raw=if($diagnosticRequestedAction -eq 'AggregateStatus'){Show-AggregateServiceStatus}else{Show-ServiceStatus}
if((Get-FileHash -LiteralPath $diagnosticOriginal).Hash.ToLowerInvariant() -cne $binding.assetHashes.backend){throw 'diagnostic_predecessor_changed'}
$raw
`;
  await mkdir(outputDirectory,{recursive:true});
  for(const [name,text]of [['watchdog-status-control.ps1',mirror],['watchdog-status-backend.ps1',wrapper],['watchdog-core-overlay.ps1',overlay]])await writeFile(path.join(outputDirectory,name),'\ufeff'+text);
  const binding={version:1,assetHashes:{control:hash(original),backend:hash(backend),worker:hash(worker),transport:hash(transport)}};
  await writeFile(path.join(outputDirectory,'driver-binding.json'),JSON.stringify(binding,null,2));
  return binding;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const options=JSON.parse(await readFile(process.argv[2],'utf8'));
  process.stdout.write(JSON.stringify(await prepareStatusDriver(options))+'\n');
}
