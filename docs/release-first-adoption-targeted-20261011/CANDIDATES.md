# 精确生产候选与剩余条件

封存时间2026-10-11T10:13:00.094Z。生产尚未批准、未执行。本批不同于旧65fc／872，不能重用旧批准或中途修改旧WAL。

| 对象 | 精确值 |
| --- | --- |
| 批次 | `f0bb923070dc0741a6b76885b6fe08f54710928b0eda1398a9cab8452d1d6c9e`，v4／targeted-first-adoption，19操作，数据库operationIds恰2个 |
| spec／tests | `E:/codex-artifacts/release-first-adoption-targeted-20261011/ADOPTION_BATCH_FRESH_V1.json`／`ADOPTION_TESTS_FRESH_V1.json`；原字节封存副本在evidence |
| 执行入口 | `E:/codex-artifacts/release-first-adoption-targeted-20261011/fresh-adoption-entry-v2.mjs`，`69898b1be33a9e3ba0d30a2eab480a12ca05fe339bf373bc333eec7d10245b99`；授权只选其精确argv，不签默认cached CLI |
| 限定源码 | `D:/codex-isolated/release-first-adoption-targeted-20261011/adoption-source-v3`，5160文件，树`dc1dbeeded593980c6712e7afabde0a053dfd13d8f6c4bb9375718330af2b8fb`；库存`d1f39fc003f51c511d1ae26fce1aaadc223cb99db1475cff1f33316728afade1` |
| SourceBinding | `1168c06784a134da5390b7403e83de8af27d5f866ad239f92bd4c136c134b745`；原prepare绑定完整源码／实际身份／前驱／chain |
| Worker候选 | `20261011T090355Z-21c2645a63247749`；manifest `6cff8886e533244997b65d2a8668776cee5178b95e4e2a99ed14bd25bf2733f4` |
| Worker plan／prepare receipt | `0afdb3de501e415e707670a471d245c24a6043139571099a8b9433b617a89881`／`4e2ad957633171ae5e57e521e3d327cc311fc93e517285aed24d746e1af152f2` |
| 实际Worker前驱 | `20261010T014638Z-97833d2f2b7e7bc9`；manifest `f4e537eb20dfa60127cf588db0ed911223c0b59c44fc8b839e5df196428e7113`；binding `094e10d4508986d62e5d90bf99041271fb7527f9a8b5d33f1dfb386529cee548` |
| 前驱source／chain | `92c2656c064c6a202239f4f010f0d241e90ae19fb35638cd328727a7ac64973c`／`aaf62994c75c3ca46362328fed6acc76f812808a2e852566782e5e0ba897e0d9` |
| Django候选 | `1e1138feef7148fb851713c2b39a25d0`；manifest `85cf0699925aad21f98ae682f458789236d206723b10865939915d1bcacddd09`；receipt `10db2364053ebfb90d85dd301914753453d02ad313cd02ff7312ca654ebdeb9b` |
| Django前驱 | app manifest `237fbe0de6e4fbab6b80389298ba1b8a5951b5aaf213c250ad3ee9f590010ab9` |

限定来源是实际AB source-snapshot加明确十工具差异，包含修正后的三发布模块和配置证据helper。全部其余业务、结构、依赖、存储及部署动作输入仍闭合；D只改两个配套消费者及原Prepare产生的精确CF缓存leaf，2933前后库存实际重验通过。Git最新main包含其他已交付watchdog改动，不代表这些改动进入本候选；不在正式运行包或其他任务准备目录上开发。

## 执行顺序、验收与回退

19步原序详见[规则](RELEASE_RULES.md)及[封存记录](evidence/ADOPTION_BATCH_SEALED_FRESH_V1.json)。原processDeadline实际逐19步通过，11条原PowerShell命令AST参数验证通过；两DB预算各30分钟而非运行时承诺。演练新12hex ID、55433/E原隔离目录，与本批唯一Backup回执绑定。新installed只读planner必须真实读取新Worker历史和新D工具，随后原隔离Restore保同点内容／权限／序列、生产未写、服务未变与隔离清理。

启动必须双manifest一致；显示静态资源及avatar14px、权限／未授权写拒绝、业务闭包、原VerifyStartup／AggregateStatus、自然watchdog和最后Startup全部属于必要完成范围，不藏入后台。没有生产配对计时或实际新Restore收据。回退遵守[ROLLBACK](ROLLBACK.md)：保持门／owner／WAL和兼容控制工具，使用新审查的精确successor；不重放旧plan、不直接回装不兼容resolver、不自动恢复生产数据库。

## 当前阻断及批准格式

现场引用守卫仍拒绝：2026-10-11T10:24:24.707Z最新一次833进程、215任务，0已知引用、198程序路径未知，含用途不明PID47936。未知不能视作已解除，完整app.previous保全副本也不授权原Deploy删除旧目录。先获得能读取真实引用／身份的独立现场核查并闭合，或制定另一个不删除未明目录的受审查方案；本任务不杀进程、不接管旧批次、不换绑或移除门。

实际readonly qualify结果和Git远端收尾见[最终报告](REPORT.md)与evidence；它只证明该次完整准入采集，不证明新installed服务、生产演练或上述引用门禁通过。生产切换确认须在这些前置条件闭合后，对本SHA、入口6989、19操作及唯一1＋1DB明确批准，并现场重新检查所有绑定。

精确批准命令形状为：

```powershell
node 'E:\codex-artifacts\release-first-adoption-targeted-20261011\fresh-adoption-entry-v2.mjs' execute 'E:\codex-artifacts\release-first-adoption-targeted-20261011\ADOPTION_BATCH_FRESH_V1.json' 'f0bb923070dc0741a6b76885b6fe08f54710928b0eda1398a9cab8452d1d6c9e' '<实际人类明确批准ISO-UTC>'
```

该占位时间不是批准，本文不要求或执行此命令。所有来源、历史候选、隔离树、旧目录保全、运行制品及发布准备目录仍保留，因为它们被候选／collector／回退证据引用；不能现在清理。
