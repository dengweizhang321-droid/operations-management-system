# 固定 693e 取证与终止入口

操作只能针对已审固定原 dispatch；不提供 target、request、packet 或队列目录覆盖参数。先完成本次代码独审及合并前兼容性验证，再由负责人准备并采用绑定最终提交的新控制 bundle。采用不等于应用上线。

## 只读 collector

在绑定该控制 bundle 的干净冻结 source 根运行；`objects` 只在调用者内存中，下面只打印摘要：

```powershell
node --input-type=module -e "import{collectNativeAbandonmentState}from './tools/main-prebuild-queue.mjs';console.log(JSON.stringify(await collectNativeAbandonmentState()))"
```

首版 16 并发文件读取的真实样本为 123.968 秒，仍不足以支持旧的重复全树/60秒写法；修订把目录各阶段也纳入同域有界并发，并分开静态库存和最终动态采样。读取失败不产生 resolution，不删除候选，也不能据文件名/时间推断原操作无作用。正式 writer 会固定采集初末两次完整库存并输出真实分段计时，不再额外 standalone 全量 probe。

## 普通 writer 与独立 observer

writer 必须由当前登录用户的未提升 medium token 执行。高权限调用方通过已审的固定普通用户投递通道启动同一精确 Node/CLI，不从管理员进程直接执行，不改变原 preparation task action，不授任意命令接口。`--out` 必须是 `D:/codex-artifacts/` 内尚不存在的目录。

```powershell
node tools/native-abandonment-writer.mjs --out D:/codex-artifacts/prepare-693e-resolution-20261019/final-observation
```

writer 在双锁内输出每阶段的 `requestFile`、`requestSha256` 与 `responseFile`。负责人启动另一独立只读 observer；普通 token 无法完整观察其他 token 的可能控制进程时，只读 observer 使用可完整读取 CIM 的身份：

```powershell
node tools/native-abandonment-observer.mjs --request <requestFile> --sha <requestSha256> --out <responseFile>
```

分别响应 `initial-observation` 和 `final-observation` 两个不同 nonce。writer 在 S0 归档后发首轮请求，在 S1 与 S0 全等并归档后发末轮请求；完整库存各一次。observer 验证请求绑定的 canonical 库存及全部对象 SHA、原件和当前有限 head/fence 入口后，才开始 task/CIM 动态计时，不重扫候选全树。它保存精确身份并等待原 writer ACK 才退出，不能用手写 JSON 代替。

两轮必须属于连续持有双锁的同一 writer epoch（固定整体 20 分钟期限）。每轮 observer 的 `dynamicStartedAt` 到 ACK 必须小于 60 秒；末轮该时间和普通 `censusStartedAt` 到 resolution append 仍都小于 60 秒。首轮和静态库存不冒充最终新鲜事实。最后普通 CIM 之后没有完整 collector 或耗时源码检查。任务应为原 READY、instances=0；任何 actor、后代、可能 builder、未知元数据、S0/S1 不同或相关计划/消费记录出现都保持阻断。

writer 成功只追加：

```text
D:/codex-isolated/main-manual-release-20261016/prebuild-queue-v2/resolutions/693e15d4-3390-49b1-9b7c-48fa4f737d48.json
```

它不改原 results/unknown、旧 blocked、PREPARING、候选或 staging。若中断于归档后而未生成 resolution，保留所有原件及新增证据；本入口不支持自动 resume、重放或覆盖。先核中断阶段并进行相应有限协调。

成功后先用 adopted queue reader 核验此精确 resolution，再按原 `publish-latest-main.mjs --prepare-only` 普通队列流程为当前新目标建立新 ticket。新目标只有取得其原生 `PREPARED.json` 才可发布。原 c36 目标始终禁止再次派发；旧 blocked 不改写。应用部署、迁移、服务启停不由本 operator 执行。
