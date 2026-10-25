# 验证记录与复跑边界

受审业务源码固定 `a37b5ffd`；仅本目录审查文档/取证脚本新增。未运行生产构建、未部署、未改生产配置或数据。所有浏览器测量和大测试串行；静态审查由三个子代理并行进行。

| 项目 | 本次结果 | 精确边界 |
| --- | --- | --- |
| tools/shared-filter-confirmation-regression.mjs | 5组通过 | 实际Home/独立SQLite；文本Enter、下拉、IME/229、草稿/光标、恢复/切页、迟到失败重试 |
| tools/filter-layout-probe.mjs | 9组通过，pageerror0 | 1300ms合成延迟；广东为明确合成区域DTO；不是生产业务范围等价 |
| stable-read-content + shared-filter-draft-interaction + inventory-read-regions | 18/18，无skip | 当前组件/函数；含六库存页双向早失败重试、旧树禁操作、身份/日期/错误清快照 |
| app-shell-navigation + navigation-preload + product-detail-performance | 15/15，无skip | 当前导航/意图代码预取/商品详情取消、错版本、空覆盖等；不能代替商品返回点击命中测试 |
| public-interaction-probe | 日期/IME/搜索busy/旧结果标签已观察 | 首次搜索Promise错误退出保留；修正仅验证器，补跑search；AI子chunk未完成 |
| customer-backup-probe | 7组均取得观察证据 | fixture异常是刻意隔离注入，观察成功不表示产品通过；含复现bug |
| detail-layout-probe | 5组取得几何/命中证据 | 真实Home/CSS，无force click，无CSS替换；n8n只外壳/流水线 |
| retained-progress-soak | 2首批/全量组、12切页、卸载空闲 | 仅合成短窗，未测长期；无pageerror |
| cache-lock-probe.py | 两域两次独立运行 | 当前class AST执行，无Django/DB；首轮管道中文损坏保留，第二轮直接UTF8文件 |
| market-scope-probe.py | 真实函数合成负例 | 内存ORM seam，非PG/API；“比较忽略日期”假设有反证已降级 |
| 生产入口巡检 | 55入口、176 GET/200、pageerror0 | 54按通用探针取得终态，AI另补；权限/写入/所有内部功能未验 |

现有定向测试日志：[18项](evidence/targeted-tests.log)、[15项](evidence/navigation-tests.log)。历史报告中的全库失败/skip没有由本轮追认全绿。本轮只审查，未为“全绿”改业务或测试断言。

安全复跑（先按项目规范准备独立worktree、安装依赖；不能复制生产 `.dev.vars` 或共享node_modules链接）：

```powershell
# 独立预览；非交互Vite用CI防stdin关闭退出。端口必须空闲。
$env:TERUISI_PREVIEW_PORT='3781'
$env:CI='true'
node tools/preview/launcher.mjs start

# 另一个终端，以下依次运行，不并行污染测量。
$env:FILTER_PREVIEW_URL='http://127.0.0.1:3781'
node tools/shared-filter-confirmation-regression.mjs
node tools/filter-layout-probe.mjs
node docs/performance-experience-audit-20261008/tools/public-interaction-probe.mjs
node docs/performance-experience-audit-20261008/tools/customer-backup-probe.mjs
node docs/performance-experience-audit-20261008/tools/detail-layout-probe.mjs
node docs/performance-experience-audit-20261008/tools/retained-progress-soak.mjs
node --import tsx --test --test-concurrency=1 tests/stable-read-content.test.ts tests/shared-filter-draft-interaction.test.ts tests/inventory-read-regions.test.ts
node --import tsx --test --test-concurrency=1 tests/app-shell-navigation.test.ts tests/navigation-preload.test.ts tests/product-detail-performance.test.ts
```

`production-survey.mjs`、`production-chains.mjs`、`final-readonly-operations.mjs` 是本轮已授权少量正常只读检查器，不应作为CI并发/压力任务自动循环。它们含本机3000地址，运行前重新核实实际版本/权限；`package-evidence.mjs` 固定本轮产物路径，属于本轮打包器，不是通用测试入口。

未完成/失败保留：首次node_repl ESM加载失败与等待超时、初次public probe未处理等待Promise、AI标题假设不适用、AI开发遮罩阻挡、产品返回真实遮挡及其后排序未完成、运营泛用详情locator不匹配后另补、市场下一页首轮等待仅6秒而业务尚未结束、AI旧历史class假设不匹配。**仪器错误与产品缺陷已经分开，原输出没有删除或改写。**

收口：前端与后端子审查分别只读复核最终证据分类、数值和源文件定位；已修正日期/StableReadContent行号、生产与隔离视口高度差异、27534B响应大小、趋势披露实际调用链、库存可重入回归，以及把1880ms表述为实测间隔而非承诺修复收益。Markdown链接检查无缺失，暂存差异检查通过。独立预览通过自身launcher停止并回读stopped，未停止生产服务。受审worktree及忽略目录原始证据暂保留，用于用户复核和后续确定修复范围；不删除仍被报告链接引用的材料。
