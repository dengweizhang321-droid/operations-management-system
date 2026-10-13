import {readFile,writeFile} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
const base=new URL('./',import.meta.url),root='E:/codex-artifacts/release-site-blockers-20261011/';
let prompt=`独立最终边界复审（fresh conversation），不运行工具、不修改文件或生产，直接中文给具体意见最多700字。
TERUISI首次采用19op候选仍生产未批准，一次前Backup/一次新consumer同点isolatedRestore，无后DB。旧f0/6989/pkg不变。管理员只读已原始采五native/唯一HCS→parent vmwp GUID→Linux guest，allbirth exact/原OS文件hash+MS签名; wrapper捕获/pin实际PS源码执行，拒旧JSON，不人填bool。
新完整admin wrapper首跑7c6必须保留失败：16.202sec，core pins/nativeCIM/前HCS成功，但btime1791621407 vs冻结1791621408差1秒，boot_id/PID1start122/osrelease完全相同。Linux fs/proc/stat.c调用getboottime64, kernel/time/timekeeping.c明确这是walltime of boot/settimeofday会影响；不是稳定实例ID。现改身份严格boot_id+PID1start+osrelease，btime只有效正整数diagnostic before/after/changed，不用加大Windows100ns FILETIME/CIM/NT返回长度容差，也不猜这次具体时钟调整原因。
另原采集changedDuringCapture4，对应4未知PID随后CIM不存在。不能说唯一btime或忽略unknown。拟新producer只对不稳行0x1000 kernel补证：OpenProcess失败87可证明这次PID不存在；error5/其他error仍unknown。成功handle必须GetProcessTimes出生与原CIM微秒绑定，GetExitCodeProcess查询成功且!=259才标departed；259(仍active)、失败、新birth/PID复用仍unknown并不豁免任何现存行/目录引用/原领域owner。没有杀任何生产进程，受控真实短命test只管自己的child。新actor未采/字段不可读照常失败关闭。不得以进程名/PID白名单或TTL填值。
请特别检查：GetExitCodeProcess 259真实退出码歧义必须保守unknown；PID87→新Actor竞态不能吹连续全OS排他，仍批准范围内维护与原现场recheck；native tuple+role/provenance不得被自由JSON替代。已审known mount namespaces允许非空子集仅因原维护StopPandas会停owned service/container，集合必须完整覆盖本次全部pid/namespaces，rawmountbytes不变，无Windows盘；未知和无证nsfd拒。现场模型意见不当生产验收/恢复结果。
是否有必须纠正的具体安全问题？任何跳过活进程或按名字放行的建议不可采。\n`;
for(const name of ['live-wsl-policy.mjs','live-wsl-host-policy.mjs'])prompt+='\nFILE '+name+'\n'+await readFile(new URL(name,base),'utf8');
await writeFile(root+'SITE_AGY7_PROMPT.txt',prompt,{flag:'wx'});
const stdout=createWriteStream(root+'SITE_AGY7_STREAM.ndjson',{flags:'wx'}),stderr=createWriteStream(root+'SITE_AGY7_STDERR.log',{flags:'wx'});
await Promise.all([stdout,stderr].map(s=>new Promise((yes,no)=>{s.once('open',yes);s.once('error',no)})));
const startedAt=new Date().toISOString();
const child=spawn('C:/Users/86137/AppData/Local/agy/bin/agy.exe',['-p',prompt,'--mode','plan','--output-format','stream-json','--print-timeout','2m'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
child.stdout.pipe(stdout);child.stderr.pipe(stderr);
const status=await new Promise((yes,no)=>{child.once('error',no);child.once('close',(code,signal)=>yes({code,signal}))});
await Promise.all([stdout,stderr].map(s=>new Promise((yes,no)=>{if(s.writableFinished)return yes();s.once('finish',yes);s.once('error',no)})));
await writeFile(root+'SITE_AGY7_CALL.json',JSON.stringify({startedAt,finishedAt:new Date().toISOString(),...status,promptSha256:createHash('sha256').update(prompt).digest('hex'),productionActionsRequested:0},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(status));process.exitCode=status.code??1;
