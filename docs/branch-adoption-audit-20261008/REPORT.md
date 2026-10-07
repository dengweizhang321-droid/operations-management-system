# 历史分支采纳与清理核验

日期：2026-10-08，Asia/Shanghai。检查基线为本地及远端一致的 `5274858b63c75b1b73dc2cf383636d6e9ef924fc`。范围是前次清单中的 40 个本地开发分支、26 个同名远端开发分支，以及其中未被主线历史包含的 15 个本地分支。

## 结论与本次改动

**不应把这 15 个历史分支全部合入 main。** 已有的有效功能通过后续提交或组合实现进入主线，另有明确未采用的失败原型、特定发布基线、设计演示及独立复核材料。保留这些原始历史，不能为了删除分支而补做业务合并。

本次只补入 `netshop-comparison` 的最终 M6 交付说明，来源为原纯文档提交 `6f67e499`，并明确标注历史日期、原适用范围和后续采用记录。其余业务源码、测试、演示及运行配置不作变更。未发现本轮必须补入的业务功能，不据此生成新的生产候选。

所有未来生产发布继续等待用户针对具体候选的明确许可。本次未准备或应用运行包、进入维护、停止/重启服务、迁移、导入或对外发送。

## 核验方法与边界

1. 成功 fetch/prune 后，以固定远端主线核验每个精确 tip 的祖先关系、主线外提交和 `git cherry` 补丁等价关系。
2. 对 15 个分支分别执行 `git merge-tree --write-tree`，生成不改变任何工作区或分支的合并模拟；逐项检查冲突和实际文件增量。无冲突不等于业务应采纳，补丁 ID 不同也不等于当前功能缺失。
3. 对有业务文件冲突的旧分支，检查当前源代码、冲突两侧和后续交付记录。核验到的现行实现包含共同期限的 DNS/TCP/TLS 阶段检查、取消传播、固定 BI 读取路径、平台序列参数、商品分区恢复、详情版本校验和稳定筛选布局。
4. 独立旧实验脚本/夹具和设计稿未重新执行，也不宣称它们适用于当前版本。它们继续保存在原分支及已验证完整 Git bundle。本次不是整套业务回归、生产性能测量或真实业务验收。

## 逐分支决策

下表分支名均省略 `codex/` 前缀；完整 SHA、模拟结果及未等价提交明细见同目录 `evidence.json`。

| 分支 | 当前证据 | 决策 |
| --- | --- | --- |
| bi-cockpit-implementation | 原 1 个补丁有等价版本；模拟合并文件树与主线完全相同 | 不重复合并；原工作树及历史保留 |
| bi-production-20261006 | 独有 `5e093b0d` 用于重建当时运行基线；模拟会删除现有测试并回退吉客云/登录/安装器代码，另有 12 处文件冲突 | 不合并旧发布基线 |
| bi-production-performance-20261006 | 7 个补丁均有等价版本；模拟只在 BI 实施文档产生冲突，业务文件无增量 | 不重复合并 |
| netshop-comparison | 模拟仅新增 `HANDOFF.md` 的最终交付说明，业务与测试无增量；内容与主线 M6 公告交叉相符 | 仅补入原文档提交并标注历史时点 |
| netshop-comparison-date | 原日期弹窗补丁有等价版本；冲突仅在已经演进的 Demo 日期文件 | 不合并旧 Demo 覆盖现行设计 |
| netshop-comparison-public-combo | 虽有 2 个不同 patch-id 的测试提交，模拟合并文件树与主线完全相同 | 无须重复合并 |
| netshop-comparison-ui | 4 个补丁有等价版本；剩余冲突仅是旧 Demo 的 CSS/JS/HTML | 不合并旧设计文件 |
| netshop-finance-subset-review | 虽有 2 个不同 patch-id 的取消修复，模拟合并文件树与主线完全相同 | 修复已覆盖，无须重复合并 |
| netshop-finance-support | 当前主线包含更完整的取消、连接阶段、workflow/BI 受限读取；旧分支冲突侧缺少这些后续修复，其他增量主要是旧 Home 夹具与测试入口 | 不整分支合并；独立旧证据保留 |
| netshop-integration | 模拟剩余 30 个文件均为测试、夹具、交付状态及属性文件；没有新增 app/backend/lib 业务文件；5 处冲突为旧 M6 Home 测试 | 不重复集成业务，不覆盖当前测试；历史协调记录保留 |
| netshop-presence-jsonpath | 原记录明确 0be 原型真实查询仍 57014 超时，不继续发布；当前查询已使用有版本/来源约束的 presence cache | 拒绝合入失败原型 |
| netshop-promotion-demos | 只新增 38 个静态设计与截图文件；README 明确合成演示、选版，并非系统实现 | 保留设计历史，不作为生产功能合并 |
| netshop-temporal-review | 模拟只新增 16 个独立测试、实验器和旧复核报告，业务文件无增量；实验器固定旧 SHA、历史证据目录和当时环境 | 保留历史实验，不自动纳入当前回归套件 |
| netshop-wave2-review | 冲突侧缺少当前 `seriesPlatforms` 等后继接线，其余主要是旧 Home 捕获、夹具和状态文档 | 不用旧测试组合覆盖当前业务和测试 |
| product-overview-worker-candidate | 特定旧 Worker 发布候选；冲突侧早于当前详情来源版本、分区恢复及稳定读取布局；本次主线已有 `44ef96e8`、`748443e4` 和后续筛选修复 | 不合并旧发布候选 |

