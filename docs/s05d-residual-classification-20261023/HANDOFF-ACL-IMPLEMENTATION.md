# 新 handoff Task ACL 窄修

2026-10-23。只改 `tools/preparation-retirement-handoff.mjs`，覆盖 control-prepare/adopt、plan、close-sources、seal 的公共新任务入口；不改旧 c6、冻结 host、其它任务或分类 pins。

注册精确沿用已验证请求：同 SID owner/group、该 SID GR/GX、BA/SYSTEM FA、`D:P`。Scheduler 实际回读为 `D:`、controlFlags=32772，并自动增加同 SID FR：仅接受四条无继承 AccessAllowed ACE，BA/SYSTEM 各 `0x1f01ff`、同 SID `0x1200a9` 和 `0x120089`。FR 不扩大 RX；不声称回读保留保护位，也不接受任意 SDDL、未知 owner/ACE 或扩大权限。

register、run、execute、verifiedParent、status、cleanup 均核结构化 owner/DACL；RunEx/DeleteTask 前在同次原生调用再核。唯一实例、普通 token、固定 definition/parent、控制代际、native 门禁及 unknown/no-replay 不变。旧 c6 原件和冻结旧协议保留，不重放、不改写未知。

必要单项 [原始输出](handoff-acl-checks.txt) **1/1、exit 0、503.603 ms**；只运行 PS5 的纯 .NET SDDL 解析和构造/拒绝断言，没有连接 Task API或现场操作。既有检查复用。实际诊断由主负责人另记于 [HANDOFF-DIAGNOSTIC.md](HANDOFF-DIAGNOSTIC.md)，不将首采样称为 t=0，也不声称分别证明 owner 与 ACE 的因果。独审见 [HANDOFF-FIX-REVIEW.md](HANDOFF-FIX-REVIEW.md)。新摘要单独保存 [handoff-acl-pins.json](handoff-acl-pins.json)。
