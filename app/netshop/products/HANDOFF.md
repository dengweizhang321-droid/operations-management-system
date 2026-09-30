# 商品表现 P：接口与来源交接

2026-10-01。阶段：商品范围及公共顶部导航补充独立复核通过，可交 I 集成。此文件不表示 main 已合并或生产采用。

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

最终 v1 固定要求 counts/structure/efficiency/dataQuality/metadata、完整 changes、访客值及两期访客值比较；详情固定要求 extras/访客值/两期比较/SKU关系状态及所请求的日明细或趋势。HTTP200 丢字段属于协议错误，不能伪装为来源缺失。全部经营行及非空档案提供 `imageStatus=available|missing|unverified`：available 须可靠当前精确身份及链接；未核验图片身份不标为缺图。

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

旧目录新筛选 `status/quality/mapping` 通过 `backend/netshop/catalog_filters.py` 在完整、已授权 latest-master 集合上分页前执行；没有新参数时原 QS/token 语义不变。带新参数时 I 将 scope/sourceVersion/asOfDate/policy/当前图片身份规则绑定进原 token。非 all 关联筛选没有可靠当前 Lookup，明确 422。JD 编码图片回退须同店、规范 yimei_sku、最新已完成所属批次、完整 master/asset 集合各唯一，并由 I 证明 canonical 字段能力；P 不自行授予该能力。证据不足则缺图筛选不可用，图片标为身份未核验。

P 目录第一次明确传 all/all/all opt-in，读取 I 的真实 catalogFilters/capabilities 与四来源 catalogSnapshotDates。目录先 full bootstrap，再 view=page 携带该 exact snapshot；summary/meta 只在同账号、范围和 token 下保留。full/page 均核验同类型 owning header，不能拿 opaque snapshot 与 owning revision 互比。变化清引用、至多一次 full 恢复；缺/非法头拒读。目录筛选通过可选 catalogFilters 进入唯一共享 products-ui-v1 namespace，变更回第一页，返回恢复原筛选与页码。

单品推广联动必须 shared supportsPromotionProductDrill 能力启用、映射 verified 且同源适用维度（JD SKU/TM SPU），并由 A 的精确 productIdentity 全源 lookup 生效后验收。M3 此能力为 false，单品按钮禁用；整店入口明确“查看店铺推广”且 product=null。未合入 A 增强不引用在途 A 组件，不以模拟结果正式交付。

## 证据与最终状态

证据均为独立 worktree、独立依赖、合成源私有 PostgreSQL 或隔离 UI。角色目录为 `E:\codex-artifacts\netshop-scheme2-20261001\products\{lead,query,ui,review}`，每轮唯一、CreateNew，测试轮数不相加冒唯一测试数。

- Root 当前独立 PG：`lead/products-pg-d3d9cf7c69648469dba2`，四个直接 class、104 passed、SystemCheck 0、端口 65166 正常停止。包括真实跨页匹配、全源增长排序、身份/版本/每条 SQL 前后预算、缺数/映射/目录 predicates，以及真实 signed 两个 GET/owning header/401/403/405/409。
- Root 同轮实际 PG wire：`lead/wire-4206bde0-daad-4138-bd32-0f2e13cdf125`，两个真实 DTO decoded、30 个深层错误拒绝。先前 84 轮包含导入 TestCase 的重复 discover，仅为实跑次数；已经修正模块引用，不将各轮相加。
- Root 最新合同/adapter/公开桥/严格枚举/UI 状态共 38 Node passed，`lead/node-final-7141ab6677c143f48de7961c5ab34774`。全库 typecheck exit2，188 条继承诊断、P 新增 0，`lead/types-61118d62081f4a259d7728981f75b572`。
- Root 完整组件 35 合成 UI 检查通过、运行异常 0，`lead/ui/20260930T222756889Z-8048d2f1-b211-4d7f-baeb-de9fcfd00c02`（桌面/390/320 截图与 shutdown.json）；不称真实业务源 UI。真实 slot 隔离构建 exit0，`lead/build-9269df1d45344ab1ac2f335463c8d8e6`；lint exit0/一个 native img 既有规则警告、boundary exit0，`lead/lint-boundary-c3abfa5787d045879dc0bb798289af21`。
- 后端作者 clean `9e323618` 为 100 个直接标签实际通过。UI 作者 clean `b2ab9197` 为最新 35 个合成界面检查，无运行异常；相关 Node/构建与边界证据见作者 delivery。它们不代替 Root/Q 最终组合。
- Q 独立中间组合 `008fad94`：自己的私有 PG 112 个实际唯一测试全过、SystemCheck 0、端口 56369 正常停止（P core/detail/catalog/HTTP + I 目录实际接线 + Q 4 方法），两真实 wire + 15 独立错误拒绝。已关闭预算、单位/向量、权限、严格枚举、基期失败、质量单位与缺失固定节等 P2；最终 UI/公共组合 fresh SHA 复核在途。证据 `review/products-review-pg-cb81a67cb5e3d563370beac3`、`review/products-review-wire-2011cbd6-606d-47ca-9256-964906e2bed2`。

