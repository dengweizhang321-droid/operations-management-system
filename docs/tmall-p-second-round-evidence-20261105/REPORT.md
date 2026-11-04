# 天猫 P 第二轮中断取证（2026-11-05）

结论：11192（马思图）与 11193（炊之王）均完成第一轮 P 和 N，再在第二轮 P 返回同一句 `waiting_login：阿里妈妈需要人工验证或凭据被拒绝，停止自动登录`。现存记录没有保存当时三项标志或 frame 命中证据，**具体命中项及其原因未定**。不据此修改登录判据、回环连线、失败续接或现有保护。

本次为只读历史诊断与资料交付。执行方案为主工作区 `docs/autoimport-workflow-unification-20261029/codex-提示词-推广回环断裂.md`（306 行，SHA256 `C8F0B43D42A8D904CE1985199217F24407AF09030D112DDE69C24F37FA79CDD3`）。该方案允许证据不足时交付未定结论。

## 取证来源与边界

- 只读 SQLite：仅精确 execution 11192/11193、对应两条 workflow 及其 active 历史；连接使用 `mode=ro`、`PRAGMA query_only=ON`、2 秒 busy timeout，结束 rollback/close。两条 flatted 原数据先完整解引用，之后只输出白名单摘要；数据原文约各 15 KB，没有复制数据库或输出原始 HTTP 正文。
- 本机现存文件：两条精确 active、两条首轮完成归档、各 execution 的 cycle 0/1 四条 backfill 审计，共 8 个小文件。脱敏摘要及原文件 SHA 见 [audit-evidence.json](audit-evidence.json)。未读取其他店铺原始业务文件。
- 现行源码：本任务从 fetch 后 `origin/main = ece8c7ec46ac7bd7dc0a5a3e3eed8fcf065d3b65` 建独立 worktree；相关八份源文件摘要已记录。源码用于解释当前相同文案的分支，不冒充历史 helper 制品绑定。
- [execution-evidence.json](execution-evidence.json) 保留两店精确节点时长、业务日、覆盖返回、失败及资源关闭摘要。记录中数据库时间为 UTC；下表已换为 Asia/Shanghai。没有重新查询当前业务库，所有导入/覆盖陈述均指当时 execution 返回与现存审计，不能当成今天独立业务回查。

脱敏提取脚本保存在任务私有证据目录 `D:/codex-artifacts/tmall-p-second-round-evidence-20261105/inspect-evidence.py`，供独立复核；未纳入应用代码。原始凭据、账号、Cookie、完整 URL、平台响应正文、页面全文、任务 ID 和文件本机路径均未写入交付 JSON。

## 逐店执行事实

| 店铺 / execution | 入口与终态 | 上海开始—停止 | 总时长 | 首轮业务日 | 第二轮业务日 |
| --- | --- | --- | ---: | --- | --- |
| 马思图 / 11192 | webhook / error | 11-04 23:53:01.204—23:54:08.864 | 67.660 秒 | 2026-10-28 | 2026-10-29 |
| 炊之王 / 11193 | webhook / error | 11-04 23:53:02.096—23:54:09.015 | 66.919 秒 | 2026-10-29 | 2026-10-30 |

| 节点 | 马思图 11192 | 炊之王 11193 |
| --- | --- | --- |
| A | success，15.250 秒 | success，15.369 秒 |
| B 第一轮 | success，0.031 秒，0 行 | success，0.029 秒，0 行 |
| C 第一轮 | success，0.047 秒，空 dates，coverageConfirmed=true | success，0.132 秒，空 dates，coverageConfirmed=true |
| P 第一轮 | success，34.595 秒；10-28 imported，20 行，0 告警，coverageConfirmed=true | success，34.556 秒；10-29 imported，45 行，0 告警，coverageConfirmed=true |
| N 第一轮 | success，0.673 秒；completedDates=[10-28] | success，0.452 秒；completedDates=[10-29] |
| 还有缺口？ | success，0.002 秒，进入第二轮 | success，0.011 秒，进入第二轮 |
| B 第二轮 | success，1.696 秒，59 行 | success，1.734 秒，73 行 |
| C 第二轮 | success，1.552 秒；10-29 imported，59 行，coverageConfirmed=true | success，1.539 秒；10-30 completed_with_warnings，73 行，coverageConfirmed=true；不能称零告警 |
| P 第二轮 | error，12.001 秒；下述统一错误 | error，12.170 秒；下述统一错误 |
| N 第二轮 / M / 最终补齐判断 | 未执行 | 未执行 |

