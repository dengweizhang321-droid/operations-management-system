import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const root = new URL('./', import.meta.url);
const raw = (await readFile(new URL('AGY_STREAM.ndjson', root), 'utf8')).replace(/^\uFEFF/, '');
const complete = /\n$/.test(raw) ? raw : raw.slice(0, raw.lastIndexOf('\n') + 1);
const events = complete.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
const envelope = events.findLast(e => e.event === 'result');
if (!envelope) { console.log('No final result yet'); process.exit(2); }
const result = envelope.result ?? envelope;
assert.equal(result.status, 'SUCCESS');
assert.ok(typeof result.response === 'string' && result.response.trim());
await writeFile(new URL('AGY_RESULT.json', root), JSON.stringify(result, null, 2) + '\n');
await writeFile(new URL('ANTIGRAVITY_RESULT.md', root), result.response + '\n');
const done = events.filter(e => e.event === 'step_update' && e.step_update.state === 'DONE' && e.step_update.step_type === 'tool').map(e => e.step_update);
const metadata = { conversationId: result.conversation_id, status: result.status, responseNonempty: true, responseCharacters: result.response.length, completedToolCalls: done.length, toolNames: [...new Set(done.map(s => s.tool_name))], uniqueReadPaths: [...new Set(done.map(s => s.tool_info?.parameters?.AbsolutePath).filter(Boolean))], deniedActionsFieldPresent: 'denied_actions' in result, deniedActions: result.denied_actions ?? null, resultKeys: Object.keys(result), completedToolTrace: done };
await writeFile(new URL('AGY_TOOL_TRACE.json', root), JSON.stringify(metadata, null, 2) + '\n');
console.log(JSON.stringify({ conversationId: metadata.conversationId, status: metadata.status, characters: metadata.responseCharacters, completedToolCalls: done.length, toolNames: metadata.toolNames, deniedActions: metadata.deniedActions, resultKeys: metadata.resultKeys }, null, 2));
