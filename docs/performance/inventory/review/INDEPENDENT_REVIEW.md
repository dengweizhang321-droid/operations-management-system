# 库存性能候选独立复核

2026-10-05，非作者复核；基线 `bab42d8ce836b4ee9acd82e80de085ff71f9f494`。用户明确要求保留独立分支/worktree、推送后统一集成，未授权合并、正式候选准备或生产操作。本复核没有生产连接、服务启停、迁移/回填、业务补跑或消息发送。

结论：当前已审源码未发现未解决 P0/P1。全部六个现有主 Tab 与广东二级页/型号详情、备货/采购/清理详情已有独立交互回归；下文性能限制继续保留，不能宣称整个板块所有打开操作均达标。完整页面与业务验收清单见 [COVERAGE_CHECKLIST.md](COVERAGE_CHECKLIST.md)。

## 独立发现及闭合

1. age/inbound 在缓存版本采样之前选择 latest batch。提交可能使旧基行落在新版本缓存键。候选将实际 age/stock batch ID 绑定基行范围；独立私有 PostgreSQL 在“外层旧版本 → 选择旧批次 → 缓存键前提交新批次”交错下验证响应重试返回新批次、下一读取不污染。
2. 主五页旧结果未绑定完整筛选范围。候选增加请求键（principal、Tab、完整筛选、页码），原始输入未防抖就绪时隐藏旧范围；同范围刷新继续保留结果。六页独立跨范围失败、忽略 abort 的迟到响应及缺数据恢复通过。
3. 广东组件缺少账号边界。候选以 principalKey 卸载；主五页全量 facet 选项也限定当前 principal。六页同角色账号 A→B 的旧行与旧品牌 facet 隔离通过。
4. 新分区协议不是另算一遍全部库存。后端按完整查询复用 full response；summary/detail 绑定 readScope/readSnapshot，旧无 section 请求保持原义。前端局部重试来源变化时重读两区域，持续不同版本有界失败。分区 helper 3 项定向测试由复核者执行通过，六页实际组件局部失败/重试、detail 先到而 summary 慢、取消后切换新范围通过。
5. watched 配置字符串不应作为不计字节的大缓存键。候选把基行范围、权限 scope 转 SHA256 固定长度；缓存整体最多8条/32MiB、60秒 TTL。调用方副作用不会污染基行，事务和无 principal 旧消费者绕过复用。

## 证据与范围

| 独立执行 | 结果与材料 |
|---|---|
| 缓存纯接缝8项 | `.runtime/inventory-independent-ui/cache-independent-result.json`；真实源码 SHA256 `036104e955f1d9d1783441a241d9f556d636941791cda7604ce7559a7508c7ed`。对象污染、principal/role/scope/DB、版本、事务、容量/TTL/LRU、超限、两并发单次加载通过。明确 DB/version doubles，不冒真实PG验证。 |
| 私有PG3项最终重跑 | `.runtime/inventory-independent-pg-03b12e306b4a3dce/pg-independent-result.json` 与 `runner-result.json`。端口57287，独立 `inventory_review` 库；两个 NOLOGIN 实际PG角色只获 revision 表 SELECT，无 authority SELECT；角色隔离、批次/版本交错及有效零成本通过，集群已由本任务停止。 |
| 双版本全部六Tab | `.runtime/inventory-independent-ui/history-2026-10-05T15-20-55.695Z/result.json`：439合成请求、81 checks、121动作测量。覆盖公共/专属筛选、固定日期不变、分页、重入、刷新、局部失败、迟到、双区首次失败及详情/广东管理页；桌面和390px移动截图同目录。 |
| 最终广东复验 | `.runtime/inventory-independent-ui/history-2026-10-05T15-24-23.121Z/result.json`：57请求、10 checks；广东最终局部重试 query 绑定修订、同角色账号隔离，二级及型号详情通过。 |
| 最终plan复验 | `.runtime/inventory-independent-ui/history-2026-10-05T15-32-06.564Z/result.json`：60请求、10 checks；最终 memo、局部失败/迟到/重试和采购详情通过。刷新反馈49.45ms、全页409.19ms，旧439.09ms样本保留，不能推导稳定P95。 |
| 六页新增最终回归 | `.runtime/inventory-independent-ui/history-2026-10-05T15-37-49.833Z/result.json`（72请求、19 checks）：账号与facet隔离、缺数据、缺数据重入与恢复；plan草稿数量编辑为57、草稿与已确认混选、全页选择/取消、状态按钮可用；没有点击提交/发送。 |
| 群消息确认详情 | `.runtime/inventory-independent-ui/result.json`：补测baseline/candidate的计划状态控件与群消息确认弹层；仅在Playwright绑定中模拟POST action=preview的读取响应，action=send及其他写入全部拒绝，不接DWS。详情打开/关闭与完整正文通过。 |
| 可查看原生预览 | `http://127.0.0.1:49763/.runtime/inventory-independent-ui/index.html`；`preview-smoke-result.json`。原生middleware六页/广东清单读取与POST405通过；启动会话26402保留，不连接PG或生产接口。停止后需要重新启动 `node docs/performance/inventory/review/inventory-ui-lab.mjs --serve`，新端口另行核验。 |

