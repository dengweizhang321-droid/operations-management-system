# 五项性能改动统一集成（2026-10-06）

状态：五来源已在独立集成树组合并合主线，组合验证通过，两侧在线候选已准备。生产未采用。发布候选的精确绑定与最终状态见 [RELEASE_CANDIDATE.md](RELEASE_CANDIDATE.md)，不用本段代替生产验收。

## 来源与授权

用户授权销售最终交付后统一合并、验证和准备候选；不含生产维护、部署、迁移、回填、扩权、调度或业务补跑。共同基线 `bab42d8ce836b4ee9acd82e80de085ff71f9f494`。

| 顺序 | 来源分支 | 经远端核验的提交 |
|---|---|---|
| 公共底座 | codex/performance-foundation-20261005 | 305d8bdc5d5705a614a645c5aa1b7b840ea0aa95 |
| 销售 | codex/sales-performance | 3c6aa979e16fe4c262e187b41ae8b9a4ce0533cf |
| 库存 | codex/inventory-performance | abebcee4114c69aee4ceb4afe7b54dff93401901 |
| 商品 | codex/products-performance-complete | 4f613b2d58b045320c57a1a9e9ac170038a8b36b |
| 市场 | codex/market-performance-complete | de4d2c34fc92c5b71090ba7e014324aef09455f1 |

集成树 `D:\.codex\worktrees\performance-integration\运营管理系统`，分支 `codex/performance-integration-20261006`。五个完整来源以顺序 merge 保存，没有只取前端而遗漏后端协议；源码文件没有合并冲突。

## 集成中实际修复

1. 库存局部失败先于兄弟区域完成时，重试原本取消共享 controller 却只重读一个区域，兄弟可能永久 loading。现在只有兄弟已 ready 才读单区，否则补读两区。六入口双向旧实现负例确实失败，新实现与实际 Home 12 个交错验证通过。
2. 四板块接通仅代码的 hover/focus/click 意图预载，同一模块复用已有 lazy promise，最多两项在途，不排队全站下载；失败有短冷却且不阻断正常导航。不预载业务数据。
3. 市场原全局短缓存/在途池仅按 query 绑定。现在必须有完整调用方身份、权限指纹和来源版本才可复用；现有 UI 不提供这些可靠见证，因此独立读取、无缓存初始数据、无无见证的数据预取。合法完整上下文的共享取消行为保留并验证，未拿展示布尔凑权限指纹。
4. 市场本地成功区域随新的认证对象包或已知字段变化整体重挂；同显示字段的新身份包也不能继承旧内容。稳定身份普通子页切换保持筛选。
5. 旧测试按销售财务拆分后的实际所有者、core/full 分区及真实趋势窗口适配；保留金额、权限、CAS、上传、复合店铺、多选、取消和迟到等原断言，没有删掉失败案例或放宽超时。

业务修复固定提交分别为 `3dc098d0`、`8fcad768`；后续测试/文档提交不改其业务源码。独立复核见 [前端复核](review-ui.md) 与 [后端复核](review-backend.md)。

## 实际组合验证

| 检查 | 结果与边界 |
|---|---|
| 全库 Node 最终轮 | 3330 项：3309 pass、0 fail、0 cancelled、21 skip；397.259 秒，固定组合业务源码与已适配 TS 测试。原首轮 3314/3265 pass/25 fail/24 skip 保留，不追认为首轮通过 |
| 构建后渲染验收 | 20/20，无跳过；含独立 built Worker 在缺业务配置时 live 200 / ready 503，非生产启动 |
| sales/BI/products/finance API | 私有 PG 65/65；完整销售/核心分区、缓存、消费者及财务 API。非整个 finance 全套 |
| inventory/consumer/BI/products | 私有 PG 132 项：129 pass、3 原环境可选 skip；migration dry-run 无变化 |
| products/销售消费者 | 私有 PG 31/31 |
| market | 私有 PG 148/148；真实 reader 5、writer 4 项禁止权限负例均拒绝；私有集群正常停止，无模型调用 |
| 实际 Home 与组件 | 四域合法非空合成 DTO 成功；代码预载不发业务 API；身份切换 403 清旧内容；六库存页双向竞态；0 pageerror。实际库存组件额外 103 checks / 123 measures / 513 合成请求通过 |
| 隔离生产模式构建 | 通过；仅本集成树 dist，正式 3000 与运行包未改 |
| lint / 后端边界 | 0 error / 28 warning；630 模块边界检查通过 |
| TypeScript | 188 个既有诊断；与保存的同基线编译器诊断按 file/code/message 多重集合比较 added=0、removed=0。全仓类型检查仍非全绿 |

原始运行输出保存在本树 `.runtime/performance-integration/`，摘要与 SHA 见 [validation.json](validation.json)。各私有 PG runner 使用独立端口、随机测试凭据与白名单环境，没有生产连接回退。

首次扩大到整个 `finance.tests` 的销售裁剪环境有 3 error / 3 fail：五项 reserved-edge 缺 netshop app，另 golden ZIP 构造字节在 Python 3.14 与固定 fixture 不同。没有改业务或 golden 测试以变绿；精确基线 AST 与两运行时复现及范围界定见 [基线复核](review-baseline.md)。纯 Python Node 合同原来缺硬编码 test-venv，补独立无 pip Python 后五文件 49/49。所有旧失败日志保留。

## 没有完成的性能/业务资格

- 库存总览/备货计划冷范围约 3.38/2.78 秒，商品新日期约 2.95 秒、跨范围锁约 2.76 秒；这些是所有者原测量，不是新组合生产测量。
- 商品每 1000 规格的销售公共元数据批量会话契约仍未实现；库存 500 货品消费批次与完整组装成本保留，没有提高上限绕过。
- 销售首批与品类翻页/排序改善，但渠道冷首次约 2.24 秒；完整重入和部分首入有退化，不宣称每个动作更快。
- 市场大范围榜单/报告/未确认价仍慢或超时；比较忽略日期和原始来源重复累加、趋势截断标记的预存口径缺口没有在本性能组合改业务规则。
- 当前未启用缺可靠身份/权限/版本见证的通用 GET 池；未完成真实后端排队分段、后台争用、生产 P95、长期 RSS、任意范围和真实图片端到端性能验收。

这些限制必须随候选交付，不将全页面隔离功能覆盖、组合代码通过或源码合并冒作所有子版块性能达标。正式采用须用户对具体候选另行批准；采用时继续执行原备份、独立恢复、维护、Finalize、唯一 Start 和业务验收门禁。
