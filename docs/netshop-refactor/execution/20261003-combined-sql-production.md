# 方案二 SQL 与跨域配置组合修复

2026-10-03，Asia/Shanghai。用户选择“先修完SQL，再一次追加维护”，并授权休息期间常规问题自主决策。本文记录准确候选与实际回执，不以结构 Ready 代替五栏目业务验收。首次采用及保留的真实503见 [原采用记录](20261002-production-adoption.md)。

## 已完成源码与独立资格

- peer URL 源码 `8707b9d60092a2697439de5609be0a09df5481ad`，已合 main `33a608b7ebda968ce77dc16f6846fa20b3b1e837`；只补网店 reader 的 Sales/Finance/Workflow 三固定本机地址及环境恢复。
- SQL/期限源码 `21d79ab19e3aef37e0b67df5755c779178859a90`，正常合入 main `ac319dfca7cc8c21307a8bbf008be2c12cea9e31`；远端精确相同，主工作区干净快进。递归店铺发现保留原平台、历史、数据库排序和51成员拒绝；日期查询使用已有索引的64行证明前缀，不能证明时按原完整范围聚合回退，不截历史或缺口。
- 共享读 SQL 复验原绝对期限，不提高单 SQL 7秒、RPC 8秒、整体65秒或2MiB限制；不改变业务指标、批次资格、实时账号检查、权限、索引或迁移。
- 非作者 Q 实际独立 PostgreSQL **47/47**，另7纯期限/取消负例通过；私有数据库60910已正常停止。正式报告 `E:\codex-artifacts\netshop-scheme2-20261003\foundation-review\context-sql-review\review-final-context-sql.md`，SHA256 `DD2FF9DB4D64CBDDC782E294DCCB996758594DF6A8DE0C2A33664DA4C973824E`。
- 原最小只读身份仅做 EXPLAIN、未 ANALYZE，候选使用已有索引；估计成本与隔离时间不冒生产P95。缺少账号GRANT的假说已否定，没有扩权。

## 组合准备与维护状态

已按原 PrepareApp 完成组合准备并独立核对：id `99e085cd17ab4c4c9e1e8a7a9f142fa2`、receipt `a4471ae09ff70f6936ff3ecc60e76794f99b1d8aa7c474853ef84da8a0dcdc1d`、candidate manifest `76f7857203e780758fb2393b10ae735a0e46ba8aaa2dbf3fba32654a2c3a3179`、fingerprint `5b76b77030088834c39f25b82e0dd6b6f1768a191757ba885c32bdd48803aace`。前驱仍 `6929b2c6cc4248c5be84e108c57622419f7f071bfc393b4075d8b198d1c88707`。旧配置单包5bed仅准备，没有单独采用。

原 Worker/helper `20261001T164608Z-4dc26d0ae8921e88` / manifest `87f5e879ca2bb3d797886c859c7452d4a72fffdb8e9ff777cd839d039db368e9` 保持，本次不另 apply Worker。第二次维护ID `3c3dd4a3c51f4dbab9c2b0092f4c54ea` 已生成，尚未执行；完成隔离恢复及最新任务准入后才使用唯一引擎 KeepPostgres / DeployApp / HardenAcl / 同ID Exit / 原Start。

## 备份

新前备份及 Verify 实际完成：`E:\运营管理系统业务数据\daily-20261002T170502Z-8f5c76835ea7`，manifest `c7904ac23a503bb99847cb8ef4a151f1c51d9252d1d19ebd07ddaa1ec937adc4`、dump `8d42bf504db44af114c78bfc6829aea654d606736822c93a8620e4cc137ac868`、content `6ffb67840c3f5fa00f3fc25a2c4e0bffe0762fb2d8fd48947cbf4454b28c8b5f`。独立 E 恢复 `a5b40bb1ca39` / 55897 正在原工具流程中，未覆盖生产。

原保留策略仍最多3份/2保护。首次采用后备份 `daily-20261002T135742Z-51d1f444fb7a` 已被新前备份按原策略淘汰，只是历史验证证据，不能继续当现存恢复点。

## 待完成与边界

组合真实采用、恢复后五栏目原用户浏览器/API、全景六来源、旧入口/01切换、启动及资源绑定、后备份/Verify/自然看门狗两轮仍待实际证据。未把503历史改写为通过，也未把数据缺源当作系统故障。

独立启动链/业务就绪新工具由另一个已交接任务提供，原 baf 候选的健康请求头和未验证PID清理存在两项独立阻断，正在隔离修复；未合未审工具不混入本次Django候选。

本轮已安全归档17棵并额外删除6个闲置本地开发refs；仍有活动预览、独有历史和未知进程依赖的树保留。无业务记录删除、强清槽、手工业务重跑/下载导入、付费模型或主动外部通知；n8n定义/调度与数据库保留。原5413 error及历史根因未知状态保留。

实际顺序回执入口：`E:\codex-artifacts\netshop-scheme2-20261003\production-combined`。
