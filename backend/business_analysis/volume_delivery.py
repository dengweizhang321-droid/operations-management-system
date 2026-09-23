"""Pure renderer-4 persistence receipts, with no database or publication effects.

The compact receipt is an index, not evidence that any file has been persisted.
Callers must independently verify each stored stream's SHA, size and chunks,
hold their owner/attempt fence, and publish atomically. Historical-attempt quota
is also a persistence concern; this contract bounds the current delivery only.
"""
import hashlib
import json
import re

from . import volume_plan
from .contracts import AnalysisContractError, MAX_SAFE_INTEGER, canonical, digest


SCHEMA_VERSION = "business-file-delivery-v2"
CHUNK_BYTES = 512 * 1024
MAX_ROOT_BYTES = 128 * 1024
MAX_MANIFEST_BYTES = 16 * 1024 * 1024
MAX_FILE_BYTES = 256 * 1024 * 1024
MAX_DELIVERY_BYTES = 1024 * 1024 * 1024
ROOT_FIELDS = {"schemaVersion", "rendererVersion", "bindingDigest", "attempt", "draft", "volumeCount", "files", "manifestFile"}
FILE_FIELDS = {"volumeIndex", "format", "bytes", "sha256", "chunkCount"}
DESCRIPTOR_FIELDS = {"key", "title", "rowCount", "columnCount"}
PART_FIELDS = DESCRIPTOR_FIELDS | {"fragmentIndex", "fragmentCount", "rowOffset", "rowLimit", "fragmentKey"}
FULL_FIELDS = {"schemaVersion", "status", "reportId", "evidenceDigest", "rendererVersion", "planDigest", "sourceDescriptorDigest",
               "volumeCount", "sourceTableCount", "fragmentCount", "totalRows", "byteCapacity", "tables", "volumes", "manifestDigest"}


def _renderer(value):
    if type(value) is not int or value not in (4, 6, 7):
        _fail("多卷持久渲染版本不受支持")


def _fail(message):
    raise AnalysisContractError(message)


def _fields(value, required, optional=()):
    if type(value) is not dict or not required <= value.keys() or value.keys() - required - set(optional):
        _fail("多卷交付字段集合无效")


def _integer(value, minimum, maximum):
    if type(value) is not int or not minimum <= value <= maximum:
        _fail("多卷交付整数或容量无效")
    return value


def _sha(value):
    if type(value) is not str or not re.fullmatch(r"[0-9a-f]{64}", value):
        _fail("多卷交付摘要须为小写SHA-256")
    return value


def _equal(actual, expected):
    if not volume_plan._same_bounded(actual, expected):
        _fail("多卷交付与可信绑定、顺序或完整证明不一致")


def _snapshot(value, maximum):
    """Bound passive input before encoding; no arbitrary object hooks or floats."""
    remaining, nodes = maximum, 1_000_000

    def charge(amount):
        nonlocal remaining
        remaining -= amount
        if remaining < 0:
            _fail("多卷交付JSON字节容量超限")

    def visit(item, depth):
        nonlocal nodes
        nodes -= 1
        if nodes < 0 or depth > 24:
            _fail("多卷交付JSON嵌套或节点超限")
        kind = type(item)
        if kind is str:
            if len(item) > remaining:
                _fail("多卷交付文本容量超限")
            try:
                charge(len(canonical(item).encode("utf-8")))
            except UnicodeError as error:
                raise AnalysisContractError("多卷交付文本编码无效") from error
            return item
        if kind is bool or item is None:
            charge(len(canonical(item)))
            return item
        if kind is int:
            if abs(item) > MAX_SAFE_INTEGER:
                _fail("多卷交付整数超出安全范围")
            charge(len(str(item)))
            return item
        if kind is list:
            if len(item) > nodes:
                _fail("多卷交付数组容量超限")
            charge(2 + max(0, len(item)-1))
            return [visit(child, depth+1) for child in item]
        if kind is dict:
            if len(item) > nodes:
                _fail("多卷交付对象容量超限")
            charge(2 + max(0, len(item)-1) + len(item))
            result = {}
            for key, child in item.items():
                if type(key) is not str:
                    _fail("多卷交付对象键须为文本")
                result[visit(key, depth+1)] = visit(child, depth+1)
            return result
        _fail("多卷交付只允许被动JSON值及精确整数")

    return visit(value, 0)


