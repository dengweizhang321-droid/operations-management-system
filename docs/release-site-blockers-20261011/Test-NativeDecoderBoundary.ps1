param([Parameter(Mandatory=$true)][string]$EvidencePath)
$ErrorActionPreference='Stop'
if ([IntPtr]::Size -ne 8) { throw 'Only the reviewed x64 layout is tested' }
if (Test-Path -LiteralPath $EvidencePath) { throw 'Evidence is create-only' }
$sourcePath=Join-Path $PSScriptRoot 'Collect-ProcessIdentity.ps1'
$raw=[IO.File]::ReadAllText($sourcePath)
$source=[regex]::Match($raw,"(?s)Add-Type -TypeDefinition @'\r?\n(.*?)\r?\n'@").Groups[1].Value
if (!$source.Contains('public static string Command(')) { throw 'Actual function extraction failed' }
$source=$source.Replace('ReleaseSiteIdentityV1','ReleaseSiteIdentityBoundaryTest')
$needle='[DllImport("ntdll.dll")] public static extern int NtQueryInformationProcess(IntPtr h,int cl,IntPtr b,uint n,out uint required);'
if (!$source.Contains($needle)) { throw 'Native transport declaration drifted' }
$fixture=@'
public static int Scenario;
public static int NtQueryInformationProcess(IntPtr h,int cl,IntPtr b,uint n,out uint required) {
 if(cl!=60) throw new Exception("Wrong information class");
 required=64;
 if(b==IntPtr.Zero) return unchecked((int)0xC0000004);
 if(Scenario==1) return unchecked((int)0xC0000022);
 if(Scenario==2) required=15;
 if(Scenario==3) required=65;
 ushort length=4, maximum=6; long offset=16;
 if(Scenario==4) length=3;
 if(Scenario==5) maximum=5;
 if(Scenario==6) maximum=2;
 if(Scenario==7) offset=8;
 if(Scenario==8) offset=65;
 if(Scenario==9) maximum=50;
 if(Scenario==10) length=0;
 Marshal.WriteInt16(b,0,(short)length); Marshal.WriteInt16(b,2,(short)maximum);
 Marshal.WriteIntPtr(b,8,new IntPtr(b.ToInt64()+offset));
 Marshal.WriteInt16(b,16,(short)(Scenario==11?' ':'o'));
 Marshal.WriteInt16(b,18,(short)(Scenario==11?' ':'k'));
 return 0;
}
'@
$source=$source.Replace($needle,$fixture)
Add-Type -TypeDefinition $source
$results=@()
foreach($case in 0..11){
 [ReleaseSiteIdentityBoundaryTest]::Scenario=$case
 $status=0;$value=[ReleaseSiteIdentityBoundaryTest]::Command([IntPtr]::Zero,[ref]$status)
 if($case -eq 0){if($value -cne 'ok' -or $status -ne 0){throw 'Valid buffer rejected'}}
 elseif($null -ne $value){throw "Malformed/error/empty buffer accepted: $case"}
 $results+=[ordered]@{case=$case;passed=$true;returnedCommand=($null -ne $value);ntStatus=$status}
}
$native=134000000000000009L
if(![ReleaseSiteIdentityBoundaryTest]::SameCreation($native,134000000000000000L)){throw 'Same microsecond rejected'}
if([ReleaseSiteIdentityBoundaryTest]::SameCreation($native,134000000000000010L)){throw 'Different microsecond accepted'}
if([ReleaseSiteIdentityBoundaryTest]::SameCreation($native,134000000010000009L)){throw 'Reused PID timestamp accepted'}
$record=[ordered]@{version='astra-controlled-native-decoder-review-v1';sourcePath=$sourcePath;sourceSha256=(Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLowerInvariant();cases=$results;creationCases=3;passed=15;nativeProcessCalls=0;productionMutations=0;limitations='Actual C# Command and SameCreation functions extracted unchanged. Nt transport replaced with bounded in-memory response fixture; not a live-process or Windows compatibility attestation. PowerShell null checks and CIM acquisition reviewed separately.'}
$json=$record|ConvertTo-Json -Depth 6
$stream=[IO.File]::Open($EvidencePath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
try{$bytes=[Text.UTF8Encoding]::new($false).GetBytes($json+[Environment]::NewLine);$stream.Write($bytes,0,$bytes.Length)}finally{$stream.Dispose()}
$json
