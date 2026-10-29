import {mkdirSync,appendFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

// Presentation only: never retries an operation or changes release receipts.
export function createReleaseProgress(directory,{write=console.log,now=Date.now,heartbeatMs=30000,taskName='发布'}={}){
 mkdirSync(directory,{recursive:true});
 const logFile=path.join(directory,'release-'+new Date(now()).toISOString().replaceAll(':','-')+'-'+randomUUID()+'.log');
 writeFileSync(logFile,'',{flag:'wx'});
 const started=now();let phase='准备发布',phaseStarted=started,number=0,logWarning=false;
 const seconds=since=>Math.floor((now()-since)/1000);
 const log=message=>{
  const line='['+new Date(now()).toISOString()+'] '+message;
  try{appendFileSync(logFile,line+'\n');}catch(error){
   if(!logWarning){logWarning=true;write('进度日志写入失败：'+error.message+'；请保留当前窗口输出。');}
  }
  write(line);
 };
 const heartbeat=()=>log('[步骤 '+number+'] '+phase+' 进行中，本步已用 '+seconds(phaseStarted)+' 秒，总用时 '+seconds(started)+' 秒，请保持窗口打开。');
 const timer=setInterval(heartbeat,heartbeatMs);timer.unref();
 log('开始'+taskName+'。进度日志：'+logFile);
 return {
  logFile,log,heartbeat,
  begin(label){phase=label;phaseStarted=now();number++;log('[步骤 '+number+'] '+label+' 开始');},
  complete(){log('[步骤 '+number+'] '+phase+' 完成，耗时 '+seconds(phaseStarted)+' 秒');},
  success(detail){clearInterval(timer);log('========== 发布成功 ==========');log('总用时 '+seconds(started)+' 秒。'+detail);},
  fail(error){clearInterval(timer);log('========== 发布失败 / 已停止 ==========');log('失败步骤：'+phase+'；原因：'+error.message);log('进度日志：'+logFile);},
  close(){clearInterval(timer);}
 };
}
