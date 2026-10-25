# 退休、对账、封存：独立可行性设计

日期：2026-10-23。基线 main `36668589cab03d5d2d9d98383fb58eeb19c391ee`，本工作树复用已交付 `3abdc6e9`，不更新 main 引用。角色请求沿用 `decision / gpt-6-astra / high`，实际底层型号未另行独立确认。本文仅为设计；源码调查、隔离验证和独立审查由其他角色完成。

用户本轮授权设计并验证可行性，不授权采用、准备、封存、队列写入、进程/服务/任务变更、数据库写入或重启。下面操作状态机均为**未来方案**，没有执行。

## 1. 选择与结论

可以不再追求证明 a3 当时零作用，也不要求找回原 PID：把证明目标改为**从一个新的边界 T 开始，旧执行不能再写入或消费受保护对象；T 时已有作用已分类，并与新工作明确隔离**。原 unknown 永久保留；新事实只支持封存原操作和恢复未来准入，不把原失败变成功。

这条路线逻辑上可行，但需要两个独立屏障：

1. **退休屏障**处理已经越过旧检查点、持有旧句柄的执行。针对不能完整归属的本机树，未来经授权的完整冷启动/离线维护可以一次退休整个旧本机执行域，无须原 PID；不能将普通进程列表为空或新锁已取得替代它。
2. **持久再入与消费屏障**处理重启后的固定任务、手动旧脚本、旧消费者及外部任务。它必须由旧代码已经执行的共同门禁，或旧代码无法绕开的对象/执行权限边界实施。新代码中的 fence、改队列状态、换路径，以及口头不运行旧脚本，均不能单独承担该屏障。

**首选工程顺序**：先用源码和隔离反例检查能否组合现有旧门禁封闭全部相关入口；不能闭合时，再评估只覆盖准备/发布控制对象的强制权限/能力隔离，不默认扩成整机安全重构。当前已发现原门禁存在覆盖缺口，尚没有可直接执行的退休/封存协议。不能把“逻辑可行”或“只读清单已完成”写为 S05d 恢复就绪。

本轮 go：完成有界源码作用图、现场元数据与隔离反例，得出每个屏障是否存在的可核查判定。生产 go：仍为 **NO-GO**，等待实际实现、独审、屏障提供者资格化及新的具体生产授权。当前有限恢复范围内不能直接实现生产封存器：已证明现成 marker/锁组合不充分，尚未证明哪个更窄 adapter 能补齐。更强权限隔离是充分候选，不是已经证明唯一必要的方案，也不是立即开展身份改造的建议。

## 2. 信任模型与反例

覆盖正常并发、原进程迟到、系统重启后自动启动、错误双击旧入口、误调用旧 source、崩溃重入和旧消费者复用。无需防范管理员故意夺权、操作者主动篡改封存证据或重新编写工具绕过协议；现有系统也不是对抗恶意本机管理员的隔离沙箱。

但下列是正常误调用反例，不能当“恶意用户”排除：同一普通 SID 下，在现存旧 source 执行 `worker-local-release-rotation.mjs plan --prepare-online`；直接调用旧 `django-local-service.ps1 -Action PrepareApp/DeployApp`；仍由旧任务/外部执行器持有控制权时执行 Pi 准备或消费。这些入口是否真正拒绝，应按实际源码和隔离接缝检查，不能因为它们不经过新 queue 就忽略。

持有同一 Windows SID、对同一对象拥有相同写权的新旧进程，不能只靠“新旧代码版本不同”让文件系统区分。这个结论用于寻找反例，不要求抵御恶意改 ACL。若旧工具可以直接写对象且没有旧门禁，重启后重新开放同一写权就会重新开放误调用路径。

## 3. 已有能力与缺口

