# 三批 AI 修复整合与隔离启动报告

2026-11-08。**三批代码已整合，AI 范围的真实组合进程启动及签名接线通过；完整 Windows 原生控制链冷启动仍未完成，候选保持未合并。** 不把部分启动证明写成全系统就绪或正式可发布。

## 候选与来源

开发分支：`codex/ai-repair-integration-20261108`。工作树：`D:/.codex/worktrees/c5d6/运营管理系统`。最终提交和推送核验见外置 [DELIVERY.json](D:/codex-artifacts/ai-repair-integration-20261108/DELIVERY.json)。

| 来源 | 精确提交 | 整合方式 |
| --- | --- | --- |
| 执行时最新 main | `0c7d0feb33f45cfc6ae1f283b81d401c873c5768` | 独立树起点；收尾 fetch 仍相同 |
| 第一批 | `265ef9bb7ad240dfbd9b92c18bdffd73a728040c` | merge `cb32e58d133d713902b3f904aa8aa241a317987a` |
| 第二批 | `837f4bf5d18a4ba61030cf1e243e9c28b4882c22` | merge `6535c361bfdd416c0280bc6632344418618c9b9b` |
| 第三批 | `93a349fc5fc435696463f3b80654077f7d7aaa7f` | merge `557b497dc0fe42f3693a0c6c76320a4833b46b49` |
| 组合 G02 适配 | `28a57cd23edaae7f64defcc12a70f0d037a5b49e` | 精确组合资格及直接检查 |
| 固定 G02 受检头 | `66a9bfa11cc9dd802c09640726ec820c66d156d7` | 应用运行输入与 `557b497d` 一致 |

三批头均为组合祖先，保留原提交、报告与反审。初始合并完整差异为 166 路径；111 个应用及关联文件与第三批已审离线投影逐字节相同。后续新增代码只有组合检查器及验证器适配，无新应用行为修复、无 migration 变化。[来源及显式依赖](D:/codex-artifacts/ai-repair-integration-20261108/SOURCE.json)

W6a `7caf36f0`→`73f3b866` 的稳定 patch-id 为 `e5f44055694f6e843d5d0aa3d4f2ddb5a93c137f`；W3 `79ac59cd`→`ec71bd21` 的 transport 部分为 `d55caa3597aadc07d6f814b771aa355bc7cd55f6`。依赖补丁等价，未重复 cherry-pick。

## 冲突及范围

原七处应用冲突沿既审决议：四个 pandas 文件采用已包含 W6a 的第二批；发布器同时保留 Pi 镜像选择和 Pandas 轮换；资源库保留正确转化率口径及提炼方法约束；工作台同时保留模型选择、运行模型显示和方法发布区。十个 AI 导航入口保留。

新增验证器冲突分别保留三批资格及其调用。组合明确拒绝借用旧单批 G02；新增有限资格绑定 `557b497d` 的完整树、祖先关系、后续普通文件范围及固定检查器摘要。未改生产发布器行为或生产准入。

[完整范围计划](D:/codex-artifacts/ai-repair-integration-20261108/SCOPE.json)：Worker + Django，全组件范围；包含 Pi Runner/镜像、Pandas Broker/轮换与控制接线。无新增结构迁移。隔离新空库执行全部既有 migration，仅为验证安装所需结构，不代表本次生产需重跑迁移。

## 检查复用与新增

三批 W1–W12 单项、各自 Astra 反审及离线七处冲突证据按精确字节复用；没有重跑全部业务测试、全仓类型或无关 Tmall/Jackyun 检查。历史 167 条 TypeScript 诊断及原能力/账户限制没有被本轮宣称消除。

新增组合固定检查的六步均实际退出 0：组合范围与真实 PS5.1/PS7 参数 4 项、维护准入 2 项、带原生动作替身的发布编排 13 项、Worker 来源绑定 51 项、Pi150 真实参数入口及私有 Django 包检查。12 份日志、8,532 项载荷与临时候选清理均独立复核。

