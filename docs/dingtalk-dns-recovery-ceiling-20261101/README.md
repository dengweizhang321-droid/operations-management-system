# 钉钉 DNS 兜底解析器窗口修复（2026-11-01）

## 起因与一处需要更正的判断

用户报告 AI 定时任务「无法发送」。界面回执：广东仓库存监控、新品上新周销量趋势两条任务
11/01 01:25 与 01:26，状态「结果不明，未重试」，取数=完成、分析=完成或未执行、
发送=结果未知，错误码 `provider_unavailable`。

排查初期给出的根因判断是「`_doh_resolvers` 把 Cloudflare 排在腾讯之前，Cloudflare 对
钉钉这类国内 CDN 域名返回海外节点，该节点 TLS 被阻断，导致确定性失败」。
**这个判断不成立，已被复测推翻。** 当时的采样是：

| 解析器 | oapi.dingtalk.com | TLS 握手（4 次） |
| --- | --- | --- |
| 1.1.1.1 | 47.246.137.200 | 4/4 `SSLEOFError`，约 0.8s |
| 1.12.12.12 | 106.11.23.24 | 4/4 成功，0.06–0.58s |

01:44 复测同一个 IP `47.246.137.200`（`server_hostname=oapi.dingtalk.com`）：
`OK 1.06s`、`OK 0.92s`、`FAIL TimeoutError 6.00s`、`FAIL TimeoutError 6.02s`——
同一地址既能握手成功也会超时，且失败形态从 `SSLEOFError` 变成 `TimeoutError`
（两者在 `transport.py` 里映射成不同错误码）。独立反审另测 60 次 TLS 全部成功，
并观测到 Cloudflare 返回的 IP 在 30 秒内轮换（`161.117.70.119` → `161.117.107.66`）。

结论：**本次发送失败是本机代理/网络的时段性波动，不是解析器选择导致的确定性失败。**
原判断的错误在于采样窗口过短、恰好落在波动期，把时段性故障当成了确定性故障。
用户侧随后也确认恢复可发。

但这次排查暴露出一个真实缺陷，与上述波动无关、长期存在，即本次修复的对象。

## 缺陷：10-28 新增的兜底解析器在钉钉链路上形同未做

`docs/ai-schedule-dns-and-turnover-20261028/README.md` 记录的那次修复，给
`_public_addresses` 增加了「第一家 DoH 解析器连不上时换第二家」的能力
（`_recovery_answer`，`backend/ai_assistant/transport.py:273-362`）。

兜底窗口的计算在 `transport.py:296-305`：

```python
remaining = min(
    _fallback_resolver_budget,                   # 3
    budget + _fallback_resolver_budget - spent,
    ceiling - spent,                             # 卡死在这一项
)
```

`_public_addresses(url, addresses, timeout, origin_guard)` 里 `budget = min(5, timeout)`，
而 `ceiling` 就是传入的 `timeout`。修复前，钉钉的两个入口
（`dingtalk_transport.py` 的 `stream_addresses`、`media_addresses`）传的都是 `timeout=5`，
于是 `budget == ceiling == 5`，`ceiling - spent` 在第一家耗满共享预算时归零，
兜底被跳过并抛出首因。模型路径传 `timeout=60`（`public_model_addresses`），窗口完整。

逐字照抄该公式的算术复算：

| 第一家耗时 spent | 钉钉 `timeout=5`（修复前） | 钉钉 `timeout=8`（修复后） | 模型 `timeout=60` |
| --- | --- | --- | --- |
| 4.5s | 0.50s | 3.00s，granted=2.50 | 3.00s，granted=2.50 |
| 4.9s | 0.10s | 3.00s，granted=2.90 | 3.00s，granted=2.90 |
| 5.0s | **0.00s，跳过兜底** | 3.00s，granted=3.00 | 3.00s，granted=3.00 |

