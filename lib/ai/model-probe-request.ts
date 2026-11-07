import { sha256Hex } from "./channel-callbacks";

export async function probeAttempt(actor: string, intent: string) {
  const storage = window.sessionStorage;
  const identity = await sha256Hex(`${actor.toLowerCase()}\n${intent}`);
  const key = `teruisi.ai.model-probe.v1:${identity}`;
  const prior = storage.getItem(key);
  const clientRequestId = prior ?? crypto.randomUUID();
  if (!prior) storage.setItem(key, clientRequestId);
  return { clientRequestId, finish: () => storage.removeItem(key) };
}
