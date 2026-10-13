# AI 管理发布执行状态

2026-10-14（Asia/Shanghai）。用户明确授权“发布上线”，范围为模型删除、默认模型选择及工具预算自由调整；此前用户暂缓的 Agnes 流式修复继续单独保留。当前状态：尚未上线，生产切换未开始。

## 当前生产基线与候选

吉客云已采用后，旧 `beff9877` 候选及其准备收据不再适用新前驱。新组合从真实已安装来源 `178df20ec32298fe84ec503654b1380d0c36f1f4` 叠加已合并的 AI 4 文件修改，得到 `f75b7b723a278a5903286ed93f5ce2123ec74904`；远端 `codex/ai-management-production-20261014` 已回读保全。首次远端 unpack 失败保留，普通重试推送成功，没有强推。

Git 完整差异仍只有 AI 管理页面、配置、路由及测试 4 文件，均与已验证候选逐字节相同，复用原相关检查。吉客云代码及已采用的两项审计迁移保留，migration 全部不变。新 v2 范围计划 `0b64f5e6372ed8211102dae45eb417485a0ef8d60d2e6435c6e2a52703573a93` 为 Worker + Django、无 migration、无未知路径。继承快照中的 3 个 BAT 因 CRLF Git clean filter 显示修改，但原始字节同时等于 HEAD blob 和原安装来源；证据完整保存，未提交/隐藏/改写脚本。

| 绑定 | 值 |
| --- | --- |
| 正式 Django 前驱 manifest | `4fb134f17cd22018045b87a2852ea874d5d9f3e3c36900a3e8750dc0e572e321` |
| 正式 Worker 前驱 | `20261013T145450Z-fe391dce49a258cf` |
| Worker 前驱 manifest | `51aefd56a68ae84df34e606db2c508092511b1ae24d118fd50cca33333016c6d` |
| 新 Django PrepareApp ID | `3eebd5f0deb64d2a995265ef55221a2d` |
| 收据 SHA-256 | `78cb7d36785d80e07546322dfae85b066c073694cf39b64094ec76fc466d9ec0` |
| 新 Django manifest | `6982c8721b068498837a8b0196307d418f50798b4bf69f81b593c55e1203c43c` |
| 新 Django 应用指纹 | `5e07fb9c5fa65d7ce46b9ea81d269e3fe9b2446b8dfb99af1eb4dea84b53ddcf` |

Django 在线准备正常退出 0。逐文件实包仅 3 个后端路径及原 R2 smoke 的 cf 传输缓存差异，原变更清单和完整指纹封存。Worker 尚未开始新原在线准备，必须等前一个封存批次按原入口释放所有权。

原安装的数据库工具已 Verify 当前保留恢复点 `E:/运营管理系统业务数据/daily-20261013T051108Z-77715d3b35da`，返回 completed、`serviceStateChanged=false`。manifest SHA 为 `b2bc4142950291ff369fa723550fef6f0aaafedb3c0b8932d609414a4d8ed893`，dump SHA 为 `698f9a55b9526265151b0fe03e762bfad301617c36f4c967e5ee732881b44753`。没有新增备份或执行恢复，不把历史备份时间说成本次生成时间。

## 原批次协调阻断

原已切换的批次 `jackyun-direct-d3c0172c6400` / `639f410937aae7aa05d6a2418bf4050f6ee21a7a91ca03df806860916efa6d7f` 留有用户此前取消的两项收尾，原 active 占用保留。用户已明确允许只完成 `aggregatestatus` 和 `check-natural-watchdog`，并明确授权联系原“完成吉客云自动恢复重试改造”聊天；此授权不包含重放已 passed 的发布/迁移/n8n/业务步骤。

本聊天调用原封存执行器时，源码树、库存、Node、runtime 配置、npm 和 toolchain 与旧绑定完全相同，只有整个继承环境 SHA 不同，原身份门禁拒绝。失败保持，不复制/猜测另一个聊天的凭据或放宽环境指纹。原聊天已接续，汇总检查通过；自然看门狗产出真实控制阶段失败帧，原操作保持 unknown，未用人工成功或后续健康回填旧失败。

只读现场同时发现 Django supervisor PID 回执缺失，状态停留在旧时刻且 `supervisorScriptSha256` 与已安装脚本不符。原 Run 读同一无效状态后拒绝，不能仅重跑 Run/Arm 或手工修改/删除状态冒充恢复。原聊天仍在核验受控恢复及定时上下文诊断方案；需要明确的临时计划任务授权时，先准备精确名称、脚本摘要、权限、时限与删除方式供用户确认，不擅自注册任务或变更原调度。

## 未执行与后续

本次没有 EnterMaintenance、Stop、Worker apply、DeployApp、HardenAcl、Start、migration 或真实模型配置写入。没有清理原 active、修改原批准批次、将失败标成通过、补跑业务或发送业务消息。已完成的代码/验证/来源/后端准备和 backup Verify 保留；证据位于 `D:/codex-artifacts/ai-management-production-20261014`。

原占用合法释放后，重新核当前前驱，执行原 Worker online plan，仅准备一次 Worker 制品，再走唯一生命周期入口按本次已授权范围切换。常态服务和监督器从普通用户入口恢复；只确认部署成功、目标版本和必要服务可用，不追加本次综合验收或等待自然监控。若生产前驱再次变化，旧准备收据失效，须按实际新基线保留已上线内容后重新准备。
