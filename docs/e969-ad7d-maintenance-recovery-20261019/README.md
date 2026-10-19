# e969/ad7d 同维护 ID 有限续接

应用 target 保持 e969，operator 使用独立提交。原包、PREPARED、STARTED、FAILED、admission 和 actor 原件不改。本协议承认原 Enter 已产生部分维护效果；不是零效果重试，也不重跑 publisher。

固定 queue→rotation 锁内核原件/来源/前驱/同 ID requests 维护、原 actor 与后代退出和无后续动作。新鲜独立高投影与普通低投影严格交叉；仍运行的 Django 服务只按已部署 receipt 精确身份准入，周报自然完成后才过原生命周期锁。所有只读准入通过前不写 RECOVERY-STARTED。

普通用户调用，`--out` 指向尚不存在的私有 evidence 目录，父目录可预建以保存 transport 日志：

```powershell
node tools/e969-maintenance-recovery.mjs --execute --out D:/codex-artifacts/e969-ad7d-maintenance-recovery-20261019/live-e969-ad7d/evidence
```

独立高观察会话按 REQUEST 原路径/SHA 写同目录 OBSERVATION.json，并等 ACK.json：

```powershell
node tools/e969-maintenance-observer.mjs --request REQUEST_FILE --sha REQUEST_SHA --out OBSERVATION_FILE
```

`--check` 替代 `--execute` 时只做相同准入与私有证据，不开始固定恢复日志。正式执行已包含全部准入，可省单独 check。

固定 `reconciliation/e969-ad7d` create-only 记录同 ID 一次原生 EnterMaintenance，失败/未知不再进入下游；PS gate 自身也以 NATIVE-ENTER-STARTED 防重放。成功后沿原 Stop→DeployApp→HardenAcl→apply→ExitMaintenance→Start→VerifyStartup 和最终就绪检查。复用原先完成的制品复验；不 build、不迁移、不新增备份。

全部原生回执及摘要绑定 RECOVERY-SUCCESS，随后 create-only 原 attempt/SUCCESS.json，明确 recoveryProtocol、originalFailureSha256 和恢复目录。既有 readLivePublication 可通过同 source 旁标准 SUCCESS 读取新版本，不改 PUBLISHED-MAIN 指针。已有恢复 STARTED 无成功时拒重新执行，不能换 out 绕过。
