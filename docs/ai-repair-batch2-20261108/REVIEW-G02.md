# 第二批 G02 独立反审

2026-11-08。按用户逐小任务特例，请求 `gpt-6-astra` / `high`；工具未独立回传实际底层型号。审查上下文未参与本项实现，未转派。仅审六个兼容适配源码/测试、G02 说明及直接依赖/原件；49 项应用实现复用各小包独审，不重新全审。

**结论：源码、原件及最终固定入口增量复核通过，无剩余 G02 阻断。** 最终被检查提交为 `9368676d81a175c86c0d7bd6f90d1de395765d67`，tree `b0da82f7639516fa9c3927b0758ea65aa024dba6`。本结论仅适用于下述精确字节及限定证据；完整 Windows 栈冷启动仍未执行，不代表合并、正式制品就绪或上线授权。

## 精确来源与适配范围

- 基线 `0c7d0feb33f45cfc6ae1f283b81d401c873c5768`；受审应用 `638fd30db3e1fa670805878d060ee3894baa462d`，tree `116000d9b258178234ac489c3b24d445815bd672`。
- 最终 [SOURCE-v3](D:/codex-artifacts/ai-repair-batch2-20261108/g02-adapter/SOURCE-v3.json) SHA 为 `4ec3aef51348aae5b89a9d33e2abcc5f924d6a1e96f622b2f180f887295a1cd9`。55 项源码加 G02.md 的原始字节逐项匹配，49 项应用逐项等于上述应用提交；实际 Git 非文档 A/M 成员与清单完全相等。除验证器自身的 54 项汇总 SHA 为 `69324e8df7b382016184b78ba448c50156a50dfe51e2adb952877c149f823eef`。验证器由本独立差异审查、SOURCE 原始 SHA 与最终完整 payload 绑定，没有制造自指摘要。
- [固定验证器](../../tools/verify-release-candidate.mjs)绑定 base、应用 ancestor/tree、完整成员/状态/原字节；遗漏、重复、删除、改名两端、未知路径和字节漂移均不得取得本批资格。任务文档按既有收尾规则处理，无新增具体报告文件名门禁。实际范围继续 full、Worker+Django、无迁移。第一批 G02 资格没有替代本批资格。
- [维护准入](../../tools/manual-maintenance-continuation.mjs)新增资格只允许主线到本批 django-ai 与 django-local-service 两整文件单向成组；Worker 与 process-deadline 双侧必须保持原字节。前后 Pi Wait/Stop 切片保持；基础 Django 脚本只增加三项复制清单。未扩历史逐控制器 allowlist，未改变锁内动态复核和原生维护门禁。
- [参数夹具](../../tests/ai-repair-batch2-powershell-entry.ps1)在 PS5/PS7 使用真实 publisher helper 实参，四个 action 在原 mutex 调用行断点退出；非法 owner 类型须由真实 binder 拒绝，私有 runtime 无文件。[实际私有包夹具](../../tests/release-candidate-package.test.ps1)保留 Prepare/Deploy、manifest、ACL 与本地 Wrangler，扩核新增 operator/helper/Broker 字节；stopped/schema 观察是替身，不是生产或整栈冷启动。
- 两 publisher 及 resume 的递归相对导入闭包包含新增 helper；旧 installed inventory 缺 publish-latest-main.mjs 仍为已披露基线问题，未改旧断言冒称解决。CI 与候选 profile 独立，maintenanceReadiness 的控制器资格属于真实发布调用链，未混成 CI-only。

## 复用证据与证明边界

已独立核 14 份固定原件 SHA、W6R 独审回执及其来源/原件，不以执行者摘要或任意 supplied passed 替代原件。W6B DataFrame 增量保持合成来源到真实容器的实际范围；TypeScript 167→167、新增零仍非全绿。原 readiness 历史候选两断言在精确 main 同红，原件保留；直接受影响的当前 Django tripwire 已改为本批成对资格，旧 AI159 留在历史资格。

W6R 原生 05 的 root/systemd、UID1000 Broker/rootless 容器、同账本、签名探针及停止清理原件复用；Windows 原函数接缝中 keepalive、租约、安装 guard 是夹具。`nativeColdStart=false` 明确保留完整 Windows 栈未执行，`requiredNativeScopes=["pandasBroker"]` 的限定范围有真实原件支持。本审查未重启原生用例，没有把 mock 作为真实 Linux 证据，也没有把 Linux 局部成功称为整栈通过。

