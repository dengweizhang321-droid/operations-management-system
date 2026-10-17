# 第一批启动稳定性与重复扫描优化

## 范围与状态

用户授权实施“旧记录防复发＋钉钉重复扫描优化”。基于主线 `47e1e89fea914cbc71b44a5055188daa550e558e` 的独立 worktree 开发。本报告描述源码与隔离验证，不表示已切换生产；实际发布由固定 main 发布入口及原生准备/成功记录确认。

没有加入启动全域预检，没有改变数据库迁移、Worker 完整运行包校验、自动化调度或业务功能。

## 修复结果

- 共享服务解析器在当前 PID 元数据不可读时，不再直接丢失“上次开机记录”的恢复分支。只有原记录三项时间全部严格早于本次开机、服务及启动器身份匹配时才认定过期；正常精确进程路径仍没有新增开机时间查询。
- 清理在原生命周期互斥内重读并核对原记录、检查内容摘要及时间证明。并发替换的记录保留并报错；复用该 PID 的系统进程不被终止。Status 对旧记录只返回未运行，不改文件；端口归属与实际启动前检查继续由原入口执行。
- 同步修复登录守护实际使用的 `Resolve-SupervisorProcess`，避免仅修部署停止路径而遗漏重启后的守护入口。
- 钉钉自动启动第一次完整检查后，为本轮两个子入口签发既有的进程、路径、部署清单、时限绑定上下文。正常路径完整 ACL 扫描由三次减为一次；数据库、配置、approval、凭据与进程身份检查保持逐步执行。人工独立启动继续完整检查，上下文在成功或异常后恢复。
- 两个只读诊断生成器兼容新解析器，保留旧版精确转换、全部原身份判断及反向还原证明；生成的只读代码不含回执清理调用。

## 验证

新回归在 PowerShell 5、PowerShell 7 通过，并以普通用户令牌运行：

```powershell
powershell.exe -NoProfile -NonInteractive -File tests/startup-previous-boot.test.ps1
pwsh.exe -NoProfile -NonInteractive -File tests/startup-previous-boot.test.ps1
powershell.exe -NoProfile -NonInteractive -File tests/dingtalk-startup-acl.test.ps1
pwsh.exe -NoProfile -NonInteractive -File tests/dingtalk-startup-acl.test.ps1
```

覆盖不可读 PID 复用、可读 PID 复用、当前开机记录、时间边界与损坏、开机时间不可得、错误服务/启动器、原件替换、Status 不写、健康路径零新增开机查询、守护入口恢复及不终止复用进程。

ACL 覆盖正常 3→1、每个子入口的实时 authority 检查、清单变化完整校验回退、独立人工入口、禁用状态及失败后的上下文恢复。

已有 `django-orchestrated-start-acl.test.ps1`、真实私有 Python 进程的 `django-local-service-process-identity.test.ps1`、`dingtalk-startup-state.test.ps1` 均在 PS5/PS7 通过。Node 定向测试：

```powershell
node --test tests/dingtalk-startup.test.ts
node --test tests/watchdog-native-status-driver.test.mjs tests/watchdog-supervisor-readonly.test.mjs
```

分别 5/5、12/12 通过，后者覆盖新旧生成器输入及 PS5/PS7。`git diff --check` 通过。现有 `django-runtime-supervisor.test.ts` 7/8 通过；剩余静态断言要求源码包含 `app.previous\tools\django-runtime-supervisor.ps1`，在未修改的基线已不成立，已按相同表达式复现，未改生产逻辑或放宽断言掩盖它。

独立 Sol High 审查覆盖控制器、守护入口与诊断生成器增量，通过。请求型号由工具指定，工具未独立返回实际底层型号。

## 性能与采用边界

已有历史样本中三次 ACL 扫描分别约 19.0、16.7、15.4 秒。本次通过行为回归证明消除正常同轮后两次扫描；尚未在生产冷启动配对测量，不宣称已实测节省 32 秒或固定百分比。正常精确进程路径零新增开机查询，热打开入口未变。

变更没有 Django migration，无需迁移安装器或业务数据处理。源码合并与原生制品准备沿既有 main 流程；生产停止、切换、重启和真实钉钉发送不在本轮开发执行范围。原证据及普通权限测试日志保存在 `D:/codex-artifacts/startup-first-batch-20261018`；故障过程与提速方案见 `D:/codex-artifacts/startup-diagnosis-20261017/PREVENTION-AND-SPEED.md`。
