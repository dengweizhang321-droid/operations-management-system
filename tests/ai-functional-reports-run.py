"""W5/W7/W9 report rehearsal against the shared, disposable application stack."""
import base64
import hashlib
import hmac
import json
import logging
import os
from pathlib import Path
import sys
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener
import re


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = Path("D:/codex-artifacts/ai-isolated-functional-20261108/reports")
DJANGO_READER = "http://127.0.0.1:28444"
DJANGO_WRITER = "http://127.0.0.1:28447"
EDGE = "http://127.0.0.1:28445"
PROVIDER = "http://127.0.0.1:28446/v1"
DAY = "2026-11-06"
SHOP = "隔离周报甲店"


class RejectRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class PhaseLog(logging.Handler):
    def __init__(self):
        super().__init__()
        self.events = []

    def emit(self, record):
        message = record.getMessage()
        if message.startswith("ai_execution_phase "):
            self.events.append(json.loads(message.removeprefix("ai_execution_phase ")))


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def guarded_setup(*, admin):
    from ai_functional_environment import ROOT as PRIVATE_ROOT, environment, network_guard

    private_env = environment(admin=admin)
    os.environ.clear()
    os.environ.update(private_env)
    network_guard()
    sys.path.insert(0, str(ROOT / "backend"))
    import django
    django.setup()
    from django.conf import settings
    from django.db import connection

    db = connection.settings_dict
    require(connection.vendor == "postgresql" and db["HOST"] == "127.0.0.1"
            and str(db["PORT"]) == "55488" and db["NAME"] == "functional_ai", "requires the disposable functional PostgreSQL")
    require(settings.DJANGO_PROCESS_ROLE == "development" and settings.DJANGO_ENVIRONMENT == "development", "requires the development role and environment")
    require(os.environ.get("AI_ALLOW_LOCAL_MODEL_ENDPOINTS") == "true" and os.environ.get("TERUISI_DJANGO_AI_EDGE_BASE_URL") == EDGE, "local model and edge routes must be explicit")
    with connection.cursor() as cursor:
        cursor.execute("SELECT host(inet_server_addr()), inet_server_port(), current_database(), current_user, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)")
        actual = cursor.fetchone()
        expected_role = ("postgres", True) if admin else ("functional_app", False)
        require(actual == ("127.0.0.1", 55488, "functional_ai", *expected_role), "functional PostgreSQL identity differs")
        if admin:
            cursor.execute("SHOW data_directory")
            require(Path(cursor.fetchone()[0]).resolve() == (PRIVATE_ROOT / "pg").resolve(), "functional data directory differs")


def identities(run_key):
    from sales.auth import Principal

    return Principal(f"{run_key}@example.invalid", "隔离报告管理员", "admin", None), {
        key: f"{run_key}-{key}" for key in ("a", "b", "429")}


