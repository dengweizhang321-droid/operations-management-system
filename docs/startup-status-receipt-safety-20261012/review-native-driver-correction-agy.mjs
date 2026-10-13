import fs from 'node:fs';import {spawn} from 'node:child_process';
const base='E:/codex-artifacts/startup-status-receipt-safety-20261012/';
const prompt=`Root 对你上一条 native bundle 复审作三项具体纠正，请确认撤回原绝对表述。1 Native 补字段函数本身零外部派生，但原 controller/backend wrapper 会启动已有 resolver/诊断 subprocess，因此“全流程无外部进程派生”不成立。2 Worker 保留完整原 CIM census，仅 native 补字段对象限定 receipt supervisor/树后代 <=512，因此“排除全 OS 遍历与高开销风险”不成立。3 controller 前后核四来源 hash；backend/Worker target 分支前后各核 backend+worker 两来源 hash，并非双分支各四资产。源码、候选 d0e9 原包未变。缺23历史record、不建立Ready、新TaskAction未采用、原 installer Running 拒绝仍存在。请只回复最多250字纠正后的有界结论，不运行工具/生产，不引入新设计。`;
fs.writeFileSync(base+'AGY_NATIVE_DRIVER_CORRECTION_PROMPT.txt',prompt,{flag:'wx'});
const out=fs.createWriteStream(base+'AGY_NATIVE_DRIVER_CORRECTION_STREAM.ndjson',{flags:'wx'}),err=fs.createWriteStream(base+'AGY_NATIVE_DRIVER_CORRECTION_STDERR.log',{flags:'wx'});
await Promise.all([out,err].map(s=>new Promise((r,j)=>{s.once('open',r);s.once('error',j)})));
const start=new Date().toISOString(),child=spawn('C:/Users/86137/AppData/Local/agy/bin/agy.exe',['--conversation','d154e0e3-9d9b-4439-a580-49b627cb5670','-p',prompt,'--mode','plan','--output-format','stream-json','--print-timeout','90s'],{windowsHide:true,stdio:['ignore','pipe','pipe']});child.stdout.pipe(out);child.stderr.pipe(err);
const result=await new Promise((r,j)=>{child.once('error',j);child.once('close',(code,signal)=>r({code,signal}))});await Promise.all([out,err].map(s=>new Promise((r,j)=>{if(s.writableFinished)return r();s.once('finish',r);s.once('error',j)})));
fs.writeFileSync(base+'AGY_NATIVE_DRIVER_CORRECTION_CALL.json',JSON.stringify({startedAt:start,finishedAt:new Date().toISOString(),...result},null,2)+'\n',{flag:'wx'});console.log(result);
