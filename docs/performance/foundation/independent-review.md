# 公共性能底座非作者独立复核（2026-10-05）

结论：**PASS_WITH_INTEGRATION_LIMITS**。初审独立复现两项公共接口缺陷，作者修复后已独立复验闭合；当前六份公共源码没有剩余已确认阻断。新增读取合并、分阶段观测与代码预加载仍是待集成能力，不能据此声称四个板块或全系统已经提速。该结论不授予合并、发布、生产操作或业务执行许可。

复核者为非作者子任务 `independent_review`；只新增本独立测试和本说明，未改作者源码、作者测试或领域页面。基线 `bab42d8ce836b4ee9acd82e80de085ff71f9f494`，worktree `D:\.codex\worktrees\performance-foundation\运营管理系统`。读取了共享记忆协议、项目适用 AGENTS/README、Django 导入架构与运行守护、既有市场性能文档；当前用户“保留独立分支、不合并/不准备候选/不碰生产”覆盖历史默认流程。

## 初审发现与修复

| 发现 | 精确位置与复现 | 修复与独立验收 |
| --- | --- | --- |
| P2：读取流失败值为 `undefined` 时被当作成功 | 初审 `lib/http/read-client.ts` 的 `finish(entry,error?,value?)` 用 `error !== undefined` 判失败；`new Response(new ReadableStream({start(c){c.error(undefined)}}))` 使两个订阅者均 `fulfilled(undefined)`。标准 Streams 允许任意失败原因。 | 当前第 58–65 行改为显式 `Result` 联合；所有 rejection 都走 `ok:false`。独立两订阅者负例通过，成功空响应仍合法。 |
| P2：新增观测接口声明的取消信号未接线 | 初审 `ObservedJsonOptions.signal` 已公开，但 `executeJson` 的 fetch 只使用 `init.signal`，正文又以 `signal:init.signal` 覆盖 options；只在 options 传已取消信号，仍发送请求并成功。 | 当前 `lib/http/api-client.ts:142` 归一化 `init.signal ?? options.signal`，第 143 行提前拒绝，第 153/177 行传输/正文一致接线，第 173 行拒绝迟到成功。独立预先取消零传输、活动 options 信号传递及正文取消均通过。若同时提供两信号，调用方应使用已明确的 init 优先规则。 |

原始初审日志 [independent-tests-initial.log](independent-tests-initial.log) 保留 13 项、11 通过/2 失败。原 options.signal 用例还断言已取消信号会传给 fetch；作者增加更强的发送前拒绝后，该用例调整为零传输并检查 AbortError，另增活动信号接线用例；没有删除其取消断言。

## 独立验证

所有测试仅本 worktree 的独立 Node 进程与完全合成响应；没有监听服务端口、读取业务数据、发送消息、触发下载/导入/AI 任务，亦未运行全量测试或构建。

| 命令/证据 | 结果与覆盖 |
| --- | --- |
| `node --import tsx --test tests/foundation-independent-review.test.ts` / [最终日志](independent-tests-final.log) | **15/15**。后来订阅者超时、正文中单订阅者取消、失效后旧传输失败、首请求共同生命周期、容量耗尽仍加入原键、容量一顺序读取、用户/权限/日期/筛选/版本/头隔离、四路径在途合并/无结果缓存、undefined rejection、options 信号、旧写调用与大响应默认兼容、SSR加载可访问性、旧预加载失败交错和数字观测容量。 |
| `node --import tsx --test tests/api-client.test.ts tests/app-shell-navigation.test.ts tests/app-shell-resilience.test.ts tests/app-shell-accessibility.test.ts` / [壳层回归](independent-regression.log) | **25/25**。旧请求序列化/凭据/cache/上传/错误/取消默认、导航契约、错误边界和焦点陷阱静态契约。 |
| `node --import tsx --test tests/sales-summary-query-packing.test.ts tests/product-summary-projection.test.ts tests/inventory-overview-period.test.ts tests/market-read-request.test.ts` / [领域回归](independent-domain-regression.log) | **10/10**。原销售100商品查询打包、商品Django摘要/版本投影、库存周期边界、市场错误/共同正文期限/取消迟到响应。销售边界使用原测试的合成 esbuild seam；非真实鉴权或 PostgreSQL 集成。 |
| `git diff --check` | 通过。 |

## 契约与集成边界

