# AI 发布阻塞清理

2026-10-13，Asia/Shanghai。用户授权核清测试失败、处理 lint、验证 AI/启动/监控、合入 main，并准备绑定当前运行版本的正式候选与发布计划；生产切换仍须明确批准。

## 处理范围

| 原失败 | 原因与修正 | 保留的保护 |
| --- | --- | --- |
| 钉钉启动 1 项 | 旧测试要求受控发布也自动启动接收器。更新为实际的 `RequireReadyBackend` 合同，并运行真实启动函数的私有替身，验证普通/受控、已运行/停止四种状态及后端未就绪拒绝。 | 先完成后端就绪、受控发布不新增接收器、并发加入者不重放启动。 |
| 两种 PowerShell 进程身份 2 项 | 夹具默认加载 `Status`，升级后的只读保护正确拒绝其旧 PID 记录删除要求。改为私有目录、library-only 下的显式 `Start` 写上下文。 | PID 出生/路径/命令/指纹、当前启动期拒绝伪造旧记录、真实旧记录仅删除而不杀复用进程、精确后代停止与清理。 |
| 执行器负例 3 项 | 夹具只有旧最小 batch，没有现行 `recovery` 字段；异常发生在被测进程前。补齐 v3/full，未改原负例断言。 | 真退出码、非法 JSON、超量输出及脱敏诊断限额。 |
| 看门狗期限 1 项 | 时间测试的假 `Read-WatchJson` 也误返回新诊断 bundle 数据，提前触发绑定拒绝。只在私有夹具中明确模拟诊断选择，使测试进入真实期限路径。 | 原总期限、迟到端口失败、过期零后续 HTTP、未知投递不重发、诊断绑定真实回归。 |
| 原嵌套 PS5 适配器 10 项 | 同样补齐新版 batch version/recovery，而非绕过操作。 | 正常启动和排空、非零退出、错版本、不完整/假组件、坏 JSON、维护、期限及身份缺失拒绝。 |

此次运行控制、监控及发布工具产品代码没有修改；清理提交仅涉及测试夹具、lint 规则及规范。AI 修复和高推理参数自由调整保持。

## 历史证据与 lint

原 63 errors 为 9 份 CommonJS 审查脚本的 62 个 require 风格错误，以及一份独立 Node 诊断脚本的 Next.js `module` 命名错误。10 份历史文件全部与原 main Git 字节相同，物理摘要已记录，没有改写或移出扫描。

`eslint.config.mjs` 仅对四个明确的历史审查目录采用 CommonJS 语义并关闭不适用的 ESM require 风格规则；对唯一指定 Node 诊断脚本关闭 Next.js 命名规则。新增反例确认范围外工具和应用仍拒绝原违规、证据语法错误仍拒绝、其他导入规则继续生效。完整 lint **0 errors / 112 warnings**；警告原样保留。

## 额外监听失败与最终验证

清理后第一轮完整回归：3,675 项，3,650 通过、1 失败、24 跳过，755.365 秒。唯一额外失败发生在缓存初始观察，报 `Inputs changed while evidence session was held`；具体触发输入没有证实，未把它归因于本次 AI 代码或单一延迟。

相关夹具移除固定 20ms 的事件送达假设，等待真实 native watcher 回调，原监听器先处理，后才通知测试；事件未到达会明确失败。源码/npm/未知变化的生产拒绝逻辑没有修改或放宽。相关完整文件 23 项通过；随后最终完整回归 **3,675 项，3,651 通过、0 失败、24 跳过**，729.906 秒。首次失败、诊断及后续结果分别保留，不把历史拒绝改写为成功，也不宣称缓存现场生产验收完成。

其他必要验证：Django 85 项通过；迁移 dry-run 无变化；实际 installed successor 校验确认与当前 **140 个迁移文件**相同；生产边界 651 个模块、0 违规；生产构建、修改文件 lint、差异检查通过。没有真实模型请求或真实配置写入。

## Git 与准备状态

代码 `f2ec557a0f5fd097d4811f72b17536174f98d8ba` 已合入并原子推送远端 main 与 `codex/ai-release-blockers-20261013`，远端逐 ref 回读一致。本机正式主检出的保护绑定及用户文件未更新。

已验证源码独立冻结在 `D:\codex-isolated\ai-release-candidate-20261013\source`。记录和原日志位于 `D:\codex-artifacts\ai-release-blockers-20261013`；后续文档写入不会修改这个候选来源。

原运行前驱：Worker `20261011T090355Z-21c2645a63247749` / manifest `6cff8886e533244997b65d2a8668776cee5178b95e4e2a99ed14bd25bf2733f4` / chain `bc87c4d60408ecb9b8ca5855bdd2a39c684a39c2d3ec29dafef8434216aead6c`；Django manifest `85cf0699925aad21f98ae682f458789236d206723b10865939915d1bcacddd09`。

管理员上下文只调用原 PrepareApp 和在线 plan，沿用原 30 分钟共同期限、直接退出文件协议及 Preserve 语义，不自动重放未知结果。首次错误的 PowerShell 路径未启动动作，原错误保留；之后使用实际解析到的本机 PowerShell 入口。

Django 提前准备已完成：ID `1d0b38ac1f904f2987f717fc55119f52`，收据 SHA `33acbdf93a71b088c66ec845cdd80816e37b3f2f34973c4649fdd73be3a2e68d`，候选 manifest SHA `4f319b04245e458361376dbae54c7827edb16c85d22178a49cfdacf74ccbd625`，原实际收据已回读。源码绑定 SHA `466df1e786b5f26ee1f40e1f431dc905471d8660331313af521afbca99a02676`。

Worker 原在线计划于上海 **11:13:16** 返回 `planned`，管理员原进程 exit=0，整轮原传输 1,461.732 秒，未超原 30 分钟期限。精确 plan SHA `3c9775e9f64e0a6c4f5d51d544f966f2f952db1c4c2a25a26900896563760f5d`，候选 release `20261013T025101Z-ca3bf62917426292`，manifest SHA `554a7d8138658b411e7b48034c2a4fed6b7abf705d0a22bff32cef6f9d7bfe98`，guard SHA `99373b662cb8afae10bdd41c95e70e82fd67ab0b5a6344962815c1318b5a5f7a`。

已再次回读原 plan 文件、sidecar、自身 payload、候选 manifest、准备收据及 sidecar，并通过原 `assertWorkerSourceBindingTuple` 核对 source/plan/manifest/receipt；实际前驱 head/chain 仍与 plan 相等。受保护入口中三条会变化：`tools/operations-system-control.ps1`、`tools/worker-local-service.ps1` 与本次 activation fence；这些属于完整 main 候选相对当前运行包的差异，不隐去或当作已经采用。正式 S1 宿主 SHA 仍为原 38b1。

准备不等于部署，不创建启动许可。本轮不进入维护、不停止服务、不 apply/DeployApp、不迁移、不执行生产备份/恢复或真实发送。发布范围及后续阶段见 [发布计划](RELEASE_PLAN.md)。

末次自然监控 11:18:28 开始、11:19:13 完成，healthy=true、failures=0，仍为原运行 release；准备期间的超时/不完整观察保留，未定因。候选来源、运行包、源码 worktree 和准备材料均保留，因为正式计划/原收据绑定其精确物理路径；不得为清理删除这些来源。需要用户对本次精确切换及验收范围明确批准，动作前仍重新取得真实现场准入。
