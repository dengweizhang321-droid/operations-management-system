# AI 模型配置与范围发布生产验收

日期：2026-10-13（Asia/Shanghai）。

用户明确将本次及后续流程调整为按 Git 完整差异选择验证、打包和发布组件。发布范围规划工具及稳定约定已合入 `main`：前端只处理 Worker、后端只处理 Django、仅 migration 变化执行迁移；有效的同提交／同制品证据复用，未知路径升级完整流程。

本次 AI 配置修复复用了已通过的源码验证、Worker/Django 候选和 13:18 完成的 E 盘数据库备份；原隔离恢复在切换前通过。用户调整范围后，没有重复全库测试、打包、后备份或恢复演练。AI 正式验收创建禁用且非默认的临时 OpenCode 模型，验证 `https://opencode.ai/zen/go` 规范化、空密钥保留、高输出／上下文／任务时限／工具轮次和自定义温度参数、origin/协议/CORS 拒绝，然后按精确 ID/版本删除；最终 8 个既有模型清单恢复，未调用供应商推理接口。

登录版本号与监控兼容作为新增范围继续发布。最终 Worker 为 `20261013T091815Z-878966319497c4bd`，manifest `b2d57b6d6e990a1fc2cb6909ce778d887e8b019c491bdd9002f3c416f36d982e`；Django deployment manifest SHA-256 为 `52f0d18a6f0f9c5b9bf78f98fd8bc55747eb83f6f86e6bfd599d0a105db8de12`。登录账号菜单真实页面显示 `系统版本 v0.1.0`；AI 管理真实页面无固定数值上限。OpenCode Go 请求已补齐并验证 `User-Agent`。

监控候选最初漏绑 supervisor 摘要，且旧状态跨两次连续 Django 部署；原失败和零效果补证保留。最终实现只接受当前或精确 `app.previous` supervisor 摘要，并在严格匹配旧／中间／当前摘要、无 supervisor 进程和 desired running 后执行一次派生状态换绑。Django supervisor 为 `running/healthy`。Watchdog bundle `ff4e25622f243fbf733a5cca14eaf0fd2712e03514e4d5dec5bfeffbdfa9ccf0` 已安装；18:20 与 18:21 起始的两轮自然检查均为 `healthy=true`、Worker `exact_release`、backend `Ready`、12 组件为 true、四个 HTTP 探针为 200。

PostgreSQL 全程保留；本轮没有 schema migration，也没有执行生产数据库恢复。日常数据库备份自动任务仍为暂停状态，本次发布不改变其调度。
