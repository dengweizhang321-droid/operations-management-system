# S05d R1b 实施定向设计

2026-10-23；源基线 `36668589cab03d5d2d9d98383fb58eeb19c391ee`，worktree 已快进复用 `6d8efc50`。请求角色 `decision / gpt-6-astra / high`，底层实际型号未另行独立确认。本文只负责方案，不实施、审查或执行现场动作。

本轮用户已授权“旧入口封闭/旧工件禁用 → S05d 工具实现独审 → 现场清单 → 满足前置后 S05b”，无需重复询问这四步。现场动作由主负责人串行执行。涉及大范围服务身份、DPAPI、系统权限改造时仍按已约定停止并报告取舍；不得将本方案转成一般控制安全重构。

## 一、最终选择：封原操作来源与工件，不封所有历史代码

本轮实现 R1b 的精确语义是：**保留 a3 原 unknown，在可验证的新退休边界后，原请求绑定来源的受支持旧路径与全部旧产物寻址已不可继续执行或消费，允许原队列处理新的目标。**不证明原来零作用，不重新执行 a3，不伪造 FAILED/SUCCESS，也不放宽已有两条 decision。

需要区分“调用者代码来自旧版本”和“被执行/消费的是原 a3 来源或工件”。例如当前 405 immutable snapshot 中的旧 Django helper 即便可运行 Deploy，只要原 a3 prepared id 所需的固定 receipt/app.deploy 路径全部已封存且没有回退，不能因此消费原 a3。405 自身 Prepare 产生不同来源工件，不等于 a3 继续。此能力是否属另一发布应仍由原授权/维护门禁决定，本工具不改其生命周期权限。

因此不采用“所有旧 JS/PS 都必须永远不能执行”的扩大目标。不允许把 archive 路径重新传给旧工具、主动复制旧字节、git checkout 恢复 366 或伪造旧 id 归为正常误调用；这些是主动恢复已退役来源，超出本方案威胁模型。仍必须挡住原受支持命令、原 source 路径、旧 id/hash、旧固定入口和自动复用缓存的正常误调用，不能依赖“操作员不要点”。

实施前设 **A 门槛**：真实旧入口在原路径/原参数下的只读验证和私有低层替身反例能证明原生拒绝；原先驱 verifier/start 路径仍正常读其原字节。A 未成立不写 production sealer，不交永远 blocked 的空壳。

## 二、精确作用域与身份

原 dispatch `a3d53227-8976-4762-8be6-6f8c28107b5b`、request `2c90e2a2-24c1-4dc1-9811-ae7c4888a6e8`、selectedTarget `36668589…` 及其原字节摘要仍为唯一原操作绑定。准入规则按结构和证据定义，不在实现中白名单这些 ID。

当前实例限定：prepare-only，Worker+Django，migrate=false，无 schemaRelease，精确变更不触发 Pi upgrade。不得把通用 Pi/WSL/迁移写能力当成本实例已可能产生的作用。若实际原请求/源码条件不满足这组受支持范围，拒绝本分支。

来源身份采用原 request/PREPARING/source-binding 的完整元组：Git commit/tree（若字段实际存在）、内容树 SHA、原 sourceRoot 的规范路径/路径 SHA、前驱 Worker/Django/chainState、原 config/bundle、原调用模式。不能混淆 40 位 Git tree 与 64 位内容树，也不能将单一相同脚本 SHA 当完整来源相同。

有限注册域包含原 packet 树、main-release-packages 正式注册目录、Worker staging/releases/五个 state 域、Django prepare/deploy/previous 与原生发布引用、固定源树、Git 正式 worktree/入口引用。只扫描已注册的实际来源与消费根，不扩成全盘内容搜索；发现支持的外部 alias 但无法纳入闭包即拒绝。

`D:/运营管理系统-sales-django-release` 是旧 Worker 无 source-binding 的默认集成源，不能漏掉。root 已只读确认其 HEAD 为 `5faac815…`、tracked clean，非 366；仍需至少真实内容不等/资格化身份依据，不只凭 commit 不同断言内容不同。这个固定源若不属于被退役元组，保持不动。

## 三、对象分组和实际文件策略

