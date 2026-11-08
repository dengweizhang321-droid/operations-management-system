# W6R 独立反审

2026-11-08（Asia/Shanghai）。请求模型 `gpt-6-astra`、强度 `high`；调用工具未独立回传实际底层型号。审查者未参与实现，未转派。

**结论：W6R 冻结源码及下列限定证据通过，无剩余本包阻断。** 这不表示第二批 G02、维护控制器字节资格、完整 Windows 冷启动或最终合并交付已通过。两次历史 pandas 失败的实际内层根因仍未确定。

## 来源与独立核验

- 目标提交 `638fd30d`，完整比较基线 `f64a8cca65b6a77b8c4a800725eff0dc1f5b19bc`，18 文件；包含两个 operator、两 PS、四 Node 文件、测试及 W6R.md。同树在途 G02/其他任务改动不纳入本报告。
- 已读共享记忆启动材料、当前根 AGENTS、适用模型/开发/架构/安全/运行/验证发布规范、G02 与 CI 边界；当前这些规范对 `origin/main` 无差异。结合总方案 W6、第一批 HANDOFF、REVIEW-W6A 和 PANDAS-ADOPTION-PLAN 第 5 节审查。首批未变诊断逻辑复用其独审结论。
- 独立复算 [combined freeze](D:/codex-artifacts/ai-repair-batch2-20261108/w6r/W6R-combined-freeze.json) 的 18 个原始文件 SHA、[runtime freeze](D:/codex-artifacts/ai-repair-batch2-20261108/w6r/W6R-runtime-freeze.json) 的 15 份证据、3 份 Node 日志、完整 patch、runtime freeze 本身及运行包 digest，39 项均匹配。完整 patch SHA 为 `d5de639d2f1bdded19990b25a6a6cb29eb6f85171279e4db2d173299c6b368f2`；runtime freeze SHA 为 `5c64aa4e82ee967c3b9bf63e8b9e5aeea4055c68c781b3216227583be4732863`。
- Broker 九个非测试 Python 文件逐一匹配第一批保全清单；重算候选摘要 `5bfb727f33095c0d3e4f9b63644fc0dda8c2b69293a38ea25acf49ca5d3913c5`。原摘要为 `3173042892d14e6edcf8465b8ea97e878f307e08fdb1c81d2752f82e03dcc610`。protocol、probe、首次 create-only installer 和容器策略未放宽。
- 两 PS 当前字节与提交 blob 相同：django-ai `9ec12a53b008e5103ab27fe42f6904f74f8989bad3cc78627e512660f128312f`（BOM、LF）；django-local-service `a7f79bcb98e837e950dabbb0a5485743a774ead22bbeebf662486ec24c6abfbf`（BOM、CRLF）。没有统一换行后冒充原始摘要。

## 跨层检查

