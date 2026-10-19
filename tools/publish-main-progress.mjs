import {mkdirSync,appendFileSync,writeFileSync,renameSync,unlinkSync,readFileSync,lstatSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

// Presentation only: never retries an operation or changes release receipts.
export function createReleaseProgress(directory,{write=console.log,now=Date.now,heartbeatMs=30000,taskName='发布'}={}){
 mkdirSync(directory,{recursive:true});
 const logFile=path.join(directory,'release-'+new Date(now()).toISOString().replaceAll(':','-')+'-'+randomUUID()+'.log');
 writeFileSync(logFile,'',{flag:'wx'});
 const started=now();let phase='准备发布',phaseStarted=started,number=0,logWarning=false;
 const stateFile=logFile+'.state.json';let details={},stateWarning=false,lastState='running';
 const lockDiagnostic=()=>{
  if(!details.lockDiagnosticFile)return null;
  try{
   const info=lstatSync(details.lockDiagnosticFile);if(!info.isFile()||info.isSymbolicLink()||info.size>4096)return null;
   const value=JSON.parse(readFileSync(details.lockDiagnosticFile,'utf8'));
   if(value.version!=='teruisi-maintenance-lock-diagnostic-v1'||!['worker','django'].includes(value.lock)||!['waiting','acquired','timeout','abandoned'].includes(value.phase)||!Number.isFinite(Date.parse(value.at))||Date.parse(value.at)<phaseStarted||Date.parse(value.at)>now())return null;
   for(const key of ['budgetMilliseconds','elapsedMilliseconds','remainingMilliseconds'])if(!Number.isSafeInteger(value[key])||value[key]<0)return null;
   return {at:value.at,lock:value.lock,phase:value.phase,budgetMilliseconds:value.budgetMilliseconds,elapsedMilliseconds:value.elapsedMilliseconds,remainingMilliseconds:value.remainingMilliseconds};
  }catch{return null;}
 };
 const snapshot=state=>{
  lastState=state;
  const temporary=stateFile+'.'+randomUUID()+'.tmp';
  try{
   writeFileSync(temporary,JSON.stringify({version:'teruisi-release-progress-v1',diagnosticOnly:true,taskName,state,step:number,phase,startedAt:new Date(started).toISOString(),phaseStartedAt:new Date(phaseStarted).toISOString(),updatedAt:new Date(now()).toISOString(),elapsedMilliseconds:now()-started,...details,lockDiagnostic:lockDiagnostic()})+'\n',{flag:'wx'});
   renameSync(temporary,stateFile);
  }catch(error){try{unlinkSync(temporary);}catch{}if(!stateWarning){stateWarning=true;write('进度状态写入失败：'+error.message+'；原发布回执与日志仍为依据。');}}
 };
 const seconds=since=>Math.floor((now()-since)/1000);
 const log=message=>{
  const line='['+new Date(now()).toISOString()+'] '+message;
  try{appendFileSync(logFile,line+'\n');}catch(error){
   if(!logWarning){logWarning=true;write('进度日志写入失败：'+error.message+'；请保留当前窗口输出。');}
  }
  write(line);
 };
 const heartbeat=()=>{snapshot('running');const diagnostic=lockDiagnostic();log('[步骤 '+number+'] '+phase+' 进行中，本步已用 '+seconds(phaseStarted)+' 秒，总用时 '+seconds(started)+' 秒，请保持窗口打开。'+(details.action?' 原生动作：'+details.action+'；结束后stderr记录：'+details.nativeStderrLog:'')+(diagnostic?' 锁诊断记录：'+diagnostic.lock+'/'+diagnostic.phase+'；共同预算 '+diagnostic.budgetMilliseconds+'ms；已用 '+diagnostic.elapsedMilliseconds+'ms；记录时间 '+diagnostic.at:''));};
 const timer=setInterval(heartbeat,heartbeatMs);timer.unref();
 log('开始'+taskName+'。进度日志：'+logFile);
 snapshot('running');
 return {
  logFile,stateFile,log,heartbeat,
  begin(label,context={}){phase=label;phaseStarted=now();number++;details={};for(const key of ['action','script','nativeStderrLog','lockDiagnosticFile'])if(typeof context[key]==='string')details[key]=context[key];snapshot('running');log('[步骤 '+number+'] '+label+' 开始');},
  complete(){snapshot('step-completed');log('[步骤 '+number+'] '+phase+' 完成，耗时 '+seconds(phaseStarted)+' 秒');},
  success(detail){clearInterval(timer);snapshot('succeeded');log('========== 发布成功 ==========');log('总用时 '+seconds(started)+' 秒。'+detail);},
  fail(error){clearInterval(timer);snapshot('failed');log('========== 发布失败 / 已停止 ==========');log('失败步骤：'+phase+'；原因：'+error.message);log('进度日志：'+logFile);},
  close(){clearInterval(timer);if(!['succeeded','failed'].includes(lastState))snapshot('closed');}
 };
}
