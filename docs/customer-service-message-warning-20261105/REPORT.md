# 客服消息条数超限改警告

## 范围与状态

2026-11-05，按用户指定的 `docs/autoimport-stuck-plan-closure-20261102/codex-提示词-消息数超限改警告.md` 施工并独立反审。原任务文件属于主检出已有未跟踪材料，未复制、暂存或修改。

基线 `382795b1fa5ea371371f748d4756840d4d7fd5e0`，分支 `codex/customer-service-message-warning-20261105`，工作树 `D:/codex-worktrees/customer-service-message-warning-20261105`。当前为待合并候选；未合并 main、未准备生产制品、未上线，未执行生产导入、恢复、迁移、服务启停或外部发送。

## 实现与保护范围

- `lib/customer-service/import-service.ts`：200 继续作为警告阈值。超过时不抛错、不裁剪会话；在最终匹配结果校验时，通过可选 callback 将会话序号、实际条数和阈值合入既有 `warnings` / `warningTotalCount`，继续复用 50 条、单条 500 字符、总字节 32KB 摘要。
- 前置 `parseChatLog()` 与后续 planner 校验不传 callback，因此只累计一次。`closure_evidence` 仍跳过条数分支，不增加警告，不改变结果或返回值。单条内容 4000 字符、时间格式及单会话 128KB 规则保留。
- Django `_messages()` 另有 `len(value) > 200` 硬拒，仅改 Worker 会在最终写入失败。本次同步移除这道数量拒绝及其独用常量，继续逐条验证和执行 128KB 预算；警告通过原有通道传入并保存，避免重复计数。未新增字段或 migration。
- 新增 6 项 Worker 回归和 2 项 Django 回归。历史已跳过的 D1 安全用例保留，只更新其中条数拒绝断言为完整保留，不启用其余退役 D1 断言。

受保护的 `tools/jd-customer-service-failure-closure.ts`、`tools/jd-customer-service-n8n-pipeline.ts`、分天文件生成、指纹等价检查、批次回查、`lib/customer-service/database.ts` 均无差异。11042 原失败计划、12 条来源计数差额及定时草稿显示问题未处理；本次代码不会自动闭合该失败。

## 验证结果

所有测试使用合成输入、临时目录及隔离 SQLite 测试库。两个工作树的 `node_modules` 按任务要求用 junction 连接主检出，未安装依赖。Django 只读取现有 venv 解释器及依赖，显式设置 test 环境、空 PostgreSQL URL 和各自工作树 SQLite 路径，不连接生产。

| 检查 | 候选 | 干净同环境基线 |
| --- | --- | --- |
| 指定 Worker 套件及 parser 套件 | 82 项，80 通过、2 失败，新增 6 项通过 | 76 项，74 通过、相同 2 项失败 |
| Django 客服全套及相关 workflow | 74 项，5 failures、2 errors，新增 2 项通过 | 72 项，相同 5 failures、2 errors |
| 完整 TypeScript 检查 | 168 条诊断 | 同为 168 条，完整输出逐字相同 |
| 原生 helper 隔离构建 | exit 0，真实闭包转换通过 | 输出在外部 artifact 目录，未运行 bundle、未准备生产制品 |
| Python AST、`git diff --check` | 通过 | 仅本次差异 |

命令：

```text
node --import tsx --test tests/jd-customer-service-*.test.ts tests/customer-service-import.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false
python -B backend/manage.py test customer_service.tests workflow.tests.test_jd_customer_service_close_authority workflow.tests.test_automation_gates_customer_service workflow.tests.test_automation_run_query_customer_service workflow.tests.test_import_chain_status workflow.tests.test_import_chain_config workflow.tests.test_api --noinput
node tools/build-worker-helper.mjs --source-root <本任务工作树> --output <外部artifact>/helper-build/tmall-workflow-helper.mjs
```

Worker 既有失败为固定 09:00 旧断言与当前 12:10 定义不一致、跨店模板定时节点名称不一致。Django 既有失败涉及两项闭合 authority 旧契约、两项 UTC/本机时区字符串断言、用户已注明的分页过滤用例；两条 error 来自同一库存工作流测试读取缺失的 `TmallWarehouseDaily2026` catalog key。均在未修改基线复现，本次不扩展修复。首次新增后端资源限制测试误期望 422，已按既有 API 400 修正测试并最终重跑，生产错误语义未改。

新增回归覆盖：200 条无警告，201 条完整保留且只计一次警告；51 条警告仅展示 50 条而总数仍为 51；与匹配警告累加；闭合证据结果保持；内容、时间、字节超限继续拒绝；分天重解析及完整指纹等价通过；Django 原有 API 保存全部 201 条消息并返回原警告摘要。数据库测试采用隔离 SQLite，不宣称已完成真实 PostgreSQL 或生产导入验收。

## 证据与交付边界

证据根目录 `D:/codex-artifacts/customer-service-message-warning-20261105/`：`worker-tests.txt`、`baseline-worker-tests.txt`；最终 `django-tests-final.txt`、`baseline-django-tests.txt`（首次记录保留在 `django-tests.txt`）；`typecheck.txt`、`baseline-typecheck.txt`；`baseline-comparison.json`、`compare_results.py`；`helper-build-receipt.json`、`helper-build/`。

[独立反审](REVIEW.md)通过。结论是零新增失败，可供合并审阅；并非全套检查全绿。原生范围计划覆盖 Worker 与 Django、无迁移。只有取得本次明确合并授权后，才合并并从最终 main 提交连续准备相应制品；上线仍需另行明确授权。当前分支未合并，保留工作树和开发分支。
