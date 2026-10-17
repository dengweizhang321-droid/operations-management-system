# 天猫报表定位器只读复核

观察时间：2026-10-17 14:16–14:18（上海），对应最后一轮 `2026-10-17T06:17:53.335Z`。通过 Cua 复用现有 Chrome 的 `scp.tmall.com` 标签，只执行 DOM/locator 读取，没有导航、查询、导出点击、工作流执行或数据写入。

当前 URL：

```text
https://scp.tmall.com/?frameUrl=https%3A%2F%2Fscp.tmall.com%2Fpages%2Fsdigit%2Ffulfillment_realtime_inventory_good_s_ptdjd#380972.682131.682503
```

## 直接观察结果

| 对象 | 实际只读检查 | 结果 |
| --- | --- | --- |
| 文档层级 | `window === window.top` | `true` |
| 账号面板 | 顶层 `[data-spm-click="gostr=/ascp;locaid=header-right-account-name"]` | count=1；文本精确符合当前预期企业身份；`ownerDocument === document` |
| 报表根 | `.tab-content-list-item.active .fulfillment_realtime_inventory_good_s_ptdjd` | count=1；visible=true；`ownerDocument === document` |
| 报表标题 | 在上述报表根内 `getByRole('heading', {name:/库存总览.*实时/})` | count=1；innerText=`库存总览\n实时` |
| 明细语义 | 上述报表根的 innerText | 包含 `实时库存行数据` |
| 完整行数 | 上述报表根 innerText 的 `/共\s*(\d+)\s*项/g` | 唯一匹配 `共 25 项` |
| 导出 | 上述报表根内 `getByRole('button',{name:'导出',exact:true})` | count=1；enabled=true；顶层 DOM button 的 `ownerDocument === document` |
| 当前筛选 | 上述报表根内 `input:not([type="hidden"]), textarea`，按 `offsetParent!==null` 筛选 | 11 个控件；非空值 0 |

顶层 document 的 iframe 只有 `https://g.alicdn.com/platform/xdomain-storage/0.2.4/frame.html` 与 `https://xstore.insights.1688.com/index.html`，分别为跨域存储和分析组件。报表容器、标题、导出及账号元素直接由顶层 document 查询到，不在这两个 iframe 内。URL 参数名 `frameUrl` 不代表该来源页面实际使用 HTML iframe 承载业务报表，因此这里使用顶层 locator 有真实 DOM 依据。

DOM 中保留多个库存总览 H3（包含非实时/隐藏版本），故不通过原始 `querySelectorAll('h3')` 数量确定实时标题；采用已实测为唯一的语义 role/name，并限定在当前 active 报表。

## 本次复核发现与修正

全页 `input` 的 `offsetParent!==null` 并不足以排除 SPA 留存的首页控件：本次读取发现全页有 20 个此类输入，其中两个非空字段的 placeholder 分别为“起始日期”“结束日期”；它们属于留存首页，不能当作库存报表已设置筛选。

已将 `inspectWarehousePage` 的标题、正文、字段、完整行数和导出按钮统一限定到实际观察到的 active 报表根；账号校验继续使用独立页头。等待导出按钮及唯一导出点击也使用同一报表根。此修正只缩小作用域，不放行任何库存报表内的非空筛选，不新增导出行为。

新增回归覆盖：存在留存首页日期但当前报表为空筛选时允许检查；实际报表有货品筛选时拒绝；两个活动报表根并列时拒绝。复核不能替代后续专用 Profile 下的完整真实自动采集验收；本次未再次导出。
