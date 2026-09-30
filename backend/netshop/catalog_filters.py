"""Product-owned, fail-closed predicates for the existing current catalogue.

I calls these on the complete, scope-authorized latest-master queryset before
search/sort/pagination and binds ``catalog_filter_binding`` into the existing
snapshot only for requests containing a new filter parameter. No new route,
writer, lookup, taxonomy, source or ERP matching rule is introduced here.
"""
from __future__ import annotations

from datetime import date, timedelta
import re

from django.db.models import BooleanField, Case, Count, Exists, F, OuterRef, Q, Subquery, Value, When
from django.db.models.fields.json import KeyTextTransform
from django.db.models.functions import Coalesce, NullIf, Trim

from .errors import NetshopApiError
from .models import NetshopImportBatch, NetshopRow


CATALOG_FILTER_VERSION = "netshop-product-catalog-filter-v1"
CATALOG_STALE_AFTER_DAYS = 30
CATALOG_STATUS_VALUES = {"all", "on_sale", "off_sale", "unknown"}
CATALOG_QUALITY_VALUES = {"all", "missing_image", "missing_code", "missing_category", "conflict", "stale", "unverified_mapping"}
CATALOG_MAPPING_VALUES = {"all", "verified", "unmapped", "ambiguous", "unverified"}
# 上架 is the exact value already used by the existing catalogue on-sale count.
# 下架 is the explicit inverse label; other values stay unknown, not stock-based.
ON_SALE_VALUES, OFF_SALE_VALUES = ("上架",), ("下架",)
CATALOG_FIELD_ALIASES = {
    "status": {"projection": "product_status", "source": ["商品状态"], "onSale": list(ON_SALE_VALUES), "offSale": list(OFF_SALE_VALUES)},
    "catalogCode": {"sourcePrecedence": ["SKU商家编码", "商品编码", "product_code"], "notErpMappingProof": True},
    "category": {"projection": "category", "source": ["类目名称", "一级类目", "二级类目", "三级类目", "末级类目"]},
    "snapshot": {"projection": "snapshot_date", "unknownIsStale": False, "greaterThanDays": CATALOG_STALE_AFTER_DAYS},
    "image": {"projection": "image_url/image_content_sha256", "relatedSources": ["jd_yimei_sku", "tmall_product_assets"], "identity": "platform+exact_shop+SKU_or_SPU+latest_completed_batch"},
    "conflict": {"identity": ["platform", "shop_name", "source", "dataset", "sku_id"], "fields": ["spu_id", "product_name", "catalog_code", "sale_attribute", "category", "brand", "product_status", "price_cents"]},
    "mapping": {"supportedPredicates": ["all"], "reason": "no_verified_current_erp_lookup"},
}


def validate_catalog_filters(params):
    """Validate only I's three approved extra parameters, not legacy parameters."""
    values = {}
    for key, allowed in (("status", CATALOG_STATUS_VALUES), ("quality", CATALOG_QUALITY_VALUES), ("mapping", CATALOG_MAPPING_VALUES)):
        supplied = params.getlist(key)
        if len(supplied) > 1 or supplied and supplied[0] not in allowed:
            raise NetshopApiError("目录筛选包含无效或重复的" + key)
        values[key] = supplied[0] if supplied else "all"
    return {**values, "requested": any(key in params for key in ("status", "quality", "mapping")), "policyVersion": CATALOG_FILTER_VERSION}


def _business_date(value):
    if type(value) is date:
        return value
    if type(value) is not str or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise NetshopApiError("目录asOfDate须为明确业务自然日")
    try:
        return date.fromisoformat(value)
    except ValueError as error:
        raise NetshopApiError("目录asOfDate无效") from error


def _capabilities(capabilities):
    if not isinstance(capabilities, dict) or capabilities.get("latestMaster") is not True or not re.fullmatch(r"[a-f0-9]{64}", str(capabilities.get("scopeKey", ""))) or not re.fullmatch(r"(?:\d+:[a-f0-9]{12}|[a-f0-9]{64})", str(capabilities.get("sourceVersion", ""))) or not isinstance(capabilities.get("fields"), dict):
        raise NetshopApiError("目录筛选缺少完整最新快照、scope和来源版本能力证明", code="not_applicable", status=422)
    return capabilities


def catalog_filter_binding(spec, *, as_of_date, capabilities):
    """None preserves the existing no-new-parameter token/default semantics."""
    if not spec["requested"]:
        return None
    capabilities = _capabilities(capabilities)
    return {"policyVersion": CATALOG_FILTER_VERSION, "status": spec["status"], "quality": spec["quality"], "mapping": spec["mapping"],
            "asOfDate": _business_date(as_of_date).isoformat(), "scopeKey": capabilities["scopeKey"], "sourceVersion": capabilities["sourceVersion"],
            "staleAfterDays": CATALOG_STALE_AFTER_DAYS, "onSaleValues": list(ON_SALE_VALUES), "offSaleValues": list(OFF_SALE_VALUES)}


def _require(capabilities, field):
    if capabilities["fields"].get(field) is not True:
        raise NetshopApiError("目录筛选尚不具备" + field + "的完整predicate能力", code="not_applicable", status=422)


def _with_code(rows):
    # Same aliases/precedence as the existing _catalog_item productCode. This
    # does not re-label JD's 商品编码 as an ERP or merchant SKU identity.
    return rows.annotate(catalog_code=Trim(Coalesce(
        NullIf(KeyTextTransform("SKU商家编码", "raw_json"), Value("")),
        NullIf(KeyTextTransform("商品编码", "raw_json"), Value("")),
        F("product_code"), Value(""), output_field=NetshopRow._meta.get_field("product_code"),
    )))


