# 第二轮交付与生产采用

本轮代码已于 **2026-10-15T05:29:25+08:00** 完成受控上线。用户在本聊天明确授权合并主线并发布；候选 Prompt、模型切换、真实模型实验、自动人工审批和批量正式入库不在本次采用范围。

## 提交与制品

代码提交 `028804a43bde2598e34c8a2b2668bf014f2e3f6e` 已推送并快进合并远端 `main`。以已采用生产来源 `86fa943d…` 组合本轮受测应用增量及已合并的一行工具文档注释，形成 `d3c664cd18ada5eaf6a5a1d376e4681db47919ca`；应用九文件逐SHA等于受测主线，保留其他生产功能原字节。制品绑定该精确组合来源，未顺带采用main的其他未上线变化。发布证据及导航另作仅文档收尾，不重建有效制品。[准备绑定](evidence/publication-prepared-artifact-binding.json)保留准备时published=false原件，实际采用由publication-result的deployed记录确认。

| 制品 | 实际采用绑定 |
| --- | --- |
| Worker release | `20261014T202834Z-1943995b435ba5c7` |
| Worker manifest | `f1e8c5a67790535092afdbfd5063f74a3e2918e6b10a19612e914940a5a9639e` |
| Worker批准plan | `3475f5b7b1a7c267da78e08fa19f028d385f918a0f7bd2373c1b444056f31736` |
| Django prepared ID | `722fdc383e98498f898e135b5d10edbb` |
| Django receipt | `e0b6e8892565c88672f56ce3ea4e8480374127821b8bba2e33ad4d5a10686f96` |
| Django deployment manifest | `79a9d21add467114cc54149e233f6e5310953f3f306b462540c537d8b9ecf10b` |
| Django应用指纹 | `276566a88a3c07b08ee74e036b7532e179032699f55a3ff1a432e9ec0cebecf0` |

工具注释使范围升级为完整Worker+Django组件流程；无migration字节变化，未执行生产迁移、恢复演练或新增模型调用。复用已验证的当前备份，不重复备份。主工作区既有改动保留；原工具注释字节最终经原apply安装为用户保全的精确SHA。来源与受保护入口恢复由[发布独审](PUBLICATION_REVIEW.md)核验。

## 实际发布与原未知回执

首次EnterMaintenance于04:50收到unknown，未据此重发或停止服务。原失败原件保留；原PID29268退出、原Worker receipt/PID创建身份/full lineage、全12入口含activation fence/发布链、旧Django指纹均未变，两个持久门禁及同维护ID的Cancel/End审计不存在，后续Stop/Deploy/apply未调用。结合原源码“排空gate先持久写入，异常不删除，Stop在其后”的契约，独审闭合为failed_zero_effect；历史底层异常无法精确倒推，不将mutexbusy线索当已证根因。

同一维护ID在新rotation lease内重新CAS后，仅续接一次Recovery1。零等待mutex探测曾观察busy，等待自然释放；未中断原日常操作。实际顺序为原EnterMaintenance KeepPostgres成功、Stop、精确prepared DeployApp、HardenAcl、原批准plan apply、同ID ExitMaintenance、Start和VerifyStartup。原完整门禁未放宽，调用与阶段证据仍由原控制器产生。见[原失败](evidence/publication-original-maintenance-failure.json)、[零效果协调](evidence/publication-reconciliation.json)、[实际采用](evidence/publication-result.json)。

## 完成判定与业务边界

原发布入口确认Worker有效head和manifest切到上述候选，Django物理manifest及三市场业务文件匹配受测摘要；普通权限运行，首页HTTP200，受控启动绑定验证通过，PostgreSQL全程保持。该结果是本次部署成功和必要服务可用核对，未追加综合验收。

目标任务在上线前已自然完成；上线后仍为cloudRun completed / job review_ready，总计8558，完成8481（新模型8434、历史复用47），失败77，在途0，人工复核0、正式入库0，共享并发12。原26项全部failed且attempt>=3，无租约、恢复后无新审计；全部26行完整内容SHA及任务计数与发布前完全一致。见[发布后只读回读](evidence/publication-protected-after.json)。没有重置或重放旧unknown。

P0、可信人工无价复用与有界批量计划创建代码已经上线。正式字典、任务绑定Prompt、模型保持原策略；P1具体分类取舍和候选Prompt采用仍待业务确认，不能把500条模型无价当金标。P2隔离创建收益和模型持续吞吐分别报告，本轮无真实对照或人工金标，不能宣称业务准确率或模型提速通过。完整收益与限制见[总报告](REPORT.md)。
