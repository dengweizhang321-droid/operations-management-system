import {readFile,writeFile} from 'node:fs/promises';
const base=new URL('./',import.meta.url);
const probe=await readFile(new URL('Probe-ResidualProcessMetadata.ps1',base),'utf8');
const prompt=`独立文本复审，禁止执行任何工具、修改文件或生产动作。请直接输出中文结论，最多600字，不需等待更多材料。
用户授权核查阻断，但最终生产须另批准。已封存9e只读管理员包真实采集840进程，refs0/unknown5，原PS47936cwd可读且不指旧app.previous；这不是生产准入通过。剩5固定PID236/280/1700/6548/53880：只读0x1000普通权限全部error5，无类型数据。下方拟补充管理员读取extended基本信息和公开protection level，不读远程内存、不启Debug、不注入/杀进程，不改原9e/f0批次；解码null/error不能变成豁免。实际仍不改生产门禁。
WSL已经运行TERUISI-Pandas；/proc元数据诊断以teruisi-pandas执行33进程有权限缺口，随后root38进程0错误/0refs。仅cwd/exe/root/cmdline/mountinfo/fd链接，不读业务文件/不stop/start。存在Python默认site启动hook、running名单不等于epoch锁、hostalias/escaped mount/bind/其他namespace/瞬时fd未完整覆盖，所以不能用这两个成功数字让vmmemWSL自动豁免。后续入口已加-I -S，但未再执行，不追认前轮具备该保护。
请给具体风险/最小修正，尤其检查x64extended布局、ReturnLength、PID/birth关联、Win32保护级别class7。自当前普通权限探针无权，不能算布局现场验证。新补充包只读且不自动运行；需要明确范围才由用户现有管理员窗口执行。不要称某个OS名字/签名/模型同意等于无引用，也不要承诺分钟收益。
SOURCE\n${probe}`;
await writeFile('E:/codex-artifacts/release-site-blockers-20261011/SITE_AGY3_PROMPT.txt',prompt,{flag:'wx'});
console.log(JSON.stringify({characters:prompt.length}));
