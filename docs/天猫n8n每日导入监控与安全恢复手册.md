# 天猫 n8n 每日导入监控与安全恢复手册

本手册用于复用 TERUISI 天猫店铺每日数据链路的发布核验、运行监控、异常诊断、最小修复和安全恢复。它适用于值班人员与 Codex；不授权绕过 n8n 直接执行下载、导入或平台业务点击。

当前本机发布实例固定为以下六店。值班必须从店铺注册表重新解析浏览器资源，不能照抄另一店的 Profile、端口或店铺身份。

| 计划 | n8n workflow ID | 店铺注册键 | 店铺 | 仓库模板 | 调试端口 |
| --- | --- | --- | --- | --- | ---: |
| 13:30 | `M4xY8kQ2vR6sT9pC` | `tmall-yijiu` | 天猫-志高亿玖专卖店 | `tmall-yijiu-sycm-cookie-daily.workflow.json` | 9334 |
| 13:40 | `TmallLiliDaily2026` | `tmall-lili` | 天猫-志高丽力专卖店 | `tmall-lili-sycm-cookie-daily.workflow.json` | 9325 |
| 13:50 | `TmallTuofengDaily2026` | `tmall-tuofeng` | 天猫-志高拓丰专卖店 | `tmall-tuofeng-sycm-cookie-daily.workflow.json` | 9327 |
| 14:00 | `TmallCuizhiwangDaily2026` | `tmall-cuizhiwang` | 天猫-志高炊之王专卖店 | `tmall-cuizhiwang-sycm-cookie-daily.workflow.json` | 9329 |
| 14:10 | `TmallMasituDaily2026` | `tmall-masitu` | 天猫-志高马思图专卖店 | `tmall-masitu-sycm-cookie-daily.workflow.json` | 9331 |
| 14:20 | `TmallYiyongDaily2026` | `tmall-yiyong` | 天猫-志高亿用专卖店 | `tmall-yiyong-sycm-cookie-daily.workflow.json` | 9328 |

六条流程均使用 `Asia/Shanghai`，共享 `127.0.0.1:5791` 的原子协调门禁；调度可以同时处于等待状态，但 A→B→C→P→M 业务阶段只能串行。

## 1. 不可越过的边界

- 每次真实执行都必须由 n8n 创建完整 workflow execution，并在 A 前通过原子协调接口领取 helper；未获授权时每 5 分钟等待，累计 72 次、约 6 小时后失败关闭。领取成功后按 `A→B→C→P→M` 串行运行，A 是唯一进入业务计划和浏览器阶段的入口。
- 监控与恢复人员不得直接调用 helper 的 `/plan`、`/fetch`、`/import`、`/promotion`、`/product-master` 或其他天猫业务接口，也不得直接运行下载或导入脚本代替 n8n。
- 允许直接读取 `/health`，因为它只返回阶段、忙碌状态和非敏感就绪状态。不得把“helper ready”解释为平台登录有效或数据已经导入。
- 不得单独重跑 B、C、P 或 M；修复后只能从 n8n 启动新的完整 execution。导入接口的内容幂等负责处理已经成功发布的事实。
- 不得删除、重置或绕过已经发生业务点击的活动清单。`export_submitted`、`export_confirmed`、`downloaded` 和推广的已提交状态必须按原店铺、原日期、原任务安全续接。
- 账号密码不得进入 n8n、注册表、环境变量、命令参数、日志、文档或 Git。自动登录只允许使用当前 Windows 用户绑定的 DPAPI 密文，并且最多提交一次。
- 验证码、滑块、短信、安全验证、店铺身份不一致、下载任务歧义或无法安全续接时必须失败关闭并转人工处理。
- 每轮只关闭注册表中本店调试端口对应、且由该 execution 启动的 Chromium。不得扫描、复用或终止其他 Chromium 实例。
- 需要重启本地 Worker、n8n 或 helper 时，先核验精确进程与端口，并遵守仓库服务授权门禁；未获当前对话授权不得停止或重启服务。

## 2. 每日监控标准流程

### 2.1 运行前核验

1. 读取 `README.md`、`AGENTS.md`、本手册、`config/tmall-store-accounts.json` 和当前工作流模板。
2. 检查 `git status --short`。工作区已有改动属于用户，不得覆盖、格式化、暂存或提交无关文件。
3. 逐店比较 n8n 当前版本及 `activeVersionId` 对应已发布历史与各自仓库模板的 `nodes`、`connections` 和 `settings`。模板保留 `active=false` 是正常的；实际发布实例的启用状态单独核验。
4. 确认六店恰好各有一条 active 日调度，时区均为 `Asia/Shanghai`，cron 按亿玖、丽力、拓丰、炊之王、马思图、亿用依次为 `30 13 * * *`、`40 13 * * *`、`50 13 * * *`、`0 14 * * *`、`10 14 * * *`、`20 14 * * *`；不得残留第二条 active 天猫业务流水线。定时和手动入口都先进入 `领取共享 helper → helper 领取成功？` 门禁，授权后节点顺序为 `A→B→C→P→M`。
5. 从注册表逐店解析 `shopName`、`executablePath`、`userDataDir`、`profileName`、`profileDir`、`debugPort` 和 `downloadDir`，并确认资源互不重复；不得回退到默认 Chrome、旧 `.runtime` profile 或另一店铺配置。
6. 只读核验 `5678`、`5791` 和六店调试端口。空闲时调试端口都应关闭；执行中只允许由当前 execution 占用对应店铺端口。