5,001 源行/501 商品/1 店/10 日的控制金额 5,001,000 分与查询一致；Q 同轮 58 SQL、741,468 UTF-8 字节，有 ANALYZE/BUFFERS 计划。仅为该合成规模，不声明生产 P95。

公共串行候选：I `c581a34f` 两 GET/SDK/65s 期限；`115ef577`/`6823edc2` 绑定偏好/裸返回；`d549a24e` 可选目录筛选与 M4 门禁；`e5b3b02a` 原目录分页前 predicate/opt-in 四快照/owning header/产品 slot 与标签；`2f5244ab` 共享 Metric 四枚举严格字符串；`43bdf332` 包含 AI 完整夹具、JD 当前编码图片能力、promotionPrefs 可选公共协议与正确三 CSS Home 工具。这些来自 I 正常合并，P 没有抢写公共文件。正式 TopNav 在 AppShell 顶部 section 与 layout 三份样式实现，不能因旧 prop 名 sidebar 判断为左栏。

最后目录兼容修正：保留 legacy truncated 仅分页提示的语义（正常分页 true 可用），UI 由 page/pageSize/total/returned 计算 hasMore；batch.completedAt 保持原 string|null。没有改旧 API、金额、身份、来源头或 token 规则。作者 clean `985444d2`，Q 两套真实 signed PG full/page 控制与负向复验闭合。Root 自己的解码回放 `lead/catalog-wire-5ffa9440-4f11-4d42-bb72-e46af85b4989` 明确源为 Q 合成私有 PG，不能称 Root 新 PG 测试。

最终产品代码候选 `1aa14822a37fa7fecd5ee5e044749b5a4cc2d65d`：Root 48 相关 Node passed（含完整 AI fixture 与 promotionPrefs）；自己的最新 35 组件检查 `lead/ui-final/20260930T225413294Z-28d68fac-a796-4b8d-885f-a7ec5db93a58` 以及真正 Home 三 CSS 的 15 检查 `lead/integrated-ui/20260930T225413626Z-4a87b18c-d383-4dc6-8346-14b68cb40e26` 均 passed，browser/server shutdown 正常。Desktop masthead 高 66px、workspace x0/y66，无左栏占位；390/320 切换真实菜单、不溢出。

Q 商品范围最终私有报告：`review/products-review-final-private-b5d0af1dbf8045ca935c0add80097738/{README.md,record.json,source-hashes.json}`，Q clean `153a816781e2a7fc6644313aaa4977234eca12d1`，绑定产品候选 1aa 与 69 文件摘要。Q 自己 fresh 62 Node、build/boundary/lint exit0、39 组件 UI、15 Home UI；最新实际 signed 目录 PG 7 测试/normalstop，真实 full/page 两控制+10错误拒绝。商品私有 P1/P2 已闭合。没有重复核心无变化 PG 或累加测试轮数。

