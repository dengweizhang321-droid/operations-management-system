# F2：结构性 HTTP 4xx 终局判定

日期：2026-11-03。基线：`eab998f81c984ee3d9e722bcd39f0f46a53a9820`（动手前 fetch 核验的最新 origin/main）。
分支：`codex/retry-structural-4xx-20261103`；工作树：`D:/codex-isolated/retry-structural-4xx-20261103`。

## 范围与依据

按用户 F2 提示词修改共享重试判据、既有测试和生成工作流。仅交付分支，不合并、不准备生产制品、不发布、不导入 n8n、不手动执行工作流；主工作区文件及已有 stash 不操作。

`app/api/netshop/import/route.ts` 的文件上限拒绝返回 413；`tools/jd-promotion-export.ts` 失败抛点仅提供 `京准通推广导入失败 (HTTP ${response.status})`，故不能依赖“文件超过 25MB”正文分类。基线函数离线复现：400、413、415、422、503 均为 `retry:true / retryable_failure`。本任务不修改抛点、不诊断 CSV 实际体积、不修上传容量。

在 [共享策略](../../tools/n8n-hourly-retry-policy.mjs) 的终局数组末尾新增独立规则，21 条变为 22 条，原有 21 条（包括第 5 条凭据/401/403规则）逐项保持：

```js
"\\bhttp\\s+(?:400|413|415|422)\\b"
```

实际正则为 `/\bhttp\s+(?:400|413|415|422)\b/iu`。显式枚举状态码以分离认证类与结构性拒绝语义；`iu` 沿用原编译标志，支持大小写变体；`\s+` 接受实际单空格及多空格、制表符；两端词边界防止误匹配 `XHTTP 422`、`HTTP 4130`、`HTTP 415x` 等其他 token。规则不绑定店名、工作流 ID 或括号形式。

| 状态码 | 本任务重试策略 | 判断依据 |
| --- | --- | --- |
| 400 | 终局，转人工 | 请求内容/格式拒绝，原请求重复派发不修正输入 |
| 413 | 终局，转人工 | 请求体过大，等待不缩小原文件；本链路有明确体积门槛 |
| 415 | 终局，转人工 | 媒体类型不受支持，需要修改输入或上传方式 |
| 422 | 终局，转人工 | 内容语义不被接受，需要修正内容 |
| 408、429 | 保持可重试 | 请求超时、限流可能随时间消退 |
| 500、502、503、504 | 保持可重试 | 服务端、网关或超时故障可恢复，本规则不覆盖 5xx |

这是用户指定的自动化策略，不宣称所有接口的 400/413/415/422 永远不能恢复。这里停止的是未经修改的每小时自动重放，后续人工修正另论。其他原有终局证据仍优先，例如同时存在凭据错误和 503 时不会因为 503 自动放行。

## 验证

全部用例写入 [既有测试文件](../../tests/n8n-hourly-retry-workflow.test.ts)，完整结果 **48/48 通过**：

- 指定正向 4 条：400、413、415、422，均 `retry:false / manual_intervention_required`。
- 指定反向 11 条：408、429、500、502、503、504，加连接中断、连接拒绝、runner 超时、Django 暂时不可用、helper 槽位不可用，均 `retry:true / retryable_failure`。
- 六条既有判定回归 6/6：物流未决保留、文件校验拒绝、导入/覆盖回查失败、服务端时钟未验证、阿里妈妈 HTTP 403、PREVIOUS_RUN_UNRESOLVED_MANUAL_ACTION，均保持终局。
- 额外格式正向 4 条和边界反向 4 条通过，另一个京东推广店同样覆盖；加上指定用例共新增 29 个参数化测试，原有 19 个测试保留。
- 上述矩阵同时检查 trigger/webhook 两种模式、message/description 两个字段、仓库分类函数/即时生成 Code/落盘 artifact Code 三个执行面。终局明确断言无 retryPolicy、有 noRetryTarget 和 droppedFailures；可重试明确断言 retryPolicy 与 URL，避免数组非空造成假阳性。
- 既有 preflight 测试加入四种结构性 HTTP 错误，确认特例不能覆盖新终局；已绑定下载恢复测试补充“合法恢复标记 + HTTP 413”反例。

隔离 worktree 无本地依赖，测试通过现有只读 tsx loader 运行，未安装或修改主工作区依赖：

```powershell
node --import file:///D:/%E8%BF%90%E8%90%A5%E7%AE%A1%E7%90%86%E7%B3%BB%E7%BB%9F/node_modules/tsx/dist/loader.mjs --test tests/n8n-hourly-retry-workflow.test.ts
```

生成器 `node tools/generate-n8n-hourly-retry-workflows.mjs` 连跑两次。对 automation/n8n 下全部 40 个 JSON（包括生成器的 19 个输出）做 SHA-256 比较：

1. 首次仅 `data-import-hourly-safe-retry.workflow.json` 改变；分类器 jsCode 仅第 2 行 terminalPatterns 数组增加一条。恢复这一行后，全对象与完整序列化字节均与基线一致。16 个节点、连接、IF 分流、人工提醒分支和其他配置全部保持。
2. 第二次全部 40 个 JSON 零字节变化，diff 为空。

本地诊断脚本和完整哈希证据：`D:/codex-artifacts/f2-structural-4xx-20261103/verify-generator.mjs`、`generator-evidence.json`。该脚本用于开发阶段未提交基线对比，不是生产制品或业务工作流执行。`git diff --check`、策略及生成器的 `node --check`、本文相对链接检查均通过。

## 独立反审与交付状态

独立反审：**通过，无本次范围内的实际缺陷或有证据支持的阻断风险**。审查上下文 `/root/f2_independent_review` 未参与方案和实现，请求模型为 `gpt-6.1-sol`、强度 `high`；工具未提供实际底层型号的独立证明，不冒称已验证型号。

审查者独立阅读原始提示词、源码与差异，重新执行指定测试文件 **48/48 通过**；另以只读脚本核对全部 40 个 JSON 的真实基线/当前字节摘要与生成证据一致，确认首次只改目标正则表、二次哈希全等，恢复该行后完整序列化字节等于基线，16 节点、全部连接和人工分支保留。未提出需要修改的项。

交付仅包含本分支四个任务文件（策略、测试、生成 artifact、本文），推送后以最终 Git 提交和远端读回为准。此分支尚未进入线上；线上既有 waiting execution 未作任何处置，不能据本地测试宣称小时重试已停止。
