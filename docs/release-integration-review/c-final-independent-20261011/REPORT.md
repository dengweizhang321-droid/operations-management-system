# C 下一步独立验收：3032 技术修补与发布守卫

2026-10-11，Asia/Shanghai。按用户要求继续实做 C 独立验收。本轮从最新 main `030024542ef76be081f69023fefb0601dd4d06b5` 创建专用分支 `codex/release-c-final-independent-review` 与独立 worktree；不修改统一准备方代码或冻结制品，不单独上线。

**3032 候选的稳定技术修补通过本轮独立核验；V4 动作前引用守卫仍有 P1 阻断 IG04。新“一次前备份＋一次新恢复工具消费链演练”方案正在统一方开发，尚未获得本轮验收签名。** 技术修补通过、批次通过、实际采用分别判断，不能据此称整个 C 已完成或准许生产。

## 本轮具体完成

| 对象 | 精确身份及结果 |
| --- | --- |
| 统一方源码/Git | source `9fa82567f9456ea7a81733e80d57218ad0ca5e00`，merge `95ce9be52df2e8d4f6499dfbd1d249742d15bbd2`，delivery `030024542ef76be081f69023fefb0601dd4d06b5`，对象存在且合入本轮基线 |
| Worker | `20261011T051645Z-3032ae332a32f1a0`，manifest `58cc236e09f097f2c7aec054af9699fc7c0aca3bda1cd79d1c47cbf06efd1a8f` |
| typed plan | `3fb9b0fe083862da5a1a426b444a91365b2ec4fdecb0c4191c2c18f0a12ccb5b` |
| prepared receipt | `6accd380f62dd6cfcae325f4460106fd166c34f99c578405b3a2098a22dc0af1` |
| SourceBinding | `dc45c01f2c9ea7398fae6c55c10d6408e59fdc9177d45fc7e81fd3172f367912` |
| 完整源码 | 5160 文件，tree `ef5cc058391988586de4cf2b64289a13f0f3682a1a38db5569213f704323e1d1`；inventory `dd769ec44a9833f876326c0df4b858a91ee2a656a636c33d5b402a87c0335d20` |
| 实际 AB 前驱源码 | 5157 文件，tree `92c2656c064c6a202239f4f010f0d241e90ae19fb35638cd328727a7ac64973c`；差异仍恰十个 tools 控制文件，业务文件未夹带 |
| Django 绑定 | prepared `1e1138feef7148fb851713c2b39a25d0`，receipt `10db2364053ebfb90d85dd301914753453d02ad313cd02ff7312ca654ebdeb9b`，manifest `85cf0699925aad21f98ae682f458789236d206723b10865939915d1bcacddd09`；两工具字节与 Worker 一致 |

主任务的[只读字节核对](BYTE_AUDIT_3032.json)独立重算完整前驱/候选源树及完整构建载荷：dist 164、helper 3、node_modules 31248 文件，保持原 ordinal path/length/content 算法，均等于 manifest。关键文件、plan/receipt 侧文件与完整 SourceBinding 元组一致；41773 个读取对象的文件元数据在核对前后未漂移。规定的 `.dev.vars` 仅检查三个文件身份相同的硬链接，不读取其内容。此核对不替代动作前权限、维护、排空、进程或当前配置身份检查。

[辅助收据核对](AUXILIARY_AUDIT.json)确认四份 audit 收据原始 SHA/版本，两个 C helper 与旧限定 ABC `9d41ce4f...` 原字节相同。没有因源码或目录名缩小完整差异范围。

统一方最终包内 166/166 日志 SHA `be46b9a6dffae86665616cfbf6bf505cb48b07757a3474a39cc9d8f333bc58e3` 与候选/源及 harness 绑定相符。本轮没有重跑这组已通过的测试；[九份 harness 重建核对](HARNESS_AUDIT.json)从 source commit 取原测试，精确复现已声明的路径替换，断言/夹具动作不变。若原测试来自 CRLF 检出，只有匹配声明原始 SHA 的精确材料化才使用；不把换行归一化用于生产源码/制品准入。166 不与187开发测试、旧139或本轮八例简单相加。

## 非作者技术复审

[非作者报告](INDEPENDENT_REVIEW.md)直接绑定实际3032代码，固定旧 Git `0a1e1ad...` 的独立 scaffold，一次执行八个必要用例 8/8、96.678ms，原代码/stdout/stderr保存：

- 慢 bound source 扫描完成后不续期旧观察；最终观察的原时间穿过 attempt 保存。
- chain manifestPath、Django 摘要和 WAL 头在慢读中变化均拒绝。
- 5001ms/倒退拒绝，保留 attempt 与阶段；NotReady 附实际过程证据及固定白名单状态，未泄漏 reason。
- 实际 observer wrapper、validator、原 create-only/fsync writer、append/journal 在私有根完成成功/失败两条存证链，旧事件原字节保留，WAL可续读 passed/unknown。

