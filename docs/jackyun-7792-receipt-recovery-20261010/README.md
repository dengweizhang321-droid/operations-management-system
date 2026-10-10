# 吉客云 7792 已提交销售回执与组合装续导

本工具是用户在本次对话明确要求“执行处理销售回执收尾和组合装续导”后的单次维护入口。只处理 `n8n-export-first-7792`，不修改已发布 helper、工作流定义、调度或数据库结构。原 n8n execution 保持 `error`；维护完成与原工作流全自动成功分别记录。

## 精确现场

- 工作流 `J8kY2mQ5vR7sT4pN`，手动执行 7792，上海时间 2026-10-10 09:49:59.392–09:55:29.884。A/B/C 成功，D 报“Django 销售服务暂时不可用，请稍后重试。”，E 未执行。
- n8n 正文 SHA-256：`e22cddb0dbc8a4b5817e1ad7bd6f4de46fd4ecd2887f56b755373a36abaf9b32`。
- 原销售文件已在服务端完成发布，批次 `2144b5de068d68c25845745e59f9512ff843951709bd7032e4909fa5d1b0c782`，38,574 行，覆盖 2026-08-26–2026-10-09；处理后原文件 SHA 为 `6b0b87c26042e17548c8f74a72e04fb5aadd6fbe7f99d1f47319fb84851f302b`，9,121,487 字节。
- 原上传会话 `c47722e2b62a42b282c974488286f6ce` 仍为 processing；唯一规范化会话 `f21d4ff7-899f-48ee-a5ae-c492f0b2a285` 已 completed。原销售 HTTP 等待结束后，finish 清理与正在提交的事务发生行锁等待超时；销售批次最终在 09:55:41.399874 完成。
- 当前货品、库存、库龄三个正式前缀已有完整回执。销售只有失败审计，组合装没有本轮正式导入记录；五表原始文件与 C 演练记录均保留。

## 操作边界

1. 只读证明使用原 sales writer 身份读取其自有上传协调表，但连接强制 `default_transaction_read_only=on`，只输出状态、日期、计数和摘要，不输出数据库凭据、actor、owner token、分片内容或销售明细。
2. 必须验证唯一原上传、原始分片完整 SHA、唯一已完成规范化会话、精确销售批次及原操作者；未超过原 30 分钟失活门槛的 processing owner 不得接管。
3. plan 在原吉客云全局锁和 helper 空闲条件下，核验原 n8n 错误、活动计划、所有原文件、五表 prepared 契约、三个已完成批次、销售实际归属行数/日期/白名单/成本源，以及当前销售和组合装版本。只读证明必须新鲜，方案限同一上海自然日且 30 分钟内。
4. apply 再核验同一方案摘要并先 create-only 保存尝试和原失败前像。仅对已证明 completed 的规范化会话调用原 `/api/imports/sales/chunks` 的 `complete`，不重新上传分片、不创建新导出。原服务对 completed 规范化会话直接返回原批次；之后原 finish 路径完成上传回执。
5. 精确 API 回查通过后补记本地销售成功审计和处理登记，明确标记为已提交批次回查恢复。原失败 child/parent 审计和计划/manifest 保存在 `outputs/jackyun-export-first/receipt-recoveries/7792/`。
6. 组合装使用原 `runJackyunDownload`，严格复用本轮 handoff、原文件与正式模式，保留原关系数、内容幂等和回执门禁。最终仍调用原五批次权威回查器，全部通过后才将逻辑计划记为 completed。
7. 任何网络结果未知、文件/来源变化、重复或并发 apply 均停止，不自动重放。创建过 attempt 后不重复 apply；需先核验该次实际效果。不得把此入口套用于其他 execution、日期或批次，也不得删除 active 或伪造 n8n 成功。

## 命令

从本次已审查的独立工作树执行。脚本用原受保护的 DPAPI 入口在进程内载入数据库口令，只交给只读证明子进程，随后恢复进程环境。方案与回执存放在独立 incident 证据目录。

```powershell
.\tools\jackyun-7792-recovery.ps1 -Mode plan -ProposalPath 'D:\codex-artifacts\jackyun-7792-receipt-recovery-20261010\proposal.json'
.\tools\jackyun-7792-recovery.ps1 -Mode apply -ProposalPath 'D:\codex-artifacts\jackyun-7792-receipt-recovery-20261010\proposal.json' -ApprovedSha256 '<plan返回的精确摘要>'
```

执行后再以只读证明确认上传 completed、原销售批次保持，并核对五个实际批次、告警、日期和资源收尾。恢复工具不修复通用的销售长请求超时；该问题需要另行开发验证，不能通过放宽本次恢复门禁掩盖。

## 验证

专项覆盖精确 n8n 身份、跨范围/未提交/新 owner/过期证明拒绝、文件/行数/成本源/日期漂移、失败前像保留、单次 complete、组合装顺序、未知响应停止及重复 apply 拒绝。既有 5478 恢复回归同时执行。真实 plan 仅做只读取证，不等同于生产续导成功；实际结果见[恢复结果](PRODUCTION.md)。

使用本次实际销售源/输出的隔离副本构造恢复审计，原 `verifyJackyunModuleArtifact` 已核验原 handoff、输入契约、文件字节和精确批次通过；生产原文件没有修改，临时 XLSX 副本已清理。原始失败正文和字段继续保留，不能将补记回执描述为原 HTTP 请求成功返回。
