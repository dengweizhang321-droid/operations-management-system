# 与 main 13eb2579 的冲突整合说明

2026-11-02，合并期间 main 新增 `13eb2579`，本任务候选与其在四个客服文件发生冲突。本次仅做源码整合，未执行功能测试、生产 verify、闭合、重跑或导入；必要代码检查与 Astra/Sol 增量反审由任务负责人统一记录。用户已授权本次合并及对应制品准备，未授权上线。

## 保留的双方能力

| 文件 | 整合结果 |
| --- | --- |
| `lib/customer-service/import-service.ts` | 保留 main 的 `CustomerServiceImportError.code` 及消息数量、内容长度、日期和总字节各固定错误码；同时保留本任务贯穿 `parseChatLog` 与外层完整解析的 `closure_evidence` 策略。正常默认 `import` 仍执行原 200 条上限，闭合策略仅略过数量条件。 |
| `tools/jd-customer-service-daily-files.ts` | 保留 main 的固定 `customerServicePairParseDetailCode()`、`PAIR_PARSE_REJECTED` 的 `detailCode/cause`；全范围解析继续传入本任务 policy，分块和分天重解析同样保留 policy 与完整边界。 |
| `tools/jd-customer-service-n8n-pipeline.ts` | 保留 main 的原 owner `restoreAndVerifyCustomerServicePlan()`、店铺/execution/active/plan 校验及原 helper 路由调用；路径函数统一使用本任务导出的 `customerServicePlanFiles()`。`verifyCustomerServicePlan()` 第三个参数统一为 options：原 owner restore 传 `beforeComplete`，operator 入口传 `beforeCommit/operatorVerification`。两个回调均在修改 stage 前等待完成；operator marker 与 completed 仍在同一次 durable 原子 plan 写入。原 B 失败继续保留 main 的受控 `detailCode/cause`，并保留本任务的失败边界见证。 |
| `tools/jd-customer-service-source-recovery.ts` | 保留本任务独立 v2 closure 查询、共享证据、`downloaded_list_only`、`executed_verify` 及后续正常 A 的 fresh 采集语义。将 main 的受控 pair 解析 detailCode 接入新版闭合 reason，只返回固定白名单码。原 source-recovery 消费者的 TTL、同 period、唯一消费者及旧来源复用限制不变。 |

`tools/tmall-sycm-cookie-pipeline.ts` 已由 Git 自动合入 main 的调用接线；其原 helper 所有权准入与磁盘 restore 分支继续调用统一后的 `restoreAndVerifyCustomerServicePlan()`。本次没有通过删除这条调用或选择单侧文件来消除冲突。

原 owner restore 与本任务独立 operator reconcile 是两个受控入口，不能互相替代授权或绕过 slot 所有权。前者仍要求原 helper execution/store 所有权及规划锁下的提交前原字节回调；后者仍要求新 v2 operator authority、helper reservation、n8n 终态、规划锁/全局 Chromium 锁、端口与提交前 CAS，并持久保留完成标记及历史结果查询。原正常内存 C 分支继续不传恢复 options。

## 历史说明的适用阶段

[13eb2579 的 RECOVERY.md](../autoimport-review-fixes-20261102/RECOVERY.md) 记录其提交时的修复范围与调用纪律，保留为历史交付证据，不改写它。

其中“downloaded_pair 是同 period 来源复用审批”“审批本身不闭合 active”描述的是旧 `CustomerServiceRecoveryApproval`，在原 source recovery 路径上仍成立；不能套用到本任务新增的独立 `failed_closed` 回执。其“当前不支持仅 list 闭合”“不新增 downloaded_list_only”是该旧阶段的范围说明，本次独立 v2 已增加严格 list-only 控制流证明及失败闭合，因此不作为当前新版 operator 查询的拒绝条件。

同理，历史说明中 `executed` 需要原 C 收尾的判断保留；新版 operator 查询可以返回 `executed_verify` 受控动作，不再覆盖回旧阶段的 `closeAllowed=false` 文案。真正的原 C 完整判据没有放宽，也不会将 failed 闭合误写成 completed。

## 本轮收尾

四个冲突文件的冲突标记已移除，双方有效解析、诊断、恢复与独立闭合能力共同保留。两个 helper 入口内存编译通过，14 个入口及依赖的类型对照无新增诊断，Git 差异检查通过。Astra 和 GPT-6.1 Sol 分别对四文件与直接调用做增量反审，均通过、无新增 P1/P2；没有重复全量审查或功能验收。最终合并提交与对应制品以负责人交付回执为准。
