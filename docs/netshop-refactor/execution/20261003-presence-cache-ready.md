# 方案二推广SQL恢复候选交付

2026-10-03。源码、主线和真实准备包已完成，新增生产采用尚未获批。当前运行Django76f / Worker87 / 138，原用户2026-09-01—09-29的新五栏目和目录仍503；旧总览与ERP同范围200。下文不将私有测试或准备成功称为生产业务完成。

## 五栏目与继承成果

| 栏目 | 已合主线提交 | 已完成范围 | 当前真实验收/缺源边界 |
| --- | --- | --- | --- |
| 总览01 | 1c2cfa506dcf1430de900aaadad2e076cf1a4f9e | 原01布局、新旧切换、共享范围和原入口；M7既有资格继承 | 原用户新总览月范围503；切旧视图和旧经营明细200 |
| 商品表现 | 77a26703b143288edd91fbab40c6741ed487e698 | 完整跨期/跨页比较、SKU/SPU分开、零负基期/缺数 | 新月范围503；不把当前商品快照当历史归属 |
| 推广分析 | b7fafb482b39fb82382f7ab42e54175b89b9eece | 同店同日配对、来源/对象/单位与归因说明 | 新月范围503；无可靠搜索词/自然流量时明确缺源，ROAS不等于利润或因果增量 |
| 店铺全景 | 7ac1775e3af09d84427d6bf49db89fcb2547c250 | 原拥有者六来源载体、平台/ERP/财报口径与趋势 | 新月范围与目录503，六来源载体未生成，不能称已验证；映射/成本/订单来源不完整保持限制 |
| 对比页 | 9e8d43d4dd6dd6f04465ac7277941a49ec7758c2 | 完整授权平台/店铺集合、分页/图表/比较版本和返回范围 | 新月范围503；来源之间不冒原子快照，不跨平台去重UV/客户 |

公共底座冻结9d4830ee50232b956bdb9c1c7dd5b30564805355；M7已审组合22a323c956c28179294b8dbfe494fd4f60ea497d。原M8采用与组合配置/日期修复的实际操作、原5413只读核验、备份/运行和FAIL证据见 [正式执行记录](20261003-combined-sql-production.md)。财报自然月/年数据不摊日，跨域成本/产品映射未知保持不可用；用户数/B2B/新老客缺源不推算。原合成UI/独立PG资格可继承，但不能替代这些真实FAIL。

## 精确源码与包

- 作者最终：3dba3b66ec3d6db4fb0e5fa03f18979079297840，22文件，原core a9/00c后只修备份PS精确139及类型准入。
- 实际正常合并main：978a6322bee9f106a226200bf37977b2204ead16，父b1f0b7e1055f79317c0c2a410094e1aca388841a、3dba3b66。无冲突、组合源码与作者一致；normal push/fetch远端精确相同，包含3dba，主工作区clean安全FF。后续交付文档提交不改变此包源码。
- 精确candidate证据：9a1245bfebdc15eefd1a324d62ea597ce1ed748ac8d60d676b17bb466c0befda。Root/Q各自实际candidate verified；原138父release receipt4c2bb9bb834a37a137a9c8b88f51287baf2164834ecd32e69fe4851ef251db59，实际delta-admission verified。
- 真实Prepare ID：76b7deb901b44492b767ae50673557bb；receipt2d11452cecb3a8baed437e9fdb6378cd5d159d25aad4de131461a481369b6799。
- candidate manifest：1b4472b5b82e6ecb5be88b7f5f6f3eeac94c973f7d5dbe61635e96b9b509cffe；fingerprint630f07d6553be16f0ed1464840f6e5363307ca06d49209a40ed05294c7ed566b，2917文件。原canonical函数只读重算全部一致，CF缓存由原Prepare R2guard生成并纳入指纹。
- 前驱/实际running Django仍76f7857203e780758fb2393b10ae735a0e46ba8aaa2dbf3fba32654a2c3a3179。Worker仍20261001T164608Z-4dc26d0ae8921e88 / 87f5e879ca2bb3d797886c859c7452d4a72fffdb8e9ff777cd839d039db368e9；实际19artifact匹配，维护和Start都委托installed Django，本修复无必须重建Worker的证据。

