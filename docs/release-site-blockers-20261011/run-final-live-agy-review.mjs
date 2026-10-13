import {readFile,writeFile} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root='E:/codex-artifacts/release-site-blockers-20261011/',base=new URL('./',import.meta.url);
let prompt=`继续你AGY5独立复审，只按本提示文本给中文结论，不运行工具/写文件/生产操作。
你的意见处理：没有采用放弃MaximumLength缓冲边界的建议（原实际API和受控decoder已通过，跨版本未知拒绝），只给新host producer增加p偶对齐；空argv已用/proc/stat PF_KTHREAD双读+nonkernel真实argv/exe非空封口；wrapper实际pin全闭包后执行native，不从batch或旧JSON读取native，因此单纯伪造对象不能代替生产者；GUID现在钉唯一实际GUID+完整命令SHA+3token类型/hash；硬codedPID+exactFILETIME作为本次限定不是通用重启支持；审计写E及系统正常日志明确不称绝对无OS副作用；Namespace支持已审8ns非空子集，必须与本次全部process ns集合精确相等，每present完整mountSHA，既有生命周期StopPandas会合法移除ns已核原installed代码。
实际新HCS管理员采集完成：parent vmwp nativebirth134360870964681909和vmmem134360870965622198稳定；System32vmwp完整hash62814079/MS签名；完整命令sha37bc785a、三token(absdrive/guid/opaque)，唯一GUID3aaab424-3094-4bb0-a07a-652f47171ad7，双HCS唯一WSL/Running/VirtualMachine id同GUID，runtimeOsType为null。原草案要求Linux因此原记录f11f84be statusunproven永不改。新的live producer只接受实际审定null型；Linux由guest固定osrelease/boot/PID1与当前knownmounts证明，不比较host/guest时间相等。
WindowsSystem32PS/wsl都是WinSxS硬link2。PS用原已支持safeFileDigest；wsl另精确system-role verifier actualfullSHA7e9f5cee/ValidMS/TrustedInstaller/nlink2+读前后identity，普通source/artifact单link仍拒，wsl不进genericop.files（bound systemrecord+verifier+collector进入）。NodeRoot已actual普通角色验证system文件不启动WSL；整个新admin wrapper与fullsource/package qualification仍待最后实际验证，fixture94/94不能称生产通过。生产动作仍0。
请逐条回应你的AGY5风险是否已处理，检查最终实际wrapper/guest/host/system模块是否还存在具体绕过，指出最小修正；不要求通用VM框架、不承诺分钟、不认可未做现场动作。旧f0/6989/source/package不可变，最终会另封19ops且只一次前Backup+一次新消费链同点隔离Restore，生产仍待用户精确批准。\n`;
for(const name of ['live-reference-audit.mjs','live-wsl-policy.mjs','live-wsl-host-policy.mjs'])prompt+='\nFILE '+name+'\n'+await readFile(new URL(name,base),'utf8');
prompt+='\n本轮三个完整核心模块；system-wsl-verifier主体在下一独立短段复审，不能据本轮意见声称读了该未附完整模块。';
assert.ok(prompt.length<29000,'Native argument reviewed size limit');
await writeFile(root+'SITE_AGY6_PROMPT.txt',prompt,{flag:'wx'});
const stdout=createWriteStream(root+'SITE_AGY6_STREAM.ndjson',{flags:'wx'}),stderr=createWriteStream(root+'SITE_AGY6_STDERR.log',{flags:'wx'});
await Promise.all([stdout,stderr].map(s=>new Promise((resolve,reject)=>{s.once('open',resolve);s.once('error',reject)})));
const startedAt=new Date().toISOString();
const child=spawn('C:/Users/86137/AppData/Local/agy/bin/agy.exe',['--conversation','a18e2b90-2dcc-4ed5-8a3b-c95793faae00','-p',prompt,'--mode','plan','--output-format','stream-json','--print-timeout','2m'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
child.stdout.pipe(stdout);child.stderr.pipe(stderr);
const status=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}))});
await Promise.all([stdout,stderr].map(s=>new Promise((resolve,reject)=>{if(s.writableFinished)return resolve();s.once('finish',resolve);s.once('error',reject)})));
await writeFile(root+'SITE_AGY6_CALL.json',JSON.stringify({startedAt,finishedAt:new Date().toISOString(),...status,promptSha256:createHash('sha256').update(prompt).digest('hex'),characters:prompt.length,productionActionsRequested:0},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(status));process.exitCode=status.code??1;