最终交互源码绑定：`app/inventory-module-view.tsx` SHA256 `7ce46decd9f41a59e09e7796d9c6fda5972c1608809dd2b1838c28057b400293`；广东 `e9124f06cf52279c501a5e88ba8968828939e4774182425233c72bbd4ec96665`。工作树最终提交 SHA 由总控附在交付材料，以上源码字节必须与提交时实际文件一致。

作者私有规模PG材料 `.runtime/inventory-performance-pg-6c780345818a071d/benchmark.json` 已独立检查对照方法：8000货品、24000库存、24000库龄、240000销售，2500京东货品/1000监控。基线通过 git show 装载原 query 与广东服务，配对真实 PostgreSQL 查询；六页×六动作×三次共108组加库存/销售/ERP三版本更新共111组完整响应深等价。完整统计/排序留在服务端，全局补货门禁、零成本区别、映射、人工状态继续保留。真实规模执行由作者完成，本复核不冒充已独立重建全部规模数据。

## 性能与尚未达标项

UI实验使用实际库存组件与原 globals，固定合成 upstream 180ms、迟到900ms，挂载不包含实际 Home/shell/生产鉴权。首轮 candidate 首开反馈46–113ms，首内容326–634ms，全页392–634ms；这些是合成界面测量。baseline第一次总览4.86秒含首轮Vite编译，不能与暖候选作业务加速对照。

真实规模PG中位数（3样本，OS/PG页暖；“首开”仅计算缓存为空）：总览3173→2557ms，计划2419→2804ms；相应重入2655→832ms、2624→724ms。库龄/滞销/入仓/广东的重入分别降至435/317/38/41ms。缓存收益不能冒首开全面达标：**总览与计划冷缓存首开仍未达到1–2秒**，全量快照加载/销售关联/Python组装与复制继续是待优化项；部分其他页冷加载也有缓存保存开销。最终 HTTP 分区版本的测量另见作者最终分区实验，不能用旧 full query 时延直接代表新双请求总工作量。

尚未验证真实生产负载/P95、真实 Home导航及权限网关传输、正式数据库数据规模分布、真实钉钉外写。它们不在本轮生产操作授权内。固定权威排序没有现成用户排序控件；总览近30天明细没有分页控件；供应商周期页没有筛选/分页。已按实际页面说明“不适用”，没有虚构交互。

## 失败保留与集成注意

两次独立UI启动在零API阶段 page.goto 30秒超时，原报告保存在 `history-2026-10-05T15-27-17.879Z` 与 `history-2026-10-05T15-29-43.599Z`。随后限定本实验 entry、独立 Vite cache、真实动态回环端口后复验通过；没有证据将超时归因于某个业务原因，也没有放宽业务断言。首次私有PG探针夹具重复同日 row_key 违反唯一约束，失败材料在 `inventory-independent-pg-11a42d03e0e05d72`；改为合法昨日/今日快照后通过。

不需要新迁移。共享权限、HTTP库、shell、全局CSS均不得由库存任务修改。集成时检查实际 reader/BI 权限与版本元数据读取已有契约、版本预算及跨域消费者旧无section接口保持；新读取包括两个轻版本区域请求，公共性能底座若调整取消/鉴权或总预算，需要在全部六页重新验收。保留本分支/worktree/证据，按用户指令等待统一集成。