| 分组 | 具体处理 | 不允许的捷径 |
| --- | --- | --- |
| 原 queue/dispatch/result、control execution、原 request/PREPARING/source-binding | 原位保留，稳定摘要绑定；新 ledger 引用 | 不删 unknown，不重写终态，不伪造失败 |
| 原 packet 的可执行 `source` 与同来源未消费 stage/snapshot | 用冻结操作清单移出原受支持路径，原字节保全于非消费 archive；旧固定路径不得链接/回退到 archive | 不仅加新 marker，不以可读旧路径留存冒称已封入口 |
| Worker 未消费计划/prepared receipt/sidecar、candidate release、publication staging | 按引用闭包成组保全并从原 native 寻址/自动复用集合移出；记录原 path/id/hash→archive 对应 | 不只移 release 留可自动复用 receipt；不删原件 |
| Django 未消费 `app.prepare-<id>.json` 与 `app.deploy-<id>` | 成对保全并移出固定 runtime child 寻址，旧 exact id/hash 应原生失败 | 不把 receipt 或 deployment 改成假失败；不允许替换同 id |
| 当前有效 head、已消费 successor/consumption、当前 Django app、必须的历史链 | 原位不变，不搬走其 self-verifier/manifest/tool | 不修改 immutable manifest 使旧字节“看起来”兼容 |
| partial/归属不明 | 可以纳入保守未消费集合，但完整列明、保全、证明无 live 引用；最终清单决定是否可封 | 不按生日或单 marker 归 a3，不清空 staging |

archive 必须在配置固定的独立根，位于所有 native 自动扫描根之外。不能是 runtime/.staging 子目录、releases 子目录、旧 source alias、junction 或 symlink；不存在消费者自动跟随的重定向。工具内部 reader 通过 ledger 映射读 archive 原字节，绝不向旧生产 consumer 返回 archive 路径。

原 packet 的三件绑定原件可以原位留下；被移 source 的原路径应缺失或为经过验证不能充当源码目录的拒绝记录，不能再是可执行树。原 writer/历史 reader 的静态形状不会适用新状态，因此第三分支用独立 schema/collector；不能改旧 collector 让 source 缺失也视为通过。

保全不得泄露 `.dev.vars`、凭据或日志中的敏感正文；报告只列路径/大小/摘要/状态。已知硬链接、reparse、交叉目录引用及活跃句柄须按实际对象身份处理；未知链接不照普通文件搬运。工具不得递归删除旧根。

## 四、A 门槛：必须证明的真实旧入口语义

1. **原 publish-main / publish-prepared**：已有 PREPARING 且无 PREPARED 时原入口拒绝；source 路径退役后不能重新冻结/填充同 packet。若某固定包装能自动从 Git 重建同 target，必须由已采用 target ban 在重建前拒绝，不能依赖后面失败。
2. **Worker bound plan**：`source-binding` 的 sourceRoot、原 source-binding 文件和完整 content identity 强绑定；旧原路径不可用时拒绝，不能自动以 `workerSourceRoot` 回退。用旧 `reusePlanSha256` 时仍需原固定 plan/receipt/sidecar/candidate 路径；封存集合须让全部旧入口失败关闭。
3. **Worker unbound plan**：默认使用固定 `workerSourceRoot`，而非调用工具所在 snapshot。仅当它不属于原来源且无原 prepared identity 自动复用时，可保留该工具读执行能力。检查 `worker-prepared-builds` 自动扫描是否会绕过旧 id 禁用。
4. **Django installed app 自调用**：Prepare-Application 与 Deploy-Application 开头拒绝 `ExecutionRoot == InstalledAppRoot`。此处是真实旧门禁，不要将运行包顶层 helper 算为必须替换的写入口。
5. **Django source-snapshot 调用**：不能套用 installed-path 拒绝。Deploy 可从任意合格源码 helper 读取 exact id/hash；但 `Get-PreparedApplication` 只从 `RuntimeRoot/app.prepare-id.json` 和 `RuntimeRoot/app.deploy-id` 定位，且绑定 runtimeRoot/predecessor/manifest。必须以真实入口证明原路径封存后拒绝，不能只 mock 新 wrapper。
6. **Django Prepare/Deploy 不带 id**：来源是 `$PSScriptRoot/..`。若该 snapshot 是原 a3 来源，必须纳入来源封闭；若是不同有效前驱来源，则其生成不同工件不是 a3 重放。源码 helper 可读本身不等于原 a3 未封闭。
7. **Rollback/已消费状态**：`app.previous`、已激活 Worker chain 或其他 native rollback 路径若含原来源/候选，不得当未消费工件移走。出现此种情况即离开本分支，要求具体已发生作用对账；不能以 source archive 掩盖已部署。

