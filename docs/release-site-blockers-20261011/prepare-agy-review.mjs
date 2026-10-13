import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root='E:/codex-artifacts/release-site-blockers-20261011',base=path.dirname(fileURLToPath(import.meta.url));
let prompt=`独立源码复审管理员只读现场采集包。真正AGY只做文本复审，不执行任何工具/测试/生产/文件修改；意见不等于事实验证或审批。
人类授权核清现场阻断，生产最终必须另等本人精确批准。当前包不是上线：只读进程PID/session/name/creation/image/command及scheduled-task动作，0x1000查询；只对已知PID47936额外0x0410读取bounded x64 PEB/RTL元数据cwd（内部结构版本不保证；跨native image/command检查及实例/身份校验，非内存dump）。权限不启Debug，不杀进程，不注入，不执行batch/lifecycle/PG/tasks变更。只CreateNew写指定E诊断/完成记录，raw cmd及cwd仅内存/pipe，输出SHA/ref/错误。
实际当前非admin，同user native读取补齐18项，833process/215task，剩179项均OpenProcess error5。原冻结guard eb01仍CIM-only，f0bb/6989 SourceV3/pkg21c不改。管理员采集不能承诺PPL/kernel unknown归零，也不自动让生产guard通过。所有cwd/handles/encoded/relative scripts不作全面证明。
既有受控15 C# decoder/创建时间case通过；PS5原transport UTF8/argv通过，但V1继承NODE_V8_COVERAGE真实多写1文件；V2清所有NODE_*已实测多写0。现在持有Node FileShare.Read从hash到child结束、只检查输出父链时点reparse、capturedcollector通过ScriptBlock执行、capturedevaluator dataURL执行；父启动源码应由主agent持只读句柄并核packet中launcherSHA后调用，不将任意可变-File视根信任。Windows UAC仅只读管理员权限确认，不构成生产批准。
首次cwd受控发现换行/错误identity未阻断，已要求PID47936、identityStable、同capture对应actor的CIMUTC、control字符及absolute drive，源码下方是修正版，最终小例验证另进行。请检查剩余具体漏洞/越权写入、PS5管道与wait输出、文件/identity边界、工作目录结构交叉检查及审批粒度；给触发条件/实际行或函数/最小修正。避免全时独占、100%或分钟承诺。
`;
for(const name of ['Collect-ProcessIdentity.ps1','evaluate-reference-capture.mjs','Start-ReadOnlyAdminAudit.ps1']){const raw=await readFile(base+'/'+name);prompt+='\nFILE '+name+' SHA '+createHash('sha256').update(raw).digest('hex')+'\n'+raw.toString()+'\n';}
if(prompt.length>29000)throw Error('Prompt too long for native CLI');
await writeFile(root+'/SITE_AGY1_PROMPT.txt',prompt,{flag:'wx'});console.log(JSON.stringify({characters:prompt.length}));