def seed(run_key):
    from access_control.models import AccessRole, AppUser
    from ai_assistant.control_models import AiDataRevision, AiWriteAuthority
    from ai_assistant.models import AiModels
    from ai_assistant.secrets import encrypt
    from django.db import transaction
    from django.utils import timezone
    from netshop.import_service import _bump_global_revision, _bump_product_daily_revision
    from netshop.models import NetshopImportBatch, NetshopRow

    actor, model_ids = identities(run_key)
    stamp = timezone.now()
    with transaction.atomic():
        AiDataRevision.objects.get_or_create(domain="ai-assistant")
        AiWriteAuthority.objects.get_or_create(id=1)
        AccessRole.objects.get_or_create(code="admin", defaults={"label": "隔离管理员", "description": "隔离管理员", "rank": 3, "permissions": []})
        AppUser.objects.create(email=actor.email, display_name=actor.display_name, role_id=actor.role,
                               scope=actor.scope, created_at=stamp, updated_at=stamp)
        for key, model_id in model_ids.items():
            AiModels.objects.create(id=model_id, name=f"Isolated report fixture {key}", status="enabled", protocol="openai_compatible",
                                    model_type="text", model_name=f"isofunc-report-{key}", base_url=PROVIDER,
                                    api_key_encrypted=encrypt("synthetic-report-fixture-key"), api_key_suffix="-key", timeout_ms=10000)
        for key, platform, shop, facts in (
            ("target", "京东", SHOP, [("rate", DAY, 20, 2, 8, 24000), ("zero", DAY, 0, 0, 3, 4000),
                                      ("missing", DAY, 10, None, 4, 3400), ("wrong-day", "2026-11-07", 80, 44, 55, 96000)]),
            ("other-shop", "京东", "隔离周报乙店", [("wrong-shop", DAY, 90, 66, 77, 98000)]),
            ("other-platform", "天猫", SHOP, [("wrong-platform", DAY, 95, 77, 88, 99000)]),
        ):
            source = "jd_sku_daily" if platform == "京东" else "tmall_product_daily"
            batch_id = f"iso-report-{key}"
            batch_hash = sha(batch_id.encode())
            batch, changed = NetshopImportBatch.objects.get_or_create(pk=batch_id, defaults={
                "source": source, "dataset": "spu_daily", "platform": platform, "shop_name": shop, "status": "completed",
                "file_name": f"{batch_id}.xlsx", "file_size_bytes": 1, "file_hash": batch_hash, "raw_file_hash": batch_hash,
                "content_hash": batch_hash, "scope_key": batch_hash, "published_state_token": batch_hash,
                "row_count": len(facts), "date_min": min(row[1] for row in facts), "date_max": max(row[1] for row in facts),
                "created_at": stamp.isoformat(), "completed_at": stamp.isoformat(),
            })
            for ordinal, (product, day, visitors, customers, qty, cents) in enumerate(facts, start=2):
                row_key = f"{batch_id}-{product}"
                metrics = {"visitors": visitors, "transactionQuantity": qty, "transactionAmountCents": cents}
                if customers is not None:
                    metrics["transactionCustomers"] = customers
                _, created = NetshopRow.objects.get_or_create(source_row_key=row_key, defaults={
                    "source_row_hash": sha(row_key.encode()), "first_import_batch_id": batch.id, "last_import_batch_id": batch.id,
                    "source_row_number": ordinal, "source": source, "dataset": "spu_daily", "platform": platform, "shop_name": shop,
                    "business_date": day, "spu_id": f"iso-report-{product}", "sku_id": f"iso-report-sku-{product}",
                    "product_name": f"隔离商品 {product}", "metrics_json": metrics, "visitors": visitors,
                    "transaction_customers": customers if customers is not None else 0, "transaction_quantity": qty,
                    "transaction_amount_cents": cents, "created_at": stamp.isoformat(), "updated_at": stamp.isoformat(),
                })
                changed = changed or created
            if changed:
                _bump_global_revision(batch.id, batch.content_hash, batch.published_state_token)
                _bump_product_daily_revision(platform, shop)


