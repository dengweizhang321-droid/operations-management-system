import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { createReadJsonClient } from "../../lib/http/read-client";

const samples: unknown[] = [];
let calls = 0, listeners = 0;
const client = createReadJsonClient({ origin: "http://synthetic.test", paths: ["/api/sales/summary"], maxEntries: 2, lifetimeMs: 100,
  fetcher: async () => { calls++; await new Promise(resolve => setTimeout(resolve, 1)); return Response.json({ items: [1] }); },
});
const options = { identityKey: "synthetic", permissionKey: "synthetic-scope", version: "1" };
try {
  for (let n = 0; n < 1000; n++) {
    const controller = new AbortController();
    const add = controller.signal.addEventListener.bind(controller.signal), remove = controller.signal.removeEventListener.bind(controller.signal);
    controller.signal.addEventListener = (...args: Parameters<typeof add>) => { if (args[0] === "abort") listeners++; return add(...args); };
    controller.signal.removeEventListener = (...args: Parameters<typeof remove>) => { if (args[0] === "abort") listeners--; return remove(...args); };
    const first = client.read("/api/sales/summary", { ...options, signal: controller.signal });
    const second = client.read("/api/sales/summary", options);
    if (n % 2 === 0) controller.abort();
    const outcomes = await Promise.allSettled([first, second]);
    assert.equal(outcomes[1].status, "fulfilled"); assert.equal(outcomes[0].status, n % 2 ? "fulfilled" : "rejected");
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(client.stats(), { entries: 0, subscribers: 0, transports: 0, resultCacheEntries: 0 }); assert.equal(listeners, 0);
    if (n % 100 === 99) samples.push({ cycles: n + 1, ...client.stats(), listenerBalance: listeners, heapUsedBytes: process.memoryUsage().heapUsed, rssBytes: process.memoryUsage().rss });
  }
  await writeFile("docs/performance/foundation/soak.json", JSON.stringify({ synthetic: true, cycles: 1000, subscribers: 2000, transports: calls, samples,
    limitations: "Synthetic 1ms transport, not a browser long-session memory measurement. Heap/RSS include GC and module runtime; zero entries/listeners prove bookkeeping cleanup, not production memory slope.",
  }, null, 2) + "\n");
  console.log("PASS 1000 cycles / 2000 subscribers");
} finally { client.dispose(); }
