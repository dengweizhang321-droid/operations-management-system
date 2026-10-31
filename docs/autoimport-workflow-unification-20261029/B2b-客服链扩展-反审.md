# 闸① 扩展到客服链 · 独立反审（2026-10-31）

审查对象：分支 `codex/jd-customer-service-gate1-20261031`，提交 `7ca4fbec`（基于 main `e15b2147`）。
审查者未参与实现。

## 结论：通过，可合并

## 一、先查它披露的失误：误在主工作区改过文件

执行者报告称一开始误在主工作区 `D:\运营管理系统` 编辑文件，提交前发现、`git checkout --` 还原、确认 `git diff --stat` 为空后才在正确的 worktree 重做。

我立即核了主工作区：

| 项 | 结果 |
| --- | --- |
| 已跟踪文件改动 | **空** |
| `git stash list` | **3 条完好** |
| 未跟踪条目 | **18 个都在**（与此前一致） |
| `main` 位置 | `e15b2147`，未被动 |

**没有损失**，它也主动报告了。连续两个单元出现"动错位置"（B3 误动 stash、本单元误在主工作区编辑），说明提示词里的 worktree 约束还要再前置、再显眼。

## 二、我自己注入了一条错误，用的不是它报的那条

它声称"注入 0 文件⇒no_new_needed 后 8 个用例失败"。我换了另一条更隐蔽的注入：**让配对不完整不再触发 `partial`**（把 `if ...pairingIncomplete...` 改成 `if False`）。

结果：**3 个用例当场失败**。还原后字节一致。

这证明配对判据真的被断言约束着——而配对完整性恰恰是客服链相对推广链**新增**的那条判据，最值得单独验。

## 三、最关键的回归证明：推广链 22 项仍全过

本单元为支持客服域重构了 `BusinessEvidence`（把 `is_fully_covered`/`has_new_batch` 从 netshop 专用的 `@property` 改成各域 reader 填充的普通字段）。这类重构最容易悄悄改掉原有行为。

| 测试 | 结果 |
| --- | --- |
| 推广链 `test_automation_gates` | **22/22 通过** |
| 客服链 `test_automation_gates_customer_service` | **15/15 通过** |
| `workflow` 全套 | 195 项，1 失败 = 已知预存的 `test_status_and_overdue_filters_apply_before_pagination`。**零新增** |

## 四、它自己发现并修掉的一个真 bug（这处值得记下）

客服是**滚动 30 天**导入：数据截至昨天、批次今天完成。如果按"批次 `completed_at` 落在目标日期范围内"判新批次，**每次准点运行都会误报"无新批次"**——因为完成时刻永远在数据范围之后一天。

它改成了：检查最近完成的批次有没有真的在范围内贡献会话行（通过 `CustomerServiceConversation.last_import_batch_id` 关联），而不是看 `completed_at` 的位置。

报告里说这是"被我自己的测试失败发现后修的"。这类错误的症状是"闸天天误报但看起来在工作"，不修会让 B4 的一周观察全是噪声。

## 五、两域差异的处理（核实都对）

| 项 | 推广链（netshop） | 客服链（customer_service） |
| --- | --- | --- |
| 身份 | `source`+`dataset`+`platform`+`shop_name` | 只有 `shop_name` |
| 覆盖判据 | 批次 `date_min`/`date_max` 区间并集 | **会话行 `consulted_at` 的逐日分布** |
| 新批次判据 | 批次落在范围内 | 批次是否在范围内贡献会话行 |
| 完整性 | `row_count`/`inserted_count` | `matched_count` 与 `session_only`/`chat_only`/`ambiguous` |
| 读接口 granularity | `"batch"` | `"pairing"` |

分派方式：`read_business_evidence_for_module()` 按 `AutomationModule.domain` 路由。`read_business_evidence()`（推广链那个）**签名与行为均未改**，这是 22 项仍全过的原因。

闸②/闸③ **零改动**——它们只碰 `BusinessEvidence` 的通用面。这说明 B1/B2 当初的分层是对的。

## 六、配对不完整映射到 partial（我认同，理由站得住）

执行者的理由：`verified` 与 `no_new_needed` 都在断言"该范围的证据可信"。`session_only_count`/`chat_only_count`/`ambiguous_count` 非零意味着该范围内有会话无法在两个源文件间对上——这是**真实存在的数据质量缺口**，不是数据缺失。`partial` 已有"证据存在但范围未干净解决"的语义，复用它比新增轴值好。

我补一条支持理由：客服的业务价值在于"会话内容可分析"。只有 session 没有 chat，意味着那部分对话的消息体缺失——判 `verified` 会让下游分析误以为数据完整。

## 七、新增的三个模块登记（迁移 `0010`）

| module_key | domain | date_policy | evidence_requirement | depends_on |
| --- | --- | --- | --- | --- |
| `jd_customer_service.session_excel` | customer_service | rolling_30d | **pairing** | — |
| `jd_customer_service.chat_log` | customer_service | rolling_30d | **pairing** | — |
| `jd_customer_service.paired_daily_import` | customer_service | rolling_30d | **pairing** | 前两个 |

`evidence_requirement` 用 `pairing` 而非 `batch` 是对的——这正是 B1 设计那个枚举时留的位置。

## 八、仍未解决（两处，都是继承的）

1. **「未到期」仍无独立信号**，客服链与推广链同病。`not_due` 没有可查询落点，所以"无缺口"与"未到期"仍收敛成同一形态
2. **全部 fixture 是合成的**，未对真实的 `JdCustomerService2026` execution 记录或生产 `CustomerServiceImportBatch` 行验证过。执行者如实声明了这一点

第 2 条正是 B4 要回答的：逐日覆盖检查与 `partial`-for-pairing-gap 这两条判据，能不能撑住真实的滚动 30 天数据。

## 九、状态

**未合并、未准备制品、未发布。** 迁移 `0010` 未在任何真实数据库执行。
