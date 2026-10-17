# 天猫入仓实时库存自动化

## 本次范围与实地观察

2026-10-17 经当前 Chrome 已登录的 `https://scp.tmall.com/` 页面核验：库存 → 实仓良品实时库存报表(商家端)，来源路由 `/pages/sdigit/fulfillment_realtime_inventory_good_s_ptdjd`。登录身份来自页头账号面板，独立于报表的供应商字段。

在未设置行业、货品、区域、仓库、品牌等筛选的页面，点击唯一“导出”后出现“正在导出数据…”进度，随后直接产生浏览器 XLSX 下载；本轮未使用任务中心，也没有第二次导出点击。下载文件 `isc-hf-biz-workbench_cfcc2f8d407940a78e6c78c122b7c709_1792216906491.xlsx` 为研发样本，原件保留在 `D:\谷歌浏览器`，不进入 Git、不正式导入。7703 bytes，SHA-256 `dc8e4794036544fa4cffe4bd1547a2ffc7feac715c89875988a2b5f7b129fa93`。

工作表“导出数据”为单行表头、25 行；页面总数也是 25。解析器核验可销/实仓/残次数量汇总与页面总览一致。没有来源日期，也没有近 30 日销量，不将采集时刻伪装为来源系统截止时刻。

原件 32 列：货品ID、货品名称、货品编码、一级行业、二级行业、一级类目、二级类目、叶子类目、品牌名称、货品分层、供应商ID、供应商名称、区域、仓Code、仓名称、仓角色、实仓可销、销售占用、实仓总数、良品可用、良品占用、预留占用、预留可用、残次总量、采购在途、调拨在途、锁库库存、非淘总量、非淘占用、非淘可用、负卖待补货、远期待补货。

## 独立 n8n 定义

- 文件：`automation/n8n/tmall-warehouse-daily.workflow.json`。
- ID：`TmallWarehouseDaily2026`，名称“天猫入仓监控·实时库存下载与导入”。
- 默认 `active=false`，上海时区，候选时刻 08:20；没有激活定时、正式运行、导入业务数据或发送通知。
- 顺序：手动/定时 → 领取共享 helper → 未领取每 5 分钟等待 → A·冻结货主与本轮采集日 → B·导出签收完整校验并导入 → C·独立核验文件精确批次和当前版本 → 释放 helper。
- 失败支路先释放原 execution 的 helper，再显式失败。浏览器清理失败隔离该共享槽，不宣称已释放。

新协议 `tmall-warehouse-realtime-v1`；helper key 为 `tmall-warehouse`，使用既有共享协调门禁与 legacy 互斥槽。接口为 `/tmall-warehouse/plan`、`/run`、`/verify`、`/release`，每个请求携同一 `X-TERUISI-N8N-EXECUTION-ID`，不经过六店商品日/推广/货品节点。前端健康字段 `tmallWarehouseProfile=ready|missing|invalid` 只证明配置及专用 Profile 存在，不能证明已登录。

本机官方 n8n 2.32.7 CLI 已创建本 ID 的停用草稿，强制 `--activeState=false`。首次 CLI 启动超过 60 秒，已只读证实目标不存在、原定义未变且进程结束后，再以相同 ID 延长启动期限；第二次 28.9 秒成功。新工作流 `active=0 / activeVersionId=null`，节点、连线和设置与模板一致，原 23 条工作流定义摘要未变。失败原证据保留，未借安装触发任一 execution。

复用现有 n8n 领取等待、失败释放方式和 durable JSON、运行锁、全局 Chromium 锁。共享小时重试政策目前只支持既有白名单流程，本次不扩大其白名单；新采集器的导出/导入未知结果需要人工核对，不能让错误触发器重放。原六店配置、定义与重试不修改。

## 首次配置与登录

运行时须有 `.runtime/tmall-warehouse.json`（不提交）配置，字段如下。初始保持 `enabled=false`；登录和采用前不开放业务运行。

```json
{
  "enabled": false,
  "owner": "页面账号面板精确显示的企业名称",
  "executablePath": "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "userDataDir": "<实际运行根目录>\\.runtime\\tmall-warehouse-browser",
  "profileName": "Default",
  "baseUrl": "http://localhost:3000"
}
```

