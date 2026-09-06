# 吉客云 n8n 五表先导出后导入

工作流：`automation/n8n/jackyun-five-dataset-daily.workflow.json`，名称“吉客云导入系统”，沿用 ID `J8kY2mQ5vR7sT4pN`。默认手动运行、未激活，不含定时器。配套策略为 `config/jackyun-export-first-policy.json`，协议版本 `2026-09-06.export-first.1`。

## 节点与业务口径

| 阶段 | 操作 | 完成条件 |
| --- | --- | --- |
| 协调 | 领取共享 helper | 与京东、天猫等流程串行；最多等待 6 小时 |
| A | 固定本轮上海日期 | 库存采集日为今天；销售截止为昨天 |
| 1 | 分仓库存查询 → 筛选 → 右键 → 导出所有页 | 全仓范围、成功查询响应、精确行数、当轮下载 |
| 2 | 组合装查询 → 筛选 → 右键 → 导出组合装及子件 → 导出所有页 | 母件与子件双表，母件总数和关系覆盖完整 |
| 3 | 销售单明细账 → 发货时间 → 本月 1 日至昨天 → 筛选 → 右键 → 导出所有页 | 时间类型和起止时间逐项读回 |
| 4 | 库龄分析 → 筛选 → 右键 → 导出所有页 | 成功查询响应、真实数据行、当轮下载 |
| 5 | 货品查询 → 规格模式（SKU）→ 筛选 → 右键 → 导出所有页 | SKU 模式读回、货品表头和总数完整 |
| 6 | 全部文件校验及导入演练 | 五表齐全；无业务写入地完成全部正式解析、过滤、成本匹配和组合装基线校验 |
| 7 | 统一导入运营管理系统 | 按货品 → 库存 → 库龄 → 销售 → 组合装执行，使用当前 Django 公开接口 |
| 8 | 独立回查 | 五个精确批次完成，事实归属、日期、行数、原文件与业务内容摘要一致 |

销售采用用户第 3 张截图的普通“导出”菜单；“导出组合装及子件”用于组合装模块。每月 1 日沿用既有销售导入口径处理上月整月，避免形成逆序日期范围。

分仓库存继续使用完整公司仓库范围；导入副本沿用正式过滤规则，保留原始文件。库存及库龄是实际采集日的当前查询结果，不能标成昨天的历史余额。旧 `jackyun:daily` 历史快照协议继续要求真实历史日期控件，不能通过新模式降级旧证明。

## 使用与发布

1. 在隔离 worktree 完成相关测试、helper 构建和审查。
2. 将 JSON 导入现有同 ID 工作流并保存草稿；不要创建另一个同名的自动调度副本。
3. 配套 helper 必须经过项目受控发布，支持 `/jackyun/export-first/` 的 plan、五个 export、validate、import、verify 路由。仅导入 JSON 不会升级运行中的 helper；旧 helper 会返回 404，不能据此开始业务导出。
4. 正式服务发布、停止或重启仍遵循 `AGENTS.md` 和现有 Worker successor 流程，不能直接替换运行目录或绕过 immutable release。
5. 专用 Chrome 登录使用 Windows DPAPI：先运行 `npm run jackyun:credential:setup` 在本机录入，再用 `npm run jackyun:credential:status` 检查保存结果。纯登录验证使用 `npm run jackyun:authenticate`；遇到验证码或安全验证时停止，由操作者使用 `npm run jackyun:login` 处理。账号、密码、Cookie 和会话不进入 n8n。详见 `docs/吉客云DPAPI登录配置.md`。
6. 发布后从“手动运行”启动完整工作流，最后节点完成才算成功。保存工作流、文件下载完成或导入响应成功都不能代替最后核验。

重新生成模板：`node tools/generate-jackyun-export-first-workflow.mjs`。

## 证据与失败处理

