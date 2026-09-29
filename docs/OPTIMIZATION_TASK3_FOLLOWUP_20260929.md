# 第 3 项增量补合并、组合验证与候选更新

日期：2026-09-29，Asia/Shanghai。状态：**源码与组合验证完成，候选仅准备，正式发布仍待用户确认。**

## 1. 本轮范围与主线

用户明确要求“补合并第 3 项增量 → 组合验证 → 更新发布候选”。复用独立 `codex/optimization-integration` 工作区，将 `codex/workerd-memory` 的以下三个提交整体合入：

- `3faa47de`：补充历史 OOM 证据并区分历史耗尽与合成分配增长。
- `88dda323`：Wrangler Inspector 无界缓存修复及隔离验证工具。
- `7114b7d1`：修复交付、曲线和验收记录。

代码合并提交为 `2f1b547076cbafff393eb6952edced73fc545e8e`，包含前次 `7ca3dc15` 的全部集成，第 2 项与第 7 项仍在同一批中。没有文本冲突；未整文件覆盖其他优化，也未改变数据库迁移、备份/恢复代码、锁定依赖版本或在线工作流。

## 2. 安装与组合验证

从锁文件重新执行 `npm ci`，验证新补丁通过现有 postinstall 自动安装。生产 CLI 的 `cli.js` 实际读取本补丁处理的 `wrangler-dist/InspectorProxyWorker.js`。既有 heap 适配函数及 3072 MiB 配置保持。

| 验证 | 结果 |
| --- | --- |
| Inspector、heap、supervisor、自检、启动定向测试 | 26 项通过 |
| 合并后全量 Node | 2,743 项：2,723 通过、20 跳过、零失败、零取消 |
| 独立生产构建 | 通过 |
| 页面渲染 | 20 项通过 |
| lint | 0 错误、12 项既有警告 |
| 后端边界 | 548 模块，0 违规 |
| 完整应用 + 真实 Wrangler 合成负载 | 151 次请求、1,359 次后端调用通过；未处理路径、拒绝签名和拒绝 origin 均为 0 |

完整应用验证使用合并后的编译产物和已修补依赖，仅连接独立 loopback 合成后端。代理进程采样 Private 峰值 **52.996 MiB**，耗时 **93.080 秒**。没有外部 DevTools、堆快照、强制 GC、中途重启、提高堆上限或真实业务消费。这个结果不表示整机峰值，也不能替代生产长期验收；修复前后的独立对照仍见[第 3 项修复报告](WORKERD_INSPECTOR_RETENTION_FIX_20260929.md)。

| 依赖字节 | SHA-256 |
| --- | --- |
| 新 Inspector 补丁 | `ee6e78c50d02eef01d20312ed8e9a72dc75489e6f25ebba1f9869a7db7a0828c` |
| 原 Miniflare heap 适配 | `2b2a89fb96a270e678b4aa87e65aa1282049b18d28a1e30ff7fe7f2736b648c7` |
| 正式旧 Inspector，保持未改 | `17077283a771d0575bb5def67e91c0c74dec9e505d29bd63f8a71c1294c81f8f` |

## 3. 最新候选

候选源固定为 `2f1b547076cbafff393eb6952edced73fc545e8e`，只准备未激活。两套候选已分别回读 Inspector 新摘要与原 heap 适配摘要，当前正式 manifest 和受保护入口保持前驱字节。

| 项目 | 精确绑定 |
| --- | --- |
| 当前 Worker 前驱 | `20260928T112356Z-eeac7bbc96a8c51a` |
| 新 Worker/helper 候选 | `20260929T005710Z-e980ef9414b72995` |
| Worker manifest SHA-256 | `0d2858c324d872f5c1a570e84fb45a0c2363dd74c7d24237ce1adc3cbb0d39b7` |
| Worker 发布计划 SHA-256 | `875bd5bdcfef17af472758a2c135aa8685729d845b285542e543603a6b1b169e` |
| 新 Django prepared ID | `a926376cf4fd4a35a24110a71fd69392` |
| Django 收据 SHA-256 | `867892aa4f58be3f5e0f8f5b88b6f51f105f753c1319a69bc81c414a998ebca9` |
| Django manifest SHA-256 | `fd52d2f4cd8e9ab4ec1a20bac8c528042524fc15e18bb192ecbd04af22061287` |
| Django appFingerprint | `c7418b8a2c6bcb7ab31d7c4a0079e1394ce05e64239186f0e54e4c1808db1142` |


