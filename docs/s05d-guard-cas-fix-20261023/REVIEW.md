# 旧 guard 兼容与 reader 末次复验增量独审

2026-10-23。复用前轮独审上下文，仅审用户指定的两处修复；不参与实现、不子派工，不运行旧 CLI 或生产操作。新树基线为 `a116fc55`，旧实现树保持。已重读共享记忆启动入口及本树 AGENTS/README、开发交付、模型分工 v3、架构、前端、发布、运行、安全与文档规范；无页面改动。

## 旧 guard 的有限资格

只读核实际 `D:/codex-isolated/auto-wake-control-c36ea996/source/tools/frozen-main-source.mjs` 全文字节 SHA `b4bb57dff7a659a94520bc592e0f42b026d5b2a4def4dacfb928e8635f21f9c6`，对应 publisher 为 `228e151242e4c5351fb4ec294df44f9e4adadcf6c5a007931517e4c17ef82063`。旧 guard 分三次读取 HEAD、HEAD tree、批准 commit tree；已审 `c0b4f216…b882` 合为一次三值查询。两者均校完整 commit、批准 tree、可选 sourceTree，随后要求 clean。

publisher 固定自身 source/相邻 request，先调用 guard 再进入 check/prepare，不提供 checkout/造源路径；固定旧 resume 仍受原独立资格约束。分次查询存在交错窗口，不能宣称原子；新 guard 在三值查询后仍另查 status，也不是整个准备流程的原子边界。

在既有威胁范围及 source-close/full-boot 模型内，可仅纳入这一全文 SHA：保留 publisher 配对、own HEAD 不等于退休目标、实际差异见证、原生 ref fence 与末次 CAS；已越过旧检查的在途 actor 仍须既有退休屏障。不得扩为任意 guard、一般 fallback 或取消这些条件。本项无需用户新增取舍。

## 当前结论

已读两文件实际差异：entry 仅新增上述 guard 全文 SHA；sealed reader 留存本次逐档案完整读取所得实际 snapshot，全部 full read 后再统一校 closure、各原址仍缺失及所有实际 snapshot 的 stat/成员，随后保留原 native/control/original/SEALED 校验。没有再次全量哈希、跨调用缓存或写入路径；普通 merge 原址也显式复验，不依赖其父目录恰好在 closure 内。当前源码增量无新阻断。

**两处窄修复通过。** [pins.json](pins.json) 的 11 件实际 SHA 已逐项独立核同，entry 为 `5e4347eb7f73fe4db7b949cef4922285b594a1a87c4fb15a976ceac87f551bf2`，core 为 `fcecd9b9ae3b51a8e749d7ff54c3450d58252c20dbb5159c6f5de80763541fd6`，diff-check 无误。

已核 [精确命令](checks-command.json)、[4/4 原始输出](checks.txt)及直接测试代码，复用单次 18.382 秒/exit 0，不重跑旧套。实际旧 guard 的稳定私有 Git、commit/tree/dirty 拒绝与分次查询边界明确；pinned 配对仍拒未知字节和原 target own-root。既有单个集成用例在最后档案开始读取时，实际变更已采 closure 小叶、重现原址或修改先前已读档案，均触发读末拒绝；此前同 intent 续接、原 unknown 保留继续通过。boot/token/chain/CIM 替身未当原生资格；测试首 commit 前绑定私有空 hooks/关闭签名，没有新增生产注入接口。

允许主负责人从 33 件逐 SHA 相同的固定副本，执行既定一轮有界只读 closure + CAS，不持锁、不取 archive snapshot、不运行 writer。已有有效结果复用，不新增矩阵。本结论限两处代码修复；真实只读与整体现场清单/退休门禁分别报告，不自行宣布 S05d/S05b 现场就绪。

## 最后一轮只读原件

已核 `D:/codex-artifacts/s05d-guard-cas-fix-20261023/inspect-b3dbba29-2096-4988-b690-51273e49c91c.result.json`：`readOnly=true`、`writeAuthority=false`、491 个阶段事件、`pinsUnchanged=true`，冻结清单 SHA 为 `e12512f75903c8273b6878846345adc65db8be3ba33e7f8c9b5a07edc09e83c9`。collector 已返回，原始 `collectMs=99571.691`；总计 `120032ms` 时触及本次自设 120 秒诊断预算，closure CAS 尚未完成，未形成完整 observation，`complete/retirementProved/productionWriterReady` 均为 false。

这不是生产 40 秒/60 秒门禁的成功或失败证据，也不推翻两处代码修复的窄审通过。当前仅完成代码修复与不完整的真实只读核验，无生产写入或退休操作。按用户要求停止加时、重跑及新增检查；是否允许另一轮 180 秒诊断由主负责人等待用户答复，本审查不预先执行。
