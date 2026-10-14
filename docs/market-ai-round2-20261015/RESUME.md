# P0 恢复请求回执与未知结果确认

日期：2026-10-15。基线 `cabf97f1`，开发树 `codex/market-ai-round2-20261015`。本报告为实施者自验；独立审查、合并、制品及生产采用由总控另记。未提交、推送或操作生产；本轮真实供应商调用为零。

## 历史 503 的事实边界

总控通过正式 writer 凭据的 READ ONLY 事务读取原回执：创建于上海时间 `02:30:23.109904`，完成于 `02:30:53.288886`，创建至完成 `30.178982` 秒；回执为 completed/HTTP 200，原任务、running、resumeAccepted=true、quarantinedExpiredClaims=true。SDK 默认等待期限为 30 秒。该记录证明原成功提交落在默认等待期限之外；未保留旧请求各阶段 trace，不能把全部等待归因数据库锁、旧租约隔离或某一个 SQL。原件由总控保存在 `D:/codex-artifacts/market-ai-round2-20261015/resume-receipt-private.json`，本报告不复制账号或业务行。

## 已实现契约

- 浏览器首次发送前生成并保存 operationId；不可变命令字段为 action、jobId、state、expectedControlVersion、operationId。SDK固定原 requestId 为 `annotation-control-<operationId>`，固定 JSON 字段顺序并纳入现有签名、body/query SHA 和 actor binding。
- 原 `MarketWriteRequestReceipt` 继续拥有请求完成事实。commands 成功业务修改、控制审计、控制版本与成功回执在原事务中一起提交。已回滚的明确 4xx 业务拒绝可持久化为拒绝回执；未知异常不写成功或明确拒绝。
- 公开 `GET /api/market/annotations?view=control_operation` 由当前真实 operator/admin 和无限制 scope 保护，签名进入 writer 已有 `/api/market/commands` 的精确 `market-annotation-control-query-v1` 合同。该分支不进入 `_replay_fenced_write`，PostgreSQL使用 READ ONLY、3秒 statement timeout、1秒 lock timeout；没有 reader 扩权、schema 或 migration 改动。
- 查询同时核对 actor、原requestId、方法、路径、body/query摘要、任务、目标state、原控制版本、完成结果及关联审计。只返回受限确认字段。completed 成功但无匹配审计仍为 unknown；缺失不证明未执行，503/查询403不证明原失败；processing 也不触发重POST。
- 返回 `succeeded/rejected/processing/unknown`。已确认原恢复与当前任务进度分开展示：恢复后自动暂停或完成不撤销原提交证据，旧 receipt 不用于覆盖当前状态。
- 控制token放在原 `retry_state_json.controlVersion`，合法既有缺键使用固定初始token；非对象、显式null或畸形已有token拒绝，不重新生成初始值。心跳、领取、普通成功和退避快照保留token；人工控制、过期未知隔离、自动暂停、自动完成及归档推进token。同模型配置失败的原批量暂停以单次 JSON更新同时推进相关token，保留其他retry字段及原模型锁，不截断同模型计划集合。取得job和run锁后校验CAS；取消/终态先发生时迟到恢复被拒绝。当前没有新增取消API。
- 浏览器按账号保存最多20个原意图，job和权限scope使用独立generation。未确认请求阻止创建替代任务和同job第二次控制；容量达到上限拒新，畸形/超界/读写失败的存储失败关闭。取消等待、换任务、权限变化和卸载只取消本地等待，原意图保留，不自动发相反补偿。账号切换不展示前一账号记录，角色/scope变化保留同账号原意图。
- POST等待最多30秒，后续最多三次只读查询共用15秒确认预算，单次最多5秒；独立期限也能收口忽略取消的受控替身。超预算保留未确认，并提供继续查询原请求。新日志只记 received、receipt_created、job_run_locked、expired_claims_checked、control_audited、committed 的固定阶段、操作标识和有界耗时，不记凭据、图片、模型正文或思维。

兼容任务按钮现在仅切换并载入原任务，提示使用当前任务恢复按钮；创建与恢复不再混为一个未知意图。并发仍由原“保存并应用”独立命令保存，恢复回执不声称并发保存也原子成功。恢复按钮、等待标签和实际执行统计使用服务端目标并发（缺失时使用服务端配置），输入草稿不冒充已生效配置。

## 自验结果与原失败

1. 隔离 PostgreSQL `55459`：新 resume 11、诊断3及原 queue/blocker相关测试共44项通过。另在最终字节上定向复验 resume/诊断14项，通过原reader/writer授予契约、真实签名view与所属writer只读回执查询，集群已停止。
2. Node 定向22项通过：成功与丢响应、明确拒绝、缺失/403未知、重复点击、取消+迟到、刷新/权限变化保留、错误身份/结构、容量/存储失败、共同期限与签名SDK固定字节。修改文件 lint 通过；生产后端边界670模块零违规，`git diff --check`通过。
3. 总控另运行真实React受控HTTP交互测试；此处不把helper测试称为React验证，也不把作者自验称独立审查。

首轮自验因 TransactionTestCase 全库flush涉及无关受保护AI表而失败，后续同名 fixture重复；改为 `available_apps=['market']` 并每次重建authority/revision后通过。组合P1 benchmark曾同样遇到flush失败，交总控/P1处理，未修改业务门禁。初次reader探针使用COUNT误把已有列级读取当全回执权限，改为显式读取被排除的 response_payload，实际被拒绝；已保留误判失败。一次已通过roles的运行外壳因阶段日志混入JSON解析失败，修为只解析末尾JSON并最终完整exit0。原失败均保留，不回填成功。

## 同任务阶段证据与限制

[最终阶段证据](evidence/resume-final-lifecycle.json)包含合成计划创建、签名启动、签名领取、模拟取图、模拟模型、局部校验、签名回写和reader回读的开始/结束、单调耗时和状态。结果为模拟模型完成1、历史0、失败0、未知0；并行阶段不相加。本探针创建使用 QueueFixtures ORM 合成计划，未声称它验收P1实际规划创建；取图和模型为模拟，严格结果落库仍走真实后端。不是生产吞吐、业务分类准确率或真实供应商验收。

最终14项和角色证据见 [resume-final-pg.json](evidence/resume-final-pg.json)，源码字节见 [resume-source-manifest.json](evidence/resume-source-manifest.json)。44项原回归、最终测试/角色日志、TS/lint和全部失败共11份材料已逐SHA保全在 `D:/codex-artifacts/market-ai-round2-20261015/resume/manifest.json`。发布恢复必须先读取最新 `progress.cloudRun.controlVersion`，每个新人工意图使用新operationId；结果未知只查询原意图。
