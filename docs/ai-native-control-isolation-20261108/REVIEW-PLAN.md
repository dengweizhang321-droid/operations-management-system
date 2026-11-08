# 原生控制链隔离方案审查

日期：2026-11-08。审查对象：`codex/ai-native-control-isolation-20261108`，起点 `0baec367`，显式未合并依赖 `915b94cd`。本次请求模型为 `gpt-6-astra/high`；工具未独立回传实际底层型号，不把请求当作实测确认。审查者仅分析方案，未实施控制器、启动服务或读取生产凭据；唯一写入为本报告。最终实现须由未参与方案/实现的新上下文独审。

## 结论

接受“单一显式、失败关闭的隔离上下文，原控制链消费配置”的方向。有条件可实施，不代表实现或真实启动已经通过。只改总控 URL 或设置 `AllowTestRuntimeRoot` 不足；必须打通原 Worker release、supervisor、Django 各域和 Pi/Pandas 的同一上下文。默认无上下文保持现行生产固定值和门禁。

负责人拟采用固定私有根 `D:/codex-isolated/ai-native-control-20261108`，端口原值加 20000，入口显式路径+SHA、子进程继承并逐层验证。该有限方案可避免任意路径/端口覆盖接口；前提是下列约束全部落实。

## 最小实施约束

1. 上下文存在即验证完整结构、固定私有根/端口映射、真实目录链及非 reparse；缺字段、错 SHA、默认生产 root/端口、冲突参数均在首个副作用前拒绝。独立子入口收到私有 runtime 或隔离标记却没有有效上下文也必须拒绝，不能回退生产默认值。不得把调用者提供任意文件和自报 SHA 当授权。
2. 原始 release manifest 冻结隔离配置值/摘要，并继续绑定 source、protected source、persist、dev vars、helper mutable root、运行参数、进程与一次性预启动凭据。生命周期期间配置漂移必须失败关闭。Worker 的 source/provenance/authority/successor 校验和已部署 Django 清单/ACL 校验仍执行；不通过 `AllowTestRuntimeRoot` 绕过。新增共享依赖进入真实打包/复制清单和摘要，不靠复制后改控制器。
3. 端口映射覆盖监听、DB URL、health Host、跨域 client URL、进程查找、Stop、状态聚合和清理。系统互斥、Worker mutex、后台 receipt/log 绑定同一私有实例；Django 已按 runtime 派生的互斥继续保留。原生产锁不能被隔离任务错误占用或解除。
4. 私有 DPAPI 文件由当前用户生成，角色仍使用原最小权限 provisioning；不得复制生产凭据/业务数据。只允许合成空库、独立 authority/epoch/revision/attestation 和必要控制配置。子进程环境不继承真实供应商、钉钉或云密钥；隔离 `.dev.vars` 和 helper mutable root 均为私有数据。
5. `operations-system-service.ps1` 的 Start → control → worker 唯一引擎及 Stop → worker → Django 路由保持。原总控的 BackendDegraded 退出 0 不能作为此次全栈冷启动完成；要求真实启用域 ready、Worker ready 和 helper health，并记录原进程回执。两轮均执行原 Start→Stop，Stop 后核精确所属进程与端口释放，第二轮保留同一库和账本，不用清库制造可重启。
6. 隔离 supervisor 不启用真实调度，钉钉 startup 配置不得存在；这只是禁止本轮未授权后台动作，不得合成 ready。缺必要就绪时定向补合法 fixture，不降低 readiness。

## 已确认的关键接缝

以下路径相对本仓库；行号为审查时起点源码定位，实施后应按 diff 核对。

| 接缝 | 证据与具体风险 |
| --- | --- |
| 外层总控 | `tools/operations-system-control.ps1:19-35` 固定 3000/5791/Django root；`tools/operations-system-service.ps1:34-44` 固定系统锁、Django root 和 URL。所有后台/Panel 再启动路径也须传递绑定上下文。 |
| Worker 引擎 | `tools/worker-local-service.ps1:41-60,362,443-464,734-819,1683,1842-1844,2028-2033` 涉及固定路径/端口、子 Django 参数、test 合成 readiness、manifest 校验及健康回查。必须彻底绕开 test 成功分支，保留正常完整门禁。 |
| Worker 独立守护 | `tools/worker-local-runtime-supervisor.mjs:337-427,496-529` 使用 imported 固定端口、manifest/helper参数校验、真实身份回执、authority guard、liveness 和 scheduler。`tools/start-local-worker.mjs:14,363-387` 默认 scheduled POST 指向生产 3000；仅改监听端口会把隔离后台请求发到生产。 |
| Worker 来源与 authority | `tools/worker-local-release.mjs:127-139,502-555` 固定 source/devvars/runtime provenance；`tools/worker-authority-guard.mjs:150-161` 有独立 exact-key 和 helper 5791 断言。只改 exported constants 不覆盖后者；新增配置字段须同步精确 schema，不放宽未知字段。 |
| Django 核心 | `tools/django-local-service.ps1:70-120,576,596-611,3236-3348,3543-3544,4147-4250,4722-4968` 包含私有文件、DB URL、固定配置契约、PG身份与启动、跨域URL、readiness及聚合端口；各域脚本 dot-source 后还定义自己的端口，须逐处映射。 |
| AI Windows | `tools/django-ai.ps1:61-79,236,335-343,505,555-596,803-826,835-882` 包含 AI/edge/gateway 端口、WSL keepalive、Pi/Pandas控制与probe。只配置 Django reader/writer 端口无法隔离 Runner。 |
| Pi WSL | `backend/pi_runner/wsl_control.py:41-55` 固定 `TERUISI-Pandas`、user/home、unit、release根及8123；必须使用受校验专用 distro 与匹配 unit，同时保留 systemd WorkingDirectory/ExecStart 与签名 image/source/namespace、Stop unknown 检查。 |
| Pandas WSL | `backend/pandas_runner/wsl_control.py:14-29` 固定同生产distro/unit、8121及docker标签查询；`backend/pandas_runner/probe.py` 使用 protocol.PORT，不能只改 lifecycle 等待端口。独立 distro 的 UID1000 rootless socket/state 亦须绑定，不扫生产容器。 |