测试使用私有 RuntimeRoot/低层受控替身，并把真实参数 parser 与函数前置顺序保留。对已安装路径、live snapshot、未消费原366 snapshot分别命名夹具，禁止从一个反例推断全部路径。

### immutable 兼容的精确停止条件

若必须原位保留且可读的活跃 immutable source-snapshot 本身就是原来源，并且真实 Prepare/Deploy 能产生或消费原来源工件，而不存在旧代码已经执行的拒绝门禁，则同 SID 下无法仅以 NTFS 权限区分“verifier 哈希读取”和“解释器读取执行”同份 PS/JS。不能改 manifest、删工具、放宽 verifier 或假称 Execute ACL 能阻止 Node/PowerShell 的读取解释。

这是明确的有限 **NO-GO**：指出实际路径、manifest 引用、必需读用途、可到达写入口及私有反例。只有这种针对本实例的冲突才否决本轮 R1b；不同405来源 snapshot 仍可读可执行，不能单独作为否决证据。出现需要服务身份/DPAPI/整树权限重构的解决方式，停止并报告已约定取舍。

## 五、必须采用“先封来源，再退休，再对账”

原 Django Prepare 不持 queue/rotation。若先重启，再靠两次空 census 去搬 source，期间旧命令仍可启动，这是未关闭的竞态。因此阶段顺序固定：

1. **安装新 reader/闭锁能力**：在原 unknown 仍阻塞下安装已审控制材料；新版本可识别 retirement ledger 并拒绝未完成批次的新 dispatch，但此时不解除 a3。
2. **冻结 intent 与来源路径清单**：精确绑定原件、控制代际、退休前 boot、原范围、所有源 alias/旧 id、运行前驱和工具摘要。建立本次恢复自身的持久状态。
3. **阻止原路径新进入**：持 v1 queue→v2 queue→native rotation 锁，按唯一 intent 把来源路径移出受支持位置；原件与 archive 不删除。旧 task 仍可能被唤醒，但 queue 的原 unknown/新恢复闭锁必须在 prepare 前拒绝；需要实际 task 暂停等动作时由 root 按受控步骤处理，工具不能暗中改定义。
4. **完整退休**：此时先前已经加载代码/持有句柄的原进程仍可能迟到产生作用，不能宣布完成。root 使用受控、已验证且符合本次授权的完整退休屏障；若使用完整系统 restart，必须原生证明新 boot、非休眠/混合恢复及完整域归属。普通服务 restart 不等价。旧进程未知历史 PID不再是必要条件，但不得假定 restart 已发生。
5. **退休后盘点与工件封存**：重新取得三锁，对原路径重新出现、archive 中迟到修改、所有 runtime 工件和消费引用进行最终全清单与稳定读取。source 原路径重现、出现新原来源消费、活跃引用或不稳定状态即拒绝。预退休快照不等于最终证据。特别是 close 后、boot 前的原内存 actor 仍可能复制出新的可执行 alias；boot 后若发现未被原关闭清单覆盖的新 alias，不能顺手挪走后沿用此前 boot 证明退休，因为它可能已经在 boot 后被新进程加载。本版应明确 blocked，不自动循环重启；需要继续时另冻结扩展清单并取得覆盖其关闭时间的新退休边界。
6. **最终动态复验与提交**：独立观察、ordinary ACK、静态根重枚举、控制/task/boot/前驱复核、CAS 后写 SEALED；再创建新语义 resolution，让 queue仅能处理未来目标。

原有 pipe 锁不能跨重启，必须用两个真实 lock epoch；持久来源关闭、原 unknown和恢复 ledger 将二者连接。不得伪造同 epoch，也不通过重启抹去 ledger。本版 provider 选择 `full-boot-after-sources-closed`，不提供凭当前 census 或不完整 held-handles 推断的 fallback；工具原生重采当前 CIM 启动时间、Kernel-General 启动事件及 Kernel-Boot 完整启动类型，绑定同机、pre-close boot、新 boot、原始事件摘要和关闭阶段。时间矛盾、混合恢复、同 boot、缺事件、用户自填 proof 都拒绝。工具只观察退休事实，不自动重启机器。

