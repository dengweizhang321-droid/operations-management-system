# 有限150→151结构交付

唯一结构步骤为 `ai_assistant.0085_pi_workspace_controls`；只新增工作区、控制和普通UI请求表及对应约束/索引/guard，不迁移、回填、清洗或导入业务数据。

独立 PostgreSQL 在端口55531构造真实150父链及原角色/目录。额外预置3行合成既有Pi会话、不可变文件和nonce，正向升级、注入异常事务回滚、旧数据/ACL哈希保持、空新表、权限拒绝、未知迁移/目录/触发器拒绝、原安装intent不重放及已提交协调全部通过。原Pi46项回归在同私有实例通过。退出时PG停止、口令文件移除。

固定 recipe：[ai-0085.json](../../config/main-schema-releases/ai-0085.json)。原验证：[schema-validation.json](schema-validation.json)。codeSha `27144dc0367fa564ef4032c44aecd9fce4b625c13a945cb91e28482e68006749`，61个源码/安装器成员闭包；原生实际PrepareApp→DeployApp→HardenAcl、完整staging字节和全部CODE_FILES比较通过，源清单前后不变，普通权限，89.602秒。记录 `D:/codex-artifacts/pi-phase2-workspace-20261018/native-package/final/`。

新151仅扩展固定代际准入及五个复制成员。PS5/PS7各21项原生适配器通过，旧150路径保留。独立Runner升级另有真实私有user-unit冷启动证明，不以这些边界测试冒称整套Django冷启动。

新源升级工具与DjangoAI入口、原生publisher配合：online prepare/check绑定已准备的实际应用包；维护中Install/ProvisionRoles/Finalize后，按登记计划UpgradePi，再切Worker并Start。升级未知即保留原STARTED、plan和intent，不启动、不重放。后续数据库结构迁移按现规范不附带全库备份/全库恢复；没有本轮生产执行。
