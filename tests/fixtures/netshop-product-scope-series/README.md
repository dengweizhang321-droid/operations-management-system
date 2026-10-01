# 商品经营序列合成PG回执

五份JSON是ProductScopeSeriesTests在独立动态PostgreSQL最终run04返回的原字节信封。A/B店、商品、金额、访客和身份均为合成fixture；无生产、客户原始记录或凭据。

产生端backend/netshop/product_scope_series.py，消费端lib/netshop/product-scope-series-contract.ts。信封带query、owningRevision和原body，Node直接把实际body给decoder，不复写业务实现。

来源：E:\codex-artifacts\netshop-scheme2-20261001\product-scope-series\author-20261001T103429+0800-7e7b9f60e2e54c5dbe2c0b5c2d024df5\pg-run04\foundation-pg-0ba5034c9e5f\capacity。run02旧样本留原E，来源与更新摘要在fixture-provenance-run04.json。

最大1099点series-max-response.json仅在E；设置TERUISI_PRODUCT_SERIES_PG_FIXTURE_ROOT到每run capacity运行全部11项。未设置时使用本目录小fixture，10通过、最大外部DTO明确skip。合成/私有PG不等同真实来源、UI或生产采用。
