# 广东仓库存监控定时任务修复（2026-10-28）

本次处理两个用户报告的问题：定时任务执行失败，以及钉钉发布内容里的周转数值形态。

## 问题一：定时任务 10-28 16:03 执行失败

### 现象

回执为「取数：完成；分析：失败 · 模型地址解析失败，尚未发起模型请求」，实际模型 OpenCode Go · v4。

### 根因

错误文案来自 `lib/ai/schedule-presentation.ts` 的错误码 `provider_dns_unavailable`，
该码由 `backend/ai_assistant/transport.py` 的 `ProviderTransportError` 在
`stage ∈ {system_dns, dns_recovery}` 且 `reason != timeout` 时产生。

本机 DNS 经代理劫持，所有域名首跳都解析到 `198.18.0.0/15` 合成网段：

```
nslookup opencode.ai  -> 198.18.0.53
```

该网段正是 `transport.py` 的 `_synthetic_network`，命中后 `_public_addresses()`
放弃系统 DNS 结果，改用固定公网 IP `1.1.1.1` 做 DoH 兜底解析（走 TLS 直连 IP，
由证书校验保证不被劫持）。

实测这条兜底链路本身不稳定——到 `1.1.1.1:443` 的 TLS 握手间歇性被代理打断。
用 Python 的 `ssl` 模块（与 `transport.py` 同一套实现）连测 8 次：

```
run1 FAIL at tls: TimeoutError: _ssl.c:1064: handshake operation timed out  4.09s
run2 OK 0.35s
run3 OK 0.37s
run4 OK 3.36s     <- 未超时但慢十倍
run5-8 OK 约 0.34s
```

各解析器对比（Python `ssl` 直连 + 证书校验）：

| 解析器 | 结果 |
| --- | --- |
| `1.1.1.1/dns-query` | 8 次中 1 次 TLS 握手超时、1 次慢至 3.36 秒；证书含该 IP 的 SAN |
| `1.12.12.12/dns-query`（腾讯） | TLS 握手 0.14 秒，证书含该 IP 的 SAN，响应形态与 Cloudflare 一致 |
| `223.5.5.5/resolve`（阿里） | HTTP 200 约 40 毫秒，但响应形态不兼容（见下） |

**失败阶段是 `tls` 且 `reason="timeout"`**，不是 connect 失败。`except TimeoutError`
在 `transport.py:602`，先于 `except (OSError, ...)`（:614），所以握手超时归入
`provider_timeout`，而证书校验失败（`SSLCertVerificationError`，`OSError` 子类）
归入 `provider_unavailable`。两者是不同分支，这个区分对下面的修复条件很关键。

因为单一固定解析器成了硬依赖，代理一拖死握手，整条模型请求就发不出去，
回执即「模型地址解析失败，尚未发起模型请求」。故障是间歇性的，所以这个任务
平时能跑、偶尔失败。

### 修复

`backend/ai_assistant/transport.py`：把固定单点解析器改为按顺序尝试的解析器列表，
新增 `_recovery_answer()` 承担这段逻辑。

备用解析器选腾讯 `1.12.12.12` 而不是更快的阿里 `223.5.5.5`，因为阿里 `/resolve`
返回的 `Question` 是对象而非数组，会被本模块既有的 RFC 8427 响应校验判为
`invalid_response`；腾讯的响应形态与 Cloudflare 完全一致，无需改动校验逻辑。

这一点已实测而非推演：把腾讯的 A 记录响应喂给本模块既有的校验逻辑，信封校验通过，
4 个真实公网 IP（`172.65.90.20`–`.23`）全部被接受；AAAA 响应的 `Question` 同样是
带 `type` 字段的数组，形态一致。

腾讯 `1.12.12.12` 的 Python TLS 校验也已实测通过：证书 SAN 含该 IP，
`ssl.create_default_context().wrap_socket(..., server_hostname="1.12.12.12")`
0.14 秒完成握手。这一步必须实测——curl 在 Windows 用 schannel，对 IP 地址
不发 SNI（`SNI is not supported by OS`），与 Python `ssl` 的校验路径不同，
仅凭 curl 200 不足以证明 Python 侧能用。

#### 兜底的触发条件

只在「这个解析器根本没给出可读的答复」时才换下一个：

| 失败 | 分类 | 兜底 |
| --- | --- | --- |
| TCP connect 失败 | `provider_unavailable` + stage `connect` | 是 |
| 握手／发送／等响应头超时 | `provider_timeout` + stage `connect`/`tls`/`request_send`/`response_headers` | 是 |
| TLS 证书校验失败 | `provider_unavailable` + stage `tls` | 否（信任失败，不是连不上） |
| 读响应体超时 | `provider_timeout` + stage `response_body` | 否（已读到响应） |
| HTTP 状态／重定向／超限／响应不合法 | 各自错误码 | 否（解析器已作答） |
| 权限变化、任务取消 | `access_denied` / `cancelled` 等 | 否，原样透传不重分类 |

