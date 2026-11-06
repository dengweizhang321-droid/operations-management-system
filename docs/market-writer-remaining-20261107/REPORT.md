# 市场 M1 与外部 writer W1 交付

基线：`origin/main` `77382b5f`。本轮只完成 M1 来源资格正常入口与 W1 准入记录；M2—M6 仍需后续实施。本分支没有修改 migration、生产配置、历史 paused/synthetic 证据或金额账本，没有调用模型、读取生产运行目录、访问真实平台账户或发送外部请求。

## M1：已有封存来源的实际核验入口

复用 AI 助理 → 经营分析工作台 → 已封存证据 → 关联报告下的市场来源选择、双窗口、观察日及价格分界控件。新增“核验来源资格”，即使停放报告预览开关关闭也可执行。旧停放报告创建与预览继续遵守原开关。

新增 `POST /api/ai/reports/{reportId}/market-source-qualification`，请求为：

```json
{
  "schemaVersion": "business-market-source-qualification-request-v1",
  "marketSelector": {
    "priceBandSourceKey": "market-current",
    "rankCurrentSourceKey": "market-current",
    "rankBaselineKey": "market-previous",
    "currentObservationDate": "2026-08-01",
    "baselineObservationDate": "2026-07-31",
    "bands": [
      {"key": "below_boundary", "lowerCents": 0, "upperExclusiveCents": 100000},
      {"key": "at_or_above_boundary", "lowerCents": 100000, "upperExclusiveCents": null}
    ]
  }
}
```

示例仅说明输入结构，不代表现有生产来源或已执行结果。日期必须遵循原报告查询窗口及既有比较规则，不能凭示例创建来源。

- Worker 精确路径白名单、同源 POST、真实无范围管理员校验，转发至 AI reader；writer 和尾斜杠别名拒绝。
- Django 复用 `business_promotion_market_admission.describe` 验证现有推广报告 profile、封存证据根、账号版本、完整目录、来源条件与日期覆盖。
- 指定观察日缺覆盖时返回明确缺口，不进入材料重放；错误来源、跨账号、非合格 profile 保持原拒绝语义。
- 覆盖满足时复用 `business_market_report_material.prepare` 完整重放已封存页链、构建三张类型表；离开其上下文并通过最终 fence 后才能返回。最后重读来源资格，变化则不返回部分结果。
- 结果含来源 profile、owner/版本绑定、封存 run/version/digest、两窗口来源描述及覆盖证明摘要、表行数与材料摘要。返回体上限 48 KiB，不返回市场事实行。
- `reusableSourceMaterialAvailable` 只表示本次选择的封存材料已核验。SQL 新流程准入、真实同 job 已读、精确数值证明及发布仍未成立；不新建报告、不重新启动推广链、不调用模型、不预留费用。
- 浏览器校验结果的报告、完整 selector 和关闭标志；选择或证据身份变化时清除结果，迟到回执不得覆盖新身份。

未查询当前生产业务数据，因此没有声称生产中已经存在合格报告。用户在正常入口选取既有报告后，由该接口返回本次真实核验结果；不能沿用旧施工面板或本地演示代替。

## W1：用户决定保持关闭

独立准入记录见 [W1.md](W1.md)。本轮不改写平台行为，不新增日常关闭平台卡片。

## 后续 M2—M6 的当前源码事实

这部分是后续施工输入，不是已完成声明。

| 阶段 | 现有事实与尚缺的实作 |
| --- | --- |
| M2 | `settings.py` 正式声明 preview/agent-runtime/paid-runtime 三个默认 false 开关；部分候选 owner 的 `getattr` 开关只供隔离研究。需要按选定新 profile 整理真实最小运行入口/owner图，不能批量打开候选开关 |
| M3 | 0065 费用需求账 `reserved_cents=0`；0069 有 authority/round/event **彩排**结构，严格要求 synthetic/禁止调用；0072 为权威提案，0074 人工上限审批也不预留资金。生产逐轮金额预留、可信usage结算、unknown占用和原 provider dispatch 的事务绑定仍需新受保护账本实现 |
| M3 推广范围 | `workflows.py` 共用微步先执行市场 paid gate，随后 `dispatch_budget` 和 provider dispatch；`dispatch_budget` 是日次数限制。普通 `business-agent-screening-promotion-reference-v1` 未携市场工具时不受市场金额门禁覆盖。新推广全流程费用需包含五角色、多轮及恢复，不能仅按三项 `PROMOTION_ROLES` 计费 |
| M4 | 已有候选 owning回放、read receipt、v6 source ticket/replay；0079 reader 自述尚不验证 protected ticket provenance、不持久化 Agent 已读。新 job 的真实 provider call/name/规范参数、工具派发/结果、独立同 job attestation 仍需贯通 |
| M5 | 0053 admitted-paused、0077 paused-v6 保护继续存在。新可运行分支须新增独立结构与SQL重验，不改旧profile为可运行，不将synthetic翻为真实；新结构若需0091须由总负责人协调依赖0090及159→160代际 |
| M6 | 已有数值候选与复算模块不等于新真实 job 的独立持久单元格证明。须在新执行链成立后接通同任务精确行/字段重算及发布门禁，当前保持禁止引用/发布 |

未来只有需新建付费来源或真实模型验证时，才由用户决定具体供应商/模型账户、有效费率和计费类别、报告金额上限与授权期限；这些启用决定不替代仍可提前完成的账本/新profile/attestor开发。

## 必需代码检查

- Python：对新增 owner 与修改的 `views.py` 进行 AST 语法解析，通过；不加载生产设置或数据库连接。
- TypeScript：按本仓库 `tsconfig.json`，为本次五个 TS/TSX 文件及其传递依赖、ambient declarations 创建程序，`getPreEmitDiagnostics` 为零。
- 首次全仓 `tsc --noEmit --incremental false` 未通过：已有 docs/demo、tests、tools 和其他未改文件的诊断；本次修改文件未出现诊断。随后仅做上述定向类型核验，不修无关内容。
- `git diff --check` 通过。
- `check:backend-boundary` 扫描760模块，现有阻断为 `tools/tmall-sycm-cookie-pipeline.ts -> lib/jackyun/n8n-preflight-evidence.ts`，两文件均与本分支基线 `origin/main` 无差异；本次未增加D1或旧领域入口。此全仓检查不宣称全绿，交总负责人合并时统一判定。
- 未新增或执行业务功能测试、生产数据回查、浏览器验收、模型调用、结构迁移、制品准备或发布；功能按项目分工由用户上线后检测。

本轮后续：独立 Astra 反审 M1 与 W1；根据结论修订后，再继续 M2—M6。当前分支仅为开发候选，不能据此认为 M 全专项完成或已上线。
