"""Measure real verifier calls over one frozen synthetic chain (no write effects)."""
import argparse
import json
from pathlib import Path
import sys
import time
from unittest.mock import patch


def probe(root, runtime, *, database=False, private_data=None, private_port=None, set_role=True):
    import bi_app_addition as common
    import pi_agent_addition as pi
    import integration_release_gate as integration
    counts = {"original139": 0, "reads": 0, "readBytes": 0}
    original_parent, read_bytes, read_text = common.original_parent, Path.read_bytes, Path.read_text
    runtime, root = Path(runtime), Path(root)
    fixture = runtime.parent
    def parent(*args, **kwargs):
        counts["original139"] += 1
        return original_parent(*args, **kwargs)
    def bytes_(path):
        result = read_bytes(path)
        if path.is_relative_to(fixture):
            counts["reads"] += 1
            counts["readBytes"] += len(result)
        return result
    def text_(path, *args, **kwargs):
        result = read_text(path, *args, **kwargs)
        if path.is_relative_to(fixture):
            counts["reads"] += 1
            counts["readBytes"] += len(result.encode("utf8"))
        return result
    def isolated_identity(connection):
        # This sole test identity seam cannot admit any production connection.
        with connection.cursor() as cursor:
            cursor.execute("SELECT current_database(),current_user,host(inet_server_addr()),inet_server_port()")
            if cursor.fetchone() != ("teruisi_pi_schema_rehearsal", "teruisi_sales_owner", "127.0.0.1", private_port):
                raise ValueError("Private schema gate identity changed")
    if database:
        import django
        django.setup()
        from django.db import connection
        with connection.cursor() as cursor:
            cursor.execute("SHOW data_directory")
            actual = Path(cursor.fetchone()[0]).resolve()
            assert private_data and actual == Path(private_data).resolve()
            assert 55531 <= private_port <= 55539
            assert actual != Path(r"D:\teruisi-runtime\django-sales\data")
            if set_role:
                cursor.execute("SET ROLE teruisi_sales_owner")
    started, cpu = time.perf_counter(), time.process_time()
    with patch.object(common, "original_parent", parent), patch.object(Path, "read_bytes", bytes_), patch.object(Path, "read_text", text_):
        if database:
            with patch.object(pi, "database_identity", isolated_identity):
                result = integration.verify_database_complete(root, runtime)
        else:
            result = integration.verify_release(root, runtime)
    return {"gate": "database-complete-gate-helper" if database else "protected-release-gate-helper",
        "elapsedMs": (time.perf_counter() - started) * 1000, "cpuMs": (time.process_time() - cpu) * 1000,
        **counts, "result": result, "identitySeam": "private-data-port-role-only" if database else None}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--runtime", required=True)
    parser.add_argument("--database", action="store_true")
    parser.add_argument("--private-data")
    parser.add_argument("--private-port", type=int)
    args = parser.parse_args()
    print(json.dumps(probe(args.root, args.runtime, database=args.database,
        private_data=args.private_data, private_port=args.private_port), sort_keys=True))
