# 有限 live guard 实现交接

**最新冻结是 HANDOFF_V6，128/128。** 只增加真实管理员观察支持的第九个精确 namespace/raw-SHA pair；详见 `ASTRA_EXACT_NINTH_NAMESPACE_REVIEW.md`。以下旧版本文字均用于历史追溯，不能作为当前执行绑定。

**当前最终交接为 HANDOFF_V4：Node122/122，真实私有短命进程5/5。** 新增最小kernel departure补证，仍不追认首次7c6的四个unknown；见 `ASTRA_DEPARTURE_HANDOFF_AND_AGY7_8.md`。以下V1–V3保留为历史。

**最新修正：当前应使用 HANDOFF_V3，106/106。** V2的固定btime比较在真实管理员QA失败，已按Linux官方语义改为诊断字段；详见 `ASTRA_BTIME_IDENTITY_CORRECTION.md`。下文保留各版本历史，不应把早期冻结SHA或测试结果用于新执行。

2026-10-11，Astra 实现。**当前冻结清单为 `E:/codex-artifacts/release-site-blockers-20261011/ASTRA_LIVE_GUARD_CORE_HANDOFF_V2.json`**；V1 保留为生命周期子集调整前的历史版本。这里只是新外置 guard 与依赖，**没有修改 SourceV3/pkg21c 的原10运行文件，也没有修改旧 f0/9e/6af 或原记录**。完整管理员 live wrapper 尚由主 agent 做独立只读验证；本交接不批准生产。下文89例与初版SHA属于V1记录；V2最终为94/94，精确当前SHA以V2清单及本文末附记为准。

## 最终代码与调用合同

`adoption-scope-live-guard.mjs` 从原 ig04 单独复制，保留原 batch/plan/WAL/WorkerApply/前后 Django 库存、previous 保全、状态文件引用扫描及最终 WAL 核对。只替换进程/任务引用采集部分，并增加新外置文件与证据的 mandatory op.files。其 SHA256 为 `639b93128c68cf610f9570d773359d68f9eb8c12e9864a3dbce92d33ee4f48d3`。

`live-reference-audit.mjs` SHA256 `e12c4866b9995926f70a94973e0c0b064d329f98116f5cef37f4233af84ce856`。使用已有原 predicate，由已验证的 guard 内部传入；CLI/批次数据没有选择 callback、receipt 或 saved inventory 的开关。普通来源文件要求普通单链接、无 reparse/别名、stat bracket 与固定SHA；policy以捕获字节 data URL 导入。PowerShell用捕获源码+固定hash的stdin封装，literal bootstrap 验证同一批准SID与管理员角色，不自动提权。实际调用原采集器与新 live HCS，不能用保存的 JSON 代替执行。

采集在固定 E `_live-reference-observations` 下 create-only 保存 started/result/failure，以及各固定 collector 的脱敏输出。命令、cwd、fd 原文只留内存/管道。错误的 stderr 仅保留hash；失败存证失败也附在原错误，不能变成成功。文件记录以随机 runId 关联各阶段，不声称是全系统连续快照或互斥锁。

native 规则仅接管四个明确的 OS 实例和一个需额外闭合的 vmmem 实例：固定 PID/birth/Session/native完整形状，两 IUM 另核实际系统镜像/精确hash/Windows签名。任何非空CommandLine均不能使用这些元数据缺失特例，原引用检测先执行，已识别引用不可覆盖。其他解释器/vendor/业务actor未知全部拒绝。

## WSL 与 HCS

guest 只支持已审的唯一发行版、固定 boot_id/PID1-starttime/kernel与8个namespace的完整mountinfo指纹。现场当前无 Windows drive mount，唯一9p是只读drivers；新增namespace/挂载明确不支持，未构建通用mount解析器。Windows路径与常规 `/mnt/<drive>` 文本仍送原physical predicate处理，UNC/模糊嵌入映射拒绝。

