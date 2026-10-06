# BI 综合经营驾驶舱生产采用：2026-10-06

## 当前阶段

用户明确“合并 main 和发布上线”，随后明确“允许协调”。已与“优化各板块打开速度”完成交接，基于其已采用的五项性能源码 `2f46e1a9` 顺序追加 BI。当前已采用 Django、Worker 包及唯一 ERP 目标迁移，仍在本轮维护内；后备份独立恢复、Finalize、Exit/Start及实际页面验收尚未完成，不能称正式使用已经恢复。

| 对象 | 实际绑定 |
| --- | --- |
| Worker 前端/服务源码 | `e2c76835`，保留性能组合并修正选店铺自动选择所属平台 |
| Worker/helper release | `20261006T014342Z-94be344898f54a4b` |
| Worker manifest | `6cc16d73391aeef3ca5028b7334474e0b3d29fe48fb9514edd0e52f53f8d9504` |
| 已消费 rotation plan | `e95b1c80649cf13ec604d24a599fde3657c83b23b16a10ae662d48233aa1940a` |
| Django/维护源码 | `e79d5aee`，与 Worker 业务代码一致，追加现有 Git 应用路径唯一解析修复 |
| Django Prepared | `3161c0f92a99435cb088fbdb89dffbfe` / receipt `34e399bc125bc4b1e437c3820c5b7059e1a60ed2739d84d5b85cfeef5baece7f` |
| Django installed manifest | `aafd2addb9f2892c7d765ff8c6c82e1843ae78c65148393743ce6ae720a4443f` |
| Django fingerprint | `8751fabce691843d81b82379659b2d016649c740e471d55d7e5a319aa52f77a7` |
| 维护 ID / 有限追加 ID | `c4a50a552abbe001f6988139aef4fb16` / `7a97746dc6cf71882121252cfb2056aa` |

main 已合并并推送业务和维护代码。main 后续文档提交不作为构建来源；Django 与 Worker 采用各自上述精确包，不将 Prepared 或源代码合并冒作启动/业务验收。

## 数据与恢复

原 KeepPostgres EnterMaintenance 实控 exit0，应用排空停稳、数据库及 n8n 原进程身份保持。维护内前备份 `daily-20261006T012139Z-f147c49395df` / manifest `d14b0585211f113728d16558abd3a67f191651d1dd19505b0d708a88e25f3171`，原 Backup/Verify/E55896 独立 RestoreRehearsal 实控 exit0，完整内容、profile及角色/ACL复原通过，临时库清理完成。

原 Plan/Deploy/Harden及有限 Install 实控 exit0。唯一安装 `finance.0007_finance_erp_targets`，139→140、目标表为空，只为原财务 reader/writer 增加该配置表最小 SELECT / SELECT+INSERT+UPDATE；原138/139保护回执和缓存不重放、不替换，未导入/补跑或填入目标金额。

后备份 `daily-20261006T020717Z-8e9eb83e2472` / manifest `45e486c21ef2c48b606cec608dedd80e54178f2a1309e94d5ff6ebdd91713c8b`，原 Backup/Verify 实控 exit0。完整前后 manifest/sidecar 在轮换前保全于 `E:\codex-artifacts\bi-production-20261006`，没有复制大型 dump 绕过原三份/两保护策略；前 dump 已由原策略淘汰，不能引用其目录作现存恢复点。

冻结前后完整比较通过：294 原业务表行数与内容摘要一致；唯一变化的原表为 django_migrations（仅增加该一步），新增 finance_erp_targets 为0行。49现有角色属性/设置/成员关系保持；各权威和业务修订保持。目录仅 columns/constraints/indexes/relations/triggers 变化，与新增表、五项约束、三个索引及同事务修订触发器对应；其余目录部分保持。后独立恢复和最终收尾仍须完成。

## 验证边界与失败记录

组合源码72私有PG、10有限门禁、5 BI协议及61原发布控制器回归通过，生产模式构建通过。完整合成库有限追加、故障原子回滚、重复拒绝、最小权限及独立恢复通过，296表/31合成角色保持，26权限负例通过，所有私库停稳；不冒真实生产恢复或全部性能P95。

真实聚合快照的实际组件验证：直接选天猫店铺自动选择天猫，改京东清除原天猫店铺且仅展示京东选项。此处仅为快照交互资格，生产页面仍待恢复后核验。

原第一次 Plan 安全失败：本机 Get-Command git 返回两个应用，原单字符串调用未取得唯一可执行路径；当时没有建立有限追加目录、迁移或授权。修复选择既有 PATH 第一 Git，实际原 native helper 返回exit0、干净输出；新Prepared重新绑定，完整Source/Prepared等价及Plan复验通过。错误记录保留，不覆盖或追认旧失败。

误生成92计划属于性能源，不作为BI采用；旧BI03/2582 Prepared、旧569计划已被具体后继替代，本次未采用。ERP目标金额尚未提供，真实启用后保持“未设目标”，不复制财报目标或按年目标自动摊月。SQL7/RPC8/整体65秒/2MiB保持；未改n8n定义/重启、业务补跑、通知或付费模型规则。
