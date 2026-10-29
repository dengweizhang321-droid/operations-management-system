# jackyun-credential-release-20261017 发布回执（归档）

原始工作目录 `D:\codex-isolated\jackyun-credential-release-20261017` 已于 2026-10-29 作为磁盘回收的一部分删除，三份回执在删除前按字节复制到此处。

这一轮值得留存的原因是它完整记录了「失败 → 恢复」的过程：

| 文件 | 原路径 | 内容 |
| --- | --- | --- |
| `main-release-request.json` | 同名 | 本轮发布请求 |
| `publish-09db4c0130a9-FAILED.json` | `publish-09db4c0130a9/FAILED.json` | 2026-10-16T17:44:18Z 在「登记结构迁移」阶段失败：`Invalid approved script parameter value`；维护已进入，未自动重试 |
| `resume-schema-transport-SUCCESS.json` | `resume-schema-transport/SUCCESS.json` | 2026-10-16T18:04:23Z 恢复后成功：main 提交 `09db4c0130a93cf8c711cf75cb796eb1fd92afa7`、Worker release `20261016T172150Z-8a54a65532d4d6de`、migration `inventory.0015_jd_monitor_preferences`（共 147 条）、健康检查 ready，且 `originalFailurePreserved: true`（原失败记录未被回写覆盖） |

回收过程见 [磁盘回收报告](../disk-reclaim-20261029/PLAN2-TASK-DIRS.md)。
