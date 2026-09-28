# 第 3 项续工：负载拆分与堆对象保留分析

日期：2026-09-29，上海。分支：`codex/workerd-memory`。承接 [首轮诊断](WORKERD_MEMORY_DIAGNOSIS_20260929.md)，本轮只执行用户批准的第 1、2 步；不更新总评估、不合并 main、不修改生产。

## 结论

**本轮两步已完成。已复现的合成链路中，增长部分主要是可回收对象的占用，尚未发现 GC 后持续累积的数据行或请求对象强引用泄漏。空闲 180 秒也未使这部分占用自行消失。**

这不是根因修复验收：采集堆快照会影响回收，快照后的下降只用于区分“可回收”与“仍被引用”。本轮没有修改应用逻辑、运行时版本、3072 MiB 配置或重启策略。历史生产 OOM 的原因及实际业务长期表现仍未闭合。

**随后历史原始日志核对发现重要区别：历史 OOM 前已执行 last-resort Mark-Compact，回收后仍约 1.4 GB，并非只有“尚未触发回收”的证据。下一步应优先查明完整应用中 GC 后仍保留的对象；不能将本合成路径的回收延迟直接视为历史根因。**见下节。

## 历史 OOM 原始日志补证与排查方向修正

只读复核正式运行目录保存的三份旧 stdout 日志，记录原文件 SHA、准确行号、脱敏 GC 数字和 fatal 类型；没有复制请求内容或客户数据。证据见 [historical-oom.json](evidence/workerd-memory-attribution-20260929/historical-oom.json)。

| 日志标识 | GC 行 / fatal 行 | last-resort Mark-Compact 前后（日志原单位 MB） |
| --- | --- | --- |
| worker-20260913-105301 | 703–704 / 705 | 1392.6 → 1392.6，两次 |
| worker-20260914-005842 | 376–377 / 378 | 1391.7 → 1391.7，两次 |
| worker-20260914-085550 | 1006–1007 / 1008 | 1395.9 → 1395.9，两次 |

三份随后均报 `Reached heap limit` / `allocation failed: JavaScript heap out of memory`。数值按日志小数精度表达“几乎未下降”，不推断逐字节完全零回收；文件名时间不冒充准确崩溃时间。

能够确认的直接触发原因是：**V8 报告老生代堆已达到上限，最后尝试回收仍未释放足够空间，随后分配失败。**尚不能从这些行确定保留者属于业务缓存、框架/运行时内部对象、未结束请求积压，还是合法在途数据超过容量。

