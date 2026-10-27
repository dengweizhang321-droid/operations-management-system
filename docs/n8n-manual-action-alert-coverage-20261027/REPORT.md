# n8n 转人工告警缺口补挂载（2026-10-27）

- 分支：`codex/n8n-manual-action-alert-20261027`（自 `main` = `e0dffdec` 创建）
- 来源：2026-10-24 系统审查报告第 26 项
- 状态：**改动完成并自测通过，未合并、未推送、未准备制品、未发布**（AGENTS.md 规则 4，三步各需用户单独授权）
- 分工：sonnet 施工，lead 独立验收

## 一、问题与机制

审查 #26：n8n 流程在「转人工」出口（掉登录、验证码、重试用完、派发结果不明）只在 n8n 留一条失败记录，不通知任何人。

告警机制已做好并合入 main（`f2bbbc0b` → `bb3dd101`），在
`automation/n8n/data-import-hourly-safe-retry.workflow.json`（工作流 id `TeruisiHourlyRetry2026`，13 节点），含三个节点：

- 「转人工发钉钉提醒」→ `POST http://127.0.0.1:3000/api/ai/channels`
- 「收集被丢弃的终局失败」
- 「告警-派发未知」

后端真实发送在 `backend/ai_assistant/channels.py:44`，发往 `oapi.dingtalk.com/robot/send`，非占位代码。

**缺口**：39 个 `*.workflow.json` 中 27 个已挂 `errorWorkflow`，12 个没挂；扣除告警目标自身，真实缺口 11 条。

## 二、关键安全依据：为何这 9 条是零业务副作用

重试流内有 `const targets = {...}` 白名单（13 个 workflowId → 各自重试 webhook）。不在白名单的失败归入 `droppedFailures`，走「收集被丢弃的终局失败」节点**只发钉钉提醒、不触发自动重试**。

lead 独立交叉验证（解析白名单后逐个比对本次 8 个 id）：

```
whitelist size: 13
  not in whitelist: JdCustomerService2026
  not in whitelist: JdCustomerServiceChudian2026
  not in whitelist: JdCustomerServiceCutMeat2026
  not in whitelist: JdCustomerServiceDishwasher2026
  not in whitelist: JdLogisticsDaily2026
  not in whitelist: TmallWarehouseDaily2026
  not in whitelist: NewProductWeeklyDingTalk2026
  not in whitelist: cF7wN8k2pQ5sR1vX

VERDICT: PASS - all 9 are alert-only, zero retry side effect
```

**所以本次挂载是纯增告警，不改变任何流程的重试行为。**

## 三、改动：9 个文件

每个文件的 `settings` 对象只新增一个键 `"errorWorkflow": "TeruisiHourlyRetry2026"`，未动 nodes、connections、active、versionId、meta、tags、pinData。

| 文件（`automation/n8n/` 下） | 工作流 id | 原 settings |
| --- | --- | --- |
| jd-customer-service-daily.workflow.json | JdCustomerService2026 | executionOrder, timezone |
| jd-customer-service-daily.candidate.workflow.json | JdCustomerService2026 | executionOrder, timezone |
| jd-customer-service-chudian-daily.candidate.workflow.json | JdCustomerServiceChudian2026 | executionOrder, timezone |
| jd-customer-service-cut-meat-daily.candidate.workflow.json | JdCustomerServiceCutMeat2026 | executionOrder, timezone |
| jd-customer-service-dishwasher-daily.candidate.workflow.json | JdCustomerServiceDishwasher2026 | executionOrder, timezone |
| jd-logistics-daily.workflow.json | JdLogisticsDaily2026 | executionOrder, timezone |
| tmall-warehouse-daily.workflow.json | TmallWarehouseDaily2026 | executionOrder, timezone |
| new-product-weekly-dingtalk.workflow.json | NewProductWeeklyDingTalk2026 | **executionOrder（无 timezone，唯一例外）** |
| tmall-yijiu-sycm-daily-import.workflow.json | cF7wN8k2pQ5sR1vX | executionOrder, timezone |

`new-product-weekly-dingtalk.workflow.json` 原本就没有 `timezone` 键，按该文件原有字段集合处理，只追加 `errorWorkflow`，未额外补 `timezone`。

改动方法：全部用精确文本替换。**未使用 `python json.dump` 或任何整体重写**（那会重排格式、丢缩进、改 unicode 转义形态）。

## 四、验证

| 项 | 结果 |
| --- | --- |
| JSON 合法性 | 9 个文件逐一 `json.load` 通过 |
| `git diff --stat` | `9 files changed, 18 insertions(+), 9 deletions(-)`，每文件 `3 ++-`（净增 1 行），无格式重写膨胀 |
| 差异形态 | 每处只是 settings 末键后加逗号 + 追加一行；其余字节未变 |
| id 与挂载值 | 9 个文件 id 与挂载值逐一核对正确 |
| 改动范围 | 仅这 9 个文件；未碰 `tools/`、主工作区 stash、`docs/施工协调-20261027/` |
| schema 校验 | package.json 无针对 `automation/n8n/*.workflow.json` 的校验脚本（`tmall:n8n:generate`、`n8n:retry:generate` 是生成器非校验器）。按纯配置改动处理，未新造测试框架 |
| 发布工具链 | 未跑（不需要，且其他会话在用 `tools/`） |

## 五、吉客云 2 个例外：只读调查，未改

`jackyun-five-dataset-daily.workflow.json`、`jackyun-five-dataset-http.workflow.json` 也缺 `errorWorkflow`，但 id 是 `J8kY2mQ5vR7sT4pN`，**在白名单内** —— 挂载会让它们进入自动重试路径，与上述 9 条性质不同。

### 结论：`api` 是当前生产实际使用的版本，`daily` 和 `http` 是历史/候选遗留

节点数实测：**daily=11、http=11、api=22**（lead 先前简报把 daily 与 api 的节点数对调了，此处更正）。

五条独立证据线一致：

1. 三者由同一生成器 `tools/generate-jackyun-export-first-workflow.mjs` 的三种模式产出（默认=daily 网页会话协议、`--direct-http`=http 直连候选、`--api-only`=api 接口导出）。
2. 运行时代码只 import api：`app/n8n-workflow-view.tsx`。
3. 生产重试策略表与导入链路目录都指向 api：`tools/n8n-hourly-retry-policy.mjs`、`lib/imports/chain-catalog.generated.json`、`backend/workflow/import_chain_catalog.json`。
4. 文档定性：`docs/规范/历史记录/既往开发与发布记录.md:746` 写明「现行定义为 jackyun-five-dataset-api.workflow.json」；`docs/自动化/吉客云/jackyun-http-export.md` 把 http 定性为「仍用于历史网页会话协议」。
5. api 是唯一带 scheduleTrigger（每天本机 00:10）、每小时重试 webhook 和 errorWorkflow 挂载的版本；git log 显示 daily 止于 09-07 早、http 止于 09-07 深夜（提交信息自称 candidate），api 持续演进到 10-13。

未直连生产 n8n 实例核验此刻挂载的 versionId，但仓库侧五条证据线一致。

**是否给 daily、http 挂载由用户决定**，本次未动。

## 六、待用户决定

1. 本分支是否合并到 main（AGENTS.md 规则 4，需单独授权）。
2. 吉客云 daily / http 是否挂载（会引入此前没有的自动重试）。
3. **时序建议**：`界面操作清单-20261027.md` 要求在 n8n 界面打开 12 条流，其中京东客服 4 店、京东物流、天猫仓库正是本次补挂载的对象。**建议本分支落地后再开流程**，否则这些流失败时无人收到提醒。
