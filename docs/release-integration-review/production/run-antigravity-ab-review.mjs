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
const input='docs/release-integration-review/production/AGY_AB_ACTUAL_INPUT.md';
const digest=b=>createHash('sha256').update(b).digest('hex');
const raw=await readFile(path.join(cwd,input));
const prompt=`用户明确授权 Antigravity 协助 TERUISI AB 收尾。你是非作者第二审查者，仅只读核验。父任务已按 Home.md 加载共享记忆、AGENTS 和开发/发布规范：精确批准、完整健康断言、原失败保留、生产范围不扩张。请仅用 view_file 读取 ${input}、该文件指定的公共受限证据以及 HEALTH_PROBE_APPROVAL_PLAN.md / HEALTH_PROBE_SEALED_REVIEW.md。不要执行 shell/terminal、Status、HTTP、SQL、服务/调度/部署/锁/写文件、外部通信或读取工作区外凭据。若默认权限拒绝请保留拒绝且报告证据限制，不绕过。检查必要验收和完整交付是否分开、三个旧unknown与原严格false是否保留、真实native/producer/预算/PID证据是否支持结论、owner释放是否有真实ENOENT、是否把首页或模型测试冒充生产结果、计时是否重复或隐藏失败。结合本轮真人批准与计划的新独立合同判断，不能擅自改历史原操作为passed。输出中文：核验文件、支持与不支持的结论、精确阻断或非阻断提醒、计时更正；没有读取证据不能宣称实物验证。`;
const args=['--mode','plan','--print-timeout','240s','--output-format','stream-json','-p',prompt];
const logs=path.join(directory,'AGY_AB_REVIEW_SECOND');await mkdir(logs);
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
