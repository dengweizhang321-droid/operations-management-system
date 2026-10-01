# M8 候选准备与本次生产采用预检

日期：2026-10-02，Asia/Shanghai。候选准确源 `22a323c956c28179294b8dbfe494fd4f60ea497d`，业务代码为独立通过M7的 `9e8d43d4dd6dd6f04465ac7277941a49ec7758c2`；本交付记录为后续文档，不表示运行包重新构建。

| 已完成步骤 | 实际main提交 |
| --- | --- |
| M1 总览01 | 1c2cfa506dcf1430de900aaadad2e076cf1a4f9e |
| M2 公共底座 | 9d4830ee50232b956bdb9c1c7dd5b30564805355 |
| M3 商品表现 | 77a26703b143288edd91fbab40c6741ed487e698 |
| M4 推广分析 | b7fafb482b39fb82382f7ab42e54175b89b9eece |
| M5 店铺全景 | 7ac1775e3af09d84427d6bf49db89fcb2547c250 |
| M6 对比页 | 9e8d43d4dd6dd6f04465ac7277941a49ec7758c2 |
| M7 独立组合冻结公告/候选来源 | 22a323c956c28179294b8dbfe494fd4f60ea497d |

各次正常推送、远端包含与主工作区同步证据继承已提交M1—M7交接及E盘coordinator机器回执，没有重复开发或重复cherry-pick主线提交。五栏范围、01新旧切换、权限、全范围跨页商品比较、推广同店同日、四态/缺原因、SKU/SPU历史、日期/比率/零负基期、完整来源版本/分页/汇总/导出和返回范围均已在准确最终组合独立审查。M6非作者Home35项及11个必要门槛通过；M7核心阻断0。合成UI、隔离PG/真实签名原接口与生产采用分开，不声称全量旧单元/类型检查无历史问题。

## 精确候选

Worker原在线准备exit0，release `20261001T164608Z-4dc26d0ae8921e88`，manifest `87f5e879ca2bb3d797886c859c7452d4a72fffdb8e9ff777cd839d039db368e9`，plan `cd77c5849638667e7eab8be9872d1683468ae11dfa99e9f94653ca2ba1d05ace`，sourceFingerprint `ce97a080b8b3785408f9b28048a4551029f1b58cd40ca6c62f8876ef90198eff`。

Django原PrepareApp exit0，id `954e64fa5e1140d9b5ad71e31d8b7263`，receipt `2b01dccafe40de6daeb91752ea68e724e77057ac7b46615d74f7a7625beb6116`，manifest `6929b2c6cc4248c5be84e108c57622419f7f071bfc393b4075d8b198d1c88707`，fingerprint `5aa1eb4eb5689358721621998b443d002ed4dbf915e3122630382c21c79270c8`。

非作者M8只读报告：`E:\codex-artifacts\netshop-scheme2-20261002\foundation-review\M8-readonly\review-final-M8-prepared.md`，SHA256 `2498C6592439F2528CDF5CDF50C5C1A14CFB576EE2471B2E998AAF9C72511142`。Worker4307源/154dist/3helper、Django2912文件及544已审源匹配，绑定未决0。迁移树与原62+76=138代际政策相同；136个本仓非init迁移文件是不同计数，不冒新增迁移。候选生成deployedAt与旧bootstrap指针不冒正式采用。

## 本次上线授权及新阻断

已直接读取规划原会话用户“明确批准本次上线及维护时间”，授权绑定上述候选，仅必要原应用维护、正式采用、恢复及验收。没有扩大为业务补跑、真实下载导入、数据清理、n8n定义/调度、无关重启、外发或付费调用。

预检生产仍为Worker `20260930T005003Z-7df88d242a9635ba` / manifest `8d8e1e89994bf61aced64e72e28ae6261357952ba79d245d91e5fe51f838811e`；installed Django manifest `e1eed58c4bb017dd1360a2a4f6ebf6ab1b1af7b861546d6770ed2d6c5668cb17`。候选和前驱摘要再次核对相同，尚未EnterMaintenance、DeployApp或apply。

实际新的维护阻断：helper5791 `/health` busy=true，唯一execution `5413` / workflow `jd` / status `quarantined` / stage `failed`。n8n `JdN8nSilentCopy2026` execution5413已error，原UTC记录2026-10-01 02:00:25.202—02:07:39.780（上海10:00—10:07）；当前n8n非终态0不能替代helper闭合。现运行脱敏日志为线程starting、ready=false、exitCode1；底层原因未明，不冒完整业务效果闭合。原claim拒绝 `helper_slot_cleanup_requires_manual_action`，原Wait-AutomationDrain明确拒quarantined，无现有公开释放隔离route。不删除槽、不绕门禁、不用Stop/重启替代排空。

两项市场历史cloud任务progress activeClaims=0、paused、inference_result_unknown；AI三个队列各total0。原历史未决保持，不重跑或改成功。备份控制台无非终态并不替代direct operator状态。只读元数据证据在 `E:\codex-artifacts\netshop-scheme2-20261002\foundation-review\production-readonly`。

