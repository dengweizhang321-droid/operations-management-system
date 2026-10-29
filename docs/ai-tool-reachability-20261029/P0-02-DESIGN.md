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

按方案第 13 节，单店环境下「系统知识只开放不含其他店经营数据的稳定解释」。知识条目没有店铺字段，所以同样无法按店过滤。建议与 B-1 一致：单店环境下只开放不含经营数字的条目，判定依据需要知识条目自身的分类标记——**当前没有这样的标记**，故这一项需要先确认知识库实际内容是否含按店经营数据，再决定是全量开放、全量排除还是加标记。

这是本设计的待确认项（见第 7 节 K1）。

## 6. 拟定改动点

| 位置 | 改动 |
| --- | --- |
| [tool-registry.ts](../../lib/ai/tool-registry.ts) | 两个条目加 `piReadOnly()` 包装；**但须与下列后端过滤同批交付**，不得先开 surface |
| [pi_selection.py](../../backend/ai_assistant/pi_selection.py) | `TOOLS` 加入两个工具名；`bind_arguments()` 增加分支注入店铺绑定 |
| [memory.py](../../backend/ai_assistant/memory.py) | `visible()` 之后按绑定过滤：单店环境排除 `business_context`（B-1），结果标注被排除的类型 |
| [knowledge.py](../../backend/ai_assistant/knowledge.py) | 待 K1 确认后决定 |

**交付顺序要求**：surface 开放与后端过滤必须同一批次。先加 surface 会在过滤就位前让单店环境读到未过滤内容。

## 7. 待确认项

| 编号 | 内容 | 影响 |
| --- | --- | --- |
| K1 | 系统知识库现有条目是否含按店经营数据 | 决定单店下知识是全量开放、全量排除还是需加分类标记。需读取知识条目内容，属业务数据，须用户授权或由用户自行判断 |
| K2 | 是否需要按店的 `business_context` 记忆 | 若需要则走 B-2（加字段 + 迁移 + 写入界面），否则 B-1 足够 |

K1 不需要数据库连接即可由用户回答（他们知道自己写了什么知识条目）。K2 是产品决定。

## 8. 本文边界

设计与源码查证，未改动业务代码、未执行构建、未调用模型、未读取任何记忆或知识内容。所有拟改动点开发前与当时最新 main 核对；注册表变更须按 [安全与 AI 工具](../规范/安全与AI工具.md) 同步测试。
