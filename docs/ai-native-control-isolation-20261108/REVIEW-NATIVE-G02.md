# 原生生命周期与 G02 独立反审

日期：2026-11-08。最终受检提交：`1921ccceb9fed314e0d5d2ba8fbef082992fa2f1`，tree `b1f2a411fdf5a139622b917fcd10b8999c236d5f`。审查者未参与本阶段方案或实施；请求模型 `gpt-6-astra/high`，工具未独立回传实际底层型号。仅只读核验、隔离纯函数反例和本报告写入，未启停服务或操作生产。

## 结论

本小项通过。`b7280770fa5ff81e3939d6516f021c9f50b496a3` 的完整原生 Windows Start→Stop→Start→Stop 已有真实原件证明；最终 G02 v3 已由固定入口实际生成 passed。初审 P1 尾部字节资格缺口已在同一审查上下文关闭，两次 G02 失败原件保留。本结论不代表已合 main、正式制品就绪、生产发布或真实外部供应商功能验收；阶段最终清理和交付文件另作增量复核。

## 原生生命周期证据

外置证据根：`D:/codex-artifacts/ai-native-control-isolation-20261108`。独立重算 `NATIVE-LIFECYCLE-EVIDENCE.json` 的 SHA-256 为 `e50774004ea98e01c9fdd3813c316e8159b19ab74c1ee701ac120a7d7cfa7114`；全部 75 个成员长度和 SHA-256 匹配。读取实际 `native-control-entry.py`、观察器及原内外回执，确认调用原 operations-system-service→control→Worker→Django 链，观察器使用真实 HTTP、CIM 和 systemctl，没有用 AllowTestRuntimeRoot 或合成 ready 代替启停。

| 正常轮次 | Start 原退出 / 耗时 | Stop 原退出 / 耗时 | 就绪与停止证据 |
| --- | --- | --- | --- |
| 1 | 0 / 262.434 秒 | 0 / 164.862 秒 | Running、exact_release、backend Ready；23 项服务 ready/200；26 个私有回环监听；停止后原进程身份消失、私有端口为空、两 Linux 单元 inactive |
| 2 | 0 / 259.340 秒 | 0 / 165.006 秒 | 同上；新的 Windows supervisor 创建身份及新的 Linux InvocationID，证明第二轮重新启动 |

两轮 supervisor 分别为 PID 49856、创建时间 `2026-11-08T06:37:53.9743410Z`，以及 PID 17948、创建时间 `2026-11-08T06:57:06.7916250Z`。独立 PiCheck / PandasCheck 原调用均退出 0，健康响应由原签名探针取得。Windows 进程消失和 Linux 停止分别取证，不以一方替代另一方。

第一次失败 Start 和 failed Stop 不计入正常两轮。原 Status stale、旧身份缺失及端口释放后，原 Stop stale-receipt 分支完成清理；旧失败和 unknown 诊断仍保留。第一轮停止后 PID 38076 被 WmiPrvSE 复用，观察器仅通过不同创建时间证明旧身份已消失，没有操作新进程。

完整 Git 应用物化为 8,553 文件，源指纹 `518371bdd9f3a1be0650ac1abb7114a26dbd25cba4be36a1fc68e4bbd78e72a3`；1,655 个 Django 部署源文件和 73 个 Runner 清单文件与冻结应用匹配。原 COM 私有快捷方式 adoption 的 plan、consumption、manifest 和入口摘要绑定一致。审查者独立运行原件读取器退出 0，`ASTRA-NATIVE-VERIFIED-R1.json` SHA-256 为 `e762349486bd9fd0a8f82b6e1627949d58948e1e8be8f9047e1ce56cfeaeea73`。

历史 D1/迁移前置明确为 synthetic；历史迁移及清理删除未实际执行。真实原校验器检查私有实际数据库/空 tombstone 并生成当前证明。此边界不影响真实生命周期结论，也不能被改写为历史迁移成功。

## 初审发现与修复复核

