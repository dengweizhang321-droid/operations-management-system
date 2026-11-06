# 两处「代码在那儿但没人能用」的处置（2026-11-06）

分支 `codex/fix-dead-surfaces-20261106`，基于 `origin/main` `41921aa3`。

两件形状相似、**结论相反**。下面是判断依据，全部实查。

## 一、`reports/<id>/market-dynamics` —— 保留，不接也不删

### 它的状态

| 侧 | 实查 |
| --- | --- |
| Django 路由 | `views.py:216`（方法白名单 `{"GET"}`）、`views.py:445-447`（dispatch） |
| Worker `PUBLIC_PATH` | **零放行** —— `ai-service.ts:10` 的 `reports(?:/…)` 枚举里没有 `market-dynamics` |
| TS/TSX 引用 | **零** |
| handler 别的入口 | **无** —— `business_market_runtime_tools` 全仓只被 `views.py:446` import |

### 为什么不是「被落下」

最初我以为它和兄弟 `market-observation` 是同一次加的、其中一条漏接了 Worker。**实查否掉了这个前提**：

- `c144f37c`（2026-09-23）**只加了 dynamics**，`--stat` 里没有任何 observation 相关文件
- `market-observation` 是**后来另一次**加的，并且有专门的内部入口（`INTERNAL_MARKET_OBSERVATION_PATH`，`ai-service.ts:15`）**和真实消费者**（`lib/ai/business-market-observation.ts`）

所以 dynamics **从一开始就没接 Worker**，不是漏接。

### 为什么保留

`c144f37c` 自带的文档（`docs/AI_BUSINESS_MARKET_DYNAMICS.md`）把它明确定位成**候选**，原文：

> ### 内部只读HTTP候选
>
> 此时内部只读服务已可被系统调用，但**尚未注册** Agent 工具、节点证据引用或 HTML/XLSX 文件目录。

所以它是**刻意留的内部只读候选**，等将来注册工具时用。配套还有 123 行测试（`test_business_market_runtime_tools.py`），覆盖两视图/精确行、严格参数与 JSON、签名/角色/范围/错误方法、38KB 完整封套及撤权。

**删它会丢掉这些**：65 行实现 + 123 行测试 + 一份已通过隔离 PG 验证的契约（文档记 11 项合跑通过，日志 `.runtime/ai-pg-8f22cb2594bd/tests.log`）。

**接它也不对**：现在没有消费者，接上就是凭空扩大 Worker 的放行面。`market-observation` 当初接 Worker 是因为**先有了 `lib/ai/business-market-observation.ts` 这个消费者**。

### 结论

**保留现状，不改一行。** 这不是「死代码」而是「未注册的候选」——
和 `pi_research` 当初被误判成「零 TS 调用方所以是缺口」是同一类误读，区别只在
`pi_research` 实际已可达，而这条确实还没接、但本来就不该现在接。

**将来要接时的做法**（参照 observation，不要扩 `PUBLIC_PATH`）：
新建 `INTERNAL_MARKET_DYNAMICS_PATH` 正则 + `isInternalMarketDynamicsPath` 导出
+ `requestDjangoAi` 守卫分支 + reader/GET-only 检查。不需要 route 文件。

## 二、JD `closeRequestId` —— 删掉死分支

### 它的状态

`jd_customer_service_close_authority.py:71-72`（删前）：

```python
    if "closeRequestId" in payload:
        identity(payload["closeRequestId"])
```

`:52` 的键集是**精确两键** `set(payload) != {"action", "target"}`，所以带第三个键的 payload
在 `:53` 就被拒，这两行**永远到不了**。

### jackyun 那边的语义（这是决定依据）

| | JD | jackyun |
| --- | --- | --- |
| 键集 | `{action, target}` **一种** | `{action, target}` 或 `{action, target, closeRequestId}` **两种**（`:13`） |
| 该键的校验 | `:71-72`（不可达） | `:26-27`（可达） |
| `read_authority` 是否重取该键 | 无 | **有** —— `:55` 从存库回执里按 `("action","target","closeRequestId")` 取出重验 |

所以 jackyun 是**真在用**它（半闭合续接要靠它绑定前一次请求），而 JD 不是。

### JD 这边有等价机制

本会话已查实：**客服闭合的 `request-id` 就是 `authorizationId`**。
JD 路径用 `X-Teruisi-Request-Id` 承担同一职责，而 `identity()` 在
`:85`/`:93` 仍然校验它 —— 所以删那两行**不会**让 `identity()` 变成死代码。

### 结论

**删掉 `:71-72`。** 保留它会让人以为 JD 支持这个别名（照抄 jackyun 的写法时尤其容易），
而 `app/jd-customer-service-close-controls.tsx:9` 的 body 类型只有 `{ action; target }`。

## 测试

新建 `backend/workflow/tests/test_jd_customer_service_close_request_id_removed.py`，7 项全过。

它钉住的不只是「删了」，而是删之后**可观测的行为**：

1. **合法 UUID 与畸形值被同等拒绝** —— 这正是「那道 per-key UUID 校验不可达」的证明。
   如果只测畸形值，删不删都绿
2. 精确两键是唯一被接受的形状（缺键、多键各自被拒）
3. **`identity()` 仍然活着** —— 它还在守 `X-Teruisi-Request-Id`，删别名分支不等于退役这个函数
4. **jackyun 仍接受该别名**，且畸形值仍被拒 —— 把两条路径的差异显式钉住，
   防止将来被「对齐」
5. HTTP 层：带别名的 payload 返 400 `invalid_request` 且**不铸出授权回执**
6. 精确 payload 仍返 200，`authorizationId` 等于 request-id，响应里**没有** `closeRequestId`
7. **存库回执里带别名的旧回执读不回来** —— 回执存 7 天，所以键集收窄之前铸出的
   回执可能还在；`read_authority` 必须 fail closed 而不是复活那个别名

## 与 `codex/fix-workflow-reds-20261106` 的关系

那条分支把两个既有红测试修成了「断言该键被拒」，**与本分支互补**：
本分支删掉死代码后的实际行为，正是那条分支断言的行为。

实测：本分支单独跑时，`test_jd_customer_service_close_authority` 有 **2 红** ——
正是那条分支已修的 #1（version v1→v2）和 #2（`closeRequestId` 断言）。
**两条分支要一起合**，顺序无所谓。

## 未做

- 没有新增 migration
- 没有碰 `market-dynamics` 任何一行
- 没有碰生产库、没发钉钉、没跑发布或制品动作
