"""Build a shareable summary from private audit traces; omit product rows and credentials."""
from collections import Counter, defaultdict
from datetime import datetime
import hashlib
import json
from pathlib import Path
import statistics

PRIVATE = Path("D:/codex-artifacts/market-annotation-chain-audit-20261014")
DEST = Path(__file__).resolve().parent / "evidence"
DEST.mkdir(exist_ok=True)


def read(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def lines(path):
    return [json.loads(s) for s in path.read_text(encoding="utf-8-sig").splitlines() if s.strip()]


def latest(pattern):
    return max(PRIVATE.glob(pattern), key=lambda p:p.stat().st_mtime)


ledger = lines(PRIVATE / "provider-call-ledger.jsonl")
ledger.sort(key=lambda r:r["callNumber"])
assert [r["callNumber"] for r in ledger] == list(range(1, len(ledger)+1))
assert len(ledger) <= 50
model_rows = lines(PRIVATE / "model-trace.jsonl")
attempts = []
for intent in ledger:
    rows = [r for r in model_rows if r["runId"] == intent["runId"] and r.get("sampleId") == intent["sampleId"]]
    provider = next(r for r in rows if r.get("stage")=="provider_post" and r.get("phase")=="end")
    result = next(r for r in rows if r.get("stage")=="vision_attempt" and r.get("phase")=="end")
    attempts.append({"callNumber":intent["callNumber"],"sampleId":intent["sampleId"],"variant":intent["variant"],
        "httpStatus":provider.get("httpStatus"),"modelMs":provider.get("durationMs"),
        "finishReason":provider.get("finishReason"),"contentCharacters":provider.get("contentCharacters"),
        "usage":provider.get("usage"),"validPrediction":result["outcome"]=="success"})
variants = {}
for variant in sorted({r["variant"] for r in attempts}):
    selected = [r for r in attempts if r["variant"]==variant]
    variants[variant] = {"requests":len(selected),"validPredictions":sum(r["validPrediction"] for r in selected),
        "httpStatuses":dict(Counter(r["httpStatus"] for r in selected))}
chain_path = PRIVATE / "chain-test_02_session_header_non_thinking_chain-10ad8b6a.json"
chain = read(chain_path)
timeline = lines(chain_path.with_suffix(".jsonl"))
groups = defaultdict(list)
for row in timeline:
    if row.get("phase")=="end" and "durationMs" in row:
        groups[row["stage"]].append(row)
stages = {name:{"count":len(rows),"totalMs":round(sum(r["durationMs"] for r in rows),3),
    "meanMs":round(statistics.mean(r["durationMs"] for r in rows),3),
    "sqlCount":sum(r.get("sqlCount",0) for r in rows)} for name,rows in groups.items()}
start = next(r["at"] for r in timeline if r.get("stage")=="create_plan" and r.get("phase")=="start")
end = next(r["at"] for r in timeline if r.get("stage")=="final_progress_read" and r.get("phase")=="end")
scale = read(latest("chain-test_03*.json"))
creation = [{k:r[k] for k in ("sampleCount","durationMs","sqlCount","sqlMs")}
    for r in scale["events"] if r.get("stage")=="create_plan_scale" and r.get("phase")=="end"]
plans = []
for path in sorted(PRIVATE.glob("chain-test_04*.json")):
    p=read(path)
    plans.append({"staleStatsMs":p["stale_statistics_default"]["durationMs"],
        "hashJoinMs":p["diagnostic_hash_join"]["durationMs"],"analyzeMs":p["isolatedAnalyzeMs"],
        "freshStatsMs":p["fresh_statistics_default"]["durationMs"],
        "sameSelectedItem":len({p[k]["selectedSyntheticId"] for k in
            ("stale_statistics_default","diagnostic_hash_join","fresh_statistics_default")})==1,
        "sameFrozenSnapshotForFirstPair":p["sameFrozenSnapshotForFirstPair"]})
summary = {"authorizedRequestMaximum":50,"actualProviderRequests":len(ledger),"variants":variants,
    "successfulIsolatedChain":{"samples":12,"A":6,"B":6,"validPredictions":12,"committed":12,
        "wallSeconds":(datetime.fromisoformat(end)-datetime.fromisoformat(start)).total_seconds(),
        "stages":stages,"claimOrder":chain["claimOrder"],"finalQueues":chain["finalProgress"]["queues"]},
    "creationScale":creation,"frozenQueryComparisons":plans,
    "boundaries":["Historical production observations and current replay are separate evidence",
        "Provider requests are real, through the deployed vision adapter in Node",
        "Domain writes use a disposable PostgreSQL database and signed Django Client requests",
        "Public image API substitutes for native R2 access; image transformation was not benchmarked",
        "Human review is simulated, not a semantic accuracy gold set",
        "Later repetition stopped before provider calls because the production environment entered maintenance",
        "No production annotation/task/model configuration or database statistics were changed"]}
(DEST/"summary.json").write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding="utf-8")
(DEST/"model-attempts.json").write_text(json.dumps(attempts,ensure_ascii=False,indent=2),encoding="utf-8")
(DEST/"isolated-chain-timeline.json").write_text(json.dumps(timeline,ensure_ascii=False,indent=2),encoding="utf-8")
manifest = [{"name":p.name,"bytes":p.stat().st_size,"sha256":hashlib.sha256(p.read_bytes()).hexdigest()}
    for p in sorted(PRIVATE.glob("*.json*")) if not p.name.endswith(".private.json")]
(DEST/"private-evidence-manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding="utf-8")
print(json.dumps(summary,ensure_ascii=False,indent=2))
