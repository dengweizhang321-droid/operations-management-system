import assert from 'node:assert/strict';
import test from 'node:test';
import { BoundedFetchError, fetchBoundedJson } from '../lib/ai/bounded-fetch';

for (const reason of ['redirect', 'declared-size'] as const) {
  test(`bounded JSON releases unread ${reason} response and aborts transport`, async () => {
    let cancelled = 0;
    let signal: AbortSignal | null | undefined;
    await assert.rejects(fetchBoundedJson({
      url: 'http://fixture.invalid', init: {}, maxBytes: 8, timeoutMs: 1000,
      fetcher: async (_url, init) => {
        signal = init?.signal;
        return new Response(new ReadableStream({
          start(c) { c.enqueue(new Uint8Array(16)); },
          cancel() { cancelled++; },
        }), reason === 'redirect' ? { status: 302 } : { headers: { 'content-length': '16' } });
      },
    }), (error: unknown) => error instanceof BoundedFetchError
      && error.code === (reason === 'redirect' ? 'redirect' : 'response_too_large'));
    assert.equal(cancelled, 1);
    assert.equal(signal?.aborted, true);
  });
}

test('cleanup rejection never replaces the public limit error', async () => {
  await assert.rejects(fetchBoundedJson({
    url: 'http://fixture.invalid', init: {}, maxBytes: 8, timeoutMs: 1000,
    fetcher: async () => new Response(new ReadableStream({ cancel() { throw new Error('cleanup failed'); } }), { status: 302 }),
  }), (error: unknown) => error instanceof BoundedFetchError && error.code === 'redirect');
});

test('successful JSON and malformed JSON preserve status, bytes and result contracts', async () => {
  for (const raw of ['{"ok":true}', 'bad json', '']) {
    const result = await fetchBoundedJson({ url:'http://fixture.invalid', init:{}, timeoutMs:1000,
      fetcher:async()=>new Response(raw, {status:201}) });
    assert.equal(result.response.status,201);
    assert.equal(result.responseBytes,new TextEncoder().encode(raw).length);
    assert.deepEqual(result.data,raw.startsWith('{')?{ok:true}:null);
  }
});

test('a never-settling cancellation cannot hold an already rejected request open', async () => {
  const result = fetchBoundedJson({url:'http://fixture.invalid',init:{},timeoutMs:1000,
    fetcher:async()=>new Response(new ReadableStream({cancel:()=>new Promise(()=>{})}),{status:302})});
  await assert.rejects(Promise.race([result, new Promise((_,reject)=>setTimeout(()=>reject(new Error('cleanup blocked')),100))]),
    (error:unknown)=>error instanceof BoundedFetchError && error.code==='redirect');
});

test('one rejected request does not abort another concurrent response or external signal', async () => {
  const external=new AbortController();
  const signals: AbortSignal[]=[];
  const fetcher:typeof fetch=async (url,init)=>{
    signals.push(init!.signal!);
    return String(url).endsWith('reject') ? new Response('ignored',{status:302}) : new Response('{"ok":true}');
  };
  const results=await Promise.allSettled(['reject','ok'].map(path=>fetchBoundedJson({url:`http://fixture.invalid/${path}`,init:{},timeoutMs:1000,signal:external.signal,fetcher})));
  assert.deepEqual(results.map(r=>r.status),['rejected','fulfilled']);
  assert.equal(signals[0].aborted,true);
  assert.equal(signals[1].aborted,false);
  assert.equal(external.signal.aborted,false);
});
