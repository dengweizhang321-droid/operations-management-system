# 发布控制链稳定性：最小实质优化

2026-10-23；基线 `e7978118`，上游 main `36668589`。按模型分工 v3 的 decision/Astra High 交付规划；底层型号未额外独立确认。本轮只规划，不实施、现场扫描或子派工。用户目标是发布过程可重复、可停止、可判定地执行，不能以清掉一个目录或一个正例代替。当前约束仍为独立分支交付，不合 main、不自动准备/采用、不新 dispatch、不上线或改服务/数据库。

## 已有能力与真正缺口

| 已有且应复用 | 还需补齐 |
| --- | --- |
| `9925e6ac` 的 Hidden=false、显式任务安全描述符、普通 token/父子链、冻结 host；真实普通 3/3、高侧 8/8 同实例通过 | 将同一已审入口固定复用；新增阶段前先检查兼容条件，不能每次另写现场 driver；正常/拒绝/中断的结果分类与执行路径需形成私有回归 |
| 完整 inventory 固定四槽、私有 buffer；4 对象当次完整哈希和 snapshot CAS 已完成 | CAS 仍逐叶串行且重复取属性；38.860 秒只是 snapshot 子项，不含 closure/ordinary/boot/ref/代际，距 40 秒仅约 1.14 秒；完整 40 秒与最终动态 60 秒窗口都未通过 |
| source-content/完整 Git 成员区别、已消费历史/有限旧残留、全部登记源和原生引用闭包、ref fence、永久 target ban | 新诊断工作树以原 target 的完整源码加 44 个文件存在，缺前置来源检查和任务退出闭合；错误文字把“额外文件”混称 partial，直到昂贵 collector 后段才暴露 |
| 原队列、唯一 native prepare/publish、三锁/代际、PREPARED 精确复用、原 unknown/no-replay、封存与 boot 协议 | 共用同一组合准入实现与分项计时，证明完整组合有余量；旧 unknown 的恢复不能成为任何新运行的重试授权 |

依据：[现场报告](../s05d-field-validation-20261023/REPORT.md)、[原独审](../s05d-field-validation-20261023/REVIEW.md)、[S05b](../施工/S05b.md)、[S08](../施工/S08.md)、[S16](../施工/S16.md)。417.808 秒为前像与独立 snapshot CAS 总时间，不能与另一轮 closure 时间相加冒充一次生产计时；S05d 恢复成本也不能算作每次常规发布收益。README/架构/前端规范字节与本上下文已读版本相同，无 UI 修改。

## 第一期：来源和诊断生命周期，先消除晚发现

**改可执行流程，不只补规范。** 在现有 collector 提取可复用的登记源分类步骤，由完整 collector 和固定只读诊断入口共同调用：先枚举 Git 正式登记、固定源及受支持生成入口，按现有实际字节/完整成员规则分类，再开始 release/payload 大扫描。输出每个阻断根的 HEAD、来源角色、missing/extra/changed 数量、是否为原 target、对应保全/占用限制；把同 HEAD 附加文件与真正缺文件分别报错。最后仍重新枚举登记集合并 CAS，前置检查不是长期许可，也不代替全闭包。

新增一个有限的诊断工作区准备/收尾 helper，复用已有 freeze、摘要清单和 worktree 工具：代码变更仍在独立 worktree；临时脚本、日志、观察 JSON 默认写到对应 artifact 根，运行前冻结必要工具及相对 import 闭包、核全文 SHA，禁止把整份项目复制到 artifact 规避登记。诊断入口不得启动业务，冻结工具仍按已审 source-entry/helper 语义受外部来源闭包约束。输出根由工具计算且不得进入源码树，不能由调用者填任意生产写路径。需要保留的方案/证据摘要最终作为正常任务文档提交，不把 untracked 输出长期留成来源身份差异。

任务收尾生成机器可读 `retained / ready-to-remove / removed / blocked` 回执：绑定精确 worktree/Git 管理目录、HEAD/branch、tracked/untracked/ignored 清单与保全摘要、引用/占用核查及 Git 登记/实际目录结果。复用项目原清理规则和工具；只有已授权、已保全、未被使用的普通树才移除，应用托管树走原应用归档。此回执用于发现遗漏，不授予 collector 排除资格。中断或校验失败保留原目录和材料，禁止清理 pending 的自动重试；下次只对账该清理动作的有限状态。

