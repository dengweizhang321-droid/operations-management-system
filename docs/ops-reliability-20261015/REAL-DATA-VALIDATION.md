# 四源真实文件端到端复验与发布状态只读核查

2026-10-15。此前“没有用户新提供文件”的阻碍已解除：沿既有交付回执找到了四份原件，已完成只读复制、重新解析、RAM投影及交付HTML验证。当前源码为5146cc3d7795b62d9fdc173573f7892a2f372019；所用11个解析/库存/离线核心文件与交付提交081a8562bf48ebe78251181cfca31bf043efeee3无Git差异。

## 来源与归属

手动周期的delivery-receipt.json不直接列原始路径，只绑定HTML SHA及内嵌源快照SHA。原始路径经real-snapshot.json的provenance和jd-inbound-real-20261015/source-manifest.json追溯。本轮校验HTML、快照、四源原件及副本SHA，重新解析逐行等于既有parsed-verified.json，没有用旧摘要替代重读文件。

事业部：佛山市亿用电器科技有限公司；业务单元EBU4418046540089。实时库存和流水原文件含事业部列，已按解析规则匹配；库存快照及店铺商品缺该列，使用既有导出记录中已声明的同一事业部。后二者没有新的登录页面或原始事业部列独立证明，本轮不将声明归属说成原件自行证明。

| 来源 | 原始文件绝对路径 | 行数/业务日期 | SHA-256 |
| --- | --- | --- | --- |
| 实时库存 | D:/谷歌浏览器/仓储-实时库存监控明细表2026年10月15日-20261015153812269-志高亿用-总监.xlsx | 427；2026-10-15 | c5e6e2f976ab0c30af2e5476afdcfc3967b2efa9515b243675beff6a5ff1824a |
| 库存快照 | D:/谷歌浏览器/仓储监控-库存快照监控_分仓_2026.10.14-2026.10.14-20261015152749478-志高亿用-总监.xlsx | 900；2026-10-14 | b20dd3bc4cd18008d2bf81839b2b4e1c0d42882d6571abd0e89b54f3851a0a65 |
| 店铺商品 | D:/谷歌浏览器/店铺商品列表单据导出_20261015161325.csv | 906；2026-10-15导出 | ebde8b0e7f7329f91f23e77e9f4a1e944f3dd25e2e730d42fbd874b706eb0175 |
| 库存流水 | D:/谷歌浏览器/stock_flow_志高亿用-总监_20261015162812.csv | 122；2026-10-14 | 1d5b92b755c5b8ad59d0fea6d0784c9398e35fdb5146540ccf4b21301de4bf74 |

实时采集时刻为2026-10-15T15:38:12+08:00，快照采集时刻为2026-10-15T15:27:49+08:00，快照截至10月14日，符合本系统T/T-1日期配对。范围仅限这四份报表，不代表正式系统已经同步到这些日期。

## 本轮实际完成

1. 四份原件可读；原件与隔离副本SHA全部匹配回执链，副本设为只读。规范化行完整一致，保留编码、原始列、重复流水、负数及未知值。
2. 现有生产器在清空业务连接环境、阻断网络、SQLite内存库下完成2355条来源事实的投影；独立批次校验确认4个file_snapshot批次的来源种类、原文件SHA、行数、确定性ID和RAM事业部一致。这里是RAM文件快照批次，不是正式导入批次。
3. 输出139商品、901仓项、19源列；901仓项的1–3650周期数量共3,288,650值编码往返一致，19,629成员组完成550,050组数量/健康断言、9,010个实际领域reader仓项比对。没有把生成的71,645,850成员数列值全部声称为逐值独立业务验收。
4. 新RAM快照与交付HTML内嵌数据完整对象一致，严格仅排除options.departments[0].updatedAt这一RAM创建时间字段；原件及副本内容摘要在验证后不变。
5. 在已交付HTML的本地副本上复用现有程序DOM检查：720组仓库/周期/健康/搜索组合通过；35、42、1、3650天输入、非法值拒绝、保留筛选及回第1页、完整分仓与汇总一致均通过，脚本错误0、实际写入0、外部请求0。没有启动用户电脑浏览器或服务。

