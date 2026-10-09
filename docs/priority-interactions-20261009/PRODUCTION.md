# 四项交互修复生产采用与收尾记录

2026-10-09。精确候选已采用，四项正常只读操作复验通过，原严格批次 16/16 项最终 passed、未决操作 0，UTC `12:26:02.677Z` 完成并释放发布所有权。前后完整备份、隔离恢复和最终就绪已闭合；运行中仍发现代理退出及守护探针风险，见下文，不能宣称系统已无性能或稳定性问题。批准前状态见[候选记录](CANDIDATE.md)，开发及隔离回归见[修复报告](REPORT.md)。本次只采用四项优先修复，全面审查中的其他问题未因此消除。

## 授权、范围与版本

用户明确确认 `38ccd183…ad5dc`。实际批准时间为上海 **2026-10-09 17:19:39**（UTC `09:19:39.000Z`），取自实际人类 turn `startedAt=1791537579`，精度为秒。全部续接沿用此起点，不能重置为最后一次执行时间。

采用目标为本机正式系统的原不可变 Worker/Django/PostgreSQL 链路，浏览器验收入口为 `http://127.0.0.1:3000/`。本记录不推定其他远端环境已同步采用。

| 项目 | 精确绑定 |
| --- | --- |
| V2 批次 | `38ccd1838ffe2fb6503a4c4fd067c4d090b4ba08a4333b529796d4dca64ad5dc` |
| 生产源码 | `01a0ea6de9bfc1237a761f927fff068eb55d6e41` |
| 前驱 Worker | `20261009T030646Z-9f93e52aa005de7c` / manifest `a083c4c2…` |
| 新 Worker | `20261009T080026Z-d5fb5b62de630ae2` |
| 新 manifest | `01590c5698c6b68e996c7d2963b94cbf35b109205bd4e0e3993e5a6d991c4d78` |
| Worker plan | `61644f5301a2ae139cc6478fca6d4072a6357bdd48ef0912c67c79f52a22dcff` |
| Django 包 | `237fbe0de6e4fbab6b80389298ba1b8a5951b5aaf213c250ad3ee9f590010ab9`，包未更换 |

以已采用源码 `22496380` 为内容基线，实际全源树仅 `app/page.tsx`、`app/customer-service-view.tsx`、`app/ui/stable-read-content.tsx`、`app/globals.css` 四文件变化。修复已合入 main；精确生产组合分支只保存现场内容，不整棵反向合入 main。API、backend、lib、依赖清单、helper 与前驱保持，n8n 定义及调度不修改，D1 不参与本次正式链路。

维护沿原唯一生命周期入口，排空并保留 PostgreSQL，停启 Django 应用服务；不能描述为只停 Worker 或全程无停机。本次发布与验收未触发生产数据恢复、迁移、真实导入、模型任务或外发；维护期间原自然调度的业务结果不在本次证据范围。

## 实际 UI 验收

使用封存的 `production-ui.mjs`，在实际 `app/page.tsx` 与新包的 CSS/业务组件上进行正常只读操作，非另建简化页面。新浏览器上下文，Chrome headless、1440×1000，GET 限于本机生产；所有非 GET 均禁止。完整复验 UTC `11:29:22.734Z` 结束，80 个请求、4 组通过、生产写入 0、不持久化客户详情；6 个非当前 origin 的 GET 被阻止，此上下文不能证明那些资源的正常展示。