可直接使用的非业务健康检查：

```powershell
Invoke-RestMethod http://127.0.0.1:5791/health
Get-NetTCPConnection -State Listen -LocalPort 5678,5791,9325,9327,9328,9329,9331,9334 -ErrorAction SilentlyContinue
```

### 2.2 13:32 起的六店监控判定

- 13:32 先查 13:30 的亿玖 execution，随后守候 13:40、13:50、14:00、14:10、14:20 五条触发；逐店记录当日 `mode=trigger` execution ID 与固定店铺键。`enabled=false` 店铺不应出现 active 调度。
- 若某店正在运行或在 A 前等待 helper，持续监控到终态；协调等待是六店串行门禁的正常状态，不以此创建重复 execution。
- 若到某店计划时间后 5 分钟仍无当日 `mode=trigger` execution，检查同一 workflow ID 的当前发布版本、启用状态、trigger 注册、时区和 n8n 服务；不得新建同名副本或并发业务流水线。
- 任一阶段失败时，先保存 execution ID、店铺、目标业务日期、失败节点、脱敏错误、活动清单阶段和浏览器所有权，再决定是否可自动恢复。单店失败后仍要继续核验其余五店；只有 helper 未安全释放时才把后续等待视为同一阻塞链。

## 3. 五个节点的完成证据

| 节点 | 必须确认的事实 |
| --- | --- |
| A | execution owner 已领取；受控店铺与浏览器配置匹配；登录和可见店铺身份通过；目标日期按上海时区固化。 |
| B | 只下载计划内单日 XLS；店铺、唯一业务日期、表头、魔数、大小、行数和 SHA-256 校验通过。 |
| C | 签收单与文件一致；导入返回 `imported/completed` 或经完整业务内容指纹确认的 `duplicate`；来源、数据集、平台、店铺、日期、行数和覆盖回查一致。 |
| P | 仅在同日商品日已签收导入后执行；单日 ZIP 内唯一商品 CSV 校验通过；推广批次、行数、零告警和商品日/推广日交集覆盖回查一致。 |
| M | 货品 XLSX 的店铺、快照日、发布模板、结构、行数和哈希通过；货品批次 completed/duplicate 且落库回查一致；本轮受控 Chromium 已关闭。 |

整个 execution 只有在五个节点都成功且浏览器关闭后才算完成。M 位于末段；M 失败不会回滚已完成回查的商品日和推广事实，但整个 execution 仍必须标记失败，不能通知“全部完成”。

## 4. 异常分类与最小处理

### 4.1 没有当日 execution

- 核验现有 workflow ID，而不是创建同名副本。
- 若发布版本漂移，先找出模板与 live `nodes/connections/settings` 的精确差异；确认后更新同一工作流。
- trigger 修复后，从 n8n 启动一个新的完整 execution，并继续使用新的 execution ID 绑定 helper owner。

### 4.2 helper 离线或忙碌

- `/health` 离线时只读核验 `5791` 的监听进程、父进程和启动命令。
- 端口被未知进程占用时失败关闭，不得按端口号盲目结束进程。
- 只有得到服务重启授权并确认目标是本项目 helper 后，才允许重启；不得顺带重启 n8n 或本地 Worker。
- `busy=true` 时核对 owner execution，禁止跨 execution 接管。

### 4.3 登录或店铺身份异常

- 注册表为 `loginMode=windows_dpapi_credentials` 时，A 只允许解密、填入并点击登录一次；这里的“提交”就是一次登录提交。
- 凭据缺失或需要修改时，由操作者交互执行：

  ```powershell
  npm run tmall:credential:setup -- -StoreKey <store-key>
  ```

- 需要人工登录、验证码或安全验证时，只启动对应店铺的可见受控浏览器：

  ```powershell
  npm run tmall:login -- --store-key <store-key>
  ```

- 登录后必须再次核验页面可见店铺名，不能在其他店铺 profile 或凭据项上重试。

### 4.4 C 或 P 在导入后覆盖回查失败