**必须保留的取舍：**一个与原 target 同源码、仍可正常调用旧 producer 的新 worktree，确实属于旧来源闭包。不能靠名称、目录、诊断用途、增加 docs、换 commit 或“不是生产树”自动放行。安全做法是提前识别并在受控时点保全退出；若用户仍在使用，就明确阻断相关退休动作。全局保护不应扩成正常每次发布都扫描所有历史树；这项完整来源核验仅用于需要该证明的退休准入。发布本身继续绑定冻结来源，与日常编辑树分离。

本次 44 文件保全/旧树移除由 root 按已有授权单独闭合；它只解决当前来源实例，不等于本期工程完成。新树在前置后加入、已有根改为原来源、source alias 恢复，末次 CAS 仍须拒绝，不能靠收尾回执豁免。

## 第二期：优化完整 CAS，保留原窗口和证据

主要修改限 `preparation-retirement-fs.mjs`、`-archive.mjs`、必要的 collector/core 接线：

1. 先给原组合路径加入有限分项计时：closure CAS、四对象 CAS、ordinary/Task、boot/ref/native、adoption/original、最终写入前尾检；记录实际起止与重叠，不改判定。共同只读准入函数供 writer 和诊断调用，writer 仍独占锁/intent/移动/封存写；诊断只返回观察结果，不能签发可供下一轮写者消费的 proof。
2. `assertRetirementSnapshotUnchanged` 目前对每个普通叶调用 `retirementEntity`（lstat+realpath）后又 lstat。把同次路径/类型/属性读取合并为一个内部函数，保留 realpath、reparse、对象身份、nlink 和全部纳秒属性；目录仍核完整成员，junction 仍核对象身份与 linkText。按全批固定四槽并发复验叶，复用 inventory 已有的有界调度/失败 drain 思路；四个对象不能各再叠四槽无限扩张。任一失败停止领取、等待已启动只读操作退出再抛错，不留下后台读取和提前成功。
3. 完整摘要仍在每次调用新读，叶/目录最终 CAS 仍覆盖全体，不能用跨调用缓存、mtime 跳 hash、抽样、硬链接去重或忽略依赖节省时间。无需先改 inventory 四槽、构建缓存或另写原生扫描平台。目录/祖先被替换为链接、叶替换、成员增减、读取中变化必须保持拒绝；并发不允许削掉顺序原本提供的稳定性检查。
4. 若测量显示剩余固定成本主导，再合并**同一读取点**的重复身份/Task/boot 查询到一次现有 PowerShell 进程，保留全部字段、各自来源及失败语义；跨动作的首尾代际/CAS不能合并。不要预先动这部分或把动态检查移出计时窗口。40 秒完整 CAS、60 秒 observer/ACK/SEALED 新鲜度原门禁均不调整。

工程目标是在代表性规模的完整 40 秒路径留至少约 10 秒余量、最终 60 秒路径留约 15 秒余量，属本次优化目标，不改原生阈值、不承诺 P95。只得到 39 秒正例不能称稳定优化完成。先在私有约 10 万叶/相似目录深度的夹具核新旧完整验证等价及有界资源，再在 root 另行授权的现场只读轮中一次测完整组合；没有普通/Task/代际部分就明确只是子项。锁/采用条件只能由真实 writer 获得，观测不能伪造已采用或写者成功。仍无余量则报告具体主导段，定点优化，不循环真实试跑寻找一次偶然通过。

## 第三期：固定 handoff 与有限全链路回归

复用现 `prepare/register/run/status/cleanup` 与内容寻址 frozen host，不建立长期 broker/通用队列。新阶段一次冻结 RUN、来源/工具、材料与旧代际；执行前检查 Hidden=false、完整定义/安全描述符、实际 medium token、唯一实例、父子创建身份及代际；运行中不因工作区继续开发漂移。已完成同输入/同制品用原 native 回执复用，动态门禁仍即时读取；已尝试 run 永不自动重发。状态工具明确“未请求、已请求/未知、native 完成、有限前 native 拒绝证据”，保留原退出码/unknown，不能把 Task Ready、退出 0 或空目录单独显示成成功。

