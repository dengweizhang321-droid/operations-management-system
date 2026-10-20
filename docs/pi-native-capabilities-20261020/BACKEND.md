# Django 权威与中央工具交付

本范围源码已完成，未执行功能测试、业务调用、付费模型请求、正式迁移、服务启停或外部发送。必需代码检查见 [backend-code-checks.json](backend-code-checks.json)。

- 中央注册表新增 `mode_set`、`plan_save`、`agent_spawn/list/send/follow_up/wait/cancel/close` 九个工具及 Django consumer 薄适配；权限与业务事实继续由原服务拥有。
- `PiNativeState` 保存根树模式、准入 epoch、模式/计划/树版本。所有模型、本地工具、中央业务工具和业务效果前准入核验根树权威；树版本用于用户批准 CAS，单独增加子代理不使父运行失效。模式切换先封锁新准入，原操作取消后按原控制身份下发并观察签名排空回执；未知保持切换中。执行批准只能由真实用户绑定当前计划、模式、树及范围。
- 子代理使用独立 `PiSession`、operation、容器能力与模型/技能快照；消息、后续队列、依赖和等待均持久保存。根轮结束不会结束子树；等待先登记再观察，不占子执行槽，唤醒在同权威锁内重新取得槽位。默认根树三个并发子运行，首次建树可由 `PI_MAX_CONCURRENT_CHILDREN` 配置。
- 文件交接保存不可变源文件、目标、双代际、范围与 SHA；每次传输重新授权。原用户业务意图只有一个委派所有者，允许沿直接后代以原 intent/action 身份做版本 CAS；撤销、过期、取消、代际/范围变化和未知结果拒绝新增效果，不新建业务写源。
- 问卷保存原问题与 tool call、operation、generation 绑定，一次回复验证全部问题，取消/过期/重复回复独立处理。答案只提供信息，不构成业务授权。
- 原插话控制支持目标代理；停止在后端先清队列再 abort。历史分支保留文件和业务事实，关闭已终结旧子树，已有计划复制为新草稿。模型/思考强度在安全点生效，保留请求/实际/待生效档及能力交集，包含 `max`，不输出私有思考。Skills 保留全资源 manifest，原生 metadata 不再要求正文自定义 version 或 name 等于目录。

迁移为 `0087_pi_native_capabilities`，新增七张空表，无业务数据迁移。三张证据表为 SELECT/INSERT，其他四张为 SELECT/INSERT/UPDATE；reader 不新增 Pi 业务表读取权限。迁移导出 `TABLES`、`APPEND_ONLY`、`IDENTITIES`、`STATE_GUARD`、`EXPECTED_CHECKS`，`pi_native_health.verify_native(permissions=False)` 支持原生安装期 catalog 检查。角色、readiness 和备份清单均已接入。

Python 15 份文件语法、Django 静态模型检查、无连接迁移图/模型闭包及清单/ACL 检查通过。修改的两个 TypeScript 文件诊断为零；全仓另有 213 项其他文件诊断，不作为本范围已通过全仓类型检查的证明。运行行为和功能效果由用户上线后自测。
