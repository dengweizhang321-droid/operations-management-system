# 分支集成与跨领域契约

本轮只在`codex/products-performance-complete` / `D:\.codex\worktrees\products-performance-complete\运营管理系统`开发，基线`bab42d8ce836b4ee9acd82e80de085ff71f9f494`。当前用户“五个任务统一集成”安排覆盖旧AGENTS立即合main/候选准备/清理约定。保留分支、worktree、临时测试数据库目录与两个合成预览；私有PG均停止。没有合main或制作生产候选，未操作生产服务、迁移/回填/业务补跑/消息。

## 自有改动

- `backend/products/query.py`：只改商品汇总组合/投影，不读新权威源，不新增迁移或索引。
- `app/product-module-view.tsx`：商品三页的日期、版本和刷新状态；现有专属样式/稳定框架保持，无全局样式修改。
- `lib/products/summary.ts`、`read-contract.ts`、`detail-contract.ts`：商品DTO可选来源见证与商品详情consumer解码。
- 商品专属测试、`tools/products-performance-*`隔离实验与本目录证据。没有修改`backend/sales`、`backend/inventory`、公共客户端、主导航、共享UI、全局样式、README或AGENTS。

## 已闭合的原接口依赖

sales summary公开网关原本转发`X-Sales-Data-Revision`和`X-Sales-Source-Revision`（sales+ERP版本`整数:整数`）。产品响应现在追加`salesSourceRevision`，使用现有读取前稳定版本；原snapshotToken、版本前后复验、scope权限和page总数协议保持。新详情消费必须同时比较两个header与商品见证，再检查日期/唯一productCodes echo、趋势日期及数字，失败只作用本区域。旧full/page消费者可忽略附加字段；新前端需同步含新字段的产品后端，否则overview兼容而detail会失败关闭。不能只合前端。

库存仍从原有版本化完整商品投影取得；排除仓、快照、空/零/未知成本及库存指标保持，不改库存权威读取。产品率统计仍在完整授权集合先过滤，稳定排序保留code tie-breaker与null顺序；rate只补所选页，不参与筛选/排序口径。

## 销售任务待闭合

1. 8500规格的冷读取仍调用9个1000代码product_performance块，每块取latestBatch和outletOptions等。请求`includeBounds=false`是既有能力；本轮未擅自改sales consumer。需要销售任务提供有界、同一expected sales+ERP revision的批量会话/可复用公共元数据契约，保证所有块rows/truncated/latestBatch验证及完整outlet集合不被截断。
2. 契约测试：全量/每块相同退款负额、净销量、absolute成本/数量、fee、订单毛利；空与零区别；自营别名；授权与跨店隔离；9块中间版本更新整体失败；晚块缺失/超限不可当部分成功；新契约默认现有其他consumers行为不变。还需查询次数、EXPLAIN销售扫描量和服务器峰值负载对照。
3. 详情仍消费原full sales summary（含趋势、平台和店铺），没有新增一个产品领域销售计算。真实规模详情冷读取是否1–2秒、是否能减少不展示的比较/选项由销售任务实施与本详情分别验收。

## 公共底座待闭合

排序UI较长时延主要在API发出前与绘制附近，现有共享选择器的交互/动画/dispatch未定位根因；本任务保留样本，不改共享UI。任何基础改动需要在本三页再次实测。进程cache全局锁跨冷范围阻塞暖范围是已有约束，120秒/4基础范围/16MiB/5秒等待均未扩大；若改有界single-flight协调，须保证不增加重复扫描和无界并发、按数据库/authority/账号/角色/scope/版本隔离、取消/失效/oversize/租约损坏负例及2+范围负载验证。

## 集成步骤

统一负责人在五任务分支中按文件归属组合；本轮不自动合并/发PR/发布。先检查同一backend与frontend的产品来源字段，运行本商品回归及相关consumer，再使用独立预览验证真实shell三页与迟到/失败。保持原业务超时/上限，不通过生产连接回退。真实采用需另获用户授权，本交付不构成生产候选或维护许可。
