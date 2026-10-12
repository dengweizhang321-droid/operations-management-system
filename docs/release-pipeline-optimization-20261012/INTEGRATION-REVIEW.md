# 集成复审记录

复审对象：固定五交付、集成代码`529a1b11af92283a20d093d0c758dbce37a6aa01`，以及本轮WP-2规范/审计。协调者对原五作者代码作实际diff/调用图复核；未另调子智能体，不将作者自测当独立运行结果。结论为**允许保留并推送候选，阻断main合并和生产放行**。

| 核查 | 结果与边界 |
| --- | --- |
| 固定来源/依赖 | 五tip与同名origin精确一致，base均b3c6018c；依赖报告固定SHA而非主检出PLAN；按WP-B→CI/可靠性/时序→证据扩展合并，无文本冲突；最新main无增量 |
| 变更覆盖 | delivery diff文件全集列在DELIVERIES.json；WP-B/WP-4无产品代码变化；WP-5仅服务包装器持原Handle、拒null/非零，未改锁/成功JSON；WP-3仅既有离线报告/测试；WP-1 package只新增验证脚本，lock不变 |
| 共享接缝 | safeProcessEvidence已存在base；服务失败文本新标识没有报告消费者解析依赖，不生成重试许可；WP-5成功结构保持；WP-3 source与完整交付2538字节语义相同，WP-5与4968产品/测试相同；WP-1交接修正只在集成分支追加 |
| Windows修正 | GetFullPath规范化两侧、OrdinalIgnoreCase、私有根存在/名称和随机子目录保持；系统Modules不放开用户模块；audit对应确切文件摘要；原10s/120s预算未扩大。云端越过原短名拒绝后在子夹具期限失败，尚未通过整项 |
| CI资源与分级 | 仅审查资源/配置/导入闭包获准；未自动续签审查或跑通配符；明确base/HEAD，依赖配置/未知路径仍全域L3；已审切片通过不覆盖域缺口；L2/L3显式pending与未完成业务适配器保留 |
| 离线报告安全 | 原safeRead、WAL canonical/hash/同批/顺序、receipt/hash/plan绑定、create-only保持；新增字段仅安全投影；timeoutType:null与原exit1不转成功；V2必要验收绑定原passed事件，缺batch digest继续列缺口；historical-observation-only与acceptancePassed:null不能授新鲜现场许可 |
| 稳定规范 | 五轴分别写明；v2 reuse不套v3，v3不支持旧v2 PNG/布尔交互边界；v4恰一次前点/新installed同点恢复、仅原白名单，不能外延到本轮新工具；原Start/gate/迁移/PNR/另批数据恢复保持；其他专题分类正文换成链接 |
| 历史对照 | 依据实际迁移、source/candidate/plan、调用与保障记录，不按标题分类；缺前驱/候选或部署输入明确无法判定；暂停未采用、首次失败、追加修复/采用分别保留 |
| 验证限制 | 本机L0 lint失败/全域缺口；云端PS5子夹具超时/summary dirty拒绝；进程树清理负例在相同环境固定base复现，根因未知；原44项14失败及不安全watchdog旧case不重跑。不能宣称所有检查通过 |
| 生产边界 | 未Status/Panel/维护/启停/部署/Backup/Restore/迁移/调度/业务HTTP/写入/外发；只读原件/绑定/任务CIM核查不等于当前健康；本轮CLI只读封存原件生成独立草稿，不执行journal |

本轮后续只新增规范、报告和编码证据，不改被测执行代码；验证结果绑定代码SHA，不能把旧fingerprint冒充最终文档HEAD的完整通过。最后对新增文档/证据做链接、JSON/原字节、完整分支差异及暂存范围核验。完整阻断和生产候选方案见[统一报告](INTEGRATION-REPORT.md)。
