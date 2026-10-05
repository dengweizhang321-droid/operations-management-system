# 商品经营独立分支交付（2026-10-05）

已完成商品经营总览、毛利测算和规格详情的隔离开发与覆盖验证，分支待统一集成。部分性能目标未闭合，不宣称整个板块提速完成。

- 开始最新main基线：`bab42d8ce836b4ee9acd82e80de085ff71f9f494`。
- 最终业务/测试/实验源码：`748443e43f6c006fb49ecd28bbe96a916c9bb1bd`。
- 分支：`codex/products-performance-complete`；worktree：`D:\.codex\worktrees\products-performance-complete\运营管理系统`。
- 本说明及证据为追加文档提交，最终交付HEAD以推送回读的该分支commit为准；最终回复列出精确SHA。[源码物理字节与Git文本blob绑定](evidence/source-binding.json)。
- 源码清单可用`git show --stat 748443e4`；5个商品业务文件、3个商品测试文件（backend progressive与两个前端测试）、10个专属实验脚本。完整变更/依赖/契约见[INTEGRATION](INTEGRATION.md)。

## 可直接查看

[完整主导航预览](http://127.0.0.1:3146/?module=product) · [三页截图/初开时间轴/报告](http://127.0.0.1:3148/docs/performance/products/report.html) · [120商品候选](http://127.0.0.1:3148/.runtime/products-performance-lab/index.html?implementation=candidate) · [同条件基线](http://127.0.0.1:3148/.runtime/products-performance-lab/index.html?implementation=baseline)。

两个预览与worktree保留，全部是合成数据、独立SQLite/端口；私有PG三个作者集群与非作者集群均正常停止，目录作为测试证据保留。预览如因电脑重启关闭，在本树设置`TERUISI_PREVIEW_PORT=3146`后用`node tools/preview/launcher.mjs start`恢复主导航，以`node tools/products-performance-ui.mjs`恢复配对实验；不能使用生产连接回退。

## 验证结论

- 作者/非作者各31项私有PG通过；8500商品/255000销售尺度30组full/page/区域组合完整业务结果深等价。
- 作者33项相关Node/消费者回归通过，最终10项UI/解码/区域恢复通过，两集合有重叠；非作者30相关Node和最后13UI/独立组合负例通过。先前busy与非法日期两项阻断已修复，失败证据保留。
- 108真实浏览器配对场景、冷直接测算6场景、4个UI排序、日/周/月/指标/销售分布维度逐项回归。平台/店铺/品类追加36场景、18组业务对象深等价。合成场景均无pageerror。
- 最终隔离生产构建通过；本轮源码/测试定向eslint0错误；backend-boundary通过；同依赖同配置TS对照baseline188/candidate188，无新增诊断，不冒全项目类型全绿。
- [覆盖清单](COVERAGE.md)、[性能/SQL读取/阶段/EXPLAIN/未达目标](PERFORMANCE.md)、[非作者复核](review/source-final-review.md)。

## 仍未完成

新日期冷范围首批约2.95秒/全部约3.05秒；原cache全局锁让暖页等另一冷范围约2.76秒；排序和部分翻页/总完成浏览器时延存在退化。真实多账号/多范围生产P95、峰值内存/负载及真实多店复合筛选未验证。上述分别需要销售consumer、公共底座和统一集成契约继续处理，没有绕过领域边界或另造业务计算。

本阶段未合main、未准备正式发布候选，未操作生产服务/迁移/回填/补跑/外发。新详情前端需与提供`salesSourceRevision`的商品后端同步集成，原销售双revision header继续保持。分支、worktree、报告和预览保留，不清理待集成成果。