class Run:
    def __init__(self, key, principal, models, *, suffix=""):
        self.key, self.principal, self.models = key, principal, models
        self.suffix = suffix
        self.http = build_opener(ProxyHandler({}), RejectRedirect())
        self.evidence = {"runKey": key, "checks": {}}

    def save(self):
        OUTPUT.mkdir(parents=True, exist_ok=True)
        output = OUTPUT / f"{self.key}{self.suffix}.json"
        output.write_text(json.dumps(self.evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    def call(self, path, payload=None, *, query=None, expect=200):
        from ai_assistant.policy import canonical
        from ai_assistant.transport import signed_headers

        query_string = urlencode(query or {})
        origin = DJANGO_READER if payload is None and path == "/api/ai/report-library" else DJANGO_WRITER
        url = origin + path + ("?" + query_string if query_string else "")
        headers = signed_headers(path, payload or {}, self.principal)
        if payload is None:
            headers["X-Teruisi-Content-SHA256"] = sha(b"")
            values = ["v1", headers["X-Teruisi-Timestamp"], headers["X-Teruisi-Request-Id"], "GET", path, query_string,
                      headers["X-Teruisi-Content-SHA256"], headers["X-Teruisi-Principal"]]
            key = os.environ["TERUISI_DJANGO_INTERNAL_SECRET"].encode()
            headers["X-Teruisi-Signature"] = "v1=" + hmac.new(key, "\n".join(values).encode(), hashlib.sha256).hexdigest()
        else:
            headers["Content-Type"] = "application/json"
        request = Request(url, data=canonical(payload).encode() if payload is not None else None, headers=headers)
        try:
            result = self.http.open(request, timeout=20)
        except HTTPError as error:
            result = error
        with result:
            body = json.loads(result.read(1024 * 1024))
            require(result.status == expect, f"{request.get_method()} {path}: got {result.status}, expected {expect} ({body.get('code', '')})")
        return body

    def body(self, request, model, *, scene="weekly", dry=False):
        return {"clientRequestId": f"{self.key}-{request}", "pipelineId": f"{scene}-pipeline", "expectedVersion": self.library,
                "scope": {"platform": "京东", "shop": SHOP, "startDate": DAY, "endDate": DAY},
                "dryRun": dry, "modelId": self.models[model]}

    def detail(self, item):
        return self.call(f"/api/ai/reports/{item['id']}")

    def tick(self, item, status):
        from ai_assistant.workflows import workflow_tick

        result = workflow_tick()
        require(result["status"] == status, f"workflow {item['workflowId']}: expected {status}, got {result['status']}")
        if "runId" in result:
            require(result["runId"] == item["workflowId"], "isolated workflow queue must have no competing eligible run")
        return self.detail(item)["workflow"]

    def finish_agent(self, job, expected):
        from ai_assistant.workflows import agent_tick

        for _ in range(12):
            result = agent_tick(job_id=job)
            if result["status"] == expected:
                return result
            require(result["status"] == "checkpoint", f"agent {job}: stopped at {result}")
        raise AssertionError(f"agent {job}: exceeded bounded steps")

    def report_and_dag(self):
        from ai_assistant import models as m, reports
        from ai_assistant.control_models import AiWriteReceipt
        from ai_assistant.policy import digest
        from ai_assistant.workflows import workflow_tick

        path = "/api/ai/reports"
        request = self.body("original", "a")
        original = self.call(path, request)
        item = original["item"]
        require(not original["replayed"] and item["modelId"] == self.models["a"] and item["modelVersion"] == 1, "explicit model A is pinned")
        alias = self.body("alias", "a")
        reused = self.call(path, alias)
        require(reused["replayed"] and reused["item"]["id"] == item["id"], "active alias must reuse original")
        self.call(path, {**alias, "modelId": self.models["b"]}, expect=409)
        require(AiWriteReceipt.objects.filter(request_id="report-alias-v1/" + digest([self.principal.email, alias["clientRequestId"]]),
                                              status="report_alias").exists(), "domain alias must be durable")

        workflow = self.tick(item, "running")
        collect, render, review = workflow["nodes"]
        require(collect["status"] == "running" and render["status"] == review["status"] == "pending", "collect is first and dependent work waits")
        self.finish_agent(collect["agentJobId"], "completed")
        workflow = self.tick(item, "running")
        collect, render, review = workflow["nodes"]
        require(collect["status"] == "completed" and render["status"] == "running" and review["status"] == "pending", "one tick must observe collect and queue report")
        require(m.AiAgentProviderDispatches.objects.filter(job_id=render["agentJobId"]).count() == 0, "parent tick must not dispatch a provider")
        self.finish_agent(render["agentJobId"], "completed")
        workflow = self.tick(item, "waiting_review")
        review = workflow["nodes"][-1]
        require(workflow["timing"]["humanReviewUnionMs"] is None and review["status"] == "waiting_review", "open human review has unknown duration")
        require(workflow_tick()["status"] == "idle", "waiting review must not run again")
        self.call(f"{path}/{item['id']}/content", query={"format": "html"}, expect=409)
        detail = self.detail(item)
        require(any("2 ÷ 访客数 20 = 10%" in section["body"] for section in detail["sections"]), "report carries factual conversion")
        self.call(f"/api/ai/workflow-runs/{item['workflowId']}/nodes/review/review", {"expectedVersion": review["version"], "decision": "approve"})
        workflow = self.tick(item, "completed")
        timing = workflow["timing"]
        require(not timing["additive"] and not timing["truncated"] and not timing["unknownDispatches"], "complete timing projection")
        require(all(type(timing[key]) is int and timing[key] >= 0 for key in ("wallMs", "providerDispatchUnionMs", "toolDispatchUnionMs", "humanReviewUnionMs")), "known windows must be measured")

        artifact = self.call(f"{path}/{item['id']}/content", query={"format": "html"})
        html = base64.b64decode(artifact["base64"], validate=True)
        require("成交额 31400 分".encode() in html and "商品×日累计".encode() in html, "approved HTML contains supported facts")
        (OUTPUT / f"{self.key}-weekly.html").write_bytes(html)
        retried = self.call(path, alias)
        require(retried["replayed"] and retried["item"]["id"] == item["id"] and retried["item"]["status"] == "completed", "terminal alias retry must not create report")

        row = m.AiReportRun.objects.get(pk=item["id"])
        receipts = reports.evidence(row)
        require([receipt["tool"] for receipt in receipts] == ["get_data_freshness", "get_netshop_performance"], "two real ordered tool receipts")
        facts = receipts[-1]["result"]["data"]
        calls = list(m.AiAgentProviderResults.objects.filter(dispatch__job__workflow_run_id=item["workflowId"])
                     .order_by("dispatch__reserved_at").values_list("provider_request_id", flat=True))
        require(calls == [f"fixture-isofunc-report-a-{phase}" for phase in ("tools", "collect", "report")], "three unique successful model dispatches")
        self.evidence["checks"]["W5-W7-W9-report"] = {"report": item, "terminalStatus": workflow["status"], "activeAndTerminalAlias": True, "providerReceipts": calls,
            "sources": [{"tool": row["tool"], "arguments": row["arguments"], "digest": row["digest"]} for row in receipts],
            "coverage": facts["coverage"], "summary": facts["summary"], "summaryFieldAvailability": facts["summaryFieldAvailability"],
            "productFacts": [{key: row[key] for key in ("id", "platform", "shopNames", "visitors", "transactionCustomers",
                                                            "transactionQuantity", "conversionRate", "fieldAvailability")} for row in facts["items"]],
            "timing": timing, "htmlSha256": sha(html)}
        self.save()

    def model_fences(self, events):
        from ai_assistant import models as m
        from ai_assistant.policy import mutation

        path = "/api/ai/reports"
        dry_scenes = []
        for scene in ("weekly", "inventory", "promotion"):
            item = self.call(path, self.body(f"dry-{scene}", "b", scene=scene, dry=True))["item"]
            require(item["dryRun"] and item["selectedModelId"] == self.models["b"], "dry selection must persist on each scene")
            for _ in range(3):
                self.tick(item, "queued")
            self.tick(item, "completed")
            require(not m.AiAgentJobs.objects.filter(workflow_run_id=item["workflowId"]).exists(), "dry workflow may not create a provider job")
            dry_scenes.append(scene)

        diagnostics = []
        for key, error_code, stage in (("b", "model_version_changed", "admission"), ("429", "provider_rate_limited", "provider_http")):
            request = self.body(f"fail-{key}", key)
            item = self.call(path, request)["item"]
            workflow = self.tick(item, "running")
            if key == "b":
                with mutation(self.principal):
                    m.AiModels.objects.filter(pk=self.models[key]).update(version=2)
            result = self.finish_agent(workflow["nodes"][0]["agentJobId"], "failed")
            require(result["errorCode"] == error_code, f"report failure expected {error_code}, got {result['errorCode']}")
            workflow = self.tick(item, "failed")
            failed = workflow["nodes"][0]
            require((failed["status"], failed["errorCode"]) == ("failed", error_code), "detail must expose original failed node")
            require(workflow["nodes"][1]["agentJobId"] is None, "failed collect must not queue report")
            matching = [event for event in events if event["requestId"] == request["clientRequestId"]]
            require(len(matching) == 1 and matching[0]["stage"] == stage and matching[0]["workflowId"] == item["workflowId"], "original request diagnostic phase")
            dispatches = m.AiAgentProviderDispatches.objects.filter(job_id=failed["agentJobId"])
            if key == "b":
                require(not dispatches.exists(), "version drift must stop before reserving or sending")
            else:
                error = matching[0]["error"]
                require((error["httpStatus"], error["appStatus"], error["requestStarted"]) == (429, 503, True), "upstream HTTP status and local error mapping")
                require("iso-report-private-upstream-text" not in json.dumps(matching[0]), "raw upstream error must be absent")
                require(dispatches.count() == 1 and dispatches.first().state == "unknown", "failed dispatch must retain original reservation")
                require(workflow["timing"]["providerDispatchUnionMs"] is None, "unknown dispatch has no measured union")
                require(self.call(path, request)["item"]["id"] == item["id"], "failed report request must not reissue provider")
            diagnostics.append(matching[0])
        self.evidence["checks"]["W5-model-fences"] = {"dryScenes": dry_scenes, "diagnostics": diagnostics}
        self.save()

    def page_metric(self):
        from ai_assistant.policy import digest
        from ai_assistant.transport import catalog, execute_tool

        entries = catalog(self.principal, "ai_agent")
        require(any(entry["name"] == "get_netshop_page_data" for entry in entries), "page tool absent from actual catalog")
        request = {"view": "performance", "dimension": "spu", "platforms": ["京东"],
                   "outlets": [{"platform": "京东", "shopName": SHOP}], "startDate": DAY, "endDate": DAY, "limit": 6}

        def query(args, suffix):
            result = execute_tool("get_netshop_page_data", args, self.principal, surface="ai_agent",
                                  request_id=f"{self.key}-page-{suffix}", policy_digest=digest(entries))
            require(result.get("ok") is True and result.get("auditStatus") != "unavailable", "actual page tool did not return audited facts")
            return result["data"]

        complete = query(request, "complete")
        rows = {row["id"]: row for row in complete["items"]}
        require(set(rows) == {"iso-report-rate", "iso-report-zero", "iso-report-missing"}, "page projection must keep exact scope")
        require(rows["iso-report-rate"]["conversionRate"] == 0.1 and rows["iso-report-zero"]["conversionRate"] is None, "page projection must retain conversion and zero denominator")
        missing = {"complete": False, "reasonCode": "missing_field"}
        require(rows["iso-report-missing"]["fieldAvailability"]["transactionCustomers"] == missing
                and complete["summaryFieldAvailability"]["transactionCustomers"] == missing, "page projection must keep row and summary availability")
        incomplete = query({**request, "endDate": "2026-11-08"}, "incomplete")
        require(incomplete["coverage"]["missingDates"] == ["2026-11-08"] and incomplete["summaryFieldAvailability"]["visitors"] ==
                {"complete": False, "reasonCode": "incomplete_coverage"}, "page projection must not qualify incomplete periods")
        self.evidence["checks"]["W7-page"] = {"coverage": complete["coverage"], "summaryFieldAvailability": complete["summaryFieldAvailability"],
            "productFacts": [{key: row[key] for key in ("id", "platform", "shopNames", "conversionRate", "fieldAvailability")} for row in rows.values()],
            "incompleteCoverage": incomplete["coverage"], "incompletePeriodAvailability": incomplete["summaryFieldAvailability"]}
        self.save()


def main():
    if len(sys.argv) != 3 or sys.argv[1] not in {"seed", "run", "supplement"} or not re.fullmatch(r"isofunc-report-[a-z0-9-]{1,24}", sys.argv[2]):
        raise SystemExit("Usage: ai-functional-reports-run.py seed|run|supplement isofunc-report-<unique key>")
    action, key = sys.argv[1:]
    guarded_setup(admin=action == "seed")
    if action == "seed":
        seed(key)
        print(f"Seeded synthetic report fixtures: {key}")
        return
    logger = logging.getLogger("ai_assistant.workflows")
    log = PhaseLog()
    logger.addHandler(log)
    logger.setLevel(logging.INFO)
    run = Run(key, *identities(key), suffix="-supplement" if action == "supplement" else "")
    run.save()
    try:
        run.library = run.call("/api/ai/report-library")["item"]["version"]
        if action == "run":
            run.report_and_dag()
        run.model_fences(log.events)
        run.page_metric()
    finally:
        run.evidence["executionPhases"] = log.events
        run.save()
        logger.removeHandler(log)
    print(f"W5/W7/W9 report checks passed: {key}")


if __name__ == "__main__":
    main()
