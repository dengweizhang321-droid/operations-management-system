# 第 6 项：Wrangler 自检稳定性

日期：2026-09-29（Asia/Shanghai）。基线：`e00d4a82b2480d05646f5e0b65b13e9a2cc6bb7e`。

本项仅开发与隔离验证，未生产采用。按照本轮并行约束，不修改总评估文档、README 或 AGENTS，不合并 main；由用户指定的统一收尾对话更新第 4.6 节和合并状态。

## 状态与协作边界

| 状态 | 结论 |
| --- | --- |
| 问题复现 | 无响应版本请求导致 put 已完成仍不退出；长 R2 存储路径另有独立失败 |
| 源码候选 | 保留原自检，约束横幅更新请求，增加阶段、耗时、真实退出及失败证据 |
| 生产采用 | 未执行；正式依赖、配置、缓存、调度、数据库和服务未改 |
| 运行验收 | 隔离验证见下文；不能替代正式候选准备及采用验收 |

分支：`codex/wrangler-self-check`。本任务 worktree：`D:\.codex\worktrees\wrangler-self-check\运营管理系统`。

公共重叠文件是 `tools/django-local-service.ps1`，可能同时被第 4 项发布协调及第 7 项启动优化修改。本分支只改 Wrangler 调用及自检函数，不改锁、维护、启停、部署交换或发布入口。建议其他任务负责生命周期区域，统一合并时逐块复核该文件并再次运行原部署回归。没有依赖其他优化分支的提交；package.json / package-lock.json 均不变。

## 锁定版本与历史证据

