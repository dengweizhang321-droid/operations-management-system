# 京东客服工作流四店扩展

2026-10-08，按用户要求，以已采用的志高商用设备旗舰店客服工作流为基准，补齐切肉机、商用厨电、商用洗碗机三店的工作流定义及必要的店铺隔离。当前为完成开发和隔离验证的候选，尚未导入正式 n8n、上线新版 Worker/helper、逐店真实下载导入或发布启用。设备店原正式工作流保持。

## 工作流与条件

| 店铺 | workflow ID | storeKey | 注册 Profile | 定义 |
| --- | --- | --- | --- | --- |
| 志高商用设备旗舰店 | JdCustomerService2026 | jd-yiyong-director | Default | [原正式定义](../../automation/n8n/jd-customer-service-daily.workflow.json) |
| 志高切肉机旗舰店 | JdCustomerServiceCutMeat2026 | jd-maidehao-operator1 | Profile 2 | [新增候选](../../automation/n8n/jd-customer-service-cut-meat-daily.candidate.workflow.json) |
| 志高商用厨电旗舰店 | JdCustomerServiceChudian2026 | jd-chudian-weizhang | Profile 1 | [新增候选](../../automation/n8n/jd-customer-service-chudian-daily.candidate.workflow.json) |
| 志高商用洗碗机旗舰店 | JdCustomerServiceDishwasher2026 | jd-cuizhiwang-dengweizhang | Profile 3 | [新增候选](../../automation/n8n/jd-customer-service-dishwasher-daily.candidate.workflow.json) |

三份候选逐节点从设备店正式定义生成。均使用 Asia/Shanghai、每天09:00、截至昨天滚动30天；先固定本轮时间，领取同一共享 JD helper，未领取时按原5分钟等待循环排队。A固定范围、B双视图导出并按日校验导入、C独立复验精确批次；HTTP超时仍分别为领取10秒、A120秒、B1800秒、C600秒，节点 retryOnFail=false。不因排队或跨日重算原范围，不建立无条件业务重放。

执行逻辑复用原全局Chromium锁、DPAPI登录、唯一页头身份核验、提交前持久状态、双文件来源校验、分天完整业务值等价、文件预算及精确批次回查。验证码、身份异常、导出或导入未决仍立即失败关闭。第4次独立失败AI介入及本人单聊通知的条件保持；原ai-2当前仍只监控设备店，新增ID纳入监控和分店账本是正式启用门槛，本次没有提前更新或发送通知。

## 必要实现

- 新增固定四店身份目录，与原 `config/jd-store-accounts.json` 的名称、编号交叉验证；浏览器配置继续取原注册表，不复制账号凭据或改Profile。
- A/B/C请求增加 `X-TERUISI-JD-CUSTOMER-SERVICE-STORE-KEY`。A固化店铺，B/C要求同一execution及同店头；未知、空值、多值和跨店头拒绝。旧设备店无该头仍按原默认身份处理。
- 计划保存storeKey、shopId、shopName；新三店的active、planning锁和计划位于 `outputs/jd-customer-service-pipeline/<storeKey>/`。设备店继续使用原目录，无须搬迁原计划。同店未决阻止新execution，另一店保持独立。
- 导入、回执和历史回查都使用固化店铺。原交互导入对“志高厨电”客服前缀的推断保留；带明确storeKey的自动导入验证规范店铺后保留该店铺名称，避免厨电店被归入旧名称。管理员和无限制数据范围门禁保持，Django客服写入及幂等实现未改。
- 下载继续使用各店原下载目录下的 `customer-service/<executionId>/`。没有新数据库迁移、事实回填或登录配置变更。

重新生成三店候选：

```powershell
node --import tsx tools/generate-jd-customer-service-store-workflows.ts
```

生成器不改设备店定义；所有交付JSON为inactive，防止在旧helper仍固定设备店时误执行。

## 验证与审查

- 客服与登录专项50项全部通过，包含真实Worker POST在合成资料下的四店显式绑定、旧交互推断兼容、矛盾身份零写入、四店页头交叉拒绝、同店并发和跨日未决、跨店active/计划/回执拒绝及三份定义逐节点等价。
- 使用本机实际安装的n8n引擎，在独立用户目录和SQLite元数据库、合成回环HTTP服务中完成6个场景：三店完整A/B/C成功，以及A/B/C分别失败并停止。均固定同一时间和execution、每业务阶段只调用一次；没有访问正式helper、浏览器、数据库或通知端。
- 最终生产构建通过；全仓lint为0错误、28条既有警告；最终改动文件专项lint通过。Django生产边界检查645模块、0违规；差异检查通过。
- 全量unit首次尝试存在10项失败，未形成最终全仓完成汇总，停滞后的本任务测试进程已精确清理。补齐本任务独立Python测试环境后，4个文件46项协议验证及3项推广SKU导入验证均通过；财务浏览器交互1项和Windows受管进程1项独立复验通过。不把环境准备后的通过倒写为首轮通过。
- 剩余 `module-performance.test.ts` 的销量/库存静态请求数断言 `2 !== 1`，在原封不动的main `982484bf` 独立工作树复现；不修改与本任务无关的页面来迎合旧静态断言。TypeScript全仓185条诊断与该main逐字相同，本次相关代码无新增诊断；不宣称全仓类型检查通过。
- 本轮自行复核共享helper阶段与店铺绑定、原设备店状态兼容、显式导入门禁、路径隔离和未知提交保留。没有启动子智能体。

原始测试、构建及n8n证据保存到 `E:/codex-artifacts/jd-customer-service-four-stores-20261008`；仅包含源码/合成执行/检查输出，不含原客服资料、登录态或业务密钥。隔离n8n成功场景不替代京东真实逐店验收。

## 正式采用方案与恢复边界

待用户授权后，按[开发与交付](../规范/开发与交付.md)和[验证与发布](../规范/验证与发布.md)执行：核验当时正式前驱和共享helper空闲，按既有备份/恢复与唯一生命周期入口采用新版Worker/helper及显式导入API；其他领域和数据库版本保持。再将三份候选作为inactive草稿导入正式n8n，逐店进行完整手动下载、导入、源文件/派生文件SHA、精确批次和店铺归属回查、浏览器及锁收尾。未通过的店铺保持inactive。

扩展原ai-2监控的正式workflow ID和分店逻辑任务/范围账本，保持每10分钟只读、第4次独立失败介入、危险未决立即停止、动态核验本人及志高助手、本人单聊及未知投递不重发。监控接入及真实完整验收通过后，才将对应三店发布为每天09:00；回读active/current/published及Asia/Shanghai cron。设备店调度无需更改，四店并发触发由原helper排队串行。

采用失败时通过原生命周期恢复前驱应用，三份新增流程保持或恢复inactive。已发生的真实导出/导入及未决状态保留，不能靠停用、回滚应用、删active或自动重放来撤销/掩盖业务效果。本次不消费任何旧发布计划或历史维护授权。

源码提交并正常快进推送远端main；交付不等于正式采用。开发工作树保留为候选构建与后续受控采用来源，待采用材料保全、无进程依赖后按规范归档并清理分支。
