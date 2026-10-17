# 吉客云凭据路径与后台自检

2026-10-18；本任务落实用户要求的三项：固定后台凭据路径与身份、正式 helper 自检、无窗口和重启后的执行验证。

## 已确认事实与限制

- n8n 10037 在上海 10 月 18 日 00:10 的 B 节点返回 DPAPI `missing`，目录/文件查找均为 false，Win32 文件错误 3、目录错误 2。A 已成功，后续 C/D/E 未运行；原计划 exports 为空。
- 9740 类似失败；9778 完整成功。当前正式 helper 的 Windows 用户、六项非秘密目录环境与当前终端一致，凭据库存在；正式 bundle 的私有只读副本在主线程/Worker 中均能返回 ready。因此没有证据把该次历史故障唯一归因于环境变量错误，原失败保留。
- 对比实验在隔离子进程中故意将 LOCALAPPDATA 指向不存在的目录：原正式代码主线程/Worker 均 missing；新代码使用实际 Windows Known Folder，主线程及三次新 Worker 均 ready。只调用 status，未输出凭据、修改凭据或平台登录。此实验证明已消除环境路径继承这一失败模式，不证明历史午夜故障已彻底解决。

## 修改

1. 默认凭据路径在原 PowerShell 子进程内由 Windows 当前用户 LocalApplicationData 已知文件夹解析，setup/status/read 共用；缺失/非法已知文件夹失败关闭。保留 CurrentUser、原 tenant/Profile 绑定、ACL/owner/reparse 校验。显式目录只保留原内部函数测试接缝，不新增配置、命令行或 HTTP 覆盖。
2. helper 启动独立只读 Worker 自检，完成并退出后才接受结果；20 秒后状态失败关闭，输出严格白名单。子进程只有在父线程授权且期限未过时才能启动；超时后取消并等待原 PowerShell close 和 Worker 退出，清理未确认前保持 blocked/pending，不新建检查。健康状态只读缓存，每五分钟最多刷新一次并合并并发检查。失败不阻断其他平台或改变 helper 的业务 slot。
3. 真实吉客云业务 Worker 的 A 在原入口核验后、恢复派发记账及创建计划前新鲜检查，避免凭据不可用时留下新的采集计划。原失败/闭合/恢复授权与导入幂等保持。

## 验证

- `node --import tsx --test tests/jackyun-dpapi-login.test.ts tests/jackyun-credential-health.test.ts tests/tmall-isolated-helper.test.ts`：25 通过、0 失败、0 跳过；包括无控制台、CurrentUser 合成密文往返、错误绑定、损坏密文、暴露 ACL、非法已知文件夹、诊断脱敏及 Worker 异常退出、延迟启动、超时迟到 ready 拒绝、挂起 PowerShell 取消后 PID 确认消失。
- `node tools/test-jackyun-credential-readiness.mjs`：原 helper builder 打包后，在私有副本中仅将 Windows Known Folder 原生调用替换为合成目录边界。后台进程两次启动成功，错误继承路径不影响检查；实际业务 slot 的 A 成功；启动检查成功后破坏合成凭据，A 拒绝且未创建第二计划；凭据目录缺失仅使吉客云状态 blocked。原合成 n8n 字节不变、零浏览器/导出/导入。
- `node tools/test-jackyun-recovery-helper-smoke.mjs page`：真实 bundle/业务 Worker 的原前置恢复路径通过，旧计划和合成 n8n 保持；已增加合成凭据以覆盖新的 A 检查。
- 原实现初稿超出 Windows EncodedCommand 预算，已仅去除固定 PowerShell 程序行首缩进，保留 30,000 字符门槛；最终相关原生测试通过，未放宽门槛。
- 脱敏日志在 `evidence/`。完整私有夹具留在系统临时目录，不入 Git；没有使用生产数据库、下载目录或浏览器做故障演练。

## 独立审查

依据项目任务模型分工，独立审查请求模型为 gpt-6.1-sol / high；工具未返回可独立确认的实际底层型号。审查者发现自检 Worker 直接超时终止可能遗留其 PowerShell 子进程（P2），已按授权启动/取消/close/退出协议修复；审查者独立重跑25项全通过，增量复审无剩余阻断，可合并。

## 交付与采用

代码验证及独立审查后合入 main，由现有固定 main 发布入口交付。此次无数据库迁移。尚未替换生产 helper、重启生产服务或补跑10037；实际上线和自然定时成功须分别确认，候选隔离重启不等于生产重启验收。
