# Library only. Mechanical safety check for a freshly generated read-only watchdog driver.
# Dot-sourced by operations-system-watchdog.ps1; defines functions and constants, no side effects.
#
# THIS IS A STATIC TRIPWIRE, NOT A PROOF. It parses every script the driver loads and refuses a
# driver whose reachable code contains a primitive that ends a process, deletes/moves/rewrites a
# file, or executes dynamically built code. It does not know which branch runs, so every existing
# hit that is harmless on the Status path is listed in $script:WatchClosureExceptions, pinned to the
# exact text of the hit (whitespace-normalised sha256) and to how many times it occurs in that
# function: an extra or changed occurrence is a violation. Known blind spots are listed in
# docs/watchdog-root-fix-20261112/DESIGN.md (e.g. a process ended through COM/WMI/.NET objects the
# rules below do not name, or a file written through an object method not named below).
#
# What it does:
#  1. Load order: the function table of each profile is built by following the real dot-source
#     sequence from the entry script (control copy, or backend wrapper plus the chosen
#     DiagnosticTarget branch), including dot-sources inside the libraries themselves, so a name
#     defined twice resolves to the definition loaded last.
#  2. Closure: from every statement the loaded scripts execute in that mode (all of the control
#     copy's Status dispatch, including its try/catch/finally; only the other switch branches are
#     left out) it follows command calls through the function table and scans each function.
#  3. Ownership call list: the three ownership-decision functions may only call overlay functions,
#     read-only builtins, or the reviewed library functions listed below.
#
# Output is fixed-enum codes only.

# CIM/WMI mutators are listed whatever method or instance they act on.
$script:WatchClosureProcessCommands=@('stop-process','spps','stop-service','kill','start-process','saps','start','invoke-item','ii','invoke-cimmethod','remove-ciminstance','set-ciminstance','invoke-wmimethod','remove-wmiobject')
$script:WatchClosureDeleteCommands=@('remove-item','ri','rm','rmdir','del','erase','rd','move-item','mi','mv','move','rename-item','ren','rni','clear-content','clc')
$script:WatchClosureWriteCommands=@('set-content','sc','add-content','ac','out-file','new-item','ni','copy-item','cpi','copy','cp')
$script:WatchClosureDynamicCommands=@('invoke-expression','iex','invoke-command','icm')
# Commands that read a function out of the function table by name: `Get-Command Name`, `Get-Item function:Name`.
$script:WatchClosureFunctionLookupCommands=@('get-command','gcm','get-item','gi','get-childitem','gci','dir','ls')
$script:WatchClosureRecordCommands=@('remove-previousbootprocessrecordifsafe','remove-ownsupervisorreceipt')
$script:WatchClosureToolString='(?i)taskkill|\bwmic(\.exe)?\b|\bpskill(\.exe)?\b'
# 'any': a write-class primitive is a hit whatever it writes. 'pid-related': only when the target
# (or its one-step variable source, pipeline upstream, splat table) mentions pid/receipt.
$script:WatchClosureWriteScope='any'
$script:WatchClosurePidWords='(?i)pid|receipt'
# Variables whose dot-source is a load the driver itself declares: variable -> script id.
$script:WatchClosureLoadVariables=@{diagnosticbackend='backend';diagnosticworker='worker';diagnosticsupervisor='supervisor';diagnostictransport='transport';servicescriptpath='backend'}
# Dot-sources of the form . (Join-Path $PSScriptRoot 'x'): the directory a script lives in decides
# which copy of x it gets.
$script:WatchClosureHome=@{
  control=@{'native-isolation.ps1'='isolation';'process-deadline.ps1'='transport'}
  wrapper=@{'watchdog-core-overlay.ps1'='overlay'}
  worker=@{'native-isolation.ps1'='isolation';'process-deadline.ps1'='transport'}
  backend=@{'native-isolation.ps1'='backendIsolation'}
  supervisor=@{'native-isolation.ps1'='backendIsolation'}
}

# Ownership-decision functions (names as defined in the overlay) and what they may call.
# Each is checked in the profile whose loaded libraries it really calls into.
$script:WatchOwnershipFunctions=@{'Resolve-OwnedProcess'='wrapper-backend';'Get-WorkerStatusInternal'='wrapper-worker';'Resolve-SupervisorProcess'='wrapper-supervisor'}
$script:WatchOwnershipBuiltins=@(
  'test-path','convertfrom-json','convertto-json','select-object','where-object','foreach-object','sort-object',
  'measure-object','join-path','split-path','write-output','out-null'
)
# Reviewed 2026-11-12 against the production sources (see DESIGN.md, "Ownership call allow-list").
$script:WatchOwnershipLibraryAllowlist=@(
  'convertto-canonicalcreationdate','get-canonicalpath','read-jsonfile','test-commandlinereferencespath',
  'test-exactstringarray','test-processrecordfrompreviousboot','get-filesha256','get-sha256text',
  'get-creationidentity','get-helperownershipcontext','get-portprocessids','get-processtree','get-uniqueprocess',
  'read-processreceipt','test-allowedtreeprocess','test-monotonicancestor',
  'assert-supervisorexactpropertyset','get-supervisorcanonicalpath'
)