浏览器目录必须为当前运行根下精确 `.runtime/tmall-warehouse-browser/Default`，不得复制当前 Chrome 用户数据、登录态、Cookie、密码，不能挪用六店 Profile。由操作者在该专用 Profile 交互登录本来源后，再在已授权采用步骤将配置启用；登录挑战和身份不符失败关闭。本次尚未建立或登录正式专用 Profile，也未安装新的 helper 运行包，因此不能称自动采集已可用。

发布后可双击 `tools/tmall-warehouse-login.bat`（等价 `node --import tsx tools/tmall-warehouse-login.ts`）。正式 CLI 直接复用 `tools/worker-local-release.mjs` 导出的 `workerProtectedSourceRoot`，与正式 helperMutableRoot 同为 `D:\运营管理系统`；不会按工作树或冻结源码的位置选择数据根，也不接受 CLI 根目录覆盖参数。终端会打印实际根目录和配置完整路径。模板从登录脚本所在源码根的 `automation/n8n/tmall-warehouse.config.example.json` 读取，因此不要求正式受控根目录预先复制新模板。

首次由用户运行才创建 `D:\运营管理系统\.runtime\tmall-warehouse.json` 的 disabled 配置，Profile 固定 `D:\运营管理系统\.runtime\tmall-warehouse-browser/Default`；模板默认绑定本次真实观察的企业名称，浏览器路径不同或目标企业改变时先由操作者核定配置。入口持有该正式根下的原全局 Chromium 锁，只打开专用 Profile 的来源页，等待人工登录，再按 Enter 精确核验企业身份；不会导出、导入、复制会话或激活工作流。核验成功后可在终端明确输入 `y` 启用本地采集配置，默认 Enter 继续停用。启用前再次核验身份及原配置未变化，随后关闭自己的浏览器并释放锁。n8n 定时启用仍是另一步。本次仅交付此入口，未执行它或写入正式 `.runtime` 配置。

## 证据与未知结果边界

本地 `outputs/tmall-warehouse/active.json` 与同 run manifest 固定协议、execution、货主、配置摘要和上海采集日。导出前先持久 `export_intent`，本轮仅监听一次直接 download；签收原件位于 `downloads/<runId>/source.xlsx`，保存原名、大小、SHA、身份、来源行数和真实签收时刻。恢复不得通过查找“最新文件”或重置 active 获得重放权。

A 从权限内 `options.scopeRevisions[owner]` 冻结货主范围版本（不存在的货主为 0，缺失或非法版本响应失败关闭），B POST 带 `expectedScopeRevision`；下载期间出现同货主写入时由后端拒绝过期发布，不能覆盖其他任务的新事实。

解析必须命中“导出数据”、完整页面总数、关键库存指标，且无来源日期时由签收 `collectedAt` 的上海日绑定 `snapshotDate`。`sourceAsOf` 留空，`sourceUrl` 固定来源报表。导入前持久 `import_intent`，只 POST 一次；响应丢失、5xx、未知 receipt 均保留原意图并阻止新执行，不猜测导入未发生。

C 重新读文件/哈希/行数，按本次精确 batch ID 回查 owner/date/raw/content/rows；completed 必须是当前批次。duplicate 同时核验本次尝试和 `referenceBatchId` 指向的 current completed 批次，引用批次以完整业务内容指纹绑定，不以原件字节哈希推断业务重复。全部通过后才标记 completed。

## 验证与待采用项

针对性测试覆盖共享互斥、跨 execution 拒绝、停用/共用 Profile 拒绝、提交意图后未知下载不重放、下载签收及精确当前批次回查、停用工作流节点边界；同时复跑原隔离 helper 和天猫 n8n 模板相关测试。测试使用独立临时目录、合成文件和 HTTP 替身，没有向业务库写数据。

仍需后续明确采用的项目：正式 helper/应用包更新、专用 Profile 人工登录及身份核验、启用采集配置、完整真实 n8n 一轮下载导入回查、最终调度启用。草稿安装结果单独保存在同目录 `N8N-INSTALLATION.json`，不将源码和隔离测试当作真实运行成功。
