# 同一次操作退休全验复用增量独审

2026-10-23，基线 94dd1142。复用同一独审上下文、现行 v3、共享 Home 与未变规范；已读 [SAME-OPERATION-PLAN.md](SAME-OPERATION-PLAN.md)。用户选择只去除同次重复全读，跨次仍完整核验。独审不参与实现，不运行新现场、Task 或全矩阵。

## 方案关键规则

显式 WeakMap opaque scope 方案可行，已直接交实施必要约束，不要求重新规划：

- config/进程/顶层操作与关键 registry、INTENT/SEALED、adopt/native/archive 绑定不同须拒绝并 failed；dirty 只表已知边界丢 witness，不能自动迁移关键代际。正常 source/plan 变化由新鲜 collector 判断，不缓存旧 closure 或把它永久绑定死。
- 首次完整 reader 连尾检成功后才保存本阶段必要 archive snapshot。hit 只省重复字节全 hash；每次仍真读原证据、ACL/Git 保全、新 collector、全部 archive stat/member/link CAS、boot/ref/native/adopt/original 与尾检。任何变化不能通过 catch 后全读“洗成新成功”。
- fetch、dispatch、source/material 写、native、循环/等待/锁释放等明确边界清内存；busy 时 invalidate/close 要防迟到复活。finally 先失效，再等待已启动任务 drain，未 await 子调用不得在关闭后填 proof 或返回成功。
- 相同 token 并发/重入拒绝，不共享 pending Promise；不同 scope 无共享 proof，无 token 每次原全读。旧两个 decision/history、unknown/no-replay 与 40/60 秒门禁不变。
- scope 累计资源必须有界，不能把每 intent 上限相乘后无限保留快照。资源性丢 witness 后可在下一门完整读，但关键身份/核验失败不能借此重新资格化；不新增磁盘 cache 或外部 proof 输入。

## 现阶段结论

状态显示的独立窄修已通过：仅真实缺 optional 文件返回 null，存在坏文件仍拒；单项原件及修后仅读旧 run 的结果见 [上轮 REVIEW](../s05d-diagnostic-cleanup-20261023/REVIEW.md)。旧冻结 run/RESULT/EXIT/pins 未修改，无重放。

**本次同次 scope 限定实现通过独审，可冻结交付。** 94dd 的现场全读已完成但仍为 partial；本轮没有新增现场，不能把去重视为已经消除跨操作数分钟读取成本或整个发布流程已认证。

最终 [pins.json](pins.json) 实际 SHA 为 `fe38442e33f8bff8a90d2ec839eb34cc71170edef745b518a70ad1e1239c561c`，其中 10 件原字节摘要及长度逐项核对，零差异。主改动为既有 core/admission/resolution/queue/publisher 五文件，另有必要的 publisher 自版本资格表与上述独立 status 修正；无新增生产模块，controlFiles 仍为 32。

| 生产叶 | 最终 SHA256 |
| --- | --- |
| preparation-retirement.mjs | `2e87f9695090aec53fd38a85e9badd9851209da6d872901ada84ca364b3f56fb` |
| preparation-retirement-admission.mjs | `a11c4b6f46d4d362b5164b7f440f958aa86332d21f4302ddcc21421750e058db` |
| preparation-resolution.mjs | `8fb1c147e27ab1202076af3046d977b8aa024ef6814277be4f0846b71512a2ed` |
| main-prebuild-queue.mjs | `9df065e0775520254aed42077f9f96c9d1d7c801293aa2124f3411a488307755` |
| publish-latest-main.mjs | `1fa234d5f3bdc5ba5fa028d91756d53a7ed79569e5a054270c73e280f22c67ac` |
| preparation-retirement-entry.mjs | `c61ff0428e4d392a111f04a2977064e7e77deb6dfcfb7ad0871b991201bdd256` |
| preparation-retirement-diagnostic.mjs | `a27b356994372af294243bc46f6a9b630bea5e29021e60a5c72c95561b1f619c` |

