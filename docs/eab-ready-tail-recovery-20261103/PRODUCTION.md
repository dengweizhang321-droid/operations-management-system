# eab998f8 受限记账收尾完成

2026-11-03。用户已明确授权开发、验证并执行本次受限收尾。目标应用 `eab998f81c984ee3d9e722bcd39f0f46a53a9820` 的发布记账已恢复一致；原自动发布在最后 ready503 的失败仍保留。本次是独立恢复成功，不追认原自动发布成功。

## 实际执行

- 执行代码提交：`d9896d0f703cb280b04e74fe185f689c5a2a319c`，程序 SHA256 `b44ba0d07bf52eb1cc3140cad9d84a9488937ff7d1ab53fce656faaf117ae854`，配方 SHA256 `c8dcef06a40ad77be70ac496212a192d2b3d9db76a0d6a6b5f4025afb5f1df4a`。
- 普通权限首次 probe 在 UTC08:51:10 因无法读取高权限进程身份而拒绝，exit1，未写记账。保留该失败，未降低未知保护。
- 增加独立的高权限只读见证桥后，普通权限 probe 于09:07:41完成，exit0，`read-only-verified`、`accountingWritten=false`。
- 正式 apply 09:08:15.216开始，09:09:58.262结束，exit0，耗时103.046秒。初次与最终CAS前分别取得新的完整进程见证和普通确认；高权限观察者只写仓外取证，所有生产记账写入均由普通权限适配器在原queue→rotation锁内完成。
- 适配器返回 `accounting-recovered`、`originalFailurePreserved=true`、`accountingWritten=true`、`publicationPerformed=false`。既有 `readLivePublication` 消费确认通过，当前记账为目标 `eab998f8`，`startupVerified=true`、`readyVerified=true`。

## 绑定回执

- 恢复回执：`D:/codex-isolated/main-manual-release-20261016/accounting-recoveries/eab998f8-ready-tail-20261103/RECOVERED-SUCCESS.json`。
- 回执 SHA256：`591bdef2e3cf376d71f4c0d8e76a86d655871e0af905e48bc71c7e32fb2a321a`；回执创建09:09:04.119Z，整次恢复完成以09:09:58.262Z为准。
- 更新后 `PUBLISHED-MAIN.json` SHA256：`5746c95af1214d4059f7dfeba7d8635aaef4c54ee098ca50dd34353672ad3007`。旧目录字节保存在恢复目录的 `superseded-PUBLISHED-MAIN.json`。
- 原 FAILED SHA256仍为 `70a134eb76f673ac12ee03fc6d3126031907c91e256d91145c7651b193c79731`；原STARTED SHA256为 `b969cb93d31fb3cadc07b6e11c715cadd5d91dcaf6342b9b754d82bdb3d0c5cf`。原attempt没有补写SUCCESS。
- 新回执明确 `manualRecovery=true`、`automatedPublisherSuccess=false`、`applicationActionsPerformed=[]`，关联原attempt、原失败、复用步骤及本次新鲜观察。未改冻结源码或已安装控制包。

## 验证与边界

本轮恢复核心29项隔离检查通过，见证增量21项及接点时序2项通过，实际固定队列/rotation私有接线与原读取器私有兼容验证通过；两轮独立审查无阻断。真实普通probe、独立只读observer及apply的原始记录均保存。未重做应用功能验收、构建、部署、WorkerApply、Start或数据库迁移。

两阶段正式见证目录分别为 `d75562bc-b189-460a-b8ce-9a97bc3556c1` 和 `777b064c-2760-4b7d-8e71-6a8616326061`（位于仓外任务证据的witness目录），REQUEST、OBSERVATION、普通ACK完整。测试和原生检查的局限不因恢复成功被改写。

源码已推送开发分支 `codex/eab-ready-tail-recovery-20261103`，**尚未获合并main授权、未合并main**。应用main仍为eab。工作树因未合并而保留；本次临时普通probe/apply和诊断任务均已移除，退出结果与日志保留。独立高权限observer均正常结束，没有持久观察服务或新增权限配置。

权威执行证据目录：`D:/codex-artifacts/eab-ready-tail-recovery-20261103/`，含 `apply/EXIT.json`、`apply/stdout.log`、`probe/`首次拒绝、`probe-witness/`成功、`REVIEW.md`、`REVIEW-WITNESS.md` 及见证记录。原发布失败证据仍在 `D:/codex-artifacts/remove-functional-acceptance-20261103/publication-eab998f8/` 和原冻结包内。