SourceBinding/迁移闭包的外部读取使用带断言的受控 seam，观察动作本体也是 synthetic；不称为完整现场资格、真实恢复或权限矩阵演练。没有生产模块导入、业务网络、原生子进程或生产操作。旧 generic `runApprovedOperation.readOnlyRetry` 的 parse/assert 诊断并未随 collector 修补而改变，本次签名不泛化为全部 runner 诊断通过。旧 f308/115fb 的拒绝结论和反例不改写。

## 安装范围与精确剩余阻断

[安装/回退非作者复审](INSTALLATION_REVIEW.md)核对 V4 的 canonical batch、SourceBinding/双包/阶段 pins、31个小文件及已执行16个路径VM的来源；没有重跑无争议测试或现场进程/任务枚举。新 Worker apply → guard → Django DeployApp/HardenAcl → ExitMaintenance/双 manifest Start 顺序一致，过渡段无 Backup/retention。新历史不能用旧 resolver直接回退，须兼容新协议的 successor及配套工具；真实回退/数据恢复没有执行。

**IG04，P1：** 外置 `adoption-scope-guard-v4.mjs` SHA `04655a323af97453b7ae38670a6470e495226e85c337fb9b0a72684726a54edd`，71及113–116行对相关解释器 `CommandLine=null` 和系统host ExecutablePath可返回 references=[]。真实私有VM负例期望 unknown 拒绝却失败（0/1，118.4421ms），原[反例](guard-null-process-counterexample.test.mjs)及[失败日志](guard-null-process-counterexample.log)保持。未证明实际生产存在引用，但现有守卫不能据此排除引用。

修复要求：采集足够的进程身份/类型以界定受检解释器及受管进程；必要命令行、可执行文件或身份字段不可读时记录 unknown并阻断旧 `app.previous` 替换。对可证明无关系统项保持窄范围处理，不一律误阻断全系统；继续保留8.3/cross-drive/space/ancestor/EACCES等断言。旧当前扫描“无引用”不能抵消空字段缺口，已复制旧包也不授予删除被物理路径引用原目录的许可。

IG04已经按用户明确授予的“发送验收交接”同步给统一准备对话；消息不授权生产，不要求其从工具回复。根将只读复核其后续交付的精确新guard与批次。

## 保护方案变更与接下来工作

已直接核对统一对话人类原文：本次改为“一次发布前备份＋一次针对新恢复工具消费链的隔离演练”，取消发布后重复全库备份/演练。这是新准备方案要求，不是已生成的新精确批次上线批准。

旧 V4 `65fc5338321efc2d79168764f7b2227002333199d038409dc6dd7277acaed8d2`仍有20操作/四个数据库阶段，已封未批准；它只作历史参考，不原地删步骤或借旧签名采用。新的门禁、源码、候选、测试、原工具链隔离演练及只读 retention消费链检查须由统一方按新实际对象交付。演练本身不调用备份保留工具，不能把演练成功当作整条消费链都已覆盖。

本任务下一验收点：修复IG04的字段/类型/未知传播负例 → 新保护类别的不可伪造资格与前驱/制品绑定 → 新候选和配套收据原字节 → 新批次操作/次序/回退/安全续接 → 新完整字节的非作者复审。重型构建/完整测试/数据库演练错峰串行；不为新未交付对象预先签字，不重放生产测速。

## 四状态、计时与本轮交付

| 状态 | 本轮核实结论 |
| --- | --- |
| 源码完成 | 9fa/95ce/030交付已合入；新保护方案代码仍在统一方开发，未借旧commit认定完成 |
| 隔离验证 | 3032完整静态载荷、作者166证据与路径-only harness通过；非作者技术八例通过；guard IG04反例失败成立 |
| 生产候选 | 3032技术修补可接受；旧V4守卫有阻断，新的保护方案候选/批次尚未验收 |
| 实际采用 | 本任务未维护、启停、部署、备份/恢复、调度、业务写入或外发；C/新机制没有本轮采用结论 |

静态字节核对实际 07:13:49.805Z～07:17:42.295Z（上海15:13:49.805～15:17:42.295），232.490秒；这是独立核对的成本，不是发布净收益。技术八例与guard负例是私有反例时间，不是生产时延。批准到必要验收/完整交付、生产排队及各生产阶段/真实入口不可用均未测。30～60/80～120分钟预算没有转为实测承诺。

所有本轮脚本只读现有对象或写自己的文档/私有夹具，保留其他工作树、源码和已封档案。公共Git/原日志归档与远端确认记录在外置 `E:/codex-artifacts/release-c-final-independent-20261011/DELIVERY.json`，不会把本轮文档提交当成新的功能源码或生产批准对象。