| 修复 | 线上检查及结果 | 深层证据边界 |
| --- | --- | --- |
| 自定义日期取消仍改变查询 | 编辑近 7 天草稿，取消按钮、Escape、外点三种关闭均保持原期间标题及 URL | 真实原生输入法、其他页面逐项日期操作未新增生产覆盖 |
| 新客服条件仍操作旧会话 | 选择具体店铺；保留行若存在须在 inert 内；匹配新店铺 GET 200 且行均属该店铺，之后打开及关闭当前会话只读详情 | 生产正常快速请求不保证出现保留旧行；迟到/失败/身份/CAS/旧 AI 边界依据隔离回归，不在生产注入故障或保存 |
| 全局搜索取消后持续忙碌 | A→AB→A 后结束忙碌；清空出现引导页且 busy 为 0；关闭成功 | 此断言不证明搜索响应成功或结果词归属；生产未注入乱序或网络故障，相关隔离回归另见修复报告 |
| 商品详情返回被遮挡 | 1440/1024/900/600 四宽度，各 9 个 elementFromPoint 命中点通过；Enter 返回列表 | 实际操作系统 125%/150% 缩放、其他浏览器、小时级会话未覆盖 |

这些修复沿用销售/库存/商品公共货品文本既有的 Enter 确认、未确认文本隔离与输入法 Enter 隔离规则，及既有下拉自动合并和日期独立确认/取消机制。没有恢复“应用筛选”按钮。全面审查中另列的公共单选 IME、客服文本确认等问题未纳入本批，不宣称已修复。

## 原流程未知结果及处理

原批次追加式日志（journal）和失败日志全部保留；没有把丢失的输出重造为成功，也没有删除未知历史。这不是 PostgreSQL WAL 归档或 PITR 证明。

1. 首次进入维护 UTC `10:05:44.551Z` 返回 unknown。独立检查维护/排空声明均不存在，原服务身份保持、未发生 apply；依据原源码必须先持久写门再停止的顺序，独立证明该操作无控制副作用，原 reconcile 标为 failed 后才能重试。同期周报持相同互斥，支持锁等待解释，但原 stderr 丢失，不能认定唯一根因。未停止周报或改调度。
2. StartWorker 的原引擎 PID 24648 已完成 `Invoke-WorkerSystemStart`（232290 ms），新 head 在运行且 12 组件 Ready；外围 PS5 包装器未结束。精确核对 PID/创建时间/父进程/EncodedCommand 后仅关闭 41172 包装器，不杀进程树或应用服务；未关闭已消失的 batch Node。外围 30 分钟超时仍保留。原启动退出码未观测，不捏造 exit 0；由独立 Status、VerifyStartup、维护空、实际进程和阶段日志支持原 reconcile passed，没有重复 Start。
3. 首次生产 UI UTC `11:24:43.154Z` 返回 unknown，原 stderr/结果未保留，具体原因未知。原封不动脚本进行额外正常只读观察并通过；独立核对脚本与批次绑定、结果断言及 D5/01590 运行身份后，原 reconcile passed。此处重复的是正常只读 UI 观察，没有重放部署或变异操作。

4. 后恢复通过后，UTC `12:11:31.396Z` 的 closeout 准入在完整就绪断言被阻断（`Complete original system readiness is not the approved successor`），尚未执行下个收尾操作。同期自然守护记录为 unprobed/probeError，但 HTTP 探针仍 200；不能把它当作组件已证实停机，也不能把它列为健康通过。额外原 Status 只读回查于 `12:13:22.221Z` 确认 Running/Ready/精确 D5、12 组件全 true。未确定首次准入失败根因；随后只通过原完整准入续接，不放宽门禁、不修改脚本或重放已通过的变异操作。

5. 原 Wrangler 日志 `wrangler-2026-10-09_10-46-13_474.log` 第 6320–6335 行在 UTC `12:16:05.101Z` 记录代理错误，栈涉及 `castErrorCause → ProxyController.emitErrorEvent → onProxyWorkerMessage → PROXY_CONTROLLER → Miniflare loopback`，错误消息为空；原 supervisor 于 `12:16:06.179Z` 记录包装器 66080 exit 1、1 秒后执行既有受控重启。新链为 32284 → 21656 → 58780 → workerd 4848，仍属于 D5/01590。能证实代理错误后退出及同包自动恢复，不能确定底层根因，也不能归因于同期恢复、CPU、市场超时或四项修复。该运行风险未在本批另行修复，最终就绪通过不等于它不存在。

