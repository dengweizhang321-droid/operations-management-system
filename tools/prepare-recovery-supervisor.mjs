import {createHash} from 'node:crypto';
import path from 'node:path';
const hash=x=>createHash('sha256').update(x).digest('hex');
export function recoverySupervisor(source,{candidateDirectory}){
 if(!path.isAbsolute(candidateDirectory))throw Error('Exact candidate directory required');
 const begin=source.indexOf('function Restore-WatchSupervisor {'),end=source.indexOf('\nfunction ',begin+1);if(begin<0||end<0)throw Error('Original supervisor recovery function missing');
 const original=source.slice(begin,end),line=original.split(/\r?\n/).find(x=>x.trimStart().startsWith('Start-Process -FilePath '));if(!line||original.indexOf(line)!==original.lastIndexOf(line))throw Error('Exact original supervisor spawn required');
 const nl=original.includes('\r\n')?'\r\n':'\n';
 const replacement=["    [void](Get-ProcessRemaining $RecoverySupervisorDeadline)","    $savedSupervisorTransportDeadline=$env:TERUISI_PROCESS_DEADLINE_UNIX_MS","    try {","      [Environment]::SetEnvironmentVariable('TERUISI_PROCESS_DEADLINE_UNIX_MS',$null,'Process')",line,"    } finally { [Environment]::SetEnvironmentVariable('TERUISI_PROCESS_DEADLINE_UNIX_MS',$savedSupervisorTransportDeadline,'Process') }"].join(nl);
 const route="(Join-Path $PSScriptRoot 'watchdog-status-backend.ps1')",absolute="'"+path.join(candidateDirectory,'watchdog-status-backend.ps1').replaceAll("'","''")+"'";
 if(original.split(route).length!==2)throw Error('Recovery must derive from the supervisor-safe candidate');
 const generated=original.replace('function Restore-WatchSupervisor {','function Restore-RecoverySupervisor {').replace(line,()=>replacement).replace(route,()=>absolute);
 const reversed=generated.replace('function Restore-RecoverySupervisor {','function Restore-WatchSupervisor {').replace(replacement,()=>line).replace(absolute,()=>route);if(reversed!==original)throw Error('Recovery supervisor predicate changed');
 return {generated,proof:{originalSha256:hash(original),generatedSha256:hash(generated),reversedExact:true,edits:[['function Restore-WatchSupervisor {','function Restore-RecoverySupervisor {'],[line,replacement],[route,absolute]],longRunningDeadlineExcludedOnlyDuringSpawn:true}};
}
