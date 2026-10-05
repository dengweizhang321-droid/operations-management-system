# 五项性能组合：独立前端兼容复核

日期：2026-10-06（Asia/Shanghai）。非作者只读审查；共同基线 `bab42d8c`，初始组合 `0b963653`，最终业务源码 `8fcad768a5cbb5dd1376afea65300eb05cfddb4b`，分支 `codex/performance-integration-20261006`。未改业务源码、作者证据、数据库、生产服务或其他聊天；本记录由独立审查者维护。

## 最终结论

`PASS_WITH_PERFORMANCE_LIMITS`。在所审范围与最终固定源码上，没有尚未闭合的新前端兼容阻断。初审库存 P2 已由另一协作者修复，非作者 helper 复验和实际 Home 六页面、双向交错共 12 个浏览器负例均通过；公共预加载只下载代码，市场未知身份/权限/来源上下文不共享和缓存数据，身份包变化清除本地旧区域。最终检查以读取前后 HEAD 严格一致绑定到上述 SHA。

该结论允许将所审前端组合视为源码兼容资格通过，不是生产上线批准、各板块全部达到 1–2 秒、所有旧业务问题解决、完整生产构建或全仓类型检查通过。原有性能不足及下方证据边界必须保留。

## 初审结论

在 `0b963653` 初审为 `BLOCKED_PENDING_FIX`：发现一项新引入的库存分区恢复缺陷。以下保留原发现与修复过程；当前结论以上方最终结论为准。

### P2：局部重试取消尚未完成的兄弟区域，令其永久停留在“正在读取”

- 位置：`app/inventory-region-notice.tsx:14` 的局部重试按钮；`app/inventory-module-view.tsx:635` 起的 `loadOverview(section)`（同样影响 `loadAgeAnalysis`、`loadInboundMonitor`）和 `:1437` 的接线；`app/inventory-guangdong-view.tsx:78` 起的 effect；`lib/inventory/read-regions.ts:28` 起的单区选择。
- 触发：首次 `summary` 很快返回 503，而 `detail` 仍在途；用户立即点“重试统计与分布”。父函数先取消共享 controller，而新调用只请求 `summary`。旧 `detail` 被正确取消/迟到拒绝，新 `summary` 成功后却没有任何新 `detail` 请求或 detail 错误状态。最终 `summary=true, detail=false, errors={}`，明细区域一直显示“正在读取”，只能依靠整页刷新恢复。反方向及广东页面同理。
- 独立复现：实际 `readInventoryRegions` 与 `mergeInventoryRegion`，按页面真实 controller 交接顺序注入仅合成的 GET；请求序列为 `summary(aborted), detail(aborted), summary(success)`，迟到释放原 detail 后仍得到上述终态。该用例不启动服务或数据库。原三项 helper 测试均通过，但其“局部重试”用例等待原 pair 全部结束，未覆盖该交错。
- 要求：局部重试保留仍在途的兄弟，或补齐所有尚未完成区域；已完成同范围/同版本内容仍可保留。追加先失败/慢兄弟的双向负例、全部相关页面接线以及迟到旧响应拒绝，不能靠把未完成区域标记成功闭合。
- 已交由独立修复协作者处理，审查者未参与源码修改。

### 库存缺陷的修复复核

修复协作者仅调整公共库存 helper：`previous` 明确包含两个区域的就绪位，仅当兄弟已就绪时单区重读，其余情况补读两个区域。四个实际调用点均传入完整 `InventoryRegionState`，并先以其 key 与当前完整请求 key 匹配，不能跨范围借用就绪位。原版本变化的有界重建保持。

审查者独立重新执行 `tests/inventory-read-regions.test.ts`，16/16 通过（约 0.25 秒）：六个现有入口各两个方向的“先失败、慢兄弟未 settle 即重试”，旧迟到不同快照不得覆盖，以及已完成兄弟保留、完整刷新与持续版本变化。修复最终包含于 `3dc098d0` 与 `8fcad768`，helper 字节摘要未变化。新增 UI lab 脚本本身未执行；终审在自己的内存 actual Home harness 重演同一交错，12 个实际页面负例另见下方，不能混作作者 UI lab 的原证据。

## 已验证的组合边界

