import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {sha} from '../tools/main-prebuild-queue.mjs';
import {retirementBootVersion,retirementBootCollectorScript,validateFullBootObservation,assertFullBootAfterSourcesClosed} from '../tools/preparation-retirement-boot.mjs';
function observation(bootAt,base=100,host='a'.repeat(64),type='0'){
 function event(id,version,provider,guid,data,recordId){const at=new Date(Date.parse(bootAt)+359).toISOString(),xml='<Event><System><Provider Name="'+provider+'" Guid="'+guid+'"/><EventID>'+id+'</EventID><Version>'+version+'</Version><EventRecordID>'+recordId+'</EventRecordID><TimeCreated SystemTime="'+at+'"/><Computer>private</Computer></System><EventData>'+Object.entries(data).map(([k,v])=>'<Data Name="'+k+'">'+v+'</Data>').join('')+'</EventData></Event>';return {provider,providerGuid:guid,eventId:id,schemaVersion:version,recordId,at,xml,xmlSha256:sha(Buffer.from(xml)),data};}
 return {version:retirementBootVersion,hostSha256:host,cimBootAt:bootAt,sampledAt:new Date(Date.parse(bootAt)+30000).toISOString(),startEvents:[event(12,0,'Microsoft-Windows-Kernel-General','{a68ca8b7-004f-d7b6-a698-07e2de0f1f5d}',{StartTime:bootAt,BuildVersion:'26100'},base)],bootEvents:[event(27,1,'Microsoft-Windows-Kernel-Boot','{15ca44ff-4d7a-4baa-bba5-0998955e531e}',{BootType:type},base+8)]};
}
test('qualified raw XML projection supports a later full boot, independent of an original PID',()=>{
 const before=observation('2026-10-17T14:43:44.500Z'),after=observation('2026-10-23T03:00:00.000Z',200);assert.ok(validateFullBootObservation(before));assert.equal(assertFullBootAfterSourcesClosed(before,'2026-10-23T02:00:00.000Z',after).bootAt,after.cimBootAt);
});
test('same boot, hybrid/resume, missing events, reused records and another host cannot retire sources',()=>{
 const before=observation('2026-10-17T14:43:44.500Z'),closed='2026-10-23T02:00:00.000Z';assert.throws(()=>assertFullBootAfterSourcesClosed(before,closed,before),/No full boot/);
 assert.throws(()=>assertFullBootAfterSourcesClosed(before,closed,observation('2026-10-23T03:00:00.000Z',200,'a'.repeat(64),'1')),/Hybrid/);assert.throws(()=>assertFullBootAfterSourcesClosed(before,closed,observation('2026-10-23T03:00:00.000Z',200,'b'.repeat(64))),/host/);assert.throws(()=>assertFullBootAfterSourcesClosed(before,closed,observation('2026-10-23T03:00:00.000Z',100)),/reused/);assert.throws(()=>validateFullBootObservation({...before,bootEvents:[]}));
});
test('unknown GUID/schema, forged projection and ambiguous current boot are rejected',()=>{
 const before=observation('2026-10-17T14:43:44.500Z');for(const change of [v=>v.bootEvents[0].schemaVersion=0,v=>v.startEvents[0].providerGuid='{00000000-0000-0000-0000-000000000000}',v=>v.bootEvents[0].data.BootType='1',v=>v.bootEvents.push({...v.bootEvents[0],recordId:999})]){const v=structuredClone(before);change(v);assert.throws(()=>validateFullBootObservation(v));}
});
test('the actual collector script runs through native PS5 aliases with only the event/CIM transport replaced',()=>{
 const fixture=observation('2026-10-17T14:43:44.500Z',200);for(const event of [...fixture.startEvents,...fixture.bootEvents])event.xml=event.xml.replace('<Computer>private</Computer>','<Computer>'+process.env.COMPUTERNAME+'</Computer>');
 const encoded=Buffer.from(JSON.stringify(fixture)).toString('base64');
 const prelude="$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);if((Get-Alias h).Definition -ne 'Get-History'){throw 'Expected native h alias'};$script:privateBootFixture=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('"+encoded+"'))|ConvertFrom-Json;function Get-ItemProperty{[CmdletBinding()]param($LiteralPath,$Name);@{MachineGuid='private-machine-guid'}};function Get-CimInstance{[CmdletBinding()]param($ClassName);@{LastBootUpTime=[datetime]::Parse([string]$script:privateBootFixture.cimBootAt)}};function Get-WinEvent{[CmdletBinding()]param($FilterHashtable,$MaxEvents);$items=if($FilterHashtable.Id -eq 12){$script:privateBootFixture.startEvents}else{$script:privateBootFixture.bootEvents};foreach($item in $items){$row=[pscustomobject]@{privateXml=[string]$item.xml};$row|Add-Member -MemberType ScriptMethod -Name ToXml -Value {return $this.privateXml};$row}};";
 const code=prelude+retirementBootCollectorScript,result=spawnSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:30000});assert.equal(result.status,0,result.stderr?.slice(0,1500));const value=JSON.parse(result.stdout);assert.ok(validateFullBootObservation(value));assert.equal(value.bootEvents[0].data.BootType,'0');
});