c6/28a 的原记录、冻结 host 与 no-replay 保留。只有已审的精确前 native 拒绝证据才允许修复后新 host/new run；这不是异常通用恢复。STARTED 后无 RESULT、native 已完成但退出/输出不全，均停在原结果对账，不由新 run 重放。after-logon 继续用本身 boot/intent 协议，不能套用 demand-start 的正例。普通 handoff 既有同链事实直接复用，只有影响该契约的代码变化才补一项相关同链检查。

建立固定私有检查入口，调用实际 parser/资格/CAS/阶段顺序，副作用端只在私有拓扑替身；不是复制一套判断或每次现场临时编程：

| 必要边界组 | 通过条件 |
| --- | --- |
| 来源生命周期 | 同原源码+额外诊断文件提前准确阻断；实际区别根按原规则通过；保全失败/在用树不删除；前置后新登记或恢复 alias 末检拒绝 |
| CAS 正常与变化 | 新旧完整 proof 判定等价；叶、目录、link、manifest/reference 任一变化拒绝；错误后四槽全部 drain，计时包含全部必须项 |
| handoff 正常与拒绝 | 一次 native 调用产生原回执；token/ACL/definition/host/代际变化在 native 前拒绝，尝试记录仍阻止重放 |
| 中断与部分完成 | REQUESTED/ATTEMPT 后中断、STARTED 后中断、native 完成而 RESULT/EXIT 不完整，各自保留未知；不新建 run 隐式再调用；已存在封存 journal 只允许原有限对账 |
| 期限与最终读取 | 注入超时令完整 40 秒、动态 60 秒门禁各自拒绝；reader 重新全读，源恢复/代际回退/boot 不合格拒绝，不消费上轮诊断 proof |

这五组可复用已有 fixture/证据，只补改动触及的断言；不重跑 S05c、不跑业务/全仓测试、不为了样本追加生产发布。独立 Sol 直接审改动和原件，后续只增量复审。

## 分期交付与完成判据

一期先交来源前置分类、固定诊断/收尾 helper；二期交完整 CAS 优化与统一计时；三期把两者接入同一已审入口及上述私有阶段回归。可以一个聚焦分支交付，按依赖顺序实现，不能只交规范或仅改错误文字。S08 继续复用 `release-scope-plan` 的文档/测试判定与原制品复用，不在本轮泛化 `tools/**` 轻量；S16 不借此扩成构建缓存工程。

源码与私有检查通过、原独审通过、完整组合预算有实际证据、正常与中断/失败边界保持，才称**本次稳定性代码就绪**；推同名独立分支，不合 main、不触发准备。控制采用与真实 S05b 完成仍需对应授权和原生回执，本次规划不提前执行。后续自然运行用同一计时/状态记录积累样本，有新失败按精确阶段定位；不把一轮成功声称整个发布永不失败。

## 补充：退休验证已进入常规发布关键路径，整体目标尚未闭合

2026-10-23 定向只读调用图核对；不审查或替代在途 Sol 实现。**修正上文成本前提：只有来源关闭/boot/封存写入是一次性动作；当前退休 reader 的全量校验会成为以后正常准备和发布的重复成本。** 本期三项局部改造即使通过，也不能据此宣布整个发布稳定性目标就绪。

真实路径与频率如下（以当前文件函数为准）：

