import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
const root='E:/codex-artifacts/startup-status-receipt-safety-20261012';
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const files=['tools/django-local-service.ps1','tools/operations-system-watchdog.ps1','tests/startup-status-receipt-safety.fixture.ps1','tests/startup-status-receipt-safety.test.mjs'];
const texts=Object.fromEntries(files.map(p=>[p,fs.readFileSync(p,'utf8')]));
const fn=(text,name)=>{const start=text.indexOf('function '+name);if(start<0)throw Error(name);let end=text.indexOf('\nfunction ',start+1);return text.slice(start,end<0?undefined:end);};
const diff=spawnSync('git',['diff','--','tools/django-local-service.ps1','tools/operations-system-watchdog.ps1'],{encoding:'utf8'});if(diff.status!==0)throw Error('diff');
const prompt=`同conversation有限永久修复最终源码复审。仅文本，不调用任何工具/native/生产，不修改文件，不执行任何建议。用户授权必要开发，但当前生产f15/spec/运行包/watchdog immutable版本/任务/调度全未改。请600字内给具体阻断或有界结论，不称数学完备/绝对安全。
已证事实：正式原watchdog driver绑定4c315Worker，合法批准Apply将入口更新717408（仅RequireReady后台/钉钉启动guard变化）。旧ResolveWatchStatusControl绑定失配自动legacy；Limited任务于是可调用原Django状态。旧GetProcessSnapshot在CIM存在但cmd/image不可读时返回null，ResolveOwned误删PID。原日志23个Status删除事件，不能仅log断言每PID当时活或具体actor；当前恢复尚未完成。
本独立worktree最新main65b，仅两runtime文件：GetProcessSnapshot CIM ErrorActionStop，多个row拒绝，已有row缺exe/cmd/birth抛unknown；ResolveOwned ReadOnly显式或Action以Status结尾时绝不删除（含previousboot分支），7个核心/财务/简单域Status调用显式ReadOnly，所以Start内部调用状态也是只读。显式生命周期Start/Stop仍保持原正常CIM确认不存在和原PreviousBoot严格helper清理，本次不加kernelAPI/Debug权限。Watchdog只在4driver文件完全不存在且bundle未声明它们的历史未配置路径legacy；配置过driver缺件/绑定不符拒绝，不自动换hash。请审是否遗漏同图调用或边界。
实际PS5及PS7抽取冻结函数运行43个synthetic场景/host，共2Node tests通过；AST提取仅把watchdog自动PSScriptRoot替为fixture变量，所有CIM/fs/task/HTTP均stub，非生产验收。首次test因AST无PSScriptRoot来源失败保留，修fixture后通过。另HEAD旧实际函数在两host都复现metadata不可读=>Remove调用1次、binding失配=>legacy。无重建包、没有生产采用。
必要恢复草案（未执行）：先评估已有maintenance栅栏能否阻止限定unsafe调用，不手工编造owner/gate；真实Admin完整CIM/native实例+原startup证据才能有限恢复丢失ownership，不端口接管。新readonlyDriver/717精确绑定需单独审查采用。原watchdog installer可保留triggers/RunLevel但SetScheduledTask会改变Action到新immutable bundle；不能称完全不改TaskAction。若绝对不许改Action，就不能通过原installer采用新bundle，需先明确范围。不要建议覆写旧不可变版本或旧binding。
请指出具体错误，区分source修复与生产恢复尚未批准/执行。\n`+
files.map(p=>`RAW ${p} SHA256 ${sha(fs.readFileSync(p))}`).join('\n')+'\nDIFF\n'+diff.stdout+
'\nFINAL SNAPSHOT\n'+fn(texts[files[0]],'Get-ProcessSnapshot')+'\n'+fn(texts[files[0]],'Resolve-OwnedProcess')+'\n'+fn(texts[files[1]],'Resolve-WatchStatusControl')+'\nCONTROLLED TEST\n'+texts[files[2]];
fs.writeFileSync(path.join(root,'AGY_STATUS_SAFETY_PROMPT.txt'),prompt,{flag:'wx'});
const out=fs.createWriteStream(path.join(root,'AGY_STATUS_SAFETY_STREAM.ndjson'),{flags:'wx'}),err=fs.createWriteStream(path.join(root,'AGY_STATUS_SAFETY_STDERR.log'),{flags:'wx'});
await Promise.all([out,err].map(s=>new Promise((r,j)=>{s.once('open',r);s.once('error',j)})));
const startedAt=new Date().toISOString();
const child=spawn('C:/Users/86137/AppData/Local/agy/bin/agy.exe',['--conversation','d154e0e3-9d9b-4439-a580-49b627cb5670','-p',prompt,'--mode','plan','--output-format','stream-json','--print-timeout','90s'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
child.stdout.pipe(out);child.stderr.pipe(err);
const result=await new Promise((r,j)=>{child.once('error',j);child.once('close',(code,signal)=>r({code,signal}))});
await Promise.all([out,err].map(s=>new Promise((r,j)=>{if(s.writableFinished)return r();s.once('finish',r);s.once('error',j)})));
fs.writeFileSync(path.join(root,'AGY_STATUS_SAFETY_CALL.json'),JSON.stringify({startedAt,finishedAt:new Date().toISOString(),...result,promptSha256:sha(prompt),scope:'text-only source review; no production actions'},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(result));