两店第二轮 P 的 `error.description`、helper 失败载荷、active.error 一致，均为：

`waiting_login：阿里妈妈需要人工验证或凭据被拒绝，停止自动登录`

失败载荷均含 `browserClosure={ok:true,status:"closed"}`。这是当时 helper 返回的关闭结果；本次未启动或连接浏览器，也未以当前端口状态替代历史所有权证明。

最后一次 N 的剩余缺口：马思图 10-29 至 11-03，炊之王 10-30 至 11-03。第二轮 C 已返回该日商品导入/覆盖成功，但 P 失败后的 helper `dailyBackfill` 仍是 N 之后的状态，里面 `missingProductDates` 未再次刷新。因此这些数组不能直接视为第二轮 C 后的精确实时缺口，也不能将本轮写成“全部补齐”。

## 首轮与第二轮的上下文并不等价

首轮完成归档保留旧 runId 与旧 startedAt：马思图 `ac4515fe…` 始于 11-03 11:40:42.299，炊之王 `32e858cd…` 始于 11-03 11:31:36.981（均上海时间）；分别在本次 execution 的 11-04 23:53:52.547 / 23:53:52.663 更新为 completed，并含 taskId、file、importResult。

这证明首轮沿用了已有审计身份，不能把首轮成功解释为“本 execution 已完成一次全新的登录与新建报表”。归档最终状态没有保留首轮入口时的完整阶段快照，故不能仅凭它判定首轮是否已经持有本地文件、是否跳过了 `openPromotionPage`，也不能断言第一次与第二次 `inspect` 看到相同页面。

第二轮 active 均为新 runId，startedAt 同为 11-04 23:53:57.047，updatedAt 同为 23:54:08.180；`stage=failed`、`resumeStage=planned`，无 taskId、file、importResult。按现行 [runDirectPromotionDate](../../tools/tmall-direct-promotion-export.ts) 的顺序，这与 `session_ready`/建任务前的身份等待失败一致。没有第二轮已新建报表或已推广导入的证据。原 active 字节未修改。

## 可以解释到哪一步

现行 [tmall-alimama-login.ts](../../tools/tmall-alimama-login.ts) 第 58—60 行检查 `challengePresent || credentialRejected || temporarilyLocked`，随后抛上述统一文案；第 102 行 attempts 保护的文案不同。因此**按当前源码解释，错误属于三项聚合的分支，不能进一步区分哪一项或几项命中**。12 秒包含导航、身份等待及收尾，不用于证明具体循环次数、命中时刻或触发原因。

[tmall-saved-login.ts](../../tools/tmall-saved-login.ts) 第 164—184 行按所有 frame 合并三项；challenge 可来自 body 文本、可见 iframe 或可见 input，拒绝/锁定也取 body 文本。源码确实允许普通业务文案误触这些文本规则，但“允许存在此路径”不证明本次走了该路径。真实验证码、拒绝/锁定、嵌套 frame 命中与业务文案误判均仍为候选假设。

两条精确 execution 原数据内 `challengePresent`、`credentialRejected`、`temporarilyLocked`、`frameIndex`、`ruleId` 字段名出现次数均为 0。P error 没有成功输出 data；其 helper 失败载荷只有统一错误、关闭结果及旧 backfill 状态。两条 active 的字段集合也没有逐 frame/逐规则诊断或页面快照。该限定取证范围内没有历史触发快照，不能还原当时命中项。

现行 [discoverTmallAlimamaIdentifiers](../../tools/tmall-direct-promotion-export.ts) 第 323—342 行在进入/重载下载列表后调用身份守护；静态路径值得下次自然失败时观测，但本次没有页面 URL/frame 快照，不能认定具体导航分支。

## 实际版本可以核到的程度

