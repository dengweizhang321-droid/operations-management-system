# 静态全字节核验脚本独立审查

结论：修正版 V2 的 `audit-final-payload.mjs` 可用于本范围静态字节核验。下文保留初版发现及后续修正，不把初版执行冒充 V2 通过。本轮只读脚本和小元数据，**没有运行全树读取、生产 CLI、联合回归或现场准入**。

实际小元数据一致：release `20261011T090355Z-21c2645a63247749`、manifest `6cff8886e533244997b65d2a8668776cee5178b95e4e2a99ed14bd25bf2733f4`、source `dc1dbeeded593980c6712e7afabde0a053dfd13d8f6c4bb9375718330af2b8fb`、plan `0afdb3de501e415e707670a471d245c24a6043139571099a8b9433b617a89881`、prepared receipt `4e2ad957…`。原计划前驱确实是 AB release `20261010T014638Z-97833d2f2b7e7bc9`、manifest `f4e537eb…`。`FINAL_SOURCE_HELPER_INDEPENDENT.json` 原 SHA 为 `84363b769c7de092efa02209511fa34108e1aefcd35cb750fdac3229f1c10ceb`，记录十路径及 dc1d/d1f39 身份。

正确部分：13行按 ordinal UTF16 路径排序，UTF8 名称、4字节大端名称长度、8字节大端内容长度及原字节组成 SHA；与原 worker `hashRelativeFiles` 一致。18–21行核原 plan/receipt/sidecar及 envelope 元组。30行比较 dist/helper/node_modules 的算法、文件数与完整树 SHA；dist仅排除受控 `server/.dev.vars`，另以31–32行检查配置硬链接，不读取值。36行仅 create-only 写本任务文档，不导入运行模块。

| 项目 | 精确位置 / 缺口 | 最小修正 |
| --- | --- | --- |
| 前驱源树未绑定 | 23行读 plan 指向的 source-snapshot，却未读取前驱 manifest 并比较其受保护原 source.tree。25–28行差异可能建立在被改过的前驱快照上 | 读取前驱 manifest，SHA必须等于 pinned plan 的 `predecessor.manifestSha256`，并明确绑定当前实际 AB 身份；比较 before 的 algorithm/count/SHA 与原 manifest/source fingerprint |
| 根与祖先重定向未拒绝 | 11/13行只 lstat 文件/已枚举子项，未检查 base/root及祖先是否为 junction/symlink；`readdir(base)`可跟随被重定向的根 | 读元数据/树前逐级检查实体根和祖先；记录目录身份，普通文件保持单链接与 read前后指纹规则 |
| 新增成员可漏审 | 13行只枚举一次，34行只终检已读文件；枚举完成后新增文件不会进入 stable Map | 对每个树终检排序路径集合和目录身份，拒绝新增/删除/替换；只重列结构，无需第二次全内容 hash。三个受控配置链接的 stat 指纹也纳入终检 |
| 外部范围声明缺精确锚 | 26–28行使用 helper records，但未固定该 JSON 的原 SHA、status/source/inventory，也未直接约束既定十 tools 集合；最终记录不包含其证据 SHA | pin `84363b…`，核 passed/dc1d/d1f39 与 after/manifest/binding一致、精确十路径及无重复，输出该证据 SHA。不要以可变外部报告代替已审范围 |

当前小元数据中 manifest.source.tree/sourceFingerprint 与 binding.identity.sourceTree 已一致；建议将这种关系也在脚本24行显式断言，并同时核 verified 的 plan/source inventory字段。配置检查仅是硬链接身份检查，不能表述为配置值或动态权限准入已通过。

本次读取的 manifest声明：source5160、dist164、helper3、node_modules31248。它们是已核小元数据，**不是本 reviewer 新算的全树结果**。原标准 source/session失败不被本脚本或元数据冲销；后续执行通过也只证明静态字节范围，不签回归、真实生产准入或上线批准。

## V2 修正复审

随后只读复审修改后的46行版本：上述必需边界已补齐，本范围内可接受该脚本用于静态核验。25–28行读取并固定原 AB manifest `f4e537eb…`，比对 before algorithm/count/hash；12–15行逐祖先 realpath/reparse和目录身份，并保存目录成员；41–43行终检已读文件、目录成员/metadata及全部路径身份。32–34行固定 helper原SHA `84363b…`、passed/dc1d/inventory和精确十路径，45行把证据SHA和目录闭包信息写入记录。37–39行三个配置链接只核身份/stat，纳入终检，未读或声称校验配置值。

核验结果输出改为 create-only `FINAL_PAYLOAD_AUDIT_V2.json`。早先第一版执行只能保留为初步历史记录，不能冒充已满足新增边界。**此次仍没有运行脚本或全树读取**，没有接受任何联合回归、实际 session准入或生产操作；静态字节核验也不是全文件同时刻快照或动态权限证明。
