# P0-02 设计：知识与记忆在单店 Pi 环境下的可信绑定

日期：2026-10-29。基线 `3600f423`（分支基于 `f205e96f`，远端已前移）。承 [工具可达矩阵](MATRIX.md) 第 5 节：`search_system_knowledge` 与 `search_personal_memory` 均未对 Pi 开放，而方案 P0-02 要求接通。

本文只做设计。**不依赖 U1**（U1 只影响 ERP 销售取数），可独立于 [路径 A](PATH-A-DESIGN.md) 推进。未改动任何业务代码。

## 1. 为什么不能只加 surface

两个工具当前的 handler 只传 principal：

| 工具 | scopePolicy | handler |
| --- | --- | --- |
| `search_system_knowledge` | `metadata_safe` | `searchAiKnowledge(args, context.principal)` |
| `search_personal_memory` | `principal_scope` | `retrieveAiMemoriesForContext(args.query, context.principal)` |

执行 context（[tool-registry-contract.ts](../../lib/ai/tool-registry-contract.ts) 第 40 至 52 行）只有 `principal`、`surface`、`requestId`、`invocationId`、`persistentPiGateway`、`providerCallId`、`signal`——**没有任何店铺字段**。

而店铺归属无法由 principal 表达：[policy.py](../../backend/ai_assistant/policy.py) 第 210 行 `scope_filter()` 要求 `scope_json` 的键恰为 `warehouses`、`channels`、`platforms`，**没有 shop 维度**。这正是方案第 13 节「shopSelection 不是 principal.scope」的根源，不是疏漏。

结论：只加 `piReadOnly()` 包装会让单店环境拿到**未按店过滤**的记忆与知识，违反单店隔离。

## 2. 可信绑定的唯一现有通道是改写后的 args

[pi_gateway.py](../../backend/ai_assistant/pi_gateway.py) 第 258 至 265 行是现成范式：

```
selection = pi_selection.for_operation(op)          # 从可信 operation 解析
args = pi_selection.bind_arguments(name, args, selection, op.session_id)   # 改写 args
result = transport.execute_tool(name, args, principal, surface="pi_agent", ...)
```

`execute_tool()` 只接受 `principal` 与 `surface`，**selection 的唯一传递途径是被改写的 args**。`for_operation()`（[pi_selection.py](../../backend/ai_assistant/pi_selection.py) 第 26 至 30 行）从 operation payload 解析并严格校验键恰为 `{platform, shop}`，模型无法自报。

因此设计沿用该范式，不新增 context 字段：由 `bind_arguments()` 为这两个工具注入服务端产生的店铺绑定，handler 从 args 读取而非从 context。

## 3. 记忆：按类型分别处理

[memory.py](../../backend/ai_assistant/memory.py) 第 22 行 `KINDS = ["preference", "glossary", "business_context"]`。按方案第 13 节：

| 类型 | 单店环境下的处理 |
| --- | --- |
| `preference`（个人偏好） | 按既有 owner 规则照常可用，与店铺无关 |
| `glossary`（业务术语） | 同上，通用术语不含店铺经营数据 |
| `business_context`（业务背景） | **必须能证明店铺归属才注入**；无法证明的拒绝返回，不是仅从提示词删去 |

`business_context` 的归属无法从现有字段推出（模型表无 shop 字段，`scope_json` 无 shop 维度）。两个选项：

- **B-1（建议）**：单店环境下**不返回** `business_context`，只返回 `preference` 与 `glossary`，并在结果中明确标注该类型已被本环境排除。实现代价最小，不引入无法核验的归属推断。
- **B-2**：为记忆增加可核的店铺归属字段，由用户在写入时显式声明；单店环境按该字段过滤。需要迁移、写入界面与回填决策，属独立工程。

B-1 可立即实施且不损失正确性——缺的是覆盖面，不是准确性。B-2 在确有按店业务背景需求时再做。

## 4. 自动召回与主动检索共用过滤：基础已存在

方案第 13 节要求「自动注入和模型主动调用共用同一可见性函数」。该前提**已经成立**：

[memory.py](../../backend/ai_assistant/memory.py) 第 44 至 49 行 `visible(principal)` 是唯一可见性函数，第 231 行 `recall()`（自动召回，经 `views.py` 的 `memory-recall` 操作）与主动检索路径都经过它。