| 对象 | 本次可核事实 | 限制 |
| --- | --- | --- |
| 马思图工作流 | execution_entity / execution_data 版本均为 `aebe3c0c-590d-445c-91a2-cb53471527c6`；当前 current/activeVersionId 相同，active=true | 版本元数据不包含 helper 制品指纹 |
| 炊之王工作流 | 两处执行版本均为 `a50decc9-91a3-40ff-b872-84c846892d39`；当前 current/activeVersionId 相同，active=true | 同上 |
| 保存执行图 | 两店均 18 节点；connections 与当前、active 历史及仓库 gap-loop artifact 精确一致；P 未配置 onError/retryOnFail | saved nodes 与当前/历史不是字面全等，差异路径见 JSON，不能声称全定义逐字一致 |
| 当前仓库 artifact | saved nodes 另有说明内容差异；saved settings 与当前一致，但相对仓库有 `/timezone` 差异 | 不将这些差异归因为此次登录错误；未导入/重生成工作流 |
| helper 源码 | 读取并摘要 main ece8c7ec 的八份相关源码 | 本组执行/清单未包含当时 helper release/source SHA，未扩读生产运行目录；无法独立证明历史执行字节就是当前源码。上述抛点定位有此边界 |

因此不将“文案匹配当前唯一分支”写成历史二进制已经完整绑定，也不以当前 main 的新时区规则倒推旧 execution。

## 本次处置与后续观测

本次不修代码。现有证据不能支持收紧哪一条登录规则，更不支持把 P 失败一律送回 N。`waiting_login` 属应停止的类别；helper `/next-day` 的 promoted 阶段门禁、无进展保护与 active 日期门禁各有职责，均保持。两份生成器的职责已核对：`tmall-uniform-direct-workflows.ts` 输出 artifact，`generate-tmall-n8n-workflows.ts:addDailyBackfillLoop` 生成回环；无需重跑生成器。

若后续另行实施观测，建议仅在**现有同一次 inspect 判断、抛错之前**记录一个有界脱敏结构，随 P 失败载荷/审计保留，等正常调度自然复现：

```json
{
  "schema": "alimama-login-inspection-v1",
  "cycleIndex": 1,
  "businessDate": "YYYY-MM-DD",
  "flags": {"challengePresent": true, "credentialRejected": false, "temporarilyLocked": false},
  "frames": [{"index": 0, "safeOriginPath": "https://example.invalid/login", "rules": ["challenge.body.1"]}],
  "truncated": false
}
```

上面只是观测字段示意，**不是本次真实输出，也未实施**。规则 ID 分别区分 body/iframe/input 与拒绝/锁定的具体分支；只对同一次结果附证，不在 catch 后重新读取可能已变化的页面。默认不保留文本片段，只保留布尔、规则 ID、frame 编号及去掉 query/fragment 的安全 origin+pathname；绝不保留字段值、页面正文、账号或令牌。若确需命中片段，须按原方案再次限制长度和脱敏，不能自动扩成页面全文。后续观测需绑定实际 helper 版本；不得为拿证据触发业务导出、造故障或重放原 execution。

浏览器核查已按方案放弃：当前 launch-only 入口丢失新建/复用的直接归属信号；历史触发快照缺失，事后页面也不能证明当时状态。没有为取得归属证据而改启动入口、spawn 浏览器、预探后冒认所有权或关闭任何实例。

## 检查与交付

本次仅新增本目录的报告与两份脱敏 JSON；不改应用、工作流定义、业务判据或 active。已完成 JSON 可解析、摘要/字段核对、Markdown 相对链接存在性与 `git diff --cached --check`；纯资料交付不运行应用测试、构建或功能验收。

2026-11-05 原独立 Sol High 审查者直接复读精确来源后通过，无须修正：核对两条 SQLite data SHA、P/N 次数、时长/日期、诊断字段零出现及八份相关源码 SHA，确认未定结论与首轮续接、历史版本边界表述准确。审查完成结果由协调主代理回传；执行者不自称独立审查。交付分支为 `codex/tmall-p-second-round-evidence-20261105`，仅提交本目录三份资料并推送，最终提交与远端核验见本次交付回复。

未执行：业务导出/导入、n8n 新 execution/单节点重跑、helper 业务端点、凭据读取/解密、通知发送、服务重启、数据库写入/迁移、合 main、制品准备或上线。分支与 worktree 因未合 main 保留。
