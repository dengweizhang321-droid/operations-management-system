# Library only. Mechanical safety check for a freshly generated read-only watchdog driver.
# Dot-sourced by operations-system-watchdog.ps1; defines functions and constants, no side effects.
#
# The driver must observe, never change, the production services. The generator's own proof
# already guarantees the rewritten ownership functions equal the production originals minus a
# fixed set of delete branches. This file adds the two checks the proof cannot give:
#
#  1. Transitive closure: every function reachable from the driver entry points (control copy
#     Status branch, the three DiagnosticTarget branches of the backend wrapper, plus the
#     top-level statements each loaded library really runs in that mode) is scanned, with the
#     PowerShell parser, for primitives that end a process or delete/rewrite a process record.
#     Static analysis does not know which branch runs, so a hit that exists in a branch the
#     Status path cannot reach must be listed in $script:WatchClosureExceptions with a reason.
#     The same list covers dynamic calls the parser cannot resolve.
#  2. Call list: the three ownership-decision functions may only call overlay functions,
#     read-only builtins, or the reviewed library functions listed below. A new name means the
#     decision logic started calling code nobody reviewed, which needs a human.
#
# Every exception and allow-list entry is recorded with its reason in
# docs/watchdog-root-fix-20261112/DESIGN.md. Output of the check is fixed-enum codes only.

$script:WatchClosureForbiddenCommands=@(
  'stop-process','taskkill','taskkill.exe','stop-service','kill','spps','invoke-cimmethod','remove-ciminstance',
  'remove-previousbootprocessrecordifsafe','remove-ownsupervisorreceipt','invoke-expression','iex'
)
# Commands that rewrite or delete files: forbidden only when aimed at a process record.
$script:WatchClosureFileCommands=@(
  'remove-item','ri','rm','rmdir','del','erase','rd','move-item','mi','mv','move','rename-item','ren','rni',
  'set-content','sc','add-content','ac','clear-content','clc','out-file','copy-item','cpi','cp','copy','new-item','ni','set-itemproperty','sp'
)
$script:WatchClosurePidTarget='(?i)(\$(?:script:|global:)?\w*pidpath\b|\.pid\.json|pid\.json)'
$script:WatchClosureStaticFileMembers='^(?i:Delete|Move|Replace|Write\w*|Create\w*|Append\w*)$'
$script:WatchClosureKillMembers=@('kill','terminate')
# Variables whose dot-source is a load the driver itself declares: variable -> script id.
$script:WatchClosureLoadVariables=@{diagnosticbackend='backend';diagnosticworker='worker';diagnosticsupervisor='supervisor';diagnostictransport='transport';servicescriptpath='backend'}
$script:WatchClosureLoadFiles=@{'native-isolation.ps1'=@('isolation','backendIsolation');'process-deadline.ps1'=@('transport');'watchdog-core-overlay.ps1'=@('overlay')}

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

