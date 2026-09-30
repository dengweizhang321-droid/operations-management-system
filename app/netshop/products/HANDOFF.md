# 商品表现 P：接口与来源交接

2026-10-01。阶段：隔离候选，最终组合与独立复核在途。此文件不表示 main 已合并或生产采用。

用户已选择唯一“均衡经营台”。顶部系统/栏目导航的冻结设计由 I 接入；P 组件不复制第二套导航。三个页签为经营表现、单品详情、货品档案，保留 `view=products`，经营默认 SPU。

## 内容与准确缺失态

| 内容 | 实现和消费边界 | 来源/限制 |
| --- | --- | --- |
| 4.1 商品概况 | `sections.summary/counts` 完整全局及类目筛选集合；商品有数据/成交数、成交额/件数、客户/访客累计、退款 | 京东 SKU/SPU 日、天猫 SPU 日；SKU/SPU 独立。商品×日累计人数不冒充店铺去重人数 |
| 4.2 贡献增长 | `structure` 完整集合集中度、类目、成交均价价格带、成交资格、金额贡献；`growth` 服务端完整配对后排序分页 | 本期商品精确四段身份查基期，查询词只筛商品表；缺报不补 0。类目只源标签，无官方类目 ID/历史归属证明 |
| 4.3 流量效率 | 原字段 presence、加权转化/加购率、公开 minimumVisitors/maximumConversion/requireComplete 规则及分页关注清单 | 加购率为加购人数累计/访客累计；缺人数不能用加购件数替代。访客价值使用独立 `netshop-money-per-count-v1` |
| 4.4 推广与 ERP | 分源指标、映射状态/依据/缺口；不跨源相加 | 仅可信已完成精确同店对象推广可用。JD SPU 缺历史 SKU 关系时不可用。ERP 历史净额/成本/毛利映射未证实，值为空，不按 0 成本制造高毛利 |
| 4.5 单品档案 | 精确身份/图片、编码类目规格、两期成绩、分组趋势与当前快照 | 当前库存/价格不是历史。SPU 下 SKU 历史贡献保留不可用，需实际有时效的关系证据；不套用当前目录关系 |
| 4.6 逐日明细 | `daily/trends` 按平台/推广/ERP分别请求，分页、范围、完整来源向量与字段说明 | 当前 API 返回本期日序列；没有提供的基期序列不由整期金额均摊伪造 |
| 4.7 货品资料 | 复用原 `/api/netshop/products` 当前目录字段、京东 SKU/SPU、图片、搜索、列设置、分页、价格库存和导入入口 | 天猫 SKU 主数据仅当前资料，不生成 SKU 日经营。各来源快照分开标注；原受信当前 ERP Lookup 保留 |
| 4.8 资料质量 | 缺图/码/类目、冲突、陈旧、未关联只读呈现，服务端完整 latest-master predicate | 陈旧为业务日距快照严格超过 30 天；缺日期为未知。未核关联不等于核查未匹配；不支持的 predicate 明确 422 |

新增表列：平台销售额（元）、销量（件）、访客累计（人次）、转化率、加购率、销售额同比、销售额环比及环比基期金额。同比/环比使用共享真实比较日历。金额传安全整数分，UI 除以 100；RATIO 显示百分比，比率变化为百分点。零/负/缺基期均无普通增长百分比。

## 两个专属只读接口

- `GET /api/netshop/product-insights`
- `GET /api/netshop/product-insights/detail`

协议 `netshop-product-insights-v1`，继承共享 `netshop-insights-v1` context。共享参数为显式 `platform`、精确 `outlet=平台+U+001F+店名`、`dimension=sku|spu`、必填自然日起止、`periodKind` 和可选共享 `snapshotToken`。本期最多 366 天、最多 50 店，不自报权限。

列表专属参数：`q/category` 各至多 120 字符、`page` 1—10000、`pageSize` 1—100、`sort` 和可选 `sectionToken`。排序仅 `payment_desc/payment_asc/visitors_desc/visitors_asc/conversion_desc/conversion_asc/growth_desc/decline_desc`。

详情须一个平台、一个精确店、同维度 `productIdentity=JSON[平台,店名,维度,ID]`。`section=overview|trends|daily|catalog|sku|promotion|erp`；`source=platform|promotion|erp` 仅用于 daily/trends。不按名称、模糊 ID 或跨店同 ID 匹配。

`sectionToken` 绑定权限/实际范围/表内查询/类目/排序/页大小/详情身份/分区来源及参与来源向量，页码可以变化，页大小变化须重读。共享 owning revision 必须与响应头 `X-Netshop-Data-Revision` 同类型匹配，不能拿两个不同类型 token 互比。

