# 管理员只读记录与五个剩余对象复审

2026-10-11。仅读取已生成记录、核对数字并查官方资料；未再次启动采集、WSL、服务、调试器或生产流程。结论是 **记录一致，仍然 blocked**，不批准生产动作。

## 原始记录核对

| 文件 | SHA256 |
| --- | --- |
| ADMIN_READONLY_PACKET_V2.json | `9e906d1e53ee9acf67b909be0198520e137d9cc08d1b8fbc3aa5adf7f709df38` |
| ADMIN_READONLY_COMPLETED_V1.json | `cb3f1605238bf94eafc19f9f8fcbdeb30fb2461f00903f46daac9792c5d95310` |
| ADMIN_REFERENCE_DIAGNOSTIC_V1.json | `4e964f0ec062f07115728dc5cb09ec05a3a794a09a29f865494927dd8b3dbd69` |
| ADMIN_CAPTURE_SUMMARY_V1.json | `35081bb894944f358ed14589a005294a4fbbb3032a1f57e25aa51f85385379f2` |

completion 的 packetSHA 与实际原包一致，result 内嵌 captureSummary 与独立 summary 深度相等；原 guard SHA 一致，collector/evaluator/launcher 当前字节仍与包记录一致。采集、结果、完成时间顺序为 12:59:00.2124363Z、12:59:01.066Z、12:59:01.0899439Z。840 processes、17 fallback、0 changedDuringCapture、0 已识别引用、5 unknown；unknown 名单和原因与主 agent 提供内容一致。三个记录均不报告生产变更。

以 BigInt 重算六个实例的 FILETIME 与 CIM UTC，按微秒相等；PID 236/280/1700/6548/53880/47936 的差分别为 0/5/6/4/8/5 个 100ns tick，均属于 CIM 微秒精度截断。47936 readable、identityStable 为 true，refersToPrevious=false，cwd 只保留 SHA。不能据此推论该进程所有句柄、模块、后续交互命令都无引用。

可复核脚本 `verify-admin-records.mjs`；输出 `E:/codex-artifacts/release-site-blockers-20261011/ASTRA_ADMIN_RECORD_CROSSCHECK_V1.json`。此核对没有原生查询。completion 未内嵌 resultSHA，完整 process/image 原始字段未保留，因此本次记录一致性核对不能独立重放全部 predicate，也不是当前现场状态的连续证明。

## 最小可信识别路线

共同前提：任何进一步元数据读取都绑定相同 PID 的创建时间、同一句柄及原始返回码；拒绝名字单独豁免。新采集若超出 9e 包范围须单独声明，不修改原包或 f0 guard。

| 对象 | 已证事实 | 最小补证与边界 |
| --- | --- | --- |
| LsaIso 1700 / NgcIso 6548 | predicate 已走到 command-unreadable；image 查询无错误，但物理路径未存；Nt60 两次均 `0x8000000d` | 可重取同实例镜像物理路径、文件 hash/签名，并读取系统提供的 secure-process 标志。当前结果不能倒推出路径就是 System32，也不能由名称断言 IUM。 |
| Secure System 236 | imageError=31，Nt60=`0xc0000225`，创建时间关联成立 | 可补系统 secure/protection/subsystem 类型元数据及 VBS 状态作为旁证；VBS 在运行本身不识别这个 PID。若类型接口不可读/不支持，仍保留 unknown。 |
| Registry 280 | 同上；不是 PID4 的现有特例 | Microsoft 说明 Registry 类别属于替内核保存 hive 数据的 minimal process；本机 PID 身份仍需 OS 类型证据。未找到可凭标准 Win32 名称字段直接证明该 PID 为 minimal process 的规则，不能扩充名称白名单。 |
| vmmemWSL 53880 | 同上，单个 Windows PID 无用户镜像/命令 | 先做现有计算系统/发行版的只读关联，再界定 guest 引用覆盖；宿主对象特殊不代表 WSL guest 不会引用目标。 |

Microsoft IUM 文档给出了通过扩展 basic process 信息成功返回后的 `IsSecureProcess` 标志识别 IUM 的示例；这是比名字更可靠的类型证据。文档示例使用 WDK/Zw 接口，用户态适配仍须精确布局、长度、状态和实例校验，不能直接假定所有平台稳定。该文档也明确不应尝试附加、注入或访问 trustlet 的隔离内存。[IUM 官方文档](https://learn.microsoft.com/en-us/windows/win32/procthread/isolated-user-mode--ium--processes)

公开 `GetProcessInformation(ProcessProtectionLevelInfo)` 可查询保护级别，但保护级别不是具体用途/无引用证明，PPL 与 IUM 也不能混为一谈。签名仅核实具体文件来源；不等于该运行实例绝不接触目标。对于两个 image 可读对象，应把这些独立维度与创建时间、物理路径一并保留。[GetProcessInformation](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocessinformation)、[保护级别结构](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/ns-processthreadsapi-process_protection_level_information)、[文件签名查询](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.security/get-authenticodesignature)

NgcIso 与 Windows Hello 隔离组件的对应有正式文档；LsaIso 与 Credential Guard 的对应也有正式文档。但这两个类别说明都不能代替本机具体实例识别。只读 Win32_DeviceGuard 的 SecurityServicesRunning/VirtualizationBasedSecurityStatus 可作为背景旁证，无需切换安全设置。[Windows Hello ESS](https://learn.microsoft.com/en-us/windows-hardware/design/device-experiences/windows-hello-enhanced-sign-in-security)、[Credential Guard 运行状态](https://learn.microsoft.com/en-us/windows/security/identity-protection/credential-guard/configure)、[Registry 进程官方说明](https://blogs.windows.com/windows-insider/2017/12/19/announcing-windows-10-insider-preview-build-17063-pc/)

两个 NTSTATUS 的正式定义分别是 partial copy 与 not found；它们说明查询未取得所需信息，不是“无业务引用”状态。imageError 31 也不提供对象类别证明。[NTSTATUS 定义](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-erref/596a1078-e883-4972-9bbc-49e60bebca55)

## WSL 必须单独保留的缺口

WSL2 在 utility VM 中运行 Linux，guest 进程拥有独立 PID/mount namespace；Windows 普通进程扫描不能覆盖这些 namespace。Windows 驱动器可通过 DrvFS 访问，因此 `/mnt/d/teruisi-runtime/django-sales/app.previous` 或 mount/bind/相对路径可能形成 guest cwd/脚本/任务引用。名字叫 vmmemWSL 不能自动免除这一面。[WSL2 架构](https://learn.microsoft.com/en-us/windows/wsl/about)、[Windows 文件访问权限](https://learn.microsoft.com/en-us/windows/wsl/file-permissions)

最小只读第一步可使用既有 WSL list/status 或 `HcsEnumerateComputeSystems` 的现有系统枚举来关联状态；HCS 返回 S_OK 只表示枚举操作启动，还必须检查最终结果。此类宿主枚举仍不证明 guest 无引用。[WSL 命令](https://learn.microsoft.com/en-us/windows/wsl/basic-commands)、[HCS 枚举](https://learn.microsoft.com/en-us/virtualization/api/hcs/reference/hcsenumeratecomputesystems)

若需 guest metadata 取证，应另行限定为已运行实例、特定 PID/挂载/cwd/任务元数据，不能为了查引用而启动停止发行版、执行 shell profile 或读取业务文件。本轮没有执行这些命令，也不建议通过关闭 VBS/WSL/安全进程来消除 unknown。冻结 f0 guard仍未采用任何新增类型识别；形成可执行准入规则前必须有明确、有限的新证据合同与独立复审。
