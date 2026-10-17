# 原2f875fb0发布的启动项路径修复与有限续接

2026-10-17，用户手动发布目标 `2f875fb01c790c5539d407bae5acf9c90aa33612`，15:20:55（上海时间）在前端apply的InstallStartup停止。与此前准备阶段失败不同，本批已完成后台部署、ACL、TmallWarehouse147→149（0016+0017）的Install/ProvisionRoles/Finalize，successor及sidecar也已发布，链尾为新candidate，但consumption尚缺，维护仍保留，Worker/helper与业务服务停止，PostgreSQL5432运行。不能重新执行普通publisher或重新进入迁移。

## 根因及只读现场证据

- 原有限发布环境的PATH条目使用 `C:/Windows/...`。原PS5 `Get-Command powershell.exe.Source` 保留了斜杠表示，COM `.lnk.TargetPath` 则规范为反斜杠，原严格字符串比较拒绝覆盖旧快捷方式，尚未调用原Save函数。
- 在原冻结环境只读运行原candidate的 `Test-IsControlledStartupShortcut`，controlled/targetMatches均false；仅将PATH条目按 `path.win32.normalize` 处理后均true。同一PowerShell、原manifest及service字节未改变。旧lnk仍是09:32前驱绑定，无本次临时/backup；PID9332已退出。这里仅证明原InstallStartup未写启动项，不把整个已激活apply说成零效果。
- 原native resolve确认sequence243、candidate `20261017T063128Z-5d4113ddb3c5cada`、manifest `bf272f0f…33aeaa`、原plan `c7d3bf12…8f1484`、链SHA `e1459ed6…ca2346`。新环境下原候选完整verify真实通过 `status:verified / processState:stopped`，无预启动许可写入。

## 修复与原批次续接

常规修复只把 `publisherEnvironment` 构造的PATH统一为Windows格式；不放松原shortcut身份要求、环境哈希或制品完整性，不热改不可变运行包。已封存原build环境摘要保持；恢复宿主从原有限环境派生，仅PATH表示变化，目录集合、顺序及实际程序不变。

`续接本次发布.bat` 只接受这个已激活链尾且缺consumption的原批次：原maintenanceId `a6aafa9d2cc1448b954a98d7f4bd653c`、operationId `c1f782ee873241589c011e7f466b5d34`、维护/排空版本及runtime、PG保留/已停、全部保护入口已等于candidate、旧启动项字节/文件身份不变、原进程及后代/原publisher不在、原始记录与149 active/finalized均匹配。孤立consumption侧文件、混合入口、异主、身份不明或原件变化均停止。

安装器先核硬绑定原plan及双manifest，再以stdlib/Git完整核验封存source inventory及本地传递依赖，核candidate/predecessor全部keyFiles后才加载原代码和PS库。运行器重复先验；不加载release-batch/TypeScript，只使用有限的原PS JSON/base64 argv协议。配置原始SHA由BAT显式绑定，driver/helper、Git/Node/系统PS及115项原件/执行输入封存。

用户点击后，在原rotation lease及owner门禁内，调用原apply已存在的 `activated` 精确恢复分支，原installer遇到全candidate入口会skip，只由原writer完成启动项及consumption；不再发布successor，不手写consumption或快捷方式。随后原同ID ExitMaintenance→Start→VerifyStartup，检查实际head、Django清单及带头ready JSON，才生成原attempt最终SUCCESS，附恢复协议、旧失败SHA、完整schema原结果和11个恢复started/result记录摘要。原STARTED/FAILED一字不改，不伪造旧WorkerApply-result。

新恢复开始记录出现后任何步骤未知，下一次点击停止，不重放Start/Exit/apply。已有成功还必须绑定全部main/plan/组件/operation/maintenance/schema/步骤原件，并作新鲜shortcut/consumption/版本/ready核验，不能仅凭两个字段或HTTP200报已完成。此入口不是通用重试器，不支持pending或record_incomplete。

## 验证及交付边界

- 新恢复14项、真实Windows PS5/COM路径1项、原队列/安装/实际环境12项、原rotation25项，共52项不同定向测试通过。包括原startup失败后同plan恢复、真实COM启动项重绑、错head/维护/孤立侧文件/活进程/混合入口、各种迟到或丢回执、外来SUCCESS/缺步骤/篡改result、修改或新增传递源码拒绝加载。
- 独立Astra High规划、独立Sol XHigh关键复审；实际底层型号未独立确认。复审发现并修复来源加载早于验证、传递依赖、成功回执绑定不足两类问题。独审实际15项及真实只读115输入检查通过，无剩余阻断。
- 安装器 `--check-only` 真实通过，不生成执行入口、不执行生命周期。最终安装后还需实际运行 `检查本次续接.bat`；该检查仅确认输入和现场元数据，不代替用户执行时原生完整复验。结果、最终提交、工具/配置SHA写本机交付证据。
- 本轮只修复和准备用户手动BAT，没有代用户apply、退出维护、Start、写启动项、重新部署后台、执行Install/Finalize、备份或回滚数据库。交付时服务仍在维护，只有用户运行续接并得到真实成功后才算恢复上线。无需为本次续接重新打包应用。

证据目录：`D:/codex-artifacts/manual-main-startup-reconcile-20261017/`。原发布包、原schema149材料、原失败和不可变运行候选继续保留。