**固定入口总体仍退出 1，机器状态为 `native-cold-start-pending`。** `packageIntegrity=true`、`nativeEntryBoundary=true`、`nativeColdStart=false`。包中的进程/结构观察有替身，参数边界在副作用前停止；这些不能证明原生控制链已经启动。[G02 原件](D:/codex-artifacts/ai-repair-integration-20261108/g02/fixed-v1/REPORT.json) · [独立反审](REVIEW-G02.md)

## 真实运行结果

| 层次 | 实际结果 | 边界 |
| --- | --- | --- |
| Windows PostgreSQL 17.11 | 独立 `55418`、新 SCRAM 凭据、空库完成 159 项 migration；AI 90 项，readiness 的 117 表清单及统一任务五表存在 | 未读取或复制生产连接/配置；没有生产业务数据 |
| Django AI reader/writer | `19181/19182` 两实际 Waitress 角色同时启动，`/health/live`、`/health/ready` 均 200 | 使用真实隔离数据库角色和结构；非所有领域服务 |
| Worker | 冻结源真实 Vinext 构建，实际 workerd 监听 `3918`，主页/liveness 200；通过 HTTP 读取两 AI 服务 ready=200 | 私有 Miniflare bootstrap；未采用生产 supervisor/helper 或原总控 |
| 其他领域 | 通用 Django 存活 200，空 ERP reference revision 导致 ready=503；Worker 聚合因另外 21 服务未配置为 503 | 如实保留，不能称全域 readiness 通过 |
| Pi Runner | UID1000/rootless、独立目录/账本/凭据，原 `pi_runner.server.main` 监听 `19189`，原签名 health 通过 | 测试 namespace；未操作生产八个保留容器 |
| Pi 镜像接线 | Windows 已配置 Django 子进程用原 transport 发真实签名 create/state/dispose；真实镜像 `idle`，加载 `excel-report 1.3.0` 及三资源，最后 `disposed` | 没有 prompt、模型或工具网关调用；不是 Waitress HTTP 业务整链验收 |
| Pandas Broker | 原 main 通过仅改测试端口的 bootstrap 监听 `18139`；原签名 probe + 实际无网容器自测通过 | 没有 mock Start/Stop 或签名状态替身 |
| Pandas 接线 | 已配置 Django 子进程使用原 `pandas_sandbox.call_runner`，DPAPI 测试 key、原 HMAC、固定镜像、结果和清理校验通过 | 合成数据 `3 + (-1) = 2`；不证明生产两条历史失败的内因 |

应用冻结 `557b497d`；构建/源清单、进程 PID/创建时间、二进制摘要、依赖、原 HTTP 回执及退出保全于 [Windows 原件](D:/codex-artifacts/ai-repair-integration-20261108/windows/WINDOWS-RESULT.json)、[接线原件](D:/codex-artifacts/ai-repair-integration-20261108/windows/DJANGO-RUNNERS.json)、[来源与清理](D:/codex-artifacts/ai-repair-integration-20261108/windows/WINDOWS-SOURCE-AND-CLEANUP.json)。

Pi 镜像 `sha256:dea9bb9e4a8a8f41865a10666981444d51ef52415c89e980af0c70e7219a5df2`，Pandas 镜像 `sha256:4c5815d845a4579d5402f2f4c22c8c822701a0116df2e0fc8b28ef31e832d580`。最终候选与既有测试镜像输入精确相同，核完整输入后复用并重新绑定，没有重复打镜像或生成正式制品。Pi source digest `fb02a402f02764b6eab3cb2c890f7d36a44e5f4bdc8b1e9ba6680cb57c74df08`；Pandas package digest `5bfb727f33095c0d3e4f9b63644fc0dda8c2b69293a38ea25acf49ca5d3913c5`。[Runner 来源](D:/codex-artifacts/ai-repair-integration-20261108/RUNNER-SOURCE.json) · [实际就绪](D:/codex-artifacts/ai-repair-integration-20261108/RUNNER-READY.json)

