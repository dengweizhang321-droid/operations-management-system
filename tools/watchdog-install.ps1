# Library only. Shared by the versioned entry point and its installer.
function Get-WatchdogMutexName { 'Local\TERUISI.Operations.Watchdog.v2' }
function Assert-WatchdogInstallRoot([string]$Root){
  if([IO.Path]::GetFullPath($Root) -cne 'D:\teruisi-runtime\operations-watchdog'){throw 'invalid_install_root'}
  if(Test-Path -LiteralPath $Root){
    $item=Get-Item -LiteralPath $Root -Force
    if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'invalid_install_root'}
    $acl=Get-Acl -LiteralPath $Root
    $allowed=@([Security.Principal.WindowsIdentity]::GetCurrent().User.Value,'S-1-5-18','S-1-5-32-544')
    if(-not $acl.AreAccessRulesProtected -or @($acl.Access|Where-Object {$_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin $allowed}).Count){throw 'installation_acl_invalid'}
  }
}
function Get-WatchAssetHash([string]$Path){
  $item=Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  if($item.PSIsContainer -or $item.Length -gt 2097152 -or $item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'invalid_install_asset'}
  return Get-WatchHash $Path
}
function Get-WatchTextHash([string]$Text){
  $sha=[Security.Cryptography.SHA256]::Create()
  try{return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text)))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
}
function Test-WatchTaskAction($Task,[string]$Executable,[string]$Arguments,[string]$Root){
  return $Task -and @($Task.Actions).Count -eq 1 -and $Task.Actions.Execute -ceq $Executable -and $Task.Actions.Arguments -ceq $Arguments -and $Task.Actions.WorkingDirectory -ceq $Root
}
function Assert-WatchBundle([string]$Directory,$Expected){
  $manifest=Read-WatchJson (Join-Path $Directory 'bundle.json')
  if(-not $manifest -or $manifest.version -ne 1 -or $manifest.bundleId -cne $Expected.bundleId){throw 'invalid_watchdog_bundle'}
  $names=if($Expected.files -is [Collections.IDictionary]){@($Expected.files.Keys)}else{@($Expected.files.PSObject.Properties.Name)}
  if($names.Count -notin @(5,9) -or @($manifest.files.PSObject.Properties).Count -ne $names.Count){throw 'invalid_watchdog_bundle_files'}
  foreach($name in $names){
    if($name -notin @('operations-system-watchdog.ps1','process-deadline.ps1','watchdog-install.ps1','watchdog-launcher\NoConsoleLauncher.cs','Watchdog.NoConsole.exe','watchdog-status-control.ps1','watchdog-status-backend.ps1','watchdog-core-overlay.ps1','driver-binding.json')){throw 'invalid_watchdog_bundle_files'}
    $hash=$Expected.files.$name
    if($manifest.files.$name -cne $hash -or (Get-WatchAssetHash (Join-Path $Directory $name)) -cne $hash){throw 'watchdog_bundle_hash_mismatch'}
  }
  $entries=@(Get-ChildItem -LiteralPath $Directory -Force)
  if($entries.Count -ne $names.Count+1 -or @($entries|Where-Object {$_.Attributes -band [IO.FileAttributes]::ReparsePoint}).Count -gt 0){throw 'invalid_watchdog_bundle_files'}
  $nested=@(Get-ChildItem -LiteralPath (Join-Path $Directory 'watchdog-launcher') -Force)
  if($nested.Count -ne 1 -or $nested[0].Name -cne 'NoConsoleLauncher.cs'){throw 'invalid_watchdog_bundle_files'}
}
function Assert-WatchContainedDirectory([string]$Root,[string]$Directory){
  $rootPath=[IO.Path]::GetFullPath($Root).TrimEnd('\');$current=[IO.Path]::GetFullPath($Directory).TrimEnd('\')
  if(-not $current.StartsWith($rootPath+'\',[StringComparison]::OrdinalIgnoreCase) -and $current -ine $rootPath){throw 'invalid_install_directory'}
  while($current.Length -ge $rootPath.Length){
    if(Test-Path -LiteralPath $current){if((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'invalid_install_directory'}}
    if($current -ieq $rootPath){break};$current=Split-Path -Parent $current
  }
}
function Get-WatchInstallContext([string]$SourceDirectory,[string]$LauncherPath='',[string]$LauncherSha256=''){
  $root=[IO.Path]::GetFullPath($WatchdogRoot);Assert-WatchdogInstallRoot $root
  $configPath=Join-Path $root 'installation.json'
  $old=Read-WatchJson $configPath
  $task=Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  $oldXml=$null;$oldHash='absent';$oldBytes=$null
  if($task){
    if(-not $old -or $old.version -cne $WatchdogVersion){throw 'invalid_installed_watchdog'}
    $oldScript=Join-Path $root 'operations-system-watchdog.ps1'
    $oldLauncher=Join-Path $root ('Watchdog.NoConsole-'+$old.launcherSourceSha256.Substring(0,16)+'.exe')
    if($old.layout -eq 'immutable-v1'){
      if($old.bundleId -cnotmatch '^[0-9a-f]{64}$'){throw 'invalid_installed_watchdog'}
      $oldDirectory=Join-Path $root ('versions\'+$old.bundleId)
      Assert-WatchContainedDirectory $root $oldDirectory
      $oldScript=Join-Path $oldDirectory 'operations-system-watchdog.ps1'
      $oldLauncher=Join-Path $oldDirectory 'Watchdog.NoConsole.exe'
      Assert-WatchBundle $oldDirectory $old
    }
    if((Get-WatchAssetHash $oldScript) -cne $old.scriptSha256 -or (Get-WatchAssetHash (Join-Path (Split-Path $oldScript) 'process-deadline.ps1')) -cne $old.transportSha256 -or (Get-WatchAssetHash $oldLauncher) -cne $old.launcherSha256){throw 'installed_watchdog_hash_mismatch'}
    $guiArgs='"'+$PowerShellPath+'" "'+$oldScript+'"'
    $legacyArgs='-NoProfile -NonInteractive -WindowStyle Hidden -File "'+$oldScript+'" -Action Check -Execute'
    if(-not (Test-WatchTaskAction $task $oldLauncher $guiArgs $root) -and -not(Test-WatchTaskAction $task $PowerShellPath $legacyArgs $root)){throw 'unrecognized_watchdog_task_action'}
    if($task.State -eq 'Running'){throw 'wait_for_existing_watchdog_check_to_finish'}
    if(@($task.Triggers).Count -ne 2 -or $task.Triggers[1].Repetition.Interval -cne 'PT1M'){throw 'unrecognized_watchdog_task_cadence'}
    $oldXml=[string](Export-ScheduledTask -TaskName $TaskName -ErrorAction Stop)
    $oldHash=Get-WatchAssetHash $configPath;$oldBytes=[IO.File]::ReadAllBytes($configPath)
  }elseif($old){throw 'installed_watchdog_task_missing'}
  $files=[ordered]@{}
  foreach($name in @('operations-system-watchdog.ps1','process-deadline.ps1','watchdog-install.ps1','watchdog-launcher\NoConsoleLauncher.cs')){$files[$name]=Get-WatchAssetHash (Join-Path $SourceDirectory $name)}
  $driverFiles=@('watchdog-status-control.ps1','watchdog-status-backend.ps1','watchdog-core-overlay.ps1','driver-binding.json')
  $driverCount=@($driverFiles|Where-Object {Test-Path -LiteralPath (Join-Path $SourceDirectory $_)}).Count
  if($driverCount -notin @(0,4)){throw 'incomplete_watchdog_diagnostic_driver'}
  if($driverCount){foreach($name in $driverFiles){$files[$name]=Get-WatchAssetHash (Join-Path $SourceDirectory $name)}}
  if(-not $LauncherPath){
    if(-not $old -or $old.launcherSourceSha256 -cne $files['watchdog-launcher\NoConsoleLauncher.cs']){throw 'prepared_launcher_required'}
    $LauncherPath=$oldLauncher;$LauncherSha256=$old.launcherSha256
  }
  if($LauncherSha256 -cnotmatch '^[0-9a-f]{64}$' -or (Get-WatchAssetHash $LauncherPath) -cne $LauncherSha256){throw 'prepared_launcher_hash_mismatch'}
  $files['Watchdog.NoConsole.exe']=$LauncherSha256
  $binding=($files.Keys|ForEach-Object {$_+'='+$files[$_]}) -join "`n"
  $bundleId=Get-WatchTextHash $binding
  $oldXmlHash=if($oldXml){Get-WatchTextHash $oldXml}else{'absent'}
  $planId=Get-WatchTextHash ($root+'|'+$PowerShellPath+'|'+$bundleId+'|'+$oldHash+'|'+$oldXmlHash)
  return @{root=$root;source=$SourceDirectory;launcherSource=$LauncherPath;bundleId=$bundleId;files=$files;planId=$planId;old=$old;oldTask=$task;oldXml=$oldXml;oldBytes=$oldBytes;oldHash=$oldHash;oldXmlHash=$oldXmlHash;configPath=$configPath}
}
function Get-WatchInstallPlan {
  $context=Get-WatchInstallContext $PSScriptRoot $PreparedLauncherPath $PreparedLauncherSha256
  return @{version=1;planId=$context.planId;bundleId=$context.bundleId;files=$context.files;predecessorInstallationSha256=$context.oldHash;predecessorTaskSha256=$context.oldXmlHash;businessServicesRestarted=$false;requiresProductionApproval=$true}
}
function Write-WatchExactBytes([string]$Path,[byte[]]$Bytes){
  $temporary=$Path+'.restore-'+[guid]::NewGuid().ToString('N')
  [IO.File]::WriteAllBytes($temporary,$Bytes)
  if(Test-Path -LiteralPath $Path){
    $backup=$temporary+'.before'
    [IO.File]::Replace($temporary,$Path,$backup,$true)
    [IO.File]::Delete($backup)
  }else{[IO.File]::Move($temporary,$Path)}
}
function Install-WatchdogSafely([string]$SourceDirectory){
  if(-not $Execute){throw 'Install requires Execute'}
  $lease=[Threading.Mutex]::new($false,(Get-WatchdogMutexName));$held=$false
  try{
    try{$held=$lease.WaitOne(0)}catch [Threading.AbandonedMutexException]{$held=$true}
    if(-not $held){throw 'watchdog_install_busy'}
    # Every admission check precedes every production write, under the same
    # lease as Check. An immutable path also protects a not-yet-parsed child.
    $c=Get-WatchInstallContext $SourceDirectory $PreparedLauncherPath $PreparedLauncherSha256
    if($ApprovedInstallPlanId -cnotmatch '^[0-9a-f]{64}$' -or $ApprovedInstallPlanId -cne $c.planId){throw 'watchdog_install_plan_changed'}
    $health=Get-WatchSnapshot
    if(-not $health.healthy){throw 'watchdog_install_requires_healthy_status'}
    $again=Get-WatchInstallContext $SourceDirectory $PreparedLauncherPath $PreparedLauncherSha256
    if($again.planId -cne $c.planId){throw 'watchdog_install_plan_changed'}
    if(-not(Test-Path -LiteralPath $c.root)){
      New-Item -ItemType Directory -Path $c.root -Force|Out-Null
      $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
      $acl=[Security.AccessControl.DirectorySecurity]::new();$acl.SetAccessRuleProtection($true,$false);$acl.SetOwner($sid)
      foreach($s in @($sid,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'),[Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))){$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($s,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))}
      Set-Acl -LiteralPath $c.root -AclObject $acl
    }
    Assert-WatchdogInstallRoot $c.root
    $directory=Join-Path $c.root ('versions\'+$c.bundleId)
    Assert-WatchContainedDirectory $c.root $directory
    Assert-WatchContainedDirectory $c.root (Join-Path $c.root 'install-transactions')
    if(-not(Test-Path -LiteralPath $directory)){
      New-Item -ItemType Directory -Path (Join-Path $directory 'watchdog-launcher') -Force|Out-Null
      foreach($name in $c.files.Keys){$source=if($name -eq 'Watchdog.NoConsole.exe'){$c.launcherSource}else{Join-Path $SourceDirectory $name};Copy-Item -LiteralPath $source -Destination (Join-Path $directory $name)}
      Write-WatchJson (Join-Path $directory 'bundle.json') @{version=1;bundleId=$c.bundleId;files=$c.files}
    }
    Assert-WatchBundle $directory $c
    $target=Join-Path $directory 'operations-system-watchdog.ps1';$launcher=Join-Path $directory 'Watchdog.NoConsole.exe'
    $arguments='"'+$PowerShellPath+'" "'+$target+'"'
    $action=New-ScheduledTaskAction -Execute $launcher -WorkingDirectory $c.root -Argument $arguments
    $config=@{version=$WatchdogVersion;layout='immutable-v1';bundleId=$c.bundleId;files=$c.files;scriptSha256=$c.files['operations-system-watchdog.ps1'];transportSha256=$c.files['process-deadline.ps1'];launcherSourceSha256=$c.files['watchdog-launcher\NoConsoleLauncher.cs'];launcherSha256=$c.files['Watchdog.NoConsole.exe'];installedAt=[DateTimeOffset]::UtcNow.ToString('o')}
    $transaction=Join-Path $c.root ('install-transactions\'+[guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $transaction -Force|Out-Null
    if($c.oldBytes){[IO.File]::WriteAllBytes((Join-Path $transaction 'installation.before.json'),$c.oldBytes)}
    if($c.oldXml){[IO.File]::WriteAllText((Join-Path $transaction 'task.before.xml'),$c.oldXml)}
    $journal=@{version=1;planId=$c.planId;bundleId=$c.bundleId;phase='prepared';predecessorInstallationSha256=$c.oldHash;predecessorTaskSha256=$c.oldXmlHash}
    Write-WatchJson (Join-Path $transaction 'journal.json') $journal
    try{
      $expectedConfigHash=Get-WatchTextHash ($config|ConvertTo-Json -Depth 16)
      Write-WatchJson $c.configPath $config
      $newConfigHash=Get-WatchAssetHash $c.configPath
      if($newConfigHash -cne $expectedConfigHash){throw 'installation_write_mismatch'}
      $journal.phase='references_started';Write-WatchJson (Join-Path $transaction 'journal.json') $journal
      if($c.oldTask){Set-ScheduledTask -TaskName $TaskName -Action $action -ErrorAction Stop|Out-Null}else{
        $user=[Security.Principal.WindowsIdentity]::GetCurrent().Name
        $triggers=@((New-ScheduledTaskTrigger -AtLogOn -User $user),(New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)))
        $settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero)
        $principal=New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
        Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers -Settings $settings -Principal $principal -ErrorAction Stop|Out-Null
      }
      Enable-ScheduledTask -TaskName $TaskName -ErrorAction Stop|Out-Null
      $current=Get-ScheduledTask -TaskName $TaskName
      if(-not(Test-WatchTaskAction $current $launcher $arguments $c.root) -or $current.State -eq 'Disabled' -or (Get-WatchAssetHash $c.configPath) -cne $newConfigHash){throw 'task_readback_mismatch'}
      Assert-WatchBundle $directory $c
      $journal.phase='completed';Write-WatchJson (Join-Path $transaction 'journal.json') $journal
      # Do not start a child while holding its lease: the original minute/logon
      # triggers perform the first natural check after the transaction returns.
      return @{status='installed';planId=$c.planId;bundleId=$c.bundleId;cadence='independent_minutely_and_logon';task=$TaskName;firstCheck='next_natural_trigger'}
    }catch{
      $originalFailure=$_; $journal.phase='rollback_started'
      $rollbackStage='inspect_task'
      try{
        $current=Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        $xml=if($current){[string](Export-ScheduledTask -TaskName $TaskName)}else{$null}
        if($current -and $xml -cne $c.oldXml -and -not(Test-WatchTaskAction $current $launcher $arguments $c.root)){throw 'watchdog_rollback_foreign_task'}
        $rollbackStage='restore_task'
        if($c.oldXml -and $xml -cne $c.oldXml){Register-ScheduledTask -TaskName $TaskName -Xml $c.oldXml -Force -ErrorAction Stop|Out-Null}
        elseif(-not $c.oldXml -and $current){Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop|Out-Null}
        $rollbackStage='restore_configuration'
        $currentConfigHash=if(Test-Path -LiteralPath $c.configPath){Get-WatchAssetHash $c.configPath}else{'absent'}
        if($currentConfigHash -cne $c.oldHash -and $currentConfigHash -cne $expectedConfigHash){throw 'watchdog_rollback_foreign_configuration'}
        if($c.oldBytes){Write-WatchExactBytes $c.configPath $c.oldBytes;if((Get-WatchAssetHash $c.configPath) -cne $c.oldHash){throw 'watchdog_rollback_hash_mismatch'}}else{[IO.File]::Delete($c.configPath)}
        $rollbackStage='verify_task'
        if($c.oldXml -and [string](Export-ScheduledTask -TaskName $TaskName) -cne $c.oldXml){throw 'watchdog_rollback_task_mismatch'}
        $journal.phase='rolled_back'
      }catch{
        $journal.phase='rollback_unconfirmed'
        $journal.rollbackStage=$rollbackStage
        $kind=$_.Exception.GetType().Name
        $journal.rollbackErrorType=if($kind -in @('RuntimeException','MethodInvocationException','IOException','UnauthorizedAccessException','ParameterBindingException')){$kind}else{'other'}
        $journal.rollbackCode=if($_.Exception.Message -in @('watchdog_rollback_foreign_task','watchdog_rollback_foreign_configuration','watchdog_rollback_hash_mismatch','watchdog_rollback_task_mismatch')){$_.Exception.Message}else{'rollback_operation_failed'}
        Write-WatchJson (Join-Path $transaction 'journal.json') $journal
        throw 'watchdog_install_rollback_unconfirmed'
      }
      Write-WatchJson (Join-Path $transaction 'journal.json') $journal
      throw $originalFailure
    }
  }finally{if($held){$lease.ReleaseMutex()};$lease.Dispose()}
}