| 层次 | 实际能力 | 本路线中的用途与限制 |
| --- | --- | --- |
| control generation | `readAdoptedControl(expectedBundle)` 与 `assertControlGeneration` 拒绝旧 bundle | 阻止未越过准入的旧 consumer；不能撤销已经启动的 publisher/build 子孙 |
| 原 packet | `publish-prepared-main.mjs:208` 在无 PREPARED、已有 PREPARING 时拒重入 | 保留原件即可拒原固定 packet 重做；原 actor 已越该行时不会再次检查 |
| queue reader | 未知 resolution decision 会拒绝；原 target 有禁止重放检查 | 新旧 reader 可以安全失败关闭；queue 门禁不是整个 native 消费面 |
| Worker rotation | 持原 rotation 锁；plan/apply 识别 `release-batches/active.json` ownership | 可作为真实 batch 协议的一部分，不能手填 active 冒充退休 fence；旧直接 CLI 不带对应 batch 身份会被拒 |
| Worker 普通 deploy | 首次发布之后 authority/current pointer 阻止普通首次 deploy | 不应误说旧 deploy 可无条件覆盖当前运行版本；仍有 candidate/plan/reuse/apply 分支需分别核对 |
| 其他 native 输出 | Django PrepareApp、candidate builder 导出、Pi 准备并非都受 queue/rotation/batch 覆盖 | 证明仍需覆盖的写入边界，不能把“拿到三锁”当全域静止 |
| 控制采用 | `install-main-prebuild.mjs` 使用 v1 queue→v2 queue→native rotation，保留原 unknown，不先读取 resolution | 安装新 reader 不必先解决 a3，因此不存在必然的“先封存才能安装封存 reader”循环；其三次空 census 仍不能替代全域退休 |

上述行是代码能力，不是现场执行许可。文件行号仅辅助定位，实际以冻结字节为准。

## 4. 新事实与原事实分开

原 a3 dispatch/request/target、unknown、PREPARING/source-binding 仍保留。此前没有可信的 dispatch 直接子树/退出证据，仍不能补造 FAILED。新调查提供了更具体的可行性输入：

- 当前 task 空闲、instances=0，但仍 enabled、allowDemandStart=true；action 与已安装定义相符。空闲不是未来不会启动。
- a3 时间窗存在 hook 与 consume 的 `control-executions`，具有 PID/创建时间/命令摘要/同 bundle 身份。它们改善了入口身份定位，但没有直接绑定 a3 子树及整树退休，不能偷偷提升为原退出证明。
- Worker `.staging` 的五个目录均非空。`fca7de7a…/build/.runtime/worker-release-activation-fence.json` 的 sourceFingerprint 与 a3 source-binding 的内容树 SHA 相同；这证明同内容，不唯一证明属于该 dispatch。其他 marker 缺失不证明没有作用。
- 根目录 ACL 摘要显示七个被查根 owner 为当前用户；Django 根有当前用户 FullControl，其他根含继承 group 规则。根元数据不是整树 effective-access 证明；当前未更改 ACL，也未做有效访问测试。

来源分别见本目录 `native-metadata.json`、`file-metadata.json`、`staging-markers.json`，最终文件名/摘要由报告统一定位。新事实支持“必须保全 partial，并需检查对象侧边界”，不支持直接封存或删除这五个目录。

## 5. 封闭域 D：必须有边界，不能笼统写“全机无进程”

定义 D 为这代准备/发布代码能写入、复用、消费的部署控制对象及执行权。冻结清单由精确 producer/import/子进程调用图产生；每条边列源码摘要、入口、运行 principal、外部端点、允许动作、既有门禁、屏障提供者。未知边不是空集合。

以下为域定义模板；其中必须按**本次精确请求**裁剪，不能把工具通常具备的能力当成 a3 已可能发生的作用。root 已核 a3 原请求：`components=worker+django`、`migrate=false`、无 `schemaRelease`，36 项 releasePlan changes 无 `backend/pi_runner/*.py`。结合 `publish-prepared-main.mjs:72–78`，本次正常 prepare-only 调用的 `piUpgradeRequired=false`。因此本次先限定 **Worker + Django / prepare-only / no migration / no Pi upgrade**；Pi/WSL 升级、迁移写入不纳入 a3 的必需退休域，除非精确调用图另有正面证据推翻此排除。此排除不把其他真实同域合法任务归到 a3。

