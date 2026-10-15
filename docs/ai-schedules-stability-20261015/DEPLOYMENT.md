# 隔离候选与正式准入边界

本轮用户授权完成 AI 定时任务与广东仓隔离试点；生产发布另行授权。候选绑定最终试点分支提交，构建及打包只在隔离目录执行。源码已验证、普通构建通过和正式可部署分别判断。

## 已确认的正式契约

1. `tools/django-local-service.ps1` 的正式 `PrepareApp` 先执行 `Assert-NoUnapprovedProtectedAiMigration`。现有 Jackyun audit active 分支通过 `jackyun_audit_addition.successor → verify_active → source_delta` 精确匹配原基线加原两项迁移，本次 0083 不在集合中。
2. `tools/postgres_no_key_backup.py::verify_receipt_generation` 只接受明确的 138/139/140/142 migration catalogue。新增 0083 receipt 后不属于这些旧代；没有新密钥也不能因此绕过 schema 准入。
3. 本次没有实际执行正式 PrepareApp 或正式备份来触发拒绝。以上是源码可证明的边界，不能写成生产已发生的拒绝事件。

依 [开发与交付](../规范/开发与交付.md)：“检查失败、证据不完整或镜像与生产契约不一致时不得合并。”因此试点分支推送保全，不合入 main；不改正式门禁、旧准入清单或备份规则，不用其他 RuntimeRoot 的成功冒充正式准入。

## 本轮候选

- Worker：普通隔离生产构建，不安装、不激活 immutable release，不复制正式 `.dev.vars`。
- Django：最终提交的 backend 源码包及迁移清单，和 Worker 构建一起生成 SHA-256 manifest；不是正式 PrepareApp 收据。
- 发布范围：AI 适配/定时执行、广东库存只读投影、前端配置与状态、0083 migration；无队列隔离或新执行器。

具体提交、构建摘要、离线包位置和 Git 推送状态由候选目录的 `delivery.json` 记录。由于正式准入尚未实现，状态为“隔离试点已验证，正式制品未就绪”。

## 后续进入生产准备时

先绑定真实前驱和精确 0083 字节、列与约束，形成窄范围 schema addition；独立审查迁移准入、旧代兼容、新代备份与隔离恢复。通过后再同步最新 main、合并推送并从最终合并提交准备正式 Worker/Django 制品。不得只增加迁移计数、允许任意 `0083+` 或自动启用受保护角色。

正式发布仍须用户当次授权，并按完整 Git 差异生成范围计划；本次没有生成生产迁移批准、恢复许可或自动重放许可。