## 保留的失败和未覆盖层

最初构建归档漏 automation、隔离 Python 不继承用户 site、验证脚本 stage 参数及技能对象格式断言、旧停止方法超时均保留原输出/尝试；修正的是验证材料或脚本。最后 Windows 宿主均正常退出 0，不用新成功覆盖早前异常退出。

完整 Windows 原生 `Start/Stop`、supervisor/helper 和原生 startup receipt 未执行。总控固定生产 Django root，Worker/helper 固定 `3000/5791` 且正在生产监听；`AllowTestRuntimeRoot` 的 readiness 有硬编码成功，不能拿来充当真实就绪。当前授权没有生产试跑或控制包安装，因此没有借生产补证。[精确路径/行号和限制](D:/codex-artifacts/ai-repair-integration-20261108/windows/NATIVE-CONTROLLER-BOUNDARY.json)

本轮无付费模型、真实图片三场景、供应商原生 Schema 账户验证、钉钉外发、日报持续启用或生产 Pi 容量恢复。这些原有限制继续存在。

## 清理和生产边界

- Windows 四个应用宿主退出 0，实际 workerd 子进程和 PostgreSQL 原 PID/创建身份均消失，五个端口释放；临时 initdb 密码文件已删除。空合成库、源码、依赖和构建证据停用留存。
- 两个 Pi 会话均先取得原签名 `disposed`，再只删除精确 namespace 内对应的两份无挂载测试卷；无残留测试容器。Pi/Pandas 原 main 均 SIGTERM 退出 0，测试端口释放，Windows DPAPI 测试 key 与 Linux key 均移除。
- 专用测试 WSL `Codex-AI-Batch2-20261108` 恢复停止；Docker inactive。旧四个测试 unit 状态、24 份旧意图/关联文件摘要不变。最后长期宿主退出后 daemon socket 已消失，额外只读查询失败原件保留；容器/卷为空采用停止前的真实观察，不伪称停后再次查到空。
- 生产发布回执仍是 `0c7d0feb`，回执摘要及本任务中只读观察的 `3000/5432/8111/8112` 原 PID/创建时间未变；生产 WSL 仍运行。此为有限身份核对，不是生产业务验收。

[Runner 停止](D:/codex-artifacts/ai-repair-integration-20261108/RUNNER-STOP.json) · [精确卷清理](D:/codex-artifacts/ai-repair-integration-20261108/PI-VOLUME-CLEANUP.json) · [最终清理](D:/codex-artifacts/ai-repair-integration-20261108/RUNNER-CLEANUP.json) · [生产只读收尾](D:/codex-artifacts/ai-repair-integration-20261108/PRODUCTION-FINAL.json)

## 独立反审与后续

请求审查模型均为 `gpt-6-astra/high`，工具未独立回传实际底层型号/强度。每个小项由未参与该实现的审查者直接核原件，原审查上下文增量收尾：

- [三批整合与冲突](REVIEW-INTEGRATION.md)
- [组合 G02 适配及固定结果](REVIEW-G02.md)
- [Runner 原生进程与清理](REVIEW-RUNNERS.md)
- [Windows 实际启动与接线](REVIEW-WINDOWS.md)
- [最终组合交付结论](REVIEW-FINAL.md)

本候选可审阅，**暂不建议直接合 main**：先补足可安全隔离的完整原生控制链冷启动证明。此缺口不是应用功能验收、真实模型调用或生产试跑的要求，不能用本次进程切片通过代替。

证明闭合且用户明确授权合并时，建议一次合入本整合分支，不再逐批 cherry-pick；重新核最新 main 和最终差异，再从最终 main 提交准备对应正式制品。正式上线另需明确授权。当前未合 main、未准备正式制品、未上线；保留本树和三批未合分支供后续审查。
