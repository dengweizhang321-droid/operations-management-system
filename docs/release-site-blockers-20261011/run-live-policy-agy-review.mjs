import {readFile,writeFile} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const base=new URL('./',import.meta.url),root='E:/codex-artifacts/release-site-blockers-20261011/';
let prompt=`独立源码复审，只按本文给出中文结论(800字内)，不运行工具，不写文件，不操作生产。新会话、Node原生argv数组（受控字节接收器完整一致），避免旧PS5去引号问题。
目标为精确首次采用发布策略候选：用户要求一次前Backup＋一次新已安装消费链同点隔离Restore，无后DB；所有生产仍等最终批准。旧f0 batch/9e/bb861 readonly包不可改，不改正式包/source。当前只读核查五OS对象实际API0/64/layout/birth同基线、两个Microsoft系统image签名/hash成功。下面拟外置有限policy仅基于精确已审实例，绝非名字白名单；解释器/业务actor未知仍拒、已识别引用不能覆盖、所有完整源/包/路径/ACL/身份/互斥/排空/现场复验继续保留。
WSL真实8mount namespace，只有readonly drivers 9p、没有DrvFS/Windows盘；全部bounded proc读取一致37proc/0err，guestepoch前后一致。guest btime和Windows vmmem birth差2h11m，所以禁止用时间相等/扩大容差推host关联。新host关联helper使用官方ComputeCore API existing enumerate（无create/open/start/stop）；same-handle parentvmwp native image/command GUID、精确Windows签名和hash、nativebirth/CIM双验，与双HCS唯一WSL RuntimeId关联。普通权限HCS完成0x8037011b/进程error5，尚未有管理员真实关联证据；新sealed readonly admin包需要另行允许，不偷偷提权。缺证仍blocked，不以fixture/模型意见当现场通过。
请找具体最小修正和危险反例：伪造字段、遗漏kernel argv目标、错误状态/指针、HCS返回空或identity race、System32父链换绑、newnamespace/mount变化、误称无副作用。范围明确支持现有无Windows盘guest，不先造泛化框架。生产guard包装尚未最终封存、pipeline仍工作中，不能替它给最终许可。\n`;
for(const name of ['live-os-instance-policy.mjs','live-wsl-policy.mjs','Probe-WslHostAssociation.ps1'])prompt+='\nFILE '+name+'\n'+await readFile(new URL(name,base),'utf8');
assert.ok(prompt.length<25000);
await writeFile(root+'SITE_AGY5_PROMPT.txt',prompt,{flag:'wx'});
const output=createWriteStream(root+'SITE_AGY5_STREAM.ndjson',{flags:'wx'}),error=createWriteStream(root+'SITE_AGY5_STDERR.log',{flags:'wx'});
await Promise.all([output,error].map(s=>new Promise((yes,no)=>{s.once('open',yes);s.once('error',no)})));
const startedAt=new Date().toISOString();
const child=spawn('C:/Users/86137/AppData/Local/agy/bin/agy.exe',['-p',prompt,'--mode','plan','--output-format','stream-json','--print-timeout','2m'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
child.stdout.pipe(output);child.stderr.pipe(error);
const result=await new Promise((yes,no)=>{child.once('error',no);child.once('close',(code,signal)=>yes({code,signal}))});
await Promise.all([output,error].map(s=>new Promise((yes,no)=>{if(s.writableFinished)return yes();s.once('finish',yes);s.once('error',no)})));
await writeFile(root+'SITE_AGY5_CALL.json',JSON.stringify({startedAt,finishedAt:new Date().toISOString(),...result,promptSha256:createHash('sha256').update(prompt).digest('hex'),characters:prompt.length,productionActionsRequested:0},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(result));
process.exitCode=result.code??1;
