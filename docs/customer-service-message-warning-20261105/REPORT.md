# 客服消息条数超限改警告

> 本轮追加状态：同分支优先展示修复已写入工作区，源码独立审查通过；指定验证及 Git 交付尚未全部完成。以下原轮结果只代表 `0afaa4f3`，本轮结果见文末，不能据原轮“零新增失败”推定本轮就绪。

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

## 追加：超限警告优先展示

本轮从 `0afaa4f3` 在原分支、原工作树续作，开始时 tracked 工作区干净。已读共享记忆、完整 AGENTS.md 及适用规范；本地 main/origin/main 同为 `382795b1`，适用规范与工作树无差异。查询远端 main 因 GitHub 443 无法连接失败，未重试，不能保证远端此刻未推进。

### 实现与取舍

- Worker 摘要在截断前识别既有“第 N 条客服会话含 M 条消息，超过 T 条警告阈值，已保留全部消息。”文本，先选条数超限警告，再选其他警告；各类内部保持原顺序。已有 50 条歧义摘要时，随后追加的超限警告会替换最后一条歧义展示文本。
- Django `_warnings()` 同样先选优先警告；历史 `_batch_payload()` 调用同一个摘要函数，不再先切前 50 条。同时在 Django 明确执行既有 32KB 文本数组预算，未提高任何上限。
- `warningTotalCount` 仍为全部原始警告总数，包含未展示歧义警告；`warningsTruncated` 仍表示展示条数小于总数。本例应为 830、50、true。没有折叠或新增警告，不新增字段、migration 或出口。
- 选择精确文案分类，是为了沿用既有 `string[]` 与历史批次，不扩展传输或数据库契约。代价是两侧分类器须随生成文案一起维护，少展示一条歧义明细；超限类自身也仍受相同预算限制。历史批次若已在落库前丢弃超限文本，无法凭摘要恢复；本次仅能优先选择仍存在于输入/已存 items 的文本。
- 原“匹配警告与条数警告累加”用例的两个顺序断言随新优先顺序对调，计数、消息保留等断言保持。原有 6 项 Worker、2 项 Django用例均保留；新增 2 项 Worker、2 项 Django 回归，覆盖 829＋1、历史读取和预算。

受保护四文件相对 main 仍零差异；`closure_evidence`、分天生成、指纹等价、批次回查、4000 字符和单会话 128KB 校验未改。11042 的来源计数差额、闭合与定时显示仍不在范围内。

### 本轮实际检查

| 检查 | 结果与适用限制 |
| --- | --- |
| 警告定向 Worker 测试 | 8/8 通过，含原 6 项及新增 2 项；829 条歧义后追加 223 消息警告位于展示第 1 条，总数 830，展示 50，truncated=true |
| 原 Worker 套件＋parser | 84 项、62 通过、22 失败；包含既有 2 项失败，另有沙箱 EPERM `realpath C:\Users\86137` 及后续断言失败；不声称与旧基线一致，不自动重跑 |
| 完整 TypeScript | exit 2，168 条诊断；与原候选 `typecheck.txt` 统一换行后全文相同，无新增诊断 |
| Django 测试/语法检查 | 本轮未运行：原 runtime 目录拒绝访问，PATH 无 python，已发现的 `C:/Windows/py.exe` 报 `No installed Python found!`；未扩权、未安装依赖或连接生产 |
| 11042 真实文件 | 已只读尝试原始 list.xlsx＋messages.log 的直接普通 parser；在第 4037 行“会话时长(M)”必须是非负数值处拒绝，未到警告选择，本轮尚未取得真实可见性通过证据；未修改源文件或该校验 |
| 差异与保护范围 | `git diff --check` 通过；四个受保护文件相对 main 无差异，无 migration |

真实文件位于 `D:/谷歌浏览器/jd-maidehao-operator1/customer-service/11042/`，仅记录路径和失败类别，不保存正文/客户标识。静态核对发现标准分天入口已有显式 `negativeDurationToMissing` 预处理（`tools/jd-customer-service-daily-files.ts:38`）；本轮直接 parser 未启用它，不能把上述拒绝称作警告优先级缺陷，也不能复用 Lead 的正常路径结果冒称本轮可见性已通过。遵照本轮“失败不自动重试”，已停止此失败路径，正常预处理路径的真实复核交回 Lead。

本轮日志和检查脚本保存在工作树已忽略的 `.runtime/warning-priority/`：`worker.txt`、`types.txt`、`run-check.mjs`、`real-source-check.ts`。脚本仅作离线检查材料，不是生产制品；未运行任何生产 API。原轮外部证据保持原样。

### 交付状态与待答

