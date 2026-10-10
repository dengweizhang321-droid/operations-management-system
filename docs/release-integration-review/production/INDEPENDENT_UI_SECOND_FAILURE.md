# 第二次原UI失败：独立结论与有限复验

2026-10-10，Asia/Shanghai。对象仍为唯一已批准 batch `9f79a27a1b2ec47095c971780efde8379940366724e975ff31b9cf88b45dce15`。未修改9的脚本、参数、输入或pin；未运行UI、服务动作、Status、数据库或dump扫描。

**允许仅一次原未改UI的受控稳定后复验。** 依据是同一源码、同一原断言/route的一次诊断已通过，并有明确的详情请求时序假设；这不把诊断算成9原UI成功、不豁免sales abort，也不表示已修复原测试稳定性缺口。本次必须保留新failed audit及unknown，按原协议仅收敛为failed；若限定重验再失败，保持阻断并形成具体修复/独立复审及补充批准范围，不继续寻找偶然green。

## 原失败事实

- 原第二次unknown：`2026-10-10T06:51:24.696Z`，event `aa968486f130adae1668d57de263a69a1eeed0f421a80f42f7efdd349c2ac1cf`，Node41260/exit1，stderr468bytes；不是已完成的UI操作。
- 新audit原字节SHA `d53c875a32df6ed6fb02f8ae385f2c2c6b674f40d8fa2eb97499d55e6e519ac6`，28261bytes，mtime `06:51:24.200Z`。确实属于本次、status=failed、86 attempts全部GET、64资源观察、dangerous/missing/productionWrites均0；唯一失败为 `/api/sales/summary` 的 `EXPECTED_REQUEST_FAILED / net::ERR_ABORTED`。1个synthetic search取消另有精确见证。
- `production-ui-result.json`未产生，不能推断四case成功。全部固定输入与原UI/route摘要仍匹配9的 command.files，详见 [机器证据](INDEPENDENT_UI_SECOND_FAILURE.json)。
- 独立 [failed-only proof](INDEPENDENT_UI_SECOND_FAILED_PROOF.json) 的observations SHA为 `fe8ecbf608e6c500d7a5845aff4ef42446af2b9beaef8f0f588f479ceed0e438`；noEffect限定这一步的生产业务/生命周期/调度定义/手工发送效果，普通GET观察、日志和隔离浏览器临时文件不称不存在。

## 已定位的未变控制流

AB与D5的 `app/{product-module-view,sales-module-view,page,global-search-dialog,ai-page-context-provider}.tsx` 及 `app/shell/use-module-view-state.ts` 均逐字节相同，本次没有采用新的业务页面代码。

`product-module-view.tsx:330–369` 的 `loadProductDetail` 本身通过GET `/api/sales/summary`读取规格销售详情；因此销售API不只属于销售页。`375–380`在 `detailOpen`、规格/日期/回调变化时清理并abort controller，返回按钮 `63` / `505` 设置 `detailOpen=false`。原UI点击详情后只检测返回按钮的四视口命中与Enter，没有等待该详情请求/内容终态，随后就关闭详情；慢详情可能被这个正常关闭动作取消并被严格审计拒绝。

原销售页 `sales-module-view.tsx:258–344`另有完整core/full读取、30秒超时和依赖变化/卸载abort；全局搜索 `page.tsx:343–389,553–575`只管理自己的search controller。当前audit的 `createdDuringDeclaredWindow`只判断 `createdAt>=startedAt`，没有结束时间上界，不能仅凭这个名字把sales请求归因于synthetic搜索。

实际已安装Playwright的 `lib/coreBundle.js:58821–58830` 在已有 `networkidle` loadstate时立即返回。`22448–22455`的新请求仅停止timer，`23641–23646`并未在该方法中同步清掉已经发布的loadstate；原脚本的waitForLoadState不能证明后来互动触发的GET已排空。原UI audit的pending集合只等待静态资源body，不是全部业务GET的终态屏障。

一次只读诊断 `E9/production/ui-diagnosis-184ff4aea8` 的trace显示id86在product-navigation阶段读取sales summary：`06:55:16.587Z`创建、`06:55:16.606Z`finished（19ms）；原审计通过。该phase标签不是每个DOM动作时间戳，不能据此断言请求准确发生在Back之后；但与商品详情这个API来源及快请求可完成的假设一致。诊断不替代9原操作，也不反推两次原失败成功。

## 本次可执行边界与后续最小修复

保全第二次unknown、原stderr/输出记录和本次新failed audit原字节/sidecar至独立phase档案，记录result缺失。仅可原子迁移这个未pin私有audit以恢复原create-only槽位；源/输入/参数/pin不变。原reconcileOperation使用本独立proof追加failed，原engine同batch/同最早批准时间续接，跳过已passed生命周期/Backup；只执行一次剩余原UI复验。

该次复验必须原四case与原全route审计自行通过。缓存暖/数据稳定只降低时序触发机会，不能改变结果、忽略接口失败或重置批准计时。若再失败，缺口的最小稳定修复为：规格详情返回前绑定该次API请求的response/body完成与当前详情 `aria-busy=false`、无error，再做原四视口/键盘返回；每次导航/最终audit以实时request-id inflight集合和终态证明作有界屏障，失败仍保留。`networkidle`历史标签不能替代它，也不能新增宽泛abort例外。需要新脚本时另做隔离负例、独立复审和明确补充范围，不能直接改已批准9。

本轮复验授权是有限的只读收口，不宣称整个AB完成；watchdog、自然守护、后Backup/Restore、深比较与最终收尾仍依原批次待执行。C没有生产批准。两次原失败、一次诊断与协调/等待耗时分别保留，不以暖缓存单次通过宣称通用稳定性或发布分钟目标已达成。
