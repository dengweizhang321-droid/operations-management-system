# 公共筛选与货品输入修复：生产采用

用户于 2026-10-06 明确批准“按此方案上线”。本次仅采用已验收 UI 修复：从 10 月 6 日晚准备，10 月 7 日凌晨恢复前台及完成收尾。**生产已采用，Windows 原生输入法候选窗验证仍待人工确认**；没有把浏览器 composition 测试冒作原生候选窗验收。

## 实际绑定

| 项目 | 实际值 |
| --- | --- |
| 业务构建源码 | `ed208d3d833895ef2cf1326f9e8f97c96882dcf9` |
| Worker/helper 新 release | `20261006T152340Z-339dc621b3f6bce5` |
| manifest | `e063e212160005f0ccfdc281b7d747b9bbc10e91321add3fbdb350738c46cebf` |
| 本次已消费 rotation plan | `f87137b65f91ef1cf90671bd225492fffcfbc26e6ba29f2b5d01442bc7508907` |
| successor / consumption | `ae958aeb60539513e32305900109265995cb2b69f8a4ed6d1af9ba306b9f954e` / `1460d6fbdc4af75a950650b681ed6a5c4ec916f81f99861027e3110741b9b493` |
| Django 安装清单 | 保持 `d7394a0e9736eb7378d20f8d1080abfde17ba4aec02981a887a8d7bc97b2464e` |
| 数据库迁移 | 保持 140，迁移表行摘要前后相同 |

十个 UI 文件的候选内容与已验收 Git 源码一致，原完整候选、guard、安装入口及前驱校验通过。在线 plan 仅准备，真实 apply 后才形成已采用绑定。同期 main 另含广东备货计划入口及客服解析器后继；本次**未采用**这些后继，不把后续文档/main SHA 当作正式构建来源。

## 受控执行

原 Worker-only Stop / 精确 apply / 唯一 Start 均取得真实直接控制器 exit 0，没有杀业务进程、跳过校验或直接启动旧包。未执行 EnterMaintenance、Django 部署、生产迁移/回填、扩权、n8n 定义或启停、业务补跑及外部测试消息。

- Stop：北京时间 10 月 6 日 23:54:31–23:54:42。
- apply：23:55:57–23:59:27。
- Start：10 月 7 日 00:00:35–00:02:47。

这是控制器维护区间约 8 分 15 秒，不冒作逐秒 HTTP 不可用时长测量。最终原 resolver / 启动绑定 / 12 组件 Running、Ready、exact_release 通过；17 份实际页面资源逐字节匹配候选。原 25 个后端、PostgreSQL、n8n 监听 PID 与 UTC 创建时间在切换前、启动后及最终回查均保持；没有后台组件重启来掩盖 UI 问题。

## 生产交互与范围验证

真实账号、空浏览器 profile 的实际正式 Home 上验证销售、库存、商品，所有观察到的业务调用为 GET：

- 销售连续选择两项、取消/搜索与焦点、原面板节点保持、编辑时不请求；统一应用后的 URL 和实际 core/full 请求携带两个平台。
- 库存连续逐字输入、光标中间插入、清空、Chrome composition/提交及两个健康状态统一应用；库龄页持续输入和切页草稿行为通过。
- 商品两平台连续选择，initial-page/overview 完整参数，排序保留单选关闭语义。
- 在正式浏览器的受控传输接缝注入迟到及 400 失败，故意忽略 abort，旧无匹配结果不能覆盖新范围；失败后继续编辑、重试不覆盖草稿。此项验证客户端栅栏，不称后端真实制造故障或复现全部慢查询。

五个正式响应由原 decoder 校验：销售 core/full、库存 summary、商品 initial-page/overview 均 200。固定九月销售及商品完整响应摘要和 revision headers 前后严格一致；库存完整业务字段一致，仅 `readSnapshot` 变化，未推断其底层变更原因。新增多选/完整参数的开发后端行范围证明及其他日期边界见 [开发报告](REPORT.md)，未冒任意范围/生产 P95 或所有浏览器、所有页面验收。

