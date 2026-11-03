# 客服完整消息导入上限独立审查

2026-11-03；基线 `eab998f81c984ee3d9e722bcd39f0f46a53a9820`，审查对象为当前工作树增量。角色为 `deep-review`，规范映射为 `gpt-6.1-sol / xhigh`；工具没有提供可独立确认的底层模型或强度回执，实际模型未独立确认。本上下文未参与该部分方案或实现，未转派，只新增本报告。

## 结论

通过本次静态审查，未发现阻断该增量交付的 P1/P2 问题。TS 与 Django 的在线导入消息数均由 200 改为 2,000，完整消息仍被保存；未发现第三个可达导入入口保留旧 200 条限制，也未发现需要新增数据库 migration 的结构限制。

该调整可解除已知 223 条会话的**消息数量**拒绝。它不是保证任意文件一定导入成功：原有单消息、单会话字节、每日资料、文件、日期、匹配、身份、批次及未知结果约束继续适用；代码交付不表示旧 11042 已闭合或新数据已导入。本轮没有生产接口调用、真实导入、任务触发、业务写入或功能测试。

## 调用链与资源边界

| 核对点 | 直接证据与判断 |
| --- | --- |
| 解析与二次校验 | `lib/customer-service/import-service.ts:72` 设为 2,000。`parseChatLog` 在收集完整消息后调用同一个 validator；`parseCustomerServiceImport` 配对后再次校验。仅修改数量常量，未增加截断、跳过、拆成多个会话等逻辑。 |
| 所有公开导入入口 | 直传 `app/api/customer-service/import/route.ts`、分片完成 `app/api/customer-service/import/chunks/route.ts` 均调用 `parseCustomerServiceImport`；`saveCustomerServiceImport` 经 `planCustomerServiceImportPayloads` 再调用相同 validator，然后完整传递 `parsed.conversations`。未发现把读侧 200 条常量用于导入的路径。 |
| 自动化分天与 C 复验 | `tools/jd-customer-service-daily-files.ts` 的整段、单 LOG 块、派生每日资料都使用相同解析器及 policy；每次仍重解析全部业务值，并比较完整指纹集合。`lib/jd/customer-service-workflow.ts` 同样复用解析器和 validator。正常导入没有改为 `closure_evidence`。 |
| Django 最终写入 | `backend/customer_service/import_service.py:32` 的 `MAX_MESSAGES=2_000` 被 `_messages` 使用，`_row` 对每个会话调用它，随后 `messages` 完整进入 JSONField。原内容指纹、店铺前缀、identity set、事务、scope 锁、重复判断、行数回查及 owner 流程未改。 |
| 数量以外的边界 | TS 保留每条 4,000 字符与每会话消息 JSON 128 KiB；Python 保留 `MAX_MESSAGE_CONTENT=4_000` 与 `MAX_MESSAGE_BYTES=128*1024`。原文件 25 MiB、规范化会话资料 16 MiB、日期及完整分天等价检查均未提高。内部完整请求另受 Django 客户端与服务端体积限制，2,000 不是绕过字节边界的承诺。 |
| 存储与迁移 | `backend/customer_service/models.py:67` 及 `migrations/0001_initial.py:131` 为 `JSONField(default=list)`，未定义消息数为 200 的数据库约束。既有迁移命令独立允许 2,000 条/128 KiB；`tests/test_migration.py` 也已有保存 201 条的既有断言。本次无需结构 migration、旧数据回填或重写。既有断言仅作为源码证据，本轮未执行。 |

## 223 条来源证据与读层

主代理提供的脱敏实测为：5,046 通会话、超过 200 条的会话 1 通、最大消息数 223、最大单会话消息 JSON 为 34,240 字节。本审查读取了 `D:/codex-artifacts/n8n-audit-20261103/measure-customer.ts`，确认其复用 `parseChatLog(..., "closure_evidence")` 统计，不截断消息，仅输出标量；没有重复读取客户原始聊天，也没有独立重跑实测。此 policy 与普通 import 的差异仅为跳过数量上限，时间、内容长度及 128 KiB 仍由相同 validator 检查。因此这些已报告标量支持“223 < 2,000，且 34,240 < 131,072，可解除此次已知数量拒绝”，不支持“完整业务导入已成功”。

读层保持稳定的输出上界：

- `backend/customer_service/query.py:25` 保留详情 200 条、AI 24 条、单条展示内容 1,000 字符及消息 JSON 64 KiB。`_bounded_messages` 先截取候选条数，再按字节预算返回；同时保留 `messageTotalCount`、`messageReturnedCount`、`messagesTruncated`。
- 列表不返回消息内容；详情显式 `include_messages=True` 才返回有界消息。AI snapshots 继续经 `get_conversations_by_ids` 的默认 24 条入口。保存 223 条不会使这些响应自动增至 223 条，也不会使 AI 自动获得完整聊天。
- `lib/customer-service/database.ts:65` 的 200/24 是读取契约，未用于新的导入预算；页面 `app/customer-service-view.tsx:536` 已按截断元数据显示详情限制。后端仍会读取 JSONField 后再做投影，此次每会话存储字节上限没有变化；本报告不把静态预算核对冒称为性能实测。

## 文案与文档增量复核

发现并已由主代理修正一处遗漏：`docs/技术专题/领域迁移/django-customer-service-migration.md:180` 原先仍声称运行时保持 200 条。当前文案已将其限定为迁移发生时的历史契约，并指向客服工作流的后续容量与采用状态，避免改写历史事实或制造两份现行规则。

`app/jd-customer-service-close-controls.tsx:93` 已移除“导入200条上限仍保留”的过期提示；新提示仍明确闭合不代表新数据已导入。`docs/自动化/京东/jd-customer-service-workflow.md:27` 已区分在线导入 2,000、详情 200 与 AI 24，保留 4,000 字符/128 KiB，并说明候选交付及生产采用边界。该工作流原文的 25 MiB/16 MiB 承诺未被扩大。

没有要求额外开发、重复业务验证或迁移的剩余建议。后续按主任务既有合并/上线授权流程交付；旧失败恢复仍走原受控动作，不能把修改上限本身当成清除旧 owner 的操作。

## 必需检查与审查快照

- 两个 TS/TSX 变更文件经 TypeScript `transpileModule` 内存语法编译，错误诊断为 0；这是语法检查，不是完整语义类型检查或功能测试。
- `backend/customer_service/import_service.py` 经 Python `ast.parse`，通过；未导入 Django、连接数据库或生成字节码。
- 五个被审文件的 `git diff --check` 通过。仅检查本次差异及直接依赖，未运行全量测试、生产 API 或业务验收。

以下为审查完成时文件 SHA-256；后续实质变化仅需增量复核直接影响。

| 文件 | SHA-256 |
| --- | --- |
| `lib/customer-service/import-service.ts` | `96c6d04b6d980597f2f6a3a5a82273e47bebb3c720a5f3646c29a9ab3c781b5f` |
| `backend/customer_service/import_service.py` | `e2e7ccd4063b822188559361fc317e3d23730d2935a2a5dfa7bccfc97252bf40` |
| `app/jd-customer-service-close-controls.tsx` | `cd3b59af9eb59f15e3005a2c3395926a7c1a619cc09a8ed1bb2ebe977118ec73` |
| `docs/自动化/京东/jd-customer-service-workflow.md` | `caf2c5af63960184eb42bd83508995bc44ab14cc7fec2c73d14c464be2e436f9` |
| `docs/技术专题/领域迁移/django-customer-service-migration.md` | `8ae336786bdd43b969d8c14c9a344a1c72b985acbff05ace8b3ba6b63980c1e3` |