| 边界 | 独立核对结果 |
| --- | --- |
| 准备与绑定 | 原 PrepareApp/receipt/source 核验继续使用；专用 root 通道固定发行版、账户、路径及命令，候选文件有数量/长度/类型边界。计划绑定 prepared app/manifest、提交、operator、Windows 配置及 DPAPI 文件指纹、解密后的通道 key 指纹、Linux 配置/key、image、unit、UID/socket/state 和账本 inode。完整 manifest 指纹间接覆盖两控制器及 transport。 |
| 在线无切换 | prepare/check 只创建或核验不可变 release/plan/control 材料，不改现役 unit/config/key/nonce 内容，不发会登记 nonce 的签名 status。已配置与未配置明确区分，复用前检查配置状态与计划是否漂移。准备残片和既存未完成 intent 失败关闭。 |
| 停止与切换 | Windows 原安装完整性、维护 ID、发布 owner/租约、整栈停止及 keepalive 证据在切换前检查。Linux 本域锁内复验精确 unit/MainPID/进程、端口、broker 文件锁、标签和命名空间零容器；先 create-only intent，再单个 unit CAS、fsync 与 daemon-reload。没有删除容器或覆盖账本的分支。 |
| 启动与完成 | `switched_stopped` 明确不是 ready。原 Start-PandasSandbox create-only 登记 attempt，经原 systemctl、严格签名 status 和合成自测，并以前后 PID/invocation/startTicks 绑定启动回执。Complete 只验证原回执与同一 intent；初次完成核当前精确身份，已完成同一回执可复用，不再 Start/自测。 |
| Node 编排 | 运行 Python 文件增删及重命名两端触发依赖。实际顺序为 PrepareApp→专用 prepare/check→PREPARED→原维护→Deploy/Harden→switch→原 Start/VerifyStartup→Complete→SUCCESS。缺计划及复用漂移在 STARTED 前拒绝；tail 自身也拒绝缺准备/切换证明，不能只靠调用者摘要。 |
| 未知与 Pi | switch/complete 失败保留原 STARTED/FAILED，不自动再次 apply、不换 ID、不回滚单元或重放业务。Pi 协议未改；Pi resume 明确拒绝携带 Pandas 轮换的发布，不能借其续接绕过本域启动证明。Complete 补证不等于整轮发布自动恢复；未完成发布仍须原精确证据及另行适用的恢复路径。 |

## 原件证明范围

已阅读测试实现及原日志，不为本次反审重启原生成功用例或全仓重测。

- [native-run-05](D:/codex-artifacts/ai-repair-batch2-20261108/w6r/native-run-05.stdout) 与[原生回执](D:/codex-artifacts/ai-repair-batch2-20261108/w6r/native-rehearsal-observed.json)支持独立 WSL、root-owned release/unit、UID1000 rootless Docker 的实际 prepare/CAS/reload/启动。严格 probe 拒绝错误摘要/镜像，旧 nonce 在同一账本继续被拒绝。intent 后和 unit 替换后故障保留未知并拒绝重放；原生最终 unit inactive、MainPID 0、18129 零监听、本域零容器。
- 两来源使用真实 Django 导出代码与合成来源响应，经同一真实隔离容器形成 DataFrame：商品 2 行、品类 1 行、净额 −300 分；十个脱敏 journal 阶段与请求摘要关联。不能据此声称历史两次失败已定位或生产业务验收通过。
- [Windows PS5 参数/复制](D:/codex-artifacts/ai-repair-batch2-20261108/w6r/windows-ps-fixture-01.txt)实际执行未配置路径和应用复制，核三项新增工具闭包。[启动接缝](D:/codex-artifacts/ai-repair-batch2-20261108/w6r/windows-startup-seam.txt)执行当前 PS 原函数、真实 Linux 身份/签名探针/自测及重复 Complete；Windows keepalive、安装保护、租约和 transport 接线使用私有夹具。它不是配置后的完整 Windows 服务栈冷启动证据，也没有实际调用生产固定 transport。
- Broker 16 项中 13 通过、3 个 Linux 用例在 Windows 跳过；原生 Linux 证据另列。Pandas Node 新增 10/10。相关 99 项首轮 98 过、1 个旧 readiness 短预算断言失败；同字节孤立重跑该项 1/1 通过，原失败仍保留，不改称首轮全绿或已证明其时序根因。

## 交接边界

未发现需要返原执行者修复的 W6R 阻断。整批负责人仍需用本批精确控制器字节完成 G02/维护资格的独立闭合；不能借本报告扩大既有有限资格。正式制品只能在合并授权后绑定最终合并提交准备，生产切换仍另需上线授权和现场动态门禁。

本审查未修改被审源码、Git、生产目录、正式制品或 WSL 运行状态，未调用真实模型或发送消息。仅新增本报告及[机器回执](D:/codex-artifacts/ai-repair-batch2-20261108/w6r/W6R-REVIEW.json)。长期记忆由根负责人统一更新，避免并发改同一项目笔记。
