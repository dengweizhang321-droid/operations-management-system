# P2 统一任务与首场景隔离交付

本分支完成停用任务管理主体、京东志高商用设备旗舰店经营日报的合成隔离演练，以及 `0090_unified_tasks` 的有限158→159结构发布材料。源码已具备审查条件；最终Astra反审由主任务收口。未合入main、准备生产制品、采用控制包、迁移生产库、启用任务、调用真实模型或投递消息。

## 最终行为

- 管理API复用AI writer和真实管理员身份。owner/角色/范围由服务端确定；创建用owner+clientRequestId及稳定原始请求摘要防重，响应丢失后的重试在同事务鉴权后返回原草稿，不因现时资源库/Skill失效重新绑定。
- 草稿冻结Skill精确版本/摘要、模型版本、单店、参数、触发窗口、依赖、漏跑策略和目标。追加revision不可修改；延迟复合FK禁止定义指向不存在的revision提交。保存始终停用；SQL及内部生产派发入口也关闭。
- run冻结原revision、grant和triage规则版本；时点身份跨revision唯一，租约fencing单调，未来时点不能提前领取。Pi关联核专属会话、owner/角色/代际、范围、店铺、模型、Skill、完整指令和参数，不能认领同账号其他会话的请求。
- 原Pi完成只表示报告ready；存在投递目标时保持delegated/pending，原投递回执到齐后才sent/succeeded，unknown/failed单独入账和分诊。观察不发消息、不重放模型。原deliveryId、targetDigest、receiptRef和已终结回执不可替换。
- 首期明确只接受0或1投递目标，应用及数据库均拒绝多目标；多目标逐项协调属于后续扩展。SQL重算冻结目标规范摘要和deliveryId，严格校验回执对象/键集/状态/非空receiptRef，缺字段/null不能伪造成功。
- Incident认领/关闭走CAS，仅拥有者认领、非空说明后关闭；终态与闭合证据不可改。关闭不恢复或重发原业务。详情有白名单证据引用及原Pi evidence读取地址。
- 列表只返摘要，limit<=50及cursor；revision/run/incident均有分页和独立详情。原钉钉任务只读标为legacy-owned，不切owner或复制cron；n8n继续原执行/通知归属。

接口与前端接线见 [API.md](API.md)。最小管理界面由主任务并线交付，本分支不启动浏览器预览。

## 首场景隔离结果

用户已确定首场景为京东志高商用设备旗舰店经营日报。演练用独立PG、合成源/模型/投递边界，真实网络边界被拒绝。ERP销售固定本店，库存另列“全部计入库存的仓”，各自固定日期、字段和revision；缺ERP金额字段时等待且模型/投递均为0。补齐同日新版本后，真实Pi队列和绑定核验经过合成模型，再由实际observer记录报告ready→投递pending→原合成账本unknown；重复时点/观察不重新模型或投递。另有sent回执到齐才succeeded的案例。

结果见 [daily-scenario-result.json](daily-scenario-result.json)。合成账本不是生产准入或真实投递证明；真实ERP/库存依赖读取适配、跨端principal/目标绑定、长期费用授权及生产执行器均未采用，缺口明确显示等待/未就绪。

## 验证与证据

| 检查 | 结果 |
| --- | --- |
| 核心及首场景独立PG | 15项通过；`.runtime/ai-pg-0f36a32c4085/tests.log`，包括raw writer坏回执及单目标拒绝 |
| 资源库失效后的创建重试 | 定向1项通过；`.runtime/ai-pg-a139ebae2e60/tests.log` |
| 158→159结构/ACL | 7类通过，旧行/ACL保持、新表为空、原生FK禁用拒绝、已提交159不重放；[structure-result.json](structure-result.json) |
| PS5/PS7有限控制器 | 各33项通过；[ps5-native.json](ps5-native.json)、[ps7-native.json](ps7-native.json)，未做完整服务冷启动 |
| Node直接影响编排 | 153项通过；`node-targeted-final.log`；本代显式AI provision、不触发Pi镜像升级、失败不finalize或重放 |
| 静态ACL/OWNER | 87项契约及冻结OWNER检查通过 |
| 冻结源码必需检查 | Python90文件、Node5文件、PS5/PS7各11文件、迁移/模型闭包通过；[ai159-execution.json](ai159-execution.json) |
| recipe真实算法绑定 | `gate.code_digest(root)` 111成员；[schema-bindings.json](schema-bindings.json)通过 |
| 本次TS语法 | 16文件通过；[changed-typescript-syntax.json](changed-typescript-syntax.json) |

全仓TypeScript有168条既有诊断，诊断文件均无P2差异；backend-boundary仅报既有天猫到吉客云预检引用，相关源文件均无P2差异。原日志与范围证明见 [existing-check-limitations.json](existing-check-limitations.json)，两项未冒称通过。首次隔离迁移RunPython放置错误及开发期Node未登记资格的失败日志保留，没有覆盖成成功。

## 结构与采用边界

五表definition/revision/grant/run/incident和一个guard函数由新0090创建，未改写历史migration、回填、登记旧任务或创建真实授权。有限addition/catalog/candidate、recipe、PrepareApp复制清单、原生入口/启动gate、备份结构清单、AI provision、CI recipe和候选控制器源码资格均已接线。Install只核owner-only，ProvisionRoles后writer受限授权、reader零授权；未知安装只协调原状态，不重放DDL。

当前源码与计数见 [FINAL.json](FINAL.json)。本代结构控制包、应用制品及生产前驱绑定尚未准备/采用。合并其他任务若修改111成员或supplemental源文件，须在最终组合的干净冻结树重跑 `run-mandatory-checks.py`，只更新本代recipe/执行材料，不刷新祖代历史recipe。用户未授权本任务main合并或上线。