- `requestJson` 默认分支保持原有函数签名、JSON/上传处理、默认 same-origin/no-store、错误和无自动重试行为。新增字节限制及观测只由 `requestJsonObserved` 或显式 pool 调用启用。
- pool 只以 exact allowlist 路径发 GET、redirect:error；键同时包含会话、完整 principal/scope 指纹、来源版本、完整 URL 与请求头。缺版本 `null` 时每次独立发起，完成结果不保存；不能给身份/权限字符串常量冒充真实已核验指纹。
- 独立取消只脱离自己的订阅；最后订阅者退出、全体失效或生命周期到期才 abort 公共传输。已 abort 且不协作的传输仍占容量直至实际 settle，避免不断新建传输；这可能在异常 transport 下让池长期拒绝新请求，是有界失败策略。计时器不能抢占同步 JSON 解析/structuredClone；不是硬实时 CPU 期限。
- Browser Abort 只证明客户端取消读取/发出信号；四域公开读取继续传递 `request.signal`，但本次没有证据证明同步 SQL、DNS 或已被后端接受的工作已停止。不得用于写入、任务提交、上传、SSE 或已接受后台任务。
- `preload` 不在注册时调用，不自动预取页面或数据；预加载与 lazy mount 共用 pending，仅明确导航意图时才可接入。reset 生成新 lazy，不会被旧 preload 的晚失败清空新 pending。现主页只采用共享加载状态，未接入预加载。
- 加载组件保留 160px 最小区域、单个 live status、busy和装饰图标隐藏。SSR检查了转义及不抢焦点；旧错误边界保持已有重试/返回按钮和焦点处理。
- 观测只保存 allowlist stage/数值，默认关闭、容量环形、异常 observer 不破坏读取。`Server-Timing` 只能收明确数值，缺失 queue/SQL/etc 应标未知；本次没有给真实 Worker/权限/Django 安装探针，也未测量真实鉴权、排队、SQL或传输。

## 待统一集成验证

1. 四领域分别证明准确 GET 语义、可靠身份/scope/版本来源及失效事件；接入时用真实现有 DTO/错误解码器回归，不能用本独立合成路径测试替代。
2. 构建和完整组合验证由根任务或统一集成执行。本复核没有构建验收、真实浏览器点击/键盘焦点/错误重试、CSS布局移动或主线程帧观测证据；SSR和静态契约不能冒充这些验收。
3. 真实性能前后样本须单独记录阶段、范围、请求数、负载及结果等价；本次单测时间仅测试运行耗时，没有全系统性能对照或生产P95。鉴权服务是否瓶颈、导入/下载/AI是否与页面争用未被本复核证实。
4. 合成 stream 非协作、订阅者大量克隆及实际大响应应保持 byte/entry/subscriber 上限，接入时不要增大既有期限、无限并发或添加持久结果缓存。

## 已独立复验源码字节

下列 SHA-256 绑定修复后的复核样本；后续编辑须判断是否需追加复验。

| 文件 | SHA-256 |
| --- | --- |
| `lib/http/api-client.ts` | `e82a5a47ead60d636b4945a800b6f7f2214e89c6c0d5410299da994149e3c41a` |
| `lib/http/read-client.ts` | `73d13f2322d76b8db4de4e36739fbe5d5f405fad52842b087a0a6bb6f866e219` |
| `lib/http/performance.ts` | `3e1bcbf46b77b090479992b5d536bd849b2663930654cae93fe42f7c623d0d89` |
| `app/shell/reloadable-lazy.tsx` | `ab49fd36d8c3b28a0789b9dab0486aca1d10cf33c0a4535c6d263e6748fe0d0e` |
| `app/shell/module-loading-state.tsx` | `91336997f792d1fe32dfe0d0bcdd2d1f18a260c06f467127cf6e62c0959c59d5` |
| `app/page.tsx` | `a27346d300b44d8b9f85099c7121ad3d90ee69f43a95ccdf88d51120d26d7f70` |

## 追加复核：取证工具与扩展验证

2026-10-05 根任务新增四个 `tools/performance/foundation-*` 工具及 `tests/page-request-lifecycle.test.ts` 的单一 fallback 断言调整后，非作者进行了逐文件静态复核、报告数值核对、基线摘要独立重算及该生命周期测试独立运行。**最终公共能力与取证工具范围继续为 PASS_WITH_INTEGRATION_LIMITS，没有新增已确认阻断**。以下结果扩展前文初审验证范围；早期“尚无浏览器证据”仅指初次独立验证，已由下述浏览器夹具证据部分补足。