- 先只读查询精确批次，区分“导入未发生”和“事实已发布但回查请求失败”。不得仅根据节点红色重复导入。
- 网店表现查询必须使用领域函数生成的复合 `outlet` 身份（平台 + 分隔符 + 店铺），不得回退到旧的单独 `shop` 参数。
- 若精确批次已 `completed`，保留该事实；修复回查契约后从 n8n 启动新完整 execution，由导入接口决定 `duplicate`。
- 当前运营数据回查先遵守 `docs/OPERATIONS_DATA_QUERY.md`；输出要写明数据来源、截止日期、平台、店铺、业务日期、数据集、行数和缺口。

### 4.5 M 货品活动清单

| 清单阶段 | 允许的恢复动作 |
| --- | --- |
| `planned` / `browser_ready` | 尚未发生业务点击；确认无其他证据后可按当前实现安全重建计划。 |
| `export_submitting` | 点击结果未决；必须转人工核对商品管家，不能自动重发。 |
| `export_submitted` | 按原快照、原聊天任务续接，禁止再次发送“导出全部商品”。 |
| `export_confirmed` | 只等待原任务完成卡片或下载记录，禁止新建导出任务。 |
| `downloaded` | 只复用清单绑定且大小、哈希、行数均未变化的原文件。 |
| `completed` | 核验完成证据后才可清理残留；不得影响新执行的店铺隔离。 |

跨日时，已提交、已确认或已下载的旧任务仍绑定原快照日。超时只更新脱敏错误并保留清单，不得把阶段倒退。

平台任务已明确失败，或操作者明确确认某一条旧任务作废时，仍不得直接删除活动清单。只允许使用受控作废入口把 `export_submitted` / `export_confirmed` 清单原样移出活动槽并写入作废时间、原阶段和原因；归档成功后才能从 n8n 启动新的完整 execution。该入口不接受 `export_submitting`、`downloaded` 或自动恢复调用，也不得由超时自动触发。

逐页 M 有一个更窄的专用例外：全部分页任务和文件已绑定、活动清单处于 `downloaded`，且合并前明确报出“唯一商品数少于出售中总数”的内容完整性错误时，操作者可以确认该批分页任务作废。此时只能运行 `node --import tsx tools/tmall-pagewise-audit-admin.ts --action abandon-invalid-downloaded --store-key <store-key> --reason <原因> --confirm`，由工具原子归档原清单并保留全部任务、文件、错误和确认信息；不得删除分页文件。归档后仍必须从 n8n 创建新的完整 execution。该入口拒绝超时、网络错误、缺页、点击未决、页码证据不连续或没有精确内容错误的清单。

### 4.6 浏览器关闭失败

- helper 应在 M 成功或任一节点失败时关闭本 execution 启动的受控 Chromium，并释放注册表调试端口。
- 终态后只读确认本店调试端口无监听。若仍被占用，先确认 PID 与 execution 所有权；不得关闭日常 Chromium 或其他店铺实例。
- 关闭失败时整个 execution 失败关闭并保留清单和审计证据。

### 4.7 亿玖、拓丰和马思图 M 节点逐页导出

- 亿玖、拓丰和马思图各自的 n8n workflow ID、定时、A/B/C/P 和 `/product-master` 接口均不变；只有 M 内部按店铺注册项切换为 `on_sale_pagewise_excel`。不得另建第二条 active 工作流，也不得让两种 M 策略同时创建任务。
- 正常路径按“出售中逐页全选 → 更多批量操作 → excel商品批量导出 → 非末页取消弹窗并下一页 → 末页前往下载”执行。完成证据不是单个文件下载，而是本轮任务数等于总页数、全部任务已完成、全部分页分别校验、合并唯一商品数等于出售中总数，以及合并文件单次导入后的精确批次和落库回查。
- 进入出售中或翻页后，必须围绕唯一“共 N 件商品”锚点读取最近的分页区域，并在有界等待内连续两次得到相同的“商品总数 + 当前页/总页数”后才允许勾选。页面其他区域的页码不得参与身份判断；超时只记录锚点数、候选区域数和脱敏页码元数据，业务点击前失败清单归档为 preflight 证据后释放活动槽。
- “商品标题”表头因固定列或包装节点形成多个可见 DOM 时，只能合并指向同一个空间全选框的等价候选；不同全选框得分并列时失败关闭。点击后必须精确读回当前页“已选 N”，否则不得打开更多批量操作或创建导出任务。
- “下一页”因按钮、外层分页项和图标形成父子 DOM 时，按可操作语义、明确下一页属性和空间位置合并、排序；两个独立入口仍同分时失败关闭。点击后必须稳定读回下一页的页码身份，才能继续勾选和创建下一页任务。
- `page_export_submitting` 表示创建任务点击结果未决，必须人工核对导出记录，不能自动重发；已经记录的分页任务跨日仍绑定原快照继续。记录时间窗内任务多于预期、缺页、明确失败、商品总数变化、分页文件商品数不符或跨页重复都失败关闭。
- 若目标店仍存在原商品管家 `active-<storeKey>.json` 活动清单，新策略必须停止。先按 4.5 核对旧任务；未经操作者明确确认，不得删除、重置或跨模式忽略该清单。三店的逐页清单、下载目录、Profile 和调试端口必须继续相互隔离。

