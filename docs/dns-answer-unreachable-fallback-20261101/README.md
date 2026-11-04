# DNS 答案不可达时的回退（2026-11-01）

## 背景：一个被两次误判的故障

2026-11-01 上线 `2d881283` 后，钉钉入站 Stream 连不上（`DingTalkConnection` 卡在
`recovering`，8 次重试无一 `connected`），定时任务发送同样失败，回执
`provider_unavailable`。

这个故障此前被误判过两次，都记在这里以免重复：

**第一次**：判为「Cloudflare 对钉钉这类国内 CDN 域名返回海外节点、该节点 TLS 被
确定性阻断」。被复测推翻——同一 IP 既能握手成功也会超时，失败形态还从
`SSLEOFError` 变成 `TimeoutError`。见
`docs/dingtalk-dns-recovery-ceiling-20261101/README.md`。

**第二次**：判为「兜底条件把 `provider_unavailable + tls` 连带排除，所以不换
解析器」。这个也错了，错在把两个不同层次的机制混为一谈：

- `_recovery_answer`（`transport.py:287-361`）的 try 包的是**到 DoH 解析器自己**
  （`1.1.1.1` / `1.12.12.12`）的请求，它的条件判的是「这家解析器可不可达」。
- 今天 cf **没有不可达**：它 0.2–1.8 秒正常作答，只是给出的地址连不通。

所以放开那个条件没有任何作用——cf 是成功的，放开也不会让代码去问腾讯。

## 真因

`transport.py` 原第 499 行：

```python
family, socktype, proto, _, target = addresses[0]
```

拿到解析结果后只连第一个地址，失败不试下一个。而 cf 对 `api.dingtalk.com`
只返回 1 个 A 记录，于是 `addresses` 长度就是 1——连它必败且无候选可退。

**缺口的准确表述：一个合法但不可达的 DNS 答案，没有任何补救路径。**

这正是此前独立反审列为「缺陷 4」而被判为「对钉钉路径几乎不触发」的那一条，
当时的理由是「钉钉域名只返回 1 个 A 记录，没有可回退的对象」。该理由本身成立，
但由此得出的「影响很小」是错的：**只有一个候选不等于影响小，恰恰相反——
单候选意味着一次失败就是终局**，多候选至少还有机会。

实测数据（当日多次采样，cf 返回的 IP 在轮换但都不通）：

| 解析器 | api.dingtalk.com 的答案 | 真实 TLS 握手 |
| --- | --- | --- |
| `1.1.1.1` | `161.117.70.119` / `161.117.107.66` / `47.246.137.200` | 全部 `SSLEOFError`，0.11–0.70s |
| `1.12.12.12` | `106.11.23.24` / `106.11.40.32` | OK，0.08–0.14s |

cf 返回的不是某个坏节点的偶发，而是整批海外节点在当前代理下都不通；
腾讯的答案一直可用。这也解释了为什么重启接收器碰运气没有用。

受影响范围：`STREAM_API`（入站问数）与 `TOKEN_API` / `GROUP_MEDIA_API` /
`PERSON_MEDIA_API`（定时发送）**同在 `api.dingtalk.com`**，所以两者一起坏。
交付过程中曾误判为「定时任务不走 Stream 所以不受影响」，已更正。

## 修复

两处改动，分属不同层次，不要混为一谈。

### 改动一：多地址逐个尝试

`_bounded_json` 新增 `connect_phase()`，在 `connect` / `tls` 阶段失败时尝试
`addresses` 里的下一个地址。对钉钉的单 A 记录无帮助，但模型路径
`opencode.ai` 返回 4 个 IP 而原先只连 1 个，那里有实际收益。

### 改动二：答案全不可用时换解析器重问

地址全部连不通且预算仍有余时，通过调用方传入的 `resolver(tried)` 回调重新解析，
排除已失败的地址。`_public_addresses` 增加 `exclude`、`_recovery_answer` 增加
`skip_resolvers`，使「某家解析器的答案整批不可用」能落到下一家解析器，
而这与既有的「解析器本身不可达」是两个独立的重试层。

`dingtalk_transport.py` 的 6 个 `_bounded_json` 调用点（`access_token`、
`send_media` 的 upload 与 send、`open_stream`、`verify_group`、`send`）
都传入 `resolver=` 闭包。

## 守住的三条约束

**一、证书校验失败绝不重试。** `SSLCertVerificationError` 与 `TimeoutError` 一起被
排除在重试之外（`transport.py:621`）。证书失败是信任问题不是可达性问题。

