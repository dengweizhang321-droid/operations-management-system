# 京东入仓三级菜单与真实文件HTML

2026-10-15。用户先要求真实数据页面，随后合并POP/C仓，并明确最终名称及三级结构：库存管理 → 京东入仓监控 → 库存监控 / 商品对照 / 库存流水 / 调拨核对。移除中间来源页签；商品对照与原C仓库存矩阵、流水及调拨同级。导入及批次记录继续在数据导入模块。保持默认只交付HTML，不展示浏览器预览。

## 实现与事实范围

复用实际InventoryView、合并工作区、原单品矩阵、通用流水/调拨/商品表、系统subnav与编译样式。新链接使用`jdTab=monitor|mappings|flows|transfers`，默认monitor；旧POP/C仓/ERP/settings链接在挂载前归一，旧batches仍迁到数据导入history。页签切换、scope、分页、前后退及角色/迟到响应护栏保留；阈值CAS和固定30日可用库存口径不变。未更改后端业务实现。

真实数据来自本机已下载的四份京东报表，而非当前生产查询：实时库存2026-10-15为427行，库存快照截至2026-10-14为900行，启用店铺商品906行，流水2026-10-14为122行。未调用生产数据库、未重新下载、未执行正式导入或配置修改。文件来源、SHA、日期和身份说明保存在私有制品中，原始业务行不进入Git或长期记忆。

使用既有`parseJdLogisticsWorkbook`读取，随后在RAM-only SQLite临时表投影，连接前后检查`:memory:`和`PRAGMA database_list`空文件路径；不调用业务写API、不使用任何生产凭据。库存/调拨/商品关系通过现有Django reader与计算函数生成。139个单品、901仓项、26来源仓、19来源列；仅实时或仅快照成员保留缺失信息，不将缺失当零，不猜测店铺归属或跨编码关联。

ERP映射、ERP单据、正式导入记录及正式阈值未读取：ERP字段保持未确认，真实文件页不称权威导入数据，风险KPI未配置时为“—”，监控/采集/推送配置均关闭。RAM投影批次不进入导入记录。真实HTML仅viewer展示，维护入口禁用；document写表单阻断、内存GET-only适配和CSP分别阻断真实写入与外连。`fileSnapshot`仅为展示文案选项，主系统默认false，未改变实际角色鉴权。

## 离线交互与校验

- 任意不超过100字符的SKU/名称模糊搜索对应的1478种实际匹配集合，后台预计算各仓及7/30窗口的汇总并去重为5847组；浏览器只筛选、分页、按签名取汇总，不另写库存公式。全6页139个产品无重复，仓库/窗口/搜索20组交互校验通过。
- 调拨按仓筛选使用后台按warehouseCode预计算，避免用仓码匹配仓名导致假空表，或在整单聚合后过滤造成错误数量。当前文件为单业务日；生成器拒绝多业务日流水，避免静默改变日期切片语义。11个仓范围与日期排除程序检查通过。
- 菜单与URL定向12项通过，页面叶子lint、类型闭包通过，最终`npm run build`通过。生成HTML的实际脚本在程序DOM中通过展开、分页、筛选、四页签、导入归属及只读拒绝检查；脚本错误0、UI写请求0、外部请求0。未启动浏览器、服务或在线预览，不把程序DOM称为视觉验收。
- 独立原文件/数学/汇总及导航增量复审见[复审记录](review.md)。旧业务数学和PG59+6套件不在本次变化范围，未重跑。

## 文件生成与交付

私有清单仅放四源`kind/sourcePath/collectedAt`；时间来自已核实导出记录，不用文件mtime假装来源时间。快照及店铺商品缺少事业部列时，使用此前导出页面已核实身份，并在HTML披露。命令均在隔离worktree运行：

```powershell
node --import tsx tools/parse-jd-logistics-file-snapshot.ts --manifest '<私有source-manifest.json>' --output '<私有parsed-sources.json>'
python -X utf8 tools/export-jd-logistics-file-snapshot.py --input '<私有parsed-sources.json>' --output '<私有real-snapshot.json>'
node tools/export-jd-logistics-html.mjs --real-data --snapshot '<私有real-snapshot.json>' --output '<绝对路径.html>'
```

导出器默认仍只接受原合成快照；真实文件须显式`--real-data`并带来源证明。样式、脚本、gzip数据内嵌，无外部依赖。最终文件为`D:/codex-artifacts/jd-inbound-real-20261015/京东入仓监控_真实数据_三级菜单.html`；仅交付该HTML，不展示网址或截图。新源码合并不等于部署，本轮未部署、迁移、正式导入、启用工作流或发送通知。