Python 配置不能依赖在 WSL 过滤环境时被移除的变量，也不能因变量缺失回落生产。以显式受校验参数/安装配置传递同一隔离身份更可靠。Pi `install_linux.py` 已接受 namespace/gateway-url/精确 source digest；实际服务监听端口还要按原 server 参数配置。Pi/Pandas 包内源码变更会改变严格摘要，应生成匹配隔离安装和镜像/配置，不能引用旧运行摘要或跳过 probe。

## 可复用安装与空库材料

- 原生 Django 安装接缝是 `tools/django-local-service.ps1` 的 `PrepareApp`/`DeployApp`/`HardenAcl`、`Configure` 及原领域角色 provisioning。`Assert-NoUnapprovedProtectedAiMigration` 在1777行起已显式仅对正式 root 生效；私有新库无需伪造生产迁移历史。新共享模块必须加入 `Prepare-Application` 的复制闭包。`tests/release-candidate-package.test.ps1` 可参考复制、摘要、ACL、Wrangler R2闭包，但它替换 stopped/schema 观察，不能直接复用为本次原生启动证明。
- 前轮 Windows 来源/依赖入口：`D:/codex-artifacts/ai-repair-integration-20261108/windows/SOURCE.json`、`prepare.py`、`PYTHON-WHEELS.json`。私有依赖目录 `D:/codex-isolated/ai-repair-integration-20261108-windows/python-deps-r3`，源码及依赖来源见 SOURCE。只能复用匹配锁摘要的安装字节，不复用旧控制器/进程成功结论。PG程序来自已知17.11安装，可作为只读二进制来源；新的 PG data、配置、日志、SCRAM凭据全在本轮私有根。
- `windows/run-windows.py:75-120` 是真实 PG + migrate + AI角色 provisioning + 合成 AI authority/revision/verified migration fixture 的可复用示例；它只覆盖 AI，且原 max_connections=48，不满足原全域120/AI128门槛，不能照搬为全域完成。
- `backend/erp_reference/tests/test_api.py:60-72` 提供空 ERP revision 和 authority 的最小模型构造线索；`backend/erp_reference/tests/test_recovery.py` 有类似空库 fixture。这些 API fixtures 不是完整 readiness attestation，不能机械复制零摘要后声称就绪。真实 readiness 契约在 `backend/teruisi_backend/health.py`，ERP真实摘要/投影规则在 `backend/erp_reference/` 与 `tools/django-erp-reference.ps1`；应对本轮空对象集合实际计算所需摘要，并用原领域工具生成/验证 attestation。
- 未找到可直接使用的“全部领域合法空库一键就绪”夹具。应按原 health 实际要求补必要控制行/角色/索引/authority，明确合成身份，不加载业务事实。`tests/schema_proof_fixture.py` 明示仅为合成历史证据验证器 fixture，不能用于冒充真实备份/恢复或冷启动证明。
- 前轮 Runner安装、空账本和旧unknown保全入口为 `D:/codex-artifacts/ai-repair-integration-20261108/RUNNER-SOURCE.json`、`RUNNER-CLEANUP.json` 和私有 `Codex-AI-Batch2-20261108` 发行版。这里只确认索引可定位，不授权覆盖既有账本/故障意图；优先新unit/state，保留旧unknown原件。

## 必需检查与完成证据

修改后只做直接相关 PS5/PS7 解析、Node/Python入口依赖、默认值不变与隔离拒绝反例、实际私有包复制闭包/摘要/ACL检查。至少覆盖缺/错上下文、生产root/端口、端口占用、配置漂移、错误receipt拒绝；不扩成业务功能验收。冻结候选后按现行 G02 运行固定检查，新资格仅绑定本次确切字节。

随后记录两轮原 Start/Stop 的命令、真实退出码、摘要、PID/CreationDate/manifest/source、全域必要就绪、原 Stop 凭据及最终隔离资源停止；G02的 `packageIntegrity`、`nativeEntryBoundary`、`nativeColdStart` 分开报告。保留失败和unknown；缺一项时不要手填通过。全程不调用生产安装器、不触碰生产root/3000/5791、不合main、不准备正式制品、不发布、不真实外发。

前轮缺口原件：`D:/codex-artifacts/ai-repair-integration-20261108/windows/NATIVE-CONTROLLER-BOUNDARY.json` 与 `DELIVERY.json`，明确 `originalWindowsStartStop=false`、`nativeColdStart=false`。本方案不改变该历史事实。