## 5. 安全恢复步骤

1. 收集当前 live workflow、execution、helper、店铺注册项、活动清单、签收单和精确导入批次的只读证据。
2. 判断失败发生在业务点击前、点击未决、已提交、已下载、已导入还是仅回查失败。
3. 只做能解释当前证据的最小修复。源码或配置缺陷使用 `apply_patch`，并增加失败、重试、重复、跨店、日期覆盖、活动清单或回查的负向测试。
4. 运行相关聚焦测试，再运行 `npm run test:unit`、`npm run lint` 和 `git diff --check`。不得为了文档或脚本测试重启正在监听 `dist` 的本地 Worker。
5. 若修复需要 helper 重新加载代码，先取得重启授权并精确重启 helper；n8n 与本地 Worker保持不动，除非证据明确要求且另有授权。
6. 在已登录的 n8n 正式页面启动一个新的完整 workflow execution。不得直接请求 helper 业务接口，也不得单节点执行。
7. 监控新 execution 到终态，逐项回查 A/B/C/P/M 和受控 Chromium 关闭状态。
8. 只暂存本任务文件，创建聚焦提交并推送；不得带入用户已有改动、下载文件、凭据或运行产物。
9. 发送成功、异常或恢复通知。若通知账号认证失效，停止重复发送并在当前任务明确要求重新认证。

## 6. 钉钉通知最小模板

通知只发送给每次查询得到的当前唯一账号自身单聊，不猜测或持久化 userId。正文不得包含 Cookie、Token、账号标识、本机路径或原始业务数据。

```markdown
## 天猫数据导入异常

- 上海时间：YYYY-MM-DD HH:mm:ss
- n8n execution ID：<id>
- 店铺：<shopName>
- 阶段：A/B/C/P/M
- 目标业务日期：YYYY-MM-DD
- 脱敏结果：<error>
- 需要人工操作：是/否（说明唯一下一步）
```

恢复成功使用标题“天猫数据导入已恢复”，完整成功使用“天猫数据导入完成”。所有 dws 命令使用 `--format json`；认证失效后不得循环重试。

## 7. 新增店铺复用清单

1. 先以 `enabled=false` 在 `config/tmall-store-accounts.json` 注册唯一 `storeKey`、精确 `shopName`、`initialStartDate` 和完整浏览器配置。首次登录命令允许读取该停用注册项，但业务节点仍会拒绝它。
2. 每店使用独立 `userDataDir`（优先）或至少独立 `profileName/profileDir`，并使用唯一 `debugPort`、`downloadDir`、签收单、恢复清单和 DPAPI 凭据项。`profileDir` 必须精确等于 `userDataDir/profileName`。
3. 交互录入该店凭据，打开该店受控浏览器完成首次登录和必要安全验证，并从页面精确核验店铺身份。
4. 确认货品、商品日和推广三个阶段都只从同一注册项解析浏览器与店铺信息；n8n 协调节点和 A/B/C/P/M 全部发送相同的 `X-TERUISI-TMALL-STORE-KEY`，helper 将它与 execution ID 绑定。禁止硬编码亿玖店或回退默认 profile。
5. 补跨店隔离、凭据错配、端口冲突、下载目录冲突、清单错接和批次跨店重复的负向测试。
6. 先执行无业务副作用的预检；再将店铺启用并导入其默认 `active=false` 的工作流模板。每店可以有独立 n8n 模板，但所有模板必须使用同一协调门禁串行业务阶段；不得创建绕过门禁、会并发点击或并发导入的第二条流水线。
7. 只有人工确认该店千牛、生意参谋和阿里妈妈身份均正确后，才设置 `enabled=true` 并单独发布该店调度；每个启用店铺只能有一条 active 日调度。

## 8. 交付与状态汇报

每次监控或恢复结束时逐店报告；六店汇总不得用一店成功替代其他店状态。至少包括：

- n8n execution ID、店铺、目标业务日期和总体终态；
- A/B/C/P/M 各节点状态；
- 文件、批次、行数、告警、日期覆盖和落库回查结果；
- 是否发生新业务点击、是否保留活动清单、是否需要人工操作；
- 受控 Chromium 是否已关闭；
- 代码/配置变更、验证、提交与推送状态；
- 未执行的生产部署、迁移、远程数据操作或服务重启；
- 通知是否发送；若失败，说明认证或发送错误。

“任务已创建”“下载成功”“节点显示成功”都不能替代上述完成证据。
