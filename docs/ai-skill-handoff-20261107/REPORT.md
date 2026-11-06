# AI 助理四项任务交接

基线 `77382b5f`。四项工作分别在独立分支完成，由未参与本项实现的审查者复核，再汇入开发分支 `codex/ai-skill-handoff-20261107`。组合应用代码对应 `664d8e7b`，组件是 Django 和 Worker。此次没有数据库结构变更。

| 工作 | 提交 | 实现与独立反审 |
| --- | --- | --- |
| [Skill 步骤工具名](../skill-step-toolname-20261107/REPORT.md) | `c68d2600`、`7dcb25e7` | 反审核对保存入口、注册目录和旧记录读取。组合 PostgreSQL 首次运行发现旧候选测试夹具曾更新不可变正文。改为按旧格式一次插入完整草稿，复审确认保留原数据库约束。 |
| [调度存储字节边界](../schedule-storage-bounds-20261107/REPORT.md) | `33c829d0` | 实现者和反审者分别核对合法写入路径及序列化。阶段、模型快照和事实正文的字节上界分别为 561、1878、159727，对应限额 8000、8000、160000。补充 7 项 PostgreSQL 回归，保留现有运行逻辑。 |
| [测试重复收集](../test-loader-collection-20261106/REPORT.md) | `7288f28b` | 独立运行 unittest 收集。28 个 AI 测试模块共减少 307 次重复；4,563 个原始唯一测试 ID 与各旧模块自有 ID 顺序均保留，新增 1 项收集回归。恢复基线绑定的负例触发全部 28 个相应子检查。其他 app 原有的 75 次重复在本项范围外。 |
| [服务端提炼草稿](../skill-distillation-20261107/REPORT.md) | `26bec179`、`a302fce3` | 后端读取成功任务的最终公开报告、来源、附件元数据和确认修正，按原任务模型、店铺工具范围生成候选草稿。反审复现凭据解密失败时远端调用为零却禁止再次提炼。修复后本地失败按明确终态记账，修复凭据后可用新请求标识继续；供应商结果未知时仍阻止重复派发。 |

## 组合验证

在组合工作树使用以下命令，以独立回环集群与合成数据运行。结果为 25 项通过，无跳过；供应商边界使用模拟响应。测试库已销毁。

```powershell
py -3.12 tools/ai-postgres-rehearsal.py --tests-only --preprovision-ai-runtime-roles --test-label ai_assistant.test_skill_distillation --test-label ai_assistant.test_skill_candidate_step_tools --test-label ai_assistant.test_schedule_storage_bounds --test-label ai_assistant.test_collection --port 55873
```

本地证据 `.runtime/ai-pg-6b816bfc6eb7/tests.log`，SHA-256 为 `FA78E9FBFB070371DDEB69FAD48F29B226E51BA91009DF62E0F6894DDC267E1E`。Worker 的 5 项定向测试通过，覆盖路径、签名转发至 writer、写方法和同源限制。实际供应商通信和真实业务数据均在本轮验证范围外。

调度分支另跑较宽的 80 项 PostgreSQL 测试，其中 79 项通过。基线用例 `test_schedule_core.py` 试图修改已有运行的不可变 `scheduled_at`，触发原数据库约束；本次未改该夹具。见[命令及错误位置](../schedule-storage-bounds-20261107/verification.txt)。

## 交付边界

交付为远端开发分支。合入 main、准备生产制品及上线均未执行。本轮提供服务端提炼接口，页面上的提炼按钮属于下一项工作。