`collect-live-wsl.py` 通过固定 `/usr/bin/python3 -I -S -` 运行，读取 `/proc` 元数据；对PID清单、starttime、flags、namespace、mountinfo、cwd/exe/root、argv、fd做前后检查。PF_KTHREAD 用 stat field9 的 `0x00200000`，非kernel必须有非空argv和exe；真正kernel可缺exe但其他路径仍检查。[Linux PF_KTHREAD 定义](https://github.com/torvalds/linux/blob/master/include/linux/sched.h)、[proc stat 字段](https://man7.org/linux/man-pages/man5/proc_pid_stat.5.html)

HCS 新源为 `Collect-LiveWslHostAssociation.ps1`（`66720076…`），从4b另建，原4b/6af保持。仅接受已观察到的单 RuntimeId、完整commandSHA、三个参数类型/hash、parent精确native birth、双HCS完整record。`runtimeOsType=null` 是明确已审形态；Linux身份来自guest的固定osrelease/epoch，不伪造HCS字段，也不按btime差值猜host关系。旧 `f11f84…` 记录仍为unproven，新validator拒绝其旧version/status。

live wrapper 在guest采集前后各执行一次新host collector，合计4次既有系统枚举；两次父/子实例与HCS tuple还须完全一致。没有HcsCreateComputeSystem/Start/Stop、注入、VM内存读取或WSL生命周期操作。此查询次数和范围应进入最终精确只读/生产批准说明。

## 系统二进制边界

实际 System32 PowerShell 与 wsl.exe 的 nlink 都为2。PowerShell改用原已支持 exact WinSxS 系统工具合同 `impact.safeFileDigest`，不改safeRead。

wsl.exe不加入generic op.files，也不放宽artifact。固定单链接 `SYSTEM_WSL_IDENTITY_V1.json`（`0979916b…`）、专用 `system-wsl-verifier.mjs`（`96a975a0…`）和捕获collector（`b74dea48…`）入闭包。该验证器只认唯一 System32 路径、固定全文件SHA `7e9f5cee…`、微软签名、TrustedInstaller owner及实际nlink=2；普通源仍必须nlink=1。实际hash/signature读取期间持拒绝write/delete sharing句柄，WSL调用前后再核fullSHA与dev/ino/nlink/size/mtime/ctime稳定。它不是跨整个调用的连续目录/全系统排他锁，系统信任前提不变。

## 验证与实际限制

- 最终相关 **89/89**：native tuple/引用不得覆盖、空argv/kernel标志、namespace/成员/路径变化、实际原predicate接缝、HCS nullable schema/失败旧record/UID/命令/父birth、system-tool错路径/漂移/普通hardlink、源码伪造与实际普通token bootstrap拒绝。
- 日志 `ASTRA_LIVE_HCS_SYSTEM_INTEGRATION_FIRST_TEST.log`；PS5真实新HCS源码AST与C#编译通过，`ASTRA_LIVE_HCS_COMPILE_V1.json`，nativeCalls=0。
- 实际guest flags版只读采样：37进程、成员相等、errors0、8mount指纹一致；`ASTRA_LIVE_GUEST_FLAGS_OBSERVATION.json`。仅guest-shape通过，未声称当时已执行完整管理员wrapper。
- 正例里的完整host live frame是明确的受控fixture，改了测试输入version/status以模拟新producer；原失败记录未改写。这个单元测试不能替代后续真实live执行。
- 原生/WSL会随维护与后台活动变化；任何未支持状态变化阻断，不重试找green、不放松窗口或自动关闭进程。

## AGY5 交叉回应

原文保存于 `SITE_AGY5_STREAM.ndjson`，conversation `a18e2b90-2dcc-4ed5-8a3b-c95793faae00`。

| 意见 | 处理与事实修正 |
| --- | --- |
| MaximumLength超分配必为误判，建议只检查Length | 未采纳。没有本机实测失败/适用primary证明要求放宽；当前真实命令已多次可读。新HCS helper额外做指针对齐收紧，不以模型断言代替接口事实。 |
| 单独policy函数检查字段不能证明provenance | 接受。新增实际wrapper捕获/pin闭包、执行native、同SID/Admin门与失败证据。测试证明伪JSON不能替换PS源码；不是往JSON再加几个SHA字段就获得可信采样。 |
| kernel空argv应看stat标志，非kernel拒空 | 接受并已实现/测试。但旧代码仍检查cwd/exe/fd，不能把先前不足夸大成“完全不经过任何路径检查”。 |
| HCS任意GUID包含过宽 | 接受。现在只接受实测唯一GUID、完整commandSHA及三token形态，并对guest前后执行完整host查询。 |
| 硬编码PID就是PID复用漏洞 | 不同意该概括。PID同时钉native birth与实时CIM/native关联；重启/复用会拒绝。只做单独PID名字白名单才是不足。 |
| namespace固定会拒绝动态变化 | 是本次明确支持边界，不是静默扩大允许范围的理由。 |
| 只读脚本完全无副作用 | 不作此声称。真实创建审计证据并执行HCS查询RPC/系统签名验证；没有业务/生命周期/DB写入。 |

下一步由主 agent 对此精确闭包做实际只读完整资格验证与独立全文复审，再封新未批准19步批次。原“一次前Backup+一次新消费链同点隔离Restore、无后DB”与所有runtime/source/artifact/ACL/身份/drain/WAL门禁不变。

## V2：合法 StopPandas 后的 namespace 子集

独立读取实际 installed `app/tools/django-ai.ps1` 的 `Stop-PandasSandbox`：先 `Invoke-PandasSystemctl stop`，再停止 owned WSL keepalive；实际 installed `app/backend/pandas_runner/wsl_control.py` 调用固定 `systemctl --user stop teruisi-pandas.service` 并检查其owned containers已清理。故服务进程和它独占的namespace可能在guard采样前合法消失，不能以维护前8个全集为执行必需条件。本轮只读源码，未实际调用Stop。

V2允许已审8ns的**非空子集**，并要求提供的namespace记录集合精确等于本次全部captured process namespace集合；每个present namespace仍核原完整mountinfo字节SHA。进程记录与前后PID清单完整匹配不变。漏process、漏对应namespace、未知namespace、新挂载、采集中改变均拒绝。

采集器仅readlink namespace，不持有namespace FD来维持服务已经释放的namespace。若其他进程持有 `mnt:[id]` FD，而当前没有该namespace的process/mount证据，V2明确拒绝；不会因子集允许而隐藏这个悬空引用。已由当前process覆盖的namespace FD仍使用同一完整mount证明。

新增5例：合法进程/namespace已消失、漏现存namespace、空集合、无人覆盖但FD持有namespace、现存actor覆盖namespace FD。最终 **94/94**，日志 `ASTRA_LIVE_GUARD_V2_FINAL_TEST.log`；没有重新执行管理员采集/维护动作。新 policy SHA `b039ec05bb43a88ea6af3c807f1514af729b4fb8770903966983fd9e0523053a`，wrapper SHA `2799a899465508c7d7dc80388580e013d3d2d8de45d1f7813990f3a44ad015c6`。仅对应policy及向上字节pin变化，其余HCS/系统工具约束不变。