制品SHA仍为6c46cf3842c3a2af4f428e51e4ad5235ca7f05781a34cbbe04eb1faae0630f58；HTML内嵌快照SHA为e77cfa50532592cfec623cb3581451d3265d24828a492f875b25925c6b668ab2。

本任务外围夹具保留两次失败：首次将socket类替换为函数导致SSL导入类型错误，改用阻断连接的子类后投影器全部内部断言完成；随后外围末尾把Path(':memory:')直接与字符串比较，导致整体进程exit1。原失败不改写，另外使用str规范化和PRAGMA空文件路径的独立RAM校验确认4批次/2355行，exit0。未因此修改业务源码，也没有把原exit1改记为成功。

## 其他任务的正式发布状态

只读观察记录见本工作区.runtime/real-e2e-20261015/publication-observation.json，初次最终截点为2026-10-15T15:54:47.142Z：

- READY.json确认候选准备完成；PUBLICATION_STARTED.json为15:45:19.706Z，说明已经进入真实发布，不能继续泛称“尚未开始”。
- Stop-result.json在15:49:00.485Z记录exit0。PUBLICATION_FAILED.json在15:49:00.487Z记录SchemaPlan参数解析错误“Invalid approved script parameter value”，automaticRetry=false。
- 15:52:46.242Z的independent-schema-plan-zero-effect.json证明失败SchemaPlan在原生进程调用前拒绝，原Worker/Django仍为前驱，无该JD操作目录/active及后续阶段标记；该回执同时记录维护已排空停止。此“失败阶段无原生效果”不等于整个发布未产生维护/停机效果。
- 已出现resume1.mjs及传输修正/独立核查材料，但材料存在本身不能证明续接已执行或成功。该截点没有PUBLICATION_RESULT.json，故不能确认已上线、0012–0014已完成或新角色权限已采用。
- 不调用发布、恢复、迁移、角色配置、服务启停或HTTP业务探针；正式状态可能继续被其他任务推进，以有时间绑定的最新成功回执为准。本任务没有继承仓库文档中的上线授权。

## 仍未完成与限制

- 未执行生产导入、真实PostgreSQL事务/角色/权限/迁移、生产数据回查或生产功能验收；不能由RAM/HTML等价性推断正式系统已拥有这些事实。
- 缺少新鲜独立证明的事业部声明仍按上述范围披露；ERP映射、ERP单据、正式配置、缺货提醒和正式批次不从运行系统读取或编造。
- 流水原件只有10月14日业务范围，不能验证其他日期或不存在的调拨闭环；真实文件中的缺失值继续未知。
- 程序DOM不是浏览器视觉验收。本轮没有新开发、生产构建、Git提交或推送，只快进本任务既有隔离分支并保存私有验证材料。

## 实际可复用路径

- 原始来源清单：D:/codex-artifacts/jd-inbound-real-20261015/source-manifest.json。
- 历史规范化输入（仅供校验，本轮未覆盖）：D:/codex-artifacts/jd-inbound-real-20261015/parsed-verified.json。
- 已交付HTML：D:/codex-artifacts/jd-manual-cycle-20261015/京东入仓监控_手动周转周期.html。
- 本轮隔离只读输入：C:/Users/86137/Documents/Codex/2026-10-15/task/ops-reliability/.runtime/real-e2e-20261015/input/。
- 本轮重新解析：同上私有目录的parsed-input.json；新RAM投影：ram-snapshot.json。
- 只含摘要/计数的证据：source-validation.json、ram-projection-verification.json、ram-batch-validation.json、e2e-equivalence.json、html-runtime-verification.json、publication-observation.json；全部文件SHA索引为evidence-index.json。原始业务行不进入Git或长期记忆。


最终只读回执复核：2026-10-15T15:56:46.149Z；PUBLICATION_RESULT存在=false；按成功回执确认上线=false。本轮不等待或接管其他任务的后续操作。
最终截点另见Resume1SchemaPlan-started.json（2026-10-15T15:56:27.675Z）：其他任务已开始第一次SchemaPlan续接，仍未出现PUBLICATION_RESULT成功回执。
