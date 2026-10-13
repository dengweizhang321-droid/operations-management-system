# 首次采用的精确待批准范围

本文件是批准前准备，不是生产授权。用户已选择一次发布前备份、一次针对新恢复消费链的同点隔离演练，取消发布后第二次备份和演练。本次新封存范围如下；旧 f0bb 批次、原批准及 WAL 保留，不重放或换绑其他会话。

最终准备核验完成：新批次声明入口实际完整 fresh qualification 568.653秒，15个原采集阶段全部通过；128/128定向回归和QA4真实只读引用核查通过。所有原始结果见[最终复审](FINAL_REVIEW_AND_FAILURES.md)和本目录evidence。声明入口的 `statusObservation=null` 是准入分支行为，不声称新installed服务已运行/验收。当前可提交此精确范围的生产批准；正式动作前仍重新采集，不以准备结果免除现场门禁。

| 对象 | 精确值 |
| --- | --- |
| 新批次 | `f15d06a159073927ba3565712027aa645869333a3210c54e1858738756ca110f` |
| 规格原始字节 SHA | `960c5c3e99da1f5cd7bacf57ae3aa0889fcecb9cd522d9165870560668c7678b` |
| 规格位置 | `E:/codex-artifacts/release-site-blockers-20261011/ADOPTION_BATCH_LIVE_V1.json` |
| 最终源码树 | `dc1dbeeded593980c6712e7afabde0a053dfd13d8f6c4bb9375718330af2b8fb` |
| SourceBinding | `1168c06784a134da5390b7403e83de8af27d5f866ad239f92bd4c136c134b745` |
| Worker 候选 | `20261011T090355Z-21c2645a63247749` |
| Worker manifest | `6cff8886e533244997b65d2a8668776cee5178b95e4e2a99ed14bd25bf2733f4` |
| Worker plan | `0afdb3de501e415e707670a471d245c24a6043139571099a8b9433b617a89881` |
| Django prepared app | `1e1138feef7148fb851713c2b39a25d0` |
| Django manifest | `85cf0699925aad21f98ae682f458789236d206723b10865939915d1bcacddd09` |
| Django prepare receipt | `10db2364053ebfb90d85dd301914753453d02ad313cd02ff7312ca654ebdeb9b` |
| 当前 Worker 前驱 | `20261010T014638Z-97833d2f2b7e7bc9` / `f4e537eb20dfa60127cf588db0ed911223c0b59c44fc8b839e5df196428e7113` |
| 当前 Django 前驱 | `237fbe0de6e4fbab6b80389298ba1b8a5951b5aaf213c250ad3ee9f590010ab9` |
| 实际已采用源声明 | `92c2656c064c6a202239f4f010f0d241e90ae19fb35638cd328727a7ac64973c` |
| 外置只读 guard | `f6ace5378036d4eccc809505f4af5831ffc1800c5fcea2a1358cdd75d08c6984` |
| 独立最终 handoff | `41074be9c8a26b48fac1ea6fe25948b2ea0096d8200acfbd8d77b8f4c551cd7a` |
| 声明执行入口 | `E:/codex-artifacts/release-first-adoption-targeted-20261011/fresh-adoption-entry-v2.mjs` / `69898b1be33a9e3ba0d30a2eab480a12ca05fe339bf373bc333eec7d10245b99` |

完整 JSON（含每项 command、file pins、预算、维护及隔离恢复 ID）为批准范围的唯一执行输入。使用显式 `fresh-no-reuse-v1` 入口，不启用尚未闭合的 C 缓存现场方案。新外置守卫仅适用本次精确实例和封闭挂载集合；任何重启、实例或字节漂移都拒绝，不能自动更新基准。

## 19 项动作与必要验收

1. 原候选计划复验。
2. 原 installed 工具执行一次发布前 Backup。
3. 原 EnterMaintenance/排空，KeepPostgres。
4. StopWorker；应用后端按原生命周期处理。
5. Worker apply 精确 plan。
6. 旧 app.previous 完整保全、状态/候选/任务/进程及 WSL 实时引用守卫。
7. 原 DeployApp 切换精确 Django prepared app。
8. HardenAcl。
9. 新 installed 固定无参数只读恢复消费 planner，校验新 source/history 兼容消费。
10. 原工具消费本批 Backup 的真实收据，进行一次独立恢复演练。
11. ExitMaintenance。
12. 原 StartWorker，绑定 Worker/Django 两份清单。
13. 实际显示观察。
14. 实际权限观察。
15. 前后业务、迁移、写逻辑和依赖闭包一致核验。
16. VerifyStartup。
17. AggregateStatus。
18. 原自然 watchdog 观察。
19. VerifyStartup 收尾及原批次闭合交付。

一次 Backup 和一次 Restore 均保留原 1800000ms 预算，不降低超时门槛。恢复仅使用本批前备份，使用独立隔离目录、端口与恢复 ID；内容/权限/序列比较用于恢复忠实性，不要求发布前后生产业务全库相等。原 Start/EnsureReady 的就绪、迁移检查、权限及受管服务行为仍按已有固定合同执行；不得据“取消后 DB 操作”宣称没有任何启动副作用或业务自然写入。

这次首次采用改变恢复消费机制，使用上述专项保护，不借尚未生产采用的自身 `not-required` 结论免保护。未来经机器完整证明且属于支持范围的普通展示功能，才可封存为 0 个数据库操作。规则与负例见[原交付报告](../release-first-adoption-targeted-20261011/REPORT.md)及[规则对照](../release-first-adoption-targeted-20261011/RELEASE_RULES.md)。

## 动作前条件与失败处理

实际执行须重新完整采集精确源、制品、配置、前驱、身份/权限/ready，取得原互斥/所有权并正常排空。QA4 的实际只读成功是当前截点证据，不能代替动作前新采集。新 guard 保留完整 D 库存、旧 previous 保全、所有 JSON 状态扫描及 WAL 不变检查；固定 11 helper 和 4 诊断 record 被批次 exact pin 后，仍执行新的 native/HCS/guest 采集，不复用旧诊断作准入。

失败、超时、未知或所有权冲突保留原门、owner、WAL 和原始输出，不取消、删减、重放或接管其他批次。不能直接重装旧 AB resolver：新 sourceBinding/history 需要兼容的前向 successor 回退，详见[已审回退方案](../release-first-adoption-targeted-20261011/ROLLBACK.md)。原 app.previous 的完整保全副本及当前旧部署保留；数据库恢复另须精确批准，不能自动执行。

本次不启用或修改日常调度、不变更三份保留/保护、不新建重复调度、不重放四项旧界面功能，不纳入其他聊天的待发布功能。源码、不可变包、外置 guard 及被 collector/回退引用的工作树保留到解除依赖后再核查清理。
