# 现场进程引用阻断：Astra 只读复审

日期：2026-10-11。作者为本轮独立代码复审者及受控测试作者；没有执行管理员采集、生产动作或新 guard 部署。本记录不批准维护切换。冻结 f0bb scope、6989 entry、SourceV3/pkg21c 与原 guard 均未修改。

## 已核事实

原 `adoption-scope-guard-ig04.mjs` SHA256 为 `eb01db494d47d8e376af8d4a5fc69e823bbcf72672bdfbaf7f80a1cc914882bd`，生产合同仍只读取 CIM。它要求 PID、SessionId、Name、ExecutablePath 及相关进程的 CommandLine，拒绝类型错误、缺失镜像、名称/镜像不一致和物理路径无法解析。有限 Windows 原生例外同时要求精确物理 System32/SysWOW64 路径；进程名本身不能豁免。解释器命令不可读不能放行。

历史快照 `NATIVE_IG04_AUDIT_20261011T105714306Z.json`（SHA256 `cf68e8283b9aef27c0f0323e8c8aaf2011324bee4294f3038e25e9ec4128b31c`）是 852 个进程、215 个任务、0 个已识别引用、198 个 unknown；198 项均先失败于 `missing-or-invalid-executable`。这不证明命令行也全部不可读，更不证明 198 个实际引用。

主 agent 后续诊断 `NATIVE_REFERENCE_DIAGNOSTIC_SECOND.json`（SHA256 `bea5c7aa559e1773ba63ec1c7c24f50cc93b9c3078a90d195338edd2f951d0c8`，11:27:12 UTC）为 833 个进程、215 个任务，18 项使用 native fallback，0 个已识别引用、179 个 unknown。逐项复核：179 项全为上述镜像缺失原因，且 OpenProcess 错误均为 5。不同时间的两个集合不能直接相减得出消失进程数。当前状态仍是 blocked。

首次单点探针 PID 47936/37392 获得非空命令，NtStatus=0；47936 命令 57 字符、SHA256 `844ff0d342cb9a8b070b0b13da5eb6884bf9672afeceaba3524d2652eeeefb33`。没有目标字面量只是一项观察，不能证明不存在短路径、junction、相对路径、cwd 或打开句柄引用。

## 最小取证路线及实现复核

Microsoft 的 Win32_Process 文档给 ExecutablePath 标注 SeDebugPrivilege；QueryFullProcessImageName 支持较小的 PROCESS_QUERY_LIMITED_INFORMATION。因此 CIM 缺字段而 native 读取成功是合理的权限/提供程序差异，不能直接断言原 guard 逻辑误报。[Win32_Process](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-process)、[QueryFullProcessImageNameW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-queryfullprocessimagenamew)

本轮 `Collect-ProcessIdentity.ps1` SHA256 `3a9a1f2d3397782ca6355d2619f37fd6f53d81c2debecc236ebe3ad04adb4e8d` 已修正首次探针两个缺口：使用同一个 0x1000 句柄取得镜像、两次命令与前后创建时间；只有非空 CIM CreationDate 与 native FILETIME 按 UTC 微秒精度相同，且前后 CIM PID 对象的 Name/SessionId/CreationDate 相同，才补齐缺失字段。FILETIME 为 100ns，CIM 日期为微秒；按微秒截断比较有明确依据，不应改成宽松秒级容差。[GetProcessTimes](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocesstimes)、[CIM DATETIME](https://learn.microsoft.com/en-us/windows/win32/wmisdk/cim-datetime)

脚本限定 x64；第二次返回长度、偶数 Length/MaximumLength、header 后 Buffer 起点及分配区尾界均检查；非零最终 NTSTATUS、空白命令、无效布局不补齐。`NtQueryInformationProcess(60)` 未列在该 Microsoft 公开函数文档的枚举说明中，且文档明确该接口可能变化。当前主机实测成功只能证明本机此次兼容，不构成跨版本保证。[NtQueryInformationProcess](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntqueryinformationprocess)

若进入后续审批材料，建议保留每个失败 API 的原始错误、两个 sizing/data NTSTATUS、准确的 native 创建时间十进制字符串及 CIM UTC 值。当前诊断主要保留关联布尔值，不能离线重新计算全部关联。不要把 FILETIME 写成 JavaScript number；它超出安全整数范围。第一次 sizing 调用当前只用有界长度决定是否继续，最终返回仍必须成功；不得把 sizing 错误标签概括成成功。无需据此改动冻结制品。

主 agent 提议的人类确认后管理员只读采集，是针对剩余 access-denied 的具体取证措施。应固定脚本、Node、原 guard hash，并继续仅请求 0x1000、不启用 Debug 权限、不执行 batch/lifecycle/数据库/任务动作。管理员令牌不保证所有对象可读；受保护进程、内核对象和进程退出等仍可留下 unknown。权限拒绝不是无引用证据；不能用名字列表消除这些残余。[进程访问权限](https://learn.microsoft.com/en-us/windows/win32/procthread/process-security-and-access-rights)

## 危险反例与合同边界

- PID 被复用或 CIM 返回旧实例：同一来源前后相等仍不足，必须 native/CIM 创建时间关联。首次独立单点脚本缺此关联，不能用其 identityStable 单独签批；最新批量脚本已补。
- `powershell.exe` 镜像合法但命令为空，或厂商进程叫 `svchost.exe`：名称、签名或系统风格名称不能证明不相关。
- 目标经跨盘 junction、8.3、带空格路径或不存在的子文件引用：继续执行原物理 realpath/最近现存祖先规则；不得仅搜索目标字符串。
- `powershell -File .\job.ps1`、编码命令、环境变量或启动后交互命令：完整启动命令并不覆盖 cwd、环境展开、模块、句柄或交互历史。原 predicate 也没有这些能力，诊断不能宣称全面“零引用”。
- 进程在观察后变化/退出：诊断是时点证据，不是连续排他锁；动作前原 ownership/身份/引用门禁仍需执行。
- native fallback 仅改变诊断输入来源；冻结 f0bb 的可执行 guard 没有使用它。要把补充采集纳入执行门禁，必须另审新外置 guard、绑定新 scope 并取得精确授权，不能据诊断结果直接执行旧批次。

## 受控验证

`Test-NativeDecoderBoundary.ps1` SHA256 `2ed5c6f1e2053f129bd8d9a2965c030bd92a186ef5f4da5b99eae6c53335b51b` 从上述实际脚本提取完整 C# 类型，保留 `Command`/`SameCreation` 函数原文，仅重命名测试类型、将 Nt transport 声明替换为内存响应 fixture。未调用进程原生查询；不是现场证明。

15 项通过：正常 Unicode 响应，NTSTATUS 拒绝，返回长度小于 header/大于 allocation，奇数长度，奇数 maximum，length 超 maximum，Buffer 落 header 内/超过尾部，maximum 超尾部，空/空白命令，以及同微秒、跨微秒、PID 复用时间三个关联案例。PowerShell 采集和 null 条件另经代码复核，未伪称本测试覆盖整个原生现场链。

结果 `E:/codex-artifacts/release-site-blockers-20261011/ASTRA_NATIVE_DECODER_CONTROLLED_V1.json` SHA256 `bf0e3dadbdbb54fd116487b2eb0b755704a4fec76437bf6c22b70da23da21271`。首次指定 PowerShell 7 路径不存在，测试未开始；原事实保留在 `ASTRA_NATIVE_DECODER_FIRST_LAUNCH_FAILURE.txt`，随后在当前 PowerShell host 运行通过。没有重跑全树、构建或生产 HTTP。