非作者正式预检阻断报告 `preflight-block-5413.md`，SHA256 `03F518F9512712CB904F107690984A5F3CD4EE7A5B8DDDCB8F758FB934ABCABA`；JSON `D9132427665CB50296EB733A5D8F76F83DC2BDF3C43E27C4A97842FBA50E063A`。54份固定JD计划元数据中没有owner5413，但不以此代替平台/下载/导入全效果闭合。Root本次决策保留在线生产及原隔离状态，需要精确效果核对和已审、安全、获授权的闭合路径后再沿标准维护继续，不追加未审代码进候选。

## 已执行的上线准备

原installed Backup completed，恢复点 `E:\运营管理系统业务数据\daily-20261001T211319Z-dbe6b97da371`，manifest `581ef42ed365a15c2ccfc133e908a0652ba716eb0f5184b12528f76199a559fb`，dump `83e6ce5532150063bddada771e457be35e8eec990a2f6424c6c10ef1c0f7c403`，content `3d4ae79925f29cb9825d75178a11c77940629ca564b89afd9733efaccb1dd523`；Verify exit0。原三份轮换及两份保护维持，未保护的9月30日恢复点按策略淘汰。此处只引用当时仍存在的恢复点，后续轮换后须重核。

独立E盘RestoreRehearsal `2619d7478d76` / 端口55897 exit0、completed，上海05:31:14—05:40:33。expected/restored content均为上述3d4ae799全摘要，profileRestoreVerified=true，profileContentSha256 `a99d00d8ecf3df53ba8de7ce42ccceda5c3c078ed60dbfa7c9b4ddf836390ccf`；productionDatabaseTouched=false、serviceStateChanged=false、cleanupStatus=isolated_data_removed。未覆盖生产数据库。原日志 `E:\codex-artifacts\netshop-scheme2-20261002\production\pre-restore.log`。Backup自动发布包清理为blocked / Process ownership is unknown，备份成功与清理失败分别保留，不提权或绕保护。

维护起止：未进入维护。候选尚未生产采用，正式五栏页面/只读经营来源与恢复后全栈验收尚未执行。缺源继续明确：去重UV/客户、新老复购/B2B、同款历史/类目历史、完整历史ERP成本及映射不能造数；财报按自然月/年度、不按日摊，经营事件不推因果；多源非原子性及原2MiB/期限拒绝保持。

## 安全清理及保留

此前已合格归档16棵工作树，精确原保全/远端/归档/删分支回执继承执行台账。2026-10-02另正常-d删除6个Root自有未checkout且远端main包含的本地分支：codex/netshop-finance-cancellation、codex/netshop-m5-integration、codex/netshop-m6-registration、codex/netshop-network-stage-fix、codex/netshop-public-freeze、codex/netshop-temporal-freeze。同名remote原本不存在，不声称删除remote。回执 `production/root-unused-branches-completed.json`。

16棵原目录统一为 `D:\.codex\worktrees\<以下名称>\运营管理系统`，同名本地开发branch为`codex/<名称>`：netshop-overview-review、netshop-overview-fix、netshop-foundation、netshop-foundation-review；netshop-products、netshop-products-query、netshop-products-ui、netshop-products-review；netshop-promotion、netshop-promotion-query、netshop-promotion-report-baseline、netshop-promotion-ui、netshop-promotion-review、netshop-promotion-integration；netshop-product-series、netshop-cross-domain。原存在的同名remote开发branch亦已删除，promotion-report-baseline远端从不存在，不冒删除。受管均原owner真实附件范围归档；恢复snapshot refs保留。P四原66条证据及A六精确闭合报告B4690A37、product-series与cross-domain末次独立闭合继承，未重算为新增清理。

C原所属会话追加完成第17棵 `D:\.codex\worktrees\netshop-comparison-page\运营管理系统` / `codex/netshop-comparison-page`，tip b6fb4b3f为远端main祖先，149 ignored源/保全副本及36 run/678历史证据核验、无活动借用/锁后按应用归档，附件 `01a0f96d-f070-7d02-83ef-1d1b62dc3582`；本地正常-d，同名remote原本不存在。Root再核目录/本地ref/remote均无、main含tip，清理累计17。精确回执 `E:\codex-artifacts\netshop-scheme2-20261001\comparison\lead\cleanup-audit-20261002-2849d165f29c4276ac69968b751b9be8\final.json`，SHA256 `B4A26BAACABC6D91A68847680B375ACE7F2B9F6F4E73C5960161AA9750F0242B`。C其余四棵独有文档/替代史继续保留，未为清理补merge。

Root集成/Finance/Q普通树保留独有审查历史和证据；public-freeze保留精确候选来源；platform-series受保护进程依赖未核清；S/C树归原Lead且仍有预览、唯一内容或附件范围限制；原O/P/A/S/C设计预览继续留。普通publication/baseline树也待完整活动依赖资格，不强移除。保留本轮恢复标签、运行候选与生产文件，清理不阻功能交付或本次上线。

误建空层级 `D:\ .codex` 的目录删除此前被自动审批拒绝，未绕过或改用其他工具删除；当前可用记录不足以进一步确认拒绝理由。尚不声称全部清理完成。
