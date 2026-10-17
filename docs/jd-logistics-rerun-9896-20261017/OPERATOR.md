# 9896 三份已知下载的有限闭合入口

本次源码只增加绑定 execution `9896` 的 operator、固定证据 target 与隔离测试；没有部署 helper、重启服务、生产 apply、业务导入或外部发送。原 `SOURCE_COUNT_UNSTABLE` 失败不会被改写为完成。

旧运行已经完成三份下载，因此回执明确 `nonzeroEffects=true`：flow 352、启用商品 906、实时库存 427；snapshot 仍在导出前失败，目录空且无 export-manifest，四源屏障之前 receipt/import 均为 0。旧文件只作审计，不得 handoff、重新命名复用、导入或复用签名附件。

## 有限门槛

- 原 n8n 必须由操作员通过正式 UI 冻结为 inactive、`activeVersionId=null`；版本固定 `196ba27b-2207-4ad1-ad5c-af7d0f597048`、原图与历史图一致，同工作流没有在途 execution。原 manual/error 数据摘要不变；固定一次 Wait（原执行索引 0）、两次 claim/decision（waiting→granted），A/B/release/final 各一次，索引 3/4/5/6。
- 原 active/manifest、三份原文件和下载清单逐项校验摘要、完整路径、来源/店铺/日期/任务/请求/完整筛选、时间顺序，并重新解析行数、内容摘要及启用商品状态。JH 必须精确绑定原 baseline、任务 4776718 及不可变证据。
- 当前原始 settings 只剔除整个 inventory 域的根 revision，其余字段完整冻结；部门 revision 4、scope revisions `[1,1,2,1]`，直接用当前设置重建原 selection，不做 9851 的 4→2 投影。完整分页并精确回查原八批及 currentSelection，禁止出现 9896/run 的任何批次。
- 原 1cb 包和当前 c9da 包分别核对 receipt、helper tree、exporter/pipeline/policy 输入；activation 242→243 证明原执行所在代码时间窗，244 与有界完整 successor 链证明当前有效头。旧源码证明稳定数量报错在 baseline/submitting/导出请求之前，当前源码证明已含快照修复，二者的四文件导入屏障均保留。
- 持有原 pipeline/global Chromium 双锁，核对当前 helper/父进程 PID、出生时间、精确命令、空闲健康和关闭的 9224。每个归档边界完整重验。只 create-only 写审计副本，再 no-replace 移动 active；保留原 manifest、三文件和 n8n error。

## 操作与后续

CLI 只有 `inspect` / `apply`，没有生产目标覆盖参数。应从冻结并完成独立审查的源码执行：

```powershell
node --import tsx tools/close-jd-logistics-known-three-downloads-9896.ts inspect
node --import tsx tools/close-jd-logistics-known-three-downloads-9896.ts apply
```

这些命令不是本报告已执行的声明。生产执行由主任务负责人串行负责。存在 intent、归档中断或任何未知结果时，保留证据，禁止自动重试、恢复定时或创建新 execution。只有 committed 且独立后验通过，才可恢复冻结的原发布版本，并从 claim/A 启动一次新完整 n8n；四源全部 fresh，禁止重放 9896 或单独 B/C。新执行仍须精确批次、当前选用、日期与资源释放验证。

## 本轮验证

隔离合成 fixture 的 88 项定向测试通过，覆盖三文件与下载身份、JH 唯一任务、snapshot/receipt/importing、设置与历史批次、冻结原图和固定 Wait、原代码区间和新有效头、两锁与进程资源、迟到证据及归档中断、Windows no-replace 冲突。严格范围 TypeScript 与范围 ESLint 通过。额外只读调用真实 n8n 解析函数核验 9896 的原扁平编码、原 SHA 和固定 Wait 图通过，没有取得生产运行锁。

```powershell
node --import tsx --test tests/jd-logistics-known-three-downloads-9896-closure.test.ts
npx tsc --noEmit --strict --target es2022 --lib esnext,dom,dom.iterable --module esnext --moduleResolution bundler --skipLibCheck --esModuleInterop tools/close-jd-logistics-known-three-downloads-9896.ts tools/jd-logistics-known-three-downloads-9896-target.ts tests/jd-logistics-known-three-downloads-9896-closure.test.ts
npx eslint tools/close-jd-logistics-known-three-downloads-9896.ts tools/jd-logistics-known-three-downloads-9896-target.ts tests/jd-logistics-known-three-downloads-9896-closure.test.ts
```

规划与机器候选证据位于 `D:/codex-artifacts/jd-9896-rerun-20261017/plan/`。独立审查、生产闭合与完整新执行结果由主任务另行记录；源码交付不等于恢复成功或今日数据已补齐。
