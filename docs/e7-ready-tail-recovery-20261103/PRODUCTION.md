# e7 应用发布与记账收尾完成

2026-11-03。用户先授权“发布上线”，在精确记账候选完成后明确“现在可以记账修复”。应用目标为 `e7aaf6c16939770d0941994873747fe301ef0b93`；应用已切换并就绪，本次精确记账修复也已完成。**原自动发布末端ready503的失败保留，不追认原自动发布成功。**

## 发布与恢复分开记录

应用准备和发布只走固定 `publish-latest-main.mjs`。19:20:00.821（北京时间）生成PREPARED；普通用户发布完成DeployApp/HardenAcl/WorkerApply/ExitMaintenance/Start/VerifyStartup，最后19:48:12.320的ready503使原FAILED。后续19:50、19:52只读观察已ready200。首次管理员调用被令牌门禁拒绝在生产动作之前，之后同包从当前用户Limited任务执行，原日志均保留。

精确恢复程序与配方在分支 `codex/autoimport-publication-20261103`，最终operator提交 `8c5a7c84aa744aa3082a849a6e6bf3589f364b84`，工作树 `D:/codex-isolated/autoimport-publication-20261103` 保持干净冻结。本页在另一纯文档工作树记录，避免改变已绑定的operator身份。

- 普通权限只读probe：20:06:46—20:07:50，exit0，`read-only-verified`，accountingWritten=false。
- 普通权限apply：20:08:22—**20:10:13**，exit0，`accounting-recovered`、accountingWritten=true、originalFailurePreserved=true。
- probe一次、apply初始与最终各一次独立跨token见证；高权observer只做原发布者退出证据，不获记账或生命周期能力。三次observer均原生退出0，不留常驻观察进程。
- 原消费者`readLivePublication`在适配器内回读目标e7成功；PUBLISHED与独立恢复回执绑定一致。startupVerified=true、readyVerified=true；恢复过程applicationActionsPerformed=[]，没有再打包、部署、重启、维护、迁移或发送。
- 临时普通probe/apply任务均在确认Ready及exit0后精准移除。首轮普通发布任务也已在结束后移除，所有日志、原FAILED和见证证据保留。

## 精确绑定

| 项目 | 值 |
| --- | --- |
| 冻结应用包 | `D:/codex-isolated/main-release-packages/e7aaf6c16939-f23d8bf6-5aaa7584` |
| Worker release | `20261103T110935Z-c5916e23fb720393` |
| Worker manifest | `368cfb74d70a75f9245c71454972367d9fe4bf18c10cb8c771b9c6ccfc893913` |
| Django manifest | `527bb5f5e0c7ad67749676893f14629b66799128ca76fe114bd7827cd29832eb` |
| PREPARED | `27c28eb34df8fa24940582072937346d5277d328cd9482663d086d22c9d0b66b` |
| 原FAILED，仍不变 | `5c38e81989b993426d18bd96f0ec783294fd9617702a1dd6df920a488c859ead` |
| 独立RECOVERED-SUCCESS | `fe20ff2f3a4576ceb6445dfe59a5b1ee73d3fbb5131a0c8a118fdf95f523e42c` |
| 当前PUBLISHED-MAIN | `98a604d3a7d79f341de89ffaf658e3452d1749943f78e1c2e56a0345612c030c` |

恢复回执位于 `D:/codex-isolated/main-manual-release-20261016/accounting-recoveries/e7aaf6c1-ready-tail-20261103/RECOVERED-SUCCESS.json`，保留 `manualRecovery=true`、`automatedPublisherSuccess=false`、`publicationPerformed=false`、`originalPublicationStatus=failed`。其中publicationPerformed=false只描述这次记账恢复未重做应用操作，不否认此前应用已经实际切换。

授权、普通任务INVOCATION/EXIT、stdout/stderr、三次见证及清理记录在 `D:/codex-artifacts/e7-ready-tail-recovery-20261103/`。原应用发布日志和只读现场汇总在 `D:/codex-artifacts/autoimport-publication-20261103/`。

候选独审及53项隔离有效检查已在operator分支报告记录。独立Sol High请求上下文完成收尾复核：恢复回执/catalog/旧catalog前像/原FAILED、BINDING与operator、COMPLETED及三套REQUEST→OBSERVATION→ACK摘要均吻合，临时任务清理回执正常，operator仍为8c5a7c84且干净。工具没有提供底层实际型号的额外证明。收尾复核只消费原生回执和文件绑定，不追加生产功能验收或再次健康扫描。

## 503后续

本次503已经恢复，精确失败服务在原发布日志中未被保留，不能断言是某个服务代码错误。长期防复发建议见 [503处置方案](503处置方案.md)；**该方案尚未实现或上线**。E2代码仍未合main、巡检未安装；本轮没有n8n定义采用、客服失败闭合或业务补跑。
