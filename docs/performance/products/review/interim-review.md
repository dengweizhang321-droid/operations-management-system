# 非作者候选第一轮复核

尚未提交；四个业务文件物理SHA记录在 `physical-source-before-fixes.json`。基线 bab42d8c。

- 私有 PostgreSQL17.11、随机独立端口53574、全新临时数据目录 `.runtime/product-overview-pg-57b2b4de3f92909a`；31项通过，正常stop exit0。没有读取生产连接/凭据；仅复用 PostgreSQL 程序二进制。测试与初始化/停止回执保存在 `postgres-tests.log`、`postgres-result.json`。
- 非作者 Node/Chromium 定向25项通过：详情日期切换、迟到、刷新失败、版本核对、测算输入/返回，原分区恢复与读取契约，销售/库存/商品consumer及投影兼容。
- 独立新增2项组合负例均失败，源码位置和回执见下，必须修复后重新验证，不以原测试通过抵销。

## 阻断发现

1. **取消后的详情busy没有回收。** 在途详情打开后切新日期，再返回合法无销售覆盖的完整summary；详情没有可请求的起止日期，旧请求已abort且finally不改状态，`detailLoading`保持true。新增顶部refresh disabled分支据此永久禁用，表现为无覆盖提示下“同步中…”按钮不可点击。测试 `independent: aborted detail followed by no-coverage scope must release refresh` 实际true、预期false。
2. **缺失日日期进入趋势渲染。** detail `daily[0]`删除date，其他元数据和revision均合法，当前 `day.date < start || day.date > end`不拒绝undefined；随后共享图形 `.slice()`产生真实pageerror `Cannot read properties of undefined (reading 'slice')`。应在本领域详情解码验证日期类型/有效性，不修改共享UI。测试 `independent: malformed daily date must not reach shared trend rendering` 实际pageerror数组非空。

复现文件：`independent-detail-negative.test.ts`。夹具函数复用作者独立合成响应生成方式；两项测试场景和断言由非作者新增。没有生产连接、客户资料或消息发送。

## 已审查通过的实现点

快递费率不参与本领域全局筛选/排序/统计，当前页选定后才读取；保留完整费率count安全上限，未改变缺失/0/负值/>100%值，读取后仍稳定版本复验。缓存行不被费率补充修改。overview不物化行、不排序；可缓存initial-page不重算被丢弃统计，不可缓存仍内联完整结果。salesSourceRevision采用products响应额外可选字段，未修改共享销售consumer或复制销售计算。

## 尚待最终核验

等待上述2项修复、更新物理SHA、完整页面性能/覆盖文档和最终提交SHA。冷范围/不同key并发性能由作者证据判断，本次并行验证不作为独立性能结论。
