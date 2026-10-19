# 领取超时后的占用回收修复

## 问题与改动

京东物流10067在领取helper时10秒超时，外层残留ready占位并阻塞后续14条。隔离复现证明：若客户端在Worker准备期间断开，延后pipe已销毁请求可使内层根本收不到claim；原两分钟回收仅在claim成功后启动，物流claim错误又未连到失败释放。当时没有Worker-ready时间戳，该机制与现场吻合，但不能把具体就绪时序写成已证实。

- header-only代理请求改为显式end，不再依赖可能已销毁的客户端请求流；已提交业务的执行、超时与清理仍由原Worker控制。
- Worker监听就绪、发送ready之前启动原两分钟空闲回收，覆盖首次claim尚未送达的空窗。业务入口的busy/clear和阶段末arm保持。
- 物流领取节点错误接到已有“失败后释放原执行helper→保留证据并明确失败”分支，继续绑定原execution，不自动重试或创建新任务。

未放宽未领取、其他owner或busy状态下的release检查，不改下载、导入、店铺隔离、批次或业务状态机。

## 验证

- 断连、物流工作流及slot隔离/生命周期测试10/10通过。
- 天猫helper与京东物流pipeline相关定向测试50/50通过，包含活跃请求不被空闲回收、身份/乱序/未知导入与重放保护。
- 真实未改helper bundle＋Worker、全新空配置合成root：不发送任何业务请求，ready后120023ms clean退出、outer slot移除、旧execution拒绝复用。脚本：`node --import tsx tools/test-helper-claim-cleanup-smoke.mjs`。
- 原断连故障回归用真实已销毁IncomingMessage验证内部仍收到一次claim；另验证业务请求已提交后客户端断开不取消执行。
- 首次smoke因合成root缺少必需空配置而失败，补齐两个空stores配置后上述真实回收通过；不修改生产配置。
- 修改文件的ESLint、Git差异检查通过，独立deep-review源码审查通过；不运行全仓lint、全量单测或真实业务补跑。

## 交付与采用边界

本任务只获开发优化授权。源码、模板、验证与发布制品分开记录；合并或准备成功不表示生产已采用。最终提交与原生PREPARED绑定在交付回执中，不在本文件自引用提交SHA。

共享helper工具按现有完整范围计划准备；没有migration变化，不执行数据库迁移。正式上线须另获用户明确“上线”授权，并在原受控组件切换后对同一`JdLogisticsDaily2026`采用本次已审领取错误分支；采用前基于fresh live核验仅此分支变化，不用旧模板覆盖其他现场改动。保留原工作流定义和原失败execution；不重放10067、不创建补跑或发送通知。

现场取证及原缺陷隔离复现：`D:/codex-artifacts/workflow-wait-diagnosis-20261019/ROOT-CAUSE.md`。本任务不再次解除现场占用或重启服务。