- 原文件：`D:\谷歌浏览器\jackyun\<RUN_ID>\<module>\`；事件：`outputs/jackyun-browser-events/<RUN_ID>/`。
- 运行计划：`outputs/jackyun-export-first/<RUN_ID>.json`；当轮 ID 由真实 n8n execution ID 派生。
- 无业务写入的预检结果：`outputs/jackyun-export-first-validation/<RUN_ID>/`；正式导入及归档：`outputs/jackyun-import-runs/<RUN_ID>/`。两者分离，不能把 `prepared` 改成 `completed`。
- 导出步骤乱序、文件或交接 SHA 变化、缺表、跨日、其他 execution 接管、未完成运行重复创建均停止。仅协调领取自动重试；业务节点不进行盲目自动重放。
- 同一 execution 对已签收导出节点的重试只重验文件，不重复点击导出，也不会把导入阶段倒退。已记录导出 intent、尚无下载的节点只能恢复原任务的下载证据；不能重新创建导出任务。
- 中断后保留原运行。不能直接删除 active 清单或改 execution ID；先核查原阶段、原文件、导入尝试及精确批次，再决定受控恢复。尚未提供跨 execution 自动接管。
- 导入接口使用规范化业务内容幂等。新协议使用服务端返回的精确批次及业务摘要，允许内容相同但 XLSX 字节不同的 `duplicate`；不得再把当前批次号假设成原文件 SHA。
- 五表导入不构成跨领域的单一事务。后续模块失败时保留前面已完成批次并停止，禁止为“回滚工作流”删除已发布业务事实。

## 验证边界

仓库测试使用临时目录和合成工作簿验证顺序、跨日、缺文件、证据变化、并发、重复和批次回执。真实吉客云菜单、登录状态及正式五表导入仍须在配套 helper 发布后进行验收，不能把夹具通过表述为生产跑通。

2026-09-06 已将 15 节点新版保存至本机上述工作流草稿，刷新后下载回读的业务节点、参数及连线与模板一致；等待节点的 n8n 默认值已从页面读回为 5 分钟，工作流保持未激活。旧画布已在隔离工作树的 `outputs/n8n-before-change/jackyun-original.json` 保留副本。

首次草稿的隔离验证结果：全量单元测试 1,854 项通过、23 项跳过、0 失败；lint 为 0 错误、9 项原有警告；配套不可变 helper 构建及 42 项发布测试通过；Django 生产边界检查通过。额外 TypeScript 全库检查仍有 141 项既有诊断，与当时基线按文件、错误码和消息逐项对比没有增加或减少，不能宣称全库类型检查通过。该次草稿阶段没有发布服务或执行真实导入；后续实际采用记录如下。

## 2026-09-06 受控发布及一次试跑

用户明确确认发布并试跑一次后，已合入最新 main 的天猫改动，再将本功能以 `c0e7f9ca11d190f5d0716c2905f8803bace17e8d` 合入 main。执行器根目录改为由既有 helper 显式传入，保持受保护 builder 和 release verifier 不变，未更改 Django 数据库结构或写入 authority。

- 集成验证：1,882 项单元测试中 1,859 项通过、23 项跳过、0 失败；lint 为 0 错误、9 项既有警告；Django 生产边界、生产构建和 20 项渲染检查通过。此处不把历史 TypeScript 差异检查表述为当前全库类型检查通过。
- 发布前备份：`daily-20260906T084255Z-cb9e25ccc4b2`，manifest SHA `246a61ba3c1f195ecbcdf6269a07801e2b09289bcffc1dd88ccfda761f383f5c`；备份复验和恢复演练 `06bb2570b113` 均完成，原始/恢复内容 SHA 一致。演练使用独立端口 `55641`，未写入生产数据库、未改变数据库服务状态。
- Worker/helper 已通过停止旧服务、精确 plan SHA 授权 apply 和受控启动采用 release `20260906T085035Z-568a59bc151c39d7`；manifest SHA 为 `bff4704bd7a1d83f6201f6ba5cd101b93f7a662c171939563685041a0db42a20`，plan SHA 为 `baa01dc4982b34cc296d76c8af2374553c98afca7ed4e3e040d31669a951274b`，successor SHA 为 `061236c4991cc9dd27fbe4275511fffe888bb31f3d111b017874ef21c7858e99`。启动绑定、精确 release、首页和后端 readiness 已回读通过。
- 启动 CLI 出现服务已就绪但等待进程未返回的异常。核验该启动器的 PID、创建时间、精确命令、零直接子进程及服务健康后，只结束该孤立等待进程；随后官方 Status 为 `Running / Ready / exact_release`。不能把该 CLI 的退出结果记成正常成功，也不能据此再次重启已经健康的服务。原始回读和处理证据保存在隔离工作树 `outputs/validation/launcher-return-recovery.json` 与 `post-release-system-status.json`。

仅从 n8n 画布点击了一次完整执行，真实 execution 为 **841**，运行 ID 为 `n8n-export-first-841`，采集日为 `2026-09-06`，销售截止为 `2026-09-05`。领取 helper、条件判断和日期计划成功；第一个分仓库存节点返回 HTTP 500 / `PIPELINE_FAILED`，具体错误为 `inventory 导出未完成：login_unknown`。后续四次导出、全部文件校验、导入和独立回查均未执行，不能宣称五表链路已跑通。

失败发生在专用浏览器登录状态判断处，早于模块导航、筛选、导出及 controller 状态写入。四类当轮目录（浏览器事件、下载、验证、正式导入）均不存在，计划 `exports` 为空。保留了原始计划和 `active.json`，未删除清单、改写 execution ID 或再次触发整轮任务。后续新的 execution 会因原运行未闭合而停止，恢复前必须先处理原运行证据，不能直接点击重新运行。

试跑后辅助服务为 `ready`、`busy=false`、无活动 owner；后端为 `django-postgresql / ready`。销售只读健康检查仍为 revision `14:10`、覆盖截至 `2026-09-03`，与试跑前一致。日常 Chrome 的已登录页面不代表自动化独立 profile 已认证；现有错误无法区分专用登录失效与页面尚未加载完。代码在调试端口就绪后立即探测一次登录，是需要继续验证的时序风险，尚未确认它就是本次根因。

后续验收需先检查专用 profile 的页面加载与登录识别，必要时通过既有专用登录入口完成人工验证，再按原运行证据设计受控恢复。不得绕过 n8n 改为直接生产导入，不得把登录检测失败误报成导出成功或数据已同步。工作流继续为手动入口，未启用日调度。
