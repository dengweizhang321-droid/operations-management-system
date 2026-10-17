"""A per-environment single-shop fence, intersected with the real principal.

Shop selection is not an application role/scope grant. Unsupported domains are
denied instead of pretending that ERP channels or warehouses identify a shop.
"""
import json
from .policy import AiError, canonical

DATASETS = {"pi_netshop_product_daily", "pi_netshop_promotion"}
TOOLS = {"get_pi_netshop_performance_page", "get_data_freshness", "describe_system_datasets",
         "query_system_dataset", "start_pi_dataset_export", "get_pi_dataset_export"}


def normalize(value, principal):
    if value is None:
        return None
    if (type(value) is not dict or set(value) != {"platform", "shop"}
            or value["platform"] not in {"京东", "天猫"}
            or not isinstance(value["shop"], str) or not value["shop"].strip()
            or len(value["shop"]) > 120 or any(ord(c) < 32 for c in value["shop"])):
        raise AiError("单店分析必须使用明确的平台和店铺名称")
    scope = principal.scope
    if scope is not None and (value["platform"] not in scope["platforms"] or scope["channels"] or scope["warehouses"]):
        raise AiError("当前账号范围不支持该网店读取", "access_denied", 403)
    return {"platform": value["platform"], "shop": value["shop"].strip()}


def for_operation(operation):
    value = json.loads(operation.payload_json).get("shopSelection")
    if value is not None and (type(value) is not dict or set(value) != {"platform", "shop"}):
        raise AiError("Pi 环境的店铺选择无效", "access_denied", 403)
    return value


def filter_catalog(entries, selection):
    return [entry for entry in entries if not selection or entry["name"] in TOOLS]


def _query(query, selection):
    if not isinstance(query, dict):
        raise AiError("Pi 数据查询必须为对象")
    for key in ("platform", "shop"):
        if key in query and query[key] != selection[key]:
            raise AiError("请求超出本环境固定店铺范围", "access_denied", 403)
    return {**query, **selection}


def validate_dataset(dataset, query, selection):
    if selection is None:
        return query
    if dataset not in DATASETS:
        raise AiError("此数据集不能证明单店归属，当前环境不可读取", "access_denied", 403)
    return _query(query, selection)


def bind_arguments(name, args, selection, session_id=None):
    if not isinstance(args, dict):
        raise AiError("Pi 工具参数必须为对象")
    if name == "start_pi_dataset_export" and session_id is not None and "sessionId" in args and args["sessionId"] != session_id:
        raise AiError("导出不能关联其他 Pi 会话", "access_denied", 403)
    if selection is None:
        return args
    if name not in TOOLS:
        raise AiError("该工具不能证明单店归属，当前环境不可使用", "access_denied", 403)
    if name == "get_pi_netshop_performance_page":
        return _query(args, selection)
    if name in {"query_system_dataset", "start_pi_dataset_export"}:
        try:
            query = json.loads(args["queryJson"])
        except (KeyError, TypeError, ValueError) as error:
            raise AiError("Pi 数据查询无效") from error
        return {**args, "queryJson": canonical(validate_dataset(args.get("dataset"), query, selection))}
    if name == "describe_system_datasets" and "dataset" in args and args["dataset"] not in DATASETS:
        raise AiError("当前环境仅发现可证明单店归属的数据集", "access_denied", 403)
    return args
