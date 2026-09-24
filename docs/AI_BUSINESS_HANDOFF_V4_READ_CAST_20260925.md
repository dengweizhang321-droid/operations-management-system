# AI 经营分析 v4 候选封存读取：续工交接（2026-09-25）

工作分支 `codex/ai-business-current-integration`，隔离工作树 `D:\.codex\worktrees\ai-business-current-integration\运营管理系统`。本检查点没有生产部署、正式数据库迁移、专用角色登录启用、付费模型或外发。主 checkout 的已有改动不属于本分支。

## 已接与已验证

- 0049 后的 `ai_v4_sealer_replay_progress` 在实际 PostgreSQL 回读时，表列 `varchar(64)` 与函数声明 `text` 不匹配。0050 仅对该投影增加 `::text`，保留 claim 前后复验、函数身份/权限及写侧行为。错误原始日志为 `.runtime/ai-pg-9c5dae830fb1/failure.log`。
- 默认关闭的 `v4_sealer_step_core` 现以隔离受限角色、已领取 claim、合成推广及财务来源各一段执行候选写入/回读，并核重复请求和错误派生密钥拒绝；四项目标 PG 测试两轮通过，最后一次为 `.runtime/ai-pg-9b711eca6f63/tests.log`。20 项相关纯测试通过。所有返回仍为 `candidateOnly=true`、`authorityVerified=false`，无最终 seal。
- 0049→0050 完整隔离演练通过 `.runtime/ai-pg-7ddc07cd8f88/business-v4-replay-read-cast-upgrade-evidence.json`：79 张旧 AI 表及 renderer1—7 文件字节保持，所有其他 AI 函数不变，目标 READ 仅函数体变化而 OID/ACL/签名不变；迁移前后备份独立恢复、空回执逆迁移与重做通过。备份 helper 按迁移回执选取读取函数定义；健康检查固定要求当前 0050 定义。

## 接续边界

- 专用角色仍 `NOLOGIN`，无正式凭据/执行器。隔离测试的角色切换和当前 `authority_epoch`/`cutover_id` 注入只模拟受控会话，不是生产认证方案；当期权威标识须由未来受限交接核验，不能硬编码。
- 180 秒 claim 下的至少 17 页跨票据续段、未知写入结果读取恢复、最终 seal 与 0043 消费回执同事务、财务真实来源页及 575,095 行实际吞吐/磁盘峰值都未验收。候选回执不能给 Agent 或正式报告授权。
- 志高参考推广两期历史文件、七天未人审预览、来源差异和容量限制见 [真实来源续验](AI_BUSINESS_ZHIGAO_TRIAL_ACCEPTANCE_20260925.md)；UV、预算、市场/财务正式 Agent、真实模型与原生 Office 仍按 [总体状态](AI_BUSINESS_INTEGRATION_STATUS.md) 逐项推进。

下次先核分支 HEAD/工作树、0050 目标测试和升级证据，再接跨票据长段测试及默认关闭的最终封存包装。任何正式角色启用、生产维护或模型费用应以具体可审结果另行确认。

## 0051 续工补充

实际 17 页跨票据用例先暴露了 0048 写函数 `ticket_id` 列名歧义，原始 PostgreSQL 日志为 `.runtime/ai-pg-f6ae63683a08/postgres.log`；0051 仅限定前段 claim 表列。修复后三项迁移/逆迁移目标测试 `.runtime/ai-pg-5743154be602/tests.log`、完整 17 页两张票据自然到期续跑 `.runtime/ai-pg-6e739a683421/tests.log` 均通过。0050→0051 完整前驱升级、79 张旧表和 renderer1—7 字节保持、仅 RECORD 函数体变化、OID/ACL/签名保持、迁移前后独立备份恢复及空回退重做通过 `.runtime/ai-pg-7033b21c9550/business-v4-prior-claim-qualification-upgrade-evidence.json`。有候选回执时逆迁移会拒绝。

下一步最终 seal+0043 消费必须由新受保护数据库事务包装实现；0041 已撤销专用角色对旧直封函数的 EXECUTE，0043 没有消费写入入口。纯 Python 拼接两次调用无法满足原子性。独立角色仍 NOLOGIN，真实父 MAC、当前 authority 交接、正式 Agent/文件与生产采用仍待完成。
