# AI0088/0089 有限结构发布适配

源码基线：`f50943f4aaf5e1e2d574f4ae4ab76eead769858a`。开发分支：`codex/ai-task-feedback-candidates-schema-20261104`。本次仅开发、隔离验证、独立反审和分支提交，未合并main、准备制品、采用控制包或上线，未连接生产数据库。

## 实现范围

按已批准的五项设计实施：一个156→158批次，不设157完成态；窄范围精确catalog；保持现有枚举机制；新kind显式触发AI provision且不触发Pi Runner升级；CI当前recipe选择158，祖代recipe/回执和历史退役pin保留。

新三件套为 `tools/ai_task_feedback_candidates_{addition,catalog,candidate}.py`，kind为 `AiTaskFeedbackCandidates`，recipe为 `config/main-schema-releases/ai-0088-0089.json`。本代FILES恰包含0088、0089，祖代迁移文件没有修改。父证明调用workflow156并递归传本代baseline，plan仍复制当时现役app。

catalog固定两表的16/18列、8/7个CHECK（含自动正数约束）、各7个索引（含条件唯一和Django自动索引）、六个非内部trigger；另外固定两条新FK关联的八个原生RI触发器的稳定语义。两个新plpgsql函数的签名、正文/定义、返回trigger、语言、owner、search_path、安全属性及ACL完整固定，不冻结数据库随机OID名。快照来自独立PG17实际迁移结果。

Install后严格owner-only；发布器随后执行AI ProvisionRoles，使writer获得SELECT/INSERT/UPDATE/DELETE，reader零授权；Finalize与普通启动要求最终ACL。安装后的目录检查通过专用 `ai_task_feedback_permissions=False` 阶段参数核owner-only，不提前要求尚未发生的授权。普通启动不永久强制两表为空。

preservation继承祖代摘要并增加workflow父代四张既有automation表的行和ACL，按迁移态主键排序。每表和总行数界限在生成install intent和执行DDL之前检查，防止提交后才发现意图不可再读。

## 文件清单

完整逐文件清单见交付时生成的 `FILES.txt`。主要落点如下：

| 类别 | 新建或调整 |
| --- | --- |
| 本代实现 | 三件套、精确catalog.json、ai-0088-0089 recipe、私有PG rehearsal |
| 运行入口 | bi-app-adopt七处kind；Django新代优先准入及四项CopyApp成员；integration_release_gate新active优先；postgres_no_key_backup完整158目录及所有祖代已安装集合 |
| 发布链 | main-schema-release有限双迁移描述和静态ACL检查；publish-prepared-main显式新kind provision；manual-maintenance-continuation新Django字节资格，保留旧资格和readiness pair |
| 静态与CI | 新recipe mapping、execution材料绑定、嵌套catalog OWNER检查；CI当前recipe从Sales154切到158，不刷新祖代材料 |
| 定向验证 | A层文件gate、B层PG、guard mutation、静态ACL、PS5/PS7真参数/类型边界、Node编排、recipe静态绑定、OWNER基线与角色provision矩阵 |
| 证据字节 | .gitattributes只为本任务原始JSON/log/txt证据和新PS测试保留字节，不全局转换换行 |

未改 `install-main-prebuild` 的控制文件集合，因为它已收录main-schema-release；但现役不可变bundle仍不会随main自动更新。后续控制包准备/采用须按独立授权执行，本次没有生成或采用控制包。

## A/B 两层结果与边界

| 层次 | 结果与实际覆盖 |
| --- | --- |
| A：私有文件runtime | 10个定向测试通过。实际candidate/admission/prepared/plan/deployment/installed/finalized/active读写、重新签名后篡改、重复调用、unknown拒绝、授权失败不finalize、固定CLI路径/身份拒绝均覆盖 |
| A的父证明 | 158与workflow156回执、source_delta、baseline递归执行真实函数；workflow的154以下父证明为合成154接缝，没有复制生产回执或凭据。私有库存的稳定扫描显式memo，原扫描算法另测硬链接和空扫描拒绝 |
| B：独立PG17.11 | 最终13类检查、824个反例通过。明确AI0087/workflow0010构造156，所有祖代catalog与真实域provision同时通过；真实两步DDL原子失败回滚、真实install/reconcile、两阶段provision、原数据ACL保持、无pending及catalog漂移均验证 |
| B的边界 | 数据库层实际执行不等于完整文件gate；完整文件绑定由A覆盖。数据库仅合成数据、私有端口55512，集群已停止，password/data删除；未执行全库备份恢复 |
| PS5/PS7 | 各33项：AST证明除新增有限分支/CopyApp成员外原控制器token不变，五种路由、typed JSON/exit/launch/truncation反例、真参数绑定在首次运行时动作前硬退出；七处kind漏改与四条新原生拒绝均做突变验证 |
| Node | 149项定向测试通过，含精确双迁移集合、recipe步骤顺序、ACL先于binder、显式provision且不升级Pi、provision失败不finalize/启动/重放、新旧controller资格 |
| recipe静态检查器 | Sales与新158的私有fixture共30测试通过；测试声明为fixtureOnly，不作为实际执行材料 |
| OWNER基线 | 6测试通过，包含新嵌套catalog缺MAINTAIN反例 |
| AI role矩阵 | 7种迁移深度及18项receipt/table错配反例通过，原生init/start/stop exit0，私有端口63704；此项已停库，但额外数据目录清理被自动审批审查拒绝，目录保留 |