公共顶部导航 P2 已闭合：I 唯一 CSS 补丁 `6abe3202dd4bfb80f83f9975b1748128c985bb7d` 恢复被全局窄屏 caption 规则隐藏的汉堡 glyph，Root 正常继承为 `013b53aa3f024c6662693cda5187cbb85a12e379`。Q clean `e37264029bb63f9d591591e6370d2201ac487e7f` 定向真实 Home 17 检查通过：390/320 glyph 可见、20px、有实际尺寸；菜单展开、Escape 关闭、aria 与无溢出均通过，browser/server 已关闭。独占证据 `review/20260930T231419736Z-6ba39e38-98c4-40a1-835e-0917dd097faf`；失败历史保留，不冒称旧假左栏或 blank glyph 图通过。没有重复无变化核心 PG。

Q 最终补充批准回执 `review/products-review-final-supplement-ea82ecec9c714daea7efc8e8fdbecb84/{README.md,record.json,source-hashes.json,actual-home-compile-source.json,resources-closed.json}`：批准商品候选 013b 的 P M3 与公共顶部导航，无剩 P0/P1/P2。69 源码与此前批准 1aa 相比，仅 top-navigation.css 变化、其余 68 逐字相同；随后 P 交接只增加文档/解码回放工具，无运行源码变更。资源审计 `review/products-review-resource-audit-7b5e8549790f47488afaf1c8b39b7171` 记录全部 Q 10 PG/8 UI 正常关闭，含失败历史。

分支 `codex/netshop-products`，Root 工作树 `D:\.codex\worktrees\netshop-products\运营管理系统`。后端/UI/Q 的独立分支和工作树继续保留给 I；只推栏目分支，不自行合 main。最终源码 SHA、截图、基线失败对照和 Q 结论在最后一次交接补齐。

| Teammate | 分支 / 工作树 | 当前干净提交 |
| --- | --- | --- |
| 后端 `/root/content_mapping` | `codex/netshop-products-query` / `D:\.codex\worktrees\netshop-products-query\运营管理系统` | `9e323618398a7f94b18cc06955541da79c2a6e25` |
| 页面 `/root/products_ui` | `codex/netshop-products-ui` / `D:\.codex\worktrees\netshop-products-ui\运营管理系统` | `985444d2951d54a243d11a0c2cc1fca5bd7c40c1` |
| 独立复核 `/root/design_references` | `codex/netshop-products-review` / `D:\.codex\worktrees\netshop-products-review\运营管理系统` | 商品私有 `153a8167`、导航补充 `e3726402`，只写 Q 测试/工具 |

P 目前代码候选 `4c94925aaff7737e91e5aeae99274b2787d2cd12`，后续交接文档或 I 公共修正会生成最后 SHA。Root/作者所有私有 PG 正常停止；自身 mock UI 服务和临时浏览器已关闭。3120/18120/18121/13120 保留端口未启用。外部唯一选定 Demo 57873 按用户预览保留；清理全部交 I 按任务/资源归属执行。

忽略文件保全：各角色自有 node_modules、.runtime、.wrangler、dist/构建产物暂留树内给 I；不得当作无改动即删除。非敏感必须留存的 SQL/计划、wire、日志、截图、源码/依赖摘要和资源回执已写外部 E 各角色目录，禁止覆写。Q 独立回归测试/工具在 review 子分支，I 计划正常合并其祖先供最终远端包含性和安全归档；P 不代替 I 清理或合 main。

UI 作者曾跑全库 2866（2832 pass、14 fail、20 skip）；精确 main39bc 同文件复现 13 个失败，另一个 managed PowerShell whole-run 失败在作者单文件 38/38 中未复现，不能称根因已修复。此候选相关检查与构建通过，不声称全库测试/类型全绿。正式 来源、历史 ERP 映射、历史 SKU 关系及 A 精确钻取组合限制保持上述准确缺失态。

未执行生产部署、生产迁移、正式服务启停、真实下载导入、人工映射修改、商品合并删除、补跑、外部通知或付费模型调用。
