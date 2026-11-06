import assert from "node:assert/strict";
import type { AiToolEntry } from "../../lib/ai/tool-registry-contract";

/** Keep historical fixture bytes while checking the reviewed integration changes.
 * Production catalogs and policy digests must always use the unprojected registry.
 */
/** fbf4a6d4（PiAgent 第三阶段）新增的两个 surface。它们各有独立测试：
 * tests/pi-business-tools.test.ts 断言 pi_business 工具的 allowedSurfaces，
 * tests/pi-agent-tools.test.ts 与 tests/system-datasets.test.ts 覆盖 pi_agent。
 * 历史夹具保留原始字节；生产策略摘要始终包含这些新声明。
 */
const PI_SURFACES: readonly string[] = ["pi_agent", "pi_business"];

export function preIntegrationCatalog(entries: readonly AiToolEntry[]): AiToolEntry[] {
  // Each explicit new netshop entry has its own actual-registry role, surface,
  // budget and audit tests. Historical fixtures retain the original entries;
  // production policy hashes always include these new declarations.
  return entries.filter(entry => !["get_bi_cockpit", "get_jd_promotion_diagnostic", "get_netshop_insights_context", "get_netshop_product_insights", "get_netshop_promotion_insights", "get_netshop_promotion_object_detail"].includes(entry.name))
    // 只属于新 Pi surface 的条目在历史投影里不存在；凡 Pi surface 是对既有条目的
    // 追加，就把追加项摘掉以还原历史 allowedSurfaces 字节。两者都不改生产注册表。
    .filter(entry => !entry.execution.allowedSurfaces.every(surface => PI_SURFACES.includes(surface)))
    .map(entry => {
      if (!entry.execution.allowedSurfaces.some(surface => PI_SURFACES.includes(surface))) return entry;
      const retained = entry.execution.allowedSurfaces.filter(surface => !PI_SURFACES.includes(surface));
      assert.ok(retained.length > 0, `Only an additive Pi surface may be projected: ${entry.name}`);
      return { ...entry, execution: { ...entry.execution, allowedSurfaces: retained } };
    })
    .map(entry => {
      if (entry.name === "get_automation_run_status") {
        assert.equal(entry.description, "通过 Django 只读读取运行机器本地今天对应 n8n 工作流的定时、自动重试和已核验完整手动补跑成功状态、完成时间及执行编号。仅无数据范围限制账号可查；共用多店工作流表示整链状态，排除单节点测试、固定测试数据和局部执行；仅返回执行状态摘要，不返回节点内容、Cookie 或凭据。来源不可用时拒绝推测完成。",
          "Only the reviewed complete-manual-run status description may be projected");
        // f1a74330（B3 自动化运行只读接口）把 workflowKey 从 6 个扩到 9 个。新增三个
        // key 各有独立测试：tests/ai-page-data-tools.test.ts 覆盖处理器行为，
        // tests/import-monitor.test.ts 与 tests/ai-page-context.test.ts 覆盖键本身。
        // 历史夹具保留扩容前的 6 个；生产策略摘要始终用未投影的注册表。
        const workflowKey = entry.inputSchema.properties.workflowKey as { enum: readonly string[]; type: string };
        assert.deepEqual([...workflowKey.enum], ["jackyun", "tmall", "jd", "jd_market", "jd_promotion", "jd_promotion_cut_meat", "jd_customer_service", "jd_logistics", "tmall_warehouse"],
          "Only the reviewed 6 -> 9 automation workflowKey widening may be projected");
        return { ...entry, description: "通过 Django 只读读取上海今天对应 n8n 工作流的自动执行状态、完成时间和执行编号。仅无数据范围限制账号可查；共用多店工作流表示整链状态，不包含手动调试，不读取节点数据、Cookie 或凭据。来源不可用时拒绝推测完成。",
          inputSchema: { ...entry.inputSchema, properties: { ...entry.inputSchema.properties,
            workflowKey: { ...workflowKey, enum: ["jackyun", "tmall", "jd", "jd_market", "jd_promotion", "jd_promotion_cut_meat"] } } } };
      }
      if (entry.name !== "describe_system_datasets") return entry;
      assert.equal(entry.execution.maxCallsPerRequest, 24,
        "Only the reviewed 4 -> 24 dataset discovery limit may be projected");
      return { ...entry, execution: { ...entry.execution, maxCallsPerRequest: 4 } };
    });
}
