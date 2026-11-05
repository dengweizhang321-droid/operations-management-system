"""One-off, audited blank-latest-image backfill for the user's 2026-11-05 workbook.

Prepare uses the market reader. Apply requires the exact prepared plan digest and
the existing least-privilege market writer, and never changes price snapshots.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import uuid
import xml.etree.ElementTree as ET
import zipfile
import urllib.request

import psycopg
from psycopg.types.json import Jsonb

NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def principal():
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args):
            return None
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with opener.open("http://127.0.0.1:3000/api/auth/me", timeout=15) as response:
        assert response.status == 200
        user = json.loads(response.read(16384))["user"]
    assert user["email"] == "local-admin@teruisi.local" and user["role"] == "admin" and user["scopeRestricted"] is False
    return dict(email=user["email"], role=user["role"])


def workbook(path):
    from urllib.parse import urlsplit
    import re
    raw = path.read_bytes()
    assert len(raw) < 40_000_000, "Workbook too large"
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        strings = (["".join(x.itertext()) for x in ET.fromstring(archive.read("xl/sharedStrings.xml"))]
                   if "xl/sharedStrings.xml" in archive.namelist() else [])
        rows = ET.fromstring(archive.read("xl/worksheets/sheet1.xml")).find("s:sheetData", NS)
        values = []
        for row in rows:
            value = {}
            for cell in row:
                key = re.sub(r"\d", "", cell.attrib["r"])
                value[key] = (strings[int(cell.find("s:v", NS).text)]
                              if cell.attrib.get("t") == "s" else "".join(cell.itertext()))
            values.append(value)
    assert values[0]["A"] == "SKUID" and values[0]["C"] == "商品图片链接"
    assert len(values) == 52396, "Unexpected workbook row count"
    result = {}
    for value in values[1:]:
        sku, image = value["A"].strip(), value.get("C", "").strip()
        assert sku.isdigit() and sku not in result, "Invalid or duplicate SKU"
        if image:
            url = urlsplit(image)
            assert (url.scheme == "https" and re.fullmatch(r"img\d+\.360buyimg\.com", url.hostname or "")
                    and not url.port and not url.username and not url.password
                    and not url.query and not url.fragment and re.match(r"^/(imgzone|n5)/", url.path)), "Invalid image URL"
        result[sku] = image
    assert sum(bool(v) for v in result.values()) == 46920
    return hashlib.sha256(raw).hexdigest(), result


def connect(mode):
    role = "teruisi_market_reader" if mode == "prepare" else "teruisi_market_writer"
    conn = psycopg.connect(host="127.0.0.1", port=5432, dbname="teruisi_sales", user=role,
                          password=os.environ["MARKET_IMAGE_BACKFILL_PASSWORD"], connect_timeout=5,
                          options="-c statement_timeout=30000 -c lock_timeout=3000",
                          application_name="market_workbook_image_backfill_20261105")
    conn.execute("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE" + (" READ ONLY" if mode == "prepare" else ""))
    actual = conn.execute("SELECT current_user,rolsuper,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname=current_user").fetchone()
    assert actual == (role, False, False, False), "Wrong database identity"
    return conn


def authority(conn):
    row = conn.execute("SELECT status,authority_epoch::text,cutover_id FROM market_write_authority WHERE id=1").fetchone()
    assert row and row[0] == "postgres", "Market writer is not authoritative"
    assert row[1] == os.environ["MARKET_IMAGE_AUTHORITY_EPOCH"] and row[2] == os.environ["MARKET_IMAGE_CUTOVER_ID"]
    return list(row)


def prepare(conn, file_hash, mapping):
    actor = principal()
    revision = conn.execute("SELECT revision,source_digest FROM market_data_revisions WHERE domain='market'").fetchone()
    rows = conn.execute("""SELECT i.id,e.id,e.category,e.scope,e.ranking_dimension,e.sku_code,e.period_end
        FROM market_master_identities i JOIN market_ranking_entries e ON e.id=i.latest_entry_id
        WHERE i.ranking_dimension='SKU' AND e.ranking_dimension='SKU' AND e.image_url=''
        ORDER BY i.id LIMIT 60000"""
    ).fetchall()
    assert len(rows) < 60000
    targets = [dict(zip(("identityId", "entryId", "category", "scope", "dimension", "sku", "periodEnd"), row),
                    imageUrl=mapping[row[5]]) for row in rows if mapping.get(row[5])]
    urls = sorted({x["imageUrl"] for x in targets})
    caches = conn.execute("SELECT source_url,content_sha256,object_key,status FROM market_image_cache WHERE source_url=ANY(%s)", (urls,)).fetchall()
    ready = {r[0]: r[1] for r in caches if r[3] == "ready" and len(r[1]) == 64 and r[2]}
    return dict(version=1, fileSha256=file_hash, authority=authority(conn), actor=actor, revision=list(revision),
                missingLatest=len(rows), targets=targets, readyCacheCount=sum(x["imageUrl"] in ready for x in targets),
                unreadyUrls=[u for u in urls if u not in ready])


def apply(conn, plan, file_hash, mapping, plan_hash):
    assert plan["fileSha256"] == file_hash
    actor = principal()
    assert actor == plan["actor"], "Administrator identity changed"
    assert authority(conn) == plan["authority"]
    action = "workbook_blank_latest_image_backfill"
    entity = file_hash + ":" + plan_hash
    old = conn.execute("SELECT after_json FROM market_master_audit_logs WHERE action=%s AND entity_id=%s", (action, entity)).fetchall()
    if old:
        assert len(old) == 1
        return {**old[0][0], "status": "already_applied"}
    revision = conn.execute("SELECT revision,source_digest FROM market_data_revisions WHERE domain='market' FOR UPDATE").fetchone()
    assert list(revision) == plan["revision"], "Market changed since prepare; prepare a new plan"
    assert not conn.execute("SELECT 1 FROM market_import_scope_heads WHERE status='processing' LIMIT 1").fetchone(), "Market import in progress"
    targets = plan["targets"]
    assert 0 < len(targets) < 60000 and not plan["unreadyUrls"], "No targets or uncached source images"
    identity_ids = [x["identityId"] for x in targets]
    identities = conn.execute("SELECT id,latest_entry_id,category,scope,ranking_dimension,sku_code FROM market_master_identities WHERE id=ANY(%s) ORDER BY id FOR UPDATE", (identity_ids,)).fetchall()
    assert len(identities) == len(targets)
    for row, expected in zip(identities, targets):
        assert tuple(row) == tuple(expected[k] for k in ("identityId", "entryId", "category", "scope", "dimension", "sku"))
        assert mapping[expected["sku"]] == expected["imageUrl"]
    urls = sorted({x["imageUrl"] for x in targets})
    caches = conn.execute("SELECT source_url,content_sha256,object_key,status FROM market_image_cache WHERE source_url=ANY(%s) FOR SHARE", (urls,)).fetchall()
    assert {r[0] for r in caches if r[3] == "ready" and len(r[1]) == 64 and r[2]} == set(urls), "Source cache changed"
    conflicts = conn.execute("""SELECT count(*) FROM market_price_snapshots p
        JOIN jsonb_to_recordset(%s::jsonb) AS v(category text,scope text,sku text,month text,url text)
        ON p.category=v.category AND p.scope=v.scope AND p.sku_code=v.sku
          AND p.ranking_dimension='SKU' AND p.month=v.month
        WHERE p.image_url<>'' AND p.image_url<>v.url
          AND (p.confirmed_market_price_cents IS NOT NULL OR p.ai_image_price_cents IS NOT NULL)""",
        (Jsonb([dict(category=x["category"], scope=x["scope"], sku=x["sku"], month=x["periodEnd"][:7], url=x["imageUrl"]) for x in targets]),)).fetchone()[0]
    assert conflicts == 0, "Current-month price evidence conflicts with backfilled image"
    before = conn.execute("SELECT id,sku_code,image_url FROM market_ranking_entries WHERE id=ANY(%s) ORDER BY id FOR UPDATE", ([x["entryId"] for x in targets],)).fetchall()
    assert len(before) == len(targets) and all(row[2] == "" for row in before)
    # Update ONLY the selected latest-entry image. No historical rows, snapshots,
    # numeric fields, batch identities, original evidence or confirmations change.
    changed = conn.execute("""UPDATE market_ranking_entries e SET image_url=v.url,updated_at=NOW()
        FROM jsonb_to_recordset(%s::jsonb) AS v(id bigint,url text)
        WHERE e.id=v.id AND e.image_url='' RETURNING e.id,e.image_url""",
        (Jsonb([dict(id=x["entryId"], url=x["imageUrl"]) for x in targets]),)).fetchall()
    assert sorted(changed) == sorted((x["entryId"], x["imageUrl"]) for x in targets), "Backfill readback mismatch"
    readback = conn.execute("SELECT id,image_url FROM market_ranking_entries WHERE id=ANY(%s) ORDER BY id", ([x["entryId"] for x in targets],)).fetchall()
    assert readback == sorted(changed), "Stored image readback mismatch"
    event = dict(kind=action, fileSha256=file_hash, planSha256=plan_hash, count=len(targets))
    next_revision = int(revision[0]) + 1
    next_digest = digest(dict(domain="market", previous=revision[1], revision=next_revision, event=event))
    conn.execute("UPDATE market_data_revisions SET revision=%s,source_digest=%s,updated_at=NOW() WHERE domain='market'", (next_revision, next_digest))
    result = dict(status="applied", updated=len(targets), uniqueSkus=len({x["sku"] for x in targets}),
                  revision=next_revision, sourceDigest=next_digest, fileSha256=file_hash, planSha256=plan_hash)
    conn.execute("""INSERT INTO market_master_audit_logs
        (id,actor_email,actor_role,action,entity_type,entity_id,before_json,after_json,created_at)
        VALUES (%s,%s,'admin',%s,'market_image_backfill',%s,%s,%s,NOW())""",
        (uuid.uuid4(), actor["email"], action, entity,
         Jsonb(dict(revision=plan["revision"], targets=targets)), Jsonb(result)))
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("prepare", "apply"))
    parser.add_argument("--file", type=Path, required=True)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--plan-sha256")
    args = parser.parse_args()
    file_hash, mapping = workbook(args.file)
    with connect(args.mode) as conn:
        if args.mode == "prepare":
            plan = prepare(conn, file_hash, mapping)
            with args.plan.open("x", encoding="utf-8") as output:
                output.write(canonical(plan))
            print(canonical({k: v for k, v in plan.items() if k not in {"targets", "unreadyUrls"}} |
                            dict(targetCount=len(plan["targets"]), unreadyUrlCount=len(plan["unreadyUrls"]), planSha256=digest(plan))))
        else:
            plan = json.loads(args.plan.read_text(encoding="utf-8"))
            assert args.plan_sha256 == digest(plan), "Plan digest mismatch"
            result = apply(conn, plan, file_hash, mapping, args.plan_sha256)
            conn.commit()
            print(canonical(result))


if __name__ == "__main__":
    main()
