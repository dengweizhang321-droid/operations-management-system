# 钉钉调度写库字节边界复核

状态：基线 `77382b5f`，分支 `codex/fix-sched-bytes2-20261106`；仅新增隔离回归与本报告。未发现现行合法入口可达的 UTF-8 超限，不改应用逻辑或 migration，不推送、不合 main、不准备制品、不上线。

## 入口与结论

任务写入口为 `dingtalk_schedules.save()`；执行槽由 `run_now()` 或 `step()` 的 `claim_slot()` 建立。只有 `step()`、`stage()`、`recover_interrupted()` 写运行产物。公开列表只读；不存在把请求中的阶段对象、错误码、事实 JSON 或模型快照直接写入运行表的接口。以下结论不以任意 ORM/SQL 写入为合法业务入口。

| 存储对象 | 实际入口及序列化 | PostgreSQL 约束 | 合法路径上界 |
| --- | --- | --- | --- |
| `prompt` | 文本/截图文案均经 `text(...,4000)` 规范化 | 0010 `octet_length<=16000` | 4000 × 4 = 16000 字节，截图空文案也合法 |
| `source_ref` | 文本固定空；截图来自 `PAGES`；报告经 ASCII `identifier` | 0013 `octet_length<=160` | 报告 ≤160 ASCII 字节；截图固定允许键更短 |
| `model_id` | 非空新绑定与启用绑定经 `resolve_model()` 的 ASCII `identifier`；停用原绑定只复用已存值 | 0083 `octet_length<=200` | ≤160 ASCII 字节；默认及媒体为空 |
| `model_snapshot_json` | `model_snapshot(resolve_model(...))`，只复制固定字段；完整配置只保存 SHA-256 | 0083 对象且 `octet_length<=8000` | 保守 ≤1878 字节，包含 JSON 转义，详见下文 |
| `facts_json` | `schedule_monitor.collect()` 在拼摘要前限制 `len(canonical(facts))<=40000`，再加固定64位摘要 | 0083 对象且 `octet_length<=160000` | 保守 ≤159727 字节，详见下文 |
| `stage_details_json` | 固定 `data/analysis/delivery`；每阶段只覆盖 `startedAt/completedAt/errorCode` | 0083 对象且 `octet_length<=8000` | 保守 ≤561 字节，不累积重试或历史数组 |
| `content_text` | 文本为 `plain_reply()` 的最终结果；截图为已规范化文案；报告固定空 | 0083 `octet_length<=16000` | 文本 ≤12000 字节；截图 ≤16000；报告 0 |
| `error_code` | 运行/阶段使用内部固定代码；供应商错误先映射 | 0010 `varchar(64)`，**不是**64字节 CHECK | 现有来源为 ASCII 常量，均 ≤64 字符/字节 |

任务名称、目标、发送者和 owner 使用 `varchar(n)` 字符限制，不存在相同数值的字节 CHECK；不把 PostgreSQL 字符数约束误写为字节数约束。状态、周期、时分日、版本及内容类型还受原 enum/range CHECK 保护，本轮不改这些规则。

## 序列化上界

- 模型名与显示名分别最多120、100字符。规范化后 PostgreSQL 可存字符在 `canonical()` 中最坏每字符6字节（例如 `\u0001`），共1320字节；模型 ID 保守取160 ASCII、协议取最长 `openai_compatible`、版本取有符号 bigint 的19位正数、五个配置整数取 `2**53-1` 的16位、摘要64位、当前 adapterVersion 加固定键/标点，完整对象为1878字节。附加系统提示词和 URL 不复制进快照，只进入摘要。测试通过真实 `configuration.save_model()` 写控制字符与大整数，再由真实 `step()` 保存快照，验证转义未被漏算。
- 事实包在加摘要前最多40000个**序列化字符**，已计入引号、反斜杠和控制字符转义。仅八个固定顶层键、冒号、逗号和括号就保证至少118个 ASCII 字符。任意其余可编码 Unicode 最多4字节/字符，因此最多 `40000*4-118*3=159646` 字节；添加 `,"factsDigest":"<64位hex>"` 恰增81 ASCII 字节，最终最多159727。此计算不依赖商品名称恰好中文，也不依赖未经声明的字段长度。回归通过60条、20条一页、各标量≤中央适配器500字符上限的合成响应，使摘要前序列化恰为40000字符；真实 collect→step→PostgreSQL 写入通过，增加1字符则在 collect 拒绝。
- 阶段 JSON 三个固定阶段，每个最多两个32字符 ISO 时间和一个≤64字符内部 ASCII 错误码。按完整键、引号、冒号和逗号逐项序列化为561字节。未知恢复只覆盖仍运行阶段，不追加异常正文或历史。真实执行后模拟进程在发送预留完成时退出，再恢复，三个阶段全保留起止时间，实际 JSON 为395字节；再次恢复字节不变。
- 文本 `plain_reply()` 在替换 `@/</>` 等字符后才检查3000字符；截断分支2900字符加固定短后缀仍不足3000。广东监控 `render()` 先限制2800字符，随后 `plain_reply(truncate=False)` 再限制3000。截图不走文本净化，但保存时4000字符与表的16000字节恰匹配。报告下载的附件字节不进入这些列。