另有补充 helper/端口复合只读探针被工具自动审批拒绝（`CreateProcess blocked by policy`，未给具体理由），该命令未执行且未绕过。不能把它列为通过；既定组件就绪检查和 helper 包字节比较不因此等同于这项独立探针。

## 恢复与收尾

| 阶段 | 完整备份 | manifest SHA-256 | 隔离恢复 |
| --- | --- | --- | --- |
| 前 | `daily-20261009T093521Z-fad1f830c54f` | `c1095aec1a1a65f0eb3c3e761a46b2c97a5552b7a721230303d05a1f1cbeafd8` | `1784b2dfdef6` |
| 后 | `daily-20261009T114230Z-7117da1c1055` | `c3def80e40bf8ebad3e0d3e3a2c09a64b2d4d99bd6cf95d48c41b7b12ff62400` | `cb75cb8eed5a` |

两次隔离恢复均 completed，dump 校验匹配，恢复内容指纹各自与对应快照一致，profileRestoreVerified/sequenceHealthVerified 均 true，productionDatabaseTouched/serviceStateChanged 均 false，cleanupStatus 均 isolated_data_removed。前恢复内容 `148cfb59…`、后恢复内容 `8c640b74…`，跨时段快照并不要求相同。前后恢复完整元数据及 sidecar 已保全，后恢复证据保全操作于 UTC `12:21:34.358Z` passed。

正式 E 盘恢复点已轮换为 Sep 28、Sep 29 两个保护点及本次后备份，共三份。本次前备份已按原三份保留策略淘汰载荷，仅保留完整验收元数据；不能宣称其 dump 仍可供实际恢复。没有额外复制完整 dump 绕过名额。本次 PostgreSQL 备份不证明 R2 附件或整机配置已备份。

最后完整边界复验通过，第 16 项原 Status 于 UTC `12:26:02.674Z` passed；随后批次 completed，active.json 已不存在，最终 execute 06 退出 0。必需自然守护操作在 UTC `11:41:11.156Z` 通过两次新 healthy 观察（原 helper/ready/live/homepage 为 200）；后续出现的 unprobed/probeError 记录仍保留并列风险，不用较早通过覆盖较晚失败。

| 原操作 | 最终状态 | 最终收据时间（UTC，2026-10-09） |
| --- | --- | --- |
| reuse-priority-worker | passed | 09:33:38.930 |
| op-backup-pre | passed | 09:46:25.158 |
| op-restore-pre | passed | 09:59:41.875 |
| step-entermaintenance | passed，首次无控制副作用后重试 | 10:38:54.313 |
| apply-priority-worker | passed | 10:41:47.036 |
| step-exitmaintenance | passed | 10:42:53.016 |
| step-startworker | passed，独立收敛，未重放启动 | 11:18:51.126 |
| priority-source-assets | passed | 11:22:14.067 |
| priority-production-ui | passed，独立正常只读复验收敛 | 11:32:48.503 |
| step-aggregatestatus | passed | 11:36:33.240 |
| step-verifystartup | passed | 11:37:55.027 |
| natural-watchdogs | passed，两次新观察 | 11:41:11.156 |
| op-backup-post | passed | 11:54:10.516 |
| op-restore-post | passed | 12:08:20.504 |
| preserve-post-recovery | passed | 12:21:34.358 |
| readiness-closeout | passed | 12:26:02.674 |

独立终审于 UTC `12:33:02.640Z` 完成，结论为“本次发布必需验收闭合；运行风险仍未解决”。`production/FINAL_REVIEW.json` SHA-256 为 `9c01ac281ed1c3d31bca4d4b4f4ee2a80b27fc4385a12518ac99f098fcf62f29`；65 条原 journal 的顺序、链 hash、canonical 字节及保全副本一致，3 次历史 unknown 的 observations/proof 均匹配，最终无未决操作。

