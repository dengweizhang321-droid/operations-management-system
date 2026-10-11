import {readFile,writeFile} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {spawn} from 'node:child_process';
const root='E:/codex-artifacts/release-site-blockers-20261011/',base=new URL('./',import.meta.url);
let prompt=`继续AGY7/8真实交叉复审；仅文本审查，不用工具或改文件，不生产操作。你已撤回mandatory Wait概括，保留同句柄出生+GetExit成功非259，87仅当次缺失。
最终实际只读QA4已PASS：830Windows进程（1变动已被0x1000 kernel87+末CIM不存在补证、1late新增仍纳入）、37WSL进程/9namespace完整前后覆盖、原引用谓词0引用/0未知、全部5固定native出生及HCS前后同唯一VM/parent出生/命令SHA+三tokens成立。原3实际失败保留，未追认通过；这不是全OS排他或生产验收。
唯一新扩表：mnt:[4026532299]→9745f6ec4272c1c03e31c2e4c8d1ed5f6b42dfa5690cedf447268958527683dd。实际管理员元数据原JSONsha bc969d234858aed26dda6518ceea523714b2c68ecb4807bace9524c14f51ae25 的33条mount来源/root/mount/fs/superoptions多重集与原2219完全一致；只有已知Linux/dev/sdd/root、伪fs/knownoverlay及唯一9p drivers ro，没有DrvFS/Windows/UNC。没有保存mountID/parent/per-mountflags，未猜管理员IPC用途，不解释23字节差异；完整raw mountSHA实际重算硬匹配。任意新ID/第10ID/同ID不同SHA拒绝，process/ns/FD完整对应、bootID/PID1/kernel/native身份原规则不减。128/128最终源码隔离回归及真正readonlyQA通过，不称生产验收。
另首次采用严格19ops，只1前Backup+1新installed consumer同点隔离Restore，没有后DB。新guard外部闭包11helpers+4诊断records必须exact绑定，不能savedJSON替代新live观察；新spec封存必须与最后测试handoff hash闭包完全一致，旧f0批次/源/package/WAL不变。请检查这一次最小扩表是否存在具体不充分，不提出通用OS账本/新权限；明确哪些仍需正式生产动作前复验。最多600中文字符。
下面完整最终system verifier源码（此前没有完整附给你）及namespace边界review；只能依据本次材料，不臆造读了其他全文。\n`;
prompt+=await readFile(new URL('system-wsl-verifier.mjs',base),'utf8');
prompt+='\n'+await readFile(new URL('ASTRA_EXACT_NINTH_NAMESPACE_REVIEW.md',base),'utf8');
await writeFile(root+'SITE_AGY9_PROMPT.txt',prompt,{flag:'wx'});
const stdout=createWriteStream(root+'SITE_AGY9_STREAM.ndjson',{flags:'wx'}),stderr=createWriteStream(root+'SITE_AGY9_STDERR.log',{flags:'wx'});
await Promise.all([stdout,stderr].map(s=>new Promise((res,rej)=>{s.once('open',res);s.once('error',rej)})));
const startedAt=new Date().toISOString();
const child=spawn('C:/Users/86137/AppData/Local/agy/bin/agy.exe',['--conversation','d154e0e3-9d9b-4439-a580-49b627cb5670','-p',prompt,'--mode','plan','--output-format','stream-json','--print-timeout','90s'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
child.stdout.pipe(stdout);child.stderr.pipe(stderr);
const status=await new Promise((res,rej)=>{child.once('error',rej);child.once('close',(code,signal)=>res({code,signal}));});
await Promise.all([stdout,stderr].map(s=>new Promise((res,rej)=>{if(s.writableFinished)return res();s.once('finish',res);s.once('error',rej);})));await writeFile(root+'SITE_AGY9_CALL.json',JSON.stringify({startedAt,finishedAt:new Date().toISOString(),...status,productionActionsRequested:0},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(status));
