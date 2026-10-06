# BI 综合经营驾驶舱生产采用：2026-10-06

## 当前阶段

用户明确“合并 main 和发布上线”，随后明确“允许协调”。已与“优化各板块打开速度”完成交接，基于其已采用的五项性能源码 `2f46e1a9` 顺序追加 BI。正式新版已合 main 并采用：Worker94、Django d739、140条迁移。首次真实验收发现的固定HTTP传输白名单阻断已由精确源码 `498b7b18` 修复并受控部署；第二窗口前后备份与独立恢复、Exit及唯一Start均实控exit0，12组件Running/Ready、启动绑定和真实BI业务/页面验收通过。下文保留首次采用和失败记录；当前版本以“传输修复后继实际采用”一节为准。

| 对象 | 实际绑定 |
| --- | --- |
| Worker 前端/服务源码 | `e2c76835`，保留性能组合并修正选店铺自动选择所属平台 |
| Worker/helper release | `20261006T014342Z-94be344898f54a4b` |
| Worker manifest | `6cc16d73391aeef3ca5028b7334474e0b3d29fe48fb9514edd0e52f53f8d9504` |
| 已消费 rotation plan | `e95b1c80649cf13ec604d24a599fde3657c83b23b16a10ae662d48233aa1940a` |
| 当前 Django 源码 | `498b7b18`，仅后端固定拥有方GET传输入口修复 |
| 当前 Django Prepared | `4381a581a87749ceab09be81907f70dc` / receipt `7811d133db69429d7dce253c25398d364c3b7fd2e882b2dfd3cdcd61269b3cfb` |
| 当前 Django installed manifest | `d7394a0e9736eb7378d20f8d1080abfde17ba4aec02981a887a8d7bc97b2464e`，正式deployment.json SHA实读一致 |
| 当前 Django fingerprint | `3081921e811e3fed1c77a0608bb410a143a1712a439d857c4160566606aba380` |
| 当前代码维护 / 首次有限追加 ID | `b3874551f75b2dd8674cb1b861306b0b` / `7a97746dc6cf71882121252cfb2056aa` |

main 已合并并推送业务和维护代码。main 后续文档提交不作为构建来源；Django 与 Worker 采用各自上述精确包，不将 Prepared 或源代码合并冒作启动/业务验收。

## 数据与恢复

原 KeepPostgres EnterMaintenance 实控 exit0，应用排空停稳、数据库及 n8n 原进程身份保持。维护内前备份 `daily-20261006T012139Z-f147c49395df` / manifest `d14b0585211f113728d16558abd3a67f191651d1dd19505b0d708a88e25f3171`，原 Backup/Verify/E55896 独立 RestoreRehearsal 实控 exit0，完整内容、profile及角色/ACL复原通过，临时库清理完成。

原 Plan/Deploy/Harden及有限 Install 实控 exit0。唯一安装 `finance.0007_finance_erp_targets`，139→140、目标表为空，只为原财务 reader/writer 增加该配置表最小 SELECT / SELECT+INSERT+UPDATE；原138/139保护回执和缓存不重放、不替换，未导入/补跑或填入目标金额。

后备份 `daily-20261006T020717Z-8e9eb83e2472` / manifest `45e486c21ef2c48b606cec608dedd80e54178f2a1309e94d5ff6ebdd91713c8b`，原 Backup/Verify 实控 exit0。完整前后 manifest/sidecar 在轮换前保全于 `E:\codex-artifacts\bi-production-20261006`，没有复制大型 dump 绕过原三份/两保护策略；前 dump 已由原策略淘汰，不能引用其目录作现存恢复点。

冻结前后完整比较通过：294 原业务表行数与内容摘要一致；唯一变化的原表为 django_migrations（仅增加该一步），新增 finance_erp_targets 为0行。49现有角色属性/设置/成员关系保持；各权威和业务修订保持。目录仅 columns/constraints/indexes/relations/triggers 变化，与新增表、五项约束、三个索引及同事务修订触发器对应；其余目录部分保持。后E55897独立恢复实控exit0，完整content与profile一致、临时data移除。原Finalize/Exit/唯一Start均exit0；17正式资源逐字节一致，首次新接口ERP200但其三所属来源不可用，失败样本保留。

## 四拥有方GET传输闭合修复

真实来源不可用的确切原因是BI复用的HTTP helper只接原两个POST消费者及运营records GET，模拟opener测试和所属函数投影没有覆盖这个真实路径准入接缝。没有将源失败改成零值或伪称已通过。新独立BI传输入口仅接精确finance8011/workflow8061/inventory8051/netshop8021的四个既有签名GET，HTTP loopback、无body、无proxy/redirect及同一8秒deadline保持；原消费者白名单没有扩展。

修复后77项私有PG与原有传输回归通过，新增真实准入测试覆盖四路径、错误端口/来源/方法及旧入口仍拒绝BI GET。前台用真实已认证本人及仅内存现有HMAC对四个实际reader签名GET，目标、运营、库存和流量均ready，各次仍≤8秒；只保存来源/修订/耗时，不读数据库、不落凭据、不修改业务。后继Prepared及installed绑定见上表。该后继仅改源码，不新增或重复任何140迁移/配置/缓存，Worker94与各保护回执保留。实际采用和验收材料在 `E:\codex-artifacts\bi-transport-production-20261006`。

