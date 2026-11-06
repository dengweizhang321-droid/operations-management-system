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

- 本分支提供可调用 API；最小管理前端由主任务并线交付，按 API.md 协议接线。
- 未采用统一 Pi 自动执行 adapter、长期成本授权、可信消息/事件/条件生产者、精确数据依赖读取器、跨端 principal 与投递目标绑定；因此当前没有可启用的统一任务。
- 未创建任何真实任务或授权，未做身份绑定、账号接入、历史任务登记/切 owner、补跑、真实模型调用、外部投递或生产数据写入。
- 启用首个场景仍需明确：日报/库存/其他；精确店铺、Skill 和模型版本；时间/窗口/漏跑规则；执行账号与投递对象；长期授权有效期和成本边界。微信另需账号形态及 API 许可。

## 已实现的小项 2：有限 158→159 结构发布适配

- `ai_unified_tasks_{addition,catalog,candidate}.py` 只接受精确 158 代前驱和新 `0090_unified_tasks`，保留祖代 active/baseline/历史 recipe。结构安装只增空表、约束和 guard；不创建任务/授权或回填业务数据。
- PostgreSQL 17.11 独立集群验证：精确 158→159、五表为空、旧行/ACL 保留、writer 的 SELECT/INSERT/UPDATE（revision 仅 SELECT/INSERT）、reader 零授权、原生 FK trigger 禁用被拒绝、已提交159不重放。7 类检查通过，端口55522，集群已停、password/data 已清理。见 `structure-result.json`。结构结果记录运行当时的宽范围 codeSha，后续控制入口补齐不改已核 DDL/catalog，最终发布绑定以 mandatory checks/recipe 为准。
- PS5、PS7 各33项原生参数/分支/拒绝与 AST 检查通过；移除新有限分支及四个 CopyApp 成员后，原控制器 token 与基线一致。未执行完整服务冷启动，未更改 stop/start 语义。
- 发布器显式调用新代 AI ProvisionRoles，失败即停，不 finalize/启动/重放；不触发 Pi Runner 升级。Node 153 项定向检查通过，包含新代两项及所有直接受影响的原编排检查。
- 原生 Django 源码资格只追加本次候选 SHA，不修改祖代资格、现役控制包或生产签名。固定发布入口、启动完成 gate、备份结构清单、CI recipe 和冻结 OWNER 检查已接线。
- `tests/ai159-acl-catalog-boundary.py` 87 项静态契约检查、`check_catalog_baselines.py` 通过。最终 mandatory checks 在独立干净冻结树执行，recipe 绑定真实 gate.code_digest，不手填成功。

本包尚未合入 main、推送 main、准备生产制品、采用控制包、部署、迁移生产库或启用任务。后续应用组件范围为 Worker+Django及必要结构迁移。


## Astra 小项1反审后的核心增量

创建以 owner+clientRequestId 唯一、请求摘要冲突拒绝；精确原任务关联同时核同一专属会话、scope/角色/代际、店铺、模型版本、Skill 版本/摘要、完整指令/参数和原 grant 身份。生产内部 accept/claim/handoff 另有显式关闭门禁，不能绕过 API 停用状态。

数据库封死 unknown/终态回退，终态证据不可修改；Incident 只允许 open→claimed→closed、拥有者认领和非空说明，闭合后不可改。definition 指向 revision 的复合外键可延迟到提交，兼容先写定义后写 revision，同时拒绝悬空提交。run 冻结原 grant 与 triage ruleVersion，incident 继承该版本。未来时点不允许领取，原执行账号每次派发前重新核验。

列表只返摘要，limit<=50+cursor；历史修订、run、incident 全部可分页及按 ID 读取详情。run/incident 详情提供有界白名单证据引用和原 Pi evidence 读取路径，不返回原始外部正文。

最终核心+首场景隔离 PostgreSQL 共13项通过，原日志 `.runtime/ai-pg-469268264020/tests.log`。场景为用户确认的京东志高商用设备旗舰店经营日报：ERP本店销售与全部计入库存仓分别绑定范围、日期、字段和revision；缺ERP金额字段时无模型/投递，补齐同日期新版本后用真实Pi队列和冻结绑定经过合成模型/合成投递边界。原投递unknown仅观察/分诊，重复tick不新增模型或投递。结果见 `daily-scenario-result.json`。

该演练使用独立PG和合成源/模型/投递，不是生产dispatcher启用证明；生产任务仍停用，内部派发关闭。可复现命令：`python -B tools/ai-postgres-rehearsal.py --tests-only --preprovision-ai-runtime-roles --test-label ai_assistant.test_unified_tasks --test-label ai_assistant.test_unified_task_daily_scenario --test-verbosity 2`。


## 报告与投递阶段增量

Astra 指出“Pi成功不能代表任务投递成功”后，已在 run 增加 report_status、delivery_status 与每目标稳定 deliveryId/targetDigest/original receiptRef 的有界持久回执。实际 observer 先把 Pi succeeded 记为 report ready；若有目标，run 保持 delegated/delivery pending。只有原回执全部 sent 才 final succeeded；unknown/failed 分别入账和分诊，原 ID/目标和已终结回执不可替换。observer 本身只读原账本，不发消息，未采用的生产投递 adapter 留 pending。

首场景已移除手工改 unknown 的路径，真实 observer 依次观察报告成功→投递pending→原合成账本unknown；重复观察不调用发送或改ID。另一个隔离案例验证 sent 回执到齐后才 succeeded。最新核心+场景14项通过，原日志 `.runtime/ai-pg-c1bc219f7693/tests.log`；SQL和catalog已重采。

## 仓库既有检查限制

全仓 TypeScript 检查有168条既有诊断，全部诊断文件相对 origin/main 无P2修改；本次没有改变公开TS类型接口。backend-boundary 只报既有 `tools/tmall-sycm-cookie-pipeline.ts -> lib/jackyun/n8n-preflight-evidence.ts`，相关三个检查/源文件均无P2差异。原日志及范围证明为 `typescript.log`、`backend-boundary.log`、`existing-check-limitations.json`。未据此扩入天猫或全仓类型修复，也不把这两项冒称通过。