排除 `TimeoutError` 的理由值得记录，它比原方案更严谨：socket 的 timeout 取的就是
整体剩余预算（`candidate.settimeout(remaining)`，`remaining = timeout - 已耗时`），
所以 socket 层抛 `TimeoutError` 等价于**预算已耗尽**——此时根本没有时间重试，
且重试会把 `timeout` 误标成 `unavailable`。原方案曾笼统地说「`tls` 阶段应重试」，
没区分「握手慢」与「预算到点」，实现时做了更细的切分。

**二、重试只在 `request_started == False` 时发生。** `request_started = True` 在
`request_send` 之后（`transport.py:659`），而重试只发生在 `connect` / `tls` 阶段，
字节一个都没写出去，不可能造成重复发送。这是 AGENTS.md 第 6 条「不误发」的底线，
对钉钉这种真实外部发送尤其重要。

**三、预算不被突破。** 重解析前检查剩余预算，耗尽则抛 `timeout`；每个地址尝试前
重新计算 `remaining`。重解析上限为每次 `_bounded_json` 调用一批（非无界循环）。

## 验证

执行环境：`D:\teruisi-runtime\django-sales\venv\Scripts\python.exe`（Django 5.2.17），
只读调用、未 `pip install`、未改动该 venv。测试库走 SQLite 兜底落在 worktree 内，
未连生产 PostgreSQL。注意不能从生产 app 目录运行测试，那里禁止 SQLite 兜底。

### 独立反审的注入验证（非仅凭实现者报告）

| 注入的错误 | 结果 |
| --- | --- |
| 把 `SSLCertVerificationError` 从不重试名单移除 | 新增的 `test_cert_failure_still_connects_only_once_with_multiple_addresses_available` 变红（`AiError not raised`）；**既有的 `test_tls_failure_never_posts_or_retries` 仍为 OK** |
| 禁用答案级重解析（`reresolved` 恒为真） | 仅 `test_single_address_tls_eof_falls_back_to_next_resolvers_address` 变红，其余 37 个不受影响 |

第一条尤其值得记录：**既有的证书契约测试抓不住这个回归**，因为它只用单地址、
没有可重试的候选；新增测试用多地址专门覆盖了这个盲区。这说明补测试不是形式，
而是真的堵上了一个会让回归溜过去的洞。

第二条说明断言打得准、没有过度耦合——破坏一个行为只红一个用例。

### 真实网络端到端

单元测试用的是桩，所以另做了真实网络验证：

```
前提检查: 161.117.107.66 握手 FAIL SSLEOFError 0.14s（故障可复现）
连接路径: ProviderHttpError code=provider_error 1.20s
判定: 已连通到钉钉（错误来自凭据/业务层）-> 回退生效
```

关键在错误码：走完整连接路径后拿到的是 `provider_error`（HTTP 层，来自故意传入的
无效凭据），**不是** `provider_unavailable`。说明代码成功绕过坏地址连通了钉钉。

另有一次中间验证走错了方向，记录以免重复：直接调 `media_addresses(TOKEN_API)` 返回
`OK -> ['161.117.107.66']`，看似成功。但 `_public_addresses` 只做 DNS 解析、
**不做连接验证**，它返回成功不代表地址能连通——真正的回退发生在 `_bounded_json`
的连接阶段，必须验那条路径。

### 测试基线

三模块 48 个测试，2 个既有失败（`test_caption_image_is_one_markdown_send_for_person_and_group`、
`test_post_upload_revocation_and_bad_receipt_never_fall_back_to_separate_messages`），
已在未改动的 main 上复现确认与本次无关，未处理。其余全绿，含
`test_expired_dns_budget_never_queries_or_retries`、
`test_tls_failure_never_posts_or_retries`、`test_public_dns_does_not_use_recovery`、
`test_fake_ip_is_replaced_with_public_pinned_addresses` 与
`test_transport_dns_phase.py` 全部。

## 已知范围边界

**模型路径只享受改动一，拿不到改动二。** `bounded_json` / `bounded_sse` 没有传
`resolver`，所以模型请求能逐个尝试 `opencode.ai` 的 4 个地址，但若 4 个全不通
而另一家解析器有好答案，它不会重问。这不是缺陷：模型路径不是本次故障对象，
4 个候选本身已有相当韧性。如果将来模型域名也出现「单解析器答案整批不可用」，
给这两个入口补上 `resolver=` 即可，机制已就位。

## 本次未做的事

- 未推送、未合并、未改动 `main`。
- 未执行生产发布上线。
- 未修 `dingtalk_schedules.py:359` 的 `sending` 置位过早（见
  `docs/dingtalk-dns-recovery-ceiling-20261101/README.md` 的「同期发现」一节）。
  该缺陷会把「确定没发出去」的失败记成「结果不明，未重试」，是用户看到的回执
  失真的来源，建议作为下一项处理。
- 未修上述 2 个既有失败。
- 功能验收由用户上线后自行判断（AGENTS.md 第 4 条）。
