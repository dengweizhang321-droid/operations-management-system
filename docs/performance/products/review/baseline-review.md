# 非作者基线源码复核

- 复核对象：`bab42d8ce836b4ee9acd82e80de085ff71f9f494`，`codex/products-performance-complete`。
- 范围：只读源码和合成浏览器测试；不接生产数据库、服务、业务补跑或外发。
- 当前用户要求独立分支交付优先于 AGENTS.md 默认合并和清理流程。

## 完整覆盖清单

当前 `app/shell/navigation-catalog.ts` 为 product 声明 `overview`、`calculator`；`app/product-module-view.tsx` 内另有规格详情 drill 页面，没有第四个商品经营子页。

| 页面 | 入口 | 数据依赖 | 应验收场景 |
| --- | --- | --- | --- |
| 商品经营总览 | ProductView / overview | `/api/products/summary` initial-page、overview、page | 首开、回访、搜索、品类/平台/店铺/毛利筛选、排序、翻页、同范围刷新及新日期 |
| 毛利测算 | ProductView / calculator | summary 当前页商品与成本/费用字段；纯前端试算 | 直接首开、回访、选商品、编辑参数、日期/刷新、离开返回、缺失与零值 |
| 规格详情 | ProductDetailView / 明细详情按钮 | summary 行身份、`/api/sales/summary?productCodes=` | 首开、回访、日期切换、同范围刷新、迟到/失败、趋势粒度/指标、返回 |

## 已确认风险与验证要求

1. **详情日期身份缺失。** 基线 `ProductDetailSnapshot` 只有 productCode。日期变化后 summary 会同步隐藏，但旧详情快照不会随范围隐藏；新 summary 完成后又显示旧 detail，直到新销售请求成功。新请求失败时旧 detail 可以继续显示在新期间标题下。应绑定请求范围身份，分别测试新范围等待、失败、迟到旧响应；同范围刷新成功内容可保留。
2. **刷新未刷新详情。** 详情共用顶部按钮调用 loadSummary(true)，同日期的新 summary 不改变详情 effect 依赖，因此已有 detail 不保证重新读取；应明确详情刷新协议且校验显示的行/详情版本关系。销售权威接口调整归销售任务。
3. **测算选择属于当前页。** 商品选择项为 summary.items，最多50条。应保存既有业务能力，并如实注明可选范围；页面回访和日期变化不得让旧范围默认值冒充新数据，用户试算覆盖值与自动默认值应分别验证。
4. **冷计算仍读全量费率。** `_read_dimensions()` 读取所有 ProductShippingRate，而该字段只用于当前页 `_item.shippingRate`，不参加全集合筛选/排序/统计。可评估当前页后读取，保留缺失/0区分、products revision 前后稳定性和读取上限。
5. **initial-page 多算被丢弃指标。** 当前全量 metrics/filters 在 initial-page 内计算后删除，overview 再算。优化可避免无用结果物化，但全授权集合筛选和排序必须保持。
6. **不同范围共享锁。** SummaryCache 单一 lock 串行所有 key；冷新范围可能阻塞暖命中。需测量同key并发及不同key并发，保留有界等待；不能将同key单loader实验当作全站并发性能。

## 初步验证

非作者直接运行以下现有定向测试，共7项通过、0失败、0跳过（Node v24.18.0，合成 Chromium）：

```text
node --import tsx --test tests/product-progressive-contract.test.ts tests/product-region-recovery.test.ts tests/product-summary-projection.test.ts
```

覆盖总览响应见证、统计取消后明细失败恢复、新范围失败及版本冲突回第一页。它们不覆盖上述详情日期/刷新缺口，也不是生产性能证据。

## 最终复核门槛

- 精确候选 SHA 和修改文件清单；不得修改 sales/inventory、公共客户端、主导航、共享 UI、全局样式、README 或 AGENTS。
- 同一独立数据库上基线/候选 full/page 等价及查询次数、主要读取行数、阶段计算；费率读取延后需独立确认不改变排序和全量统计。
- 三页面分别记录初开/回访/适用交互；保留旧内容可用与本次新内容绘制分别计时。
- 总览既有交错测试与新增详情范围/刷新/迟到测试、测算默认值和用户覆盖回归。
- 涉及销售或库存接口的优化只声明依赖与契约；本任务不得复制它们的业务计算。
- 明确未达目标、未测并发或接口阻断，不能从总览通过推断整个商品经营完成。

本文件为基线审查，不是最终候选通过结论。