模板包含：

1. 控制 state、v1/v2 queue、所有原件与控制 bundle、fixed dispatcher/hook、prebuild task、显式 main 发布入口。
2. packet/source/log/invocation/publication 目录；目标相关工件引用和所有可能复用它们的发布请求。旧 packet 不只改名，原件路径与引用要可追溯。
3. Worker `.staging`、`releases`、prepared-build、rotation-plan/consumption、publication-staging、successor、release-batch 及 current pointer；包含原 reader 会扫描或按摘要定位的临时文件和侧车。
4. Django `app.prepare-*`、`app.deploy-*`、实际 `app/deployment.json`、原部署/维护/准备/lease/permit 记录，以及原 direct Prepare/Deploy/Verify 入口。
5. Pi/Docker/WSL 等被调用边实际涉及的 image/plan/后台执行器。宿主重启不自动等于远端作业终止；Docker/WSL 只在源码确实可达时纳入，不能因为机器装了它们就升级为全量停用。
6. 准备期可达的远端存储、队列、数据库或服务控制。若可证明全部只读，记录方法/端点/源码依据后从写屏障排除；若可写或会安排持久执行，则必须有资源侧撤权、取消/排空/完成凭证与消费对账。没有该能力则此路线 no-go。

只核已知入口仍不足时，不做无界日志搜寻，而将“该域不能闭合”记为工程阻塞。重启、关 WSL、禁 n8n 或断网都不能被默认视为无影响的小动作。

## 6. 三种屏障方案的取舍

### R1：现有旧门禁组合 + 完整退休（优先验证，当前未闭合）

保留原 PREPARING、原 unknown；使用受审新控制代际使旧 queue consumer 拒绝；若真正采用 release-batch 协议则让旧 Worker plan/apply 缺 ownership 而拒绝；完整退休消除越过旧门禁的原进程。

足够条件不是“列出了几个门禁”，而是 D 的每一个写入/消费入口都必经其中至少一个在恢复后仍有效的门禁。Django/Pi/candidate 导出等缺口必须有实际旧检查点，或者有可信证据证明其可达写仅能产生隔离、不可消费且不干扰新工作的对象。不能仅将它们改名为“无害缓存”免除证明。

目前已有入口不覆盖，故 R1 不可直接采用。实施调查给出具体反例：旧 Django `Deploy-Application` 在合法维护、Worker 停稳、原 prepared id/hash 和当前前驱一致时可进入；其维护检查没有将本次维护/目标与封存批次绑定。原 id/hash 正确的旧候选在**第一轮新的正常维护窗口**仍可能被误采用，不能依赖“未来前驱变了”事后避免。若进一步源码检查证明旧 direct consumer 仍可能消费封存工件，停止 R1；不要靠加新 marker 或约定不点旧脚本补洞。

### R1b：保守全候选封存 + 旧入口路径隔离/兼容接管（更窄工程候选，未验证）

可以把 T 前全体未消费候选作为保守集合，不要求每个都唯一归属 a3。将其原件完整保全到旧 native **无法按原 id/hash/固定目录寻址消费**的 archive；原位置保留追溯方式时不能满足旧成功 schema。旧 GetPrepared 或按原 plan 寻址失败，是真实消费否定，不要求旧代码认识新 ledger。

但封存 T 前候选仍有反例：旧 source 在 T 后重新 PrepareApp 得到新 id，再由旧 DeployApp 在新维护窗口采用。故还必须隔离全部受支持旧 source/native 入口，不能只禁旧候选。这里的“入口隔离”须满足以下可反驳契约：

