# 管理员采集 V2 / 单 PID cwd 复审

2026-10-11。仅只读源码复审与受控测试，未运行管理员 bootstrap、UAC 或原生进程采集。审核版本：collector `89030f1752b0c6201cb9140da84b39f6b1fac5dac134909ccc44d135c8cf4926`；evaluator `590fa05aed9baedb790bec65ab5f7d4852d7b50db6ae37365c4246b67ed4e00d`；launcher `247885399d23814093fef77c5313d2a0e0c49e932249fa97b2dbf3f927c117f3`。后续修改需另行绑定，不属于本记录签名。

## 三项前轮修补

源码确认：清理全部继承 NODE_*；Node 以 FileShare.Read 打开后从同一流 hash，并持有至子进程正常完成；三输出固定 E 根、父链 reparse 检查、CreateNew。重用实际 PS5 transport 的受控测试：参数/UTF8 往返通过，coverage 额外写入由 V1 的 1 变为 V2 的 0。

结果 `E:/codex-artifacts/release-site-blockers-20261011/ASTRA_ADMIN_LOADER_PS5_V2/result.json` SHA256 `17f88bbe4a699691440a82263a140e7ded9f403b1e1d4ee2d6e65b939df273b7`。只运行 dummy evaluator，没有运行 collector。父链检查是采集前时点检查，不是目录连续排他锁；不要声称覆盖第三方在检查后替换所有祖先的情况。安装目录与 Windows 加载器信任仍是前提。

## cwd 读取范围

新增 0x0410 只用于 PID 47936，权限是 QUERY_INFORMATION 与 VM_READ；不是原 0x1000 查询。V2 packet 的批准范围必须明确这一变化。代码限定 x64、拒绝 WOW64，核 NtBasic 返回长度与 PID；读取 PEB/process-parameters 的有界字段，再读取 cwd 两次和 image/command。单次 Read 上限 65536，Unicode 长度/maximum 为偶数且不超界；native image/command 要匹配，GetProcessTimes 与 CIM 创建时间关联，失败不产出 readable。没有进程注入、写内存、终止或转储。

这是当前 x64 内部布局的有条件兼容，不是跨 Windows 版本保证；两次 cwd 字符串相等也不等于核验目录 HANDLE、其他已开句柄、模块或全系统引用。整体失败应保持未知，不改用进程名豁免。

## 必须补的消费边界（已复现）

evaluator 当前只检查盘符前缀，再调用原 predicate。原 predicate 跳过含 CR/LF 的路径 token，因此合成 `C:\safe` 加换行被接受为 `refersToPrevious=false`。同时 readable=true、PID=1、identityStable=false 的合成 DTO 也通过该分支。后者不是当前固定 collector 的正常输出，但消费边界不应只依赖 readable 字段。

必要修补：显式要求 PID=47936、identityStable=true，拒绝 cwd 中 CR/LF/NUL，并保留所有路径解析失败的 blocked 结果。选定采集的创建时间应与本次全量 process 记录中的同 PID 实例关联；至少保留 selected native FILETIME 字符串/CIM UTC，使离线审核可重算，避免分段采集拼接不同 PID 实例。

实际 `test-admin-cwd-consumer.mjs` 提取当前 selectedCwd 分支及冻结 guard 路径 predicate，仅把 realpath 换为返回输入的合成 resolver。五例：普通绝对路径允许、目标路径阻断、不可读阻断；换行路径与错误 identity 两例未阻断，作为缺口证据保留。该测试不读取真实目录、不证明 Windows 现场路径。

结果 `E:/codex-artifacts/release-site-blockers-20261011/ASTRA_CWD_CONSUMER_V1.json` SHA256 `b33a4f3a4642e35e90722730b5ce47c62c0a08d6a8be64a1f267fdebf6e3a721`。没有伪称全通过；修复者应另存新结果。冻结 guard/f0bb/SourceV3/pkg21c 均未更改，诊断也不授予生产执行资格。
