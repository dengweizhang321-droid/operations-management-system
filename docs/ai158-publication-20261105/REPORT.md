# AI158 生产发布记录

**本次已上线成功。** 固定发布器原生返回exit0，`SUCCESS.json` 为 `deployed_and_ready`，发布目录已写入并指向本次真实成功回执。功能与业务使用效果由用户自行检测，本次没有追加功能、业务接口、权限场景或业务数据验收。

## 授权、入口与前置

用户通过 `codex-提示词-上线ai158.md` 明确授权本次发布，硬前置为不得早于北京时间2026-11-05 00:10发起。实际发起为 **00:25:25.895**，未重新合并main、打包或采用控制包，消费原就绪制品。

提示词中的 `--consume-preparation` 不是实际部署入口：已采用源码 `publish-latest-main.mjs:805` 明确其不能deploy，`:849` 调用准备队列消费者并直接return；真正部署走同一文件默认分支`:906`的deployReadyMain。因此，本次先运行固定shim的 `--check`，再通过**相同shim的默认deploy-ready模式**发布：

```text
node D:/codex-isolated/main-manual-release-20261016/control/tools/publish-latest-main.mjs --config D:/codex-isolated/main-manual-release-20261016/main-publisher-config.json
```

没有单独执行PrepareApp、DeployApp、ProvisionRoles或HardenAcl作为发布手段，没有使用旧包、工作区入口或自定义发布器。

### 首轮检查真实阻断及复核

首轮 `--check` 虽exit0，输出却明确“现在发布会被拒绝”：运行目录检查命中PostgreSQL临时文件 `pgsql_tmp56836.0` 的重解析点判定，另有身份无法读取的PowerShell进程55832被判为外来子进程。**没有按exit0直接上线**。

只读复核时两对象已自然消失；未删除临时文件、杀未知进程或为处置告警手工执行HardenAcl；正式发布器内置的HardenAcl仍按原流程成功执行。第二次 `--check` 的exit0与输出内容同时通过，识别原包ready-for-native-verification，目标ece8c7ec、现役ba78ceff，计划为database-migration、worker+django、migrate=true、AiTaskFeedbackCandidates 156→158。

### 午夜任务实际时间

已发布活动工作流元数据表明，午夜附近实际是 **00:10的吉客云任务**，不是00:00。execution `11196` 在00:10:00.477触发，最初仍running；等待其于 **00:21:49.702成功完成** 后才发起发布。发布后只读execution元数据仍为success/finished=1，结束时间不变，早于维护开始。

本次确认到的午夜调度没有被此轮停机吃掉；没有补跑、修改状态或核查五表业务结果。实际维护时间没有落在提示词估计的00:10—00:25内，原因是先等待真实00:10任务、复核两项临时门禁，再执行发布器原生前置复验；不得早于00:10的硬约束始终满足。

## 最终提交、制品与绑定

| 项目 | 值 |
| --- | --- |
| 发布源码main | `ece8c7ec46ac7bd7dc0a5a3e3eed8fcf065d3b65` |
| 控制包 | `9cfa94a96ab064910422df3b8c7d7b999622122eb83822f14ed1b4387b91ad8f`，本次未重新采用 |
| 原包目录 | `D:/codex-isolated/main-release-packages/ece8c7ec46ac-7094807e-2c9a9ad3` |
| 原生PREPARED SHA256 | `3a8684e5c63129335c6d7f770b888db27533ecfd2e45bef2fb2aaeea2c138020`，本次复算一致 |
| Worker release | `20261104T135815Z-28278a3e8f6ac4fb` |
| Worker manifest SHA256 | `1ccf5583bb1b52200dc075cee546331eb2df61cd29d454abd70b7a8d383c0a74` |
| Django prepared ID | `b46a7bb33d0c46b191277c19770ce38f` |
| Django manifest SHA256 | `04a31bc0a281df1360ffc7675d7b98194388417bf117672310520e0fe8099fd7` |
| maintenanceId | `25954b4507a347688e4751275e4dbc67` |
| 原生成功回执 | 原包 `publish-ece8c7ec46ac/SUCCESS.json` |
| 原生SUCCESS时间 | 北京时间2026-11-05 **00:51:59.588** |
| 固定入口终核完成 | 北京时间 **00:52:12.964**，exit0 |