**失效临界点精确落在 `spent = 5.00s`。** 这一点值得写明：`spent < 5` 时兜底其实仍会运行，
只是窗口被压缩到 0.1–0.8 秒。所以缺陷的准确表述是「第一家解析器**耗尽共享预算**才失败时
兜底失效」，而非「兜底从不运行」。实测 Cloudflare 正常 DoH 查询耗时 0.50–1.79s、
TLS 握手 0.27–1.19s，够不到这个临界点；只有 10-28 文档记录的「代理把 TLS 握手拖死」
那类挂死场景才会耗满 5 秒。这也解释了为什么钉钉定时任务平时能发、偶发失败。

此外 `send()` 一次发送要调 `media_addresses` 三次（`access_token`、`verify_group`、
最终 POST），每次独立踩一遍该路径。

缺陷长期未被发现的原因是测试盲区：`test_transport.py` 与 `test_transport_dns_phase.py`
中没有任何用例覆盖 `ceiling=5` 这条路径（`grep` `ceiling`、`media_addresses`、
`_public_addresses` 均零命中）。

## 修复

只改钉钉调用方传入的 `timeout` 实参，不改 `transport.py` 的共享逻辑。

`transport.py` 中「兜底不得超出调用方给的 deadline」这条不变量是正确的，未放宽；
问题在于钉钉调用方把 deadline 设得与共享预算一样紧，没给那个本就设计好的 3 秒兜底留空间。

`backend/ai_assistant/dingtalk_transport.py` 两处 `_public_addresses(url, addresses, 5, ...)`
的第三个实参改为 `5 + transport._fallback_resolver_budget`（用表达式而非硬编码 8，
以跟随常量）。

保持不变的部分：

- `resolve_addresses(..., 5)` 两行未改——那是系统 DNS 的超时，与兜底无关。
- **共享预算仍是 5**：`budget = min(5, 8) = 5`。第一家解析器成功时耗时完全不变，
  只在第一家失败时多出最多 3 秒。
- 未改 `_recovery_answer`、`_public_addresses`、`_doh_resolvers` 顺序、
  `_fallback_resolver_budget` 的值，以及 `public_model_addresses`。

## 验证

执行环境：`D:\teruisi-runtime\django-sales\venv\Scripts\python.exe`（Django 5.2.17），
仅作只读调用，未 `pip install`、未改动该 venv。测试数据库走 settings 的 SQLite 兜底、
落在 worktree 自身 `.runtime/django` 下，未连接生产 PostgreSQL
（输出含 `Skipping setup of unused database(s)`）。本机主工作区系统 Python 无 Django，
且 `.github/workflows/ci.yml` 不包含 Django 单测步骤。

新增 `test_media_ceiling_leaves_room_for_fallback_resolver_after_first_fails`
（`backend/ai_assistant/test_dingtalk_transport.py`）：以 `clock[0] += 5.0` 模拟第一家
解析器耗满共享预算后失败，断言第二家解析器**确实被调用**
（`dns.call_args_list[1]` 为 `https://1.12.12.12/dns-query?...`），而不仅断言最终成功。
桩的失败形态为 `stage="connect"` + `reason="unavailable"`，命中 `transport.py:354-359`
的兜底触发条件。

注入回归验证（独立执行，非仅凭实现者报告）：

| 操作 | 结果 |
| --- | --- |
| 把 `media_addresses` 的 ceiling 改回 `5` | `FAILED (errors=1)`，抛 `ProviderTransportError`，兜底被跳过 |
| 还原修复 | `OK` |

还原后 `git status` 干净。

既有断言核对（反审点名的几条，全部 `OK`）：
`test_expired_dns_budget_never_queries_or_retries`、
`test_tls_failure_never_posts_or_retries`、
`test_public_dns_does_not_use_recovery`、
`test_fake_ip_is_replaced_with_public_pinned_addresses`、
`test_stream_dns_does_not_extend_model_or_arbitrary_origins`、
`test_open_stream_pins_verified_addresses_without_model_allowlist_change`。

