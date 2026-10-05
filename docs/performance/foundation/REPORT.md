# 公共性能底座：独立开发交付

日期：2026-10-05（Asia/Shanghai）。状态：**公共能力已开发和隔离验证，领域接入待统一集成**。没有全系统已经提速的结论。

## 分支与边界

- 启动时执行 `git fetch origin main`，基线 `bab42d8ce836b4ee9acd82e80de085ff71f9f494`。
- 分支 `codex/performance-foundation-20261005`；worktree `D:\.codex\worktrees\performance-foundation\运营管理系统`。最终提交 SHA 见交付消息，亦可在该树执行 `git rev-parse HEAD` 核验。
- 参考 `d478` 的 README/AGENTS、导入架构、运行守护、隔离预览与既有市场/商品性能资料；实际开发树由基线创建。用户当前阶段约束覆盖历史默认立即合并/准备候选/清理流程。
- 没有改四领域页面及业务查询、鉴权实现、连接配置、README、AGENTS、正式调度或生命周期脚本；没有合 main、准备/采用候选、生产服务操作、数据库迁移/回填、业务执行或测试消息。实际领域/鉴权/连接配置文件与基线字节一致，见 [audit.json](audit.json)。
- `.runtime/` 保留本树独立 Python venv、浏览器构建及最初依赖/测试日志。正式 bundle 仅在本树 `dist` 构建，没有启动它或触碰正式 3000 的产物。独立测试服务器使用动态回环端口，测试结束关闭；真实浏览器使用新无登录态上下文。
- Git交付的`.log`仅规范化CRLF、行尾空白及EOF空行以通过diff-check；完整原字节已复制保留在本树`.runtime/foundation-validation/raw-logs`，前后SHA和字节数见[log-preservation.json](log-preservation.json)。失败/断言/样本内容没有删改。

## 瓶颈与假设排序

排序按可复用范围和证据强度，**不是未经测量的生产耗时排名**。

| 优先级 | 发现与证据 | 本轮处理 / 不能推断的内容 |
| --- | --- | --- |
| 1 | 公共 `requestJson` 原实现每调用一次发一次请求。四个相同并发读在基线回环实验各发4次；相同数据由新池只发1次。 | 实现显式 GET 在途合并；四领域大部分仍 raw fetch/独有 reader，公共池尚未接入，实际重复发生频率与全站节省量未知。 |
| 2 | 公共旧客户端没有正文容量或完整读取期限；领域网关已有 `fetchBoundedJson` 与版本/fence，不能称全系统无有界请求。 | 新公共读取具备字节/槽位/订阅者/生命周期边界，旧客户端默认保留；不扩大原超时，不统一重试。 |
| 3 | 各模块懒加载已存在；实际 build manifest 显示四域为 dynamic entry，Home 静态依赖闭包不含 XLSX。shop chunk 564,905字节/gzip157,416、XLSX421,192/gzip139,312只是体积清单。 | 只增加 code-only preload接口及公共稳定加载区域。未自动接入preload，未重构共享包；chunk体积不证明首屏加载或主线程瓶颈。 |
| 4 | 普通身份链路含真实身份解析+权限RPC，本地直连则检查本机条件、role与Host后直接返回。代表四路由每次仅调用一次`requireAppPrincipal`。 | 实际未改鉴权。执行原函数的合成seam实验分别测量两路径；没有真实权限服务耗时证据，不加跨请求授权缓存。没有已确认的同请求重复认证，暂不做鉴权复用。 |
| 5 | 原链路规则、n8n 页面已有隐藏暂停刷新；AIWorkspaceHost保留已访问工作区以维持被接受请求；市场已有独有在途复用与短时预取缓存；DB配置`CONN_MAX_AGE=60`。 | 保持既有能力。市场前端键与身份变化的隔离应由市场任务独立验证，不能仅凭参数键静态形态宣称已泄露。非必要隐藏轮询、长会话堆增长是待验证项。 |
| 6 | 本轮没有真实慢请求与后台导入/下载/AI资源的同窗采样，也没有真实Django排队/SQL阶段。 | 争用原因未知；不建议或调整正式任务并发/调度。不把机器CPU高或时间相关性直接归因为业务任务。 |

## 实际变更与兼容性

| 文件 | 改动 |
| --- | --- |
| `lib/http/read-client.ts` | 显式注册路径、同源GET池；同会话/完整权限scope指纹/版本/完整URL/全部请求头才合并；独立取消、共同生命周期、容量、失效、dispose；无结果缓存/队列/自动重试；响应对象逐订阅者克隆。 |
| `lib/http/api-client.ts` | 原`requestJson(input,init)`签名/default same-origin/no-store、JSON/上传/错误/无重试保持；新增`requestJsonObserved`供显式读取使用，带可选计时、字节上限与贯穿正文的取消。`init.signal`优先于`options.signal`。 |
| `lib/http/performance.ts` | 默认关闭的容量环形数字记录器、调用方持有的阶段trace、有限Server-Timing数字解析。无全局请求/授权缓存，无URL、账号、header、凭据或正文记录。 |
| `app/shell/reloadable-lazy.tsx` | 增加显式`controller.preload()`；与lazy mount共用pending，reset后旧失败不能清空新pending；注册不加载。 |
| `app/shell/module-loading-state.tsx`、`app/page.tsx` | Home两处加载状态复用独立区域组件，160px最小高度、单个status/live/busy、spinner aria-hidden；原导航、错误边界、AI挂载语义保留。 |
| `tests/foundation-*.test.ts`、`tests/page-request-lifecycle.test.ts` | 作者与非作者契约负例；旧生命周期测试更新单一加载组件形态断言，原全部按需导入/错误边界断言保留。 |
| `tools/performance/foundation-*`、本目录 | 可复现合成回环/真实浏览器壳层/账本清理/源码和构建审计、证据与领域交接。 |

