# 单 PID cwd 消费补点复核

2026-10-11；复核前轮已报告的两项消费缺口及创建时间关联，不构成管理员现场或生产准入签名。

最终读取的源码 SHA256：

| 文件 | SHA256 |
| --- | --- |
| Collect-ProcessIdentity.ps1 | `764efb896666bac3656bbe7acc98833f98cf9babfbd2f20441803c368d84f50e` |
| evaluate-reference-capture.mjs | `0901f108929cd223fc14a3b6371319a1bc6115606f96b020e0c60167a84ac2ed` |
| Start-ReadOnlyAdminAudit.ps1 | `59276d18da0eb6cee4cf3e1909e1759b4d7ffbfaa1df1be0893225c8ef2e6c05` |

代码确认：cwd 消费要求 PID=47936、identityStable=true、本次全量采集的同 PID record 稳定且创建时间非空，并要求 selectedCwd 创建时间精确相等；拒绝 CR/LF/NUL 和非盘符绝对路径。collector 记录选定实例的 native FILETIME 字符串/CIM UTC。launcher 的两层 productionApproved 均要求实际 Boolean false，未把字符串或缺失值作为 false。

原五例使用当前 collector DTO 所需的合成 actor/time 补齐，原断言保留并将两项缺口观察加强为拒绝断言；再加不同创建时间、双方空创建时间。**7/7 通过**，各例均确认不会序列化原始 CurrentDirectory。未替换生产函数：从最终 evaluator 提取原分支，复用原冻结 predicate，仅物理 realpath 为合成返回值。只证明这些消费边界；不声称真实进程、PEB 或 Windows 路径已验收。

- 测试脚本 `test-admin-cwd-consumer-v2.mjs` SHA256：`d6a03700e43cf9e44103715176063f3ae9479416f060e9b5968b81f8b5934f7a`。
- 结果 `E:/codex-artifacts/release-site-blockers-20261011/ASTRA_CWD_CONSUMER_V2.json` SHA256：`8ff3c75dfa157931f89a819ed74f5b9a5ad3499d5dbb6183e5d9d657fe761308`。

此前 V1 缺口和源码 SHA 记录保留。此次未再跑其他测试、UAC、现场采集或构建，未改主脚本/guard/f0bb/SourceV3/pkg21c。先前关于 x64 内部布局、时点证据及句柄覆盖范围的限制仍成立；本次没有发现上述已提补点的剩余阻断，可将此精确字节版本交后续独立全文审核。