`PUBLISHED-MAIN.json` 的main/Worker release/两个manifest与本次SUCCESS一致，receiptPath指向本次attempt，receiptSha256与SUCCESS原始字节实算一致。没有把历史成功、单个步骤exit0或部署文件提前变化当作本次发布完成。

## 原生步骤核验

| 要求 | 原生证据与结果 |
| --- | --- |
| 两表存在、迁移158 | Install与Finalize原生结果均为158，双steps为0088/0089；Finalize原生exit0、schema verified，窄catalog对两表、函数、约束、索引、trigger等核验通过 |
| ProvisionRoles实际执行 | 原 `配置Pi运行账本权限-process.json` 为completed、exit0，位于Install之后、Finalize之前 |
| 最终ACL | Finalize `permissionsVerified=true`；被绑定catalog的最终期望为AI writer SELECT/INSERT/UPDATE/DELETE、AI reader零授权。结论来自发布原生检查，不新增独立权限场景测试 |
| Worker/Django恢复 | 原Start、VerifyStartup及ready门禁通过，SUCCESS的startupVerified/readyVerified均true |
| 发布记账 | 固定入口完成终核、PUBLISHED-MAIN指向本次SUCCESS，摘要绑定匹配 |
| 午夜任务 | 11196在维护前success，发布后元数据仍success；没有额外业务结果验收 |

Native Plan→DeployApp/HardenAcl→Install→ProvisionRoles→Finalize→WorkerApply→ExitMaintenance→Start→VerifyStartup/ready均由原发布器串行执行。没有自行回退、取消排空或重放未知步骤，没有新增全库备份/恢复。

## 停机与Worker恢复时间

以下全部取原生日志或原步骤回执，时区为Asia/Shanghai。维护窗口严格按用户指定的 `system_maintenance_entered → service_stack_ready` 定义计算，不把它称为3000端口实际空窗长度。

| 事件 | 本地时间 |
| --- | --- |
| 发布命令发起 | 00:25:25.895 |
| `system_maintenance_entered` | **00:33:21.4979953** |
| `system_maintenance_ended` | 00:48:02.7353658 |
| `service_stack_ready` | **00:49:40.1460969** |
| 新Worker supervisor启动 | 00:51:16.305 |
| Worker子进程spawn | 00:51:28.765 |
| 原生Start确认稳定3000/5791归属及helper健康 | **约00:51:38** |
| 原生VerifyStartup通过 | 00:51:47.904 |
| 原生ready门禁与SUCCESS | 00:51:59.588 |

指定标记窗口为 **16分18.648秒**。Worker稳定归属/健康确认比 `service_stack_ready` 晚 **117.797秒**；从维护开始标记至该确认共 **18分16.445秒**。恢复确认优先取原启动服务结果的 `startCompletedAt=2026-11-04T16:51:37.9434469+00:00`，源码在函数返回前核稳定端口归属及helper健康；启动计时相加仅作辅助参考。

**spawn不是就绪，service_stack_ready也不是Worker监听恢复。** 本次没有连续采样端口，不能给出“首次监听瞬间”或完整真实无监听区间的精确起点；报告提供原生首次确认及后续版本/ready证明，没有为取时间追加独立HTTP或业务检查。

## 验证边界、证据与后续

此前**完整隔离原生冷启动未执行**，A层154以下父证明为合成接缝，这两项历史验证边界仍保留。本次生产发布已执行真实原生Start并通过启动/ready门禁，但不倒推此前隔离验证已经完成，也不代表AI功能或业务使用效果验收。

首轮检查、第二轮检查、发布时间、原始stdout/stderr、原生步骤及运行日志的界定证据保存在本机 `D:/codex-artifacts/ai158-publication-20261105/` 与原包attempt。本目录仅交付本任务必要回执、摘要和元数据，不提交凭据、机器完整编码环境或业务输出。

报告只在独立文档分支交付，不合并main，不触发重建或再次部署。功能与业务行为由用户上线后自行检测。

关键交付见[DELIVERY](DELIVERY.json)、[原生成功回执](NATIVE-SUCCESS.json)、[发布时间](TIMING-SUMMARY.json)及[核验索引](NATIVE-STEPS.json)。
