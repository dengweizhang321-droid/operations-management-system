# 吉客云 4726 凭据查找失败：恢复候选

## 已采用的修复

2026-09-27，共享 n8n 错误分类器新增 `challenge_present|waiting_login` 终止规则。源码 `4dc612ac` 已合并并推送 main；正式发布版本为 `e477fdf4-ccf2-4e4e-bad4-ba8bff7b2d54`。发布前 n8n 一致性备份 quick_check 通过，18 条工作流只改变共享错误流程的分类代码，吉客云原发布版本、调度、节点及连线保持不变。原 DPAPI 精确零业务效果标记与 503 重试仍可用。

原 4605 按现有 operator 复验精确计划、n8n 证据及四条效果路径不存在后 create-only 闭合，回执 SHA 为 `dccd2ccf7c6e651c6ad4951f47f89fd78644b806b808ac626e0aec522dc7fe0a`。原记录没有改成业务成功。

## 完整测试发现的新阻塞

一次原 n8n 手动完整运行 4726 于上海 09:49:15–09:49:21 在 B 节点失败，错误为 `waiting_login：吉客云 DPAPI 凭据配置或解密未完成（missing）。`。C/D/E 均未执行；原计划 exports 为空、无 exportIntent，浏览器事件、下载、验证和导入目录全不存在。active 现指向 4726，尚未闭合。

凭据只读 status 返回 ready；主线程与隔离 Worker 线程独立探针均返回 ready。正式 helper 的 LOCALAPPDATA/APPDATA/USERPROFILE 与调用者一致；部署版 DPAPI 程序与源码字节相同。凭据未改写，未输出明文；这些检查不能证明业务运行瞬间的查找失败原因。没有将 provider false-negative 认作已确认根因。

销售权威仍为本机 Django/PostgreSQL，revision `39:39`、截止 2026-09-25、throughYesterday=false。不能宣称五表恢复。

## 待采用的候选

- 只为精确 4726 增加人工恢复例外，绑定原 n8n 证据摘要、计划摘要、执行时间/节点/错误及四条零效果路径。仍复用原锁、create-only 回执和后续完整 execution 门禁；原计划、active 和失败历史保留。任意其他 missing、迟到效果、摘要变化、在途执行或重放原 B 均拒绝。
- missing 诊断只增加 PowerShell provider、.NET File.Exists 和 Directory.Exists 的布尔值，不记录路径、账号、密码、密文、凭据内容或绑定身份。额外存在性观察只用于诊断，不能授权读取被原检查拒绝的文件；missing 仍不自动重试。
- 这份候选不声称已修复间歇性查找的底层原因；用途是精确解锁已审核的失败，并让后续相同失败具备可判读证据。

验证：48 项相关测试通过，包含真实 Windows 合成 DPAPI/无控制台测试、模拟 provider 假阴性仍拒绝读取、精确 4726 恢复、15 类证据/路径变更拒绝；相关文件 ESLint 无错误。独立 helper 构建与 Node 语法检查通过，bundle SHA `b12a2cb1f68622e757953fff8bd873c8aad3b79fb68851763e80b52a5aaeb5cc`。候选对正式 4726 的只读恢复 plan 通过，未 apply。

构建及 n8n 原始备份只保存在本机 `E:\TERUISI-candidate-artifacts\jackyun-login-recovery-20260927`；原始数据库备份不得提交 Git。

## 采用边界

候选未部署、4726 未闭合。采用需要明确的 Worker/helper 短暂停服授权：等待原共享任务空闲，完成原发布备份/独立恢复门禁，仅通过既有不可变 release 和唯一生命周期入口切换 Worker/helper，保留数据库及 n8n；回读版本/启动绑定/完整就绪后精确闭合 4726，再从原 n8n 手动完整运行一次，并独立核验五表批次与销售覆盖到 09-26。若仍失败，保留新证据，不自动扩大恢复例外或反复补跑。
