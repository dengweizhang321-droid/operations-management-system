"""Owned synthetic facts and publication fixtures. Never used by runtime."""
from netshop.models import (NetshopImportBatch, NetshopRow, NetshopPromotionShopDaily,
    NetshopPromotionProductDaily, NetshopPromotionAggregateState, NetshopPromotionAggregateManifest)


def add_day(owner, *, shop="A", day="2026-09-01", platform="京东", promotion=True, rows=None):
    owner.counter += 1
    source = ("jd_promotion" if platform == "京东" else "tmall_promotion") if promotion else ("jd_sku_daily" if platform == "京东" else "tmall_product_daily")
    dataset = ("ad" if platform == "京东" else "promotion_daily") if promotion else ("sku_daily" if platform == "京东" else "spu_daily")
    if rows is None:
        rows = [{"id": "same", "values": {"spendCents": 200, "netTransactionAmountCents": 400, "impressions": 100, "clicks": 2, "netOrders": 1}}] if promotion else [{"id": "same", "values": {"transactionAmountCents": 1000}}]
    batch_id = "promotion-fixture-"+str(owner.counter)
    batch = NetshopImportBatch.objects.create(id=batch_id, source=source, dataset=dataset, platform=platform, shop_name=shop,
        file_name="synthetic", file_size_bytes=10, file_hash=f"{owner.counter:064x}", raw_file_hash="a"*64,
        content_hash="b"*64, scope_key="c"*64, status="completed", row_count=len(rows),
        date_min=day, date_max=day, created_at="2026-09-01T00:00:00Z", completed_at="2026-09-01T00:00:00Z")
    columns = {"spendCents": "spend_cents", "netTransactionAmountCents": "net_transaction_amount_cents",
        "impressions": "impressions", "clicks": "clicks", "netOrders": "net_orders", "transactionAmountCents": "transaction_amount_cents"}
    sums = {c: 0 for c in ("spend_cents", "net_transaction_amount_cents", "impressions", "clicks", "net_orders")}
    products = {}
    created = []
    for i, values in enumerate(rows):
        metrics = values.get("values", {})
        typed = {columns[k]: v for k, v in metrics.items() if k in columns and type(v) is int}
        typed.update(values.get("typed", {}))
        product_id = values.get("id", "same")
        row = NetshopRow.objects.create(source_row_key=batch_id+"-"+str(i), source_row_hash="d"*64,
            first_import_batch_id=batch_id, last_import_batch_id=batch_id, source_row_number=i+2, source=source,
            dataset=dataset, platform=platform, shop_name=shop, business_date=day, sku_id=product_id if platform == "京东" else "",
            spu_id=values.get("spu", "SPU-"+product_id) if platform == "京东" else product_id,
            product_name=values.get("title", "合成商品"), raw_json=values.get("raw", {}), metrics_json=metrics, **typed)
        created.append(row)
        if promotion:
            cell = products.setdefault(product_id, {c: 0 for c in sums} | {"count": 0})
            cell["count"] += 1
            for c in sums:
                sums[c] += getattr(row, c)
                cell[c] += getattr(row, c)
    if promotion:
        NetshopPromotionAggregateManifest.objects.update_or_create(platform=platform, defaults={"ready": True, "data_version": 1})
        NetshopPromotionShopDaily.objects.create(platform=platform, shop_name=shop, business_date=day, source=source,
            source_row_count=len(rows), product_count=len(products), source_batch_id=batch_id, source_batch_count=1, **sums)
        NetshopPromotionAggregateState.objects.create(platform=platform, shop_name=shop, business_date=day, source=source,
            ready=True, raw_row_count=len(rows), product_row_count=len(products), source_batch_id=batch_id, source_batch_count=1)
        for product_id, values in products.items():
            NetshopPromotionProductDaily.objects.create(platform=platform, shop_name=shop, business_date=day,
                product_id=product_id, source=source, source_row_count=values["count"], source_batch_id=batch_id, source_batch_count=1,
                product_name="合成商品", **{c: values[c] for c in sums})
    return batch, created