# Existing hits the Status path cannot reach or that only touch the process this call spawned.
# Keyed by script id + function + primitive. Reasons are mirrored in DESIGN.md.
$script:WatchClosureExceptions=@(
  @{script='transport';function='Invoke-DeadlineProcess';primitive='.Kill()';reason='kills only the child this very call spawned, and only when -Cleanup Direct and the deadline or transport failed; the handle comes from [Teruisi.DeadlineProcess]::Start in the same function (process-deadline.ps1:192)'},
  @{script='backend';function='Invoke-BoundedNativeProcess';primitive='dynamic-call';reason='runs a fixed native executable (pg_isready, the pinned Python for read-only status probes) that the production Status path already runs; none of the reachable callers passes a process-ending tool (django-local-service.ps1:300, callers Test-PostgresReady, Get-FinanceWriteAuthority, Show-AggregateServiceStatus)'},
  @{script='backend';function='Invoke-InProcessJsonStatus';primitive='dynamic-call';reason='invokes a script block parameter; the only reachable call sites pass literal Show-ServiceStatus/Show-FinanceServiceStatus blocks, which are scanned as part of the caller (django-local-service.ps1:4867)'},
  @{script='backend';function='Invoke-WithDjangoEnvironment';primitive='dynamic-call';reason='invokes a script block parameter; the only reachable call site (Get-FinanceWriteAuthority) passes a literal block that runs one read-only authority query, and that block is scanned as part of the caller (django-local-service.ps1:3758)'},
  @{script='overlay';function='Invoke-ReadonlyMetadataObservation';primitive='dynamic-call';reason='invokes the read-status script block handed in by the generated wrapper; the wrapper call sites are literal blocks scanned as wrapper entry statements (overlay line 246)'}
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
function Get-WatchClosureTopLevel($Ast,[string]$Id){
  # The statements dot-sourcing the script really runs in library mode. Function definitions are
  # in the function table; action dispatch behind a library-mode gate is excluded.
  $result=[Collections.Generic.List[object]]::new()
  foreach($statement in @($Ast.EndBlock.Statements)){
    if($statement -is [Management.Automation.Language.FunctionDefinitionAst]){continue}
    if($statement -is [Management.Automation.Language.IfStatementAst]){
      $condition=$statement.Clauses[0].Item1.Extent.Text
      if($Id -ceq 'worker' -and $condition -cmatch '^\$FunctionsOnly$' -and $statement.Extent.Text -cmatch '^if\s*\(\s*\$FunctionsOnly\s*\)\s*\{\s*return\s*\}$'){break}
      if($Id -ceq 'worker' -and $condition -cmatch '-not\s+\$FunctionsOnly'){continue}
      if($Id -ceq 'backend' -and $condition -cmatch 'TERUISI_DJANGO_SERVICE_LIBRARY_ONLY\s+-ne\s+"1"'){continue}
      if($Id -ceq 'supervisor' -and $condition -cmatch '\$librarySupervisorMode'){continue}
    }
    $result.Add($statement)
  }
  return ,$result.ToArray()
}
function Get-WatchClosureEntryRoots($Spec,$Asts){
  $roots=[Collections.Generic.List[object]]::new()
  foreach($id in @($Spec.scripts)){
    if($id -in @('control','wrapper')){continue}
    foreach($s in (Get-WatchClosureTopLevel $Asts[$id] $id)){$roots.Add(@{node=$s;script=$id;function='<top-level>'})}
  }
  if($Spec.entry -ceq 'control'){
    foreach($s in @($Asts.control.EndBlock.Statements)){
      if($s -is [Management.Automation.Language.FunctionDefinitionAst]){continue}
      if($s -is [Management.Automation.Language.IfStatementAst] -and $s.Clauses[0].Item1.Extent.Text -cmatch '^\$Action\s+-ne\s+"Panel"$'){
        $switch=@(Find-WatchClosureNodes $s ([Management.Automation.Language.SwitchStatementAst]))|Select-Object -First 1
        if(-not $switch){throw 'closure_entry_missing'}
        $status=@($switch.Clauses|Where-Object {$_.Item1.Extent.Text.Trim('"',"'") -ceq 'Status'})
        if($status.Count -ne 1){throw 'closure_entry_missing'}
        $roots.Add(@{node=$status[0].Item2;script='control';function='<status-branch>'})
        break
      }
      $roots.Add(@{node=$s;script='control';function='<top-level>'})
    }
    return ,$roots.ToArray()
  }
  $branchIf=$null
  foreach($s in @($Asts.wrapper.EndBlock.Statements)){
    if($s -is [Management.Automation.Language.FunctionDefinitionAst]){continue}
    if($s -is [Management.Automation.Language.IfStatementAst] -and $s.Clauses[0].Item1.Extent.Text -cmatch "^\`$DiagnosticTarget\s+-eq\s+'Supervisor'$"){$branchIf=$s;continue}
    $roots.Add(@{node=$s;script='wrapper';function='<top-level>'})
  }
  if(-not $branchIf -or $branchIf.Clauses.Count -ne 2 -or -not $branchIf.ElseClause){throw 'closure_entry_missing'}
  $body=switch($Spec.entry){
    'wrapper-supervisor'{$branchIf.Clauses[0].Item2}
    'wrapper-worker'{$branchIf.Clauses[1].Item2}
    'wrapper-backend'{$branchIf.ElseClause}
    default{throw 'closure_entry_missing'}
  }
  $roots.Add(@{node=$body;script='wrapper';function='<'+$Spec.entry+'>'})
  return ,$roots.ToArray()
}
function Get-WatchClosureProfileSpecs {
  return @(
    @{name='control';entry='control';scripts=@('isolation','transport','control')},
    @{name='wrapper-backend';entry='wrapper-backend';scripts=@('transport','backendIsolation','backend','overlay','wrapper')},
    @{name='wrapper-worker';entry='wrapper-worker';scripts=@('transport','isolation','worker','overlay','wrapper')},
    @{name='wrapper-supervisor';entry='wrapper-supervisor';scripts=@('transport','backendIsolation','backend','supervisor','overlay','wrapper')}
  )
}
function Get-WatchClosureScan($Node,[string]$Script,[string]$Function,$Spec,$Table){
  # Returns @{hits=@(...);calls=@(function names)} for one function body or root statement.
  $hits=[Collections.Generic.List[object]]::new();$calls=[Collections.Generic.List[string]]::new()
  $add={param($primitive,$extent) $hits.Add(@{profile=$Spec.name;script=$Script;function=$Function;primitive=$primitive;line=$extent.StartLineNumber})}
  foreach($c in (Find-WatchClosureNodes $Node ([Management.Automation.Language.CommandAst]))){
    $name=$c.GetCommandName()
    $first=$c.CommandElements[0]
    if($c.InvocationOperator -eq [Management.Automation.Language.TokenKind]::Dot){
      $resolved=$false
      if($first -is [Management.Automation.Language.ParenExpressionAst] -and $first.Extent.Text -cmatch '^\(\s*Join-Path\s+\$PSScriptRoot\s+["''](?<file>[^"'']+)["'']\s*\)$'){
        $file=$Matches['file'].ToLowerInvariant()
        $resolved=$script:WatchClosureLoadFiles.ContainsKey($file) -and @($script:WatchClosureLoadFiles[$file]|Where-Object {$_ -in $Spec.scripts}).Count -gt 0
      }elseif($first -is [Management.Automation.Language.VariableExpressionAst]){
        $id=$script:WatchClosureLoadVariables[$first.VariablePath.UserPath.ToLowerInvariant()]
        $resolved=($null -ne $id) -and ($id -in $Spec.scripts)
      }
      if(-not $resolved){&$add 'dynamic-call' $c.Extent}
      continue
    }
    if($null -eq $name){
      if($first -isnot [Management.Automation.Language.ScriptBlockExpressionAst]){&$add 'dynamic-call' $c.Extent}
      continue
    }
    $lower=$name.ToLowerInvariant()
    if($Table.ContainsKey($lower)){$calls.Add($lower)}
    if($lower -in $script:WatchClosureForbiddenCommands){&$add $lower $c.Extent}
    if($lower -in $script:WatchClosureFileCommands){
      $targets=@($c.CommandElements|Select-Object -Skip 1|ForEach-Object {$_.Extent.Text})
      if(@($targets|Where-Object {$_ -match $script:WatchClosurePidTarget}).Count){&$add 'pid-record-write' $c.Extent}
    }
  }
  foreach($m in (Find-WatchClosureNodes $Node ([Management.Automation.Language.InvokeMemberExpressionAst]))){
    $member=if($m.Member -is [Management.Automation.Language.StringConstantExpressionAst]){$m.Member.Value}else{$null}
    if($null -eq $member){&$add 'dynamic-member' $m.Extent;continue}
    if($member.ToLowerInvariant() -in $script:WatchClosureKillMembers){&$add '.Kill()' $m.Extent;continue}
    if($m.Static -and $m.Expression -is [Management.Automation.Language.TypeExpressionAst] -and $m.Expression.TypeName.FullName -imatch '^(System\.)?IO\.(File|Directory)$' -and $member -cmatch $script:WatchClosureStaticFileMembers){
      $arguments=@($m.Arguments|ForEach-Object {$_.Extent.Text})
      if(@($arguments|Where-Object {$_ -match $script:WatchClosurePidTarget}).Count){&$add 'pid-record-write' $m.Extent}
    }
  }
  return @{hits=$hits.ToArray();calls=$calls.ToArray()}
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
    # Local diagnosis only (tests, design notes): unlisted command names and the reached function sets.
    $script:WatchClosureLastUnlisted=@();$script:WatchClosureReached=@{}
    foreach($spec in (Get-WatchClosureProfileSpecs)){
      $table=@{}
      foreach($id in $spec.scripts){
        foreach($f in (Find-WatchClosureNodes $asts[$id] ([Management.Automation.Language.FunctionDefinitionAst]))){$table[$f.Name.ToLowerInvariant()]=@{ast=$f;script=$id}}
      }
      foreach($problem in (Test-WatchClosureOwnership $table @($script:WatchOwnershipFunctions.Keys|Where-Object {$script:WatchOwnershipFunctions[$_] -ceq $spec.name}))){$reasons.Add($problem)}
      $seen=[Collections.Generic.HashSet[string]]::new();$queue=[Collections.Generic.Queue[object]]::new()
      foreach($root in (Get-WatchClosureEntryRoots $spec $asts)){$queue.Enqueue($root)}
      $script:WatchClosureReached[$spec.name]=$seen
      while($queue.Count){
        $item=$queue.Dequeue()
        $scan=Get-WatchClosureScan $item.node $item.script $item.function $spec $table
        foreach($hit in $scan.hits){
          $key="$($hit.script)|$($hit.function)|$($hit.primitive)".ToLowerInvariant()
          if(@($Exceptions|Where-Object {("$($_.script)|$($_.function)|$($_.primitive)").ToLowerInvariant() -ceq $key}).Count){$excepted++;continue}
          $violations["$($spec.name)|$key|$($hit.line)"]=$hit
        }
        foreach($call in $scan.calls){
          if($seen.Add($call)){$entry=$table[$call];$queue.Enqueue(@{node=$entry.ast.Body;script=$entry.script;function=$entry.ast.Name})}
        }
      }
    }
  }catch{
    return @{ok=$false;reasons=@('closure_analysis_failed');hits=@();excepted=$excepted}
  }
  if($violations.Count){$reasons.Add('closure_forbidden_primitive')}
  return @{ok=($reasons.Count -eq 0);reasons=@($reasons|Sort-Object -Unique);hits=@($violations.Values|Sort-Object {$_.profile},{$_.script},{$_.function},{$_.primitive},{$_.line});excepted=$excepted}
}