保留的既有不变量：

- **预算不被突破**。兜底解析器另给最多 3 秒窗口，同时受调用方 `timeout`
  （`ceiling` 参数）约束。调用方只给 3 秒时兜底直接跳过。
- **回执形态不变**。诊断始终保留第一个解析器的失败（stage/reason/resolverPhase）。
  一个例外：首个解析器以非 timeout 失败、兜底又因预算耗尽没机会跑时，最终抛出的是
  首因（`unavailable`）而非 `timeout`——保留真实首因，比重写成超时更准确。
- **凭据不外泄**。DoH 请求 body 为 `None`、headers 只有 `Accept`、method 为 GET，
  与原实现完全一致，兜底路径没有放宽任何东西。
- **防劫持不变**。固定 IP 直连，`server_hostname` 取该 IP，由证书校验保证；
  模型域名的 TLS 校验在后续独立请求里，用的是模型域名。

#### 独立审查发现的两个缺陷（已修）

独立审查（新上下文、未参与实现）发现实现者自查漏判两处，均已修正：

**缺陷一（严重）：兜底拿到的有效答案会被过期预算检查丢掉。**
`_public_addresses` 的轮次预算检查用的是最初的 `budget`（5 秒硬顶），而
`_recovery_answer` 给兜底解析器放宽到 `budget + 3`。按实测时序代入——
`1.1.1.1` 耗尽 5 秒才失败、腾讯 0.4 秒拿到正确答案——`5 - 5.4 < 0`，
刚拿到的地址会被当成超时整个丢弃。**这个缺陷会让修复在最需要它的场景下失效。**
修法：`_recovery_answer` 返回时一并报告兜底实际获准的额外时间，调用方据此顺延
自己的预算锚点（`budget += granted`）。不改 `budget` 的既有口径，因此
`test_late_a_never_starts_aaaa_or_model_connection` 依赖的行为不受影响。

**缺陷二：`test_tls_failure_never_posts_or_retries` 会红。**
该测试用 `SSLCertVerificationError`（`OSError` 子类）模拟 TLS 失败，映射为
`provider_unavailable`，正好命中初版「只看 error.code」的兜底条件，导致
`sock.connect` 被调两次而断言为 1。修法：兜底条件同时看 `stage`，把证书校验
失败排除在外（见上表）。

#### 既有测试断言核对（重做）

本机未安装 Django（运行环境在 runtime 目录，按规范未触碰），无法实跑 Django 测试。
已按新实现逐条重新推演 17 条相关断言，结论是只有一条需要改（见下节），其余全部成立：

| 测试 | 断言 | 新实现 |
| --- | --- | --- |
| `test_fake_ip_is_replaced_with_public_pinned_addresses` | 单次调用、timeout ≤ 5、固定 `1.1.1.1` | 成功即返回，首个解析器仍是 `1.1.1.1` |
| `test_public_dns_does_not_use_recovery` | 不调用 DoH | 无合成地址则提前返回 |
| `test_private_mixed_fake_and_unapproved_origins_never_query_doh` | 不调用 DoH | 各项守卫先于 `_recovery_answer` |
| `test_doh_never_accepts_nonpublic_answers` | 抛错 | 响应校验在返回之后，不触发兜底 |
| `test_dns_failure_malformed_or_empty_answers_fail_closed` | 抛错 | 同上 |
| `test_complete_a_answer_is_validated_before_returning_any_public_address` | 单次调用 | 校验在 `_recovery_answer` 之外 |
| `test_empty_a_falls_back_to_aaaa_but_private_ipv6_is_rejected` | 调用 2 次 | 每种记录类型一次 |
| `test_expired_dns_budget_never_queries_or_retries` | 只调一次 | `AiError` 默认码 `invalid_request`，不在白名单，直接透传 |
| `test_full_request_uses_real_ip_original_tls_host_and_one_provider_post` | 连接序列不变 | 成功路径未改 |
| `test_tls_failure_never_posts_or_retries` | 连接 1 次 | 证书失败不触发兜底（缺陷二已修） |
| `test_valid_a_does_not_wait_for_unused_aaaa_timeout` | 单次调用 | 首个解析器成功 |
| `test_empty_a_then_aaaa_uses_remaining_shared_dns_budget` | A 轮 timeout=5，AAAA 轮 timeout=2 | 推演值 5.0 / 2.0，一致 |
| `test_late_a_never_starts_aaaa_or_model_connection` | 预算耗尽仍单次调用 | 外层 `remaining <= 0` 先抛 |
| `test_real_doh_timeout_is_dns_failure_with_zero_model_posts`（`response_body` 支） | 单次连接 | 读响应体超时不触发兜底 |
| `test_dns_protocol_failure_is_not_a_model_protocol_failure` | 单次 GET | `invalid_response` 不触发兜底 |
| `test_dns_recovery_preserves_permission_and_cancellation_failures` | 原样抛出 | 不在白名单，直接 `raise` |

