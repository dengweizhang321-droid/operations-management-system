# 固定交付与集成表

baseSha均为`b3c6018cca6c2b2b5c8fa6c5b52e376f3a84f354`；完整变更路径见[机器清单](DELIVERIES.json)。五个真实远端tip与固定SHA一致，且均为集成HEAD祖先；没有主线新增增量或冲突。WP-2另在最终报告列确定提交。

| 任务 | 交付SHA / 集成SHA | 文件与内容 | 验证 | 限制 / 依赖 | 无需产品代码改动 |
| --- | --- | --- | --- | --- | --- |
| WP-B / WP-0 | `74c5e6330b88248c7ebcc778e32310c5b46631d3` / `68d243143ae75039cb2310c393a4b495c4e0f184` | 2文件；本任务报告/机器投影 | 报告/链接/差异；只读盘点 | 采用/实现/当前健康分开；32树为原截点；依赖：无 | 是 |
| WP-1 | `3558ba18ca9eed8971bf67e7e54220519596dc80` / `4354892f23bd3ec71db46cd464a4c8fd60a6912e` | 49文件；.github/workflows/verify-tiers.yml、package.json、tests/ci/artifact.test.mjs、tests/ci/failure-probe.test.mjs、tests/ci/offline-guard.test.mjs、tests/ci/policy.test.mjs、tests/ci/postgres-semantics.sql、tests/ci/process.test.mjs、tests/ci/windows-isolation.ps1、tools/ci/audit.json、tools/ci/integration.mjs、tools/ci/offline-guard.mjs、tools/ci/policy.mjs、tools/ci/process.mjs、tools/ci/seal-artifact.mjs、tools/ci/type-impact.mjs、tools/ci/verify.mjs | 原L0切片21；本机L1 58+PS5；当前组合另验 | lint失败；云端PS5夹具失败；L2/L3/域覆盖缺口；依赖：WP-B固定报告 | 否 |
| WP-5 / WP-5G | `4968baedd7ac3fa0948258cdc854fd25045fe8cd` / `a5e3259a9af71b30b7ecfbcdadc99717af95bcf3` | 18文件；tests/operations-system-service-exit.test.ps1、tests/operations-system-service.test.ts、tools/operations-system-service.ps1 | 17受影响；原安全deadline13；组合另验 | 原44中14失败保留；本轮树清理负例失败；未采用；依赖：WP-B固定报告 | 否 |
| WP-4 | `39feb86c7c51b9b8c99232840bf55ad1b0027a02` / `6a7b496263c95f405f23fea56ef6d09fb3741595` | 2文件；本任务报告/机器投影 | 原112文件/80WAL离线；区间算术/链接 | 不是新演练；T2认证连续秒未测；净收益未测；依赖：WP-B固定报告 | 是 |
| WP-3 | `2538b8d5b51824a23bfc58f511d120c9c7cb8d2d` / `849bee83e57cf8c4ed9f4b29b158997611c41c64` | 16文件；tests/release-closeout-independent.test.mjs、tools/release-closeout-report.mjs | 组合21+6+3；两原批次离线CLI | acceptancePassed=null；草稿不认证当前readiness；无hook；依赖：WP-B/WP-5/WP-4固定报告；safeProcessEvidence在base | 否 |

WP-1独立交接补丁SHA-256为`eab391b05c19705ae2e5a6822e5dabb80946af27ab4b9076a981de81ddec22b2`，仅在集成分支追加`607a7c197aec7d7acbf5da218b60f5b709557899`修正及`529a1b11af92283a20d093d0c758dbce37a6aa01`原交接证据；原WP-1四提交分支不变。

WP-2本任务文档/规范交付及集成SHA：`f03cf9395d2a8bc7e4c471a9f6f7877e550e74f3`，base同上；6文件，详见机器清单新增行。无需产品代码改动，验证为代码/调用链与历史证据审计、最终链接/差异检查；缺历史完整输入与组合更高级别门槛保持阻断。
