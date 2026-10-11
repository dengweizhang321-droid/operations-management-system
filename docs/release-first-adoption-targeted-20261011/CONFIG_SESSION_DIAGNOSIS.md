# 固定配置硬链接与原生观察事件：当前证据

当前小改仅 release-preparation-evidence.mjs；原 worker-local-release/rotation、通用 safeRead、各旧scope/候选不改。原 readStableRegularFile 与 verifyHardLinks 是私有函数，原 assertNoReparsePoint 可复用。配置固定源原合同允许共享硬链接，完整 artifact verifier 继续核 source/release/worker 三处同 dev/ino；会话原来用通用 single-link safeRead 读取该源，实际283链接因此被拒绝。

第一小改仅对 canonical workerDevVarsSource 用普通文件／路径／重解析点与前后 dev/ino/nlink/size/mtimeNs/ctimeNs、字节长度完整括读，并保留 bytesSHA及文件身份。其余配置、源码和npm仍走原 safeRead。私有真实hardlink/junction、同mtime改字节、inode/链接变化、原workerPreparationIdentity+session收口9项通过；相关55项首54/55旧watcher失败，原样单项与串行重跑55/55，原因未定。Windows file symlink创建EPERM保留且不绕过，实际junction祖先负例通过。lint通过。

实际固定源单读与原私有reader的摘要一致；通用safeRead仍拒绝。随后经主任务授权，对 c279真实source做一次full session：原identity与npm解析通过，但收到唯一原生 `.dev.vars` change事件，按原assertStable拒绝，未进入configuration-content；未自动重试找通过。该失败不同于先前无events的Unsafe读取失败，不能称现场session已闭合。

再次按主任务限定做一次指定对照：无内容读取control窗口＋两次原reader，记录全部meta及两个SHA，无正文。bytes、dev/ino/nlink283/size2402/mtimeNs/ctimeNs全等，仅atimeNs在读取后变化。唯一change事件在control窗口1.39ms发生，因此不能断言“每次读立即发事件”或归因另一任务/AV；结果与延迟访问元数据通知相容，但不是排除所有并发写者的证明。证据为 E/ASTRA_NATIVE_CONFIG_READ_CONTROL.json。

最终窄实现：仅固定配置精确文件名、change类型记pending，不能直接忽略。同步assertStable在pending时，对唯一小配置进行完整安全路径／前后身份与全部字节复核，只有与本会话先前不更新基准完全一致才清pending。atime不作为不可变身份；source/npm/rename/null及任何身份、链接或字节漂移继续拒绝。不得延长TTL或接受新SHA，完整artifact共享链接门禁保留。真实AGY第五轮设计、第六轮完整代码审查完成，意见不能代替现场结果。

最终helper b7355e8f36efe8be54dc1980334f87f109372b1bd743639160064d4034235bf6、交接399051e5，18配置与64相关隔离回归通过。旧c279上配置阶段实际通过4.1ms，但其后5653普通源码通知仍由原guard拒绝；不扩大配置例外或忽略通知。新SourceV3 dc1dbeed仅替换既有十文件中的该helper，原三核心、Worker/D消费者不再改；新原prepare/build、215用例及真实session需要分别完成，不能签旧aed7/872。完整5653事件外置原文件保全，公共摘要只列数量和首尾。
