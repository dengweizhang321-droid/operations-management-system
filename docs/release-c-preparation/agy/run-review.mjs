// Read-only secondary review. Never invokes any production operation.
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile,open,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const directory=path.dirname(fileURLToPath(import.meta.url));
const cwd=path.resolve(directory,'../../..');
const executable='C:/Users/86137/AppData/Local/agy/bin/agy.exe';
const input='docs/release-c-preparation/agy/INPUT.md';
const digest=b=>createHash('sha256').update(b).digest('hex');
const raw=await readFile(path.join(cwd,input));
const prompt='用户明确授权Antigravity协助。父任务已按Home/AGENTS加载规范。仅用view_file读取 docs/release-c-preparation/agy/INPUT.md 和其中指定工作区文件，分析跨会话Worker退出证据、collector真实状态年龄以及C-only首次严格采用范围。禁止shell/Status/HTTP/SQL/写文件/生产操作/外部发送，不绕过权限。文件暂缺如实说明，不能把模型共识当验证。给出中文独立意见、精确阻断与最小测试/交接要求。';
const args=['--mode','plan','--print-timeout','240s','--output-format','stream-json','-p',prompt];
const logs=path.join(directory,'AGY_C_PREPARATION');await mkdir(logs);
async function write(name,value){const h=await open(path.join(logs,name),'wx');try{await h.writeFile(JSON.stringify(value,null,2)+'\n');await h.sync();}finally{await h.close();}}
const out=await open(path.join(logs,'stdout.jsonl'),'wx'),err=await open(path.join(logs,'stderr.log'),'wx');
const startedAt=new Date().toISOString(),begun=performance.now();
const child=spawn(executable,args,{cwd,windowsHide:true,shell:false,stdio:['ignore',out.fd,err.fd]});
const terminal=new Promise(resolve=>{child.once('error',e=>resolve({exitCode:null,signal:null,spawnErrorSha256:digest(String(e.message))}));child.once('close',(exitCode,signal)=>resolve({exitCode,signal}));});
await write('started.json',{startedAt,processId:child.pid,executable,args,cwd,inputSha256:digest(raw),productionExecutionDelegated:false});
const result=await terminal;await out.sync();await err.sync();await out.close();await err.close();
const stdout=await readFile(path.join(logs,'stdout.jsonl')),stderr=await readFile(path.join(logs,'stderr.log'));
const finished={startedAt,finishedAt:new Date().toISOString(),elapsedMs:performance.now()-begun,processId:child.pid,...result,stdoutBytes:stdout.length,stdoutSha256:digest(stdout),stderrBytes:stderr.length,stderrSha256:digest(stderr),productionExecutionDelegated:false};
await write('finished.json',finished);console.log(JSON.stringify(finished));if(result.exitCode!==0)process.exitCode=1;