#### 本次主动修改的一条测试断言

`test_transport_dns_phase.py` 的 `test_real_doh_timeout_is_dns_failure_with_zero_model_posts`
在 `tls` 支原断言 `sock.connect.call_count == 1`，即「DoH 超时不得发起第二次连接」。

实测证明真实故障恰好就是 TLS 握手超时，若保留该断言，本次兜底在真实故障下永不触发，
修复等于无效。经用户确认后改为按解析器数量放开该支的连接计数，
其余断言（零模型请求、凭据不外泄、仅 GET、诊断不含网络细节）全部保留——
这些才是该测试真正守护的契约。`response_body` 支仍断言单次连接。

代价：最坏情况 DNS 恢复耗时从 5 秒增至 8 秒；本模块「no automatic retries」的声明
现在有一个被实测与注释明确限定的例外（仅限未取得任何答复的 DNS 恢复阶段，
绝不涉及模型请求本身）。

合并前仍需在装有 Django 的环境跑一遍 `backend/ai_assistant/test_transport.py` 与
`test_transport_dns_phase.py` 实测确认。

## 问题二：钉钉内容里的周转数值

### 现象

用户反馈周转数据「不能四舍五入」，确认实际看到的是 `355.714285 天` 这类长浮点。

### 根因

与「被四舍五入」相反——代码链路里**没有任何取整**，发出去的就是原始浮点全展开。
全链路核对：

| 位置 | 行为 |
| --- | --- |
| `backend/inventory/guangdong.py:301` | `turnover = max(0, available) / (sales30 / 30)`，纯除法，无取整 |
| `backend/inventory/guangdong.py:321` | `math.floor` 只用于推算最晚下单日期，不影响 `turnoverDays` 字段 |
| `lib/ai/page-data-tools.ts` `safeScalar` | 数值原样透传，只做有限性检查 |
| `backend/ai_assistant/schedule_monitor.py` `collect()` | 只校验，不改值 |
| `backend/ai_assistant/schedule_monitor.py` `cell()` | `str(value)` 直接输出，长浮点全展开 |

网页侧反而有格式化（`app/inventory-guangdong-view.tsx:19` 用 `toFixed(1)`），
钉钉通道没有，两边不一致。

### 修复

`backend/ai_assistant/schedule_monitor.py` 的 `cell()`：`turnoverDays` 按一位小数
格式化，与网页 `toFixed(1)` 对齐。仅影响展示，事实包与风险判定仍用原始浮点。

受牵动的测试：`backend/ai_assistant/test_schedule_monitor.py:72/96/102` 断言
`12.5 天` 原样出现——夹具值 `12.5` 格式化为一位小数仍是 `12.5`，断言不变。

## 本次改动文件

- `backend/ai_assistant/transport.py`
- `backend/ai_assistant/schedule_monitor.py`

## 同类单点未处理（本次不改）

`backend/ai_assistant/pi_research.py:214-227` 的 `_recover_dns()` 是**第二处**独立的
DoH 兜底实现，同样硬编码 `1.1.1.1` 单点，面对同一个代理 TLS 打断会有同样的失败。

本次没有改它：它服务 Pi 研究功能的联网抓取，不在广东仓定时任务的失败链路上，
按 AGENTS.md 第 3 条「只做本需求所需的修复或扩展，避免无关重构」留待单独任务处理。
它用的是另一套取数器（`SafePublicFetcher`）和另一套错误码（`research_*`），
与本次改动没有共享代码，不会被本次改动影响。

## 未完成 / 待确认

- **未取到生产运行记录**。`ai_dingtalk_schedule_runs` 表存在本机 PostgreSQL，
  凭据在 runtime 目录，按[安全与 AI 工具](../规范/安全与AI工具.md)规范未读取。
  10-28 16:03 那次的原始 diagnostics（stage/reason/resolverPhase）与该任务历史
  成功率，需要有权限的人查询确认。注意 `stage()` 只落盘 `error_code` 字符串，
  诊断明细不入库，只能从应用日志找。
- **未跑 Django 测试**，原因与核对结果见上。
- 功能是否正确由用户上线后自行检测。