原生 Windows 验证尝试在自有 Chrome 窗口进行。**computer-use 自动安全检查拒绝 Windows 浏览器状态采集，原因是无法足够可靠识别当前 URL**；按 [computer-use 技能](D:/.codex/plugins/cache/openai-bundled/computer-use/26.930.61225/skills/computer-use/SKILL.md)“stop issuing app input”停止原生桌面操作，没有绕过检查。浏览器协议测试可完成其余验证；真实 Windows 输入法候选窗选词留待人工检查。

## 前后备份、恢复与比较

| 恢复点 | 本次实际证据 |
| --- | --- |
| 前备份 `daily-20261006T152426Z-c3b11b772947` | manifest `591b79be481ca065ab9e21950bf0291f468a5a6c46bd509363fb50f8863c275a`；Backup、Verify、E55910 独立 RestoreRehearsal 实控 0，完整内容及 profile 恢复通过，临时库清理完成 |
| 后备份 `daily-20261006T160534Z-90b9d4aab0c7` | manifest `db5dc8819e5fea08c28cd0f47138de00f0c5f8ce2acdbc221957548b77020fef`；Backup、Verify、E55911 独立 RestoreRehearsal 实控 0，内容 `93622072641981c8159d0920d47886eca4d46da6d93acd52b94f697182f807d4` 一致，profile 验证及隔离清理通过 |

两次恢复均 `productionDatabaseTouched=false` / `cleanupStatus=isolated_data_removed`。原三份/两保护策略保持，最终未决备份/恢复操作为 0。后备份轮换已淘汰本轮未保护前 dump，**前目录不再是现存恢复点**；前完整 manifest（含所有逐表、profile、role、catalog 证据）及校验文件在淘汰前保全，没有复制额外 dump 绕过三份策略。

296 张表集合、49 个角色及设置、完整数据库 catalog 前后一致；迁移表仍 140 行及同摘要。全库 content 不同，业务行数变化为 `market_import_attempts` +1、`market_write_request_receipts` +29；没有冻结 Django/n8n，不能将区间变化自动归为自然任务或本次 UI 发布，也不宣称全部业务表内容相同。保留完整比较材料，可继续独立检查行数未变表的内容变化。

## 自然健康验收与失败保留

前置总控曾出现核心或其他组件未就绪，之后就绪复验通过；上线后也保留了真实就绪超时/503、alert_only、verification_pending 及在途样本。未增加超时、修改看门狗、人工启动看门狗或以重启消除样本；这些历史探针波动的底层原因未在本次修复。

最后两次不同自然任务明确完成：北京时间 10 月 7 日 **00:27:24 / 00:29:24**，采集时任务 Ready、LastTaskResult=0，对应本次新 release、12 组件、四探针与 supervisor healthy / decision healthy。运行中的 267009 和旧健康快照不计入完成验收。最终总控独立回查 Running / Ready / exact_release。市场被动业务观测未知不冒该领域业务全面恢复。

## 交接与材料

完整私有材料位于 `E:/codex-artifacts/shared-filter-production-20261006`：`completion.json`、原控制器记录/stdout/stderr、候选绑定、十文件源码验证、API 前后及库存范围比较、生产浏览器结果/截图、17 资源摘要、原进程身份、完整前后元数据、备份/恢复回执及自然任务样本。未向源码仓库提交正式业务响应、备份或客户数据。

已从“搭建京东客服记录导入工作流”聊天读取用户原始“允许协调”回复，按该明确授权发送有限状态交接。服务及备份/恢复完成后已释放固定源，交接本次实际包/来源和可独立复验的后恢复点；不转移本次已消费计划、不改变备份保护、不代做客服导入。生产记录合并前已 fetch 并正常快进同期 main，正式检出未 git pull。本次授权仅覆盖这次 UI 采用及方案内必要收尾，不授予未来发布、业务补跑或其他修复权限。
