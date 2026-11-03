"""Read bounded n8n execution payloads; persist only classifications, never raw errors."""
import collections
import datetime as dt
import json
from pathlib import Path
import re
import sqlite3

DB = Path('C:/Users/86137/.n8n/database.sqlite')
OUT = Path(__file__).with_name('E6-evidence.json')
MAX_BYTES = 1024 * 1024

def unpack(raw):
    table = json.loads(raw)
    if not isinstance(table, list):
        return table
    cache = {}
    def ref(v):
        if isinstance(v, str) and v.isdecimal() and int(v) < len(table):
            i = int(v)
            if i in cache:
                return cache[i]
            item = table[i]
            if isinstance(item, dict):
                result = {}; cache[i] = result
                result.update({k: ref(x) for k, x in item.items()})
                return result
            if isinstance(item, list):
                result = []; cache[i] = result
                result.extend(ref(x) for x in item)
                return result
            cache[i] = item
            return item
        if isinstance(v, dict):
            return {k: ref(x) for k, x in v.items()}
        if isinstance(v, list):
            return [ref(x) for x in v]
        return v
    return ref('0')

def texts(value, depth=0, seen=None):
    if depth > 12:
        return []
    if seen is None: seen = set()
    if isinstance(value, str): return [value]
    if isinstance(value, (dict, list)):
        if id(value) in seen: return []
        seen.add(id(value))
        values = value.values() if isinstance(value, dict) else value
        return [s for x in values for s in texts(x, depth+1, seen)]
    if isinstance(value, (int, float)): return [str(value)]
    return []

def shanghai(value):
    if not value: return None
    return dt.datetime.fromisoformat(value.replace('Z', '+00:00')).replace(tzinfo=dt.timezone.utc).astimezone(dt.timezone(dt.timedelta(hours=8))).isoformat()

connection = sqlite3.connect(DB.as_uri() + '?mode=ro', uri=True, timeout=.5)
connection.execute('PRAGMA query_only=ON')
connection.execute('BEGIN')
try:
    rows = connection.execute('SELECT e.id,e.workflowId,e.status,e.startedAt,e.stoppedAt,length(d.data) FROM execution_entity e LEFT JOIN execution_data d ON d.executionId=e.id ORDER BY e.id').fetchall()
    names = dict(connection.execute('SELECT id,name FROM workflow_entity'))
    result = {'checkedAtUtc': dt.datetime.now(dt.timezone.utc).isoformat(), 'databaseMode': 'mode=ro; query_only=ON; BEGIN; finally rollback', 'retainedExecutions': len(rows), 'retainedStartedAtUtcMin': min(r[3] for r in rows if r[3]), 'retainedStartedAtUtcMax': max(r[3] for r in rows if r[3]), 'payloadByteLimit': MAX_BYTES, 'missingPayloadIds': [], 'skippedOversizeIds': [], 'parseFailureIds': [], 'matchedExecutions': [], 'classification': 'Once per execution per category; only actual error objects, helper URL/name evidence required for generic HTTP409/ECONNREFUSED.'}
    for execution_id, workflow_id, status, started, stopped, length in rows:
        if length is None:
            result['missingPayloadIds'].append(str(execution_id)); continue
        if length > MAX_BYTES:
            result['skippedOversizeIds'].append(str(execution_id)); continue
        # One bounded payload at a time; no raw payload leaves this process.
        payload, workflow_raw = connection.execute('SELECT data,workflowData FROM execution_data WHERE executionId=?', (execution_id,)).fetchone()
        try:
            data = unpack(payload); snapshot = json.loads(workflow_raw)
        except (ValueError, TypeError, RecursionError):
            result['parseFailureIds'].append(str(execution_id)); continue
        rd = data.get('resultData', {})
        errors = []
        if isinstance(rd.get('error'), dict): errors.append((rd.get('lastNodeExecuted', ''), rd['error']))
        for name, tasks in rd.get('runData', {}).items():
            for task in tasks:
                if isinstance(task.get('error'), dict): errors.append((name, task['error']))
        categories = set(); error_nodes = set(); safe_codes = set()
        for name, error in errors:
            error_text = '\n'.join(texts(error))
            node = error.get('node') or next((n for n in snapshot.get('nodes', []) if n.get('name') == name), {})
            node_text = '\n'.join(texts(node))
            helper = bool(re.search(r'127\.0\.0\.1:5791|localhost:5791|helper', node_text + '\n' + name, re.I))
            cleanup = 'helper_slot_cleanup_requires_manual_action' in error_text
            code409 = bool(re.search(r'(?<!\d)409(?!\d)', str(error.get('httpCode', ''))))
            refused = 'ECONNREFUSED' in error_text
            if cleanup: categories.add('cleanup_requires_manual_action')
            if helper and code409: categories.add('helper_http_409')
            if helper and refused: categories.add('helper_econnrefused')
            if cleanup or helper and (code409 or refused):
                error_nodes.add(name)
                if cleanup: safe_codes.add('helper_slot_cleanup_requires_manual_action')
                if code409: safe_codes.add('409')
                if refused: safe_codes.add('ECONNREFUSED')
        if categories:
            result['matchedExecutions'].append({'executionId': str(execution_id), 'workflowId': workflow_id, 'workflowName': names.get(workflow_id), 'status': status, 'startedAtUtc': started, 'startedAtShanghai': shanghai(started), 'categories': sorted(categories), 'errorNodes': sorted(error_nodes), 'safeCodes': sorted(safe_codes)})
    result['counts'] = dict(collections.Counter(k for r in result['matchedExecutions'] for k in r['categories']))
    result['byShanghaiDate'] = {category: dict(collections.Counter(r['startedAtShanghai'][:10] for r in result['matchedExecutions'] if category in r['categories'])) for category in result['counts']}
    result['byWorkflow'] = {category: dict(collections.Counter(r['workflowId'] for r in result['matchedExecutions'] if category in r['categories'])) for category in result['counts']}
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({k:v for k,v in result.items() if k not in ['matchedExecutions']}, ensure_ascii=True))
finally:
    connection.rollback()
    connection.close()