1. 从正式注册表、控制包、受管 packet/source、有效运行 manifest、计划任务/启动器/兼容 BAT 的引用闭包，列出受支持的旧可写/消费入口。旧原路径或通过既有正式引用执行它，必须失败关闭；仅替换最外层 dispatcher 不足。
2. 对旧字节原件作可恢复保全，在原执行路径实施实际不可执行/不可读取或既有输入拒绝边界；禁止仅把同样可读的旧脚本换到另一个仍受支持入口。完整退休先清掉已加载旧代码。此协议不承担操作者主动复制、恢复旧字节后自行编程绕过的威胁。
3. 由新固定 adapter 接管允许的 Prepare/Deploy/Verify/Start 等合法入口，精确绑定 generation、授权 target、后置工件集合和维护 attempt；不能成为带任意脚本路径/任意参数的执行器。新代码 gate 只有在旧直达路径已实际隔离后才有意义。
4. 运行包中的旧 native helper 也属于入口，不能因业务仍使用就漏掉。必须证明接管仍满足当前运行 manifest/guard、Django 严格 ACL、DPAPI、ordinary-user task 与启动契约；若无法兼容就不能通过手改 manifest、绕过签名或放宽旧验证推进。
5. 接管与恢复后的扫描/验证需覆盖旧 direct Prepare 和旧 direct Deploy，以及第一轮维护竞态。只验证新入口拒旧 target 不能通过此项。

这个 adapter 可能比全域身份改造小，但目前没有实现和闭包证明。它与 R2 不是同一安全等级：R1b 阻止明确封闭集合内的受支持误调用；R2 可从对象权限制止更多不经入口的旧访问。若找不到可靠的旧入口封闭集合，R1b no-go；不能暗中退化为依赖操作员“不点旧工具”。

### R2：限定部署作用域的对象/能力隔离 + 完整退休（充分候选，工程成本较高）

在这个方案中，将旧 writer/consumer 对 D 的权限收回，恢复后由具有新能力的受控执行者完成受保护写入和消费。普通用户可继续发起受控操作；构建也可留在普通用户隔离 scratch 中，但**把产物带入共享 runtime/控制状态的提交者**必须有旧进程不具备的权限或资源能力。导入器只接受本次明确授权、源码/请求/目标/工件摘要都绑定的完整输出，不能成为任意文件写代理。这是 R2 的充分条件，不是对 R1b 不可能成立的排他证明。

实现可选择受控 broker/独立执行身份/资源端能力；本规划不提前宣称任一种已可部署。若需要改变“当前用户普通权限打包”的既有约定、DPAPI 身份或服务身份，必须作为明确的产品/运维取舍提出，不能静默换账号。不能为了 S05d 顺便重写所有业务服务权限。

只调整根目录 ACL 不够：必须覆盖子项、owner/WRITE_DAC、继承、父目录删除/重命名/替换、共享/别名/reparse/硬链接、已打开句柄，以及 Docker/远端能力。旧 SID 不应在恢复后重新获得同一被撤销的直接写/消费权限。已有合法服务仍需的业务文件与部署控制对象须分开；分不开则承认维护和身份迁移成本。

