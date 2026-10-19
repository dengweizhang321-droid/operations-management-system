import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createReleaseProgress} from '../tools/publish-main-progress.mjs';

test('progress is saved while a step runs, with elapsed time and final success',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'release-progress-'));
 let time=Date.parse('2026-10-16T10:00:00Z');const lines=[];
 const progress=createReleaseProgress(directory,{now:()=>time,write:line=>lines.push(line)});t.after(()=>progress.close());
 progress.begin('构建前端原生发布包');time+=31000;progress.heartbeat();
 const running=await fs.readFile(progress.logFile,'utf8');
 assert.match(running,/步骤 1.*构建前端原生发布包 开始/);assert.match(running,/进行中，本步已用 31 秒，总用时 31 秒/);assert.doesNotMatch(running,/发布成功/);
 progress.complete();progress.begin('确认服务可用');time+=2000;progress.complete();progress.success('main版本：fixture');
 const finished=await fs.readFile(progress.logFile,'utf8');assert.match(finished,/步骤 2.*确认服务可用 完成/);assert.match(finished,/发布成功/);assert.match(finished,/总用时 33 秒/);
 assert.equal(finished,lines.join('\n')+'\n');
});
test('failure records the current step and error without claiming success',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'release-progress-'));
 const progress=createReleaseProgress(directory,{write:()=>{}});t.after(()=>progress.close());
 progress.begin('部署后台');progress.fail(new Error('fixture deployment refused'));
 const failed=await fs.readFile(progress.logFile,'utf8');assert.match(failed,/发布失败 \/ 已停止/);assert.match(failed,/失败步骤：部署后台；原因：fixture deployment refused/);assert.match(failed,/进度日志：/);assert.doesNotMatch(failed,/发布成功/);
});
test('diagnostic snapshot identifies the native step and clears prior step fields',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'release-progress-'));
 t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const progress=createReleaseProgress(directory,{write:()=>{}});t.after(()=>progress.close());
 progress.begin('进入维护',{action:'EnterMaintenance',script:'private.ps1',nativeStderrLog:'private.stderr.log',owner:'unverified'});
 progress.heartbeat();let state=JSON.parse(await fs.readFile(progress.stateFile,'utf8'));
 assert.equal(state.diagnosticOnly,true);assert.equal(state.action,'EnterMaintenance');assert.equal(state.nativeStderrLog,'private.stderr.log');assert.equal(state.owner,undefined);
 progress.begin('切换前端');state=JSON.parse(await fs.readFile(progress.stateFile,'utf8'));assert.equal(state.action,undefined);assert.equal(state.nativeStderrLog,undefined);
 progress.fail(new Error('fixture'));assert.equal(JSON.parse(await fs.readFile(progress.stateFile,'utf8')).state,'failed');
});
test('live lock observations are bounded to this step and close never claims a deployment',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'release-progress-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 let time=Date.parse('2026-10-20T00:00:00Z');const lines=[],file=path.join(directory,'lock.json');
 const progress=createReleaseProgress(directory,{now:()=>time,write:line=>lines.push(line)});t.after(()=>progress.close());
 progress.begin('进入维护',{action:'EnterMaintenance',lockDiagnosticFile:file});
 const record={version:'teruisi-maintenance-lock-diagnostic-v1',at:new Date(time).toISOString(),lock:'django',phase:'waiting',budgetMilliseconds:120000,elapsedMilliseconds:500,remainingMilliseconds:119500};
 await fs.writeFile(file,JSON.stringify(record));progress.heartbeat();
 assert.equal(JSON.parse(await fs.readFile(progress.stateFile,'utf8')).lockDiagnostic.lock,'django');assert.ok(lines.some(line=>line.includes('django/waiting')));
 time+=1;progress.begin('下一步',{lockDiagnosticFile:file});progress.heartbeat();assert.equal(JSON.parse(await fs.readFile(progress.stateFile,'utf8')).lockDiagnostic,null);
 progress.close();assert.equal(JSON.parse(await fs.readFile(progress.stateFile,'utf8')).state,'closed');
 assert.ok(lines.every(line=>!line.includes('发布成功')));
});