1. 公共 `requestJson` 默认独立读、same-origin/no-store、写入/上传与原错误语义保持；新增 bounded observed 路径和 GET 在途池为显式能力，没有自动将业务写入或 AI 流式放入池。取消一个订阅者不取消幸存订阅者，旧失败不能结算新条目，超期涵盖正文。
2. `reloadable-lazy` 的显式 preload 与 mount 共用 pending；reset 后旧失败不会清掉新尝试。注册仍不加载；初始组合的 Home 尚未调用意图 preload。销售财报/目标进一步拆 chunk 与该能力兼容。
3. 商品前后端 `salesSourceRevision` 已同时合入；新详情同时验证已有销售网关双 revision header、日期、规格身份和内容字段。销售 full/dashboard/consumer 原默认契约保持；商品当前版本/迟到响应负例在组合内通过。
4. 库存同范围与 source 合并、不同范围/版本不保留明细，版本局部重试重建和持续变更失败通过；上面的在途兄弟恢复负例仍阻断，不能用原通过项替代。
5. 市场作者交接明确指出：既有 5 秒客户端缓存/共享请求键只有 requestKey，Home 预取仅传日期，可靠身份/权限变化的隔离需在集成阶段处理。此为预存机制与已披露的集成依赖，未在本轮静态审查中直接认定真实越权；初始组合没有新增 TTL、跨用户范围或启用公共池。若后继修改此机制，须重新验证。

## 本次独立执行

环境 Node `24.18.0`，均在独立集成树执行，不启动 PostgreSQL、Django、Worker、Vite 或生产构建。

```powershell
node --import tsx --test --test-concurrency=1 tests/foundation-read-client.test.ts tests/foundation-independent-review.test.ts tests/foundation-shell.test.ts tests/reloadable-lazy.test.ts tests/inventory-read-regions.test.ts tests/sales-view-response.test.ts tests/sales-finance-filter-reconciliation.test.ts tests/django-sales-gateway.test.ts
```

结果：54 项通过，0 失败，0 跳过，约 3.25 秒。

```powershell
node --import tsx --test --test-concurrency=1 tests/product-detail-performance.test.ts tests/product-region-recovery.test.ts tests/page-request-lifecycle.test.ts tests/market-read-request.test.ts tests/market-client-chunk-budget.test.ts
```

结果：20 项通过，0 失败，1 跳过，约 14.14 秒。跳过项为“fresh production artifacts keep market administration out of the page entry budget”，原因是没有生产 dist，本轮遵守不运行生产构建限制。商品八个 headless Chrome 用例实际执行，涵盖日期/详情/快照变化、取消/迟到/局部失败与恢复、首次失败和毛利测算。

额外实际 Home 组合检查：使用 esbuild `write:false`、ESM splitting 将真实 `app/page.tsx` 与三份原 CSS 编译到内存，临时动态回环 HTTP 只提供这些合成页面资源，新 Chrome headless context，业务 fetch 限同源 GET 并统一返回合成 503。实际点击库存、销售、商品、市场和销售内部财报、目标、品类七入口，均触发对应原读取，`pageerror=[]`；初入库存仅 `/api/auth/me` 和两次库存分区请求，没有其他三个领域的数据读取。结束关闭浏览器和临时回环资源服务，未写构建物/截图/作者证据。该检查证明 Home 接线和错误状态下懒加载可运行，不是业务成功 DTO、正式 bundle 或性能验收。

该独立 Home harness 的首次尝试漏载 CSS，导致销售导航精确 accessible-name 定位超时；第二次补 CSS 但漏 esbuild `style` export 条件导致 Tailwind 解析失败。补齐原三份 CSS 和 `conditions:['style']` 后通过；两次失败属于审查 harness 设置，不改业务源码、不将失败样本倒填通过。

后继公共代码预加载接线的工作区追加复核：同一内存 ESM splitting actual Home 中，初入库存尚未请求销售 dynamic entry；鼠标 hover“销售分析”后该 entry 实际下载，业务调用记录仍没有 `/api/sales/`。随后实际点击和七入口检查全部通过，0 pageerror。`navigation-preload`、`foundation-shell`、`reloadable-lazy` 三文件共 6 项定向测试通过。此为明确意图下 code-only 机制/接线证据，不是首屏耗时优化比例。