这与本轮“约 42 MiB 可以经快照采集回收到约 1.19 MiB”的合成链路不是同一份因果证据。上游 [#6824](https://github.com/cloudflare/workerd/issues/6824) 也明确区分未触发 major/unified GC 的报告和 [#3120](https://github.com/cloudflare/workerd/issues/3120) 中 full GC 后仍达到 JS 堆上限的报告；这些外部记录不替代本机对象保留证据。

“未闭合”具体缺少：历史版本/负载与完整应用的复现映射、增长对象及强引用持有者、针对它的修改，以及同条件下不再保留/耗尽的验证。当前没有证明新版本仍会复现原故障，也没有证明仅增加到 3 GiB 已解决它。

下一步应调整为：

1. 先核对历史生效源码与依赖身份，再在独立环境运行完整应用路径（页面/SSR、框架请求缓存、导入、后台任务），以合成或脱敏夹具匹配数据规模与并发，按组合逐级增加；不能只继续重复公共 JSON 函数。
2. 在增长早期采集多份增量堆快照，比较回收后的存活对象数量及引用链，避免等到 OOM 才取证；沿用真实阳性对照和经过修正的分析器。
3. 若定位到缓存/监听器/请求对象，则定向修复边界或释放；若是合法并发峰值，则验证有界并发/流式或分块处理；若证据指向框架或 workerd 内部保留，再用相同源码、数据、请求和堆限制作候选版本对照。不预先把升级或 GC 调参列为已确认修复。
4. 最终验收使用不依赖快照触发回收、不靠重启或更高内存上限的正常运行曲线，复验业务功能与完整业务周期。生产诊断或上线仍须按原方案完成准备并取得明确确认。

主要证据：

- 12 类普通负载，各 75 次请求，快照后 user isolate 堆均回到约 1.17–1.19 MiB；合成数据行存活数为 0。
- 带上传的较长实验共 147 次请求；断开 Inspector 前端连接、停发请求配置 180 秒（实际约 186.8 秒，含采样开销），used heap 仍为 42.231 MiB，Private 为 156.309 MiB。同一进程采集快照后分别降至 1.189 / 55.633 MiB，backing storage 归零。
- 故意保留对象的阳性对照，采集快照后仍有 **9,600 行**；已定位到明确的模块数组引用链，证明本次方法可以识别真正存活的对象。

## 环境与可比范围

- 原版公共传输函数固定取自 `e00d4a82`，不把首轮取消补丁引入本次归因。锁定 workerd `1.20260515.1`、Miniflare `4.20260515.0`；安装的 Wrangler 为 `4.92.0`，本轮用 Miniflare 创建隔离 workerd，没有启动另一套正式 Wrangler/helper。
- 每组全新进程、独立随机 loopback 端口，无数据库、R2、真实凭据或业务调度；HTTP 客户端使用真实本机 HTTP 请求，未使用 `dispatchFetch` 作为分组流量入口。
- JSON 固定 4,096 行，1,002,411 字节，每行含数字 id 与 220 字符 padding；上传 1 MiB；流式下载 8 MiB，并核对每个字节。
- 普通组为预热 3 次，再 3×24 次；并发 1，请求结束后间隔 100 ms，每轮留 2 秒，最后留 10 秒。超时与主动取消均为 25 ms 的合成慢响应，必须得到对应错误码。
- 每组先预热并采集 warm 快照，再执行负载，最后采集 final 快照。这会影响初始回收状态，所有表中数据仅作归因；不能替代未挂 Inspector 的生产表现或宣称修复收益。
- 主矩阵 900 次请求，额外空闲对照 147 次、阳性对照 75 次，最终证据共 1,122 次。早期 GET 对照另有 75 次，因它还创建了一个未使用的 AbortController，被改正后的纯 GET 组替代，未混入最终矩阵。
- 最终各组所有采样均未检测到其他 Node 测试/构建进程，仍不是整机资源独占的证明。实验串行运行，不停止其他会话进程。

## 第 1 步：分组结果

下表“快照前”是最后空闲采样，“快照后”是完成完整快照后的统计；单位均为 MiB。Private 峰值来自本轮进程采样，**包含诊断/快照阶段**，不等于单请求峰值或 JS 堆大小。

| 合成路径 | 请求数 | 耗时秒 | 快照前 used heap | 快照后 used heap | 采样 Private 峰值 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 空接口 | 75 | 36.060 | 1.281 | 1.168 | 47.645 |
| 纯 JSON.parse | 75 | 35.563 | 6.247 | 1.168 | 62.887 |
| 内存 Response.json | 75 | 35.560 | 18.872 | 1.168 | 147.008 |
| 合成 fetcher + bounded JSON | 75 | 36.054 | 9.720 | 1.183 | 77.820 |
| HTTP fetch + JSON，无控制器 | 75 | 35.338 | 18.881 | 1.174 | 78.277 |
| HTTP fetch + AbortSignal | 75 | 36.273 | 18.907 | 1.169 | 78.414 |
| HTTP fetch + 超时定时器 | 75 | 36.823 | 18.907 | 1.169 | 78.434 |
| HTTP bounded JSON | 75 | 36.956 | 19.563 | 1.183 | 88.223 |
| 1 MiB 上传 + bounded JSON | 75 | 37.043 | 30.035 | 1.184 | 120.324 |
| 8 MiB 流式下载 | 75 | 43.520 | 1.339 | 1.168 | 64.586 |
| 超时失败 | 75 | 37.806 | 2.111 | 1.190 | 50.273 |
| 主动取消 | 75 | 37.780 | 2.116 | 1.191 | 49.527 |

这些结果把关注点收敛到 JSON 分配后回收的行为。没有证据说明“增加 AbortSignal/定时器后，GC 后存活对象随请求数累计”。流式转发没有出现与整段 JSON 解析相同幅度的 used heap 占用。

上游 `opened/closed` 是 HTTP 请求/响应收尾计数，**不是 TCP 连接数**。所有组在清理前的 idle/final 采样中 `active=0`；没有靠最终 `closeAllConnections()` 把未结束响应伪装成正常收尾。

## 第 2 步：快照与引用链

通过本次 Miniflare 实例提供的 Inspector 地址，核验目标 host/port 后只连接它的 user/core:entry。开启 HeapProfiler，收集 `addHeapSnapshotChunk`，要求命令完成、JSON 可解析、节点/边数量和目标有效，才接受快照。每份上限 128 MiB，输出 create-only；不接受空文件或超时当成功。

普通组和较长实验中，warm/final 对比：

- 合成行对象均为 0；没有逐轮累积的 parsed rows。
- Promise、ArrayBuffer、Request、Response、AbortController、AbortSignal 和流对象的计数保持稳定；较长实验中 Object 仅 170→174，Array/Promise 等没有随 147 次请求增加。
- 对仍存活的类型抽样查询非 weak 边引用路径，主要落在 `NativeContext` 的 prototype 或 `fast_template_instantiations_cache`。这是固定运行时对象，不能将其计数直接当成未完成请求数。
- 引用路径分析不是 dominator/retained-size 算法；`selfBytes` 也不冒充 retained bytes。结论基于快照前后占用、类型计数、数据行标记和阳性对照共同判断。

### 计数器修正与阳性验证

最初的分析器要求同时找到 `id` 和 `padding` 属性边。但 V8 快照可以省略小整数 Smi 的 id 边，使故意保留的对象也被误报为 0。**该版行计数全部撤回，不用于结论。**原始快照字节未改，最终报告逐份校验原 SHA 后，用 `padding-string-v2` 重分析。

v2 仅针对已知合成数据：识别具有字符串/拼接字符串/切片字符串 padding 属性的对象，不依赖数字 id 边。新增负向测试覆盖数字边缺失、weak 边、损坏节点/边、空快照、命令失败和覆盖拒绝。

真实 workerd 阳性对照每次把 128 行留在模块 `retained` 数组：warm 3 次为 384 行，最终 75 次为 9,600 行，**两份快照精确匹配**。抽样引用链为：

```text
GC roots → Global handles → fetch 函数 → 模块 Context
         → retained 数组 → 批次数组 → 数据行 Object
```

同一分析器重读普通组/较长实验的 final 快照，行数仍为 0。阳性对照只验证诊断能力，不是应用中的真实代码或漏洞；不能将它当作业务根因。

## 较长空闲实验

`upload-bounded`：6×24 次 + 3 次预热，共 147 次，235.908 秒。负载期间及安静阶段断开 Inspector 前端；调试端口仍配置，不能称作完全无 Inspector 环境。仅在负载后和空闲后短暂重新连接取统计，安静阶段只读进程计数，不发 HTTP 或 CDP 请求。

| 时点 | used heap MiB | backing storage MiB | Private MiB |
| --- | ---: | ---: | ---: |
| 预热快照后 | 1.168 | 0 | 30.863 |
| 147 次请求后 | 42.231 | 22.038 | 156.480 |
| 配置空闲 180 秒后 | 42.231 | 22.038 | 156.309 |
| 最终堆快照后 | 1.189 | 0 | 55.633 |

进程采样 Private 峰值 157.363 MiB。上传读取累计 154,140,672 字节，最后一次采样上游活动响应为 0；回收发生在同一实例，未通过重启、提高限制或修改业务变量制造下降。

因此本合成路径更支持**可回收对象在该观察窗口没有及时回收**这一方向；不支持当前已找到一条不断保存业务数据的强引用链。尚未用独立 GC 事件追踪确认 major/unified GC 的调度机制，也未证明所有回收延迟均由同一底层缺陷造成。

## 证据、保存与复现

- [汇总](evidence/workerd-memory-attribution-20260929/summary.json)、[完整实验与引用路径](evidence/workerd-memory-attribution-20260929/experiments.json)、[CSV](evidence/workerd-memory-attribution-20260929/curves.csv)、[离线图表](evidence/workerd-memory-attribution-20260929/curves.html)。
- 28 份最终采用的原始快照共 87,017,630 字节，gzip 为 18,012,183 字节；在 `E:\codex-artifacts\workerd-memory-attribution-20260929` 独立归档，逐份解压回算 SHA 与原始文件一致。清单见 [snapshot-archive.json](evidence/workerd-memory-attribution-20260929/snapshot-archive.json)。全部为合成数据，不是生产堆转储。
- 原始采样暂存与快照保留在本 worktree 的 `tmp/workerd-memory/`；E 归档保全后不依赖 Git 忽略目录长期存在。归档不属于生产数据库备份，不参与其轮换。

```powershell
# 新标签输出；同标签仅复用成功且设置相符的结果
node tools/workerd-memory-decompose.mjs all split-v1
node tools/workerd-memory-decompose.mjs fetch-json fetch-json-pure-v2
node tools/workerd-memory-decompose.mjs upload-bounded detached-idle-v1 180 6 detached
node tools/workerd-memory-decompose.mjs retained-control positive-v1
node tools/workerd-memory-attribution-report.mjs
```

原始前 10 组在添加错误分支/阳性路径之前运行；新增路径不更改原有测试动作。纯 GET 首轮构造了未使用的控制器，已用单独新标签重测替代。不得把脚本研发过程的旧派生计数或早期 GET 样本混入最终表。

## 测试、交付与后续边界

- 诊断源码提交 `6ffa2a9f36be99f991486392ba51354f9b9171a8` 已推送 `origin/codex/workerd-memory`；报告与证据为同分支后续提交，最终分支头在交付消息中核验。
- 变更文件为 `tools/workerd-memory-inspector.mjs`，新增 `tools/workerd-memory-{decompose,snapshot,attribution-report}.mjs` 和 `tests/workerd-memory-snapshot.test.ts`；报告/证据独立保存，没有新的生产应用代码修改。
- 本轮相关测试 14/14 通过：快照分析、Smi 边缺失、弱引用与损坏图、流式快照完整性/覆盖保护、原取消语义、真实隔离 workerd 的堆参数和 SSE。
- 修改文件定向 lint 0 错误、0 警告，`git diff --check` 通过；最终报告生成重新逐份验证原始快照 SHA、阳性计数以及清理前的上游活动响应为零。
- 本轮只改诊断工具、测试和独立报告；没有新增应用修复。首轮 `bounded-fetch` 取消补丁仍是单独的资源清理改进，不能据本轮快照下降宣称它修好了长期增长。
- 本轮未重跑整站生产构建，验证范围为新增诊断工具与其真实隔离运行；首轮候选尚缺的整站构建和完整生产验收仍保留。未改依赖锁、数据库、生产进程、调度或维护设置。
- 第 1、2 步针对已复现的合成链路完成；**整个第 3 项仍未完成**。历史原始日志补证后，下一阶段优先复现完整应用并定位回收后仍保留的对象，再决定业务修复或运行时版本对照；任何生产计数、诊断版本或发布继续按原授权边界准备验证/回滚后等待确认。
- 不依赖其他优化分支，不修改第 2/6/7 项公共模块；继续保留本分支和 worktree，由用户指定会话统一合并与组合验证。
- 结束时只读回查正式 release 仍为 `20260928T112356Z-eeac7bbc96a8c51a`，supervisor PID 仍为 `32412`；本 worktree 的隔离 workerd/诊断进程已结束。
