"""HTTP model replies for the isolated managed Pi skill exercise."""
import json


OUTPUT = "functional-managed-w11.xlsx"
SCRIPT = "/opt/pi/skill-bundles/1.3.0/excel-report/scripts/create_report.py"
SHELL = (
    "set -eu; set -- /workspace/inputs/pi-file-*/w11-input.json; "
    'test "$#" -eq 1; test -f "$1"; '
    f'python3 {SCRIPT} "$1" /workspace/outputs/{OUTPUT}; '
    f'test -s /workspace/outputs/{OUTPUT}'
)
DAY = "2026-11-06"
SHOP = "隔离周报甲店"
SALES_CHANNEL = "隔离Pandas来源"
SALES_CATEGORY = "隔离品类0"
PANDAS_INPUTS = [
    {"name": "products", "dataset": "netshop_product_daily",
     "query": {"startDate": DAY, "endDate": DAY, "platform": "京东", "shop": SHOP, "limit": 1},
     "columns": ["id", "transactionAmountCents"]},
    {"name": "sales", "dataset": "sales_category", "collection": "trend.items",
     "query": {"startDate": DAY, "endDate": DAY, "channels": [SALES_CHANNEL], "categories": [SALES_CATEGORY]},
     "columns": ["category", "period", "netSalesCents"]},
]
PANDAS_CODE = """import socket
result = pd.DataFrame([{
    'product_rows': len(frames['products']),
    'category_rows': len(frames['sales']),
    'product_cents': int(frames['products']['transactionAmountCents'].sum()),
    'sales_cents': int(frames['sales']['netSalesCents'].sum()),
    'loopback_only': [name for _, name in socket.if_nameindex()] == ['lo'],
}])"""


def pandas_message(messages, tools):
    if any(message.get("role") == "tool" for message in messages):
        return {"role": "assistant", "content": "已计算合成数据，结果见表。"}, "stop"
    if "run_pandas_analysis" not in tools:
        return None, None
    return {"role": "assistant", "content": None, "tool_calls": [
        {"id": "functional-pandas-analysis", "type": "function", "function": {
            "name": "run_pandas_analysis",
            "arguments": json.dumps({"code": PANDAS_CODE, "inputsJson": json.dumps(PANDAS_INPUTS, ensure_ascii=False)})}}]}, "tool_calls"


def respond(body):
    model = body.get("model", "")
    if not model.startswith("isofunc-pi-"):
        return None
    if body.get("stream"):
        return 400, {"error": {"message": "managed skill fixture requires a JSON response"}}
    messages = body["messages"]
    tools = {tool.get("function", {}).get("name") for tool in body.get("tools", [])}
    if model.startswith("isofunc-pi-pandas-"):
        message, reason = pandas_message(messages, tools)
        if message is None:
            return 400, {"error": {"message": "registered pandas tool absent"}}
    elif any(message.get("role") == "tool" for message in messages):
        message = {"role": "assistant", "content": "隔离技能报告已生成。"}
        reason = "stop"
    else:
        transcript = json.dumps(messages, ensure_ascii=False)
        if "create_report.py" not in transcript or "bash" not in tools:
            return 400, {"error": {"message": "managed skill text or real bash tool absent"}}
        message = {"role": "assistant", "content": None, "tool_calls": [
            {"id": "functional-managed-excel-bash", "type": "function",
             "function": {"name": "bash", "arguments": json.dumps({"command": SHELL})}}]}
        reason = "tool_calls"
    return 200, {"id": "fixture-managed-w11-" + reason, "object": "chat.completion", "model": model,
                 "choices": [{"index": 0, "message": message, "finish_reason": reason}],
                 "usage": {"prompt_tokens": 60, "completion_tokens": 18, "total_tokens": 78}}
