# 无业务同链现场验证

2026-10-23。按用户“OK，执行现场验证任务”仅创建一个新的诊断 Task、RunEx 一次。候选提交 `9925e6ac0a616f7c83c710f2a98993a7a58dad42`；未调用 native prepare/adopt、未重放旧 c6/28a、未移动来源或修改生产代码。

**正例通过。** 普通侧 3/3、高侧 8/8 均看到唯一实例；原精确 `readHandoffTask` 投影、原始 Count、保存 collection 和显式 COM Count/Item 相符。GUID 为 `{3CD38486-5285-4A84-953E-31AB6565A67F}`，EnginePID=6288，均对应唯一 RunEx 回执。GetInstances/Count/Item HRESULT 均为 0。

- 完整 Task 设置与候选原 `Project` 定义精确比较通过；`Hidden=false`，action 的 `-WindowStyle Hidden` 保留。用户 owner/RX、附加 FR、BA/SYSTEM full 均精确回读；原 runner 字节未改。
- 拓扑为候选完整 Task action → 原 PowerShell runner → 无业务 Node stub → 原 PowerShell EncodedCommand/stdin JSON 查询。runner 清空后安装原 RUN 白名单环境，Node 环境与冻结 RUN 精确一致。查询先执行原 readHandoffTask 投影，再采显式 COM 和身份。
- action PID 6288 → Node PID 36872 → 三个 query；三层实际同原 SID、session 1、medium 8192、未提升，PID/创建时间/可执行路径/父子关系及 RunEx EnginePID 对应。
- 原 runner 记录 Node 直接 EXIT=0、输出完整、stdout/stderr 均空；Task action 约 26 秒结束。清理前 XML/SDDL 未变、所有自有 PID+创建时间均退出、原查询及含隐藏项服务级列表均无本任务实例，才删除唯一诊断 Task；已回读确认不存在。

原件目录：`D:/codex-artifacts/s05d-field-validation-20261023/handoff-e131561d-2ade-4e1b-ab59-2dade0288dcc`。其中 `build.py`/模板、冻结脚本/候选源码、RUN/配置前像、任务 XML、ordinary/high、PARENT/EXIT、清理及结果均保留。环境原文仅在该制品目录，未复制进仓库。摘要索引见 [handoff-evidence.json](handoff-evidence.json)。脚本不得再次 RunEx。

边界：这证明本候选 `Hidden=false` 在相同 runner/环境/查询拓扑下的唯一实例可见性，并非真实 handoff 的 load/unchanged/业务阶段成功。旧 Hidden=true 同链为另一轮历史观测，不能称为同时、随机的单变量实验；不声称精确 t=0 可见。Node 原生 StartTime 的 100ns 尾数与 CIM 微秒投影相差 0.7μs，原件分别保留，身份比较结合 PID/父进程/路径/生命周期。旧两次 unknown 和全部原件不变，不能据此重放或自动继续业务。
