# A M4 候选交付状态

本文件记录候选实际状态，最终通过证据和合并由 I 接纳。正式开工基线 `9d4830ee`；共享 main `39bc403a` 已普通合并；I 公共候选 `feb53457`、`d9dcdd67`、`85e80b5a`、`0cb2e426`、`20198666` 已按准确 SHA 普通合并。仅推 `codex/netshop-promotion`，未合 main、部署、迁移生产、启停正式服务、下载导入/补跑、外发或调用付费模型。

## 实现与来源

八分区实际行为及 S/C 消费合同见 [contract-v1.md](contract-v1.md)。5.1—5.4、5.8 读取真实完成事实并验证聚合/字段/覆盖；5.5—5.6 保留原管理员、京东志高单店1—7日真实明细门槛，缺源说明；5.7 已接原报告，ROI仅显示名、paid=false、owning_revision绑定及读取失效回调。分类与归因窗口仍未核实，不推造源维度、客户或自然成交。

Pfocus 使用精确共享商品身份，before q/page 匹配，店日费率主/辅独立且完整范围标注。来源矩阵按 current context coverage 和专属 coverage 两注册表消费，真0/来源内可核验缺席/缺字段/缺日/映射多义分开。

## 已验证及未决

| 项目 | 证据/结果 |
| --- | --- |
| 作者最终 reader | `dd4c9bec`，41 A+原Report6=47/47 PG，正常停止，`promotion-query/author-product-focus-11/foundation-pg-ccad63eb0225` |
| 独立核心 | 业务冻结 `249e6d2e`：Q 121/121 PG（41A、6Report、8公开A、3公开P、63F），SystemCheck0、normal stop；105 Node、自己10 actual DTO正向通过；`promotion-review/final-249e6d2e-e55e114aafb9468f9eed94737560baa7` |
| Root相关 | A/Q/report/SDK/AI 92/92 Node，whole vinext build0，A eslint0、583模块production-boundary0；私有 `.runtime/promotion-checks` 保留日志 |
| 类型 | I201窄化测试后 fresh188继承诊断，A及其测试文件0诊断；未宣称全库通过 |
| 全库额外检查 | 首轮2980：2949pass/11fail/20skip；缺独有纯Python test-venv的7项建立本树纯venv后单组复验通过，未改实现；1 Windows单例及3公共旧源码形状断言另交I，不把首轮叫全通过 |
| 浏览器 | Root06实际 React组件+独立PG reader，Q CUA Chrome正在完成；原report本期9/1—7/基期8/25—31、revision2:3945dbcbc18d/21源行、ROI及HTML/XLSX actual落盘已独立确认 |
| P2返回 | Q发现已应用周对象日期焦点及local sort未随 A→P→A 返回恢复；已交 I sole 公共 bounded/account-bound promotionPrefs 请求，待真实补丁及复验 |
| P2导出来源 | Q发现 XLSX原tables输出没有 owning_revision元信息；已交 I/F 可选 provenance sheet、旧默认字节/表/数值保持请求，待实际补丁及真实文件复验 |

当前不能据核心 PG/Node 称整体 M4/浏览器通过。上述两个 P2 必须闭环；P/A完整公开组合及最新main同步最终由 I 验证。

## 隔离材料和资源

测试证据父目录均 `E:\codex-artifacts\netshop-scheme2-20261001`；各轮使用独有命名空间/CreateNew，旧失败不覆盖。Root01初始化重复版本行失败、02初始化ready后stdin关闭、03测试线程未释放连接而耗尽私有PG16上限并停止卡住的唯一helper、04修close_all/bound4后24连续真实HTTP/decoder通过且正常停止、05前端3150仍自有占用时guard拒绝均保留。03私有PG64126精确目录/PID核验后普通pg_ctl stop0，helper51308另核验后结束，不伪称完整normal退出。仅06作为最终UI候选，真实权限控制只改固定 synthetic AppUser，client cachedadmin未伪改。

| 树/分支 | 用途/处理 |
| --- | --- |
| `D:\.codex\worktrees\netshop-promotion\运营管理系统` / `codex/netshop-promotion` | Lead整合、候选/Root QA，3150/18150由Root控制，完成后仅停自己实例；工作树由I最终清理 |
| `D:\.codex\worktrees\netshop-promotion-query\运营管理系统` / `codex/netshop-promotion-query` | 作者3专属backend files、私有venv/PG，已停止；dd4c9bec |
| `D:\.codex\worktrees\netshop-promotion-report-baseline\运营管理系统` / `codex/netshop-promotion-report-baseline` | 干净39bc复现旧Report5 teardown失败，未改guard；后由I合法fixture修复，保留原失败 |
| `D:\.codex\worktrees\netshop-promotion-ui\运营管理系统` / `codex/netshop-promotion-ui` | 专属组件与QA三文件，df216e33；未启动任何ports，交接README/handoff保留 |
| `D:\.codex\worktrees\netshop-promotion-review\运营管理系统` / `codex/netshop-promotion-review` | 独立Q自己的依赖/PG、唯一Q测试92959176、最终材料，I按完成状态清理 |
| `D:\.codex\worktrees\netshop-promotion-demos\运营管理系统` / `codex/netshop-promotion-demos` | 43392781用户保留01预览，3196继续留用，未用作正式PG/API验收 |

各树 `node_modules/.venv/.runtime` 可再生；必要PG/日志/截图/导出及摘要逐文件保全到独占E，不保存凭据或真实客户数据。未自行归档树/删远端分支；I最终按资源/锁/独有历史/来源证据验收清理。
