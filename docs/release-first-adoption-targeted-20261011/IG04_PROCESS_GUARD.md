# IG04：缺失进程字段不得当作无引用

外置guard从原04655副本创建，原文件与三核心／任何候选不改。新query增加Name、SessionId；实际旧循环对PID47936、System32 PowerShell、CommandLine=null得到零引用的缺口已在受控输入复现，新循环产生process-unknown。

解释器／宿主（Node、Python、PowerShell、cmd、cscript/wscript、mshta、dotnet、Java、workerd、rundll32等）以及物理受管runtime／项目进程缺cmd均拒绝。任何进程的PID/Session类型、Name、ExecutablePath类型或Name-basename明显矛盾、物理exe不可读也拒绝。

窄例外仅有：Idle PID0和System PID4须精确Name、Session0、无矛盾exe/cmd；原生svchost/services/lsass/wininit/winlogon/csrss/smss/dwm/fontdrvhost须提供与Name一致的exe且realpath精确落在C:/Windows/System32或SysWOW64相同文件名。该类才允许cmd缺失。任意vendor或仅Name不能宣称无引用；字段完整的无关native仍按原物理路径规则检查，不一律拒绝所有进程。

34/34受控测试（原16路径+18进程），218ms。合成realpath映射不能冒充本机真实junction或完整依赖图；不解释任意脚本、编码命令、DLL/registry间接引用，不读取安全日志、不提权、不杀／关闭进程。实际native只读核验由主任务执行，unknown即具体阻断。

新guard SHA `eb01db494d47d8e376af8d4a5fc69e823bbcf72672bdfbaf7f80a1cc914882bd`。E/ASTRA_GUARD_IG04_HANDOFF.json SHA `181383b04b5100e5e1cf0cc6512067a42cb9841fc71d3637fe405298a56c063e`。仓库adapters内测试只把新guard相邻文件名改到同字节源，旧复现仍读保留的原guard；原实际执行脚本与日志在E留存。