def _file(value, index, format, maximum):
    _fields(value, FILE_FIELDS)
    _equal(value["volumeIndex"], index)
    _equal(value["format"], format)
    size = _integer(value["bytes"], 1, maximum)
    _sha(value["sha256"])
    _equal(value["chunkCount"], (size + CHUNK_BYTES - 1) // CHUNK_BYTES)
    return size


def validate(compact, *, binding_digest, attempt, draft, renderer_version=4):
    """Return an independent bounded compact receipt, or fail closed."""
    _renderer(renderer_version)
    _sha(binding_digest)
    _integer(attempt, 1, 5)
    if type(draft) is not bool:
        _fail("多卷交付草稿标记须为布尔值")
    root = _snapshot(compact, MAX_ROOT_BYTES)
    _fields(root, ROOT_FIELDS)
    for key, expected in (("schemaVersion", SCHEMA_VERSION), ("rendererVersion", renderer_version),
                          ("bindingDigest", binding_digest), ("attempt", attempt), ("draft", draft)):
        _equal(root[key], expected)
    count = _integer(root["volumeCount"], 1, 100)
    if type(root["files"]) is not list or len(root["files"]) != 2 * count:
        _fail("多卷交付必须包含每卷完整HTML和XLSX")
    total = _file(root["manifestFile"], 0, "json", MAX_MANIFEST_BYTES)
    for position, item in enumerate(root["files"]):
        total += _file(item, position // 2 + 1, ("html", "xlsx")[position % 2], MAX_FILE_BYTES)
    if total > MAX_DELIVERY_BYTES:
        _fail("完整多卷交付含JSON清单超过1GiB")
    return root


def _budget(value, report_id, plan_digest):
    _fields(value, {"schemaVersion", "reportId", "planDigest", "sheets", "activeScenario", "initialUnmeasurableTargets", "integerProductLimit", "reviewStatus"})
    for key, expected in (("schemaVersion", "business-excel-budget-v1"), ("reportId", report_id), ("planDigest", plan_digest),
                          ("activeScenario", 1), ("integerProductLimit", 99999999999999), ("reviewStatus", "unreviewed_local_scenario")):
        _equal(value[key], expected)
    sheets = value["sheets"]
    if (type(sheets) is not list or len(sheets) != 3 or
            any(type(s) is not str or not 1 <= len(s) <= 31 for s in sheets) or len(set(s.casefold() for s in sheets)) != 3):
        _fail("原生预算工作表证明无效")
    _integer(value["initialUnmeasurableTargets"], 0, 10000)


SCREENING_KEYS = {"screeningRef", "screeningPackagePolicy", "screeningPackageDigests"}
PROMOTION_KEY = "promotionFileProof"


def promotion_proof(value, report_id):
    """Bound shape only; the owning writer must compare actual content/materials."""
    _fields(value, {"schemaVersion", "rendererVersion", "reportId", "executionProfile",
        "contentDtoDigest", "contentBindingDigest", "contentDigest", "snapshotDigest",
        "workflowInputDigest", "ledgerDigest", "humanReviewDigest", "screeningRootDigest",
        "contextDigest", "promotionSelector", "algorithmVersion", "materialManifestDigest",
        "materialReportBindingDigest", "tables", "rowCount", "ndjsonBytes",
        "tableExpensesAreAdditive", "requiredLimitations", "authorityVerified", "registered",
        "proofDigest"})
    _equal(value["schemaVersion"], "business-promotion-file-proof-v1")
    _equal(value["rendererVersion"], 7)
    _equal(value["reportId"], report_id)
    _equal(value["executionProfile"], "business-agent-screening-promotion-reference-v1")
    _equal(value["algorithmVersion"], "promotion-keyword-promoted-sku-v1")
    for key in ("contentDtoDigest", "contentBindingDigest", "contentDigest", "snapshotDigest",
                "workflowInputDigest", "ledgerDigest", "humanReviewDigest", "screeningRootDigest",
                "contextDigest", "materialManifestDigest", "materialReportBindingDigest", "proofDigest"):
        _sha(value[key])
    _equal(value["authorityVerified"], False)
    _equal(value["registered"], False)
    _equal(value["tableExpensesAreAdditive"], False)
    selector = value["promotionSelector"]
    _fields(selector, {"sourceKey", "views"}, {"baselineKey"})
    _equal(selector["views"], ["keyword_sku", "keyword_sku_context"])
    if type(selector["sourceKey"]) is not str or not re.fullmatch(r"[A-Za-z0-9_-]{1,160}", selector["sourceKey"]):
        _fail("词货文件来源身份无效")
    if "baselineKey" in selector and (type(selector["baselineKey"]) is not str
            or not re.fullmatch(r"[A-Za-z0-9_-]{1,160}", selector["baselineKey"])
            or selector["baselineKey"] == selector["sourceKey"]):
        _fail("词货文件基期身份无效")
    if type(value["tables"]) is not list or len(value["tables"]) != 2:
        _fail("词货双视图证明缺失")
    rows = size = 0
    for view, table in zip(("keyword_sku", "keyword_sku_context"), value["tables"]):
        _fields(table, {"view", "tableBindingDigest", "rowCount", "pageCount", "ndjsonBytes",
            "ndjsonSha256", "missingPromotedSkuGroups", "unqualifiedIdentityGroups", "spendTotals"})
        _equal(table["view"], view)
        _sha(table["tableBindingDigest"]); _sha(table["ndjsonSha256"])
        rows += _integer(table["rowCount"], 0, 250_000)
        size += _integer(table["ndjsonBytes"], 0, 64*1024*1024)
        _integer(table["pageCount"], 1, 20_000)
        _integer(table["missingPromotedSkuGroups"], 0, table["rowCount"])
        _integer(table["unqualifiedIdentityGroups"], table["missingPromotedSkuGroups"], table["rowCount"])
        _fields(table["spendTotals"], {"current", "baseline"})
        for side in ("current", "baseline"):
            _fields(table["spendTotals"][side], {"value", "presentGroups", "missingFactRows"})
    _equal(value["rowCount"], rows)
    _equal(value["ndjsonBytes"], size)
    if rows > 250_000 or size > 64*1024*1024:
        _fail("词货材料超过固定容量")
    for side in ("current", "baseline"):
        left, right = [table["spendTotals"][side] for table in value["tables"]]
        _equal((left["value"], left["missingFactRows"]),
               (right["value"], right["missingFactRows"]))
    if (type(value["requiredLimitations"]) is not list
            or len(value["requiredLimitations"]) < 4
            or not any(type(item) is str and "不可相加" in item for item in value["requiredLimitations"])):
        _fail("词货文件必要口径说明缺失")
    _equal(value["proofDigest"], digest({key: child for key, child in value.items() if key != "proofDigest"}))
    return value


def screening_fields(value, report_id):
    """Shape only; owning publication separately compares actual stored roots."""
    if not SCREENING_KEYS & value.keys():
        return {}
    if not SCREENING_KEYS <= value.keys():
        _fail("筛查完整清单绑定缺失")
    ref = value["screeningRef"]
    _fields(ref, {"schemaVersion", "id", "reportId", "bindingDigest", "selectionPlanDigest", "resultDigest", "contentRootDigest", "manifestDigest"})
    _equal(ref["schemaVersion"], "business-screening-storage-reference-v1")
    _equal(ref["reportId"], report_id)
    if type(ref["id"]) is not str or not re.fullmatch(r"[A-Za-z0-9_.:-]{1,160}", ref["id"]):
        _fail("筛查持久身份无效")
    for key in ("bindingDigest", "selectionPlanDigest", "resultDigest", "contentRootDigest", "manifestDigest"):
        _sha(ref[key])
    _equal(value["screeningPackagePolicy"], "screening-role-package-policy-v1")
    roles = {"commerce", "promotion", "market_b2b", "independent_review", "report"}
    _fields(value["screeningPackageDigests"], roles)
    for item in value["screeningPackageDigests"].values():
        _sha(item)
    return {key:value[key] for key in SCREENING_KEYS}


def _full(value, *, max_tables, max_rows, max_volumes, renderer_version):
    _renderer(renderer_version)
    mapping_keys = {"mappingPlanDigest", "mappingAlgorithmVersion", "mappedTableAlgorithmVersion"}
    _fields(value, FULL_FIELDS | ({PROMOTION_KEY} if renderer_version == 7 else set()),
            {"budgetPlanDigest"} | mapping_keys | SCREENING_KEYS)
    if renderer_version == 7:
        promotion_proof(value[PROMOTION_KEY], value["reportId"])
    screening_fields(value, value["reportId"])
    if mapping_keys & value.keys():
        if not mapping_keys <= value.keys():
            _fail("商品关联完整清单绑定缺失")
        _sha(value["mappingPlanDigest"])
        _equal(value["mappingAlgorithmVersion"], "exact-product-partition-v1")
        _equal(value["mappedTableAlgorithmVersion"], "business-mapped-results-v1")
    _equal(value["schemaVersion"], "business-volume-files-v1")
    _equal(value["status"], "complete")
    _equal(value["rendererVersion"], renderer_version)
    count = _integer(value["volumeCount"], 1, 100)
    for key in ("planDigest", "sourceDescriptorDigest", "manifestDigest", "evidenceDigest"):
        _sha(value[key])
    _fields(value["byteCapacity"], {"verified", "maxFileBytes", "dynamicByteSplitting"})
    _equal(value["byteCapacity"]["verified"], True)
    _equal(value["byteCapacity"]["dynamicByteSplitting"], False)
    max_file = _integer(value["byteCapacity"]["maxFileBytes"], 1, MAX_FILE_BYTES)
    if type(value["tables"]) is not list or not 1 <= len(value["tables"]) <= 12000:
        _fail("完整来源表证明数量无效")
    descriptors = []
    for source in value["tables"]:
        _fields(source, DESCRIPTOR_FIELDS | {"rowDigest"})
        _sha(source["rowDigest"])
        descriptors.append({key: source[key] for key in DESCRIPTOR_FIELDS})
    if type(value["volumes"]) is not list or len(value["volumes"]) != count:
        _fail("完整卷证明缺失")
    first = value["volumes"][0]
    if type(first) is not dict or type(first.get("nativeBudgetSheets")) is not int or first["nativeBudgetSheets"] not in (0, 3):
        _fail("首卷预算预留无效")
    request = {"schemaVersion": volume_plan.REQUEST_SCHEMA, "reportId": value["reportId"], "evidenceDigest": value["evidenceDigest"],
               "rendererVersion": renderer_version, "tables": descriptors}
    plan = volume_plan.build(request, max_tables=max_tables, max_rows=max_rows, max_volumes=max_volumes, native_budget_sheets=first["nativeBudgetSheets"])
    for key in ("planDigest", "sourceDescriptorDigest", "volumeCount", "sourceTableCount", "fragmentCount", "totalRows"):
        _equal(value[key], plan[key])
    has_budget = first["nativeBudgetSheets"] == 3 or first.get("offlineBudgetEnabled") is True
    if has_budget != ("budgetPlanDigest" in value):
        _fail("预算存在性与完整清单不一致")
    if has_budget:
        _sha(value["budgetPlanDigest"])
    source_by_key = {source["key"]: source for source in value["tables"]}
    files = []
    for actual, expected in zip(value["volumes"], plan["volumes"]):
        _fields(actual, {"volumeIndex", "volumeCount", "kind", "nativeBudgetSheets", "rowCount", "offlineBudgetEnabled", "tables", "files"}, {"budgetCalculator"})
        for key in ("volumeIndex", "volumeCount", "kind", "nativeBudgetSheets"):
            _equal(actual[key], expected[key])
        if type(actual["offlineBudgetEnabled"]) is not bool or actual["volumeIndex"] != 1 and actual["offlineBudgetEnabled"]:
            _fail("离线预算只能出现在首卷")
        if expected["kind"] == "budget_only" or ("budgetCalculator" in actual) != (expected["nativeBudgetSheets"] == 3):
            _fail("原生预算证明与分卷计划不一致")
        if "budgetCalculator" in actual:
            _budget(actual["budgetCalculator"], value["reportId"], value["budgetPlanDigest"])
        if type(actual["tables"]) is not list or len(actual["tables"]) != len(expected["tables"]):
            _fail("分卷表片段数量不一致")
        sheets = set()
        for part, planned in zip(actual["tables"], expected["tables"]):
            _fields(part, PART_FIELDS | {"sheet", "rowDigest", "precisionTextCells"})
            _equal({key: part[key] for key in PART_FIELDS}, planned)
            _sha(part["rowDigest"])
            sheet = part["sheet"]
            if type(sheet) is not str or not 1 <= len(sheet) <= 31 or sheet.casefold() in sheets:
                _fail("分卷工作表名称或顺序无效")
            sheets.add(sheet.casefold())
            _integer(part["precisionTextCells"], 0, part["rowLimit"] * part["columnCount"])
            if part["fragmentCount"] == 1:
                _equal(part["rowDigest"], source_by_key[part["key"]]["rowDigest"])
            if part["rowLimit"] == 0:
                _equal(part["rowDigest"], hashlib.sha256(b"").hexdigest())
        _equal(actual["rowCount"], sum(part["rowLimit"] for part in expected["tables"]))
        _fields(actual["files"], {"html", "xlsx"})
        for format in ("html", "xlsx"):
            proof = actual["files"][format]
            _fields(proof, {"filename", "bytes", "sha256"})
            _equal(proof["filename"], f"{value['reportId']}-volume-{actual['volumeIndex']:03}-of-{count:03}.{format}")
            size = _integer(proof["bytes"], 1, max_file)
            files.append({"volumeIndex": actual["volumeIndex"], "format": format, "bytes": size, "sha256": _sha(proof["sha256"]),
                          "chunkCount": (size + CHUNK_BYTES - 1) // CHUNK_BYTES})
    _equal(value["manifestDigest"], digest({key: child for key, child in value.items() if key != "manifestDigest"}))
    return files


def make(full_manifest, *, binding_digest, attempt, draft, max_tables=120, max_rows=1_000_000, max_volumes=100, renderer_version=4):
    """Return (compact receipt, exact canonical full-JSON artifact bytes).

    Optional capacity arguments are trusted policy and can only tighten defaults;
    they support synthetic splitting. Production and recovery use defaults.
    """
    full = _snapshot(full_manifest, MAX_MANIFEST_BYTES)
    files = _full(full, max_tables=max_tables, max_rows=max_rows, max_volumes=max_volumes, renderer_version=renderer_version)
    data = canonical(full).encode("utf-8")
    compact = {"schemaVersion": SCHEMA_VERSION, "rendererVersion": renderer_version, "bindingDigest": binding_digest, "attempt": attempt, "draft": draft,
               "volumeCount": full["volumeCount"], "files": files,
               "manifestFile": {"volumeIndex": 0, "format": "json", "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
                                "chunkCount": (len(data) + CHUNK_BYTES - 1) // CHUNK_BYTES}}
    return validate(compact, binding_digest=binding_digest, attempt=attempt, draft=draft, renderer_version=renderer_version), data


def verify_full(compact, manifest_bytes, *, binding_digest, attempt, draft, report_id, evidence_digest, plan_digest=None,
                max_tables=120, max_rows=1_000_000, max_volumes=100, renderer_version=4):
    """Cross-check the stored JSON artifact with compact and trusted bindings.

    The deterministic plan is always rebuilt, including when plan_digest is not
    separately available during recovery. A SHA alone is not source authority.
    This does not re-read facts or concatenate fragment digests into source SHA.
    """
    root = validate(compact, binding_digest=binding_digest, attempt=attempt, draft=draft, renderer_version=renderer_version)
    if type(manifest_bytes) is not bytes or not 1 <= len(manifest_bytes) <= MAX_MANIFEST_BYTES:
        _fail("完整多卷清单须为有界UTF-8字节")
    _equal(len(manifest_bytes), root["manifestFile"]["bytes"])
    _equal(hashlib.sha256(manifest_bytes).hexdigest(), root["manifestFile"]["sha256"])

    def pairs(items):
        result = {}
        for key, child in items:
            if key in result:
                _fail("完整多卷清单包含重复JSON键")
            result[key] = child
        return result

    try:
        parsed = json.loads(manifest_bytes.decode("utf-8"), object_pairs_hook=pairs)
    except (ValueError, UnicodeError, RecursionError) as error:
        raise AnalysisContractError("完整多卷清单JSON无效") from error
    full = _snapshot(parsed, MAX_MANIFEST_BYTES)
    files = _full(full, max_tables=max_tables, max_rows=max_rows, max_volumes=max_volumes, renderer_version=renderer_version)
    _equal(full["reportId"], report_id)
    _equal(full["evidenceDigest"], evidence_digest)
    if plan_digest is not None:
        _sha(plan_digest)
        _equal(full["planDigest"], plan_digest)
    _equal(full["volumeCount"], root["volumeCount"])
    _equal(files, root["files"])
    if canonical(full).encode("utf-8") != manifest_bytes:
        _fail("完整多卷清单不是规范JSON字节")
    return full