因此单店过滤**只需加在 `visible()` 之后的同一处**，两条路径自动一致。不要在召回侧和工具侧各写一份过滤——那会产生两份可能漂移的规则。

## 5. 知识：范围更窄但同样需要约束

[knowledge.py](../../backend/ai_assistant/knowledge.py) 第 55 行 `search(query, principal, limit=4)` 同样只有 principal。`search_system_knowledge` 的 `scopePolicy` 是 `metadata_safe`，意味着它面向全部角色且不做 scope 过滤。

按方案第 13 节，单店环境下「系统知识只开放不含其他店经营数据的稳定解释」。知识条目没有店铺字段，所以无法按店过滤。

**K1 已于 2026-10-29 由用户确认**：知识库条目均为通用口径解释，不含按店经营数据。因此单店环境下**知识全量开放**，不需要分类标记，也不需要新增过滤——现有 `search(query, principal, limit)` 的行为即符合第 13 节要求。

该结论是本次的输入前提，不是代码可自证的事实：若将来写入含店铺经营数字的条目，该前提失效，须回到加分类标记的方案。实现时在 `knowledge.py` 留注释记录此依据。

## 6. 拟定改动点

| 位置 | 改动 |
| --- | --- |
| [tool-registry.ts](../../lib/ai/tool-registry.ts) | 两个条目加 `piReadOnly()` 包装；**但须与下列后端过滤同批交付**，不得先开 surface |
| [pi_selection.py](../../backend/ai_assistant/pi_selection.py) | `TOOLS` 加入两个工具名；`bind_arguments()` 增加分支注入店铺绑定 |
| [memory.py](../../backend/ai_assistant/memory.py) | `visible()` 之后按绑定过滤：单店环境排除 `business_context`（B-1），结果标注被排除的类型 |
| [knowledge.py](../../backend/ai_assistant/knowledge.py) | 不改过滤逻辑（K1 已确认全量开放），仅加注释记录该前提 |

**交付顺序要求**：surface 开放与后端过滤必须同一批次。先加 surface 会在过滤就位前让单店环境读到未过滤内容。

## 7. 待确认项

| 编号 | 内容 | 影响 |
| --- | --- | --- |
| K1 | ~~系统知识库现有条目是否含按店经营数据~~ | **已确认：不含，单店下全量开放。** 该前提由用户提供，非代码自证；写入含店铺经营数字的条目会使其失效 |
| K2 | 是否需要按店的 `business_context` 记忆 | 若需要则走 B-2（加字段 + 迁移 + 写入界面），否则 B-1 足够。当前按 B-1 实施 |

K2 是产品决定，不阻塞 B-1 实施。

## 8. 本文边界

设计与源码查证，未改动业务代码、未执行构建、未调用模型、未读取任何记忆或知识内容。所有拟改动点开发前与当时最新 main 核对；注册表变更须按 [安全与 AI 工具](../规范/安全与AI工具.md) 同步测试。

## 9. 独立审查与设计重做（2026-10-29）

首版实现把单店标记作为**工具参数**注入（`singleShopRestricted` 进 `inputSchema`，由 `pi_selection.bind_arguments()` 剥除后重注）。独立审查判定该方案的信任边界不成立，已重做。

### 9.1 审查发现的缺口

`bind_arguments()` 只在 [pi_gateway.py](../../backend/ai_assistant/pi_gateway.py) 调用一次，全仓无第二处生产调用。但 `search_personal_memory` 经 `piReadOnly()` 包装后，`allowedSurfaces` 是**追加** `pi_agent` 而非限定为它——该工具本来就对 `ai_chat`、`ai_agent`、`codex_mcp` 开放。

而 [chat.py](../../backend/ai_assistant/chat.py) 第 1166 至 1168 行把模型生成的 `call["arguments"]` 直接交给 `transport.execute_tool()`，**不经过 `bind_arguments()`**。Worker 侧 [tool-registry-contract.ts](../../lib/ai/tool-registry-contract.ts) 第 389 至 391 行的 `additionalProperties: false` 只拒绝 schema 外字段，不限制谁能填 schema 内已声明字段。

因此：schema 一旦声明该参数，Chat 与 Agent surface 的模型即可自行填写，Django 侧只能做布尔类型检查，无法区分「Pi 网关从店铺绑定推导」与「模型自己编的」。首版注释声称的前提只对 Pi 链路成立。

