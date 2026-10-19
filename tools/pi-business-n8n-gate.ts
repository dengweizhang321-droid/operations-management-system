import { readPiBusinessN8nGate } from "../lib/jackyun/n8n-preflight-evidence";

/** Fixed loopback capability check. No generic network bridge or host command. */
export async function admitPiBusinessN8nNode(executionId: string) {
  const binding = readPiBusinessN8nGate(executionId);
  if (!binding) return;
  const response = await fetch("http://127.0.0.1:8112/api/ai/pi/n8n-admission", {
    method: "POST", redirect: "error", cache: "no-store", headers: { "content-type": "application/json" },
    body: JSON.stringify(binding), signal: AbortSignal.timeout(7000),
  });
  const raw = await response.text();
  if (!response.ok || Buffer.byteLength(raw) > 4096) throw Error("pi_n8n_current_authorization_refused");
  const result = JSON.parse(raw) as { ok?: boolean; actionId?: string; executionId?: string };
  if (result.ok !== true || result.actionId !== binding.actionId || result.executionId !== executionId) throw Error("pi_n8n_current_authorization_unverified");
}
