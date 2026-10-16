# 手动学习恢复：交付与发布准备

## 已交付源码

- 应用提交：`70ae0ce5bd5607efdd2eb10162658ade5f11bac8`，已推送远端 main。
- 候选组合来源：`be171dbed61212f076c06a0e5c6300751710a4a1`，在生产来源 `b28562f46af3569be647808756a56758e88cb69c` 上叠加本次已审变更。完整 source-snapshot 字节比较只出现本次 20 个文件，保留现有生产的其他功能和控制工具；组合中的手册沿用生产原路径 `docs/NEW_PRODUCT_WEEKLY_FOLLOWUP.md`，main 中已改名的现行手册继续使用其新路径。
- 候选工作树：`D:/codex-isolated/new-product-learning-receipts-20261016/source`。制品仍引用该目录时保留，不作为闲置开发树删除。
- [实现与验证报告](REPORT.md)；[离线合成演示](learning-recovery.html)。演示不是生产业务页面或上线证明。

## 准备结果

范围计划为 `combined`：Worker 与 Django，`migrate=false`，数据库保障为 `verified-current`。没有新 migration、schema 变更或业务补跑。

- Django PrepareApp 已成功：`e624d589871a4569a6c4b9f8813e061f`，回执 SHA-256 `f4e865548eecd7edc9fb804abf0d22012d7bea1e3af49ab468dba3d9a4179743`；候选 manifest SHA-256 `bca8f726057b5efafb4de8fc1ba02e7b9363ce8e0d8ae47046b22f6fb9293e34`。
- Worker 原 `plan --prepare-online` 已成功：候选 `20261016T024726Z-5f67fb6556bbf885`，manifest SHA-256 `2b3efdf088aeec51484a29cd3abaf34999ef8f8b3e9440eb17ac667e04712e8b`，plan SHA-256 `172e06ed003bc413a382b971fc3107e576da7e94501c0568c10e1775679310b1`。原准备进程已退出，上海时间 2026-10-16 11:02:49 保存 prepared 结果；未激活。
- Django 制品完整字节差异已审：仅四个 workflow 源码、原部署 manifest、原 local R2 smoke 重建的 CF 缓存及依赖清单排序。排除项完全沿用原指纹规则中的生成字节码；34 项依赖按 path 的映射完全一致，依赖载荷无字节变化。原始完整清单和摘要见 `django-artifact-diff.json`、`django-nonsource-diff.json`，不把排序差异说成原始 JSON 逐字节相同。
- 当前备份 Verify 观察为暂缓：已有 `automation-drain` 处于 requests 阶段，原已安装维护工具明确返回 `defer ... without replay`。保留 `current-backup-verify.log`，未绕过或重放，不声称已取得本次有效 Verify 回执。

全部原件位于 `D:/codex-artifacts/new-product-learning-receipts-20261016/`，包括 `composition.json`、`scope-plan.json`、`source-binding.json`、`worker-preparation-state.json`、`django-prepared.json` 以及原测试日志。

状态分开记录：**源码已合并推送、两组件制品已准备；当前生产准入未满足，尚未上线。**制品依赖闭包与现有前驱仍须在实际发布边界按原工具复验；备份 Verify 暂缓不由源码或制品成功覆盖。

独立审查已直接核对完整 source-snapshot 的 20 文件差异、主线任务字节绑定、Django 依赖与非源码差异、两组件原回执和实际计划/manifest 文件 SHA-256；未发现额外业务或依赖变化。没有重跑已有效的功能测试。

## 上线与恢复边界

本轮没有上线授权，未执行生产排空、Stop、Restart、apply、DeployApp、数据库迁移或模型配置变更。候选准备不改变当前生效版本，不将“已推送 main”或“构建成功”表述为上线。

取得对应授权且既有门禁允许后，核验原生产前驱、制品绑定及现有备份，通过原唯一生命周期流程切换两组件；生产前驱或源/配置绑定变化则先按原工具失效规则处理。已通过且字节闭包不变的验证不重复执行。

应用恢复使用原受控兼容版本或前向修复；已写回执和业务数据保持 PostgreSQL 权威，不删除回执来重跑未知操作，不用旧 D1 路径恢复。发布后仅确认目标版本、部署成功与必要服务可用。