普通 503 可单独保留可靠本期；所有分区的 `access_denied`、`insights_revision_changed` 必须整读失败为 403/409。失败基期不能保留可用比较或基期数值。UI 同一范围读与一次 409 恢复共用 90 秒，内部整个 reader 保持共享 65 秒期限、SQL 原边界和 2MiB UTF-8 上限。权限读取前后复核，未知、重复、越权、不支持范围拒绝，无 writer 或权限扩张。

## S/C 的消费样例

```ts
import { encodeProductIdentity } from "@/lib/netshop/insights-contract";
import { loadProductInsights, loadProductDetail } from "@/app/netshop/products/data";

const query = new URLSearchParams({
  platform: "京东", outlet: "京东\u001f合成店A", dimension: "spu",
  startDate: "2026-09-01", endDate: "2026-09-30", periodKind: "custom",
  page: "1", pageSize: "20", sort: "payment_desc",
});
const abort = new AbortController();
const products = await loadProductInsights(query, abort.signal);
// 汇总/贡献直接来自服务端完整集合，不从 products.sections.items 求总计。
const summary = products.sections.summary;
const contribution = products.sections.structure?.changes;
const context = products.context;
const versions = products.joinedSourceRevisions;

const identity = { platform: "京东", shopName: "合成店A", dimension: "spu", id: "合成P01" } as const;
const detailQuery = new URLSearchParams(query);
detailQuery.set("productIdentity", encodeProductIdentity(identity));
detailQuery.set("section", "daily");
detailQuery.set("source", "platform");
const detail = await loadProductDetail(detailQuery, abort.signal);
// S/C 仍须保留 owning context、参与来源向量与 revision_vector_checked；
// 单接口前后向量检查不意味着跨域数据库原子事务。
```

列表筛选词作用域为 `identity_title_code_only`；概况/贡献作用域为 `global_category_filtered`。跨域服务不能借当前一页排行拼全店汇总。UI 返回偏好通过 I 的单一 `products-ui-v1` history namespace 绑定账号与实际日期/店集合/维度，不能把 URL 中的偏好当权限。

## 公共所有权与组合依赖

P 仅修改专属目录、专属 API/服务、测试和工具。Django 路由/公共 reader SDK/旧目录 query 与参数/权限/gateway/中央 AI/shell/slot/顶部导航/history 均由 I 串行应用。

旧目录新筛选 `status/quality/mapping` 通过 `backend/netshop/catalog_filters.py` 在完整、已授权 latest-master 集合上分页前执行；没有新参数时原 QS/token 语义不变。带新参数时 I 将 scope/sourceVersion/asOfDate/policy 绑定进原 token。非 all 关联筛选没有可靠当前 Lookup，明确 422。图像 code fallback 的安全身份与旧显示一致性仍待本轮组合修正/复验。

单品推广联动必须 verified 且同源适用维度（JD SKU/TM SPU），并由 A 的精确 productIdentity 全源 lookup 生效后验收。不可用时禁用单品按钮；如提供整店入口，标签明确“查看店铺推广”且 product=null。未合入 A 增强不引用在途 A 组件，不以模拟结果正式交付。

## 证据与最终状态

证据均为独立 worktree、独立依赖、合成源私有 PostgreSQL 或隔离 UI。角色目录为 `E:\codex-artifacts\netshop-scheme2-20261001\products\{lead,query,ui,review}`，每轮唯一、CreateNew，测试轮数不相加冒唯一测试数。

- Root 当前独立 PG：`lead/products-pg-8585ccb8714788e32e1f`，84 passed、SystemCheck 0、端口 59665 正常停止。包括真实跨页匹配、全源增长排序、身份/版本/预算/缺数/映射及目录 predicates。
- Root 同轮实际 PG wire：`lead/wire-89f4b9bc-b1b7-4b24-b6a7-cb26aecfd86c`，两个真实 DTO decoded、17 个深层错误拒绝。
- Root 私有 Node 合同/adapter 12 passed；相关 lint 0。全库类型继承 188 条诊断，P 先前 checkpoint 新增诊断 0；最终组合类型/构建尚待。
- 作者 PG 84、UI harness/独立 Q 证据另见各自结果。Q 当前已关闭旧 daily 单位/向量和嵌入权限问题，最终 UI/catalog/public 联动候选尚待 fresh SHA 独立复核。

分支 `codex/netshop-products`，Root 工作树 `D:\.codex\worktrees\netshop-products\运营管理系统`。后端/UI/Q 的独立分支和工作树继续保留给 I；只推栏目分支，不自行合 main。最终源码 SHA、截图、基线失败对照和 Q 结论在最后一次交接补齐。

未执行生产部署、生产迁移、正式服务启停、真实下载导入、人工映射修改、商品合并删除、补跑、外部通知或付费模型调用。
