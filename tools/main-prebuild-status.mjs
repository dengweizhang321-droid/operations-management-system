/** Read-only local preparation viewer. No fetch, preparation or deployment. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFile,spawn} from 'node:child_process';
import {promisify,parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';

const execute=promisify(execFile),sha=raw=>createHash('sha256').update(raw).digest('hex');
const exists=async file=>{try{await fs.access(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
export async function localMain(config){
 const {stdout}=await execute('git',['-C',config.repository,'rev-parse','refs/remotes/origin/main'],{encoding:'utf8',windowsHide:true,timeout:15000});
 const commit=stdout.trim();assert.match(commit,/^[a-f0-9]{40}$/);return commit;
}
export async function readPreparationStatus(config,{getLatest=()=>localMain(config)}={}){
 const targetCommit=await getLatest();assert.match(targetCommit,/^[a-f0-9]{40}$/);
 const state=await readTargetStatus(config,targetCommit);
 const after=await getLatest();
 if(after!==targetCommit)return {targetCommit:after,status:'waiting',message:'main刚更新，等待新版本准备记录',publicationPerformed:false};
 // A publisher can start while the asynchronous main-ref read is running.
 if(state.status==='prepared')return readTargetStatus(config,targetCommit);
 return state;
}
async function readTargetStatus(config,targetCommit){
 const base={targetCommit,publicationPerformed:false};
 const pointerFile=path.join(config.stateDirectory,'LATEST-PREPARED.json');
 if(!await exists(pointerFile))return {...base,status:'waiting',message:'尚无当前版本准备记录：可能排队或前置检查已停止，请查看准备日志'};
 const pointer=await read(pointerFile);
 if(pointer.targetCommit!==targetCommit)return {...base,status:'waiting',message:'等待当前main准备记录：可能排队或前置检查已停止，请查看准备日志'};
 assert.ok(typeof pointer.packet==='string'&&path.isAbsolute(pointer.packet));
 const packet=path.resolve(pointer.packet),relative=path.relative(path.resolve(config.releaseDirectory),packet);
 assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&!relative.includes(path.sep),'准备目录不属于发布包目录');
 const request=await read(path.join(packet,'main-release-request.json'));
 assert.equal(request.mainCommit,targetCommit);assert.equal(request.latestMainRelease,true);
 assert.ok(Array.isArray(request.components)&&request.components.length>0&&request.components.every(c=>['worker','django'].includes(c)));
 const attempt=path.join(packet,'publish-'+targetCommit.slice(0,12)),preparation=path.join(attempt,'preparation');
 const withPaths={...base,packet,logsDirectory:path.join(packet,'logs')};
 const terminalState=async()=>{
 if(await exists(path.join(attempt,'STARTED.json'))&&!await exists(path.join(attempt,'SUCCESS.json')))return {...withPaths,status:'attention',message:'已有发布开始记录但未完成，请核对原发布日志；不要重复发布'};
 if(await exists(path.join(attempt,'SUCCESS.json'))){
  const success=await read(path.join(attempt,'SUCCESS.json'));assert.equal(success.mainCommit,targetCommit);assert.equal(success.status,'deployed_and_ready');
  return {...withPaths,status:'published-record',message:'已发现对应发布成功回执；当前在线状态由发布入口核对'};
 }
 const preparationFiles=await exists(preparation)?await fs.readdir(preparation):[];
 // Native reuse failure preserves PREPARED and writes FAILED beside it.
 // Do not turn that rejected package back into a completion notification.
 if(preparationFiles.some(name=>/^FAILED-.*\.json$/.test(name)))return {...withPaths,status:'failed',message:'打包或准备复验存在失败记录，请查看原日志处理；不会自动重试'};
 return null;
 };
 const terminal=await terminalState();if(terminal)return terminal;
 const file=path.join(preparation,'PREPARED.json');
 if(await exists(file)){
  const raw=await fs.readFile(file),receipt=JSON.parse(raw);
  assert.equal(receipt.version,'teruisi-main-preparation-v1');assert.equal(receipt.requestSha256,sha(Buffer.from(JSON.stringify(request))));
  assert.equal(receipt.sourceIdentity?.commit,targetCommit);assert.match(receipt.sourceIdentity?.tree??'',/^[a-f0-9]{40}$/);
  assert.equal(Boolean(receipt.workerPlan),request.components.includes('worker'));assert.equal(Boolean(receipt.djangoPackage),request.components.includes('django'));
  const changed=await terminalState();if(changed)return changed;
  return {...withPaths,status:'prepared',message:'打包完成，等待发布负责人执行（发布前仍会原生复验）',preparedAt:receipt.at??null,preparationSha256:sha(raw)};
 }
 if(await exists(path.join(preparation,'PREPARING.json')))return {...withPaths,status:'preparing',message:'打包尚未完成：已有准备开始记录（中断时也会保留此记录）'};
 return {...withPaths,status:'waiting',message:'尚无原生准备记录：可能排队或前置检查已停止，请查看准备日志'};
}
export function popupCommand(state){
 assert.ok(['prepared','failed','attention'].includes(state.status));assert.match(state.targetCommit,/^[a-f0-9]{40}$/);
 const ready=state.status==='prepared',title=ready?'TERUISI 打包完成':'TERUISI 打包需要处理';
 const message=ready?'版本 '+state.targetCommit.slice(0,12)+' 打包完成。由发布负责人按本次授权执行；发布入口会重新核对最新main。':'版本 '+state.targetCommit.slice(0,12)+' 打包或发布状态需要处理。请查看状态窗口和日志，不要重复发布。';
 const quote=value=>"'"+value.replaceAll("'","''")+"'";
 const code='[void](New-Object -ComObject WScript.Shell).Popup('+quote(message)+',0,'+quote(title)+','+(ready?64:16)+')';
 return {host:'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',args:['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')]};
}
export async function showStatusPopup(state){
 const command=popupCommand(state);
 await new Promise((resolve,reject)=>{
  const child=spawn(command.host,command.args,{windowsHide:true,detached:true,stdio:'ignore'});
  child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});
 });
}
export async function watchPreparation(config,{readState=()=>readPreparationStatus(config),write=console.log,notify=showStatusPopup,sleep=ms=>new Promise(r=>setTimeout(r,ms)),once=false,noPopup=false}={}){
 let previous='';
 write('查看打包状态：只读取本机已获取的main，不打包、不发布。可最小化等待；关闭本窗口不影响后台打包。');
 for(;;){
  let state;
  try{state=await readState();}catch{state={status:'unavailable',message:'暂时无法读取完整状态，稍后重试；不能判定打包完成',publicationPerformed:false};}
  if(once){write(JSON.stringify(state));return state;}
  const key=JSON.stringify(state);
  if(key!==previous){write('\n['+new Date().toLocaleString('zh-CN')+'] '+state.message);if(state.targetCommit)write('目标main：'+state.targetCommit);if(state.logsDirectory)write('日志目录：'+state.logsDirectory);previous=key;}
  if(['prepared','failed','attention','published-record'].includes(state.status)){
   if(!noPopup&&state.status!=='published-record')try{await notify(state);}catch{write('桌面提醒未启动，请以本窗口显示的状态为准。');}
   return state;
  }
  await sleep(5000);
 }
}
async function main(){
 const {values}=parseArgs({options:{config:{type:'string'},once:{type:'boolean'},'no-popup':{type:'boolean'},'no-pause':{type:'boolean'}}});
 assert.ok(values.config,'需要固定发布配置 --config');
 await watchPreparation(await read(values.config),{once:values.once,noPopup:values['no-popup']});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error('状态查看未完成：'+error.message);process.exitCode=1;});
