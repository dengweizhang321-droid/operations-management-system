import assert from "node:assert/strict";
import type { AiToolEntry } from "../../lib/ai/tool-registry-contract";

/** Keep historical fixture bytes while checking the reviewed integration changes.
 * Production catalogs and policy digests must always use the unprojected registry.
 */
export function preIntegrationCatalog(entries: AiToolEntry[]): AiToolEntry[] {
  // Each explicit new netshop entry has its own actual-registry role, surface,
  // budget and audit tests. Historical fixtures retain the original entries;
  // production policy hashes always include these new declarations.
  return entries.filter(entry => !["get_jd_promotion_diagnostic", "get_netshop_insights_context", "get_netshop_product_insights"].includes(entry.name))
    .map(entry => {
      if (entry.name === "get_automation_run_status") {
        assert.equal(entry.description, "通过 Django 只读读取上海今天对应 n8n 工作流的定时、自动重试和已核验完整手动补跑成功状态、完成时间及执行编号。仅无数据范围限制账号可查；共用多店工作流表示整链状态，排除单节点测试、固定测试数据和局部执行；仅返回执行状态摘要，不返回节点内容、Cookie 或凭据。来源不可用时拒绝推测完成。",
          "Only the reviewed complete-manual-run status description may be projected");
        return { ...entry, description: "通过 Django 只读读取上海今天对应 n8n 工作流的自动执行状态、完成时间和执行编号。仅无数据范围限制账号可查；共用多店工作流表示整链状态，不包含手动调试，不读取节点数据、Cookie 或凭据。来源不可用时拒绝推测完成。" };
      }
      if (entry.name !== "describe_system_datasets") return entry;
      assert.equal(entry.execution.maxCallsPerRequest, 24,
        "Only the reviewed 4 -> 24 dataset discovery limit may be projected");
      return { ...entry, execution: { ...entry.execution, maxCallsPerRequest: 4 } };
    });
}