## 测试与独立复核

作者49实际私有PG覆盖三态/别名/零/锁/CAS/原guard、写发布/duplicate/rollback、共享与O/P/A/API回归；早前非作者core57+2实际PG继承，最终delta另两真实PG及13apps/0SQL内部字段检查通过。原43-model覆盖缺口在前驱复现，不修无关模型、不删除测试、不重写旧失败。

非作者38unit、PS5/7各5准入及9元数据负例通过；备份PS修复后另PS5/7各19正负实际通过，原标量数组接受反例现在拒绝。固定正式runtime/孤pointer的原CLI拒绝实测，不冒正式安装成功。

完整295表/31角色的纯自造PG先真实62→原76步→138，再前备份/独立恢复→唯一0004/真实witness与create-only journal→139后备份/独立恢复/角色实际登录健康，原Python/PS路径通过。作者实际运行，Q审原件/21引用SHA/角色authority/catalogue/非迁移表根；Root/Q官方gate也实际verified。没有伪138记录、密钥生成、预算或角色放宽，正式context和生命周期未执行。

两万条实际TOAST合成范围有限SQL资格：完整汇总结果592251B相同且匹配oracle；保全raw续测0.694s、cache冷首0.151s、warm0.149s。原SQL7秒不变，原首样本耗时未保全，异步IO/OS缓存与分段65秒限制明确，不称P95/完整冷暖对照/正式200万行或RPC恢复。

额外真实备份副本资格因私有Windows executor三次准备失败停止：0restore/0profile/0derive/0hotspot/0生产，自己的空55895正常关闭并精确移除，原备份SHA不改；不是源码/备份缺陷，仍属未验证项。没有继续重试或把上述小规模结果外推。

| 证据 | 精确报告/摘要 |
| --- | --- |
| 最终源码Q | E:\codex-artifacts\netshop-scheme2-20261003\foundation-review\presence-cache-final-review\FINAL-PRESENCE-CACHE-REVIEW-3dba.md / 0675e23945ac23561d9788b3ab4ce4710feb93a4e5ad7e24660f100d5974bdf0 |
| 真实包Q | E:\codex-artifacts\netshop-scheme2-20261003\foundation-review\presence-prepared-review\PREPARED-76b7-REVIEW.md / d066fce4a61f85c2981467f186a431841965f37daa940402db44abbeffa7f40a |
| 完整私有profile原件 | E:\codex-artifacts\netshop-scheme2-20261003\presence-full-rehearsal-00c6-01\candidate-evidence-final\README.md；candidate.json SHA9a1245bf… |
| 2万有限规模Q | E:\codex-artifacts\presence-scale-independent-20261003-8b6286021a9843fd9f1fa3b41a05522c\FINAL-SCALE-REVIEW.md / c190e0b730189949edb4b6ba51b541a1fe2960d9ca8a3dff3ddec25581d3ee6c |
| 真实副本未验报告 | E:\codex-artifacts\presence-real-backup-copy-independent-20261003-de8a513119f64cff8b28ca751f43f30d\FINAL-BLOCKED-REAL-COPY.md / b33918224148e553806bc70ddb10d9b7d786694b0b601fa2c35291934ad00b31 |

## 追加采用的具体操作和影响

新增生产迁移和回填超出原明确排除范围，用户休息期间的常规技术决策委托不替代这项许可。包已具体可审阅；需要明确批准本包138→139、五个内部nullable派生字段与一次追加应用维护、精确有界cache-only回填。