模块级结果：

- `test_transport` + `test_transport_dns_phase`：33 个测试全部通过。
- `test_dingtalk_transport`：43 个测试，2 个失败。

**这 2 个失败与本次改动无关**，已在未改动的主工作区（main `9c184426`）复现同样的
2 个失败（42 个测试、2 失败；43 与 42 之差为本次新增且通过的用例）：

- `test_caption_image_is_one_markdown_send_for_person_and_group`：
  `guard.assert_called_once()` 实际被调用 2 次
- `test_post_upload_revocation_and_bad_receipt_never_fall_back_to_separate_messages`：
  `assertEqual(calls.call_count, 2 if revoked else 3)` 得到 `1 != 2`

这两条属于既有失败基线，本次未处理，也未改动相关代码。

## 本次未做的事

- 未推送、未合并、未改动 `main`。
- 未执行任何生产部署、迁移、服务重启或真实外部发送。
- 未修改 `_doh_resolvers` 的顺序。实测 Cloudflare 比腾讯慢 5–10 倍
  （DoH 查询 0.50–1.79s vs 0.10–0.54s），对调可降低钉钉 DNS 腿耗时，
  但那是延迟优化而非本缺陷的修复，且在本缺陷未修时对调会**掩盖**它，故未纳入本次范围。
- 未修上述 2 个既有失败。
- 功能验收由用户上线后自行判断（AGENTS.md 第 4 条）。

## 同期发现、本次未修的其他缺陷

独立反审通查整条钉钉发送链路后记录的其余问题，均未纳入本次改动：

1. **`sending` 标记置位过早**（`dingtalk_schedules.py:359` 相对 `:363`）。
   `access_token`、`verify_group` 两条网络腿与全部守卫检查都在 `sending = True` 之后、
   真实 POST 之前，其失败被记为 `unknown`（「结果不明，未重试」），但这些失败里
   消息从未发出。`:384` 把 `sending` 判断排在 `error.status == 403` 之前，
   使 `verify_group` 的 403 也变成 `unknown` 而非 `denied`。
   判断「是否可能已送达」所需的事实已存在于 `transport.py:48` 的
   `diagnostics["requestStarted"]`，但钉钉链路无消费者。
   这是用户本次看到的回执形态的最可能来源，建议优先处理。
2. **错误码文案缺失与误导**（`lib/ai/schedule-presentation.ts`）。
   能落入 `run.error_code` 却无文案的有 11 个（含 `provider_unavailable`、
   `channel_unavailable`、`execution_result_unknown`），界面显示裸错误码。
   且同一次代理阻断按失败形态分岔为 `provider_timeout`（显示「模型响应超时」）
   或 `provider_unavailable`（显示裸码），两者都把排障指向模型配置，
   而失败实际发生在钉钉端点。
3. **定时执行器无总预算**（`management/commands/dingtalk_schedule.py:20`）。
   问数路径有 `request_budget(260)`，执行器没有；三条腿叠加最坏约 90 秒，
   单线程顺序循环下会把后续任务推向 5 分钟 `missed_window` 边界。
4. **数据库故障时 run 永久停留 `sending`**。异常处理器自身需写库，库不可用则穿透至
   `CommandError` 使进程退出；`recover_interrupted` 只在启动时执行，且无看护进程。
5. **`addresses[0]` 无连接级回退**（`transport.py:499`）。对钉钉路径影响很小——
   实测两家解析器对钉钉域名都只返回 1 条 A 记录，无候选可丢；
   真正丢候选的是模型路径（`opencode.ai` 返回 4 个 IP 只连第一个）。

安全边界与幂等性经逐条核查未发现漏洞：合成 IP 从不连接、非公网地址在解析后与连接前
各拦一次、官方入口白名单对 multipart 与 upload 同样生效、重定向无条件拒绝；
唯一键 + `select_for_update` + advisory lock 四层叠加下未发现重复发送路径。