# Existing hits that are harmless on the Status path. Keyed by script id + function + primitive and
# pinned to the normalised text of each hit with its occurrence count. Reasons mirror DESIGN.md.
# Optional $Callsite makes the exception conditional on how the reached closure uses the hit function:
#   target       function whose reached call sites are inspected (all of them, lower-cased compare)
#   parameter    its parameter name; the argument (named, else first positional) must be absent or a
#                string literal listed in `allowed`; variables, splats and other values void the exception
#   onlyCallers  the only functions allowed to call the hit function itself
#   hitParameter parameter of the hit function that must receive a script block literal { ... } at every
#                reached call site (a variable, `${function:X}` or other value voids the exception)
#   pinFunction/pinSha256  a function whose whole definition (parameter defaults and gate included) must
#                keep the pinned text (sha256 of the whitespace-normalised definition)
# Parameter names at call sites are bound like PowerShell does (unique case-insensitive prefix,
# positional by declaration order); anything that cannot be bound with certainty voids the exception.
# A function named without being called (`${function:X}`, Get-Command X, Get-Item function:X) counts as
# a reference site, which also voids any call-site condition on X.
function New-WatchClosureException([string]$Script,[string]$Function,[string]$Primitive,$Pins,[string]$Reason,$Callsite=$null){
  return @{script=$Script;function=$Function;primitive=$Primitive;pins=@($Pins|ForEach-Object {@{sha256=$_[0];count=[int]$_[1]}});reason=$Reason;callsite=$Callsite}
}
$script:WatchClosureExceptions=@(
  (New-WatchClosureException 'transport' 'Invoke-DeadlineProcess' '.kill()' @(,@('9bd9e6f70e013f0bbcc68a2e573f77a8df1be04c2479e4b042f1f7e4ec4c2cb0',1)) 'process-deadline.ps1:192 kills only the Process object it started itself (direct-exit probe), never a looked-up pid'),
  (New-WatchClosureException 'transport' 'Invoke-DeadlineProcess' 'io-delete' @(@('a8bd4f4a40dda2c5dd3f618a1e8540b254b153b163a48c930a84c7514471cd75',1),@('981e51765bcb6e089334a0aa60697e5cbcce5a8da31c6bde42f2cba42790ede4',1)) 'process-deadline.ps1:199-200 removes the probe stdout/stderr scratch files and directory it created'),
  (New-WatchClosureException 'transport' 'Invoke-DeadlineProcess' 'io-write' @(,@('392faf6bc9f5fc69da5ff75cea1182ca3c36f7018872cdd070675105e98a96ef',1)) 'process-deadline.ps1:140 creates its own scratch directory'),
  (New-WatchClosureException 'backend' 'Invoke-BoundedNativeProcess' 'dynamic-call' @(,@('e75ee64698b36b1cc310898df3ed105f7310c402c488044b91cf963bdc45c9d7',1)) 'django-local-service.ps1:300 runs a scriptblock passed by its callers (Test-PostgresReady, Get-FinanceWriteAuthority, Show-AggregateServiceStatus), all read-only probes' @{onlyCallers=@('Show-AggregateServiceStatus','Test-PostgresReady','Get-FinanceWriteAuthority')}),
  (New-WatchClosureException 'backend' 'Invoke-InProcessJsonStatus' 'dynamic-call' @(,@('a66f7ab990955a3983114e79a96cd179b116132e1f363c223b1278c5eecd0357',1)) 'django-local-service.ps1:4867 invokes the status scriptblock handed in by the read-only status action' @{hitParameter='Operation'}),
  (New-WatchClosureException 'backend' 'Invoke-WithDjangoEnvironment' 'dynamic-call' @(,@('a66f7ab990955a3983114e79a96cd179b116132e1f363c223b1278c5eecd0357',1)) 'django-local-service.ps1:3758 invokes the scriptblock handed in after setting the process-local Django environment' @{hitParameter='Operation'}),
  (New-WatchClosureException 'backend' 'Rotate-LauncherLog' 'remove-item' @(,@('d26f00110b4476a5ef49e4731b4cebd3448dbe6fd5f0c5dce04123305652278e',1)) 'django-local-service.ps1:403 drops the oldest rotated launcher log (LauncherLogPath.N), not a pid/receipt file'),
  (New-WatchClosureException 'backend' 'Rotate-LauncherLog' 'move-item' @(@('eaedc45119725c11fdcff6186ecbd83d48f75bd66d60883029a6d92947596415',1),@('54cbdcbb88881fa02f3974b634e1436ba507ed4b1beb4a9d2ada7216a3cb1d19',1)) 'django-local-service.ps1:405,409 rotate launcher log files'),
  (New-WatchClosureException 'backend' 'Write-LauncherEvent' 'io-write' @(,@('a017f5b007d3beec5cdc7af93b16967f0e125b5c06adf8928b953689eaffccea',1)) 'django-local-service.ps1:424 appends one line to the launcher log'),
  (New-WatchClosureException 'overlay' 'Invoke-ReadonlyMetadataObservation' 'dynamic-call' @(,@('ef292c89b41eeff5952c89c3a664b83d9dca67ed4a40d5a09046d98667b0be88',1)) 'overlay :246 runs the scriptblock of a read-only metadata observation (callers are overlay functions)' @{hitParameter='ReadStatus'}),
  (New-WatchClosureException 'supervisor' 'Move-SupervisorStatePreviousGeneration' 'move-item' @(,@('874defdb43814757434d94222cd6b21e95efd306129288b23e3be9f434c95fc0',1)) 'django-runtime-supervisor.ps1:364 archives state.json, reached only through Read-SupervisorState behind the Mode gate (:327, ArchivePreviousStopped); the sole caller passing it is Invoke-SupervisorRun (:832), the watchdog status block passes AllowPreviousStopped (:1140)' @{target='Read-SupervisorState';parameter='Mode';allowed=@('Strict','AllowPreviousStopped');onlyCallers=@('Read-SupervisorState');pinFunction='Read-SupervisorState';pinSha256='8473c0eb5138591f9f66c0373b13ebb324c4997007a795ff44d2a29672fd3a85'}),
  (New-WatchClosureException 'backend' 'Write-LauncherEvent' 'new-item' @(,@('8803831504c8e6e4f2866f9bf0f622248aefaf9083603afad607ccd313fe2133',1)) 'django-local-service.ps1:414 makes sure the launcher log directory exists before appending one line')
)