仅JD/ad五固定指标缓存，其他来源/无效basis/未知表达式回退原JSON；业务basis更新失效，原0003不改/不豁免。业务值、业务updated_at/内容指纹、导入批次、scopehead不重写。回填按global→行锁/原JSONB快照CAS，默认dry-run，执行双确认/create-only回执，每批50默认/最多250、2MiB、批内共同期限5秒、锁1秒、单SQL不高于原7秒。5秒不冒包含驱动COMMIT/本地回执文件IO的绝对可抢占时限。

Nullable ADD需要短时表锁；回填增加WAL/死元组/磁盘、原global revision/digest按实际变化批次推进，旧分页token须刷新。游标结束不算全验证，残余无效缓存/遗漏CAS需独立回查，原JSON三态、金额/单位/行归属等价后才记完成。来源目标行数、回填速度与维护总时长尚无真实测量。

合法顺序：原最新准入与同ID完整drain/appsStopped→KeepPostgres维护内新138前备份/Verify/独立恢复→精确delta Plan→Deploy/Install→获准cache维护及独立核验→139后备份/Verify/独立恢复→Finalize→原Exit/唯一Worker Start→启动绑定/12组件/自然守护与原用户同月范围五栏业务验收。n8n/数据库服务保留。原门禁要求前备份createdAt≥本次maintenance.createdAt，不能使用窗口前旧backup替代；Finalize必须先于Start。

窗口包含两轮正式备份和两次独立恢复。上一轮约841MB备份/校验10m50、独立恢复9m05，只能作为约40分钟这四项成本的参考；还需迁移、回填、切换/验证，不能承诺短窗口或稳定性能。原SQL7/RPC8/65秒/2MiB、权限/AI预算/无新密钥策略不提高。

回退不能直接套旧138包在139上完整启动：旧读写兼容私有验证≠原启动/backup门禁兼容。优先保留nullable列与失效保护，另受审兼容应用/准入/备份包；不自动DROP列或改业务事实。恢复前138备份是单独明确获准的维护动作，必须处理窗口后变化，不能默认覆盖生产。

## 清理与保留

此前实际安全清理19工作树（18应用归档+1普通Git移除），精确17原清单在M8交付；本日platform-series与readiness-fixes回执、8额外闲置local refs和remote实际结果见 [执行记录](20261003-combined-sql-production.md)。本候选普通author树在main包含、clean/独有历史0、452可重生pyc、无借用/活动/锁、必要E证据保全、actual attachment列表无受管登记的资格后，已原生Git移除 `D:\.codex\worktrees\netshop-promotion-presence-cache\运营管理系统`，普通-d本地及同名远端 `codex/netshop-promotion-presence-cache`，末查目录/登记/两branch均不存在，未force。完整tracked源码另archive并逐SHA保全；所有E DATA/taint/失败保留。实际回执presence-prepared/author-cleanup-preflight.json、author-cleanup-completed.json。累计 **20工作树=18受管归档+2普通移除**。main/恢复标签/运行包/业务备份不删除。

当前保留：public-freeze/source codex/netshop-context-sql供准备/下一正式Plan；Root publisher与integration状态树；普通Q finance-subset-review及wave2-review借用依赖；failed JSONPath0be未main唯一历史；finance-support与S/C各四树的未被main逐提交包含历史/原设计预览；readiness-gates在另一会话附件范围。对应精确路径、预览及条件在协调状态与M8交付，未知/活动/不在工具附件范围不绕保护删除。E作者tainted合成DATA/旧失败保留，所有该批私有端口正常停止；真实业务副本从未恢复，没有私有业务DATA留存。author树已移除不影响下一Plan，Root public-freeze clean978已用同一E候选实际gate verified；历史E脚本ROOT仅再现位置，源码可由main/完整archive恢复。

下一阶段开发/包准备已完成；进入新生产窗口的条件是新增明确许可、重新复验包父版本/准入和原备份恢复。当前没有新Deploy/生产139迁移/回填/服务重启/业务补跑下载导入/记录删除/强清槽/外部发送/付费模型。原已经获批完成的M8及组合维护单独记载，不被此“新操作未执行”覆盖。
