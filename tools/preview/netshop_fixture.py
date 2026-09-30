"""Deterministic, explicitly synthetic netshop fixtures; private SQLite only."""
from datetime import timedelta
import hashlib


def seed_netshop(today, stamp):
    from django.db import connection
    from netshop.models import NetshopRow, NetshopDataRevision, NetshopImportBatch, NetshopPromotionAggregateManifest, NetshopPromotionAggregateState, NetshopPromotionShopDaily, NetshopPromotionProductDaily
    if connection.vendor != "sqlite" or ".runtime" not in str(connection.settings_dict["NAME"]) or "preview" not in str(connection.settings_dict["NAME"]):
        raise RuntimeError("Netshop synthetic fixture requires private preview SQLite")
    anchor = today.replace(day=1)
    for platform, count in [("天猫", 6), ("京东", 4)]:
        prod_source = "tmall_product_daily" if platform == "天猫" else "jd_sku_daily"
        prod_dataset = "spu_daily" if platform == "天猫" else "sku_daily"
        promo_source = "tmall_promotion" if platform == "天猫" else "jd_promotion"
        promo_dataset = "promotion_daily" if platform == "天猫" else "ad"
        NetshopPromotionAggregateManifest.objects.update_or_create(platform=platform, defaults={"ready": True, "data_version": 1, "completed_at": stamp})
        rows, promotions, products, states = [], [], [], []
        for i in range(count):
            shop = f"合成演示店铺{i+1}"
            for source, dataset in [(prod_source, prod_dataset), (promo_source, promo_dataset)]:
                digest = hashlib.sha256(f"synthetic:{platform}:{shop}:{source}".encode()).hexdigest()
                NetshopImportBatch.objects.create(id=digest, source=source, dataset=dataset, platform=platform, shop_name=shop, file_name="合成预览数据", file_size_bytes=0, file_hash=digest, raw_file_hash=digest, content_hash=digest, scope_key=digest, status="completed", created_at=stamp, completed_at=stamp)
            for j in range(-40, (today-anchor).days):
                day = anchor + timedelta(days=j)
                try: prior_year_day = day.replace(year=day.year-1)
                except ValueError: prior_year_day = None
                for business_day in (day, prior_year_day) if prior_year_day else (day,):
                    amount, visitors, customers = (i+2)*170000 + ((j+40)%11)*22000, (i+2)*90 + ((j+40)%7)*9, (i+2)*4 + ((j+40)%4)
                    spend, attributed = amount//10, amount//2
                    for source, dataset, metrics, typed in [(prod_source, prod_dataset, {"transactionAmountCents": amount, "visitors": visitors, "transactionCustomers": customers}, {"transaction_amount_cents": amount, "visitors": visitors, "transaction_customers": customers}), (promo_source, promo_dataset, {"spendCents": spend, "netTransactionAmountCents": attributed}, {"spend_cents": spend, "net_transaction_amount_cents": attributed})]:
                        batch = hashlib.sha256(f"synthetic:{platform}:{shop}:{source}".encode()).hexdigest()
                        key = hashlib.sha256(f"{batch}:{business_day}".encode()).hexdigest()
                        rows.append(NetshopRow(source_row_key=key, source_row_hash=key, first_import_batch_id=batch, last_import_batch_id=batch, source_row_number=j+42, source=source, dataset=dataset, platform=platform, shop_name=shop, business_date=str(business_day), sku_id=f"SYNTHETIC-SKU-{i}", spu_id=f"SYNTHETIC-SPU-{i}", metrics_json=metrics, raw_json={"fixture": "synthetic-preview-only"}, created_at=stamp, updated_at=stamp, **typed))
                    promotions.append(NetshopPromotionShopDaily(platform=platform, shop_name=shop, business_date=str(business_day), source=promo_source, spend_cents=spend, net_transaction_amount_cents=attributed, product_count=1, source_row_count=1, source_batch_id=batch, source_batch_count=1, rebuilt_at=stamp))
                    products.append(NetshopPromotionProductDaily(platform=platform, shop_name=shop, business_date=str(business_day), source=promo_source, product_id=f"SYNTHETIC-SKU-{i}" if platform == "京东" else f"SYNTHETIC-SPU-{i}", product_name=f"合成商品{i+1}", spend_cents=spend, net_transaction_amount_cents=attributed, source_row_count=1, source_batch_id=batch, source_batch_count=1, rebuilt_at=stamp))
                    states.append(NetshopPromotionAggregateState(platform=platform, shop_name=shop, business_date=str(business_day), source=promo_source, ready=True, raw_row_count=1, product_row_count=1, source_batch_id=batch, source_batch_count=1, rebuilt_at=stamp))
        NetshopRow.objects.bulk_create(rows)
        NetshopPromotionShopDaily.objects.bulk_create(promotions)
        NetshopPromotionProductDaily.objects.bulk_create(products)
        NetshopPromotionAggregateState.objects.bulk_create(states)
    NetshopDataRevision.objects.update_or_create(domain="netshop", defaults={"revision": 1, "source_digest": hashlib.sha256(b"synthetic-netshop-preview-v1").hexdigest()})
