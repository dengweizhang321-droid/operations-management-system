# S05d 退休与封存实施记录

当前仍为隔离实施、现场阻塞。完整 writer / reader / ordinary handoff / bundle 交付尚未冻结；不能从已通过的局部检查推导可执行现场恢复。现场观察、授权与最终采用以 REPORT / LIVE-RUNBOOK 为准。实施者未执行生产采用、源关闭、重启、封存、队列恢复写或服务/数据库操作。

## 实际入口与闭包

- `tools/preparation-retirement.mjs` 提供固定 `--config --dispatch --phase inspect|plan|verify|close-sources|seal-after-retirement|read [--intent-sha]`。写入口要求原采用代际、原 unknown、当前普通 SID/medium、v1 queue → v2 queue → native rotation 三锁与新鲜任务/Git 门禁；没有外部 proof、任意 roots/out、重启或任意命令参数。
- `preparation-retirement-collector.mjs` 的 `inspectRetirementClosure({configFile,dispatchId,onProgress?})` 为独立只读兼容观察，不取得 writer locks，不写 intent/queue/actions。诊断回调仅给调用方 plain 阶段/计数/路径/耗时，最多 1024 事件，不进入闭包证明、不写生产日志。第六轮真实观察在 120 秒自身预算结束仍未完成；不得因此扩大协议时限或宣称闭包成立。
- `preparation-retirement-observer.mjs --request <固定 REQUEST> --sha <SHA>` 只接同 intent、同代际的固定观察请求。两轮独立高权限观察、当次普通 writer token 与 ACK、同锁最终 CAS 和实际写前 60 秒门禁缺一不可。普通 handoff 的身份/Task/RUN/宿主闭包由 HANDOFF 记录；没有把任意 PowerShell 父进程加入白名单。
- 新 `teruisi-retired-preparation-resolution-v1` 走独立 reader；原两种 decision、producer qualification 与历史 catalog 不放宽。原 unknown/请求/PREPARING/source-binding/失败/诊断原件原位保留，`prepared=false`、`publicationPerformed=false`、`retryOriginal=false`，原 target 永久禁止重放。

## 旧入口与 Git 原生门禁

只关闭原 target 的实际来源/制品寻址。不同来源的 immutable helper 不因“旧版本”一概搬走。保留 snapshot 必须有实际存在叶的字节差异或完整 clean Git 身份见证；缺文件不能排除原 partial。消费/rollback 命中原来源时拒绝，不能移动来掩盖已发生采用。

实际旧 latest-main 家族都使用 `worktree add -b codex/manual-main-<target12>-<binding8>-<django8>`。已用原 4623c8… 全份源码与真实私有 Git 证明：原 branch/worktree 归档保留仍挡不住前驱变化后的重建。新 hook 的 `prepared` 在 shell 内先筛这一个精确命名空间，只有 newSHA 全值命中持久 TARGET-BAN 才拒绝；在 checkout/branch/登记产生前原生拒绝。普通 codex 分支与 `manual-main-debug` 在退休代码/配置不可读时也不调用退休模块。`committed` 仍交给既有入队路径，transition bridge 的 prepared 直接指向新固定 bundle。

新采用将 repository-local `core.hooksPath` 绑定到同一个原 common/hooks 绝对目录，保持同一有效 hook；不禁用 hook，不改全局 Git 设置。原 14 个 installer 家族的 empty-hooksPath 前置检查因此拒绝新调用；已越过旧检查的 prepare 捕获旧 configRaw，由新配置字节变化与旧 adopt 的 installation/config CAS 封闭迟到材料。旧 v1 已加载演员仍须后续完整 boot 退休，不能仅凭该设置认定退出。`extensions.worktreeConfig=true` 本身不拒绝，实际 local/effective 值必须一致。

首次现有 v2 能力采用必须在首个材料写前证明运行输入不变，仅新增兼容字段，保全原 config raw SHA。当前代际配置与原 incident 配置分别绑定；没有伪造 request.sourceTree 或把 Git tree40 当内容树 SHA64。现有 retirement ledger 存在时，尚未资格化的 config/native provider 改变在 prepare/adopt 之前拒绝；普通同 config 的兼容代码采用保留。未来新 provider 不是本轮已经证明的能力。

