# 第 3 项：Wrangler 调试代理内存保留修复候选

日期：2026-09-29。分支 `codex/workerd-memory`；承接 [历史补证与归因](WORKERD_MEMORY_ATTRIBUTION_20260929.md)。只处理第 3 项，不修改总评估或其他优化分支。

## 结论与状态

**已定位并修复 Wrangler 4.92.0 中可复现的调试代理无界消息缓存。源码和隔离验收完成，尚未生产采用。**

原版在没有 DevTools 前端时仍开启网络追踪，`InspectorProxyWorker.runtimeMessageBuffer` 持续保存收到的消息，而清空逻辑因没有前端连接直接返回。对象有强引用，完整 GC 也不能回收。

真实 Wrangler + 完整应用构建的同条件实验：51 次定时入口、459 次签名合成后端调用，公共代理 workerd 的采样 Private 峰值 **315.746→50.137 MiB**，30 秒空闲后 **307.184→48.824 MiB**。应用 workerd 的峰值 **221.430→222.375 MiB**，改善明确集中在公共代理。两轮均未连接外部 DevTools、未做堆快照/强制 GC、未中途重启、未修改 3072 MiB 堆配置。

加长候选验证 151 次入口、1,359 次后端调用通过，代理峰值 52.922 MiB。原已复现的消息数组累积被消除；这不是整机总内存上限，也不是对任意业务负载的长期保证。

## 为什么前面的业务 Worker 实验没有直接定位它

Wrangler 的本地链路还有公共代理层。SDK `ProxyController` 在同一个 Miniflare/workerd 进程中运行 `ProxyWorker` 和 `InspectorProxyWorker`，公开端口由这一层持有；业务应用另在一个 workerd 中执行。因此不能把“持有 3000 端口的 workerd”直接等同于业务 user isolate。

历史关联证据：

- `worker-20260913-105301.stdout.log` 的 OOM PID 是 `55456`。
- 已有 [正式采用证据](evidence/market-annotation-reliability-production-20260913.json) 的 `productionReadback.portProcessId=55456`，对应 release `20260913T024434Z-bc351d47b7209e2b`、记录源码 `2a1867c244fc1c8d3b4cb55675b8dd71d11044a7`。
- 保留的历史 package-lock 与本轮锁定主要版本相同：Wrangler 4.92.0、Miniflare 4.20260515.0、workerd 1.20260515.1、Vinext 0.0.50、React 19.2.6。
- 当前正式包的 InspectorProxyWorker 字节与隔离原版基线 SHA 一致。历史 node_modules 载荷已经按此前策略清理，没有将当前文件摘要冒充对历史载荷的直接回读。
- 历史请求日志的脱敏分类显示，一次 OOM 前最后 60 条可解析请求全部为本地定时入口。该记录不是完整流量计数，也不能由此认定具体业务任务造成泄漏。分类结果见 `historical-load.json`。

这使该缺陷与首例历史 OOM 的进程层及锁定版本吻合。**由于历史事件没有堆转储，不能逐次证明三次旧 OOM 全部由这一缺陷独立造成；生产关闭仍需受控采用后的实际业务周期验证。**

## 修改内容与功能边界

保留锁定依赖链，只对 `wrangler-dist/InspectorProxyWorker.js` 做字节固定的最小回移，不升级 Wrangler/Miniflare/workerd，不改变业务代码或内存限额。

