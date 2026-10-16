# 手动发布依赖下载中断

- 原尝试：`publish-d6a2e7ea39d1` 的 `FAILED.json` 为前端候选构建阶段 npm ci `ECONNRESET`，exit=1，`maintenanceStarted=false`。npm日志同时存在失败后的目录清理EPERM警告，主要失败为连接中断，未证明EPERM导致下载中断。
- 只在手动发布driver子进程环境设置 `npm_config_prefer_offline=true`，让npm优先复用本机缓存，缺失时仍由原npm下载；保留原npm ci、完整锁文件、安装脚本、完整性及版本/维护/互斥门禁。不修改全局npm配置、registry或依赖版本，不自动重放发布。
- 验证：独立worktree使用同一package-lock、Node24.18.0及bundled npm11.16.0执行 `npm ci --offline --ignore-scripts=false --no-audit --no-fund` 成功，609个包43秒；原heap和InspectorProxy补丁postinstall通过。离线安装证明本次锁文件所需依赖可完全使用已有缓存；不能据此承诺未来不同锁文件无需下载或固定发布耗时。
- 原失败STARTED/FAILED及进度日志保留，新入口绑定最终修复提交，由用户手动点击。没有执行真实候选构建、生产维护、部署、迁移或服务启停。