现行公共`api-error.ts`是依赖，未修改。独立审查发现的undefined rejection和新signal未贯通已修复，失败样本保留。[独立报告](independent-review.md)结论`PASS_WITH_INTEGRATION_LIMITS`。

容量默认8个传输、每传输16订阅者、总64订阅者、2MiB正文、15秒完整生命周期。硬上限32/64/128/16MiB/65秒只限制配置，**不能作为放宽领域预算的许可**。超容量直接失败，不排队、不退回无限并发。取消但不协作的传输仍占槽位至settle；可能长期拒绝新增读取，符合有界失败策略。同步JSON解码和clone不可被计时器抢占。

## 对照与资源证据

[benchmark.json](benchmark.json)：基线客户端从精确基线`git show`加载；候选源码SHA保全。真实native fetch与临时回环HTTP，2,189字节完全合成JSON，每领域30轮，基线/候选次序交错，4相同并发订阅者，完整响应深等价。没有真实Worker、Django、SQL或业务数据。

每领域30轮：请求 **120→30**、正文传输 **262,680→65,670字节**、服务端同时在途 **4→1**；四领域总计480→120次。这是合成重复条件下75%读取/传输减少，不是已实现的领域或全系统收益。

壁钟与CPU/堆对照以完整原始样本为准；汇总如下。实验期间整机平均忙碌约42%–71%，可用内存最低约0.74GB，**该轮延迟和资源差异有干扰，不作为稳定提速或无回退验收**。不丢弃慢样本、不增加超时。

| 合成路径 | P50 ms 原→新 | P95 ms 原→新 | 进程CPU ms 原→新 |
| --- | --- | --- | --- |
| sales/summary | 61.44→59.33 | 91.28→71.43 | 359→109 |
| inventory/overview | 59.14→59.31 | 68.21→62.46 | 125→141 |
| products/summary | 55.56→58.11 | 66.36→64.95 | 156→188 |
| market/overview | 55.72→58.26 | 68.98→66.31 | 47→47 |

进程CPU包含本工具服务端；堆delta含GC，有正有负，不能宣称内存稳定降低。降低传输数可能增加subscriber clone成本。普通鉴权原函数的合成seam30样本P50/P95约31.86/47.01ms，本地直连0.006/0.077ms：普通30身份+30合成权限RPC，本地30Host读取/0权限RPC。实际身份/权限服务被注入，不能用这些数字断言真实权限瓶颈。生产条件仍禁用local opt-in、local admin role仍接受allowedRoles检查，两项拒绝验证通过。

[soak.json](soak.json)：1000轮、2000订阅者、1000传输，500次单订阅者取消；每轮结束entry/subscriber/transport/result-cache及abort listener余额均0。只证明公共账本清理，不是实际浏览器长时间内存斜率。

[audit.json](audit.json)：候选生产资源清单及baseline字节核对。导出全部公共API的独立minify client为1836→3941字节、gzip907→1757，新增有界观测能力有约850gzip字节成本；**没有bundle整体减少结论**。实际共享api-client chunk3483字节/gzip1605；正式网络前后仍待集成比较。

## 验证结论

| 检查 | 结果与范围 |
| --- | --- |
| 首轮全库unit | 3271项：3234通过、12失败、1取消、24跳过，372.38秒。保留[原日志](unit-tests.log)，不追认为一次全绿。 |
| 修复/环境收口 | 本树执行原`postinstall`摘要固定依赖补丁；建立无pip独立`.runtime/test-venv`；本轮壳层测试形态更新。没有改领域逻辑或放宽原测试期限。 |
| 最后公共+四域+取消/鉴权+真实合成worker回归 | [105/105](final-regressions.log)，包含旧API、scope/日期/版本、multi subscriber、late body、错误边界/键盘契约。 |
| 首轮剩余失败全集对应文件 | [88/88](remaining-regressions.log)，原Python/TS合同、导入纯投影、Windows managed-process与隔离Chromium；串行重验，不反推首轮超时根因。 |
| 最后壳层/旧形态断言 | [10/10](final-shell-tests.log)。 |
| 非作者 | 15独立负例、25旧客户端/壳层、10四域代表读取通过；两项初审缺陷独立闭合。[报告](independent-review.md)。 |
| 浏览器 | [8检查](browser.json)通过，0 pageerror；实际Home+四域原读取（明确503合成来源）/键盘/移动菜单/区域加载/懒加载错误重试。不是四域成功DTO或生产绘制性能验收。 |
| 构建 / lint | [构建通过](build.log)；[lint0错误/28警告](lint.log)，本任务文件无警告。警告均在未修改文件。 |
| TypeScript额外检查 | [188错误](types-final.log)，32个报错文件均与baseline字节一致，见audit；本任务文件无错误。整个仓库typecheck仍非全绿，留统一集成处理，不宣称其通过。 |
| diff-check | 通过。 |

运行入口、依赖与统一集成门禁见[INTEGRATION.md](INTEGRATION.md)。分支/worktree/证据保留；下一步由统一集成任务评估领域接入和组合版本，不由本任务合并或上线。
