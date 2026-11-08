"""Deterministic OpenAI-compatible peer for the private report HTTP rehearsal."""
import json


SHOP = "隔离周报甲店"
DAY = "2026-11-06"
SECTIONS = ["经营结论", "数据范围与完整性", "关键指标", "异常与原因", "行动建议"]
MODEL_NAMES = {"isofunc-report-a", "isofunc-report-b", "isofunc-report-429"}


def response(model, phase, *, text=None, calls=None):
    message = {"role": "assistant", "content": text}
    if calls:
        message["tool_calls"] = [
            {"id": key, "type": "function", "function": {"name": name, "arguments": json.dumps(args, ensure_ascii=False)}}
            for key, name, args in calls
        ]
    return 200, {
        "id": f"fixture-{model}-{phase}",
        "choices": [{"index": 0, "finish_reason": "tool_calls" if calls else "stop", "message": message}],
        "usage": {"prompt_tokens": 50, "completion_tokens": 20, "total_tokens": 70},
    }


def require(condition, code):
    if not condition:
        raise ValueError(code)


def checked_facts(data, shop, day):
    require(data["dataset"] == "product_daily" and data["monetaryUnit"] == "cents", "basis")
    require(data["visitorAggregation"] == "product_day_sum", "visitor_grain")
    require(data["coverage"]["actualDates"] == [day] and data["coverage"]["missingDates"] == [], "coverage")
    require(data["returned"] == 3 and data["truncated"] is False, "product_count")
    rows = {item["id"]: item for item in data["items"]}
    require(set(rows) == {"iso-report-rate", "iso-report-zero", "iso-report-missing"}, "outside_scope")
    require(all(item["platform"] == "京东" and item["shopNames"] == [shop] for item in rows.values()), "shop_scope")
    available, zero, missing = (rows[key] for key in ("iso-report-rate", "iso-report-zero", "iso-report-missing"))
    require((available["visitors"], available["transactionCustomers"], available["transactionQuantity"], available["conversionRate"])
            == (20, 2, 8, 0.1), "conversion_denominator")
    require(all(available["fieldAvailability"][key]["complete"] for key in ("visitors", "transactionCustomers")), "complete_fields")
    require(zero["visitors"] == 0 and zero["conversionRate"] is None, "zero_denominator")
    require(zero["fieldAvailability"]["visitors"]["complete"], "zero_is_observed")
    require(missing["fieldAvailability"]["transactionCustomers"] == {"complete": False, "reasonCode": "missing_field"}, "missing_customer")
    require(not data["summaryFieldAvailability"]["transactionCustomers"]["complete"], "partial_summary")
    require(data["summary"]["transactionAmountCents"] == 31400, "outside_scope_amount")
    return f"{day} 京东 {shop} 商品×日累计。可用商品成交客户数 2 ÷ 访客数 20 = 10%，成交 8 件。零访客不计算，缺成交客户字段不计算，店铺转化率缺权威客户数。成交额 31400 分。"


def respond(body):
    """Return a status and JSON body, or None for a different fixture's model."""
    model = body.get("model")
    if model not in MODEL_NAMES:
        return None
    if model == "isofunc-report-429":
        return 429, {"error": {"message": "iso-report-private-upstream-text"}}
    try:
        messages = body["messages"]
        system = messages[0]["content"]
        require("成交客户数÷访客数" in system, "report_guidance")
        task = next(frame["content"] for frame in messages if frame["role"] == "user")
        input_body = json.loads(task.split("<task_input>", 1)[1].split("</task_input>", 1)[0])
        scope = input_body["workflowInput"]
        shop, day = scope["shop"], scope["startDate"]
        require(shop == SHOP and scope["platform"] == "京东" and day == DAY and scope["endDate"] == DAY, "report_scope")
        dependencies = input_body["dependencies"]
        if "collect" in dependencies:
            facts = dependencies["collect"]["answer"]
            require("2 ÷ 访客数 20 = 10%" in facts and "成交额 31400 分" in facts, "collect_dependency")
            sections = [{"title": title, "body": facts} for title in SECTIONS]
            return response(model, "report", text=json.dumps({"sections": sections}, ensure_ascii=False))
        results = {frame["tool_call_id"]: json.loads(frame["content"]) for frame in messages if frame["role"] == "tool"}
        if not results:
            exposed = {entry["function"]["name"] for entry in body["tools"]}
            require({"get_data_freshness", "get_netshop_performance"} <= exposed, "catalog")
            return response(model, "tools", calls=[
                ("iso-report-freshness", "get_data_freshness", {}),
                ("iso-report-netshop", "get_netshop_performance", {**scope, "dataset": "product_daily", "limit": 6}),
            ])
        require(set(results) == {"iso-report-freshness", "iso-report-netshop"}, "missing_tool_result")
        require(all(result.get("ok") is True and result.get("auditStatus") != "unavailable" for result in results.values()), "failed_tool_result")
        facts = checked_facts(results["iso-report-netshop"]["data"], shop, day)
        return response(model, "collect", text=facts)
    except (ValueError, KeyError, TypeError, StopIteration, IndexError) as error:
        # Do not reflect a request body, header or upstream exception into the response.
        return 422, {"error": {"code": f"fixture_contract_{type(error).__name__}"}}
