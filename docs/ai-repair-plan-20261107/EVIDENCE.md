# 施工方案证据索引

本索引仅保存脱敏结论、路径和摘要。原日志、模型响应、运行账本不复制入仓库。证据为2026-11-07（上海）测试快照，不是持续健康保证，也不是实施授权。

基线：远端 `main` 与所测发布提交均为 `0c7d0feb33f45cfc6ae1f283b81d401c873c5768`；Pi镜像为 `sha256:87e41e7e4d646d779eba8b552a213d5356c4afa935d42dbb618d19fab7e15956`。实施前须重新核对实际版本及当前状态。

## 原件定位

本机链接只在持有这些归档的机器上可直接打开。跨机器审阅须取回同摘要原件，不能只凭表中结论签署通过。

| 编号 | 原件 | SHA-256 |
| --- | --- | --- |
| E01 | [现役功能汇总](D:/codex-artifacts/ai-live-capabilities-20261107/RESULT.json) | `83d74537e002403d7b1a3b9716179eeaa60c9beb828932bbdbeaae1bfab93099` |
| E02 | [现役功能独立反审](D:/codex-artifacts/ai-live-capabilities-20261107/INDEPENDENT-REVIEW.json) | `e954b44eb58cd1dc28959f9d53f7e8decc0053da057c668ef38bbdc6f6521cc0` |
| E03 | [剩余能力补测](D:/codex-artifacts/ai-remaining-validation-20261107/RESULT.json) | `b7f65a745a515f1bbdbb93182dba0e1fc7fb9bb819d36b142df3fd7e2c58b37c` |
| E04 | [剩余能力独立反审](D:/codex-artifacts/ai-remaining-validation-20261107/INDEPENDENT-REVIEW.json) | `d026c48311c307c9345f803b355c27be1768d6a8859e0afa4bf86e429933d6ea` |
| E05 | [Pi容量诊断](D:/codex-artifacts/ai-live-capabilities-20261107/pi-runner-capacity-evidence.json) | `0917fbe8607688183d25c4b32110bbcee75e40c084e69ce2d14fc6505e301e42` |
| E06 | [停止生成诊断](D:/codex-artifacts/ai-live-capabilities-20261107/chat-stop-ui-diagnostic.json) | `bde0e94041ffea37836577428179d3db2e7139b4258a7cf2ec573f0d4cab14b1` |
| E07 | [pandas诊断](D:/codex-artifacts/ai-live-capabilities-20261107/pandas-live-diagnostic.json) | `6252dfb0fc0b2a8f5755e52b7a87589af2025a27a21a6a410fc61afabeaecb3d` |
| E08 | [本人单聊投递](D:/codex-artifacts/ai-live-capabilities-20261107/delivery-live-result.json) | `a0a7b6e311d50726ecd5e17a7baec487316bd51d54cc668ffe87d3a867a27c58` |
| E09 | [投递独立回查](D:/codex-artifacts/ai-live-capabilities-20261107/delivery-independent-readback.json) | `7b4957b7df8cb53ac10837c058c7a8b69388e2fb09fc61f620325ddf61293946` |
| E10 | [剩余能力清理回执](D:/codex-artifacts/ai-remaining-validation-20261107/CLEANUP.json) | `ba517b72a4fcc280573f22bb53bedaf74143398df79b8ed2a6419e0cd4251418` |

## 可采用的事实与边界

| 事项 | 事实 | 不能据此声称 |
| --- | --- | --- |
| 沙箱 | 已有确定性分析、无网pandas容器和Pi执行容器；应复用现有实现 | 需要从零新建沙箱，或服务运行即所有调用可用 |
| Pi容量 | 原请求被session_limit拒绝；8个已退出保留容器计入8个名额，外层映射unknown | 8个容器都能安全删除、旧unknown都可重新执行 |
| 唤醒 | 隔离真实镜像复现：wake未恢复JS执行绑定；正常新prompt重绑定后Python six仍可导入 | 包已丢失、可无条件设execute，或线上已修复 |
| 模型 | DeepSeek短工具JSON/SSE探针通过，但普通/视觉/三报告遇429；Agnes真实Pi增量第二轮DNS超时 | 模型永久不可用、DNS已确定为生产所有异常的唯一原因 |
| pandas | 两来源真实调用失败，内层错误不足；商品日源另外有截断时不能连续完整导出缺口 | 分页缺口就是两次失败的共同根因 |
| 普通问题分流 | 首轮单店+日期+报告等宽泛词会误进推广限制；真实403及纯函数对照一致 | 放开推广权限可作为修复 |
| 回答口径 | 方法选中真实成功，但把转化率写成成交件数/访客数，违反现役成交客户数/访客数 | 文字方法加载成功就等于分析结论正确 |
| 停止 | 真实UI停止后原回执unknown且cancel_requested=false | 供应商已经停止、用户再次点击可重发原请求 |
| 钉钉 | 本人单聊生成成功，投递unknown/provider_unavailable；任务已停用，无下次执行 | 一定没发出、一定已收到、允许自动重发或改投群 |
| 调度耗时 | 三节点样本约16分45秒，人工约35秒，当时有并行任务，观察到节点间等待 | 一次样本已定位全部耗时根因或保证固定提速倍数 |
| 功能配置 | 图片profile为空；两现役模型structuredOutputSupport=none；统一日报enable为409 | 只改开关就能得到供应商不支持的能力或完整生产执行器 |
| 验证覆盖 | 原生11过1败、合法PG场景8过、真实子容器+合成回复协作1过；真实Agnes增量未完成 | 所有生产端到端或五项Skill业务整链都已通过 |

旧7个PostgreSQL测试夹具阻断已通过8个合法隔离场景补验。原仓库测试源码尚未修改；临时夹具不代替正式测试维护。首次夹具错误、运行未知和后续成功各保留原证据，不覆盖成一次全绿。

当前未完成证据仍包括：真实模型自主派工、运行中整树取消，以及原生计划、工作计划、补货草稿、自动补缺、报告投递五项Skill整链。微信接入、市场v2新付费运行和京东/天猫投放属于另外的准入/授权范围。