## 前像、退休与封存顺序

先完整读取全部待移对象的字节/链接角色前像，再对所有 Git 来源重核登记、HEAD、clean、ownership、native eligible members 与 dependency junction，完成同调用逐叶/逐目录 CAS 才允许首 move。registered/locked source 用原生 Git move/unlock/lock，未知归属/附件保护不 force；普通 merge alias 不会误认成本案原冻结包。

source profile 记录已资格化 `node_modules` junction 本体及固定 target，不跟随依赖目录。artifact profile 仅接受 native manifest 声明且与已知配置 inode/字节匹配的两个 `.dev.vars` 硬链接。完整 boot 之后，archive 中先建空且已核精确私有 ACL 的叶，再复制原字节、断链；原运行包、main 配置与原 manifest 不修改。

`SOURCES-CLOSED` 之后取得同机器、已资格 GUID/schema、BootType=0 的新完整 boot。新 executable alias 出现则拒绝，不能临时补搬后套用旧 boot。`SEAL-PLAN` 冻结全部候选/计划/receipt 寻址；move 结果与 preserved 字节证明 create-only，同 intent 再入返回原持久回执，不生成新 at/reconciled 改写 ARTIFACTS-CLOSED 引用。

未 journal 的 archive copy 临时文件保全为 unknown，不能自动删掉或假称所有崩溃都幂等。已落 prepared / 已替换叶的两个已资格 journal 停点才可同 intent 收敛。完整最终快照、独立观察与 ordinary ACK 保留；最后使用同锁、同调用完整逐叶 dev/ino/size/nlink/mtime/ctime、逐目录成员/身份、原生登记、metadata/witness/entry 集合 CAS，不能只看根 mtime 或抽样。该 CAS 的 40 秒预算须在首 move 前实测，最终写前仍严格检查 60 秒，不延长旧门禁。

sealed reader 保存旧 raw 证明，同时重新核原 source/旧 IDs/档案/guard 不回归，不永久冻结所有无关 runtime metadata。后续另一个 target 的 publication hint 必须绑定正式 request/version/latest flag/完整 target/前驱构造的包名与 out，才可作无退休权限 advisory；旧 hint 的覆盖/删除不重写原冻结证据。writer 本轮 finite gate 仍拒 foreign/active 原 hint，TTL/PID 缺失不证明退休。

## 已有必要隔离证据

局部实际结果按对应字节及增量复用，不合成“当前整套全绿”：

- 旧入口边界、fs/Git 原生移址、admission、boot 原生 PS5 parser、独立 source hash 协议对照及 history/HANDOFF 叶见各自 checks / REVIEW。
- prepared native ref 4 项：原 branch 已归档的 advanced predecessor 反例、写前拒绝、普通开发/committed 保留、代码/配置缺失时 shell 范围短路。当前增量独审已认可其局部门禁。
- control 3 项：原 direct/prepare 首写前拒；旧 adopt 的 stale installation 与 late config CAS；新真实 prepare/私有三锁采用到 S4 固定停点，覆盖 null→same hooksPath 先于 config 改变。未执行 census/Task 注册。
- core 前像 4 项：未知第二硬链、late producer 写、私有根防逃逸、真实普通 Git merge 资格及新增 owner 拒绝均在首 move 前发生。
- archive journal 2 项：真实私有双硬链接断开后最终/reader profile 相等、base 改变后归档原字节保留、同 intent preserved 引用稳定，以及三处真实私有 copy 停点。
- collector 全相关 15/15（33.28 秒）及诊断回调 1/1 增量通过；entry 原始全文 SHA/guard/resume 家族 2/2；witness 纯协议 4/4。它们不证明现场已 full boot、已撤旧 actor 或已完成完整现场 closure。
- 原单一 reader 接新独立版本后，选定旧 generic 与历史 compatibility 4/4，包含原八条封存读取与原历史重放政策；没有改历史 pin 来迁就新分支。

尚缺：完整私有 writer/reader/CAS 组合与最终独立 bundle 检查收口、真实只读 closure 在预算内完成、所有现场准入与普通 handoff、采用/source-close/new full boot/双独立观察/封存的原生回执。任何缺口保持 blocked。
