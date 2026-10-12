function Restore-RecoverySupervisor {
  $name='Local\TERUISI-DjangoSales-'+([Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($BackendRoot))).ToLowerInvariant()).Substring(0,24)
  $guard=[Threading.Mutex]::new($false,$name);$locked=$false
  try {
  try{$locked=$guard.WaitOne(0)}catch [Threading.AbandonedMutexException]{$locked=$true}
  if(-not $locked){throw 'django_lifecycle_busy'}
  $admission=Get-Admission;if($admission.mode -ne 'running'){throw 'supervisor_start_fenced'}
  $status=Invoke-WatchScript (Join-Path $PSScriptRoot 'watchdog-status-backend.ps1') @('-Action','Status','-DiagnosticTarget','Supervisor')
  if($status.supervisorProcess -eq 'running'){return}
  if($status.supervisorProcess -ne 'stopped'){throw 'supervisor_ownership_error'}
  $old=$env:PSModulePath
  try{
    $env:PSModulePath=[Environment]::GetEnvironmentVariable('PSModulePath','Machine')
    $id=[guid]::NewGuid().ToString('N')
    [void](Get-ProcessRemaining $RecoverySupervisorDeadline)
    $savedSupervisorTransportDeadline=$env:TERUISI_PROCESS_DEADLINE_UNIX_MS
    try {
      [Environment]::SetEnvironmentVariable('TERUISI_PROCESS_DEADLINE_UNIX_MS',$null,'Process')
    Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -WindowStyle Hidden -WorkingDirectory $BackendRoot -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',$SupervisorPath,'-Action','Run','-Execute') -RedirectStandardOutput (Join-Path $WatchdogRoot "supervisor-$id.out.log") -RedirectStandardError (Join-Path $WatchdogRoot "supervisor-$id.err.log")|Out-Null
    } finally { [Environment]::SetEnvironmentVariable('TERUISI_PROCESS_DEADLINE_UNIX_MS',$savedSupervisorTransportDeadline,'Process') }
  }finally{$env:PSModulePath=$old}
  } finally {if($locked){$guard.ReleaseMutex()};$guard.Dispose()}
}