1. 按上游已合并的 [workers-sdk #14243](https://github.com/cloudflare/workers-sdk/pull/14243) 行为，只有 DevTools 前端已连接时才主动发送 `Network.enable`；前端断开后同时发送 `Network.disable`。保留原连接身份判断、重连和调试器协议。
2. 本项目补充有界的断线前端历史：最多 **256 条**且累计不超过 **1,048,576 个 JSON 字符（UTF-16 code units）**。两者任一超限就淘汰最旧消息；单条超预算消息不留在离线缓存。它不是严格的对象图字节数或进程内存上限。
3. 异常及原本需要转发的 console 消息仍先交给 controller；已连接 DevTools 的实时消息不截断，历史按原 FIFO 顺序发送，随后清零数量和字符计数。

行为变化仅限无人接收时的调试历史：后来打开 DevTools 可见有界的最近记录。业务 HTTP、数据导入、文件、R2、调度、权限与 controller 错误通知不变。没有通过禁用整个 Inspector 消除调试功能。

回移由 `tools/install-wrangler-inspector-patch.mjs` 实现，接入已有 `tools/install-workerd-heap-patch.mjs` 的 CLI/postinstall 路径。后者原堆适配函数与摘要保持，未修改 supervisor/启动器/发布控制器，避免与第 2、6、7 项争写。

| 字节门禁 | SHA-256 |
| --- | --- |
| 原始 InspectorProxyWorker | `17077283a771d0575bb5def67e91c0c74dec9e505d29bd63f8a71c1294c81f8f` |
| 候选 InspectorProxyWorker | `ee6e78c50d02eef01d20312ed8e9a72dc75489e6f25ebba1f9869a7db7a0828c` |
| 原有 Miniflare 堆适配，不变 | `2b2a89fb96a270e678b4aa87e65aa1282049b18d28a1e30ff7fe7f2736b648c7` |

安装只接受 Wrangler 4.92.0 及精确原版/已修补字节；重复安装幂等，未知版本、篡改或未知摘要拒绝。未来升级依赖必须移除或重新验证此回移。正常不可变发布的完整 node_modules tree 摘要将绑定候选字节，禁止原地编辑正式包。

上游在 [Wrangler 4.100.0](https://github.com/cloudflare/workers-sdk/releases/tag/wrangler%404.100.0) 发布了网络追踪修复；本轮没有顺带引入该版本其他配置/R2 行为变化。离线缓存双限额为本项目额外保护，不冒称上游原补丁已有此能力。

## 分层复现与验收

### 代理强引用实验

直接加载本机摘要固定的真实 SDK 类，在新建 workerd 中输入 3,000 条合成 `Network.dataReceived` 消息，每条代表 4,096 字节体数据并带唯一编号。前后数据与请求序列相同，均保留 3072 MiB 配置。

| 项目 | 原版 | 候选 |
| --- | ---: | ---: |
| 末尾数组长度 | 3,000 | 187（字符预算先到） |
| 堆快照后 used heap | 16.567 MiB | 1.602 MiB |
| 本轮墙钟 | 13.119 秒 | 12.754 秒 |

引用链明确为：`GC roots → fetch 上下文 → InspectorProxyWorker → runtimeMessageBuffer → 消息对象`。原版 GC 后仍保留，符合真实泄漏而非单纯等待回收。快照还计入一个固定消息模板对象，未把它当作额外缓存消息。

本实验故意向候选输入本不应继续产生的晚到消息，用于验证双限额兜底；正常无 DevTools 情况还会由 Network gate 从源头抑制网络事件。堆快照只用于归因，不用于下述正常运行验收。

### 完整应用与真实 Wrangler 启动链

先完成本 worktree 的完整生产构建，再运行真实编译 Worker、RSC/SSR 路由、签名适配和定时入口。合成后端固定空任务、空图片/标注队列；每次五个 AI 队列响应各附 256 KiB 合成字段，单次对外响应 **1,311,562 字节**。无数据库、真实平台、付费模型或真实任务消费。

真实 Wrangler API 使用本版本 InspectorProxyWorker，启用正常本地 Inspector 服务但不接外部 DevTools。合成后端为独立随机 loopback 端口，签名须正确；测试入口在导入完整应用前限制 fetch 到两个合成 origin，并禁止重定向。Wrangler 4.92.0 的该 API 未实际应用类型声明中的 outbound hook，因此以实际 HTTP 夹具和入口限制验证，不声称仅传了那个选项就隔离成功。

| 同条件正常运行 | 原版 | 候选 |
| --- | ---: | ---: |
| 请求数（含 1 次预热） | 51 | 51 |
| 签名后端调用 | 459 | 459 |
| 耗时（含 30 秒空闲） | 60.080 秒 | 59.407 秒 |
| 代理采样 Private 峰值 | 315.746 MiB | 50.137 MiB |
| 代理空闲末 Private | 307.184 MiB | 48.824 MiB |
| 应用 workerd 采样 Private 峰值 | 221.430 MiB | 222.375 MiB |

前后编译入口 SHA 相同，每个响应的状态/字节数序列和各后端路径调用计数相同，所有定时子结果 `ok=true`；未把字节数相同冒充逐字节摘要校验。没有外部 DevTools、快照、强制 GC、中途重启或更高堆限制。两轮采样竞争测试/构建计数均为 0，仍保留正常 Windows/生产背景负载。

候选额外 151 次请求 / 1,359 次后端调用，98.674 秒，代理峰值 52.922 MiB、末尾 52.730 MiB；应用进程出现正常分配/回落，峰值 237.480 MiB。本轮是短时加速负载验证，不称作 24 小时实测。

Node 内存列包含 Wrangler API、驱动和合成后端，未当作纯 Wrangler 进程指标；正式独立 Wrangler/helper 的只读观察仍见首轮报告。

### 回归与失败记录

- 全量单测：**2,694 通过 / 20 跳过 / 0 失败**，总 2,714，463.820 秒；包括新增 7 项补丁测试和既有导入、流、生命周期、权限与版本保护回归。
- 新增测试覆盖摘要/版本拒绝、重复安装、FIFO、数量/字符限额、超大消息仍转发 controller、无前端/已连接/重连、Host/Origin 拒绝，以及真实 workerd/DO 的 DevTools 连接、重连、断开后 Network.disable。
- 初次负向 WebSocket 网络测试收尾产生 ECONNRESET；非法 Origin 的拒绝在真实类方法上单独验证，正常连接/断开继续走真实 workerd。最终测试无 socket 错误，不把失败的夹具轮次算作通过。
- 真实 Wrangler 上的 HTML、RSC 各 4 次通过；8 MiB 静态文件 4 次通过长度和 SHA-256 校验。早期错误的静态路由设置/RSC 路径返回 404，只作夹具调试，未纳入成功结果。
- 完整应用构建在安装候选后通过；修改文件 lint 0 错误/0 警告，后端生产边界检查通过，`git diff --check` 通过。
- 全仓 lint 为 0 错误、12 条未修改文件的既有警告；后端边界本轮检查 545 模块、0 违规。构建/全量测试均取得退出码 0，记录与摘要见 [verification.json](evidence/workerd-inspector-fix-20260929/verification.json)。
- 安装在本 worktree 实际执行一次，再执行返回 already_patched；正式包仍保持原始 Inspector SHA，未停止或替换正式进程。

## 证据与复现

见 [summary.json](evidence/workerd-inspector-fix-20260929/summary.json)、[完整结果](evidence/workerd-inspector-fix-20260929/experiments.json)、[曲线 CSV](evidence/workerd-inspector-fix-20260929/curves.csv)、[离线曲线](evidence/workerd-inspector-fix-20260929/curves.html)。4 份代理原始快照为合成数据，已压缩保存到 `E:\codex-artifacts\workerd-inspector-fix-20260929` 并逐份解压校验，见 [归档清单](evidence/workerd-inspector-fix-20260929/snapshot-archive.json)。不属于生产备份，不参与其轮换。

```powershell
# 只在本任务独立 codex worktree，使用新标签；先确保其他重负载已错峰
node tools/workerd-inspector-buffer-lab.mjs before new-buffer-before
node tools/workerd-inspector-buffer-lab.mjs after new-buffer-after
# 原版使用独立 Wrangler 包副本，既不降级本 worktree 依赖，也不触碰生产
node tools/workerd-memory-full-app.mjs scheduled new-runtime-before 50 wrangler 262144 original
node tools/workerd-memory-full-app.mjs scheduled new-runtime-after 50 wrangler 262144
```

原版包副本入口另以 2 次完整调用 / 18 次后端调用烟测通过，确认副本摘要为原始值而本 worktree 依赖仍为候选摘要。原版/候选对照不会依靠修改正式包或降低本 worktree 安装状态完成。

## 后续采用、验证与回滚（未执行）

1. 由指定收尾会话合并各项并验证组合功能；本任务不自行合并 main。该补丁不依赖其他优化分支，只有已有 heap postinstall 入口新增调用，统一收尾应保留两种适配及各自摘要门禁。
2. 对最终合并源码按原发布流程构建/准备不可变候选，确认 `npm ci` 后 Inspector 和 Miniflare 摘要、node_modules tree、原 R2 自检和启动绑定；不从本次诊断 dist 直接部署。
3. 按原门禁完成备份/恢复验证、在途任务与 helper 排空，等待对本次候选明确上线确认，再受控切换 Worker/helper。此变更无数据库迁移，不要求 Django/PostgreSQL/n8n 重启，也不改变调度。
4. 正式验收应覆盖无 DevTools 的完整业务周期，分开记录公共代理 workerd、应用 workerd、Wrangler 和 helper，并关联请求量及进程创建时间。重点确认代理不再累计网络历史、正常业务完成和原存活保护有效；短窗口成功不自动关闭所有历史原因。
5. 回滚沿原唯一生命周期/不可变发布入口，采用事前复验的兼容前驱，保留诊断证据。回滚会恢复旧调试代理行为，原 3 GiB/存活保护仍只是缓解；不得原地拷回正式 node_modules、取消发布校验或扩大内存限额。

**生产仍未采用。** 后续生产诊断、维护、发布与自然周期验收继续等待用户明确确认；本候选开发成功不构成生产业务终验。

## 提交状态

修复源码 `88dda323d461f49e725cc8e74dcf40a5b63bd6ca` 已推送 `origin/codex/workerd-memory`。本报告、历史脱敏分类和证据为同分支后续文档提交，最终分支头在交付消息中核验。分支/worktree 保留，未合并 main，未修改总评估。

源码变更为 `tools/install-workerd-heap-patch.mjs`、新增 `tools/install-wrangler-inspector-patch.mjs` 与 `tests/wrangler-inspector-patch.test.ts`；诊断支持为 `tools/workerd-memory-snapshot.mjs`、新增 `tools/workerd-memory-full-app.mjs`、`tools/workerd-inspector-buffer-lab.mjs`、`tools/workerd-inspector-fix-report.mjs`。没有修改 supervisor、正式生命周期引擎、Django 或 n8n 定义。