旧 Worker 候选 `20260928T205715Z-8b977fa9a3715321` 和旧 Django prepared `7dbaa5bb0b764ce2a71c9a27e41b5f2d` 只覆盖首次锁定版本，**不得作为七项最新完整成果直接上线**。旧材料保留用于历史追溯，不改写其 manifest、计划或验证结果。后续只选择本节最新精确绑定，并在维护前重新核验前驱与候选。

本机生产主目录 `D:\运营管理系统` 仍保留 `e00d4a82` 的受保护入口，避免在未经批准的维护前改变线上 guard。固定候选源 `D:\运营管理系统-sales-django-release` 锁定本轮代码提交。远端 main 的合并与本机生产切换分别进行；正式维护时按原工具协议同步主目录。

## 4. 恢复证据与生产边界

本轮通过原已安装 operator 再次 Verify 现有恢复点 `daily-20260928T210553Z-26d4cef45619`，manifest SHA-256 `394b9d57d10e34cf14ecfb3a71a7c7c977334d023a78b66cbcd6e0a1bf140cb1`，完整内容 SHA-256 `b64bf28c353b83c80ff77cc5aeb2207c7efa1fd26c2b2931aa7aa337419280f8`。它仍受保护，前次独立恢复 `a5a69d60853e` 的完整内容及角色权限验证、临时清理证据保留。

终检为 Running / Ready / exact_release，12 组件就绪；正式 Worker 仍为 `20260928T112356Z-eeac7bbc96a8c51a`，supervisor/公开 workerd PID 仍为 32412/52044。正式 Inspector 仍是原始摘要，未原地安装补丁；18 条在线 n8n 定义和原每日备份 PAUSED 状态均未修改。


本轮没有新数据库迁移或备份协议变化，沿用前次已通过独立恢复的保护恢复点，不将它描述为本轮新生成的备份。正式维护前重新判断新鲜度；需要更新恢复点时仍遵守三份上限和保护规则，不提前删除旧份或擅自解除保护。

前次基于在线定义准备的 12 份 n8n 候选不因本次 Inspector 补丁改变。采用前仍需重新核对原定义摘要、版本及启用状态；不激活两个历史停用模板，不直接覆盖 n8n 数据库。

## 5. 待确认的上线与验收

继续按[统一上线清单](OPTIMIZATION_INTEGRATION_RELEASE_20260929.md)完成旧协议首次冻结/排空、一次应用维护、Django 与 Worker/helper 成套切换及工作流采用；以本文件最新候选替换旧绑定。正式维护、部署、工作流发布、恢复每日备份调度、整机重启、业务补跑及真实发送均未执行。

上线后同时验证第 2、7 项的诊断、启动计时、错误处理和最终就绪；第 3 项分开观察公共代理、业务 workerd、Wrangler/helper，并关联真实负载和进程创建时间。已复现的 Inspector 缺陷获得了修复证据，但历史各次 OOM 的逐次归因和生产完整业务周期仍不能提前标为完成。

回滚沿原受控应用/不可变 Worker 路径；代码基线标签仍为 `rollback/pre-optimization-integration-20260929`，数据库不因本次代码回退而反向恢复。不得原地修改正式 node_modules、取消校验或扩大堆上限。

机器可读证据见 [本轮组合与候选记录](evidence/optimization-task3-followup-integration-20260929.json)。前次 [统一集成证据](evidence/optimization-integration-candidate-20260929.json)保持历史原貌。