终审的一次原 Status 于上海 `20:30:20.5578426` 确认 Running/Ready/精确 D5、12 组件全 true，supervisor 32284、workerd 4848；原 PostgreSQL 4080 和 n8n 49880 的创建时间与发布前相同，恢复端口 55591 无监听、维护/排空声明不存在。最终再次核对四文件 hash、Git 精确差异、Django manifest 及 helper 三文件；完整大树采用前已独立验证，原完整准入重复核验，终审未再并发重跑大树/压力/业务测试。

终审保留的较晚 watchdog（UTC `12:31:26.334Z`）仍 unprobed/probeError，四 HTTP 探针 200；当前就绪结论与监测失败分别记录。文档 Git 交付和证据保全收据另存 `production/DELIVERY.json`，不倒改原批次闭合时间。

## 实际时间及失败样本

实际批准上海 **17:19:39** → 原批次闭合 **20:26:02.677**，约 **3 小时 6 分 24 秒**，原 journal 为 `11183677 ms`。包含全部在途等待、未知结果核查、外围超时、准入阻断及续接，不能改用 execute 06 的起点。批准前候选构建/测试/178.411 秒准入不计入此区间；原启动引擎本体 232290 ms 和外围 30 分钟未知等待分别记录，不能互相替代。独立终审及 Git/保全交付在原批次之后继续进行，其结束时间另存 `production/DELIVERY.json`，不倒改批次 completed。

自建 HTTP 只读观察于 UTC `09:25:57.282Z` 开始，批次闭合后按停止标志正常退出；入口共 3614 样本，其中 224 失败；客服共 723 样本，其中 46 未在采样条件内成功。只报告原始样本，不以维护混合样本算稳态可用性或 P95。

| 操作窗口 | 失败证据（UTC） | 相邻成功与限制 |
| --- | --- | --- |
| 应用维护期间入口 | 10:35:13.942–10:46:12.057，220 失败样本，跨度 658115 ms | 前成功10:35:10.940、后成功10:46:15.065；成功边界相距664125 ms，非精确停机 |
| 应用维护期间客服 | 10:35:07.930–10:46:09.054，45 失败样本，跨度661124 ms | 前成功10:34:52.887、后成功10:46:24.086；采样间隔约15秒，不能用较粗边界取精确停机 |
| 原代理错误及自动重启附近入口 | 12:16:05.061为500；12:16:08.061/11.063/14.077连接失败，共4样本 | 前成功12:16:02.057、后成功12:16:17.089，边界15032 ms；不是全程无中断 |
| 单个客服慢样本 | 12:22:35.942，客户端2秒截止后TimeoutError，原耗时2004.031 ms | 前后采样成功；不证明服务器返回5xx，也不证明其后来是否完成；不能归因代理重启或后恢复 |

当前未解决的运行风险是代理错误/exit1、较晚自然守护 unprobed/probeError、单个客服截止样本及首次 closeout 准入失败原因未知。它们没有通过扩大超时、放宽门禁、清缓存或服务重启掩盖；本次四项 UI 的开发和范围安全证据不等于这些运行问题已修复。

## 证据与限制

完整候选和执行证据在 `E:/codex-artifacts/priority-interactions-production-20261009/`，执行材料在 `production/`。批准文件、各次 execute 日志、追加式原批次 journal、独立 observations/proof、UI 结果及前恢复元数据均保留；候选封存文件不改写。

HTTP 采样仅证明采样时请求成功/失败，不等于页面新范围已绘制。采样间隔为入口约 3 秒、客服只读约 15 秒，2 秒请求截止，响应正文不保存；只能给失败样本区间及相邻成功边界，不能称精确停机时间、稳定 P95 或各模块性能目标。原生 IME、真实缩放、多账号现场变更、长时间后台争用和数据库执行计划等仍按全面审查报告列为未验证。
