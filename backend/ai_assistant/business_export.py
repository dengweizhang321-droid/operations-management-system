"""Prepare paired files from the exact sealed report snapshot, without source I/O."""
from contextlib import contextmanager
import json
import sqlite3
from tempfile import TemporaryDirectory

from business_analysis.contracts import AnalysisContractError, PageReconciler, comparison_periods
from business_analysis.report_files import Column, Table, MAX_COLUMNS, write_pair
from business_analysis.results import VIEWS, stream_table
from . import business_evidence, business_reports, models as m
from .policy import AiError, authorize_owner, canonical, digest

DIMENSION_NAMES = {"shop": "店铺", "category": "品类", "spu": "SPU", "sku": "SKU", "keyword": "关键词", "searchTerm": "搜索词", "daily": "逐日", "brand": "品牌"}
LABELS = {"rowId": "来源行ID", "id": "分析行ID", "rowIndex": "分析行位置", "sourceKey": "来源键", "baselineKey": "基期来源键",
    "platform": "平台", "shopName": "店铺", "category": "品类", "spuId": "SPU", "skuId": "SKU", "date": "日期",
    "keyword": "关键词", "searchTerm": "搜索词", "brand": "品牌", "onlineSpecCode": "网店规格编码", "merchantCode": "商家编码",
    "value": "值", "presentRows": "有值行数", "missingRows": "缺失行数", "currentRowCount": "本期行数", "baselineRowCount": "基期行数",
    "current": "本期", "baseline": "基期", "difference": "差额", "changeRate": "变化率", "percentagePoints": "百分点变化", "status": "状态",
    "spendCents": "推广费用（分）", "reportedGmvCents": "平台归因金额（分）", "netSalesCents": "ERP净销售（分）",
    "positiveSalesCents": "正向销售（分）", "refundCents": "退款（分）", "costCents": "源成本（分）", "grossProfitCents": "毛利（分）",
    "reportedGrossProfitCents": "源报告毛利（分）", "feeCents": "分摊费用（分）", "impressions": "曝光次数", "clicks": "点击次数",
    "reportedOrderLines": "平台订单口径", "paymentCents": "支付金额（分）", "ctr": "点击率", "cpcCents": "点击成本（分）", "roas": "归因产出比",
    "metrics": "指标", "baselineMetrics": "基期指标", "comparisons": "比较", "ratios": "比率", "entity": "身份", "dimensions": "来源维度",
    "dimensionMissing": "维度缺失", "sampleComparisons": "市场样本比较", "object": "调整对象", "change": "具体动作", "prerequisites": "执行前提",
    "successMetric": "观察指标", "observationDays": "观察天数", "rollback": "回退条件", "priority": "优先级", "ownerRole": "责任角色", "budgetImpact": "预算影响",
    "totalBudgetCents": "预算总上限（分）", "reserveCents": "预留预算（分）", "reservedCents": "预留预算（分）", "allocatedCents": "已分配预算（分）", "unallocatedCents": "未分配余额（分）",
    "budgetCents": "对象预算（分）", "minBudgetCents": "对象最低预算（分）", "maxBudgetCents": "对象最高预算（分）", "horizonDays": "规划天数", "weight": "分配权重",
    "scenario": "情景", "name": "名称", "cpcFactorBps": "点击成本乘数（10000=不变）", "orderRateFactorBps": "订单效率乘数（10000=不变）", "orderValueFactorBps": "订单金额乘数（10000=不变）",
    "contributionMarginBps": "假设贡献率（基点）", "minimumClicks": "样本点击门槛", "minimumOrderLines": "样本订单口径门槛", "reviewAfterSpendBps": "复盘花费占预算（基点）",
    "projectedClicks": "情景点击次数", "projectedOrderLines": "情景订单口径", "projectedAttributedGmvCents": "情景归因金额（分）", "knownAttributedGmvCents": "已知对象情景归因金额（分）",
    "assumedContributionAfterAdCents": "假设贡献扣推广余额（分，非利润）", "projectedRoas": "情景归因产出比", "breakEvenRoas": "假设贡献收支平衡产出比",
    "equivalentBaselineSpendCents": "等规划天数基期花费（分）", "budgetChangeCents": "预算较等天数花费差额（分）", "reviewAfterSpendCents": "提前复盘花费（分）",
    "minimumRoasBps": "最低归因产出比（10000=1倍）", "unavailableTargets": "不可测算对象数", "targetCount": "预算对象数", "mixedReportingBases": "包含不同报告口径",
    "byReportingBasis": "各报告口径分别汇总", "rollbackRule": "复盘与回退条件", "limitations": "限制说明", "missingMetrics": "缺失指标", "days": "基期天数", "datesPresent": "日期覆盖存在"}


