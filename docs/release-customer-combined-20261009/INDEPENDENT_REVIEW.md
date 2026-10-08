# 组合候选最终独立复审

## 当前结论

**精确准备范围复审通过，无剩余阻断；生产许可尚未取得。** 本报告的当前批准摘要是：

`9a7bb676efb1c76d4d3daad3c1533e3690d000fa8b47a58946beb65afed58bd9`

strict/full，19个操作，**33个upfront collector pins**。旧851及旧c152批次均被保全并替代，不得执行或冒用其历史passed结论。候选与源码未因最后producer收口改变；19操作、maintenance owner、两次Restore RehearsalId与未执行的c152模板相同。

本次只做文件/结构/证据核验，不修改冻结adapter-review、不重复大型构建/PG/完整candidate验证，没有生产部署、正式备份、维护、Start/Stop、调度更改或真实客服导入。

## 精确来源和候选

- 来源：e44f1cbce9135d7327ce722416ea33a8e0f06004，Git clean；独立源tree SHA `d5d37b8ffee5c1699d5b10d98b5ddc4230631e00353cf7fa07c9479e266c9f50` 与批次和manifest相同。
- Worker：20261008T164956Z-d961fa92fe9b0ef5；manifest `cb644fbbe6bd50fe7c01f3663f10b796f75a6f929b3685c2b32761b3357bf0c6`；plan `ba16cb94e1f4716dc9b6aaf77e87b2b7fb9427ae3f9160d2d709e784d8641400`。
- Django：prepared d6c3fcad7380480896b1f972c84c4279；receipt d51decd7abd141e3d853c5074396926f286c1a108da503841944edb846153b65；candidate manifest237fbe0de6e4fbab6b80389298ba1b8a5951b5aaf213c250ad3ee9f590010ab9。原完整Get-PreparedApplication及前驱门禁成功，复用依据是实际Django输入闭包不变，而不是略过检查。
- 当前生产仍是原f5d9 Worker/8973链及Django121d。新候选尚未切换，handoff.productionApproved=false。
- 已冻结adapter-review原始SHA：`7fe420c2885755058f239b874cc5ca89465a1ff7f24686f23b43e072e4082f78`。本最终报告不被该stage evidence引用，避免摘要循环。

## 实际验证与准入

verifyBatch API/inspect通过。source/test/artifact/plan/owner、Django实际收据及同批Backup引用一致。33个collector文件和全部操作command files逐实际SHA检查通过；37个不同实际文件只各算一次。后部署installed维护工具使用prepared将安装的精确字节核验，未把当前旧installed误判为未来后继。新增Chrome、系统PowerShell、验收脚本、handoff、精确delta、Django前驱摘要、客服历史基线及外部operations-system-control均在**初次生产动作前**检查；等待批准期间改动会拒绝，而不是拖到切换后的UI/收尾才失败。

最终原collector完整准入完成于UTC **2026-10-08 17:28:18**，admission-preflight/timing均绑定9a7。包括33个upfront pins及完整原候选/生产头验证，单次实际耗时 **194029.2697 ms（约194.029秒）**。独立再次用原assertBindings比较返回的全部binding与封存批次，逐字段相同；主执行也保存admission-bindings-verified.json。只读wrapper已补相同断言，production execute原有门禁不变。没有为审查再跑一次完整验证。

该耗时是一次准备阶段观察，**不是用户说“上线”到完成的实测，也不是生产停服时间或稳定承诺**。真正获批之后仍须现场重新检查，不能凭当前预检成功使用过期前驱或变动的工具/证据。

联合22相关文件254/254、零失败/跳过；catalog5/noKey7/consistent31；实际私库日志Ran11及OK。原统计NaN与系统Python缺psycopg失败保留；已完成阶段只有raw SHA及exit0共同确认后续接，没有重跑254项。私库data/password及55884监听独立确认不存在。旧全量suite明确标为此前基线，不冒称新组合全量复跑。

## 操作与验收范围

19步骤保持原严格保障：候选复验→installed前备份→精确prepared前隔离恢复→KeepPostgres排空/维护→DjangoDeploy/HardenAcl→唯一Worker apply→退出维护/Start→正式资源、精确来源/权限、客服历史查询、两入口只读UI、12组件、startup、两条新自然守护→后备份/后恢复→最终readiness。恢复须绑定同批已确认的Backup目录/manifest/dump/内容并完成cleanup；原权限、任务租约、完整性、CAS、PNR与unknown不得重放均保持。

Worker实际业务增量为**6文件**，与1e6004b5 parent/commit原字节及旧/新真实snapshot逐SHA吻合。完整app/lib/worker对称差异恰为6项；未知新增/删除、摘要漂移、批准变化缺失都拒绝。Django业务前驱取其实际所属installed基线，而不是旧Worker中的backend副本。

客服历史GET按每行日期，四店/总范围10月1–7日，旧短名“志高商用设备”另验1月1–7月20日实际正记录范围，比较total及完整shop集合；不持久化客户明细，不归并历史短名、不改事实制造相等。只读预检已通过，实际切换后还要再做。

两入口UI验收只检查初始空店铺、四个规范选项、选择保持与无文件时禁用提交。临时Chrome context不复制登录profile；阻止service worker，网络仅允许同源GET；POST/PUT/外部请求在送达服务前abort并令验收失败。不选文件、不点击导入。**生产UI尚未执行**，必须新候选运行后验证。

真实资源逐字节、上线后12组件/权限/readiness、startup、两条新自然healthy守护，以及正式前后备份/隔离恢复和最终收尾，均为生产明确许可后待执行的必要工作。真实文件上传、导入、自动执行、补数和数据恢复不属于本次准备许可；不得提前宣布发布全部完成。