## 关键实现核对

opaque token 为冻结的空原型对象，proof、身份及状态仅在内部 WeakMap 中；公共断言只返回 true，不返回内部 Map、controller 或 snapshot。registry 验证也同步占 busy 并登记 pending，即使空集合仍绑定且受 epoch/并发/取消/关闭控制。首次完整 seal reader 全部尾检成功后才存 witness；后续只替换 archive 字节全读，原证据、ACL/Git 保全、fresh collector、所有 stat/member/link CAS、boot/ref/native/控制/original/SEALED 尾检仍每门执行。旧两个 decision/history 的判断分支未改。

scope 保留进程/operation/config 与关键 registry、INTENT/SEALED、adopt/native/archive 身份，dirty 不迁移这些绑定。正常新 source/plan 由新 collector 资格化，没有缓存旧 closure 或要求新状态与旧闭包全等。累计上限为 250,000 项、1,024 对象、估算 128 MiB；资源触界仅丢 witness，下门仍完整读，不允许跳核或把身份变化重新读成成功。

CLI 与每次独立 drain 各自拥有显式新 scope；独立 observe/once/resolution 无 token 的原全读路径保留。publisher 在 fetch、来源冻结、pointer/control/progress/catalog 写、native、等待等边界清 witness；queue 在初始化、dispatch/结果写、native、下一轮及 unlock 前失效。所有 pointer 调用均已传 scope；有 scope 的 queue 必须显式提供 invalidator。没有新增 fetch/dispatch/native 或撤回既有动作，只清本次内存。

failed 后保留首因，invalidate 只清内存而不再抛错遮盖原异常；queue/publisher 均以嵌套 finally 保证锁释放。wrapper 正常、异常或未 await 退出均先 closed/epoch/abort/清引用，再等待已启动读取结束。config-byte await 后、写 identity/intents 前再次 checkpoint；reader progress callback 只检查，不返回内部 value。迟到读取不得重新填 witness 或返回成功。最后这两处 checkpoint/void callback 与引用释放为静态增量核对，没有重跑重型 reader。

publisher 实际全文 SHA 与 currentLatest 一致；原已审 `16de…d05475` 单列 previousCurrentLatest 保持原 gate 语义，没有将任意施工版本加入旧族。依赖仍为既有相对路径命名导入与 lazy core 导入，未新增顶层循环；fresh publisher/queue/core 导入回执通过，未要求再跑未受影响的整包检查。

## 实际私有证据及限制

已读对应测试源码及 [scope-checks.json](scope-checks.json) 所整理的工具原输出，未自行重跑：

- [首组](scope-checks-first.txt) 4/4、exit 0、29.603 秒。真实私有 FS/Git/evidence/seal reader 以实际 archive 文件 open 次数计数：无 scope 两门读两次，同阶段两门只读一次，dirty 后再读；不同 scope 分别全读，每门 collector 仍运行。cached archive 变化、旧地址返回仍拒绝。OS token/boot/chain/CIM 继续使用既有私有替身，不是生产退休证明。
- [增量组](scope-checks-increment.txt) 3/3、exit 0、0.236 秒。覆盖空 registry、伪造/closed/config 漂移、并发/取消/未 await 与 epoch、真实 publisher fetch/queue 写及循环/unlock 路由、缺 invalidator 写前拒绝和 unknown 禁重放。首因在 callback 内 catch 后返回的分支没有专门测中，按实际代码静态核定，不夸称该分支已有独立动态证明。

没有重放旧 run、重复 8 分钟现场全读、新 Task、生产 dispatch/准备或放宽 40/60 秒门禁。同阶段去重减少的是重复 archive 字节读取倍率；写边界仍会保守重新全验，跨操作完整读取和每门动态成本仍在。本轮不认定全部发布稳定目标、真实控制采用或生产准入完成。
