# 真实 Antigravity 复审与事实核验

本轮从真实 `C:/Users/86137/AppData/Local/agy/bin/agy.exe` 调用 plan/stream-json，原提示、stream、stderr、result 与每次实际起止时间均保留在 `E:/codex-artifacts/release-first-adoption-targeted-20261011`。模型只审提示提供的源码，没有本机测试、Git 或生产批准权。原意见保留，不用赞同替代验证。

## 首轮设计分歧

- 接受维护期间历史载荷规划读取的成本风险。该操作会读取真实新工具及历史树，不能承诺短停机或把取消的数据库阶段毛成本当作净收益。
- 原 planner 同目录 import rotation/verifier，并实际 resolve → verifyWorkerRelease → resolve。首轮“没有调用 rotation／新 Django 没有消费新 Worker”与源码不符，已交回原代码纠正。
- 规划兼容不等于执行清理、不证明运行业务通信；保留启动、组件、权限、功能与自然任务验收。
- 原恢复确有 dump.sizeBytes × 32 + 2GB 容量规则；主任务最初怀疑该数值无依据，实际读取后纠正。拒绝条件是 free < required，因此要求至少该容量。Backup 读取生产库；隔离恢复不修改生产业务库不等于整个批次零生产连接。
- 恢复参数来自本批唯一已确认 Backup 回执，原运行器展开动态收据后核 manifest/dump/content；新版另核 backupId。不是执行中修改封存清单。

## 第二轮源码意见的逐项处理

| 原意见 | 主任务读取完整源码后的事实 |
| --- | --- |
| workerRuntimeRoot 未定义 | release-batch.mjs 第13行已有 import；零上下文 diff 没出现旧 import 不代表缺失。 |
| target 大小写可绕过 | guard 在定义函数前已 path.resolve(record.source).toLowerCase()；物理路径也小写。 |
| backup 未绑定／原恢复没有 backupId | restore 分支已有 const backup=outputsFor(op.backupOperationId)；原 maintenance 成功 result 明确输出 backup.Manifest.backupId。 |
| Django 候选 SHA 是全包树，与 deployment.json 混淆 | 本项目 candidateManifestSha256／djangoCandidateSha256 是 deployment.json 原字节摘要；2933文件完整库存另核其中 appFingerprint。不能借字段名称猜测合同。 |
| consumer 没有 step，现场准入不会识别 | 原 CLI 显式传 step:op?.step??op?.kind。 |
| VerifyStartup closeout／watchdog 不在生命周期白名单 | VerifyStartup 已在白名单；watchdog 是 no-data-observation。不存在所假设的错误 kind。 |
| switch restore 假借 restore-pre 会在其他校验被拒绝 | 公共 phase 列表支持 switch；v4 复用原 operator 断言并另强制唯一 switch Restore、固定顺序。实际 makeBatch/verifyBatch 及最终精确范围检查验证，未原地改旧操作对象。 |

第三轮交回完整 imports、局部变量、原成功 result、真实 binding 合同、回调及分类。AGY 已逐项撤回四项P1与三项P2；原第三轮输出保留。上述结论来自实际源码与验证，而不是模型投票。

第三轮当时的3600000ms只声明于两个原数据库操作，内置只读planner为600000ms；前者后经实际cap检查证伪，不能算有效预算，最终新批次用1800000ms。AST参数检查、重新构建及最终候选测试应在批准前完成，本任务不会将这些准备推迟到生产批准后。Restore没有-BackupId输入，它输出backupId供批次与母收据复验。

## 最终限定源码复审

实际包196/197失败揭示了开发与限定来源的错位，前三轮认可开发代码不能签错误包。修正版batch `e0d2e1d38e0416fca6bb4a61eb42ccf07baabb363493796dd54f3b8e50bf2ccc` 经Astra及主任务全文复验：三模块63函数、全部顶层节点／语句落点一致，只扣两个已明确未采用的旧health差异；backupId行位于restore块第二句。实际限定模块正向恢复与八负例9/9通过。新source5160／c279cfb7重新原prepare/build，旧0b5e／39ce未覆盖、不采用。

真实第四轮CLI实际54.473秒，提供修正限定原函数完整文本、imports、范围及原始校验记录。AGY未发现本轮文本范围内新的源码阻断，仍明确新候选最终197、静态封存和生产消费／演练各自待实际完成；不授予生产权限。它的“彻底阻断”等绝对措辞收窄为该协议及精确受支持边界的验证结果；它没有亲自读取本机三模块或执行63函数核验。候选命令AST检查继续在批准前完成。