## 传输修复后继实际采用

第二窗口沿用本轮已有BI发布授权，只部署后端源码498b7b18；Worker94不轮换，不再Install/Finalize或执行迁移。发布前在线备份 `daily-20261006T024930Z-4cc54e4eec2f` / manifest `f8188f3eed693d2f8325be18f919c1f1d6290671e137e131e61b553eb62bbb20`，原Backup/Verify及E55898独立恢复实控exit0，临时数据已移除。完整manifest及sidecar在原策略淘汰前保全；前dump已按策略淘汰，不作现存恢复点。

原KeepPostgres EnterMaintenance、Deploy、Harden实控exit0。停稳后完整冻结证据与后备份逐对象深等价：296表、49现有角色、140迁移及完整profile/evidence全部一致。content `13e3bace8f026e7acfb0577f568afbce2e34586e4c3fca737f17006aff355008`，profile `44381596ca37b63d23557703070e691a2b5b0b77dcfc35c3e29c71f000d9d2be`；没有业务数据、目录或权限变化。

现存后备份 `daily-20261006T034123Z-15a736c2ed50` / manifest `4a870b8d6e17b6e56821de3da66b41ff3a8f56f84719b84c1ee6aceb82406e50`，dump `a5f642396708bbdede35e3d9677a0da04e8686e457a9926b793d436b66d45b55`。原Backup/Verify及E55899独立恢复f22e8cb982d4实控exit0，恢复content/profile一致、productionDatabaseTouched=false、cleanup=isolated_data_removed。原Status确认三份保留、无未决操作；两份历史保护点保留。

原Exit实控exit0（05:52:52–05:53:31 UTC），原唯一Start实控exit0（05:56:33–06:01:44 UTC）。真实Status为12组件全Ready、Worker exact_release；VerifyStartup通过，PostgreSQL与n8n原进程及创建时间一致。实际installed deployment.json SHA复验为d739。

上线后两个不同自然看门狗执行完成通过：06:23:24和06:27:24 UTC，采集时任务Ready、LastTaskResult=0，实际snapshot为Running/Ready/exact_release、12组件及四探针健康，supervisorHealth=healthy、decision=healthy。只是当前基础健康和正式BI限定业务验收；市场被动业务观测unknown不冒该模块业务全面通过，未手动启动看门狗或创建新监控。

真实公开只读验收：本月公司、9月自定义公司、我的事项、流量及旧overview共五项200；三项cockpit目标/运营/库存来源均ready，店铺与吉客云类目净销售合计分别等于同源总额，目标items=[]且年/月均not_set。实际前端严格decoder独立通过3个cockpit＋1个flow DTO，修订header与body一致，flow单一spu_daily。指定样本耗时分别11.312、9.953、4.985、1.343、2.329秒，仅为本次读取，不冒任意范围或P95。

正式页面浏览器核验：实际年/月进度、客单价、待办、类目、库存和广东仓渲染；选天猫店铺自动定位天猫，换京东清除旧店铺且仅四家京东可选；按平台展示后恢复全部平台/全部店铺、按店铺。ERP目标编辑器金额为空，仅打开并取消，未写目标。控制台warn/error为空，正式视口截图及交互证据保存在上述受限目录；不是全页或全部响应式尺寸验收。京东当月流量存在部分日期覆盖，页面保留“部分覆盖”及不可计算比率的“—”，不冒完整来源或去重UV。

验收脚本额外误请求仅支持POST的配置路由GET而无法解析，原失败保留；未尝试写入。按实际cockpit签名拥有方读取复验目标空值，五项已有业务响应和摘要重新校验通过，没有降低业务断言。新JSON证据/源码错误不覆盖首次传输失败。

## 验证边界与失败记录

组合源码72私有PG、10有限门禁、5 BI协议及61原发布控制器回归通过，生产模式构建通过。完整合成库有限追加、故障原子回滚、重复拒绝、最小权限及独立恢复通过，296表/31合成角色保持，26权限负例通过，所有私库停稳；不冒真实生产恢复或全部性能P95。

真实聚合快照的实际组件验证：直接选天猫店铺自动选择天猫，改京东清除原天猫店铺且仅展示京东选项。此处仅为快照交互资格，生产页面仍待恢复后核验。

原第一次 Plan 安全失败：本机 Get-Command git 返回两个应用，原单字符串调用未取得唯一可执行路径；当时没有建立有限追加目录、迁移或授权。修复选择既有 PATH 第一 Git，实际原 native helper 返回exit0、干净输出；新Prepared重新绑定，完整Source/Prepared等价及Plan复验通过。错误记录保留，不覆盖或追认旧失败。

误生成92计划属于性能源，不作为BI采用；旧BI03/2582 Prepared、旧569计划已被具体后继替代，本次未采用。ERP目标金额尚未提供，真实启用后保持“未设目标”，不复制财报目标或按年目标自动摊月。SQL7/RPC8/整体65秒/2MiB保持；未改n8n定义/重启、业务补跑、通知或付费模型规则。
