# 与 Pi 导出修复合并后的证据复用

本次把已受测控制修复 `ec39da505b387196cb85818c4202b2083f27c9c3` 与远端 main `3347a5dfd8ebfa9d2115fd0935e7cb68048e7224` 在本独立工作树合并，公共基线为 a704。双方运行代码和测试集合没有交集；唯一冲突是 `ai-0085.json` 的 validation、validationSha256、codeSha256 三绑定字段。

控制模块、writer/observer、固定资格、控制测试与 ec39 逐文件字节保持，复用最终窄候选 86/86 和先前 a704 应用/CIM/Pi 证据。Pi 导出三产品文件及对应 HTTP/Node 测试与 3347 逐字节保持，复用该任务原 49 项 SQLite/Pi、5 项中央工具、3 项私有 PostgreSQL HTTP 结果及其独立审查；本次没有重跑这些业务测试或旧 a704 全套验证。

唯一重新生成的执行证明为现有轻量私有 PG：合成源码执行 150→151 结构、权限、事务回滚、数据保持、有限安装器负例及 46 项私有 Pi 状态测试，通过后写出 [schema-validation-merged-3347.json](schema-validation-merged-3347.json)，codeSha `b95550b3aadf2c5265d8edcacb7d11250d76247e4f86a57d0bd891832722bf43`。原 cluster 已停止、口令文件删除。recipe 仅重绑三字段指向该新证明，双方旧证明全部保留；迁移字节、步骤、安装器、演练工具不变。

精确集合/逐文件 SHA、原报告及远端业务原输出 SHA、新证明与当前完整 CODE_FILES 的只读绑定，由一次性文件 `D:/codex-artifacts/release-schema-admission-20261018/verify-merge-reuse-3347.mjs` 检查并写入 `MERGE-REUSE-3347.json`。它是本次合并的证据记录，不修改正式 verifier 的固定基线或建立新的发布系统。独立审查仍须核该记录及实际合并差异；本文件不构成控制采用、队列协调或应用上线已完成。