来源路径移动可能遇到正在使用的句柄。移动失败保持明确未完成状态，不杀未知进程、强制删除或改用 copy 后删。移动成功也不代表旧进程已退休；迟到者可能通过已开句柄修改 archive，最终摘要必须退休后产生。若需要保留原路径移动前的所有可变字节版本，必须先形成可验证快照；做不到则明确相应保全缺口，不把最终字节当原始时点字节。

## 六、受控入口、参数与自身 unknown

建议实现单一冻结 operator，命令分 `inspect`、`plan`、`close-sources`、`seal-after-retirement`、`read`；具体命名由实施者统一。写命令只接受绝对 config、原 dispatch、已冻结 intent SHA/目录与阶段，不接受任意 runtimeRoot、任意 archive 根、任意 source 列表、外部自填 retired=true 或任意 `--proof` 覆盖。私有根注入仅测试，CLI 不提供生产回退。

每步 immutable action 记录：operationId、前一步摘要、原件绑定、路径清单摘要、源/目标文件系统身份、preimage、期望 postcondition。移动优先同卷原子目录 rename，目标必须预先不存在；不得覆盖归档内容。清单必须在目标父根允许集合内，拒大小写别名、越界、父子重叠、reparse 和未经解释的多链接。

中断在 rename 与回执之间时，只允许同 intent 复查有限状态：原位置完整且archive无对象→尚未移动；原位置无对象且archive对象身份/保全完全一致→可记录已观察后置；两边都有、两边都无、摘要/对象身份不同或未获可信退休后仍在变化→本次恢复 unknown，保持闭锁，不重复移动。不得仅按目录名猜测“已经执行”。

阶段状态建议 `planned → closing → sources-closed → retirement-pending → retired-inventory → sealed`，另有本次恢复 `unknown/blocked` 原件。停止工具不自动撤销关闭状态。没有独立审定的撤退条件就不恢复旧路径；恢复旧 source 等价重新开放原操作，不能作为失败清理。

## 七、reader / bundle / 安装顺序

新封存语义与旧 cleaned/superseded 分开，旧 validator、history catalog、原 operatorNames 接受集合保持。新分支的 operator/provider/collector名单独立并全部纳入 control bundle 依赖闭包，禁止只将源码一个文件复制到现场。

安装新控制 reader 不要求先解决 queue unknown；现有 installer 的三锁/代际 CAS允许这一顺序。但如果新 task/reader 需要旧source实际被先移动才能采用，要在材料里说明启动导引，不能手写 installation 或绕 installer。

新 writer创建的 resolution仅说明“原 outcome仍unknown；原来源与工件已退役封存；未重试；未发布；准入未来工作”。证据必须绑定 sealed ledger、archive清单、当前控制代际、原结果摘要、完整退休事实与最终复验。`prepared=false`、`publicationPerformed=false`、`retryOriginal=false`；不宣称 candidateArtifactsAbsent，因为本次确实保留 partial。

禁止重放原 selectedTarget 的规则永久保留，不只拦原dispatchId。新queue reader在选择/冻结/准备前检查 target；本分支不能通过新ticket或新packet绕过。任何 ledger未完成、原路径重新出现、archive变化、控制回退或封存清单消费恢复都拒新准入。旧reader遇新decision失败关闭，不能映射为prepared或superseded。

## 八、最小实作与验收止点

实现范围限：R1b exact scope判定、来源与消费闭包 collector、持久 intent/逐步幂等/archive mapping、受控operator、第三reader/writer语义、bundle闭包与必要定向隔离检查。复用现有 canonical/stable-read/CAS、三锁、ordinary identity、独立observer/ACK及控制安装，不造新队列，不改业务服务身份，不重构日志宿主。

必须通过的反例：旧source原路径直接Prepare/Deploy；无id的Deploy自动Prepare；跨helper源而使用旧id消费；Worker自动prepared cache与explicit plan复用；原路径重现；自身每个中断点；archive假目标/别名/已存在对象；旧reader不认识新decision；新目标误选原target。测试应验证真正旧parser/native前置，而非只测新函数返回false。

任何一个受支持旧入口仍可在原参数/原alias下产生或消费原来源，即A不通过，返回具体证据，不以本工具尚未部署解释。若A通过、实现独审通过，root再生成真实操作清单并检查现场条件；清单和原生退休后证据满足才进入S05b。工具实现通过不等于boot已发生、对象已封存或现场恢复完成。

本文完成后交由Sol实施与独立审查。规划者不操作现场，不再次把已授权四步变成一般方案讨论；遇上述精确不可兼容条件才返回有限no-go。
