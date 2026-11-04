# Ready 修复正式发布记录

2026-11-04，用户明确授权：“发布上线”。目标为已准备的 `ba78ceff052c543ff568f7c7eac0c42b983129e7`，组件 Worker+Django，无结构迁移。

**发布成功。** 原生 SUCCESS 状态为 `deployed_and_ready`，固定外层已核对本次目标并完成 `PUBLISHED-MAIN.json` 记账；命令退出码 0。北京时间 09:06:30.860 产生原生成功回执，09:06:44.089 固定入口报告成功，09:06:48.240 包装器记录进程退出。

## 执行入口

普通用户权限，后台执行固定已采用控制 shim：

```text
"C:\Program Files\nodejs\node.exe" "D:\codex-isolated\main-manual-release-20261016\control\tools\publish-latest-main.mjs" --config "D:\codex-isolated\main-manual-release-20261016\main-publisher-config.json"
```

本次包装器与原始输出：`D:\codex-artifacts\readiness-publication-20261104-084544\`。

固定入口进度日志：`D:\codex-isolated\main-manual-release-20261016\logs\release-2026-11-04T00-45-50.732Z-a3fe7634-e459-491a-9943-9580d340e1ce.log`。

制品包：`D:\codex-isolated\main-release-packages\ba78ceff052c-9918ce3e-527bb5f5\`。复用原 `publish-ba78ceff052c/preparation/PREPARED.json`；不手改冻结源码、制品、维护状态或发布记账。

前置只读检查见 [CHECK-RUN.md](CHECK-RUN.md)，路径分析及异常分界见 [REPORT.md](REPORT.md)。本次正式入口自行重新执行必要门禁，不追加业务功能验收。

## 发布结果与制品绑定

本次仅执行一次正式固定入口，无再次 --check 或发布重试。原 PREPARED 摘要前后相同；原生日志明确“复用本次main已准备的包，不再构建或安装依赖。”

| 项目 | 实际结果 |
| --- | --- |
| 最终应用提交 | `ba78ceff052c543ff568f7c7eac0c42b983129e7` |
| Worker release | `20261103T151159Z-f230d1a1bd5bf0d3` |
| Worker manifest SHA-256 | `186b7a0f56c7ce2ba31f0d5f94f4e87fa6150b5cb79cf30591b05207e3756a8e` |
| Django prepared ID | `fd4361f6ff2041d294067805b6791b7e` |
| Django manifest SHA-256 | `2c9a9ad3d040ab8b29caf6ff29e064d293da124dadb79df35526c2f4dea4c4ac` |
| 维护 ID | `a992400512fa4e6ba0772d75dcf2a2bb` |
| 原生状态 | `deployed_and_ready`；startupVerified=true，readyVerified=true |
| 结构迁移/新增备份 | migration=null，backupPerformed=false |
| PREPARED SHA-256 | `b6e65171d5e8e59de945cfd6e579eadbb826e3067a1a2ad6b8219e88197eadb2`，本次执行前后未变 |

原生成功回执：`D:\codex-isolated\main-release-packages\ba78ceff052c-9918ce3e-527bb5f5\publish-ba78ceff052c\SUCCESS.json`。

回执 SHA-256：`c035dfdccba4c66ab07fc1da00e72db0f6003088781b11e0b8e5a43a774ed1a8`。固定 `PUBLISHED-MAIN.json` 的 receiptSha256 与它一致，mainCommit、components、Worker release/manifest、Django manifest 均与原生成功回执一致。脱敏归档与字段核对见 [PUBLICATION-RECEIPT.json](PUBLICATION-RECEIPT.json)。

## 原生 ready 结果

原生末端 `readiness-observations.jsonl` 记录：**第一次观察即成功**，HTTP 200，23 个服务全部 ready，unavailableServices=[]。该次请求 elapsedMs=3276，等待流程 totalElapsedMs=3277，没有用完 120 秒等待预算，也未发生尾部重试。新版 Worker 已返回逐服务 queueMs/requestMs/reason 诊断。

以上均来自本次发布器自己的完成回执与观察记录。成功后未追加独立 HTTP 健康测试、业务接口调用或功能验收。

## 实际耗时

用户本轮明确“发布上线”是本次授权起点；聊天消息没有提供可核验的精确时间戳，因此不估造从授权到调用的秒数。以下是实际命令计时：

- 普通用户后台调用开始：2026-11-04 **08:45:45.355 +08:00**。
- 命令结束：2026-11-04 **09:06:48.240 +08:00**。
- 单调计时总耗时：**1,262.824 秒，约 21 分 2.82 秒**。
- 固定入口日志总计 1,253 秒，内层原生发布日志总计 1,113 秒；两者是包含关系，不相加。

| 原生阶段 | 日志耗时（秒，工具显示取整） |
| --- | ---: |
| 固定入口准备本次目标 | 19 |
| 固定发布前检查 | 105 |
| 维护前驱资格 | 0 |
| 复验已准备 Worker | 231 |
| 复验已准备 Django | 49 |
| 维护前只读检查 | 2 |
| 进入维护 | 257 |
| 停止旧前端 | 6 |
| 部署 Django | 66 |
| 应用后台权限 | 54 |
| 切换 Worker | 126 |
| 退出维护 | 60 |
| 启动服务 | 221 |
| 确认启动版本 | 9 |
| 确认服务可用（含最终版本链核对） | 10 |

取整阶段数与总耗时之间的差额包含编排、材料、版本/源码复核及进程启动退出，不将未分段空档归给某个 HTTP 或停服操作。本次超过 15 分钟目标，主要成本为原生制品复验、维护入场和完整启动；没有重新进行约 523 秒的前端构建。

维护入场请求从 08:52:58.549 开始，到原生成功 09:06:30.860 的跨度约 13 分 32 秒；其中包含逐域停止、部署和启动，**不是实测网页不可用时长**。入场过程中进度输出的 worker/waiting 为早期锁诊断快照；只读 launcher 日志已证实随后逐域停止在推进，不能误称持续等锁。

## 收尾与采用边界

本次正式采用 Worker 与 Django 应用包；固定控制包、桌面程序和独立看门狗的安装/采用未在本次执行，不能把应用发布等同于所有独立载体均换代。生产发布未改写冻结 source、原准备记录或身份门禁；PUBLISHED 由原固定发布器正常完成。

R1/R2 原报告保持不变，追加本发布记录与原生回执摘要。只检查本次文档差异、JSON/路径及成功字段绑定；没有补加功能测试。报告分支尚未获合并授权，继续保留原独立工作树，不清理正在被生产采用的冻结来源或制品目录。
