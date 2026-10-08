"""Audit only: execute the unchanged current cache classes with memory loaders.

No Django setup, database, network, services, or business records are used.
AST extraction excludes imports that require runtime settings; the class bodies
and API error types are compiled directly from the reviewed files. This proves
lock topology and its 5-second error path, not production latency or frequency.
"""
import ast
import argparse
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import pickle
import subprocess
import threading
import time


ROOT = Path(__file__).resolve().parents[3]


def extract(path, class_name, namespace):
    source = path.read_text(encoding="utf-8-sig")
    tree = ast.parse(source, filename=str(path))
    node = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == class_name)
    module = ast.Module(body=[node], type_ignores=[])
    exec(compile(module, str(path), "exec"), namespace)
    return namespace[class_name], {"path": str(path.relative_to(ROOT)), "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "first_line": node.lineno, "last_line": node.end_lineno}


def probe(domain, filename, class_name, error_name):
    namespace = {"OrderedDict": OrderedDict, "json": json, "pickle": pickle,
                 "Lock": threading.Lock, "RLock": threading.RLock, "monotonic": time.monotonic}
    _, error_source = extract(ROOT / "backend" / domain / "errors.py", error_name, namespace)
    cache_type, source = extract(ROOT / "backend" / domain / filename, class_name, namespace)
    cache = cache_type()
    loader_calls = []

    def warm_load():
        loader_calls.append("warm")
        return {"rows": ["warm-synthetic-row"]}

    cache.read("warm-scope", warm_load, lambda: None)
    begin = time.perf_counter()
    cache.read("warm-scope", warm_load, lambda: None)
    warm_ms = (time.perf_counter() - begin) * 1000
    samples = []
    for hold_seconds in [0.2, None]:
        started, release, waiter_started = threading.Event(), threading.Event(), threading.Event()

        def slow_load():
            loader_calls.append("cold")
            started.set()
            if not release.wait(7):
                raise AssertionError("probe did not release synthetic loader")
            return {"rows": ["cold-synthetic-row"]}

        def follower():
            waiter_started.set()
            begin = time.perf_counter()
            try:
                value = cache.read("warm-scope", warm_load, lambda: None)
                return {"outcome": "success", "elapsed_ms": (time.perf_counter() - begin) * 1000, "value_unchanged": value == {"rows": ["warm-synthetic-row"]}}
            except Exception as error:
                return {"outcome": "error", "elapsed_ms": (time.perf_counter() - begin) * 1000, "status": getattr(error, "status", None), "code": getattr(error, "code", None), "message": str(error)}

        with ThreadPoolExecutor(max_workers=2) as pool:
            slow = pool.submit(cache.read, f"cold-scope-{hold_seconds}", slow_load, lambda: None)
            assert started.wait(1)
            hit = pool.submit(follower)
            assert waiter_started.wait(1)
            try:
                if hold_seconds is not None:
                    time.sleep(hold_seconds)
                    completed_before_release = hit.done()
                    release.set()
                    result = hit.result(2)
                else:
                    result = hit.result(6)
                    completed_before_release = hit.done()
                samples.append({"injected_hold_seconds": hold_seconds, "hold_description": "release after warmed follower returns" if hold_seconds is None else "release after fixed hold", "warm_follower_completed_before_release": completed_before_release, **result})
            finally:
                release.set()
                slow.result(2)
    assert len([x for x in loader_calls if x == "warm"]) == 1, loader_calls
    assert samples[0]["outcome"] == "success" and not samples[0]["warm_follower_completed_before_release"], samples
    assert samples[1]["outcome"] == "error" and samples[1]["status"] == 503, samples
    return {"domain": domain, "source": source, "error_source": error_source,
            "warm_hit_no_contention_ms": warm_ms, "samples": samples,
            "warm_loader_calls": loader_calls.count("warm"), "cold_loader_calls": loader_calls.count("cold")}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = {"kind": "isolated-memory-cache-lock-probe", "utc": datetime.now(timezone.utc).isoformat(),
              "reviewed_head": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
              "sample_count_per_domain": 1, "production_performance_claim": False,
              "results": [probe("inventory", "read_cache.py", "InventoryReadCache", "InventoryApiError"),
                          probe("products", "summary_cache.py", "SummaryCache", "ProductsApiError")]}
    serialized = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(serialized + "\n", encoding="utf-8")
        print(json.dumps({"output": str(args.output), "domains": [r["domain"] for r in result["results"]]}, ensure_ascii=True))
    else:
        print(json.dumps(result, ensure_ascii=True, indent=2))