1. **P1：925d489a 的尾部资格只限制路径，未限制全部已审字节。** 对真实 raw diff 仅替换 `tools/manual-maintenance-process.psm1` 的候选 blob，原 `nativeControlScopeMatches` 仍接受。修复后 9 个尾部工具、读取器和测试固定 Git blob 与实际 SHA-256；raw diff 先拒同路径内容漂移，物化后再次校验 SHA-256。独立反例 9/9 拒绝，实际 pin 9/9 匹配；证据 `ASTRA-G02-TAIL-R2.json`。固定验证框架自身由本轮源码审查及最终 REPORT 的 payload 绑定，不声称存在自包含循环摘要。
2. **G02 v1 失败：测试夹具缺少新增真实依赖。** 原完整性测试 26 通过、8 失败，instrumented 临时模块缺 `native-isolation.mjs`。只补复制该真实依赖的一行，未删原检查或替换源码哈希算法。
3. **G02 v2 失败：标准库假设不成立。** 原完整性测试 33 通过、1 失败，`release-preparation-runtime-config.test.mjs` 经 `release-impact.mjs` 实际依赖 TypeScript。最终显式提供依赖，仅链接 TypeScript 包，保留原 AST 检查。

TypeScript 5.9.3 的全部 132 文件按原 hashTree 计算；提供目录、原生不可变 release 内同包和固定 tree `5c4c3948060056c3cc4ce57222e7957ccef438c108791352af19c666a4c2a1a9` 三者一致，锁摘要为 `8ec00f801aff894796d783595d202811bccbe94296603ae26766864247d4a4ca`。相同版本但不同字节仍拒绝，测试后再次复核依赖树。审查者独立运行绑定函数成功，`ASTRA-TYPESCRIPT-BINDING-R3.json` SHA-256 为 `2f54fa69f128d1df84a7f96a6dcc4a44f1513694fac7d103931050a2b7d60551`。

清理只对核实目标的 TypeScript junction 执行 unlink，再移除空 node_modules；没有递归删除依赖源。创建尚未完成的失败场景可安全收尾；未知链接或非空目录会导致失败，不会被静默删除。

## 固定 G02 v3 原件

`g02-native-v3/REPORT.json` SHA-256：`cbc1bac073809bc5197a8f445d9de2eb725ae92a6dd73e4abc5a0ba1292d0c54`。最终 `status=passed`，`packageIntegrity=true`、`nativeEntryBoundary=true`、`nativeColdStart=true`、`nativeIsolationCredentialGate=true`；无 error / cleanupError。三步原结果为：

- `native-scope-maintenance-and-credential-boundaries`：退出 0，7/7，无 skip。
- `native-worker-integrity`：退出 0，51/51，无 skip。
- `original-native-two-cycle-evidence`：退出 0；读取结果摘要与审查者 R1 相同。

审查者独立重算 8,560 个候选 payload 文件、payload 索引、六份步骤 stdout/stderr 及 native-verified 原件摘要，全部一致；最终 9 个同路径漂移反例仍拒绝。证据 `ASTRA-G02-R3.json`。原 G02 stdout 返回 passed，stderr 为空；REPORT 的两个 worktree removed 字段为 true，且对应 candidate / native-application 目录实际不存在。v1 / v2 的 failed REPORT 与原输出保留。

## 证据复用边界

真实冷启动包冻结在 `b7280770`。最终 helper 仅精确删除未调用的 ConfigureCredentials 动作，其 SHA-256 为 `a5499003d2e269b8a3d6cdb6bce70fcd2f02434c541620ccdaa151f0c7f52343`；独立真实 PS5/PS7 提前拒绝与正常 Start/Stop 映射检查另见 [REVIEW-CREDENTIAL-GATE.md](REVIEW-CREDENTIAL-GATE.md)。不能声称封存包已经含该末尾修复。原 `557b497d` pending 资格保持，不借本次实证放行任意后续应用或同路径字节。

