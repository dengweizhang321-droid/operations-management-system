import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const round = process.argv[2];
assert.ok(['1','2'].includes(round));
const root = new URL('./', import.meta.url);
const prefix = `AGY_ROUND${round}`;
const raw = (await readFile(new URL(`${prefix}_STREAM.ndjson`, root), 'utf8')).replace(/^\uFEFF/, '');
const complete = /\n$/.test(raw) ? raw : raw.slice(0, raw.lastIndexOf('\n') + 1);
const events = complete.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const envelope = events.findLast(e => e.event === 'result');
if (!envelope) { console.log('No final result yet'); process.exitCode = 2; }
else {
  const result = envelope.result ?? envelope;
  assert.equal(result.status, 'SUCCESS');
  assert.ok(typeof result.response === 'string' && result.response.trim());
  const trace = events.filter(e => e.event === 'step_update' && e.step_update.state === 'DONE' && e.step_update.step_type === 'tool').map(e => e.step_update);
  const toolErrors = events.filter(e => e.event === 'step_update' && e.step_update.state === 'ERROR' && e.step_update.step_type === 'tool').map(e => e.step_update);
  const metadata = { conversationId: result.conversation_id, status: result.status, responseCharacters: result.response.length, completedToolCalls: trace.length, toolNames: [...new Set(trace.map(s => s.tool_name))], deniedActionsFieldPresent: 'denied_actions' in result, deniedActions: result.denied_actions ?? null, toolErrors, trace };
  await writeFile(new URL(`${prefix}_RESULT.json`, root), JSON.stringify(result, null, 2) + '\n');
  await writeFile(new URL(`${prefix}_TRACE.json`, root), JSON.stringify(metadata, null, 2) + '\n');
  await writeFile(new URL(`${prefix}.md`, root), result.response + '\n');
  console.log(JSON.stringify({ ...metadata, trace: undefined }));
}
