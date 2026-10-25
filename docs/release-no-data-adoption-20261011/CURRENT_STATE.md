# AB 闭合后重新准备

2026-10-11。当前开发基线 `origin/main ba656eabbb93d17d6e2f57d51ea3d13b27d1f50d`，独立 worktree `D:/\.codex/worktrees/release-no-data-adoption/运营管理系统`，分支 `codex/release-no-data-adoption-20261011`。原 no-data 交付 `74ea55ef` / `4b11776e` 已合并；其九文件源与冻结载荷保持，不将旧离线载荷冒充正式候选。

本轮用户明确选择：旧 C 仅在其他对话准备与复审，统一安排发布。本对话继续自身必要开发、测试与候选准备；不向其他对话发送未经明确要求的消息。封存前核对 C 的实际交付范围，避免重复覆盖共享模块；无第二功能也继续本次策略调整。任何先行采用造成前驱变化，都须重新准备并复审。

## 现状证据

原 AB `FINAL_AB_DELIVERY.json` 原字节 SHA `790313b4ab938a87bf5a32e09e2e2b2962ae834293c9e57c0c44b1a54a2f2792`，独立确认在同一外置目录 `E:/codex-artifacts/release-integration-review-20261010/AB-health-probe-20261011-verified-final/`。必要验收逻辑时点为 2026-10-11 09:03:03.646（上海），全部交付为 09:37:36.818。原 ownership 已释放、active 文件缺失；这是补充批准合同完成，不能改写旧引擎为全部成功。原 strict false 与三个 unknown 保留。

实际 Worker 前驱 `20261010T014638Z-97833d2f2b7e7bc9`，manifest `f4e537eb20dfa60127cf588db0ed911223c0b59c44fc8b839e5df196428e7113`，完整 source-snapshot 5157 文件 / `92c2656c064c6a202239f4f010f0d241e90ae19fb35638cd328727a7ac64973c`；Django manifest `237fbe0de6e4fbab6b80389298ba1b8a5951b5aaf213c250ad3ee9f590010ab9`。release chain 为 219 / `aaf62994c75c3ca46362328fed6acc76f812808a2e852566782e5e0ba897e0d9`；AB WAL 为 109 / `5289afacafc13d0fe36e10c0b3df7ae7811e59616827f24565761b0079abd11f`。前驱在正式准备和执行前仍须重新核验。

## 必要补齐

原 production preparer 和 collector 固定 `D:/运营管理系统-sales-django-release`；该来源仍被原记录引用，不能覆盖。现无可复用本任务九文件 prepared receipt。新增精确来源绑定，以源文件、原准备 identity、实际前驱和链绑定构建/manifest/plan/receipt/batch/collector，保留全量字节和物理检查。预计 Worker 源范围从九模块增加至十模块，生产准备源仍只包含实际 AB 完整源加本任务必要增量，不复制最新 main 的其他未采用修补。

独立发现的兼容性缺口：实际安装 `django-postgres-maintenance.ps1` 在 Backup 后调用安装态 `release-payload-retention.ps1 -Execute`，后者及 mjs 使用 colocated rotation/verifier。旧 rotation exactKeys 拒绝新 plan 字段，旧 verifier 也不能接受新 manifest.source 及可信 verifier 字节。Backup 会捕获并记录 cleanup failure；不能将它隐藏为已兼容。现有 Worker guard 安装只更新 protected source root，不更新 Django app 工具。因此需核对现有 PrepareApp/DeployApp 的最小工具同步方案、业务/配置/依赖字节保持、切换顺序和回退；尚未执行生产更新。

本轮新增来源契约只用于精确准备和验证，不产生免备份资格。首次采用仍保留严格/full 保护，所有生产操作在最终不可变候选和批次封存、独立复审后另行明确批准。日常周期、三份保留及保护策略不修改。既存 Worker 自动恢复、历史不可用采样及根因未知保持为独立风险，不能用本轮模型意见或隔离测试宣称已解决。
