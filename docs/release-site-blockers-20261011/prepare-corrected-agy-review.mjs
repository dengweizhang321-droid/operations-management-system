import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const base=new URL('./',import.meta.url);
let prompt=`继续独立文本复审，只阅读本提示词，不运行工具，不修改文件/生产。
更正传输：上一轮主agent使用PS5 native argv。受控Node接收器证明 intended SHA ac1b1561…，received7e3f287c…，16个双引号全部丢失；这不能直接证明Go AGY实收字节，但足以否定上一轮C#缺引号结论。本轮改Node spawn argument array传入，受控receiver完全一致。原code DLL及x8都确实有双引号，不能将旧文本传输失败当源错误。
当前实际self NtStatus0/ReturnLength64/Size64/PID一致，ProtectionNONE0xfffffffe成功；目标5PID普通token5/5error5。Astra与主agent拒绝未有primary/实测支持的48长度及WMI1ms容差，维持64/同native句柄birth/基线exact/两CIM微秒匹配失败关闭。官方跨平台无法读则unknown，不为求绿扩大条件。
新V2只增加两个已知PID exact System32实际运行image+hash/signature，不是行为无引用证明，系统签名可沿系统trust/revocation配置，不能保证无网络。新包仅在用户现有管理员窗口手工执行；不RunAs不修改9e/f0/生产guard。实际生产仍blocked，0维护/服务/备份/演练/调度动作。
请读Astra答复和最终probe/封包generator，逐条回应你上一轮的分歧，指出最终具体漏洞/最小纠正，最多700中文字符。不认可没有证据的白名单或放宽要求，不需批准生产。\n`;
for(const name of ['ASTRA_RESIDUAL_METADATA_AND_WSL_REVIEW.md','Probe-ResidualProcessMetadataV2.ps1','prepare-residual-admin-entry.mjs']){
 prompt+='\nFILE '+name+'\n'+await readFile(new URL(name,base),'utf8');
}
assert.ok(prompt.length<24500,'Native prompt exceeds reviewed bound');
await writeFile('E:/codex-artifacts/release-site-blockers-20261011/SITE_AGY4_PROMPT.txt',prompt,{flag:'wx'});
console.log(JSON.stringify({characters:prompt.length}));
