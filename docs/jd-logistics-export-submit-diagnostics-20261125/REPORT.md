# 京东物流导出提交超时诊断分类

状态：开发候选，未合并、未准备制品、未发布、未导入 n8n。分支 `codex/jd-logistics-export-submit-diagnostics-20261125`，基于 `118f988a`。本轮只读取本机日志与运行产物，不访问真实京东页面，也不改动生产计划或 manifest。

## 失败现场（只读取证）

| execution | 时间（北京） | 失败来源 | 来源 manifest | 计划失败码 |
| --- | --- | --- | --- | --- |
| 11941 | 2026-11-24 08:50 定时 | 第 4 个 `inventory_snapshot` | `submittedAt 00:51:50.435Z` 后停在 `submitting`，`00:52:22.235Z` 失败（+31.8 s） | `JD_LOGISTICS_PIPELINE_FAILED_MANUAL_ACTION` |
| 11963 | 2026-11-25 08:50 定时 | 第 2 个 `shop_products` | `submittedAt 00:51:06.862Z` 后停在 `submitting`，`00:51:37.995Z` 失败（+31.1 s） | 同上 |

- n8n：B 节点「B·串行下载全文件校验并导入」收到 helper `/jd-logistics/run` 的 HTTP 500（`PIPELINE_FAILED`），随后释放 helper，「保留证据并明确失败」按设计停止。
- 11963 的 flow 来源已用 118f988a 的直连下载成功校验（6793 行）。当前 helper（2026-11-23 21:48 起）运行的 release `20261123T131221Z-bd4c5b5c3a62e3ce` 源自 `118f988a`。每个来源各自启动、关闭浏览器，flow 的变化不会延续到下一个来源。
- 11941 已人工 pre-import 闭合，闭合原因记录：「点导出后 30 秒未收到导出接口响应，下载中心无该任务」。
- 专用 Chromium（Default）History：两次失败时页面都停在业务页（`wl.jdl.com/supplychain-bbi/esg`、`jh.jdl.com/#/OfflineInventorySmall`），没有跳到登录页或验证页。
- Worker 日志：今天这次运行的 `GET /api/inventory/jd-logistics` 每次只要 100–233 ms，所以 `assertOwner` 没有占用等待窗口；导入还没开始，Django 不涉及。

## 根因与证据缺口

两次都是同一机制：manifest 写入 `submitting` 后，导出点击或 30 秒 `waitForResponse` 抛出了 Playwright 原生错误。原生错误的 message 不是 `JD_LOGISTICS_*`，`tools/jd-logistics-n8n-pipeline.ts` 中的 `code()` 会把它统一改写成 `JD_LOGISTICS_PIPELINE_FAILED_MANUAL_ACTION`。helper 也不打印原始异常，所以无法区分下面两种情况：

1. 导出请求根本没有从浏览器发出（点击被遮挡、前端拦截等）；
2. 请求已经发出，但京东 30 秒内没有响应（提交结果未知）。

这两种情况对人工闭合和后续修复的含义完全不同。现有证据不足以把具体原因落到京东侧或页面侧，所以本次不改超时时长，也不加重试。

## 改动

- 在 `tools/jd-logistics-export.ts` 新增 `settleLogisticsExportSubmission`，flow、商品和 JH 三条导出路径共用。点击和响应等待的原生错误，按 request 监听器是否看到导出请求，分成四个新码：
  - `JD_LOGISTICS_EXPORT_REQUEST_NOT_OBSERVED`：点击返回，但没有发出导出请求，且响应超时；
  - `JD_LOGISTICS_EXPORT_RESPONSE_NOT_RECEIVED`：请求已发出，但响应超时（提交结果未知）；
  - `JD_LOGISTICS_EXPORT_CONTROL_FAILED_NO_REQUEST` / `..._AFTER_REQUEST`：点击步骤本身失败。
- 已有的 `JD_LOGISTICS_*` 错误原样透传。仍然只点击一次，不重试、不重新提交；manifest 字段、生命周期和 30 秒超时都不变。
- 新码不在零效果自动闭合白名单里，也不是凭据风险码：自动闭合不放宽，人工 pre-import 闭合照常可用。

## 检查

- `node --import tsx --test`：export、pipeline、zero-effect closure、pre-import closure、product-download、helper-bundle-contract、session，共 140 项全部通过。新增的分类单测覆盖四个新码、透传以及失败点击不再等待响应。
- `tsc --noEmit -p tsconfig.json`：两个改动文件零报错；全项目既有 172 个报错都在无关的测试文件里。

## 后续（需用户另行授权）

- 11963 当前停在 `failed`，下一次计划会被拒绝，需要像 11941 一样走人工 pre-import 闭合。闭合前请先只读核对京东商品导出任务列表，确认 2026-11-25 08:51:07 前后有没有新建任务。
- 本分支合并上线后，如果再次出现这类失败，按新码判断：`RESPONSE_NOT_RECEIVED` 说明京东侧响应慢，可以评估延长等待；`REQUEST_NOT_OBSERVED` 或 `CONTROL_FAILED_NO_REQUEST` 说明问题在页面侧。