## 候选命令和现场阻断

旧未执行 65fc 候选误给原 maintenance 传 `-Json`，并漏掉原演练必需的12位 ID。旧对象保持原字节，新封存命令去掉非法参数、使用新独立 ID/55433/E，并机械读取原 PowerShell AST 参数表。原单演练706.423秒超过通用600秒 deadline；旧未批准872草案误声明3600000ms。C非作者指出原3c processDeadline上限1800000ms，主任务直接调用该原函数，两数据库步骤均被拒绝，见OLD_872_ACTUAL_BUDGET_REJECTION。最终新草案收敛为每项1800000ms，不改原cap或D工具；历史时间不保证当前完成。这是执行上限，不是耗时承诺，未延长测试 timeout。

IG04 旧空字段漏检已复现，新守卫34项隔离回归通过。实际只读821进程／215任务中194个 ExecutablePath 不可读取，未检出明确引用但无法排除未知；包含一个路径及命令均空的 PowerShell。现场准入保持 blocked，不给 Name-only、模型认可或口述豁免。没有杀进程、提权或读取跨进程内存；候选准备与静态封存继续，生产动作仍待具体前置条件和精确批准。

第五／六轮真实设计与最终helper复审：仅固定workerDevVarsSource支持原共享硬链接；精确固定配置change先pending，同步重新验证完整字节、祖先路径及全部非访问时间身份，等于本会话不更新的基准才清pending。普通source/npm/unknown/rename仍不可逆拒绝。18配置与64相关隔离用例通过；原固定reader摘要匹配、不输出正文；旧c279配置阶段通过后5653普通源码事件仍被拒绝，不借无session读取通过取代。新source须原构建、215和真实session再验证。

模型“硬链接意味着不能施加独占锁”收窄为本任务不新增全局锁；“生产物理静止”不成立，本任务保持AB正常业务运行且未维护/切换，业务自然变化允许。第六轮没有亲自执行本机测试；“零源事件通行”限于支持边界及原guard实际结果，不是全系统无并发写者证明。最新08:25只读快照825进程／215任务、197未知，是新的截点；用户表示不知道该PowerShell用途，未知没有被解除。
# 第7轮设计复审的限定

AGY7真实CLI审查原export API和入口设计；当时未来入口字节尚未完成。原API确实支持不传session，每操作边界collector内部在开头／末尾完整采样源码、Node、npm及配置；这不表示每个native操作结束都立即另有完整核查，更不保证扫描期间连续独占或全时无写。原门禁、动态时效及动作前复验继续负责各自范围。

“更强”“完美”“彻底消除”“缓存已弃用”不作为事实采用。缓存原guard与测试仍保留，其中一个原生用例未闭合；本轮只将首次采用精确绑定不使用session的独立入口，不泛化该结果至默认cached CLI，也不承诺性能。197未知进程是该次现场观察值，必须现场重查，不能靠设计认可解除。

原入口草稿随后被非作者实际反例证实存在导入先于校验、freshness失败丢失分阶段证据的问题；AGY7设计同意不覆盖它们。最终入口必须builtins-only bootstrap后导入，并保留原structured admission失败数据，再独立审查与实际qualify。
# 第9号实际调用：最终入口V2

真正AGY读取冻结`69898b1be33a9e3ba0d30a2eab480a12ca05fe339bf373bc333eec7d10245b99`完整入口及26项受控交接；第8号仅生成prompt，因ENTRY03未调用。第9号没有发现新的文本阻断，仍要求实际全树准入和未知引用闭合。原result、call及源prompt保留，不替代主任务实际验证。

纠正原意见：原缓存路径仍存在，只是本批不采用，不能称“已弃用”；Date.now是毫秒，非纳秒；三个复验文件的真实I/O可能耗时，是否在5秒内由实际门禁决定，模型不能保证“远低于”。beforeOperation前原WAL已存current admission阶段／attempts，不泛化为该native动作已开始或完成。模型行号并非本文件可靠定位，按函数和条件核验。离散采样与实际身份／ACL／互斥保证各有边界，不将“完全杜绝”“静态不可变闭环”解释成全时操作系统独占或未来字节证明。
