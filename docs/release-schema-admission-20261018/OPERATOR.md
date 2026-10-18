# 固定控制采用与 ece 有限协调接口

以下为供审查的精确接口，不是已执行记录。采用材料必须绑定最终干净 main 的持久冻结 source，执行前单独审查其完整 CLI、环境、身份和摘要。原生产应用保持运行；不使用应用部署命令。

1. 从最终冻结 source 调用既有 `tools/install-main-prebuild.mjs --config D:/codex-isolated/main-manual-release-20261016/main-publisher-config.json --out <新的控制材料目录>` 准备不可变十文件控制包。采用使用原 `--adopt <材料目录>`，依次持原 v1→v2→rotation 锁；root 通过当前 SID、InteractiveToken/LUA、无触发器/密码的一次性固定 operator 任务执行。不得临时改原 MainPreparation 任务运行其他程序。
2. 新控制采用后，从同一持久冻结 source 执行 `node tools/schema-rejection-writer.mjs --out D:/codex-artifacts/<全新、尚不存在的本次operator目录>`。只有 `--out` 参数；不能覆盖 target、state、dispatch 或复跑原 native。out 必须是 D 盘 codex-artifacts 内、全链无 reparse 的实体目录，父目录预先存在；writer 自己 create-only 创建 out。普通 wrapper 清空 Node 环境并使用已绑定的 publisherBaseEnvironment，使用同类无触发器 LUA 固定任务；它与控制采用任务分开。
3. root 先启动一个高权限只读长生命周期 PowerShell observer 循环。保持同一 PID，不在两次 ACK 之间新建高权限 shell；它只等待本次 out 的请求，并调用同一冻结 source 的 observer。两阶段分别是 `before-archive`、`after-archive`，每阶段请求/响应路径为 `REQUEST-<phase>.json`、`OBSERVATION-<phase>.json`。

每阶段 root 核对请求文件 SHA、nonce、writer 的精确 PID/创建时间/命令/程序及 `operatorSource`、`sourceIdentity`、`operatorFiles`，再调用：

```text
node <冻结source>/tools/schema-rejection-observer.mjs --request <out>/REQUEST-<phase>.json --sha <该请求SHA256> --out <out>/OBSERVATION-<phase>.json
```

observer 自核自身固定 SHA、执行依赖、operator HEAD/tree/clean、原 packet 仅 source、固定打包任务完整定义/Ready/零实例、完整解码的当前控制 census。它只写上述私有证据；不终止进程、不注册或启动任务、不调用控制/队列写入、不提权其他进程。写出观察后最多等 60 秒的 `ACK-<phase>.json`；普通 writer 在独立 fresh CIM 对照通过后写 ACK，observer 才返回，root 外层再等下一阶段。两次证据各自小于 60 秒消费；writer 等不到见证或任何不一致均保留原 unknown。

首次观察后 writer 归档原件和 adoption 证据，归档后第二次观察/普通 fresh 复核通过才 create-only 发布：

```text
D:/codex-isolated/main-manual-release-20261016/prebuild-queue-v2/resolutions/ece64080-a14c-4314-9e91-c7a8c48171fb.json
```

成功仅为 `terminated-before-native-preparation`，`prepared/publicationPerformed/replayOriginal` 全为 false。原 ticket、dispatch、result 原文不变，原 result 仍 unknown；不得删除或改成 prepared/success。阶段失败、部分 archive 或 resolution 已存在时先保留材料并独立核实，不换名自动重演。

4. root 只读核有限 reader 和原终态后，再通过原固定 MainPreparation 普通任务消费新的 latest-main 请求。新正式 PREPARED 成功才报告制品就绪；本轮不进入维护、切换应用或迁移。普通打包仍用原固定任务，一次性 operator 任务完成后删除。

操作材料须明确列出最终 source commit/tree、十文件 MANIFEST、queue/writer/observer 及所有执行依赖 SHA、普通 wrapper 与完整任务 action/定义、两 observer 命令、原件摘要和预期唯一输出路径。源码测试和旧成功不能替代此材料审核或后续新鲜观察。