- 独立 `gpt-6.1-sol/high` 新上下文源码审查通过；实际底层型号未独立确认，验证证据结论另见 [REVIEW.md](REVIEW.md)。不能据源码通过宣称全部验证完成。
- `git add` 一次失败：无法创建 `D:/运营管理系统/.git/worktrees/customer-service-message-warning-20261105/index.lock`，Permission denied。未扩大权限或重试；本轮未暂存、未提交、未推送，HEAD 仍为 `0afaa4f3`。GitHub 连接也已失败，未再尝试推送。
- 【待答】需要沙箱可读、已装 Django 的开发解释器，补执行本轮 Django 两项及原有指定范围；真实文件需由 Lead 按既有正常预处理路径继续核验；完整 Worker 失败基线也尚未在可比环境确认。
- 【待答】Git 索引写权限与网络恢复后，由受控开发会话核对完整差异，只暂存本任务六文件并完成提交、推送。本轮不执行合 main、制品准备、发布、迁移、生产写入或真实外发。
- 共享 Obsidian vault 在本沙箱写入范围外，未尝试越界写入。待记忆维护内容：警告展示需在每次截断前按同一优先规则选择，保留全量总数；当前仅工作区候选，Django/真实数据复核和 Git 交付未完成。由有写权限的 Lead 更新对应项目笔记，不能沿用原候选状态记为本轮成功。

## Lead 补充验证（2026-11-05，主会话在非沙箱环境执行）

上一节的三处【待答】由主会话补齐。以下结果取代该节对应的"未运行/未取得证据"记载；
施工方的谨慎记载保留原文，不删改，作为当时沙箱条件下的真实状态。

| 项 | 施工方结果 | Lead 复核结果 |
| --- | --- | --- |
| 11042 真实数据可见性 | 未取得证据（直接 parser 被时长校验拒绝） | **通过**：超限警告位于展示第 1 条 |
| 原 Worker 套件 | 84 项、62 通过、22 失败，无法判定基线 | **77/79 通过、2 失败，与 main 基线同名同因，零新增失败** |
| Django 测试 | 未运行（缺可用解释器） | **15 项全通过**，含本轮新增 2 项 |

### 真实数据复核（`tools/jd-customer-service-daily-files.ts` 的正常预处理路径）

对 `outputs/jd-customer-service-pipeline/jd-maidehao-operator1/11042.json` 指向的原始
list.xlsx + messages.log，按 `negativeDurationToMissing: true` 走正常路径，只读、未改源文件：

```
displayed warnings      = 50
warningTotalCount       = 830
warningsTruncated       = true
over-limit visible      = YES
   第 3748 条客服会话含 223 条消息，超过 200 条警告阈值，已保留全部消息。
daily files             = 30
conversations retained  = 5888（与修复前基线一致）
```

展示列表构成：超限警告 1 条 + 歧义明细 49 条。修复前同一输入的展示 50 条全部是歧义明细，
超限警告位于第 830 位被丢弃。三项验收判据（警告可见、总数未被缩小以掩盖、会话全量保留）均满足。

施工方关于"直接 parser 的拒绝不能算优先级缺陷"的自我纠正是正确的：
该拒绝来自未启用 `negativeDurationToMissing` 的调用方式，与本轮改动无关。

### Worker 套件基线对比（同一台机器、同一命令、非沙箱）

`node --import tsx --test tests/jd-customer-service-*.test.ts`

| | tests | pass | fail |
| --- | --- | --- | --- |
| 候选（本工作树） | 79 | 77 | 2 |
| main 基线 | 71 | 69 | 2 |

两侧失败为同名同因的 2 项：`n8n候选禁用、固定9点和时间锚点…` 与
`三份新增n8n定义与设备店逐节点同条件…`，断言期望 13:10 而实际 12:10，属既有定时时间断言漂移，
与警告改动无关。**零新增失败。**
施工方报告的 22 项失败在非沙箱环境未复现，归因为沙箱 `EPERM realpath C:\Users\86137` 的连带失败。

定向警告测试另单独复跑：`tests/jd-customer-service-message-warning.test.ts` 与
`tests/customer-service-import.test.ts` 合计 13/13 通过，含派工单要求的 829+1 场景。

### Django 复核

解释器 `D:/teruisi-runtime/django-sales/venv/Scripts/python.exe`（施工方沙箱不可达，故报缺失）。
`TERUISI_ENV=test DATABASE_URL="" python -B backend/manage.py test customer_service.tests --noinput`
→ **Ran 15 tests, OK**，system check 无问题。隔离测试库，未连接生产。

### 文案分类器的截断风险已排除

两侧分类器均为全文精确匹配（Worker `MESSAGE_COUNT_WARNING` 正则、
Django `MESSAGE_COUNT_WARNING.fullmatch`），而候选文本在匹配前会先按 500 字符截断，
若文案超长则匹配失效、优先级静默失败。实测文案 43 字符；
将会话序号与消息数都填至 8 位数的极端情况为 57 字符，距 500 字符阈值仍有 443 字符余量。
该风险在当前文案下不成立。两侧正则字面一致，且各自带有"改一处须同步另一处"的注释。

此脆弱点（施工方取舍第 1 条）成立但不触发；若将来修改警告文案，必须同步两处正则，
否则优先级会无声失效且测试未必覆盖。

### 仍然未做

- 未合并 main、未准备制品、未发布、未执行生产导入或迁移。
- 11042 自身仍未闭合：人工闭合入口对它仍返回 `closeAllowed: false`
  （`chatSessionCount 5046 ≠ checkpoint sourceCount 5058` 的 12 条差额，
  拦在 `tools/jd-customer-service-source-recovery.ts:229`），属另一件事。
- 远端 main 未核验（施工方 GitHub 443 失败）；合并前需确认远端未推进。
- 完整 TypeScript 诊断沿用施工方结论（168 条、与原候选逐字相同），Lead 未重跑。