该轮绑定的 SHA-256：`app/page.tsx` = `8D392A80F7373AC60B75B6F731DE71FF0BBE1454D6C266E0BB78EF319B91DEF8`；`app/shell/sidebar-navigation.tsx` = `7E6B343E42B0BA0A64A5FBAE82B82B44634105F5E9FEA7B3E801D017CD56DEAF`；`app/shell/navigation-preload.ts` = `0E49B127A7AB56D42FFCAD80463FB276268D5B91FE08F3F53451076DE64428BC`；`app/shell/reloadable-lazy.tsx` = `AB49FD36D8C3B28A0789B9DAB0486ACA1D10CF33C0A4535C6D263E6748FE0D0E`；库存修复 helper = `E50E17079FE93BFA901E4D84C6B5723CA97BF69B799C22944EC199A2F60F855E`。仍待最终组合 SHA 与其他接线变动核验。

## 最终 SHA 追加验证

固定源码 `8fcad768a5cbb5dd1376afea65300eb05cfddb4b`；试验前后 `git rev-parse HEAD` 相等。最终 `app/page.tsx` 和库存 helper 与上方已验摘要相等；`app/market-view.tsx` SHA-256 为 `F9A041963514365B7D07976C5B15C2B99B7D704A16916F2C247E455ADEA4E072`。仅本目录审查文档未跟踪；`git diff --check` 通过。

### 实际 Home 与成功业务区域

继续使用 `write:false` 的内存 ESM splitting、真实 Home 与三份原 CSS、新建无登录态 headless Chrome、临时动态回环资源服务、同源纯合成 GET 响应，无外部业务调用。该轮包含四域**非空成功响应**，不是前一轮统一 503 的壳层检查：

- 库存：读取库存作者已保留的纯合成 PG UI fixtures，原 overview/plan/age/stale/inbound/guangdong DTO 与 section 投影规则；所有产品名替换为显式 REVIEW 标记，数据未从生产读取。
- 销售：使用仓库 `docs/performance/sales/fixtures/core.json` 与 `full.json`，附合同双 revision header；实际先出现 KPI、再出现趋势/分布完整区域。
- 商品：复用 `tests/product-detail-performance.test.ts` 的完整 synthetic full fixture，真实商品 decoder 与组件执行，商品行可见。
- 市场：以现有只读负例夹具的两个纯合成 SKU 为基础，补齐当前 `MarketOverview`、`MarketItem`、`MarketIndustryReport` 所有必需字段。使用 TypeScript Compiler API 在内存对实际源码提取的类型声明执行 strict 完整类型检查（无 casts、未写 `.ts` 文件），0 diagnostics，然后实际渲染榜单行。该检查仅证明合成 DTO 满足当前前端结构，不证明市场历史比较口径正确。

销售链接 hover、商品链接 keyboard focus 都实际请求目标 dynamic entry，但尚未点击时没有对应业务 API；随后真实导航正常。所有成功区域与代码预加载检查 `pageerror=[]`。

四域成功 fixture 不等于全域每个子页/范围业务都重验；本轮补齐主入口和销售 core/full 的组合接线。生产鉴权、后端查询与真实网络时间均由合成 transport 替代。

### 身份变化与本地旧内容清理

Home 本身只在挂载时读 `/api/auth/me`，没有提供模拟身份切换的产品入口。因此身份变化实验明确使用**真实领域组件的 props 重渲染夹具**，没有伪称用户在生产 Home 完成换号：

- 销售、库存、市场先显示账号 A 合成成功结果；切到 B，服务端夹具只回 403。旧业务内容均不可见，分别出现 1、2、2 个新读取并显示失败，0 pageerror。
- 市场账号对象以 `useMemo` 保持稳定，输入 `STICKY` 筛选、切比较子页再回榜单，筛选仍在，证明普通子页切换没有误重挂工作区。
- 市场显示字段完全相同但换为新的身份对象包，新读取返回 403，旧榜单行被清除。该行为对应新 WeakMap 身份包代数与字段快照 key；实际 Home 的 `currentUser` state 对象在普通页面交互中稳定。
- 无可靠 `MarketReadContext` 时，cached initial 为 null、普通读取独立执行、不写共享 cache；无上下文预取不发数据。完整上下文的三个键均参与短缓存/在途键，未把 `scopeRestricted` 展示布尔充作权限证明；当前真实 UI 仍未启用这个可选共享路径。

独立执行以下四项新/旧负例全部通过（0 失败、0 跳过，约 0.39 秒）：

```powershell
node --import tsx --test --test-concurrency=1 --test-name-pattern="market reads need complete|aborting the prefetch|aborting the page subscriber|shared market request aborts" tests/market-performance-cache.test.ts
```

### 库存 actual Home 的 12 个 UI 交错

