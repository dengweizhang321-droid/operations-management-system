# P2 统一自动任务控制主体

基线：`77382b5fc4ad958e1c22e7d9f8431bffdafdb204`。施工依据为统一方案 §8/9/10/17；本包不接管旧任务，不启用自动执行。

## 已实现的小项 1：持久控制契约与可调用管理接口

- 默认停用的任务草稿、追加式不可变 revision、精确 Skill 版本/摘要、单店、模型版本、时间/消息/事件/条件触发定义、原时点窗口、漏跑策略、数据依赖及投递目标。客户端不能指定 owner、角色、executor 或 enabled。
- 五张新增表：definition/revision/grant/run/incident。`(task, trigger_kind, occurrence_key)` 跨 revision 唯一；run 冻结原 revision。租约采用单调 fencing；已关联 operation 或 unknown 不重新领取。
- Pi handoff 只绑定原 operation，检查 run 身份、owner、角色及范围；观察原操作不会新建执行。此为内部控制账本接口，尚无已采用的自动触发/执行调用者。
- Incident 固定规则版本、证据、归属、恢复条件、通知身份；认领/关闭均 CAS。关闭不改原 failed/unknown、不自动重跑、不发送通知。
- legacy-owned 只读投影复用原钉钉调度，n8n 继续原 owner；不登记、复制 cron、迁移历史或触发补跑。
- `GET/POST /api/ai/pi/task-definitions`；`GET /{id}` 与 `/revisions`、`/runs`、`/incidents`；`POST /{id}/enable|disable`；`POST /api/ai/pi/task-incidents/{id}/claim|close`；只读 `/task-connectors`、`/legacy-tasks`。全部走原 AI writer、真实 principal 与服务端 admin gate。
- enable 返回具体未就绪项；PostgreSQL guard 同时拒绝 enabled=true。资源库 guidance 与 Pi 容器 Skill 明确区分，未冒称已加载。

隔离核验：原 `tools/ai-postgres-rehearsal.py --tests-only --preprovision-ai-runtime-roles --test-label ai_assistant.test_unified_tasks --test-verbosity 2`，独立端口 55443、独立临时集群，7 项通过；原日志 `.runtime/ai-pg-51552286de0e/tests.log`。`makemigrations --check --dry-run` 无模型漂移，`git diff --check` 通过。首轮 migration RunPython 放置错误在隔离迁移规划阶段被拒绝，已移至 operations；原失败日志保留 `.runtime/ai-pg-1cd2fea02596/failure.log`，最终通过不覆盖失败证据。

## 尚未完成或未获准的业务范围

- 未实现任务管理前端；本包提供可调用 API。
- 未采用统一 Pi 自动执行 adapter、长期成本授权、可信消息/事件/条件生产者、精确数据依赖读取器、跨端 principal 与投递目标绑定；因此当前没有可启用的统一任务。
- 未创建任何真实任务或授权，未做身份绑定、账号接入、历史任务登记/切 owner、补跑、真实模型调用、外部投递或生产数据写入。
- 启用首个场景仍需明确：日报/库存/其他；精确店铺、Skill 和模型版本；时间/窗口/漏跑规则；执行账号与投递对象；长期授权有效期和成本边界。微信另需账号形态及 API 许可。

结构发布材料、冻结 catalog、有限 158→159 recipe 与原生发布接线作为小项 2 继续交付；此阶段尚未声明可合并或可发布。
