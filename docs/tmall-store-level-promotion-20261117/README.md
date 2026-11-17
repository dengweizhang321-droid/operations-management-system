# 天猫店铺级推广（店铺直达）单列店铺级花费

## 问题

天猫丽力店自 2026-11-11 起开通阿里妈妈“店铺直达”。推广“商品报表”（商品、计划维度）出现主体类型为“店铺”、主体ID 355577887、主体名称“店铺首页”的行。`prepareTmallPromotionRows` 对同日同主体多行只接受“商品”主体，抛出“计划维度包含非商品主体，拒绝汇总”，丽力推广数据自 2026-11-12 起整天导入失败。另有隐患：某天店铺级只有 1 行时，会被当成商品 355577887 直接导入。

## 口径（用户已定）

店铺级花费计入店铺推广总额，但不分摊到任何商品，并能单独看出。

- 主体类型为“店铺”的行不生成商品级推广事实：不进 `netshop_promotion_product_daily`，不计 `product_count`，不在商品对象、贡献榜和商品洞察中出现。
- 它们的花费、成交、展现、点击等可加指标计入店铺日汇总 `netshop_promotion_shop_daily`。
- 只有“店铺”是已知非商品类型。其他未知非商品主体类型仍失败关闭，保留原文案“计划维度包含非商品主体”。

## 方案（不需要数据库迁移）

- 行身份：店铺级行的 `spu_id` 固定为 `店铺:<主体ID>`。`店铺:` 前缀不可能出现在纯数字商品 ID 中，所以店铺 ID 与商品 ID 数字相同也不冲突（行键、指纹、读取侧按 `spu_id` 过滤都分得开）。原始行照常保存在 `netshop_rows`，`raw_json` 保留主体类型和主体名称。
- Worker（`lib/netshop/normalized-import.ts`）：店铺主体行按“日期 + 店铺主体”单独汇总，不与商品行合并；单行店铺主体也走同一身份；解析统计仅在含店铺级行时多出 `storeLevel*` 三项。
- Django 写入侧（`backend/netshop/import_service.py`、`promotion_subjects.py`）：逐行复核身份约定，伪造方向（商品冒充店铺、店铺冒充商品、前缀与主体ID不符）均拒绝；重建聚合时店铺级行只累加到店铺日汇总。`raw_row_count` 含店铺级行、`product_row_count` 与 `product_count` 不含。货品主数据核对与 `uniqueProductCount` 排除店铺主体。
- 读取侧：推广洞察（`promotion_insights.py`）把店铺级行排除出商品对象集合，单独汇总后并入店铺总额核对，并新增 `sections.storeLevel`（仅含店铺级行时出现）；旧推广概览（`query.py`）用“店铺日汇总 − Σ商品日汇总”推出 `summary.storeLevel`。前端在推广经营页和店铺分析“推广花费”卡片展示“其中店铺级推广（未分摊到商品）”。
- 没有店铺级行的文件、店铺和历史数据：导入行、指纹输入、聚合和响应与改动前逐字一致（测试用基线与分支同输入的摘要钉住）。

## 续接

丽力活动清单停在 `downloading`，清单未冻结汇总后行数。恢复时 `inspectTmallPromotionFile` 对本地 ZIP 现算行数并写入清单，之后导入批次行数与该现算值比对，因此改动上线后下一次定时可自动通过，不需要人工动清单。

## 测试

- `tests/tmall-promotion-store-level.test.ts`、`tests/tmall-promotion-store-fixtures.ts`
- `backend/netshop/tests/test_promotion_store_level.py`