def flatten(value, prefix=()):
    """JSON-pointer keys avoid collisions between source field names and paths."""
    result = {}
    if isinstance(value, dict) and value:
        for key, child in value.items():
            result.update(flatten(child, (*prefix, key)))
    else:
        key = "/" + "/".join(str(p).replace("~", "~0").replace("/", "~1") for p in prefix)
        result[key] = canonical(value) if isinstance(value, (list, dict)) else value
    return result


def label(key):
    parts = [p.replace("~1", "/").replace("~0", "~") for p in key.split("/")[1:]]
    return " · ".join(LABELS.get(part, part) for part in parts)


class TableSpool:
    def __enter__(self):
        self.directory = TemporaryDirectory(prefix="teruisi-report-")
        try:
            self.db = sqlite3.connect(self.directory.name + "/tables.sqlite")
            self.db.execute("PRAGMA cache_size=-2048")
            self.db.execute("PRAGMA max_page_count=131072")
            self.db.execute("CREATE TABLE rows(table_id INTEGER,row_id INTEGER,payload TEXT,PRIMARY KEY(table_id,row_id)) WITHOUT ROWID")
        except Exception:
            if hasattr(self, "db"):
                self.db.close()
            self.directory.cleanup()
            raise
        self.tables = []
        return self

    def __exit__(self, kind, error, trace):
        try:
            self.db.close()
        finally:
            self.directory.cleanup()
        if isinstance(error, sqlite3.DatabaseError):
            raise AiError("报告派生表临时空间不可用或超过容量", "payload_too_large", 413) from error

    def add(self, key, title, note, records, expected=None):
        table_id, columns, count = len(self.tables), {}, 0
        with self.db:
            for record in records:
                flat = flatten(record)
                for field, value in flat.items():
                    kinds = columns.setdefault(field, set())
                    if value is not None:
                        kinds.add("integer" if type(value) is int else "decimal" if type(value) is float else "text")
                if len(columns) > MAX_COLUMNS:
                    raise AiError("派生表列数超过容量，须按指标拆分", "payload_too_large", 413)
                self.db.execute("INSERT INTO rows VALUES (?,?,?)", (table_id, count, canonical(flat)))
                count += 1
                if count > 1000000:
                    raise AiError("派生表超过单表容量", "payload_too_large", 413)
        if expected is not None and count != expected:
            raise AiError("报告明细行数与来源核对不一致", "conflict", 409)
        fields = list(columns) or ["/状态"]
        specs = []
        for field in fields:
            kinds = columns.get(field, set())
            kind = "text" if not kinds or "text" in kinds else "decimal" if "decimal" in kinds else "integer"
            parts = field.split("/")
            is_value = parts[1:2] == ["metrics"] and (len(parts) == 3 or parts[-1] == "value")
            specs.append(Column(field, label(field), kind, total=is_value and kind == "integer"))
        # Only rows with an available deterministic ratio get a cached formula.
        ratios = {"ctr": ("clicks", "impressions"), "cpcCents": ("spendCents", "clicks"), "roas": ("reportedGmvCents", "spendCents"), "orderLineConversionRate": ("reportedOrderLines", "clicks")}
        for index, field in enumerate(fields):
            if field.startswith("/ratios/") and field.split("/")[-1] in ratios:
                metric = field.split("/")[-1]
                keys = ["/metrics/"+k+"/value" for k in ratios[metric]]
                if all(k in fields for k in keys) and specs[index].kind != "text":
                    specs[index] = Column(field, label(field), "ratio" if metric in {"ctr", "orderLineConversionRate"} else "decimal", ratio_of=tuple(fields.index(k) for k in keys))
        def rows():
            for (payload,) in self.db.execute("SELECT payload FROM rows WHERE table_id=? ORDER BY row_id", (table_id,)):
                values = json.loads(payload)
                yield [values.get(field) for field in fields]
        self.tables.append(Table(key, title, note, tuple(specs), rows(), count))


