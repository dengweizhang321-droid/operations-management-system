"""Promotion subject identity shared by the writer and the promotion readers.

阿里妈妈“商品报表”在“店铺直达”等场景会返回主体类型为“店铺”的行。这类花费属于
店铺整体推广，不属于任何商品：行照常保存在 ``netshop_rows`` 并计入店铺推广日汇总
（``netshop_promotion_shop_daily``），但不生成 ``netshop_promotion_product_daily`` 行，
也不计入 ``product_count``。

不新增列、不做迁移：店铺级行的 ``spu_id`` 固定为 ``店铺:<主体ID>``。该前缀不可能出现在
纯数字的商品 ID 中，所以店铺 ID 与商品 ID 数字相同也不会冲突，读取侧可用
``STORE_SUBJECT_Q`` 在 SQL 层把店铺级行与商品行分开。店铺级金额还可由
“店铺日汇总 − Σ 商品日汇总”稳定推出（两者在同一事务内一起重建）。
"""
from __future__ import annotations

from django.db.models import Q

STORE_SUBJECT_TYPE = "店铺"
STORE_ID_PREFIX = "店铺:"
STORE_SUBJECT_Q = Q(spu_id__startswith=STORE_ID_PREFIX)
# Only Tmall promotion reports carry store subjects; JD rows never use spu_id as the
# promotion identity, so the prefix test must be scoped by source at every call site.
STORE_SOURCE = "tmall_promotion"


def is_store_spu_id(value: object) -> bool:
    return isinstance(value, str) and value.startswith(STORE_ID_PREFIX)


def store_spu_id(subject_id: str) -> str:
    return f"{STORE_ID_PREFIX}{subject_id}"
