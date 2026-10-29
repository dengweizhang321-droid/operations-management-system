"""Read-only probe: does one shop have per-shop ERP sales facts?

Answers four questions before any reader is built, so a dual-field filter that
silently matches zero rows is found now instead of after the tool is wired:

1. the dual-field condition sales/analysis.py actually uses (shop_name AND shop_key)
2. shop_name alone, to reveal whether shop_key fell back to channel/platform
3. the channels seen for that shop, to tell "no rows" from "stored under a channel"
4. the real platform spellings, since a wrong one filters to zero in silence

Chinese literals are Unicode escapes on purpose: PowerShell 5.1 reads a plain
file as GBK, and inline Chinese through `python -c` is not reliably encoded.
Run this as a file argument, never inline.

Read-only: aggregates only. No writes, no credentials printed. Requires
TERUISI_DJANGO_DATABASE_URL already present in the shell.
"""
import io
import os
import sys

import django

PLATFORM = "京东"
SHOP = "志高商用设备旗舰店"
KEYWORD = "商用"


def main():
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
    # The script lives outside backend/, so cwd does not put teruisi_backend on
    # sys.path. Take the backend root from the environment when given, else fall
    # back to the current directory, so this runs from either checkout.
    backend = os.environ.get("TERUISI_BACKEND_ROOT") or os.getcwd()
    if backend not in sys.path:
        sys.path.insert(0, backend)
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "teruisi_backend.settings")
    django.setup()

    from django.db import connection
    from django.db.models import Count, Max, Min

    from sales.models import SalesOrderLine as S

    info = connection.settings_dict
    print("connection: vendor=%s user=%s host=%s port=%s" % (
        connection.vendor, info.get("USER"), info.get("HOST"), info.get("PORT")))
    if connection.vendor != "postgresql":
        print("REFUSED: not PostgreSQL. Load the production read-only env first.")
        return 2

    base = S.objects.filter(is_business_row=True)

    dual = base.filter(platform=PLATFORM, shop_name=SHOP, shop_key=SHOP).aggregate(
        rows=Count("id"), first=Min("business_date"), last=Max("business_date"))
    print("1. dual-field (platform+shop_name+shop_key): %s" % (dual,))

    by_name = base.filter(shop_name=SHOP).aggregate(
        rows=Count("id"), first=Min("business_date"), last=Max("business_date"))
    print("2. shop_name only: %s" % (by_name,))

    channels = list(base.filter(shop_name=SHOP)
                    .values_list("channel", flat=True).distinct()[:10])
    print("3. channels for this shop: %s" % (channels,))

    platforms = list(base.values_list("platform", flat=True).distinct()[:12])
    print("4. platform spellings in facts: %s" % (platforms,))

    shops = list(base.filter(shop_name__contains=KEYWORD)
                 .values_list("shop_name", flat=True).distinct()[:12])
    print("5. shop_name values containing the keyword: %s" % (shops,))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