- `drainPreparationQueue` 在存在兼容 pending 且走到历史 dispatch 扫描时，对旧 terminal `unknown/failed/blocked` 调 `readPreparationResolution`。`resolvedDispatches` 每个内层轮次新建，只去掉该轮同 dispatch 的多 ticket 重复；原 unknown 保留，因此后续兼容 pending 仍会再验。无 pending 的直接队列 drain 不走这段；不兼容 ticket 分支先终结并 continue，不能说每个扫描无条件触发。
- `readPreparationResolution` 的退休 schema 在普通/history 分支之前，直达 `readRetiredPreparationResolution → validateRetirementSeal`；后者重收全 closure、每件 archive 完整 `snapshotRetirementObject`/hash，并统一末 CAS。没有已消费后自动退出该分支的代码。
- 成本不止上述一次。`publish-latest-main` 的 CLI 入口、`observeLatestMain` 的 fetch 前/取 target 后、`prepareLatestMainOnce` 的冻结前均调用 `assertRetirementAdmission`；`drainLatestMainQueue` 的 `assertGeneration` 回调及 selected admission 也调用它。`assertRetirementAdmission` 对每个 sealed intent 再次全验，没有共享本轮 queue 结果。正常无分支失败的兼容 drain 路径，仅队列/observe/freeze 就可达七次同一退休全验；经 CLI 进入还可能增加入口一次。精确次数取决于入口、pending/重入及拒绝点，不是“每票恰好一次”。空队列的 CLI 入口也可能先做该检查。

这意味着同一批 archive 的约 2.16 GB 逻辑数据可能反复新读；既有 417.808 秒是封存前独立四对象诊断，**不能当未来每次 archive reader 的精确时长**，但代码已证明重复全读的规模与频率。新增 retired intent 还会增加扫描量。即使四槽 CAS 提速，完整哈希、closure 及每个 admission 的成本仍在；静态预算通过不等于正常准备延迟可接受。

**已有能力能复用，但不能直接替代当前语义：**history catalog 绑定的是已审历史 resolution/dispatch/terminal 和证据目录，仍重新读其证据；退休 schema 当前不走它。把 a3 加 catalog 或改 schema会跳过新分支要求的当前来源/alias、archive 字节及控制/ref/boot核验，属于语义改变。当前有效链/后续 consumption 只证明对应新发布发生，不证明旧 archive 当前完整，也不证明原未知 actor 从未作用；永久 target ban只拦目标选择/重造，不能独自挡旧 helper 的其它 source/旧 ID寻址。source关闭、完整boot、archive独立根/链接拆分及ACL提供封闭基础，但当前同SID配置不是不可变存储/可信逐字节未变证明，不能凭它们把旧摘要当新证据。

**允许的最小下一步分两层，不能混称已解决：**

1. 可单独研究同一次顶层操作、同一未变准入阶段内的重复验证合并：把 resolution资格、intent/ban、目标准入和代际共同交同一只读组合核验，一次新鲜全读、原消费点保留完整动态末CAS；直调入口仍自足，跨 fetch/来源创建/代际变化等边界不能默认沿用。需先用私有调用计数与状态变化夹具证明哪些调用确实重复，不能简单删除 `assertGeneration` 内的 admission 或加全局/进程缓存。它最多消除倍率，仍保留每次需要当前字节语义时的全读成本，不解决跨操作的数分钟固定成本。
2. **在“不跨调用复用证据、仍证明当前所有 archive 字节相同”的约束下，现有历史回执/消费链无法免掉下一次全读。** 要让封存后长期准入变轻，须另一个窄设计明确：哪些义务仍动态执行、哪些可成为只证明历史事实的耐久证明，以及何种实际强制机制能保证不可消费/不可变或可靠见证变更；其采用/回退、旧入口兼容和反例必须一起证明。若不改变当前字节语义，则只能继续优化每次完整读取，不能宣称免全读。当前没有这个机制，本补充不指定新broker、缓存、标记捷径或权限重构。

因此本轮可交付并如实称“来源生命周期/CAS/固定handoff局部稳定性改善”，**全发布稳定目标仍有封存后常态准入的重复验证与长期成本缺口**。这项缺口应先形成上述独立窄设计/可行性结论，再决定是否采用当前退休方案进入常态；不得靠一次 S05b 成功、8/8 私有检查或清理旧目录覆盖它。后续最小验收除原变化拒绝边界，还须覆盖两个不同的新目标连续到来、空队列入口、同轮多 ticket、一个重复调用边界发生来源变化，记录实际完整校验次数/读取量与原unknown/targetban保持；均可先在私有拓扑完成，不为取数新建生产 dispatch 或反复发布。