def _with_image(rows):
    latest = NetshopImportBatch.objects.filter(platform=OuterRef("platform"), shop_name=OuterRef("shop_name"), source=OuterRef("source"), status="completed").order_by("-snapshot_date", "-completed_at", "-created_at", "-id").values("id")[:1]
    completed = NetshopImportBatch.objects.filter(id=OuterRef("last_import_batch_id"), platform=OuterRef("platform"), shop_name=OuterRef("shop_name"), source=OuterRef("source"), dataset=OuterRef("dataset"), status="completed")
    assets = NetshopRow.objects.filter(platform=OuterRef("platform"), shop_name=OuterRef("shop_name")).filter(
        Q(platform="京东", source="jd_yimei_sku", sku_id=OuterRef("sku_id")) | Q(platform="天猫", source="tmall_product_assets", spu_id=OuterRef("spu_id")),
    ).filter(Q(image_url__gt="") | Q(image_content_sha256__gt=""), last_import_batch_id=Subquery(latest)).filter(Exists(completed))
    return rows.annotate(catalog_has_image=Case(When(Q(image_url__gt="") | Q(image_content_sha256__gt=""), then=Value(True)), When(Exists(assets), then=Value(True)), default=Value(False), output_field=BooleanField()))


def apply_catalog_filters(full_latest_master_queryset, spec, *, as_of_date, capabilities):
    """Full-set filtering only; caller supplies scoped, completed latest masters.

    Capability fields: product_status/catalog_code/category/snapshot_date/
    exact_identity/image_lookup. Missing capability is 422. ERP mapping filters
    remain unsupported even if a caller sends a boolean claiming a lookup; the
    required exact versioned current-lookup predicate has not been implemented.
    """
    if not spec["requested"]:
        return full_latest_master_queryset
    if spec.get("policyVersion") != CATALOG_FILTER_VERSION or any(spec.get(key) not in allowed for key, allowed in (("status", CATALOG_STATUS_VALUES), ("quality", CATALOG_QUALITY_VALUES), ("mapping", CATALOG_MAPPING_VALUES))):
        raise NetshopApiError("目录筛选spec未通过冻结协议")
    capabilities = _capabilities(capabilities)
    business_date = _business_date(as_of_date)
    if full_latest_master_queryset.model is not NetshopRow or full_latest_master_queryset.query.is_sliced:
        raise NetshopApiError("目录predicate必须作用于未分页的完整latest master集合")
    if spec["mapping"] != "all" or spec["quality"] == "unverified_mapping":
        raise NetshopApiError("当前ERP Lookup未核验，不支持关联状态predicate；未核验不等于已查未匹配", code="not_applicable", status=422)
    rows = full_latest_master_queryset
    if spec["status"] != "all":
        _require(capabilities, "product_status")
        status = Trim(F("product_status"))
        rows = rows.annotate(catalog_status=status)
        rows = rows.filter(catalog_status__in=ON_SALE_VALUES) if spec["status"] == "on_sale" else rows.filter(catalog_status__in=OFF_SALE_VALUES) if spec["status"] == "off_sale" else rows.exclude(catalog_status__in=ON_SALE_VALUES + OFF_SALE_VALUES)
    quality = spec["quality"]
    if quality == "missing_code":
        _require(capabilities, "catalog_code")
        rows = _with_code(rows).filter(catalog_code="")
    elif quality == "missing_category":
        _require(capabilities, "category")
        rows = rows.annotate(catalog_category=Trim(F("category"))).filter(catalog_category="")
    elif quality == "stale":
        _require(capabilities, "snapshot_date")
        # Blank/missing snapshots are unknown; no quantity/price inference.
        rows = rows.filter(snapshot_date__isnull=False, snapshot_date__regex=r"^\d{4}-\d{2}-\d{2}$", snapshot_date__lt=(business_date - timedelta(days=CATALOG_STALE_AFTER_DAYS)).isoformat()).exclude(snapshot_date="")
    elif quality == "missing_image":
        _require(capabilities, "image_lookup")
        rows = _with_image(rows).filter(catalog_has_image=False)
    elif quality == "conflict":
        _require(capabilities, "exact_identity")
        _require(capabilities, "catalog_code")
        if full_latest_master_queryset.filter(sku_id="").exists():
            raise NetshopApiError("完整目录存在无精确SKU身份的记录，不能证明全集冲突predicate", code="not_applicable", status=422)
        all_rows = _with_code(full_latest_master_queryset)
        equal = {field: OuterRef(field) for field in ("platform", "shop_name", "source", "dataset", "sku_id")}
        grouped = all_rows.filter(**equal).values("platform", "shop_name", "source", "dataset", "sku_id").annotate(**{field: Count(column, distinct=True) for field, column in {"titles": "product_name", "codes": "catalog_code", "parents": "spu_id", "attributes": "sale_attribute", "categories": "category", "brands": "brand", "states": "product_status", "prices": "price_cents"}.items()})
        conflict = Q(titles__gt=1) | Q(codes__gt=1) | Q(parents__gt=1) | Q(attributes__gt=1) | Q(categories__gt=1) | Q(brands__gt=1) | Q(states__gt=1) | Q(prices__gt=1)
        rows = rows.filter(Exists(grouped.filter(conflict)))
    return rows
