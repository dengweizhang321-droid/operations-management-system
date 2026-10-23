# 第一轮阻断修复已上线

2026-10-15 01:32:45（Asia/Shanghai），用户在本聊天明确确认上线后，已通过当前登录用户的普通权限和原唯一生命周期入口完成 Worker＋Django 切换。目标版本、必要服务、首页、启动绑定及市场源码回读通过。**正式识别未恢复、正式标注未写入，三条原暂停计划的完成/失败计数保持。**

| 项目 | 实际采用 |
| --- | --- |
| 市场代码/组合发布源 | main市场代码 `66ac98d3`；已验证发布源 `86fa943d` |
| Worker | `20261014T170130Z-17e3867852424323` |
| Worker manifest | `9272ee20a5d718b1cf6a1f13f32383a8ba31ab6a45cd3262243cbb3cdf7d0f25` |
| 精确 Worker plan | `27a62dc4e8a80d19fbbdb13e130c46eb1053627f94843f317c1c3528182f1871` |
| Django prepared | `92b652ce31aa4dae80b37eae7d843a76`，收据 `be6d499c5e9394d42189f827369e05592161485183c195c5285a1d2a289129cf` |
| Django manifest / app指纹 | `a28626fef72a099cd0fd631928a94539668219d2c57da82bbc4d1c32d1226530` / `abeaee20a07a991e4a725c1cfb633efe6a673eb45153ede332056bc4f3ad3c14` |
| 维护范围 | 原应用维护、同一ID；PostgreSQL保持运行 |
| 数据库保障 | 复用原工具已Verify的 `daily-20261013T051108Z-77715d3b35da`；无新schema，不追加备份/恢复 |
| 权限 | 所有操作回执 `administrator=false`，保留完整原门禁 |

本次最终制品与此前候选编号不同。确认期间已授权的普通权限发布改变前驱/环境；应用源仍完全相同。按原规则重新绑定，保留当前生产字节，未直接采用失效旧CAS。[换绑核查](PUBLICATION_REVIEW.md)记录了原因、实物差异与独立只读审查。原准备与失败记录不改写。

执行顺序为原 EnterMaintenance `KeepPostgres` → 同ID排空停稳 → Stop确认already_stopped → 已准备Django DeployApp → HardenAcl → 精确Worker apply → 同IDExitMaintenance → 原Start → VerifyStartup与必要只读回读。各操作使用有界 direct-exit-files、原参数封包和有效rotation lease；没有未知切换、自动重放或额外任务恢复。

原 Start 保留内部既有迁移/授权和就绪检查；本轮没有独立执行迁移命令，未新增或应用migration，所有既有迁移源码字节保持。没有生产 ANALYZE、重置失败次数、改正式Prompt/分类字典、恢复数据库或发测试消息。

正式回读确认三条未结束 cloudRun 均为paused、活动领取为0；前后完成数、失败数、模型新完成数与历史复用数完全一致。原调用账本SHA保持，**累计46/50，本次上线新增模型调用0次**。开发阶段A6/B6完整隔离链路和定向验证复用，未在上线后重复模型测试、打包或综合验收。

本次操作开始回执01:18:37，闭合回执01:32:45；其区间不能冒充精确HTTP停服时间或用户确认到完成的总时长。Django/Worker生成字段中的deployedAt/createdAt是候选准备时间，实际切换分别以本次DeployApp/apply回执为准。

发布结果、操作时间线、前驱/制品绑定见[发布结果](evidence/PUBLICATION_RESULT.json)及[操作记录](evidence/PUBLICATION_OPERATIONS.json)。完整私有原件在 `D:/codex-artifacts/market-ai-blockers-production-20261015/`。窄范围发布源树仍因制品/恢复绑定保留；A/B开发树已经在合并后清理。主工作区原有改动保持。

净水25种规则/11类枚举的业务冲突尚未修订，技术上线不等于分类准确率验收。创建计划批量查询优化仍留第二轮。正式识别恢复和生产标注写入须按各自明确授权处理。