B详情见 [B-LAYER.md](B-LAYER.md)、[b-layer-result.json](b-layer-result.json)。权限矩阵见 [role-matrix-result.json](role-matrix-result.json)。PS结果见 [ps5-native.json](ps5-native.json)、[ps7-native.json](ps7-native.json)。

运行门禁逐条突变的最终结果在 `MUTATIONS.json`，首轮未覆盖充分的9项保留在 [MUTATIONS-FIRST.json](MUTATIONS-FIRST.json)，没有改写成成功。突变在独立子进程内编译禁用指定guard，运行实现确实被改坏，而磁盘输入原字节保持不变；因此不会把codeSha失配、导入错误或setUp错误误算成“检测成功”。每轮须由原测试产生明确assertion failure，原实现SHA前后逐项相同。DB guard的纯私有函数接缝与B真实数据库结果分开报告。

## 反审发现与修复

初版只冻结外键定义及六个非内部trigger。独立PG反例证实：将两条新FK的child/parent内部RI trigger逐个DISABLE后，初版catalog全部接受，拒绝0/8。此为本次“保留外键执行语义”范围内的P2缺口。

已只在本代collector增加 `pg_constraint.conrelid` 限定两新表的RI记录，包含父表ai_pi_operations上属于这两FK的触发器。固定15项稳定属性（关系/约束/对端schema与name、事件、enabled、deferrable/initdeferred、内置函数schema/name/签名、args），不固定随机OID/trigger名，不扫祖代其他FK。最终同样的8个实际DISABLE反例全部拒绝；新增字段逐叶负例也纳入824项。

前证据 [b-layer-fk-internal-probe.json](b-layer-fk-internal-probe.json)、后证据 [b-layer-fk-internal-probe-after.json](b-layer-fk-internal-probe-after.json) 分别保留。旧696项B结果保存在 [b-layer-result-before-fk.json](b-layer-result-before-fk.json)。

其他开发期失败属于验证夹具问题：A首版重复全backend扫描过慢，两份本人启动的隔离测试进程经精确PID/命令核验后停止，改成迁移清单+CODE_FILES的明确私有fixture；静态检查器双recipe测试最初复用了前一临时目录的Python模块缓存，现已按fixture清理模块并重跑30项通过；PS新测试最初将`+=`也算成`biArgs`初始赋值，现按AST Equals只选原赋值。未把这些失败称为生产故障。

独立审查请求角色为Sol High，实际底层型号未独立确认。核心、集成与修复后绑定均按独立上下文复核；不得把实现者自检称独审。

## 最终字节与材料

CODE_FILES最终105项：workflow父96项加本代9项，无重复，无recipe/checks自引用。真实算法为gate.code_digest(root)对实际文件原始SHA映射再做canonical摘要；迁移清单另用既有CRLF→LF规范化。祖代历史recipe、回执和退役pin没有为凑绿刷新。

正式checks材料由本目录 `run-mandatory-checks.py` 在独立干净冻结检出树执行，输出到开发交付树：Python compile、Node --check、PS5/PS7 Parser.ParseFile、JSON唯一键/文件检查，以及禁数据库连接的MigrationLoader/模型闭包；并用真实gate与f50943f4的迁移文件夹具核精确156→158。最终摘要、执行源码提交及成员SHA见生成后的 `ai158-execution.json` 和 `ai158-checks.json`，本报告不手抄暂态摘要。

这些是源码和执行材料，不是已绑定生产前驱的candidate/PREPARED，也不证明控制包已采用。后续仍须用户授权合并，合并后按规则准备对应应用制品；控制入口升级和实际上线分别按当次授权及原生门禁执行。

## 五项原未知的结论

| 调研未知 | 本次结论 |
| --- | --- |
| 合成156能否同时满足祖代ACL | B真实156目录、AI/inventory/workflow原provision与全部祖代catalog通过；没有从生产复制数据 |
| PG17精确表达式、函数/PUBLIC权限快照 | 真迁移捕获并冻结；两函数按迁移产物保留OWNER/PUBLIC EXECUTE，不在发布适配中改权限设计 |
| install目录与provision阶段交互 | owner-only安装与最终writer四权限分别实测；中途provision SQL失败实际回滚，A最终文件仍拒绝finalize |
| 新旧controller资格及冷启动范围 | 新raw SHA登记，旧资格/pair保留，PS双宿主AST和真参数边界通过；没有改变Start/Stop/排空生命周期，**未执行完整原生冷启动** |
| 最终CODE_FILES/摘要/控制采用绑定 | CODE_FILES为105，最终摘要由冻结树生成并由静态检查复核；已采用控制包与新源码的生产绑定本次未做，仍须后续独立授权 |

已知trunk backend-boundary红项未修、未作为本次阻断；没有追加AI业务使用效果验收、生产业务回查或备份恢复。

额外测试目录清理记录：自动审批审查拒绝删除 `.codex-tmp/ai158-role-matrix-20261104/data`，工具仅返回“blocked by policy”，未给更细理由。该私有库已停止、合成密码文件已由原测试移除，数据目录保留；未换工具绕过删除拒绝。