| 追加文件 | 隔离与真实性核验 |
| --- | --- |
| `tools/performance/foundation-benchmark.ts` | 只在 `127.0.0.1` 动态端口建完全合成 GET 服务、原生fetch读取合成body；无 runtime配置、凭据、真实 Django/Worker/数据库或业务任务调用。基线代码确实通过 `git show bab42d8c:lib/http/api-client.ts` 导入，独立重算 SHA-256 `f1245028c5bf1307a5c89e454d7523c1a9211d442cb42d00aadc4112afe835b0` 与报告相同；其 `ApiError` 依赖与基线原字节一致。原鉴权函数通过明确合成 identity/header/permission seams执行，不能据此声称真实鉴权路径已计时。finally释放pool、连接和服务器。 |
| `tools/performance/foundation-browser.mjs` | esbuild只写本树 `.runtime/foundation-browser`；新headless Chrome临时会话、动态回环HTTP，不使用用户profile；Playwright拒绝非本fixture origin请求，CSP禁止真实connect/form/object。页面fetch被fail-closed seam替换，仅GET、合成auth，四域业务读取均故意返回503；不会提交写操作或接受后台任务。finally关闭Chrome和服务器。 |
| `tools/performance/foundation-audit.mjs` | 只读取基线Git、本树源码、既有本地dist/类型日志，内存esbuild/gzip对照并写本目录报告；不执行build、候选准备或发布。`baselineEqual`是逐字节证据。静态资产清单为单次本地生产模式构建的当前包清单，未对比基线全站dist。 |
| `tools/performance/foundation-soak.ts` | fetcher仅合成Response和1ms定时器，未调用网络；1000轮/2000订阅者交错取消，检查每轮entries/subscribers/transports/resultCache/listener balance回零。heap/RSS采样不能证明浏览器长期内存斜率。 |
| `tests/page-request-lifecycle.test.ts` | 只将旧内联section选择器更新为共享 `ModuleLoadingState`，其余懒加载、位置初始化、首次分页、取消/迟到等断言保留；组件status/minHeight/spinner语义另由独立测试及浏览器夹具覆盖。独立执行 **8/8通过**。 |

### 性能数值与限制

[benchmark.json](benchmark.json) 对四条合成路径各30轮、每轮4个相同订阅者，逐轮交替基线/新增pool次序并对结果深比较。每域请求 **120→30**、响应payload字节 **262680→65670**，峰值并行请求4→1；只证明相同在途键在该条件下减少 **75%** 传输。基线自身已并行，因此没有把不必要串行等待制造成旧版本基线。

| 合成路径 | P50 ms，基线→pool | P95 ms，基线→pool | 进程CPU微秒，基线→pool |
| --- | --- | --- | --- |
| 销售 | 61.440→59.326 | 91.278→71.426 | 359000→109000 |
| 库存 | 59.138→59.311 | 68.208→62.457 | 125000→141000 |
| 商品 | 55.557→58.105 | 66.357→64.947 | 156000→188000 |
| 市场 | 55.722→58.259 | 68.976→66.310 | 47000→47000 |

不能从这些数值宣称稳定CPU、延迟或内存收益：库存/商品CPU增加，部分P50回退；进程CPU含合成server，计时包括深比较和客户端解析/克隆，heapDelta受GC影响，样本仅30轮、不是生产P95。共有请求减少及独立订阅者对象隔离的能力收益与真实板块尚未接入的实际收益必须分开。[audit.json](audit.json) 的同minifier独立客户端包 **1836→3941 bytes**、gzip **907→1757 bytes**，包含新导出的可选能力；不隐去代码体积增加，也不声称全站包缩小。

### 扩展验证证据的接受范围

- 非作者阅读 [browser.json](browser.json) 和对应工具逻辑，8项浏览器夹具检查覆盖实际Home的首次库存不读其他三域数据、四域键盘导航/发起原读取/壳层可见、移动Escape、160px加载及独立probe的chunk失败聚焦/键盘重试/标题焦点恢复。该工具由作者运行，本次非作者未重新运行Chrome；probe延迟为明确合成值。四域均为503错误夹具，工具未逐项断言具体领域错误正文，不替代成功DTO或生产渲染等价验证。
- [soak.json](soak.json) 的1000轮账本和listenerBalance均回零，可支持合成条件下清理正确；不是长期会话的泄漏排除证明。
- 阅读作者最终 [build.log](build.log) 的Build complete、[lint.log](lint.log) 的0错误/28警告、[final-regressions.log](final-regressions.log) 的105通过和 [remaining-regressions.log](remaining-regressions.log) 的88通过。未在独立任务重复全量测试或构建。首轮全量失败/取消样本仍保留 [unit-tests.log](unit-tests.log)，不能把定向续验改写为首轮全量全通过。
- [types-final.log](types-final.log) 仍有 **188错误/32文件**；audit逐文件 `baselineEqual=true` 已核对。该证据证明诊断所在文件与基线源码相同、最终诊断未位于本任务改动文件，**没有独立实际运行基线tsc并逐诊断对照**，因此不将整库类型检查报告成通过，亦不把188条全部断言为已验证相同的基线诊断。

待集成条件维持：真实已核验身份/scope/版本指纹及失效事件、四域成功DTO/既有期限、生产模式组合浏览器验证、真实各阶段计时与后台争用证据；本轮不合并、不准备正式候选、不发布、不触碰生产/迁移/回填/调度/业务任务。
