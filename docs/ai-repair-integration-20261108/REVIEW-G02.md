# 三批组合 G02 适配独立反审

2026-11-08。**本次组合 G02 适配反审通过，未发现源码或固定执行证据阻断。** 六步检查及候选清理已核实；固定工具结论仍是 `native-cold-start-pending`、CLI 退出 1，不能将本报告通过表述为完整 G02 或完整 Windows 原生冷启动通过。

请求独立 gpt-6-astra/high；工具未回传可独立确认的实际底层型号/强度。未参与本适配实现，未执行生产或 WSL 操作。

固定受审提交 66a9bfa11cc9dd802c09640726ec820c66d156d7，应用基线 557b497dc0fe42f3693a0c6c76320a4833b46b49，适配实现 28a57cd23edaae7f64defcc12a70f0d037a5b49e。

## 源码与资格

独立 Git blob 比较：111 个应用及直接关联路径与原已审组合相同；第一至第三批的 17 个资格定义/检查函数保持逐字节相同。新增生产外检查只在 tools/verify-release-candidate.mjs 与 tests/ai-repair-integration-compatibility.test.mjs；其余是任务文档。

组合资格固定 base=0c7d0feb、application=557b497d 和 tree=277573157b4c0e4c41e72a329351639ac6cc80c3；验证真实祖先后，只允许 verifier 的普通文件修改、新增固定测试和指定任务文档。Git raw status/mode 拒绝删除、重命名、可执行/链接/submodule、重复项及缺项。新增测试完整 SHA-256 ea207d31f2ddc51788cd1fe954c30719a1a3bf1a86175e9b41a96f15edd9c9cd 在运行任何组合检查前核对。

独立纯函数/Git 反例通过：精确候选被识别；错误 base、非应用祖先、额外应用/锁文件/测试、嵌套文档或脚本、模式变化、重复/截断记录和缺固定检查器均拒绝。证据 SOURCE-AUDIT.json、SCOPE-AUDIT.json 和 scope-audit.mjs。

## 真实调用和证据分层

原单批调用仍保持；组合分支复用第二批四控制器固定摘要与六个生命周期函数原定义比较，完整组件计划仍要求 Worker+Django/full/no migration。组合不会进入旧单批有限资格。

新增检查器读实际发布 diff，确认 Pi 镜像与 Pandas 均需各自准备；publisher 闭包只新增专用 Pandas 模块；Pi resume 在读取任何 live context 前拒绝跨域 Pandas 续接。PS5.1/7 调用真实控制器参数绑定与 dispatcher，断点在原 mutex 调用之前退出17；无效 owner 在参数绑定阶段失败，隔离目录保持空。此证据是实际入口边界，不是动作或冷启动已执行。

双域发布顺序/unknown/缺准备证明/重复调用等用原发布器加原生动作替身验证；不将 mock 记作部署或容器原生结果。私有 Django 包检查真实执行 copy/deploy/hash/ACL/R2，但 stopped-process 和生产 schema 观察被替换；不声称生产 admission 或正式制品。

组合即使所有检查通过仍返回 native-cold-start-pending，CLI 对该状态退出1，evidence.nativeColdStart 保持 false，publicationPerformed=false，requiredNativeScopes 包含 windowsApplicationStack、piRunner、pandasBroker。它没有消费旁路报告自动转为 passed，也没有新增生产调用方或自我授权。

## 固定入口原件增量复核

固定报告 [REPORT.json](D:/codex-artifacts/ai-repair-integration-20261108/g02/fixed-v1/REPORT.json) SHA-256：`fd0b64957a8a3185c8191275b2c00da7bda670f0d15e57ac8fee04db2d5be0b8`；受检 HEAD 为上述 `66a9bfa1`，tree 为 `4db5bd10984d6e85d4bbe18f9e48282389e916d0`。实际完成时间 `2026-11-08T02:12:33.804Z`。

独立核对六项 stdout/stderr 共 12 份原日志摘要，全部与报告相符；六项均实际 exit 0，无失败或跳过：

| 固定检查 | 原件结果 | 实际证明范围 |
| --- | --- | --- |
| scope-and-entry | 4 项通过 | 固定范围、闭包、跨域续接拒绝、真实 PS5.1/7 参数与 mutex 前边界 |
| maintenance-admission | 2 项通过 | 限定控制器代际与私有前驱准入 |
| publication | 13 项通过 | 双域发布顺序和拒绝/恢复的原生动作替身编排 |
| worker-integrity | 51 项通过 | 源码/依赖/运行配置绑定 |
| powershell-entry | 1 项通过 | Pi150 恢复参数入口 |
| actual-django-package | PASS | 私有 copy/deploy/hash/ACL/R2；原日志明确生产进程/schema admission 未执行 |

独立重算 8,532 项 payload 的集合及聚合 SHA-256 `bcc2b107207fe74ed64f67ba982c0b583559cd807e0362a92d900c501c3d3fab`。8,527 项与固定 Git blob 原字节相等，5 个 `.bat` 与该提交 `.gitattributes` 明确要求的 `eol=crlf` 检出字节相等；没有把所有文件统一换行后冒充原字节。初次直接 blob 比较发现的这 5 项差异已按实际属性逐项解释，没有修改受审文件或回执。

报告记录 `candidateWorktreeRemoved=true`、无 cleanupError；独立复查 Git worktree 登记和精确 `fixed-v1/candidate` 物理目录均不存在。启动器 stdout 保留 pending 状态，`fixed-v1.launcher.exit.txt` 为真实 `1`。报告 `packageIntegrity=true`、`nativeEntryBoundary=true`、`nativeColdStart=false`、`publicationPerformed=false`；不存在将替身或包复制改写成完整冷启动成功的字段。

审查没有重跑已绑定的 13 项编排、2 项准入或其余固定检查；独立新增工作是源码/资格与反例检查、报告及 12 日志摘要、全部冻结 payload、Git 属性差异解释和候选卸载核验。报告中的工具/依赖/PowerShell 模块指纹以及验证结束复验沿原固定入口执行记录保留，不称另一次独立运行。

外置独立证据：[源码核验](D:/codex-artifacts/ai-repair-integration-20261108/review-g02/SOURCE-AUDIT.json)、[范围正反例](D:/codex-artifacts/ai-repair-integration-20261108/review-g02/SCOPE-AUDIT.json)、[最终回执核验](D:/codex-artifacts/ai-repair-integration-20261108/review-g02/FINAL-AUDIT.json)。源码阶段原稿仍保留，没有用后续完成覆盖此前 pending 记录。

## 交接

本适配无待返修阻断。完整 Windows 应用栈冷启动仍未完成；独立 Pi/Pandas/Django/Worker 进程的后续证据按各自范围报告，不能把旁路测试自动升级成原总控冷启动。组合资格没有自行授权 main 合并、正式制品准备、生产发布或维护，也没有增加生产调用方。后续按同一来源复用有效检查；应用/资格/检查器发生变化时只补受影响增量。