function Get-WatchClosureAst([string]$Path){
  $tokens=$null;$errors=$null
  $ast=[Management.Automation.Language.Parser]::ParseFile([IO.Path]::GetFullPath($Path),[ref]$tokens,[ref]$errors)
  if(@($errors).Count){throw 'closure_parse_failed'}
  return $ast
}
function Find-WatchClosureNodes($Node,[type]$Type){
  return @($Node.FindAll([Func[Management.Automation.Language.Ast,bool]]{param($n) $n -is $Type},$true))
}
function Get-WatchClosureNodeHash($Node){
  $text=([regex]::Replace($Node.Extent.Text,'\s+',' ')).Trim()
  $sha=[Security.Cryptography.SHA256]::Create()
  try{return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($text)))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
}
function Test-WatchClosureExcluded($Node,$Excluded){
  foreach($e in @($Excluded)){if($Node.Extent.StartOffset -ge $e.start -and $Node.Extent.EndOffset -le $e.end){return $true}}
  return $false
}
function Test-WatchClosureTargetsPid($Node){
  # Only used when WriteScope is 'pid-related'. Target text, pipeline upstream, one-step variable
  # sources and splat tables are examined.
  $texts=[Collections.Generic.List[string]]::new()
  if($Node -is [Management.Automation.Language.CommandAst]){
    foreach($e in @($Node.CommandElements|Select-Object -Skip 1)){$texts.Add($e.Extent.Text)}
    if($Node.Parent -is [Management.Automation.Language.PipelineAst]){
      foreach($el in $Node.Parent.PipelineElements){if([object]::ReferenceEquals($el,$Node)){break};$texts.Add($el.Extent.Text)}
    }
  }elseif($Node -is [Management.Automation.Language.FileRedirectionAst]){$texts.Add($Node.Location.Extent.Text)}
  elseif($Node -is [Management.Automation.Language.InvokeMemberExpressionAst]){foreach($a in @($Node.Arguments)){$texts.Add($a.Extent.Text)};$texts.Add($Node.Expression.Extent.Text)}
  $scope=$Node.Parent
  while($scope -and $scope -isnot [Management.Automation.Language.FunctionDefinitionAst] -and $scope -isnot [Management.Automation.Language.ScriptBlockAst]){$scope=$scope.Parent}
  while($scope -is [Management.Automation.Language.ScriptBlockAst] -and $scope.Parent){$scope=$scope.Parent;while($scope -and $scope -isnot [Management.Automation.Language.FunctionDefinitionAst] -and $scope -isnot [Management.Automation.Language.ScriptBlockAst]){$scope=$scope.Parent}}
  $names=[regex]::Matches(($texts -join "`n"),'[\$@]\{?(\w+)\}?')|ForEach-Object {$_.Groups[1].Value}
  if($scope){
    foreach($assign in (Find-WatchClosureNodes $scope ([Management.Automation.Language.AssignmentStatementAst]))){
      $left=$assign.Left.Extent.Text.TrimStart('$').Trim('{','}')
      if($left -in $names){$texts.Add($assign.Right.Extent.Text)}
    }
  }
  return (($texts -join "`n") -match $script:WatchClosurePidWords)
}
function Resolve-WatchClosureLoad($Command,[string]$Id){
  $first=$Command.CommandElements[0]
  if($first -is [Management.Automation.Language.ParenExpressionAst] -and $first.Extent.Text -cmatch '^\(\s*Join-Path\s+\$PSScriptRoot\s+["''](?<file>[^"'']+)["'']\s*\)$'){
    $map=$script:WatchClosureHome[$Id]
    if($map){return $map[$Matches['file'].ToLowerInvariant()]}
    return $null
  }
  if($first -is [Management.Automation.Language.VariableExpressionAst]){return $script:WatchClosureLoadVariables[$first.VariablePath.UserPath.ToLowerInvariant()]}
  return $null
}
function Get-WatchClosureExecuted($Ast,[string]$Id,[string]$Entry){
  # The statements dot-sourcing script $Id really runs in the driver's mode, in order. Functions are
  # kept (they define names at their position); library-mode-gated action dispatch is left out.
  $out=[Collections.Generic.List[object]]::new()
  foreach($s in @($Ast.EndBlock.Statements)){
    if($s -is [Management.Automation.Language.FunctionDefinitionAst]){$out.Add(@{node=$s;label='<function>';excluded=@()});continue}
    if($s -is [Management.Automation.Language.IfStatementAst]){
      $condition=$s.Clauses[0].Item1.Extent.Text
      if($Id -ceq 'worker' -and $condition -cmatch '^\$FunctionsOnly$' -and $s.Extent.Text -cmatch '^if\s*\(\s*\$FunctionsOnly\s*\)\s*\{\s*return\s*\}$'){break}
      if($Id -ceq 'worker' -and $condition -cmatch '-not\s+\$FunctionsOnly'){continue}
      if($Id -ceq 'backend' -and $condition -cmatch 'TERUISI_DJANGO_SERVICE_LIBRARY_ONLY\s+-ne\s+"1"'){continue}
      if($Id -ceq 'supervisor' -and $condition -cmatch '\$librarySupervisorMode'){continue}
      if($Id -ceq 'control' -and $condition -cmatch '^\$Action\s+-ne\s+"Panel"$'){
        # The whole dispatcher, try/catch/finally included, minus the switch branches other than Status.
        $switch=@(Find-WatchClosureNodes $s ([Management.Automation.Language.SwitchStatementAst]))|Select-Object -First 1
        if(-not $switch){throw 'closure_entry_missing'}
        $status=@($switch.Clauses|Where-Object {$_.Item1.Extent.Text.Trim('"',"'") -ceq 'Status'})
        if($status.Count -ne 1){throw 'closure_entry_missing'}
        $excluded=@($switch.Clauses|Where-Object {$_.Item1.Extent.Text.Trim('"',"'") -cne 'Status'}|ForEach-Object {@{start=$_.Item2.Extent.StartOffset;end=$_.Item2.Extent.EndOffset}})
        if($switch.Default){$excluded+=@(@{start=$switch.Default.Extent.StartOffset;end=$switch.Default.Extent.EndOffset})}
        $out.Add(@{node=$s;label='<status-dispatch>';excluded=$excluded})
        break # everything after it is the interactive panel
      }
      if($Id -ceq 'wrapper' -and $condition -cmatch "^\`$DiagnosticTarget\s+-eq\s+'Supervisor'$"){
        if($s.Clauses.Count -ne 2 -or -not $s.ElseClause){throw 'closure_entry_missing'}
        $body=switch($Entry){
          'wrapper-supervisor'{$s.Clauses[0].Item2}
          'wrapper-worker'{$s.Clauses[1].Item2}
          'wrapper-backend'{$s.ElseClause}
          default{throw 'closure_entry_missing'}
        }
        $out.Add(@{node=$body;label='<'+$Entry+'>';excluded=@()})
        continue
      }
    }
    $out.Add(@{node=$s;label='<top-level>';excluded=@()})
  }
  return ,$out.ToArray()
}
function Add-WatchClosureScript($State,[string]$Id,[int]$Depth){
  # Executes script $Id: defines its functions in order, records its statements as scan roots and
  # follows each dot-source where it occurs, so the last definition of a name wins as in PowerShell.
  if($Depth -gt 6){throw 'closure_entry_missing'}
  $State.order.Add($Id)
  foreach($item in (Get-WatchClosureExecuted $State.asts[$Id] $Id $State.entry)){
    if($item.node -is [Management.Automation.Language.FunctionDefinitionAst]){$State.table[$item.node.Name.ToLowerInvariant()]=@{ast=$item.node;script=$Id};continue}
    if($State.keys.Add("$Id|$($item.node.Extent.StartOffset)")){$State.roots.Add(@{node=$item.node;script=$Id;function=$item.label;excluded=$item.excluded})}
    $dots=@(Find-WatchClosureNodes $item.node ([Management.Automation.Language.CommandAst])|Where-Object {$_.InvocationOperator -eq [Management.Automation.Language.TokenKind]::Dot -and -not (Test-WatchClosureExcluded $_ $item.excluded)}|Sort-Object {$_.Extent.StartOffset})
    foreach($d in $dots){
      $target=Resolve-WatchClosureLoad $d $Id
      if($target -and $State.asts.ContainsKey($target)){Add-WatchClosureScript $State $target ($Depth+1)}
    }
  }
}
function Get-WatchClosureExecution($Spec,$Asts){
  $state=@{asts=$Asts;entry=$Spec.entry;table=@{};roots=[Collections.Generic.List[object]]::new();keys=[Collections.Generic.HashSet[string]]::new();order=[Collections.Generic.List[string]]::new()}
  Add-WatchClosureScript $state $Spec.root 0
  return @{table=$state.table;roots=$state.roots.ToArray();order=$state.order.ToArray()}
}
function Get-WatchClosureProfileSpecs {
  return @(
    @{name='control';entry='control';root='control'},
    @{name='wrapper-backend';entry='wrapper-backend';root='wrapper'},
    @{name='wrapper-worker';entry='wrapper-worker';root='wrapper'},
    @{name='wrapper-supervisor';entry='wrapper-supervisor';root='wrapper'}
  )
}
function Get-WatchClosureScan($Node,[string]$Script,[string]$Function,$Spec,$Table,$Asts,$Excluded){
  # Returns @{hits=@(...);calls=@(function names)} for one function body or root statement.
  $hits=[Collections.Generic.List[object]]::new();$calls=[Collections.Generic.List[string]]::new();$sites=[Collections.Generic.List[object]]::new()
  $add={param($primitive,$ast) $hits.Add(@{profile=$Spec.name;script=$Script;function=$Function;primitive=$primitive;line=$ast.Extent.StartLineNumber;sha=(Get-WatchClosureNodeHash $ast)})}
  $addWrite={param($primitive,$ast) if($script:WatchClosureWriteScope -ne 'pid-related' -or (Test-WatchClosureTargetsPid $ast)){&$add $primitive $ast}}
  # A function named without being called (`${function:X}`, `Get-Command X`, `Get-Item function:X`) can be
  # invoked later, so it counts as a call to X; a name that is itself a forbidden primitive is a hit.
  $reference={param($refName,$ast)
    $l=([string]$refName).ToLowerInvariant()
    if($Table.ContainsKey($l)){$calls.Add($l);$sites.Add(@{name=$l;caller=$Function;ast=$ast;reference=$true})}
    if($l -in $script:WatchClosureProcessCommands -or $l -in $script:WatchClosureDeleteCommands -or $l -in $script:WatchClosureDynamicCommands -or $l -in $script:WatchClosureRecordCommands){&$add $l $ast}
    elseif($l -in $script:WatchClosureWriteCommands){&$addWrite $l $ast}
  }
  $T=[Management.Automation.Language.CommandAst]
  foreach($c in (Find-WatchClosureNodes $Node $T)){
    if(Test-WatchClosureExcluded $c $Excluded){continue}
    $name=$c.GetCommandName();$first=$c.CommandElements[0]
    if($c.InvocationOperator -eq [Management.Automation.Language.TokenKind]::Dot){
      $target=Resolve-WatchClosureLoad $c $Script
      if(-not ($target -and $Asts.ContainsKey($target))){&$add 'dynamic-call' $c}
      continue
    }
    if($null -eq $name){
      if($first -isnot [Management.Automation.Language.ScriptBlockExpressionAst]){&$add 'dynamic-call' $c}
      continue
    }
    $lower=$name.ToLowerInvariant()
    if($Table.ContainsKey($lower)){$calls.Add($lower);$sites.Add(@{name=$lower;caller=$Function;ast=$c})}
    if($lower -in $script:WatchClosureFunctionLookupCommands){
      $isCommand=$lower -in @('get-command','gcm')
      foreach($e in @($c.CommandElements|Select-Object -Skip 1)){
        if($e -is [Management.Automation.Language.CommandParameterAst]){continue}
        $literal=if($e -is [Management.Automation.Language.StringConstantExpressionAst]){[string]$e.Value}else{$null}
        if($null -ne $literal){
          if($isCommand){&$reference $literal $c}
          elseif($literal -imatch '^function:(?<n>.+)$'){&$reference $Matches['n'] $c}
        }elseif(-not $isCommand -and $e.Extent.Text -imatch 'function:'){&$add 'dynamic-call' $c}
        elseif($isCommand){
          # (Get-Command $x).ScriptBlock hands a function body to the caller.
          $up=$c.Parent;while($up -and $up -isnot [Management.Automation.Language.MemberExpressionAst] -and ($up -isnot [Management.Automation.Language.StatementAst] -or $up -is [Management.Automation.Language.PipelineBaseAst])){$up=$up.Parent}
          if($up -is [Management.Automation.Language.MemberExpressionAst] -and $up.Member.Extent.Text -imatch '^ScriptBlock$'){&$add 'dynamic-call' $c}
        }
      }
    }
    if($lower -in $script:WatchClosureProcessCommands -or $lower -in $script:WatchClosureDeleteCommands -or $lower -in $script:WatchClosureDynamicCommands -or $lower -in $script:WatchClosureRecordCommands){&$add $lower $c}
    elseif($lower -in $script:WatchClosureWriteCommands){&$addWrite $lower $c}
    elseif($lower -ceq 'tee-object' -and @($c.CommandElements|Where-Object {$_ -is [Management.Automation.Language.CommandParameterAst] -and $_.ParameterName -imatch '^v'}).Count -eq 0){&$addWrite 'tee-object' $c}
  }
  foreach($m in (Find-WatchClosureNodes $Node ([Management.Automation.Language.InvokeMemberExpressionAst]))){
    if(Test-WatchClosureExcluded $m $Excluded){continue}
    $member=if($m.Member -is [Management.Automation.Language.StringConstantExpressionAst]){$m.Member.Value}else{$null}
    if($null -eq $member){&$add 'dynamic-member' $m;continue}
    $lm=$member.ToLowerInvariant()
    $type=if($m.Static -and $m.Expression -is [Management.Automation.Language.TypeExpressionAst]){$m.Expression.TypeName.FullName}else{''}
    if($lm -in @('kill','terminate')){&$add '.kill()' $m;continue}
    if($lm -in @('invokescript','addscript')){&$add 'dynamic-exec' $m;continue}
    if($type -imatch '^(System\.Management\.Automation\.)?PowerShell$' -and $lm -ceq 'create'){&$add 'dynamic-exec' $m;continue}
    if($type -imatch '^(System\.Management\.Automation\.Runspaces\.)?RunspaceFactory$'){&$add 'dynamic-exec' $m;continue}
    if($type -imatch '^(System\.)?Diagnostics\.Process$' -and $lm -ceq 'start'){&$add 'process-start' $m;continue}
    if($type -imatch '^(System\.Management\.Automation\.)?ScriptBlock$' -and $lm -ceq 'create'){&$add 'dynamic-exec' $m;continue}
    if($type -imatch '^(System\.)?IO\.(File|Directory)$'){
      if($lm -cmatch '^(delete|move|replace)$'){&$add ('io-'+$lm) $m}
      elseif($lm -cmatch '^(write\w*|append\w*|create\w*)$'){&$addWrite ('io-write') $m}
      continue
    }
    if(-not $m.Static -and $lm -cmatch '^(delete|moveto)$'){&$add ('.'+$lm+'()') $m}
  }
  $strings=@(Find-WatchClosureNodes $Node ([Management.Automation.Language.StringConstantExpressionAst]))
  $strings+=@(Find-WatchClosureNodes $Node ([Management.Automation.Language.ExpandableStringExpressionAst]))
  foreach($s in $strings){
    if(Test-WatchClosureExcluded $s $Excluded){continue}
    if(([string]$s.Value) -match $script:WatchClosureToolString){&$add 'process-tool-string' $s}
  }
  foreach($v in (Find-WatchClosureNodes $Node ([Management.Automation.Language.VariableExpressionAst]))){
    if(Test-WatchClosureExcluded $v $Excluded){continue}
    if($v.VariablePath.UserPath -ieq 'ExecutionContext'){&$add 'dynamic-exec' $v}
    if($v.VariablePath.UserPath -imatch '^function:(?<n>.+)$'){&$reference $Matches['n'] $v}
  }
  foreach($r in (Find-WatchClosureNodes $Node ([Management.Automation.Language.FileRedirectionAst]))){
    if(Test-WatchClosureExcluded $r $Excluded){continue}
    if($r.Location.Extent.Text.Trim() -ine '$null'){&$addWrite 'redirect' $r}
  }
  return @{hits=$hits.ToArray();calls=$calls.ToArray();sites=$sites.ToArray()}
}
function Resolve-WatchClosureArgument($Site,$FunctionAst,[string]$Parameter){
  # Binds the arguments of one call site to the declared parameters of the called function the way
  # PowerShell does for plain calls: named arguments by case-insensitive unique prefix, the rest by
  # position in declaration order. Returns @{ok;present;value}; ok=$false means it cannot be bound
  # with certainty (splat, unknown/ambiguous parameter), which callers treat as a violation.
  $unresolved=@{ok=$false;present=$false;value=$null}
  $declared=@(if($FunctionAst.Parameters){$FunctionAst.Parameters}elseif($FunctionAst.Body.ParamBlock){$FunctionAst.Body.ParamBlock.Parameters})
  $names=@($declared|ForEach-Object {[string]$_.Name.VariablePath.UserPath})
  if($site.reference){return $unresolved}
  $elements=@($Site.ast.CommandElements|Select-Object -Skip 1)
  $bound=@{};$consumed=@{}
  for($i=0;$i -lt $elements.Count;$i++){
    $e=$elements[$i]
    if($e -is [Management.Automation.Language.VariableExpressionAst] -and $e.Splatted){return $unresolved}
    if($e -isnot [Management.Automation.Language.CommandParameterAst]){continue}
    $exact=@($names|Where-Object {$_ -ieq $e.ParameterName})
    $matches2=@(if($exact.Count -eq 1){$exact}else{$names|Where-Object {$_.StartsWith($e.ParameterName,[StringComparison]::OrdinalIgnoreCase)}})
    if($matches2.Count -ne 1){return $unresolved}
    $consumed[$i]=1
    if($e.Argument){$bound[$matches2[0]]=$e.Argument}
    elseif($i+1 -lt $elements.Count -and $elements[$i+1] -isnot [Management.Automation.Language.CommandParameterAst]){$bound[$matches2[0]]=$elements[$i+1];$consumed[$i+1]=1}
    else{$bound[$matches2[0]]=$null}
  }
  $free=@($names|Where-Object {-not $bound.ContainsKey($_)})
  $slot=0
  for($i=0;$i -lt $elements.Count;$i++){
    if($consumed.ContainsKey($i) -or $elements[$i] -is [Management.Automation.Language.CommandParameterAst]){continue}
    if($slot -ge $free.Count){return $unresolved}
    $bound[$free[$slot]]=$elements[$i];$slot++
  }
  $key=@($names|Where-Object {$_ -ieq $Parameter})
  if($key.Count -ne 1){return $unresolved}
  return @{ok=$true;present=$bound.ContainsKey($key[0]);value=$bound[$key[0]]}
}
# Conditional exceptions (see New-WatchClosureException). True only when every reached call site and
# the pinned function text keep the conditions the exception's reason depends on.
function Test-WatchClosureCallsite($Constraint,$Entry,$Table,$Sites){
  $hitFunction=([string]$Entry.function).ToLowerInvariant()
  $target=if($Constraint.target){([string]$Constraint.target).ToLowerInvariant()}else{$null}
  $allowedCallers=@($Constraint.onlyCallers|ForEach-Object {([string]$_).ToLowerInvariant()})
  foreach($site in $Sites){
    if($site.name -ceq $hitFunction){
      if($Constraint.onlyCallers -and ([string]$site.caller).ToLowerInvariant() -cnotin $allowedCallers){return $false}
      if($Constraint.hitParameter){
        $a=Resolve-WatchClosureArgument $site $Table[$hitFunction].ast ([string]$Constraint.hitParameter)
        if(-not $a.ok -or -not $a.present -or $a.value -isnot [Management.Automation.Language.ScriptBlockExpressionAst]){return $false}
      }
    }
    if($target -and $site.name -ceq $target){
      $a=Resolve-WatchClosureArgument $site $Table[$target].ast ([string]$Constraint.parameter)
      if(-not $a.ok){return $false}
      if($a.present){
        if($a.value -isnot [Management.Automation.Language.StringConstantExpressionAst]){return $false}
        if([string]$a.value.Value -cnotin @($Constraint.allowed)){return $false}
      }
    }
  }
  if($Constraint.pinFunction){
    $pinned=$Table[([string]$Constraint.pinFunction).ToLowerInvariant()]
    if(-not $pinned){return $false}
    return ((Get-WatchClosureNodeHash $pinned.ast) -ceq [string]$Constraint.pinSha256)
  }
  return $true
}
function Test-WatchClosureOwnership($Table,[string[]]$Names){
  # Names of unlisted commands are kept for local diagnosis only; callers report the enum code.
  $problems=[Collections.Generic.List[string]]::new()
  foreach($name in $Names){
    $entry=$Table[$name.ToLowerInvariant()]
    if(-not $entry -or $entry.script -cne 'overlay'){$problems.Add('ownership_function_missing');continue}
    foreach($c in (Find-WatchClosureNodes $entry.ast.Body ([Management.Automation.Language.CommandAst]))){
      $called=$c.GetCommandName()
      if($null -eq $called){$problems.Add('ownership_dynamic_call');continue}
      $lower=$called.ToLowerInvariant()
      if($Table.ContainsKey($lower)){
        if($Table[$lower].script -cne 'overlay' -and $lower -cnotin $script:WatchOwnershipLibraryAllowlist){$problems.Add('ownership_unlisted_command');$script:WatchClosureLastUnlisted+=@($name+': '+$called)}
      }elseif($lower -cnotin $script:WatchOwnershipBuiltins -and $lower -cnotmatch '^get-'){$problems.Add('ownership_unlisted_command');$script:WatchClosureLastUnlisted+=@($name+': '+$called)}
    }
  }
  return @($problems|Sort-Object -Unique)
}
function Test-WatchClosureException($Group,$Exceptions){
  # An exception covers exactly the pinned hits: same text, same number of occurrences.
  $key=$Group.Name
  $entry=@($Exceptions|Where-Object {("$($_.script)|$($_.function)|$($_.primitive)").ToLowerInvariant() -ceq $key})|Select-Object -First 1
  if(-not $entry){return $false}
  $seen=@{};foreach($h in $Group.Group){$seen[$h.sha]=1+[int]$seen[$h.sha]}
  $pins=@($entry.pins)
  if($seen.Count -ne $pins.Count){return $false}
  foreach($pin in $pins){if([int]$seen[[string]$pin.sha256] -ne [int]$pin.count){return $false}}
  return $true
}
function Invoke-WatchDriverClosureCheck([string]$DriverDirectory,[string]$SourcesDirectory,$Exceptions=$null){
  # Returns @{ok=bool;reasons=@(fixed enum);hits=@(unexcepted hits);excepted=<count>}.
  if($null -eq $Exceptions){$Exceptions=$script:WatchClosureExceptions}
  $files=@{
    control=(Join-Path $DriverDirectory 'watchdog-status-control.ps1');wrapper=(Join-Path $DriverDirectory 'watchdog-status-backend.ps1');overlay=(Join-Path $DriverDirectory 'watchdog-core-overlay.ps1')
  }
  foreach($id in @('transport','isolation','backendIsolation','backend','worker','supervisor')){$files[$id]=Join-Path $SourcesDirectory ($id+'.ps1')}
  $asts=@{}
  try{foreach($id in $files.Keys){$asts[$id]=Get-WatchClosureAst $files[$id]}}catch{return @{ok=$false;reasons=@('closure_parse_failed');hits=@();excepted=0}}
  $reasons=[Collections.Generic.List[string]]::new();$violations=@{};$excepted=0
  try{
    # Local diagnosis only (tests, design notes): unlisted command names, reached function sets, load order.
    $script:WatchClosureLastUnlisted=@();$script:WatchClosureReached=@{};$script:WatchClosureLoadOrder=@{};$script:WatchClosureSites=@{}
    foreach($spec in (Get-WatchClosureProfileSpecs)){
      $exec=Get-WatchClosureExecution $spec $asts
      $table=$exec.table;$script:WatchClosureLoadOrder[$spec.name]=$exec.order
      foreach($problem in (Test-WatchClosureOwnership $table @($script:WatchOwnershipFunctions.Keys|Where-Object {$script:WatchOwnershipFunctions[$_] -ceq $spec.name}))){$reasons.Add($problem)}
      $seen=[Collections.Generic.HashSet[string]]::new();$queue=[Collections.Generic.Queue[object]]::new()
      foreach($root in $exec.roots){$queue.Enqueue($root)}
      $script:WatchClosureReached[$spec.name]=$seen
      $sites=[Collections.Generic.List[object]]::new();$conditional=[Collections.Generic.List[object]]::new()
      $script:WatchClosureSites[$spec.name]=$sites
      while($queue.Count){
        $item=$queue.Dequeue()
        $scan=Get-WatchClosureScan $item.node $item.script $item.function $spec $table $asts $item.excluded
        foreach($s in $scan.sites){$sites.Add($s)}
        foreach($g in @($scan.hits|Group-Object {"$($_.script)|$($_.function)|$($_.primitive)".ToLowerInvariant()})){
          if(Test-WatchClosureException $g $Exceptions){
            $entry=@($Exceptions|Where-Object {("$($_.script)|$($_.function)|$($_.primitive)").ToLowerInvariant() -ceq $g.Name})|Select-Object -First 1
            if($entry.callsite){$conditional.Add(@{group=$g;entry=$entry});continue}
            $excepted+=$g.Count;continue
          }
          foreach($h in $g.Group){$violations["$($spec.name)|$($g.Name)|$($h.line)|$($h.sha)"]=$h}
        }
        foreach($call in $scan.calls){
          if($seen.Add($call)){$entry=$table[$call];$queue.Enqueue(@{node=$entry.ast.Body;script=$entry.script;function=$entry.ast.Name;excluded=@()})}
        }
      }
      # Conditional exceptions hold only while every reached call site keeps their condition.
      foreach($c in $conditional){
        if(Test-WatchClosureCallsite $c.entry.callsite $c.entry $table $sites){$excepted+=$c.group.Count}
        else{foreach($h in $c.group.Group){$violations["$($spec.name)|$($c.group.Name)|$($h.line)|$($h.sha)"]=$h}}
      }
    }
  }catch{
    $script:WatchClosureLastError=($_.Exception.Message+' @'+$_.InvocationInfo.ScriptLineNumber)
    return @{ok=$false;reasons=@('closure_analysis_failed');hits=@();excepted=$excepted}
  }
  if($violations.Count){$reasons.Add('closure_forbidden_primitive')}
  return @{ok=($reasons.Count -eq 0);reasons=@($reasons|Sort-Object -Unique);hits=@($violations.Values|Sort-Object {$_.profile},{$_.script},{$_.function},{$_.primitive},{$_.line});excepted=$excepted}
}