六个真实入口 `overview / plan / age / stale / inbound / guangdong` 各新建页面，分别让 summary 或 detail 先 503，另一请求保持未 settle；实际点局部重试，要求两个 section 均重读、两个区域的“正在读取”和重试提示消失。再释放被取消的旧兄弟（故意忽略 abort、返回另一 snapshot 和 `REVIEW-OLD-LATE`），旧内容不可见。12/12 通过，0 pageerror；既有成功/同范围保留与版本约束仍由前述 helper 控制用例覆盖。

此流程复验了新 UI lab 追加负例的相同关键时序，使用独立 actual Home harness，不启动/覆写作者 Vite lab 或其旧 evidence。

本次追加浏览器共记录 23 个检查，其中市场完整 DTO 补齐后单独重跑相关 Home/身份/预加载 11 个检查，均通过。期间一次内存 TypeScript harness 因 Windows 路径分隔符未规范化而报告虚拟文件不存在，规范化为 `/` 后 strict 类型检查和浏览器通过；未改生产源或放宽类型。此前构建与 `8fcad768` 编辑并发的试验只作非精确阶段观察，不纳入最终 SHA 绑定结论。

## 原有不足与新缺陷分开

各所有者报告已披露的冷库存总览/计划大于 2 秒、销售冷品类/财报及完整重入的部分回退、市场大范围榜单/完整报告与未确认价慢查询，以及市场既有比较口径缺口，属于尚未完成的性能/业务资格，不应伪装成已解决，也不是本轮 merge 新引入的问题。公共在途池、意图 preload 和真实身份/后端分段观测在初始组合仍有接入限制。生产权限/真实规模/P95/长期资源及最终正式构建不在本次审查证据内。

## 全库首轮之后的旧测试适配

Root 明确通知全库首轮结束后，追加授权本审查者仅修改九份旧测试，未改业务源码。原全库失败记录仍由 root 保留在 `.runtime/performance-integration/unit-all.log`；不能将后续通过反推旧失败当时已通过。本审查者仍是 `8fcad768` 业务源码的非作者；以下九份测试适配由本审查者编写，不称为独立复核自己的测试修改。

- `django-finance-routing-static`、`finance-target-export-contract`、`finance-target-ui-contract`、`product-inventory-fourth-batch`：财务行为断言读取实际新 owner `sales-finance-views.tsx`；主销售模块的身份/管理员权限与 lazy 接线仍单独断言。确认、原因长度、CAS、分页、模板/导出和 Django-only 边界保留。目标选项不再要求等待列表，但必须有独立 effect、controller、权限和错误恢复。
- `filter-refresh-experience`：按当前完整日期/筛选/规格/来源快照键限定保留内容；目标列表同时验证同 listKey 的成功布局保留，不恢复旧仅品类名/商品编码的范围错误。
- `table-column-filter-scope`：与市场修复协作者确认原 60 条原始行窗口，满窗禁用当前页全量筛选、展示当前行数与完整历史月数；财务费用表断言移到实际 owner。没有用历史 `truncated=false` 假定全集。
- `transient-fetch-retry`：保留原四项真实成功/5xx/网络/不安全写入/取消负例，将销售旧 42 秒六次退避文本断言改为全轮最多一次 1 秒重试、共同 30 秒期限、full 绑定 initial revision。
- `module-view-page-integration`：保留 shellReady 后才挂载真实业务 View、深链接/历史/受控 tab 契约；预载只验证四域 code loader，并禁止 Home 无上下文市场数据预取。
- `finance-multiselect-interaction`：复用完整纯合成 finance fixture，guard 先验必须成功，再按实际 pending URL 回显月份、平台和复合店铺 selection。保留原金额显示、两处月份搜索/多选保持、503+重试、旧响应迟到、店铺多选和无数据清理所有断言；原 60 秒测试期限与浏览器默认 30 秒等待未修改。

首次适配后 32/34 通过，另两项分别是尚未更新目标列表的新明确就绪条件，以及 tsx 对 browser evaluate 内具名 arrow 注入 `__name` 导致夹具 ReferenceError。随后补齐就绪条件断言、将夹具函数改为 object method，未改生产源码或校验器。最终九文件定向结果 **38/38 通过、0 跳过**，约 5.79 秒，真实 Chrome 财务交互约 3.01 秒；九文件 ESLint 与 `git diff --check` 通过。未提交，由 root 统一审阅和提交。
