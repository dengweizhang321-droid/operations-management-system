# 现场执行与跨重启续接

2026-10-23，**未执行的后续草稿；当前候选仍阻塞，不能按此直接采用或重启。** 本轮按用户最后要求完成简化关键审查及一轮只读核验后停止。具体兼容、reader 末次 CAS 与现场证据缺口见 [REPORT.md](REPORT.md)；授权和重启时机答复见 [AUTHORIZATION.md](AUTHORIZATION.md)。

## 已核参数

| 项目 | 值 |
| --- | --- |
| 工作分支 | `codex/s05d-retirement-implementation-20261023` |
| 当前已核远端 main | `36668589cab03d5d2d9d98383fb58eeb19c391ee` |
| 原 dispatch | `a3d53227-8976-4762-8be6-6f8c28107b5b` |
| 原 request | `2c90e2a2-24c1-4dc1-9811-ae7c4888a6e8` |
| config | `D:/codex-isolated/main-manual-release-20261016/main-publisher-config.json` |
| Node | `C:/Program Files/nodejs/node.exe` |
| Node SHA256 | `9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de` |
| 计划冻结源码 | `D:/codex-artifacts/s05d-retirement-implementation-20261023/control-source` |
| 计划控制材料目录 | `D:/codex-artifacts/s05d-retirement-implementation-20261023/control-upgrade` |

源码和材料目录在实际创建前须核不存在；最终 commit、manifest、bundle、RUN、intent 和 SOURCES-CLOSED SHA 必须来自对应原件，不在本草稿预填。最终来源/工件清单以完整 collector 和 intent 为准，当前只读线索不能代替完整清单。

## 串行执行顺序

1. 完整必要检查及独审通过；独立开发分支提交/推送。只读核远端 main 与现有引用；不 fetch 更新 `origin/main`，不推进 main。按最终提交建立干净 detached 控制源码，核完整依赖闭包与材料摘要。
2. 按 [HANDOFF.md](HANDOFF.md) 的固定 `control-prepare`、`control-adopt` 阶段生成并核 RUN/TASK，分别注册、运行、读取原生结果。当前执行宿主为 high，实际控制写者必须为同用户 medium；不能直接调 writer 绕过身份门禁。Task LastResult 不替代原生 direct exit 和相互绑定回执。
3. 通过已采用 bundle 执行 `plan`，保存确切 intent、原 unknown 与 queue 原件摘要、所有来源/工件及消费记录。执行同 intent 的 `close-sources`，核逐对象前后身份和 SOURCES-CLOSED。失败保留闭锁及证据，不自动还原旧源，不另起新 intent 掩盖 unknown。
4. 只有来源关闭回执完整、持久续接材料齐全且原目标禁重放仍有效，才能安排本轮已授权完整 Windows 重启。用户需用原 Windows 用户重新登录。此前 boot 为 2026-10-17，不能充当本次退休证明。系统重启会中断本机应用；本轮不另行部署应用或启动新准备。
5. 重登后先由原生 boot reader 证明同机、来源关闭后的新完整启动。保守默认由主负责人恢复会话后安排 demand `seal-after-retirement` 和两轮独立观察，不依赖自动 logon 任务抢先封存。若最终采用 logon 方式，必须先补齐观察者续接和期限配合，不能把注册 Task 当执行完成。
6. 普通 writer 输出固定 `REQUEST-initial/final` 路径及摘要后，主负责人依次从同一已采用 bundle 启动精确只读 elevated observer。使用隐藏独立进程；启动包装进程须退出后再进行 census。不得宽免任意父进程、跳过 ACK 或替换 proof。观察窗口内不并发启动会进入控制进程判断的状态查询。
7. 新 alias、已消费引用、来源重现、archive 改动或控制代际漂移均拒绝；不得临时搬新 alias 并沿用旧 boot。最终只在 SEALED、独立两轮观察/ordinary ACK、末次动态复验及新 resolution 原件闭合后报告协调完成。原 unknown 和旧失败记录原样保留，原 target 永久禁止重放。
8. 读取已采用 reader 的真实结果，更新 S05d/S05b、报告与记忆。仅清理原生完成且无实例的本轮精确自有 handoff Task；保留冻结材料、所有原件及失败证据。不生成新生产 dispatch、不准备制品、不继续上线。

## 重启前必须持久保存

必须将最终控制提交及材料位置、采用回执、原与新代际、intent/来源关闭摘要、每件关闭对象映射、原用户/任务身份、下一步精确命令和当前阶段写入本目录及共享项目记忆。重启可能中断当前工具会话；恢复后先读这些原件核实状态，不从口头进度推断完成，也不重放已经结果未知的 handoff。

目前这些执行材料尚未生成，现场仍未开始。