## 错误码来源

`step()` 的 `AiError` 分支保存 `error.code`，但其真实下游入口没有从请求、供应商 `error.code`、HTTP正文、工具返回正文或异常消息复制该字段：

- `ProviderHttpError` 将任意错误正文映射为 `provider_error/provider_rate_limited`，只对白名单 `InvalidSubscription` 映射固定 `provider_subscription_invalid`。
- `InvalidProviderResponse` 固定为 `invalid_provider_response`，外部 reason 只作诊断，不作落库代码；网络错误由 `ProviderTransportError` 固定映射，取消检查固定为 `ai_cancellation_check_unavailable`。
- 配置/权限、会话 guard、固定监控、截图、报告下载和钉钉发送抛出的代码为内部常量；`schedule_monitor.invalid(code)` 的生产调用点也只传内部常量。工具失败在 chat 中使用固定内部错误或作为工具结果，不将工具正文升级为运行错误码。
- 普通 Exception 与崩溃恢复分别固定 `execution_result_unknown/interrupted_result_unknown`；未开始阶段、漏槽、无报警等也使用短固定代码。

回归将3000个四字节字符放入供应商错误码和协议 reason，经过实际错误映射与 `step()` 验证运行、阶段都只保存固定代码，且没有发送。没有用人为构造超长 `AiError.code` 冒充现行可达漏洞，也没有为这种假设给合法代码增加截断逻辑。

## 验证与证据

使用 Python 3.12、Django 5.2.17，以及既有 `tools/ai-postgres-rehearsal.py`。工具只在本 worktree `.runtime/ai-pg-*` 初始化临时集群，固定 loopback 端口55862，测试库 `test_teruisi_ai_rehearsal`；最终只停止该临时集群。所有模型、工具、截图与发送边界均为合成响应，无真实外发、业务数据或生产连接。

新增 `backend/ai_assistant/test_schedule_storage_bounds.py` 的7项回归通过。负例直接写过大的运行产物只用于确认实际 PostgreSQL CHECK 已安装且生效，不作为合法入口存在越界的证据。命令及最终联合结果见同目录 `verification.txt`。

联合原 `test_dingtalk_schedules/test_schedule_monitor/test_schedule_core` 共80项，79项通过、1项为基线旧红：`test_schedule_core.py:113` 的旧夹具事后 UPDATE 不可变 `scheduled_at`，被现有 PostgreSQL `ai_immutable_identity` 触发器拒绝，尚未进入该测试欲断言的恢复逻辑。该文件和应用代码均未修改；新7项在联合运行仍全通过。按主任务范围不扩大修旧夹具，不能称联合80项全绿。SQLite 不具备这些字节 CHECK，新增类明确跳过，不将 SQLite 通过当成本次证明。

第一次工具调用未带 `--preprovision-ai-runtime-roles`，在0056迁移的既有角色门禁停止，未运行测试。第二轮暴露两处测试夹具错误（媒体执行身份不匹配、queued 槽未进入恢复集合），已改为真实管理员绑定与真实执行后进程退出场景；最终日志保留。没有因此修改应用权限、恢复或调度代码。
