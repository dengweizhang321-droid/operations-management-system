# 吉客云部分失败后的五表重新采集

## 状态和范围

本次实现为候选代码，尚未生产采用。用户说“上线”之前不执行生产切换；本次实施未派发真实 n8n、操作真实浏览器、写入生产数据或发送外部消息。Git 合并、推送、制品准备和最终独审由任务负责人统一完成。

首版严格支持已证明的串行前缀：五表平台导出全部 handed_off，货品 completed 且仍为精确 committed_current 批次；库存 D 有与 n8n 错误一致的 HTTP400/status=rejected 审计，原上传会话精确回查为 uncommitted_upload/uploadStatus=ready；库龄、销售、组合装没有调用 checkpoint 或审计，且原 D 只有一次失败调用。源执行与最新尝试均为真实 error 终态、没有 retrySuccessId，也没有其他业务 owner。最新尝试若与源不同，只允许唯一 A 的规则变化失败。

未知结果、uploading/processing、无法核对的范围或文件、重复 D、非唯一 A/B/C、陌生节点、后三表调用证据及过期或改变目标的授权均停止。此能力不泛化所有部分失败。

## 实现

- Django 继续使用原 WorkflowWriteRequestReceipt，无 migration。`{kind:new}` 的 empty/completed 语义保持；显式 `{kind:new,supersedes:{logicalExecutionId,failedExecutionId,sourceExecutionId,sourceDigest,controlDigest,activeDigest}}` 记录真正管理员授权，严格拒绝多余字段。客户端摘要只选择目标，helper 从持久 authority 读取并重新取证。
- n8n 仍传原 `kind=new` 和 authorizationId，无工作流图变动。页面复用原完整恢复组件增加“五表从头重新采集”；未通过完整证明时禁用并显示原因。
- 独立 `lib/jackyun/fresh-restart.ts` 绑定旧 active 原字节、control、plan、controller、五份 handoff 与文件 SHA、checkpoint、审计和精确 Django GET 结果。旧规则基线不被替换，旧失败不被改为 completed，已提交货品不删除。
- 在原 helper owner 与吉客云 run lock 下按旧 logical create-only 预约唯一 successor，依次建立新 plan、control、正常上海采集日及 45 天窗口的新 baseline，再复验证据，写永久 superseded 回执，比较旧 active 字节并原子推进。active 原字节保存在回执。
- 预约即冻结旧 logical/source/latest；永久门禁覆盖旧 A–E、人工 retry、自动派发和自动消费者，在文件修复、upload 或旧恢复前执行。预约 successor 必须携带原持久 authority，禁止省略授权降级继续。原 decision enum 与旧控制记录不变。
- 新 runId、文件目录和上传 fingerprint 走原 A–E、原 Django 内容幂等及精确批次回查。同内容产品继续 duplicate，不新增重复事实。

## 崩溃与恢复边界

测试在 reservation、plan、control、baseline、superseded、active 六个**成功持久化之后**注入中断，复验同一个 successor 的原摘要后补尾；另一授权或新 ID 不得接管，A 协调没有导入或 Webhook POST。实际原子发布失败、残留 tmp、缺失或损坏记录仍失败关闭，需要人工核查，不能据测试将所有任意时刻崩溃称为自动恢复。

同 successor A 续尾还要求实际 n8n execution 为 running。已进入 error 的 successor 不自动重新运行，不换新 ID 绕过原预约，不自动重发 Webhook。旧上传 ready 的 token 已由原事务释放清空；最终 lock_upload_guard 仍复验 processing、token 和 generation，状态 token 只是第二层保护。

## 验证证据

原始合成日志与摘要保存在 `D:/codex-artifacts/jackyun-full-restart-20261018/implementation/`，不依赖工作树忽略目录。

| 检查 | 证据 |
| --- | --- |
| 真正五表解析、上传协调、批次核验及全部旧 A–E 拒绝 | `fresh-tests.log`，首个独立 A–E 测试曾通过 83 秒，稳定整组中再次验证 |
| 未知/processing/范围/文件/owner/授权反例、六个持久化边界 | `fresh-tests.log`，9 项全部通过，保留旧计划、清单、审计和预约原字节，协调阶段无 POST；`fresh-negative-tests.log` 另补 uploading 的 ready-only 反例 |
| 串行 n8n 证明纯 decoder 反例、原控制/预算/基线/协调回归 | `targeted-regression.log`，19 项通过；纯 decoder 不访问网络或文件 |
| 真实 builder/helper 私有整链 | `fresh-helper-smoke.log`，真实 claim、持久 n8n anchor、authority 读取/领取、重复 running A、同 slot A–E completed；只替换 runApiExports 浏览器边界和私有 HTTP gateway，生产网络调用 0 |
| helper 旧 ID 请求 | 上述 smoke 的 10 个旧 A–E 请求由外层 slot identity 409 拒绝；永久 superseded 门禁由直接 pipeline 反例单独证明，不混称为同一检查 |
| 原 helper page 恢复回归 | `page-helper-smoke.log`，真实 builder/helper 的私有 page 场景通过，业务动作 0 |
| 私有 PostgreSQL | 负责人创建的独立 loopback 随机 51706 实例，三类 15 项全部通过，见 `../private-pg-is725bli/PROOF.json` 和 `tests.log`；原上传释放后旧 claim、范围漂移、fresh 字节的同内容 duplicate 均覆盖。实例已停止，无生产连接 |
| 正式前驱只读兼容 | `D:/codex-artifacts/jackyun-full-restart-20261018/READONLY-PREDECESSOR-PROOF.json`，02:26:44Z 核 20 个证据文件、货品精确 current/8577、库存 ready，仅 GET；只证明快照兼容，真正派发和 A 必须重新核验 |
| 定向静态检查 | `eslint.log`：修改文件无错误、无警告；`tsc.log` 为全仓 211 项其他文件诊断，本次修改文件未报告诊断，未逐项执行基线比较，不宣称全仓类型通过；真实 helper bundle 构建通过；`git diff --check` 通过 |

后端命令为 `python backend/manage.py test inventory.tests.test_recovery.InventoryRecoveryTests erp_reference.tests.test_recovery.ImportRecoveryTests workflow.tests.test_jackyun_recovery_authority.JackyunRecoveryAuthorityTests`，须使用私有数据库环境。前端/工具命令为 `node --import tsx --test tests/jackyun-fresh-restart.test.ts`、`node --import tsx --test tests/jackyun-fresh-restart-decode.test.ts tests/jackyun-recovery-control.test.ts tests/jackyun-retry-budget.test.ts tests/jackyun-publication-baseline.test.ts tests/jackyun-import-coordination.test.ts`、`node --import tsx tools/test-jackyun-fresh-restart-helper-smoke.mjs`。

独立审查已通过，负责人保全回执 `D:/codex-artifacts/jackyun-full-restart-20261018/INDEPENDENT-REVIEW.json` 绑定三份核心源码摘要，限制条件以原回执为准。最终合并提交及发布制品由负责人在交付时补充；本报告不代表生产已采集或已导入成功。