首次源码核验保留 [G02-INDEPENDENT-BINDINGS](D:/codex-artifacts/ai-repair-batch2-20261108/g02-adapter/G02-INDEPENDENT-BINDINGS.json)，R1 源码增量保留 [G02-R1-BINDINGS](D:/codex-artifacts/ai-repair-batch2-20261108/g02-adapter/G02-R1-BINDINGS.json)。原 SOURCE-v2、开发检查失败与后续通过均未覆盖。

## 固定入口失败与 R1

首次固定入口绑定 `80d8b7a9a6d57bc8bd6cc6dba35fea3c2aa52795`，报告真实 failed，参数适配检查 3/4；候选 worktree 已清理。深路径下 PS5.1 把错误中的参数名拆成 `Pan` 与 `dasPublicationOwnerPid` 两行，旧连续字符串断言失败；实际 invalid owner 已被参数绑定器以 exit 1、ParameterArgumentTransformationError 拒绝。这是验证断言的呈现适配问题，不是应用参数保护失效。

原实现者在 `811561a6` 仅归一化 stderr 的 CR/LF，并继续要求真实 binder exit 1、stdout 空、具体参数名、System.Int32 和私有 runtime 无写入；同步固定摘要与说明。两版 PowerShell 同深路径的真实 stderr 与 [deep-path-r1](D:/codex-artifacts/ai-repair-batch2-20261108/g02-adapter/deep-path-r1.json)已核。49 应用字节完全未变，R1 增量通过。`9368676d` 仅追加任务文档。原 [v1 REPORT](D:/codex-artifacts/ai-repair-batch2-20261108/candidate-compatibility-g02-v1/REPORT.json) 与日志保留，没有追改为通过。

## 最终固定入口增量

根负责人从干净 `9368676d` 运行原固定入口，在全新外置目录生成 [v2 REPORT](D:/codex-artifacts/ai-repair-batch2-20261108/candidate-compatibility-g02-v2/REPORT.json)，SHA `3ed9b8c46b4be6dfba7d62dde28df3b452f7f05f96c9698f1f6353ec2cb2e8a4`，状态 passed。独立核对实际命令、结果与原日志如下。

| 新执行检查 | 原件结果 | 范围 |
| --- | --- | --- |
| ai-repair-batch2-compatibility | exit 0，4/4 | 精确 profile/字节反例、单向成组维护准入、原件与真实 PS 参数、当前 Django tripwire |
| ai-repair-batch2-publication | exit 0，10/10 | Pandas 发布编排合成检查，失败/unknown 不重放 |
| powershell-entry | exit 0，unittest 1/1 | 既有实际 PS5/PS7 参数与路由边界 |
| actual-django-package | exit 0，原生 PASS | 私有 Prepare/Deploy/hash/ACL/本地 Wrangler；生产 stopped/schema 观察为替身 |

本增量核验四项退出、八份 stdout/stderr SHA、全部 8,486 载荷成员及总摘要、五个执行工具摘要、复用原件与新 verified-evidence 的逐项引用。payload 总 SHA 为 `ed5d105983de5cc9ffae2e6ab51ba0eb5eabc54567e15431da53ba62de2e8498`；verified-evidence SHA 为 `64af683bc8bf8d4a6f72804fb5e48b12c4ceeed281f054d9373c742aec0332f6`，其复用证据、限定 native 证据与 publisher 闭包和 REPORT 完全一致。唯一文档 REVIEW-W9.md 在主审工作树与新检出仅行尾不同：报告字节精确匹配目标提交 Git blob，已单列记录；所有运行源码原字节与最终 SOURCE-v3 一致。

固定入口按原算法在执行前后复核依赖树、PowerShell 模块、工具及载荷漂移；本增量复用这组未变化检查，不重复扫描依赖。报告 `candidateWorktreeRemoved=true`、无 cleanupError，已独立核实 candidate 目录与 Git worktree 登记均不存在。最终 `packageIntegrity=true`、`nativeEntryBoundary=true`、`nativeColdStart=false`，`publicationPerformed=false`。机器核验为 [G02-FINAL-REVIEW-BINDINGS](D:/codex-artifacts/ai-repair-batch2-20261108/g02-adapter/G02-FINAL-REVIEW-BINDINGS.json)，总回执为 [G02-REVIEW](D:/codex-artifacts/ai-repair-batch2-20261108/g02-adapter/G02-REVIEW.json)。

未修改被审运行字节、未重跑全仓或已验 native、未合并 main、未准备正式制品、未上线、未生产操作或外发。后续仅任务文档收尾可复用本结论，保留真实被检查提交与文档提交关系；未来合并须按当时最新 main 核冲突与实际增量。共享长期记忆由根负责人统一维护。