现行依据：

- [M6 主线公告](../netshop-refactor/execution/20261001-M6-comparison.md)和[最终交付说明](../../app/netshop/comparison/HANDOFF.md)。
- [M7 最终组合](../netshop-refactor/execution/20261002-M7-final-combination.md)及[财务兼容生产记录](../netshop-refactor/execution/20261003-finance-edge-production.md)。
- [JSONPath 原型未采用及后续替代过程](../netshop-refactor/execution/20261003-combined-sql-production.md)。
- [商品领域集成契约](../performance/products/INTEGRATION.md)仅说明原任务范围，当前是否存在具体能力以本次源码核验为准。

## 已执行的清理

清理前复验原 tip、main 包含性、Git worktree 占用；查询进程命令行/可执行路径、计划任务与 Codex 自动化绑定。此检查不是操作系统全句柄枚举。没有以杀进程或取消运行任务取得清理资格。

完整提交历史恢复包为 `D:/codex-artifacts/branch-audit-20261008/reconciliation/before-cleanup.bundle`，`git bundle verify` 通过，SHA-256 为 `35A36D6E12781046918F5350A7C50B85239419CE4FB23977D5EAD9CA0380AE89`。包覆盖清理前所有本地分支和保留标签，不替代未提交内容或忽略文件备份；本次未删除含有独有忽略证据的树。

已删除原范围内 **18 个本地已合并分支和 11 个同名远端分支**。远端采用原精确 SHA 的 lease 和 atomic delete，防止删掉清理期间新增提交；本地使用正常 `git branch -d`，并在删除后分别回查本地和真实远端均不存在。具体分支与删除前 SHA 见 `evidence.json`。

已用 Git 原生移除以下两棵普通 worktree；两者均非受管附件、已合入、无未提交内容、无匹配的运行/计划任务/自动化绑定，路径和 Git 登记均已消失：

- `D:/codex-isolated/netshop-network-stage-fix/运营管理系统`：无 ignored 文件。
- `D:/codex-isolated/netshop-m7-legacy-unit-baseline/运营管理系统`：仅有可重建 `node_modules/`，随检出清理。

未测量删除前后的实际磁盘占用，不报告释放空间估计。恢复标签、原未合入分支、备份、生产目录、运行包和数据均保留。

## 尚存清理阻塞

原 25 个已合入本地分支中，余下 7 个仍由其他聊天的受管 worktree 占用。对每个路径实际调用应用 `attach_worktree`，均返回 `This worktree is owned by another task.`；当前聊天不能取得归档附件。它们包含构建目录或忽略证据，未绕过应用保护改用原生删除，也未强制解除 checkout。

| 分支（省略 codex/） | 受管 worktree 目录（均在 D:/.codex/worktrees/ 下） |
| --- | --- |
| bi-reference-redesign | bi-reference-redesign/运营管理系统 |
| netshop-readiness-gates | netshop-readiness-gates/运营管理系统 |
| performance-foundation-20261005 | performance-foundation/运营管理系统 |
| performance-integration-20261006 | performance-integration/运营管理系统 |
| sales-performance | sales-performance/运营管理系统 |
| shared-filter-auto-apply | 077e/运营管理系统 |
| workflow-market-masitu-recovery-20261007 | cb54/运营管理系统 |

远端 `bi-cockpit-implementation` 的旧 tip 虽已被 main 包含，本地同名分支还有后继且工作树仍保留，因此没有单独删除其远端。原 19 个已合入远端分支中本次删除 11 个、保留 8 个。

任务期间另出现 `codex/tmall-seven-day-gap-loop-20261008`，其初始 tip 恰好等于 main，但工作树有正在开发的未提交改动且所属聊天 active；它不属于原 40 个分支清单，明确排除清理。本次审查分支也单独处理，不能把新建于 main 当作任务已经完成。

## 验证与交付边界

本次变更仅为 M6 历史交付补录和本报告/脱敏 Git 证据，按[开发与交付](../规范/开发与交付.md)检查相对链接、Git 对象引用、差异范围和 `git diff --check`；不运行无关业务测试或生产构建。合并推送的准确结果在本次交付消息中给出。

结论为：应该清理已完整合入且无占用/独有内容的分支，但本次只完成具备条件的部分；未宣称只剩 main。没有待用户批准的业务发布候选，未来发布须另行交付具体候选与验证结果。
