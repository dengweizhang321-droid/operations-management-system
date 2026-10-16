import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {manualStepCommand} from '../tools/publish-main-command.mjs';
const systemHost='C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
const powerShellDirectory='D:/codex-isolated/main-manual-release-20261016/control-host';
test('schema-only switches reach the verified PS7 engine as typed switches',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'schema-command-'));
 const script=path.join(root,'bi-app-adopt.ps1');
 await fs.writeFile(script,"param([string]$Action,[switch]$SchemaOnly,[switch]$Execute,[string]$SourceRoot)\n@{action=$Action;schemaOnly=$SchemaOnly.IsPresent;execute=$Execute.IsPresent;sourceBase64=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($SourceRoot))}|ConvertTo-Json -Compress\n");
 const source='D:/库存目录/参数';const command=manualStepCommand({systemHost,powerShellDirectory,script,action:'Plan',extra:['-SchemaOnly','-Execute','-SourceRoot',source],addJson:false});
 assert.equal(command.host,path.join(powerShellDirectory,'pwsh.exe'));
 const result=JSON.parse(execFileSync(command.host,command.args,{encoding:'utf8',windowsHide:true,timeout:15000}));
 assert.deepEqual(result,{action:'Plan',schemaOnly:true,execute:true,sourceBase64:Buffer.from(source).toString('base64')});
});
test('ordinary lifecycle actions keep the original system host and JSON flag',()=>{
 const command=manualStepCommand({systemHost,powerShellDirectory,script:'D:/fixture/worker-local-service.ps1',action:'EnterMaintenance',extra:['-KeepPostgres']});
 assert.equal(command.host,systemHost);assert.deepEqual(command.args.slice(-3),['EnterMaintenance','-KeepPostgres','-Json']);
});
