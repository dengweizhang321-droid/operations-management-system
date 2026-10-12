# Exact-instance stop core V2

本交付是固定 23 个启动实例的声明校验与隔离验证过的停止库，不含生产 CLI，不是完整恢复执行包，未停止任何生产进程。它不恢复缺失的历史 configFingerprint，也不把当前元数据视为原 ownership receipt。Worker 43884/3692 不属于这 23 个根。

声明必须绑定既有 Admin 安全摘要与独立启动区间证据的完整 SHA；后代须显式声明并核验出生、父链和深度。库在第一次停止前持有并校验全部目标句柄，逐项重新核验 census/身份，拒绝重复 PID、未声明后代、复用与读取失败。访问权限仅 QUERY_LIMITED_INFORMATION | SYNCHRONIZE | TERMINATE。加载既有库时持 FileShare.Read 并执行已捕获且核过 SHA 的文本。

V2 在记录 stop-started 后及真正 TerminateProcess 前检查共同 deadline，退出等待以剩余预算和 10 秒中的较小值为上限。最后一次 census 后仍可能出现新子进程；这些检查不是全操作系统排他锁，失败可留下真实部分停止结果，不能宣称杜绝所有误杀或完整连续观察。

## 最终源码

| 文件 | SHA-256 |
| --- | --- |
| tools/startup-exact-instance-policy.mjs | 0ab41f6eca96c4d60b5231508bf2abe455451cd5cb91f199b340add07ad9886c |
| tools/startup-exact-instance-stop.ps1 | 35a98102c9b76c8a95232f3f07584dcba932a819eae683f2391c4345297fb8a3 |
| tests/startup-exact-instance-stop.test.mjs | 49b389172ae344dac3b7159329ae2dc658f0f724bbfff67fe6d9515f236fcd4e |
| tests/startup-exact-stop-mocked.ps1 | 1b76cf0f74259ee2c6c77e8662b2cdcdbc5cb7e2ef0f8b8ace25683ba3c39f07 |
| tests/startup-exact-stop-private.ps1 | 760d4281dc4bfda63c9d66e6aa8e487226d511c47f9a58aaefb903cd22fcb2b7 |

## 实际验证与失败保全

最终 Node 15/15，通过 PS5、PS7 各 8 个模拟场景及各自真实私有 GUI 子进程 held-handle 停止。Root 独立重跑同样 15/15。错误 command SHA 的私有子进程保持存活；生产停止数为 0。

首轮测试有 PS5 继承模块路径及 deadline 库加载缺项；第二轮控制台夹具出现未声明后代而正确拒绝，未保存该后代精确身份，不能猜称 conhost。第三轮及 FINAL 通过并不覆盖后来发现的 deadline 缺口。V1 在新版全模拟 expiry fixture 下，两 host 均实际调用模拟 stop 1 次（预期 0）；V1 原源码未改。V2 修正后 expiry-during-census/validation 均为 0 次模拟停止。保留所有原日志、V1 五源和模拟 journals。

AGY 第一轮漏掉 deadline 窗口并使用了过强的“杜绝误杀”表述；真实第二轮非空回复正式撤回，认可 V2 的有限修正且未提出新增阻断。模型审查不替代隔离测试或生产验收。其 duration_seconds 是会话累计值，不作为本轮耗时。

Root legacy actor 当前采样为 8 个候选、unknown 0、reference 0，仅是有界 PowerShell/watchdog 候选观察，不能证明 encoded command、其他执行器或未来 actor 不存在。其 BOM/模块路径两次运输错误发生于 metadata API 前，仅保留真实工具输出描述和已有 transport 记录，不补造原始日志。

## 尚未实施范围

尚无完整恢复 wrapper、生产后代声明、原 drain 实际等待、same-thread watchdog mutex 整合、生产停止/原生命周期重新生成记录、新诊断版本 PlanInstall/Install 及失败退出组合。当前维护意图成对包仅 unchanged-49 的 abort-only 合同，不能充当后续状态改变后的通用退出。原安装 healthy 门与维护下 unprobed 冲突、其他 legacy Status actor 风险仍需整合处理。不得凭本库交付批准无限 503 维护或直接生产停止。

本轮没有生产动作、UAC、原服务 Status 调用、正式包/规格/WAL 修改。后续完整恢复包须把实际对象、原门禁、退出及新增 TaskAction 范围做成可审查结果。

证据清单：[MANIFEST.json](evidence/exact-stop-core/MANIFEST.json)，共 49 个原字节文件，清单 SHA-256：a28390d0e936d085d4af07dcc5a4bd9cdc344f47a6d35c8cca38578f3fb2526f。源码快照全部使用 .source.txt，避免自动测试发现。
