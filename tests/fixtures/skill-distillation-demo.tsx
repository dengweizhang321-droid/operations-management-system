import { createRoot } from "react-dom/client";
import AiPiSkillDistillation from "../../app/ai-pi-skill-distillation";

// Offline synthetic adapter. No fallback to the real network is permitted.
const operationId = "demo-completed-operation";
const version = "a".repeat(64);
const scenario = new URL(location.href).searchParams.get("scenario") ?? "success";
const store = `skill-distill-demo:${scenario}`;
type DemoState = { receipt: { clientRequestId: string; status: string; errorCode: string | null } | null; candidate: Record<string, unknown> | null; reportChanged?: boolean };
let state: DemoState;
try { state = JSON.parse(localStorage.getItem(store) || "null") ?? { receipt: null, candidate: null }; } catch { state = { receipt: null, candidate: null }; }
function save() { localStorage.setItem(store, JSON.stringify(state)); }
function candidate() {
  return { id: "demo-candidate", operationId, version: 1, status: "draft", contentDigest: "b".repeat(64), reportVersionDigest: state.reportChanged ? "d".repeat(64) : version, unverifiedRecommendations: 1,
    content: { goal: "按明确口径复盘单店经营表现", body: "先核对业务日期与来源覆盖，再读取单店指标，逐项标明缺数及口径差异，保留未经验证的建议。",
      parameters: [{ name: "店铺", kind: "shop", required: true, meaning: "调用时明确唯一店铺", defaultRule: "没有精确店名时停止并补充" }],
      steps: [{ order: 1, action: "核对数据新鲜度后读取店铺经营指标", toolName: "get_data_freshness", missingDataBranch: "缺少必要日期时披露缺口并暂停结论" }],
      requiredTools: ["get_data_freshness"], templateRefs: [], sourceEvidenceRefs: ["demo-export"], unverifiedRecommendations: ["提高预算的建议未执行，效果未验证"], openQuestions: ["异常阈值需要业务确认"] } };
}
if (scenario === "malformed" && !state.candidate) { state.candidate = { ...candidate(), content: { ...candidate().content, parameters: null } }; save(); }
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input), "https://offline-demo.invalid");
  if (url.origin !== "https://offline-demo.invalid" || !url.pathname.startsWith("/api/ai/pi/")) throw Error("离线演示禁止外部网络");
  if (init.method === "POST") {
    const body = JSON.parse(String(init.body));
    if (url.pathname.endsWith("/distill")) {
      if (body.withdrawAuthorization) {
        if (state.receipt && state.receipt.status !== "completed") return Response.json({ error: "演示：原请求已派发，不能撤回" }, { status: 409 });
        if (!state.receipt) { state.receipt = { clientRequestId: body.clientRequestId, status: "completed", errorCode: "distillation_authorization_withdrawn" }; save(); }
        return Response.json({ withdrawn: state.receipt.errorCode === "distillation_authorization_withdrawn" });
      }
      if (scenario === "reportchange" && !state.reportChanged) { state.reportChanged = true; save(); return Response.json({ error: "演示：报告在派发前变化，未生成派发回执" }, { status: 409 }); }
      if (state.receipt?.status === "unknown") return Response.json({ error: "演示：原派发结果未知，请核实" }, { status: 409 });
      if (state.receipt?.clientRequestId === body.clientRequestId && state.candidate) return Response.json({ item: state.candidate }, { status: 201 });
      if (scenario === "unknown") { state.receipt = { clientRequestId: body.clientRequestId, status: "unknown", errorCode: "provider_timeout" }; save(); throw Error("演示：响应连接中断"); }
      if (scenario === "failure" && !state.receipt) { state.receipt = { clientRequestId: body.clientRequestId, status: "completed", errorCode: "service_unavailable" }; save(); return Response.json({ error: "演示：本地凭据未就绪" }, { status: 503 }); }
      state.receipt = { clientRequestId: body.clientRequestId, status: "completed", errorCode: null }; state.candidate = candidate(); save();
      if (scenario === "lost") throw Error("演示：已生成草稿，但响应丢失");
      return Response.json({ item: state.candidate }, { status: 201 });
    }
    if (url.pathname.endsWith("/review") && state.candidate) {
      if (body.expectedVersion !== state.candidate.version || body.contentDigest !== state.candidate.contentDigest) return Response.json({ error: "演示：候选版本冲突，请刷新" }, { status: 409 });
      state.candidate = { ...state.candidate, status: body.status, version: Number(state.candidate.version) + 1, reviewNote: body.note }; save();
      return Response.json({ item: state.candidate });
    }
    throw Error("未登记的离线写动作");
  }
  return Response.json({ reportVersionDigest: state.reportChanged ? "d".repeat(64) : version, reportVersion: { operationId, modelId: "demo-model", modelVersion: 3 }, confirmedFeedbackIds: ["demo-feedback"], citableExportIds: ["demo-export"], citableFileIds: ["demo-file"], coverage: { sourcesComplete: false, truncated: { sources: false, artifacts: false, confirmedFeedbackIds: false } }, distillation: { latest: state.receipt, requested: state.receipt?.clientRequestId === url.searchParams.get("distillationRequestId") ? state.receipt : null, candidate: state.candidate, blocked: state.receipt?.status === "unknown" } });
};
document.querySelector<HTMLSelectElement>("#scenario")!.value = scenario;
document.querySelector("#scenario")!.addEventListener("change", event => { const url = new URL(location.href); url.searchParams.set("scenario", (event.target as HTMLSelectElement).value); location.href = url.href; });
document.querySelector("#reset")!.addEventListener("click", () => { localStorage.removeItem(store); localStorage.removeItem(`demo:${scenario}:distill:${operationId}`); location.reload(); });
createRoot(document.getElementById("demo")!).render(<AiPiSkillDistillation operations={[{ id: operationId, status: "succeeded", modelId: "demo-model", modelVersion: 3 }]} ownerKey={`demo:${scenario}`} writable={true} models={[{ id: "demo-model", name: "原任务演示模型", modelName: "synthetic-model" }]} />);