ACL 更改不会追溯取消旧已开句柄，因此完整退休不能省；完整重启也不会收回重启后新取得的权限，因此权限屏障不能省。[Microsoft：句柄取得时执行权限检查](https://devblogs.microsoft.com/oldnewthing/20200320-00/?p=103579)。owner 默认可改 DACL，不能把“owner 仍为旧用户、根 Allow 少了一项”当强隔离。[Microsoft：新对象所有者](https://learn.microsoft.com/en-us/windows/win32/secauthz/owner-of-a-new-object)。父对象安全描述符不直接决定所有已存在子项，移动/改名也不等同于重设权限。[Microsoft：文件安全和访问权](https://learn.microsoft.com/en-us/windows/win32/fileio/file-security-and-access-rights)。

R2 逻辑充分，但当前没有 ready provider，原工具还依赖现有 ACL/身份契约。新 broker/独立 SID 不自动兼容这些契约，控制 bundle 升级也不会自动迁移 runtime 所有者、DPAPI、服务执行身份或 task ordinary-user 校验。这是需要单独实现和验证的控制边界，不是给脚本加几十行 fence 的小修复；若必须改生命周期身份契约，则**超出本次有限恢复实施范围，当前 scope 内 no-go**。本轮最多形成窄接口原型和反例，不能安装 broker、改生产权限或执行封存。

### R3：仅改目录/队列、新 fence 或一次重启（拒绝）

它们分别遗漏旧引用/消费、旧代码不认识新 fence、以及重启后的重新执行。换机器但共享原 runtime、队列或远端能力也一样。完全迁移到另一隔离域理论上可满足 R2，但涉及运行状态/凭据/存储迁移，不能当成本更低的默认捷径。

## 7. 未来一次恢复的状态机

采用独立 retirement ledger；不覆盖原 queue terminal，不把任何阶段写为原任务 FAILED/SUCCESS。每条不可变记录含 operationId、前一条摘要、冻结请求/原 dispatch/result 摘要、精确作用域及工具资格摘要。声明字段只索引证据，不能以 `retired=true` 自证退休。

| 阶段 | 进入/完成的正面证据 | 崩溃后允许动作 |
| --- | --- | --- |
| INTENT | 冻结域、原件、当前运行基线、具体授权、恢复入口与撤退方案已封存 | 无生产改变；可停止或以同 intent 继续 |
| ISOLATING | 持久再入/消费屏障按有限步骤安装；每步记录 preimage 与原生 postcondition | 缺回执即本次恢复 unknown；保持已有屏障，不自动解除 |
| RETIREMENT_PENDING | 屏障持久有效；需退出/完整冷启动的域、启动门禁与维护影响已明确 | 不把锁丢失/工具退出当已退休；禁止自动新准备 |
| RETIRED_CLOSED | 后置 boot/域退休原生事实＋屏障未变＋无外部残留执行或能力 | 可以在同 intent 下只读盘点；仍不能开放新消费者 |
| INVENTORIED | 所有 D 对象稳定读取，引用闭合，运行基线验证完成；未归属对象已分类 | 复核全清单差异后续接；变化转回阻塞，不盲目重复移动 |
| SEALED | 封存对象保全验证、消费拒绝边界实证、原 unknown 与不可重放索引完整 | 可重读已提交结果；不能重做封存、清理原件或重新调原任务 |
| ADMITTED | 新代控制/屏障/新队列 reader/运行前驱精确绑定，最终静态＋动态检查通过 | 仅允许原队列处理未来新授权任务；原 target 永久不重放 |

跨重启不可能持有原 pipe 锁，必须明确前后两个 epoch；由持久屏障连接，而不是伪造连续 lock epoch。退出恢复程序不自动解封。若屏障安装本身结果未知，按原生状态/固定 preimage/postcondition 判断；不能简单重跑“安装”或写完成标签。

## 8. 锁序与控制采用循环

沿用现有共享锁序 **v1 queue → v2 queue → native rotation**。新增 retirement 协调者互斥只防两个恢复协调者冲突，不算旧工具必遵守的门禁。若还需要现有 Django/service/lifecycle 锁，必须先完成实际调用图锁序检查：不能在 rotation 内调用一个先持 service 后等待 rotation 的入口。发现未定义/相反顺序时，选择在持久关闭状态下分阶段原生操作、重新获取三锁并 CAS，不能用增加等待时限解决死锁。

源码/control 材料可以在隔离目录准备。现有采用不要求 queue 的 unknown 先被解掉，可安装具备 reader 的新控制代际但继续拒新 dispatch；原件不动。新 reader 必须在存在未完成 retirement ledger 时失败关闭，并且不能把“新控制采用成功”当退休成功。

控制采用会做自己的 task/进程窗口检查，该检查只证明它定义的旧控制窗口。当真正退休需要完整维护/重启时，恢复入口应使用已验证的固定安装材料及独立持久 ledger，在启动门禁保持关闭的条件下完成；不能为了装恢复器先临时放开队列。若现有安装器无法在关闭状态兼容实际 task 定义，须先设计对应的安装/关闭联动协议，不能旁路修改 task 或手写 installation。

## 9. 对账：允许不知道残片是谁写的，不允许不知道谁还能消费

T 后将 D 状态冻结为全清单，按对象身份和引用图划分，不强行给每个残片指定原 PID：

- **有效运行基线**：当前 Worker/Django/PUBLISHED/native successor 的完整一致 tuple，经原生身份、manifest、链与必要启动来源门禁确认。若引用混合、消费记录冲突或不能解释，保持关闭，转为具体运行恢复问题；不得挑一个“看起来最新”的版本当基线。
- **已完整消费的工件/记录**：保留其原消费链和用途，不复制为新的成功；有别的任务归属或正在使用时不能封存掉。
- **完整但未消费候选**：本窄路线默认不复用；归入禁止消费集，保留原 manifest/plan/全部引用。后续另有授权需要复用时走原生材料协议，不在封存过程中自动采用。
- **partial/归属不明**：完整保全为不可消费对象，记录路径、文件身份、目录成员与摘要；可以不确定是 a3 或同源码另一执行，但必须排除服务/消费者仍持有引用。读取失败、不稳定、reparse、未知外部引用继续阻塞。

五个非空 staging 不能按生日或 sourceFingerprint 单独归 a3，也不能清空。允许“按当前状态封存全部未消费同域对象”的更宽范围，但必须获得准确范围授权并证明没有把其他任务工件一起切走。若无这样的范围授权，保留并报告；不能偷偷缩小清单。

保全可采用受保护原位置隔离或复制到不可消费 archive；具体选择须保持证据可恢复。对 copy/rename 先做不可变操作 intent，复制完成后按完整清单验证，后续再切消费者可见性。原目录路径的 tombstone/索引只是追溯，不是旧 consumer 的强制屏障。archive 不得仍被原消费者自动扫描；旧引用缺失时必须失败关闭，而不是创建新计划或从缓存找替代品。

## 10. 封存、新准入及 reader 兼容

新的封存结论建议为独立语义 `retired-and-sealed`，不能复用 cleaned 的 `candidateArtifactsAbsent`。它应如实声明“原 outcome 仍 unknown；旧操作已退休；指定现存对象已封存；未执行原请求；允许未来准入”。

是否最终由新第三 resolution 引用 retirement ledger，由完整实现与审查决定；无论形式如何，必须原子绑定原 winning dispatch/result SHA、target、ledger 根、控制代际、运行前驱、封存集合与永久禁止重放集合。禁重放至少覆盖原 target，不能靠新 requestId/new dispatchId 绕过；直接 native 消费也应由 D 的屏障拒绝，不仅 queue 检查。

旧两个 decision、历史 catalog、原 operator 清单接受集合不变；新增格式分支独立。旧 reader 遇新语义应失败关闭，不能把它映射为 prepared/current。新 reader 每次相关准入均核验屏障仍有效和 ledger 完成状态；如果运行权限被恢复为旧配置、封存集合被改或控制回退，就拒新准备。最终打开只改变未来准入，不唤醒旧操作、不重写旧结果。

落 SEALED/ADMITTED 前执行新鲜双独立观察、静态清单重新枚举、全部消费根与屏障 provider 原生复核及 CAS；原有 writer/observer 框架可复用形式，但不能把它原来的 process census 当作新增屏障的全部证据。

## 11. 本轮最小验证范围与可反驳标准

本轮不实现 production sealer。实施者可在独立临时根使用合成对象与固定底层替身，进行下面直接相关的有限检查；真实路径/authority/任务/数据库均不作为夹具回退：

1. 冻结旧 producer/consumer 入口矩阵：给每条 D 边实际拒绝检查点或明确缺口；测试新 fence 被旧入口忽略、旧 direct consumer 可到达低层动作的反例。
2. 验证三锁并不包围所有 native 写入；不要在生产运行低层命令来“看看是否会写”。
3. 验证未知第三 decision 对旧 reader 失败关闭，控制材料采用的源码条件不以修改原 unknown 为前提。
4. 纯隔离 ledger 原型验证：中断于每个写前/写后边界不会解封，不完整 archive 不准入，原件/target ban 不变，重复同 intent 只返回已确认结果，变更 intent/摘要拒绝；原型不包含生产参数或未实现 provider 的默认 true。
5. 如需评估 R2，先做窄对象权限实验设计：旧普通身份/预开句柄/重新打开/父目录替换/owner改权/新受控能力。实际权限实验只能在明确隔离对象且已有相应授权时进行；root 已限定授权一个私有临时叶 DACL 实验，可按其范围记录结果。该授权不包括新账号、父目录、生产权限或系统策略变更，不得为“验证”扩大它。

单元模型可以反驳不充分方案，却不能证明真实 boot/权限/远端 provider 已生效。只读 metadata 可以证明当前仍存在绕入口或共享权限，**不能证明权限切换一定成功、未知远端作用已退休或维护可在给定时限完成**。

## 12. Go / No-go 与停止条件

| 判定层 | 当前结论 | 达到 go 所需事实 |
| --- | --- | --- |
| 逻辑上可行 | 条件成立时可以，毋须原 PID | 退休＋持久再入/消费隔离＋冻结对账形成完整证明 |
| 当前代码直接实现 | 否 | 找到/补齐 D 每条边的真实屏障，完成 ledger/readers 与兼容检查 |
| 当前现场证据满足 | 否 | 没有执行新屏障；非空残片尚未分类；根ACL不足effective-access；外部闭包需限定 |
| 当前权限/授权可执行 | 否 | 当前只允许设计验证；生产维护/完整boot/身份权限变更/封存须具体授权且工具能力实际可用 |

若 R1 的剩余 direct consumer 反例成立，就明确“不能以现有门禁组合做小修复”，不要再重复找历史日志。R2 若需要改变长期普通权限/身份契约、无法收敛到部署控制域、没有可安全冻结的外部执行器、或者运行基线本身不一致，则停止代码扩张，提交具体工程取舍与影响范围，不能默认进入重构。

维护成本：只读可行性验证无停机；真正完整退休可能覆盖整台承载应用的主机及关联后台服务，不等于热重启，停机时间目前无可信估值。只有局部现有门禁被证明足够时才可缩小维护范围。部分对象可原位封存可减少复制成本，但不能以省时间牺牲保全或消费隔离。

撤退策略：INTENT 前可正常停止本次设计；ISOLATING 后失败默认保持关闭并记录恢复自身 unknown；不得自动恢复旧执行能力、删 ledger 或回放原任务。已改变权限/运行状态后的撤退必须绑定原 preimage 与当前事实，确认没有新工作获准后才可能按独立授权回到已知安全基线；不能通过“回滚 fence”把迟到写风险重新引入。即使最终决定不做该路线，也保留原 a3 unknown 和原阻塞，不以清理换可用。

## 13. 下一交接

执行者提交实际入口矩阵、只读证据界限和隔离反例；独审者独立核对哪些路线被反驳、哪些仍是条件推论。负责人据此报告“是否值得进入具体屏障工程”，不报告已恢复或已封存。

最小下一步的选择是：**先验证 R1b 的入口封闭/兼容接管能否在 Worker+Django、noPi/noMigration 的窄域成立，而不是立即实现 R2 或生产 sealer。**这需要逐个旧入口的实际拒绝证据、运行 helper 接管兼容性和第一轮维护竞态检查；当前源码与反例尚未给出通过结论。用户本轮只要求设计验证，交付该可行性结论后停止，不自动开始 adapter 实施/控制采用。

若 R1b 也必须重做生命周期身份或无法闭合受支持旧入口，有限路线 no-go；届时只有把较大控制边界改造作为新的明确工程取舍，或继续保持阻塞。最有用的交付是明确代价与缺口，而不是写一个永远返回 blocked 的新 sealer。原只读 audit 已经承担日常拒绝解释功能，无需重复造空壳。