@contextmanager
def package(report, principal, *, draft, checkpoint=None, renderer_version=1):
    authorize_owner(report, principal)
    snapshot = json.loads(report.snapshot_json)
    if snapshot.get("schemaVersion") != business_reports.SCHEMA:
        raise AiError("此构建器仅支持经营分析报告")
    if not draft and report.workflow.status != "completed":
        raise AiError("正式报告须先通过人工复核", "conflict", 409)
    value = business_reports.content(report, principal) if draft else business_reports.validate_review(report, principal)
    evidence = business_evidence.get_run(snapshot["evidenceRunId"], principal)
    if evidence.status != "sealed" or evidence.version != snapshot["evidenceVersion"] or digest(evidence.plan_json) != snapshot["evidencePlanDigest"]:
        raise AiError("报告证据快照不一致", "conflict", 409)
    plan, state = json.loads(evidence.plan_json), json.loads(evidence.state_json)
    source_by_key = {s["key"]: s for s in plan["sources"]}
    def pages(key):
        sequence = 0
        for row in m.AiBusinessEvidenceChunk.objects.filter(run=evidence, source_key=key).order_by("sequence").iterator(chunk_size=10):
            sequence += 1
            if checkpoint and sequence % 20 == 1:
                checkpoint({"stage": "preparing", "sourceKey": key, "sourcePage": sequence})
            if row.sequence != sequence or digest(row.payload_json) != row.payload_digest:
                raise AiError("来源分块缺失或摘要不一致", "conflict", 409)
            yield json.loads(row.payload_json)
        if sequence != state[key]["pageCount"]:
            raise AiError("来源分块数量不一致", "conflict", 409)
    expected = {key: business_evidence._restore(entry["verifier"]).result() for key, entry in state.items()}
    metadata = {"reportId": report.id, "evidenceRunId": evidence.id, "evidenceVersion": evidence.version,
        "planDigest": snapshot["evidencePlanDigest"], "scope": snapshot["scope"], "question": snapshot["question"],
        "status": "待复核草稿" if draft else "已通过人工复核", "schemaVersion": "business-files-v1",
        "limitations": ["金额字段保留原分单位；缺失不补零", "市场数据是TOP样本区间，不代表全行业或份额", "当前商品主数据不是历史映射", "建议不自动执行"]}
    with TableSpool() as spool:
        spool.add("overview", "报告范围", "固定来源、期间与报告版本。", ({"项目": key, "内容": canonical(item) if isinstance(item, (dict, list)) else item} for key, item in metadata.items()))
        spool.add("diagnosis", "深度诊断", "解释与因果仍需人工判断；以下文字来自已持久化的专业分析与复核。", ({"章节": section["title"], "正文": section["body"][start:start+300]} for section in value["sections"] for start in range(0, len(section["body"]), 300)))
        findings = value["diagnosis"]["findings"]
        spool.add("actions", "调整规划", "每条动作保留前提、观察期、责任角色与回退条件。", ({"结论ID": f["id"], "类型": f["kind"], "标题": f["title"], "解释": f["explanation"], **f.get("action", {})} for f in findings))
        spool.add("citations", "结论证据", "数值由服务端重新核验；不代表文字中的因果关系已自动证明。", ({"结论ID": f["id"], **fact} for f in findings for fact in f["facts"]))
        spool.add("sources", "来源与核对", "明细封存时的水位与逐页核对结果。", ({"sourceKey": s["key"], "来源": s["domain"], "查询范围": canonical(s["query"]), "核对": canonical(expected[s["key"]]), "覆盖与口径": canonical(state[s["key"]]["metadata"])} for s in plan["sources"]))
        if value.get("budget"):
            budget = value["budget"]
            budget_note = "；".join(budget["limitations"])
            spool.add("budget-limits", "预算上限与预留", "固定输入及总额核对；本文件参数为该报告版本快照。", [{**budget["allocation"], **{k: v for k, v in budget["plan"].items() if k not in {"targets", "scenarios"}}, "planDigest": budget["planDigest"]}])
            spool.add("budget-targets", "预算对象与约束", "对象权重、上下限和责任角色均来自固定输入。", budget["plan"]["targets"])
            spool.add("budget-assumptions", "预算情景假设", budget_note, budget["plan"]["scenarios"])
            spool.add("budget-summary", "预算情景汇总", "缺失对象时完整预测为空，仅展示已知对象合计；不是店铺净利润。", ({"scenario": s["assumptions"]["name"], **s["summary"]} for s in budget["scenarios"]))
            for index, scenario in enumerate(budget["scenarios"]):
                spool.add("budget-scenario-"+str(index), "情景_"+scenario["assumptions"]["name"], budget_note, scenario["rows"])
        for source in plan["sources"]:
            key = source["key"]
            def records(key=key):
                verifier = PageReconciler()
                for page in pages(key):
                    scope = (page["filters"]["platform"], page["filters"]["shop"])
                    if any((row["platform"], row["shopName"]) != scope for row in page["items"]):
                        raise AiError("来源明细包含其他店铺身份", "conflict", 409)
                    verifier.consume(page, request_cursor=verifier.expected_cursor)
                    yield from page["items"]
                if verifier.result() != expected[key]:
                    raise AiError("原始明细与封存核对不一致", "conflict", 409)
            query = source["query"]
            window = query.get("window", "current")
            period = comparison_periods(query["startDate"], query["endDate"])[window]
            period_name = {"current": "本期", "previous": "环比基期", "yearAgo": "同比基期"}[window]
            note = f'{period_name}：{period["startDate"]} 至 {period["endDate"]}。完整规范明细；金额字段单位为分；推广、ERP和B端口径分别保留。'
            spool.add("raw-"+key, "来源_"+key, note, records(), expected[key]["rowCount"])
        for source in plan["sources"]:
            key, query = source["key"], source["query"]
            if query.get("window", "current") != "current" or not expected[key]["metrics"]:
                continue
            bases = [None]
            for candidate in plan["sources"]:
                q = candidate["query"]
                if candidate["domain"] == source["domain"] and q.get("window") in {"previous", "yearAgo"} and {k: v for k, v in q.items() if k != "window"} == {k: v for k, v in query.items() if k != "window"}:
                    bases.append(candidate["key"])
            for dimension in VIEWS:
                for base in ([None] if dimension == "daily" else bases):
                    args = {"baseline_pages": pages(base), "baseline_expected": expected[base]} if base else {}
                    with stream_table(pages(key), dimension, expected[key], **args) as (table, rows):
                        period = "环比" if base and source_by_key[base]["query"]["window"] == "previous" else "同比" if base else "本期"
                        note = "；".join(table["limitations"])+"。来源="+key+("，基期="+base if base else "")
                        spool.add("analysis-"+digest([key, dimension, base])[:24], f"{key}_{DIMENSION_NAMES[dimension]}_{period}", note,
                            ({"sourceKey": key, "baselineKey": base, **row} for row in rows), table["total"])
        calculator = None
        if renderer_version >= 2 and value.get("budget"):
            from business_analysis.budget_offline import payload
            calculator = payload(value["budget"], report.id)
        yield metadata, spool.tables, calculator


def build(report, principal, xlsx_file, html_file, *, draft=False, checkpoint=None, renderer_version=1):
    try:
        if renderer_version not in (1, 2):
            raise AnalysisContractError("报告渲染版本不受支持")
        with package(report, principal, draft=draft, checkpoint=checkpoint, renderer_version=renderer_version) as (metadata, tables, calculator):
            return write_pair(xlsx_file, html_file, title="深度经营分析 · "+metadata["scope"]["shop"], metadata=metadata, tables=tables, checkpoint=checkpoint, offline_budget=calculator)
    except AnalysisContractError as error:
        raise AiError(str(error), "conflict", 409) from error