该方向的实际后果有限（模型只能让自己更受限，不能解除别人加的限制），但字段的可信边界已破，不符合「服务端产生、模型不可触及」的要求。

### 9.2 重做后的设计

标记改为**执行 context 的旁路字段**，与工具参数完全分离：

| 环节 | 实现 |
| --- | --- |
| [transport.py](../../backend/ai_assistant/transport.py) | `execute_tool()` 新增 `single_shop` 命名参数，与 `arguments` 并列放入 edge payload 的 `singleShop` |
| [pi_gateway.py](../../backend/ai_assistant/pi_gateway.py) | 调用时传 `single_shop=selection is not None`，取自可信 operation |
| [django-edge.ts](../../lib/ai/django-edge.ts) | 仅当 `body.surface === "pi_agent"` 且 `body.singleShop === true` 才置入 context，其余 surface 一律 false |
| [tool-registry-contract.ts](../../lib/ai/tool-registry-contract.ts) | `AiToolExecutionContext` 新增 `singleShop?: boolean`，与既有 `persistentPiGateway` 同类——该字段也是按 surface 派生的可信标记 |
| [tool-registry.ts](../../lib/ai/tool-registry.ts) | schema **不再声明**该字段；handler 读 `context.singleShop` |
| [pi_selection.py](../../backend/ai_assistant/pi_selection.py) | 不再做剥除与重注，只保留 `TOOLS` 白名单 |

模型现在完全接触不到该字段：schema 里没有，填了会被 `additionalProperties: false` 直接拒绝。这与项目既有的 `persistentPiGateway: body.surface === "pi_business"` 是同一范式，不是新机制。

### 9.3 审查确认成立的项

Pi 链路内部剥除/重注逻辑自身闭合；`visible()` 未改动是正确范围划分（`list`/`get` 是 owner 人工管理入口，非模型路径）；`withheld` 计算在空 query 时不打数据库、语义准确；`knowledge.py` 注释准确描述了前提与失效条件，`rank()` 现仅按 `principal.role` 过滤；TS 签名变更不破坏既有测试（`tests/ai-memory.test.ts` 导入的是 `./legacy/ai/memory`，与 `lib/ai/memory.ts` 无导入关系）。

### 9.4 测试覆盖（审查指出缺口后补齐）

审查指出首版那处缺口正是因为缺少「Chat surface 下模型自填该参数」的测试才被放过。权限边界属自动化测试范围而非业务功能验收（见 [AGENTS.md 第 4、5 条的适用边界](../../AGENTS.md)），故已补三项：

| 测试 | 覆盖内容 |
| --- | --- |
| `tests.AiDomainTests.test_single_shop_recall_withholds_unprovable_kinds` | 默认路径三类齐全且无 `shopRestricted`；单店下排除 `business_context`、`withheldKinds` 与 `totalMatched` 正确；空 query 不虚报扣留类型 |
| `tests.AiDomainTests.test_memory_recall_consumer_guards_the_restriction_flag` | 非布尔标记一律拒绝（字符串、整数、null、数组）；缺省为不受限；为 true 时限制生效 |
| `test_pi_selection.test_knowledge_and_memory_reach_a_single_shop_environment_unaltered` | 两工具在单店白名单内；args 原样返回不被注入；模型无法经此函数取得标记 |

有效性已验证：临时移除 `recall()` 中的 `exclude(kind__in=SHOP_UNPROVABLE_KINDS)` 后第一项测试失败，随后原样还原（与提交版本逐字节一致）。测试会在回归时失败，不是只在当前实现下恰好通过。

仍未覆盖：`django-edge.ts` 的 `surface === "pi_agent"` 门控在 Worker 侧，本 worktree 无 `node_modules` 无法执行其测试。

### 9.5 本次验证

`compileall` 通过；`ai_assistant.tests` 与 `ai_assistant.test_pi_selection` 共 28 个测试通过。

`test_pi_transport` 与 `test_pi_runtime` 有 4 failures + 7 errors，经 stash 比对**干净 HEAD 上数字完全相同**，属既有失败基线，非本次引入。Worker 侧 TS 测试在此 worktree 无法执行（无 `node_modules`，报 `Cannot find package 'next'`），属环境限制。