- package.json、package-lock.json 和隔离 npm ci 的 Wrangler 均为 **4.92.0**；Node 为 **24.18.0**。使用原 `Copy-WranglerRuntimeClosure` 按锁文件复制依赖，不复制正式凭据、数据库或 R2 状态。
- [9 月 20 日证据](evidence/market-query-watchdog-production-20260920.json)记录两次 `Upload complete` 后不退出、原 30 秒门禁失败，刷新真实官方 npm 元数据缓存后完整通过。这是相关线索，不足以认定所有历史故障同源。
- [9 月 17 日证据](evidence/warehouse-mapping-production-20260917.json)记录相同 put 后不退出，正常停止本任务隔离预览后原自检 9.151 秒通过；仍缺当时分阶段与资源时间序列，无法区分负载、路径和网络。
- 已核对本地锁定包源码及 [Cloudflare 4.92.0 标签的横幅源码](https://github.com/cloudflare/workers-sdk/blob/wrangler%404.92.0/packages/wrangler/src/wrangler-banner.ts)。`WRANGLER_HIDE_BANNER=true` 使横幅函数在调用 `updateCheck()` 前返回。`CI=1` 和 `WRANGLER_SEND_METRICS=false` 原本已存在，实测它们不能阻止横幅版本请求。
- 锁定包的 `update-check@1.5.4` 请求超时仅拒绝 Promise，未销毁请求；外层 3 秒 Promise.race 和 100 ms 横幅等待也不取消请求。无响应 socket 能继续维持进程存活。这是本次受控复现解释，不倒推为全部历史故障的唯一根因。

## 隔离方法与结果

诊断入口：`node tools/diagnose-wrangler-self-check.mjs`。每次在本 worktree 的唯一 tmp 子目录写入合成对象，使用独立 TEMP/TMP、配置、日志、R2 SQLite/对象存储和动态 loopback 测试服务器端口。真实 npm 缓存只读取或逐字复制；有效缓存由真实 CLI 联网生成；过期缓存必须是原已过期文件，缺少时拒绝伪造。未发送云端 R2 请求、消息或部署。

测试观察器只记录 Node preload、版本请求开始/响应结束/超时/关闭/退出的时间和 PID，不更改响应或退出码。另记录首次输出、完成消息、CLI 退出、SHA 校验耗时、逐命令整机 CPU 忙碌比例与可用内存。无响应服务器不返回假版本。正常 R2 命令保持 30 秒、version/help 保持 15 秒；所有场景串行，不新增 CPU 压力、恢复演练或大型应用构建。

第二轮完整矩阵的结果如下；数值为本机该轮样本，不是长期 P95 或生产承诺。

| 场景 | put 完成消息 | put 进程结束 | 结果 |
| --- | ---: | ---: | --- |
| 无缓存、真实 npm | 2.314 秒 | 24.903 秒 | 完整往返通过 |
| CLI 生成的真实有效缓存 | 1.276 秒 | 1.310 秒 | 完整往返通过 |
| 原真实过期缓存、真实 npm | 1.839 秒 | 24.291 秒 | 完整往返通过 |
| 无缓存、无响应 registry、原设置 | 1.425 秒 | 原 30 秒超时 | 被终止，不记成功 |
| 相同无响应 registry、隐藏横幅 | 1.396 秒 | 1.426 秒 | 完整往返通过，零版本请求 |
| 中文空格中等路径、隐藏横幅 | 1.363 秒 | 1.396 秒 | 完整往返通过 |
| 长路径、隐藏横幅 | 无完成消息 | 3.761 秒，exit 1 | put 失败，`Network connection lost` |
| 保持长工作目录，仅缩短 R2 存储路径 | 1.498 秒 | 1.534 秒 | 完整往返通过 |
| 隐藏横幅重复轮 | 1.397 秒 | 1.433 秒 | 完整往返通过 |

首轮也观察到真实无缓存/过期缓存约 24.0/23.5 秒退出、原设置无响应请求超时、候选短路径成功及长路径失败。第二轮各场景命令期间 CPU 忙碌比例为 16%–76%；记录自然负载变化，没有制造压力。负载不可完全控制，不能据此给出独立的负载因果结论。

长路径对照中工作目录 166–169 字符，失败 persist 路径 171 字符，改为 89 字符后成功。已定位到存储路径相关性，但没有证据把底层原因精确归为某个 Windows API 或固定 MAX_PATH 阈值，因此没有修改正式存储路径或全机长路径设置。路径失败继续失败关闭，部署不得以缩短正式业务存储路径来绕过证据。

隐藏横幅不是全局禁网：锁定版本在某些真正的 CLI 错误/配置警告路径仍可能发起更新提示。长路径错误就记录了一次此类请求。候选不会跳过错误、伪造缓存或把该类失败认作完成。

## 最小源码改动

1. 仅在原 `Invoke-WranglerRuntimeProcess` 的子进程环境设置 `WRANGLER_HIDE_BANNER=true`。固定版本 `--version` 精确匹配、help/load、put/get/hash/delete/missing 全部保留；不升级包、不修改全局环境或版本缓存。
2. 复用原有受限、轮换的 launcher 日志，记录阶段、启动/退出/总耗时、是否超时、真实退出码、输出是否完整、输出摘要、完成消息是否出现及路径长度；不记录原始参数、文件内容、凭据或网络 URL。
3. 原 15/30 秒超时不增加。超时仍抛错，即使杀进程后得到了退出码或曾输出 `Upload complete`；未知退出码保留 null。输出收集新增独立 5 秒失败边界，避免退出后无界等管道，不作为业务成功宽限。
4. 将 get 与 hash 结果分开记录，整个自检失败记录精确阶段。删除后要求 CLI 的实际缺失退出码 1、原 `does not exist` 证据且未读到对象字节；Wrangler 会先打开输出文件，零字节文件是正常行为。
5. 继续使用原 runtime/run 唯一 smoke 目录、路径校验及 finally 清理。不改变 `PrepareApp`/`DeployApp` 的候选前置校验或旧正式 app 保留规则。

## 验证记录

- 原函数 + 原依赖闭包：PowerShell 7.6.5 连续 3 轮、Windows PowerShell 5.1 连续 3 轮完整往返通过，每轮 6 个 CLI 阶段及独立 hash，missing 保留 exit 1。
- 最终补充路径长度/完成消息诊断字段后，两种 shell 各追加 1 轮真实通过，总计 8 轮；最终 ESM 观察器矩阵再次完成 9 个场景，原设置超时、候选完整成功和长存储路径失败/短存储恢复均重复出现。
- 双 shell 负向验证：真实进程 exit 7、真实进程启动失败、真实超时；合成故障覆盖 put、get、hash、delete、missing 错误退出码、错误消息、错误成功和意外对象字节。均失败关闭并保留阶段，没有成功回执。
- 原 `tests/django-local-service.test.ts`：38 项通过；新增 `tests/wrangler-self-check.test.ts`：2 项通过，分别调用两种 shell 的负向测试。
- Django 生产边界检查：544 模块、0 违规。
- Lint：0 错误、12 条既有警告；Node 语法及 `git diff --check` 通过。本项未改变应用构建图，不进行大型前端构建；原锁定 Wrangler 闭包的构建复制和实际运行已验证，统一合并时仍需组合构建及发布验证。
- 全量单测以 `node --import tsx --test --test-concurrency=1 tests/*.test.ts` 串行完成：2,656 通过、4 失败、23 跳过，耗时 815.040 秒。4 处失败都来自 worktree 初始缺少 `.runtime/test-venv/Scripts/python.exe` 的两组 Python/TypeScript 契约测试；建立本任务独立 venv 后，四个受影响文件合计 46 项全部复测通过。未修改这些业务文件，也未重跑已通过的其余测试；不把首轮报告改写为全量一次全绿。23 项跳过保持原报告语义，包括无前端构建产物的 bundle 门禁。
- 最终矩阵、全量测试、lint 和提交状态见本文件收尾记录及 [脱敏证据](evidence/wrangler-self-check-candidate-20260929.json)。

复测命令：

```powershell
node tools/diagnose-wrangler-self-check.mjs
pwsh -NoProfile -File tests/django-wrangler-self-check.test.ps1 -Mode real -Rounds 3
powershell -NoProfile -ExecutionPolicy Bypass -File tests/django-wrangler-self-check.test.ps1 -Mode real -Rounds 3
node --import tsx --test tests/wrangler-self-check.test.ts tests/django-local-service.test.ts
```

这些命令只用于独立 worktree；真实验证脚本创建独立 `D:\wrangler-test-<GUID>`（以 worktree 所在驱动器为准），日志和闭包暂留作为核验证据，不对正式 runtime 执行 Deploy/Prepare/Start。`-Mode negative` 的合成退出不冒充真实 R2 成功。

## 交给统一收尾的采用与回滚方案（尚未执行）

1. 统一收尾合并各项后，重点复核 `tools/django-local-service.ps1` 的重叠修改，重跑本项双 shell 测试、完整真实矩阵、原部署回归及组合验证。Wrangler 版本若变化，重新核对开关语义；不得直接沿用本次数据。
2. 在线准备阶段用原受保护流程生成候选，在正式路径条件下完成全部原 R2 门禁；失败保留当前正式 app，保存阶段日志。候选准备也须服从用户最终安排，不由本分支擅自启动。
3. 用户确认具体版本、维护窗口和回滚方案后，按现有发布流程验证备份及恢复点、排空任务、采用候选、核验完整应用摘要/12 组件/启动绑定与自然运行。本项没有新增数据库迁移、调度、凭据、端口或依赖升级。
4. 采用前失败直接弃用候选，不改正式入口；采用后异常按原已验证前驱及受保护 `RollbackApp`/唯一生命周期引擎回滚，不手改不可变安装文件、不用假缓存救场、不提高超时强行放行。回滚及启停同样须获具体授权。

本分支只交付源码、验证、证据和远端提交，等待用户指定会话统一合并与安排上线。

## 提交交付

本项所有源码、测试、独立说明和脱敏证据提交到 `codex/wrangler-self-check` 并推送同名远端分支；提交号以 Git 分支头为准，避免在提交内容内自引用。未合并 main，保留 worktree 供统一组合验证。源码改动只有公共控制器中的 Wrangler 函数；其余新增文件均属于本项测试、诊断和文档。后续无需先合并其他优化分支，但共享控制器冲突必须在统一收尾解决。
