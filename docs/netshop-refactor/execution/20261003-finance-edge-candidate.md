# 全景财务身份兼容后继候选

当前生产Django6b/139已完成获批的迁移、派生缓存回填和应用恢复；原月范围总览、商品、推广、对比、目录及旧01/ERP真实通过。全景仍返回财务来源403，六源验收未完成，不能称五栏目全部完成。

## 已完成的修复和主线

作者 `a129ea002ba2bb472b098489cc44f8221c1382e8`，父 `0b55af6ed9e344245eadb244bdd7bb05b6a14e8f`；Root在仅文档后继b7b55173正常合并为 `bd96029bfb45207cc82599e2098daaebf8aa8513`，正常push/fetch远端同SHA，主工作区及独立准备树干净FF。没有重复开发栏目。

只有finance/netshop_reads.py运行代码10行与专属测试改变。财务专题复用F与销售已有的精确签名本地管理员身份规则，普通账号仍须有效持久AppUser并复验角色、范围、状态和版本；原HMAC验证及前后actor一致性保持。不新建用户、授权或GRANT，不动其他财务证据协议、数据库结构、业务数据或预算。

作者与非作者各自隔离真实PostgreSQL运行14项通过，包括实际注册consumer签名200/无效签名401、保留身份错误角色/范围403、普通缺失/停用/降权/晚版本变化拒绝、原月度与年度读取。非作者用独立源码archive和新私有DB，正常Stop归还50875；不是生产HTTP或全139迁移重演。真实Worker的local开关、development配置和已编译local-build=true支持该路径的静态判断；原S请求未捕获principal，生产因果与恢复仍须后继实际页面验证。

## 原流程真实准备

Root从独立 `D:\.codex\worktrees\netshop-public-freeze\运营管理系统` / bd96029b执行原PrepareApp successor，11:00:17退出0。没有进入新维护或部署。

| 项目 | 精确值 |
| --- | --- |
| Prepare ID | e3a80ecfeecc449888cad9a9c0428304 |
| receipt SHA256 | 6e2e5d007f25d4e1dfe4e0a7caab2485ae9d2be6818d2a10b850744a4995c1b8 |
| candidate manifest | 3184134ad0ea2ada3c644d95035a1cce0361b103a12d4717154b995db4f3ee58 |
| fingerprint | d0356da48a7d263f0b34efe4591a44347b9b8256769ecf3c5b3d99640cd7ee53 |
| 实际父manifest | 6b1312c4387713b32a88d3393bb9993484898b916d9f75666790f7cde897056f |
| Worker/helper | 原20261001T164608Z-4dc26d0ae8921e88 / manifest87，保持 |

独立包核验已通过：实际2917文件canonical指纹为d035、receipt6e2/manifest318/父6b精确相符，文件集合完全相同。唯一功能代码delta是已测试的finance/netshop_reads.py；另有原R2guard生成的.wrangler/cache/cf.json，同key集合/2053字节且计入指纹。137个仓库迁移源、7个控制/准入/备份脚本及v3/v4策略全部逐SHA不变，新增测试按原包规则排除。初始“唯一一文件”断言因生成元数据失败的原日志保留，未改产品或包以适配断言。仓库137源与正式139收据是不同计数，本包核验未重新查生产DB。Prepared不等于已采用，当前正式仍6b，139迁移与回填已完成，后继不重复它们。

非作者封存报告 `E:\codex-artifacts\finance-edge-independent-20261003-48178a473fd44422bcc4f286b58701ea\FINAL-FINANCE-SOURCE-AND-PACKAGE-REVIEW.md` / SHA `fae225fb444c6b3d6c325077d7ef9a7a17e9006b492b5a4133e188b94966dfa6`；同目录实际14项result SHA `94c3cfdeb32b4e33acd99e9e7d96086014fdf2904240d4649d80362d562a0eb8`，包delta JSON SHA `2592816850de8d5a65869fbd2f064b63fba1036054129694e296954c53a94702`。原6b浏览器总体FAIL报告在production记录明确保留，不被候选PASS覆盖。

## 后继采用方案与影响

需按原安全流程再进入一次保留PostgreSQL的应用维护：先复验当前包父版本、原helper/业务排空和资源身份，完成最新前备份及独立恢复，再采用已审Django包、原HardenAcl和唯一Start恢复；后备份/Verify/归档、12组件、启动绑定、守护与渠道及原范围全景六源真实验收分别记证据。PostgreSQL/n8n保持，Worker/helper和Django会临时停止并恢复。采用期间不增加迁移、回填、业务重跑、数据删除、权限或预算改动。恢复前原139包沿原受保护Rollback兼容路径处理，不能恢复138数据库或DROP缓存字段。

最新138→139批准窗口已退出。本候选是验收发现的新运行源码与新维护窗口，尚未执行；不能将已完成一次维护的批准自动冒为本候选已采用。两次完整备份和独立恢复耗时随原流程，本次原件只能作时间参考，不承诺短窗口。当前应用保持在线；自然业务重试不人工重放或取消。

## 安全清理与保全

新增作者普通树 `D:\codex-isolated\netshop-finance-edge-compat\运营管理系统` 已原生git worktree remove且本地codex/netshop-finance-edge-compat正常-d；同名remote从未存在，未冒删除。远端main含a129、clean/独有历史0、ignored仅258可重生pyc、无进程/计划任务/锁且作者/Q归还。完整tracked archive4786项CRC通过，SHA `391563618666bc126d70736c484abdd095e45d383f0361faa6336a516b84afb1`；E原测试、报告、独立源码及私有DATA保留。累计21树=18受管归档+3普通移除，当前准备源、Root发布/状态树、Q依赖、其他独有历史与原预览仍保留。

证据入口：`E:\codex-artifacts\netshop-scheme2-20261003\finance-edge-prepared`、finance-edge-author-02/HANDOFF.md，以及presence-production/原收尾证据。已有各栏及缺源限制继承 [生产执行记录](20261003-presence-production.md) 与 [原候选交付](20261003-presence-cache-ready.md)。
