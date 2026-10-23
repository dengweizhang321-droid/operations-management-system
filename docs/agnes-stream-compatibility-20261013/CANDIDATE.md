# Agnes 流式修复发布候选

2026-10-13（Asia/Shanghai）。状态：源码已合并，正式制品已准备；用户查看具体候选后明确选择“暂不上线，保留候选”，未执行本次生产切换。原因与验证见 [REPORT.md](REPORT.md)。

## 精确候选

| 项目 | 绑定 |
| --- | --- |
| main 中的修复提交 | `658b453d58d11703bcea50dfceb7b30458bdaf5c` |
| 当前安装来源 | `c1df9357cccdbe5e0541e5bd553d6bcc07150621` |
| 本次正式组合来源 | `c4cc438baa5876e333476fc31a04878651058670` |
| 范围计划 SHA-256 | `3b2ed3f17c84e489b7cf3aa19c80ff41c444e20d8d3f3216c41c21b9f1e8aafd` |
| PrepareApp ID | `0e0ae96e82fb40be896d1816213b8127` |
| 收据 SHA-256 | `5b3f5f7f534ff9b532c402b4e5770f3c9a0b54cd2e7cd9da05908e3386de06fb` |
| 前驱 manifest SHA-256 | `08695d0d67c45970a52032421650e859f3926d739aa2993ce896fdd7dc803b92` |
| 候选 manifest SHA-256 | `c15197b48da9524ef69c78a100c99ec7f2185334e494e8e4198d0f44561e9072` |
| 完整应用指纹 | `a5d7224925dc6579dd6ec5a5c6f5ce1ee63ba1888d830740bf4dc9e0378b0ae5` |

PrepareApp 于 23:16:47 生成候选，原期限进程正常退出 0、无 stderr，收据及候选 manifest 回读匹配。执行使用普通用户、原来源 PrepareApp 和原 process-deadline；生产在线准备，未开始维护、停服务或部署。staging 中的 `deployedAt` 是工具生成清单的时间，不代表正式安装。

来源为 `D:/.codex/worktrees/agnes-stream-candidate/运营管理系统`，制品为 `D:/teruisi-runtime/django-sales/app.deploy-0e0ae96e82fb40be896d1816213b8127`；保留来源供原消费者校验，不在准备后修改。候选相对当前正式后端仅修改 `ai_assistant/provider_stream.py` 与 `ai_assistant/test_streaming.py`，迁移闭包不变。没有采用 main 中其他尚未上线的吉客云或发布工具改动。

完整实包复核另发现原 PrepareApp/R2 smoke 更新 `.wrangler/cache/cf.json`，故不宣称实包只有两文件变化。仅 `/edgeL4/deliveryRate`、`/tlsClientRandom` 及 `/tlsExportedAuthenticator` 下四个握手/完成字段不同，未记录其值；旧 SHA-256 为 `e49054d7cc98b6837af8cfb1bc4244e4803eb49d01db830b8972895dd7939973`，候选为 `5e5cedc4c19b5f5cb6149795b03e1629f02abb75aa19db4e9f9eb721738f900f`。除此及上述两后端文件外，全部非字节码文件相同。运行产生的 525 个 `__pycache__`/`.pyc` 文件原清单算法本来就排除，候选没有打包；未新增忽略规则。原“只有两文件”的全树断言为 false，原 `PACKAGE_DIFF.json` 保留，细分复核见 `PACKAGE_SCOPE.json`；本次授权范围绑定上述完整候选指纹与精确缓存字节。

## 发布与恢复范围

本次只采用 Django 流式解析兼容修复。90 项相关回归 89 通过、1 跳过，Django check、无迁移变化及差异检查通过；同一真实供应商在独立诊断进程使用新解析器完整成功。没有新增自动重试，仍拒绝缺失 `[DONE]` 或结束后追加内容。

授权后先按原 operator 核验当前有效数据库备份与精确前驱，再通过唯一生命周期控制器进入 `KeepPostgres` 应用维护、停止原应用、绑定上述收据执行 `DeployApp` 与 `HardenAcl`，同一维护 ID 退出后从普通用户原入口启动服务和 supervisor。不执行迁移、不产生新 Worker 包、不变更密钥、默认模型、模型参数或监控任务权限。应用会有维护中断；PostgreSQL 保持运行。

恢复使用原受控应用回退入口和已核验的原 `app.previous`，同样需维护及停稳检查、ACL 和原普通用户启动，不手工搬运应用目录。代码回退不恢复数据库。失败或未知结果先保留原证据及维护状态、核验已完成效果，不盲目重执行。

安装后的功能验收使用新独立通用流式请求及原完整启动健康检查；不自动重放用户旧请求、不查询经营数据或发送业务消息。准备收据和验证证据位于 `D:/codex-artifacts/agnes-stream-20261013`。此候选须取得本次流式修复的明确生产授权；之前 OpenCode Go 发布授权不据此扩大到其他模型问题。

## 用户决定与保留

用户明确要求暂不上线。决定后回读：正式 manifest 仍为 `08695d0d…`，候选收据及 manifest 与上表完全一致，原维护/排空 gate 均不存在。没有执行 EnterMaintenance、Stop、DeployApp、HardenAcl、Start、RollbackApp 或 migration。保留候选来源、制品、收据、开发记录及外部诊断证据，供后续正式采用；后续须重新核验实际前驱和现场条件，旧收据不能越过前驱变化门禁。无需用户重新配对或更换密钥，生产当前流式问题尚未通过安装此修复解决。
