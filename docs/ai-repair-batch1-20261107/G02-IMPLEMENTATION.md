# 第一批 G02 兼容适配实施记录

2026-11-08。适配绑定主线基线 `0c7d0feb33f45cfc6ae1f283b81d401c873c5768` 与已独审的应用提交 `eee39f9d315eaf9dd71f8390181879cdb6ba2c82`。应用 tree 为 `18ce84ef8fe69ebd9128dc2b540ee5c67dc977ed`。适配源码和定向证据可供独审。根负责人将从最终干净提交执行原 G02 入口。

- 专用 profile 核对 38 个应用、Runner、镜像与发布路径和 8 个同批根测试文件的状态及实际原始字节，只接受指定的四个验证文件增量和本任务文档、已审任务索引。删除、改名、未知路径和已审字节漂移会拒绝该资格。完整 release plan 仍为 Worker 与 Django 的 full 范围，迁移为空。 [验证器](../../tools/verify-release-candidate.mjs) [定向反例](../../tests/verify-release-candidate.test.mjs)
- 复用检查核对两发布入口的递归模块集合、未变的直接依赖和启动维护控制器原始字节。核对 63 个镜像构建输入、三项实际镜像标签、已审 118 项发布编排原件、TypeScript 167→167 的同诊断原件和 Pi 专项原件。旧 Python 语法原件只保存 25 个文件名，本次补对这 25 个冻结文件做实际 AST 解析。复用的报告保留原字段，未记录的源提交或退出码用空值表示。 [离线证据核对](../../tests/ai-repair-batch1-compatibility.test.mjs)
- 新分支显式调用本批定向检查、原私有 Django 包复制检查及原 PS5/PS7 参数入口检查。包复制检查覆盖依赖、ACL 与本机 Wrangler。参数测试在首个副作用前停止。旧 installed inventory 测试与候选适配各自保持原语义，既有 `tools/publish-latest-main.mjs` 缺项原件另存。CI 与生产发布器不调用此 profile。

原件目录为 `D:/codex-artifacts/ai-repair-batch1-20261107`。定向 profile 2 项通过，离线核对 1 项通过，原件 `g02-profile-tests-v2.log`、`g02-compatibility-fixture-v2.log` 和 `g02-verified-evidence-development.json`。适配语法与差异检查通过。正式 G02 原入口的包复制和 PS 参数退出回执由最终干净候选生成。

Pi 私有冷启动使用已构建隔离镜像 `sha256:7975d9cae783f1b33fb21063d6be40a2fdbb1a7d718550fd13a54ed64961097d`，复制 Git 归档的确切 Runner 源码，源码摘要为 `fb02a402f02764b6eab3cb2c890f7d36a44e5f4bdc8b1e9ba6680cb57c74df08`。原生 `pi_runner.server.main` 两次启动均通过签名 health。两个精确 PID 接受 SIGTERM 后各以 0 退出。两次为同一 SQLite 设备和 inode，health nonce 计数从 1 增至 2。端口、进程、命名空间资源和私有目录均已核对并清理。 `g02-pi-native-v3/NATIVE.json` 与原 stdout/stderr 保留原始身份，前两次夹具失败也保留，第二次残留的精确私有目录另有清理回执。 [私有入口夹具](../../tests/ai-repair-batch1-pi-native-start.py)

完整 Windows 应用栈冷启动仍为 `nativeColdStart=false`。本批实际变化需要的 `piRunner` 范围单独记录在 `requiredNativeScopes` 和 `scopedNativeEvidence`。同账本启动的证据限于本轮空私有账本。此前容量、保卷、升级和唤醒证据沿原受审范围复用。正式制品、维护、合并和发布仍依当次授权执行。

## 最终固定入口

根负责人在干净提交 `5d9090b7ef54a2937efe9cfe8556262ccb835294`、tree `40bc87ada55e8fff9fae8628a3add38619280107` 上执行方案固定命令，结果 `passed`。四项实际检查退出均为 0，私有验证 worktree 已移除；`packageIntegrity=true`、`nativeEntryBoundary=true`，完整 Windows `nativeColdStart=false`，本批 required `piRunner` scope 已实际闭合，`publicationPerformed=false`。

原件 `candidate-compatibility-g02-v1/REPORT.json` 的 SHA-256 为 `182ff5ac263d820f4d84410ddd484d09d65ebe08db93bdcef82ac27a658149c0`。原 Astra 已独立核对最终提交、源码、四项执行、日志和复用摘要、载荷及清理，详见 [REVIEW-G02.md](REVIEW-G02.md)。后续只有任务文档收尾，运行与验证程序字节保持，复用该真实回执；不将本批有限资格推广到其他源码或未来发布。
