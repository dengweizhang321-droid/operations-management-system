# 正式准备的精确候选

2026-10-11。均未生产采用，尚未批准执行。实际前驱仍是 AB Worker `f4e537eb…` / Django `237fbe0d…`；C 仅准备与复审，统一安排。

| 项目 | 精确值 |
| --- | --- |
| 限定 Worker 完整源码 | 5160 文件，`ad21d50df4cbdc91450c25caf369af0f615f555dac0023d6365d0e412e7d0111` |
| 源库存 | `fd53437a7a05bf779d40d580fdc385914c9db23f00208022b454c59068ed3bcf` |
| 原生产者来源 envelope | `831c104ce32daac6c3257b949f62a53998f1414cef4aa1a89132271d54a4cd1f` |
| Worker release | `20261011T034516Z-f308beaede528df7` |
| Worker manifest | `20855e01531d0a089cccfd01d5287aba774991cc2fe06747424a72a3ce1ff3ed` |
| 原 typed rotation plan | `38b26b941ae738995401795d0570fd7ef9ee6bf526a3582434b46c84af0f66da` |
| 原 prepared-build receipt | `087648dfb22af3ad74393e6e75c7837dbd4582560338d9edb2648ef8f6d95961` |
| Worker guard receipt | `1106b35ab4e3c9a586db4d7a85a877ae42126b2305f59a16a11c320251146270` |
| Django prepared id | `1e1138feef7148fb851713c2b39a25d0` |
| 原 Django prepared receipt | `10db2364053ebfb90d85dd301914753453d02ad313cd02ff7312ca654ebdeb9b` |
| Django candidate manifest | `85cf0699925aad21f98ae682f458789236d206723b10865939915d1bcacddd09` |
| Django candidate fingerprint | `fc33df2880e62e52415aa66655b1d380356023d779495c1d739324bf5fda55a1` |

原生产者 Worker 在线准备 12 分 34.459 秒（03:45:16.573Z–03:57:51.032Z），Django 原 PrepareApp 69.927 秒。它们是批准前准备耗时，不是生产不可用、批准后验收或节省时间；未生产配对，相关指标未测。

## 字节与测试

Worker 源为实际 AB 完整 snapshot 加必要十个运行模块；四模块新补丁 `47d73bc4…` 机械应用到原九文件源。主代理核对各修改块及相邻上下文，保留 main 与限定来源之间原有无关健康诊断差异；未按换行归一化放行 runtime hash。候选 tools 与 source-snapshot 的十模块原字节都匹配限定源。计划、清单、来源 envelope、原 receipt 和 LF sidecar 一致。全制品/路径/权限由原 producer 验证，主代理独立复核原绑定及十模块，并明确未重复全包 rehash。

最终不可变 Worker tools 上相关测试 **139/139**，37.359 秒，另有实际限定来源契约 23/23；两者包含相同契约用例，不累计为独立总数。作者 main 工作树 160/160 中的 21 项离线组合工具未随候选发布，不能宣称是 160 项候选运行测试。测试只重绑定路径与 Playwright 来源，断言和动作未改；PS 5/7 启动 guard 原 AST 以隔离 primitive 验证。并非生产验收。

Django 完整独立盘点 2933/2933、原 manifest fingerprint 重算一致。业务 backend/config/Drizzle 和全部 runtime dependency 字节相同。两个有意改变的工具为新 worker verifier/rotation；原 PrepareApp 的 R2 本地往返 smoke 另生成 `.wrangler/cache/cf.json`，因此完整制品不能称“仅两个文件改变”。新 deployment.json 元数据也由原程序生成并独立绑定。

具体 cache 差异只有 `tlsClientRandom`、四个 `tlsExportedAuthenticator` 握手/finished 字段及 `edgeL4.deliveryRate`，其余包括地域、路由和配置字段不变。实际安装 Miniflare 的 `setupCf` 从 Cloudflare 获取并保存本地 `Request.cf` 缓存；原本地 R2 smoke 使用它。CF 原值不进入报告/Git，只记录具体字段与原/后摘要。该缓存作为精确生成制品纳入最终 manifest，不使用 TTL 或自动接受后续新字节，不将任意 cache/config 变化泛化放行。首次两文件假设失败及原日志保留；具体差异仍需独立复核。

## 首次采用与回退

此为发布规则/准备机制自身首次采用，仍须封存严格/full、原前后两 Backup 与两 RestoreRehearsal，不依据尚未采用的新 not-required 结论减免。新 Django 工具和 Worker 必须联合审查。原完整维护范围内应先 Worker apply，再部署配套 Django 工具、HardenAcl；中间不插入 Backup/retention。每阶段 collector 分别按旧 W/旧 D、新 W/旧 D、新 W/新 D 校验。实际暂停的日备份不改动，其他操作/所有权冲突正常阻断。

这不是两组件原子事务：原每文件栅栏/CAS、维护、owner、WAL 和精确阶段校验保持。失败保留门、owner 和 unknown，按实际状态独立协调，不重放未知动作。

新来源协议进入历史后，旧 AB resolver/旧包不能直接重新作为运行入口，否则不识别新历史。安全降级先使用明确 legacy v2/full 批次；必要代码回退采用保留兼容历史解释工具的前向候选，以新 successor、精确审查和新批准执行，不改写旧链/WAL或直接覆盖包。业务后端与界面本次没有字节变动；数据库恢复另批具体恢复点。旧 app.previous 的删除/替换须先核明引用与保全，不能以原引擎默认清理为理由删除仍在用的材料。

最终可执行批次、适用验证证据映射、现场准入和回退保护正在封存审查，尚无生产批准。
