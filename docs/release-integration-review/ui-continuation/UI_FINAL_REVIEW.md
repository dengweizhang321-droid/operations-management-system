# UI 补充验收独立终审

2026-10-10 08:20 UTC。非作者源码范围审查及隔离验证通过；这不是生产 UI 验收通过，也不把 AB9 的三次原失败改为成功。机器报告见 [UI_FINAL_REVIEW.json](UI_FINAL_REVIEW.json)。

本结论只绑定 `E:\codex-artifacts\release-integration-review-20261010\AB-ui-supplement-20261010-0820-final`：

- 新 UI SHA：`2ae444e2bc6f337c6940a7f15a37b5d569257aeed76b3c98058955fe8ddb6118`。
- helper SHA：`5055f2d5c80cbc5bd1e99cc951010cbc0aab587b3298a05ed0f8a90e0ef80f71`，与工作树受审源码相等。
- preparation SHA：`cb88bcf73c28de9cf02224eadcfd589ed3fa5c2b9f0aa0cb644ef6c5551b6e32`。
- 原 UI SHA：`41434009a0f8f6cfe71f29ede31b3a8bc5a363c2b5ffa3ea2f9e9aa4b3698708`；原 AB9 为 `9f79a27a1b2ec47095c971780efde8379940366724e975ff31b9cf88b45dce15`。

已把新 UI 的声明变更逆变换，并断言与原 UI 全文本精确相等：差异只包括当前请求闭合屏障、详情 GET 完成及当前成功 DOM、私有 create-only 输出目录、异常时必定关闭浏览器。原四项业务 UI 断言、四种视口返回命中与键盘操作、旧客服行 inert 与当前店铺约束、资源字节检查、路由策略及搜索取消例外全部保留。没有添加销售请求 abort 豁免；原所有非 GET 请求仍在原 route 中阻断。原 audit/handoff/resource 三输入 SHA 已列入机器报告。

`request-completion.mjs` 对当前上下文 request/response/requestfinished/requestfailed 建立记录，等待真实终态而非重用 Document 已达成的 `networkidle`。详情必须是动作之后唯一的匹配 GET，完整请求结束且 HTTP 200；随后当前详情区域 `aria-busy=false`、KPI 存在且无 `role=alert`，再允许返回。action、请求终态与 DOM 使用同一绝对单调期限；过期前尚未开始的 action 拒绝启动，DOM 交接不会重获预算。准备器只在指定 E 盘父目录新建限定名称，逐级拒绝链接或 junction，并用 `wx` 保留旧草稿与失败证据。

独立 pure 负例最终 5/5 通过，真实隔离 Chrome 的作者记录为 8 个请求/DOM 子例与原 audit 7 例，Node 含父例共 16 个测试通过。独立负例覆盖 quiet 迟到、action 不返回、首次请求失败后出现另一个成功、过期 action 启动、DOM 交接重置期限。首次 1/3、修后新增交接负例 3/5 的失败日志均保留；最终日志及测试文件原始 SHA 见机器报告。浏览器夹具只使用随机独立 loopback 端口及合成页面，不连正式 3000。

未覆盖：本补充 UI 的正式运行结果、显式补充批准及追加式续接 API（另由 reviewer 审查）、任意原生代码或 OS 沙箱、未来无限时间内的异步请求，以及 06:06 原 D5 Worker 退出的根因。readonly GET 的普通访问日志等观测效果不等于生产业务写入。原三次失败及其协调记录必须保留，禁止第四次原 UI 重试；只有精确补充范围经批准并生成新独立回执后，才能按受审协议考虑原 engine 后续步骤。此 reviewer 没有运行生产 UI、生命周期、恢复、调度或外部发送。
