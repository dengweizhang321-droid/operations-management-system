import {writeFile} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {spawn} from 'node:child_process';
const root='E:/codex-artifacts/release-site-blockers-20261011/';
const prompt=`继续AGY7的交叉事实核对，只文本回应，不运行工具/修改文件。你建议WaitForSingleObject0是GetExitCodeProcess!=259之前的绝对前置，Root查官方与该概括冲突：
https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getexitcodeprocess 明确0x1000(QUERY_LIMITED)支持，未terminated且API成功返回STILL_ACTIVE；terminated且成功返回ExitProcess/main/exception exit码。259歧义因此保守unknown，而success!=259按正式契约证明terminated。
https://learn.microsoft.com/en-us/windows/win32/api/synchapi/nf-synchapi-waitforsingleobject 明确句柄要求SYNCHRONIZE；不能在只批准0x1000的metadata scope偷偷扩大Access。没有证据证明GetExitCode成功!=259可在alive时返回。
Astra实现拟只按该契约：先same-handle native/CIM出生关联，GetExit成功且!=259才departed；GetExit失败/259/reused保持unknown；finallyclose所有handle；error87只标当次kernelabsence，保留changedDuringCapture原事实及领域owner/readiness/维护边界，不承诺未来全OS排他。没有任何生产杀进程/服务操作。
请明确是否撤回mandatoryWait概括或给正式来源依据；不要用模型权威要求额外权限。btime仅诊断、bootID/PID1/osrelease精确及所有mount/源/制品byte不放宽。只答具体分歧最多400中文字符。`;
await writeFile(root+'SITE_AGY8_PROMPT.txt',prompt,{flag:'wx'});
const stdout=createWriteStream(root+'SITE_AGY8_STREAM.ndjson',{flags:'wx'}),stderr=createWriteStream(root+'SITE_AGY8_STDERR.log',{flags:'wx'});
await Promise.all([stdout,stderr].map(s=>new Promise((yes,no)=>{s.once('open',yes);s.once('error',no)})));
const startedAt=new Date().toISOString();
const child=spawn('C:/Users/86137/AppData/Local/agy/bin/agy.exe',['--conversation','d154e0e3-9d9b-4439-a580-49b627cb5670','-p',prompt,'--mode','plan','--output-format','stream-json','--print-timeout','90s'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
child.stdout.pipe(stdout);child.stderr.pipe(stderr);
const status=await new Promise((yes,no)=>{child.once('error',no);child.once('close',(code,signal)=>yes({code,signal}))});
await Promise.all([stdout,stderr].map(s=>new Promise((yes,no)=>{if(s.writableFinished)return yes();s.once('finish',yes);s.once('error',no)})));
await writeFile(root+'SITE_AGY8_CALL.json',JSON.stringify({startedAt,finishedAt:new Date().toISOString(),...status,productionActionsRequested:0},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(status));process.exitCode=status.code??1;
