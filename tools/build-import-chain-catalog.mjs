import { readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = async (path) => JSON.parse((await readFile(new URL(path, root), "utf8")).replace(/^\uFEFF/, ""));

// Only this allowlisted display projection enters the browser. Never bundle
// browser profiles, download paths, credentials, or executable node parameters.
export async function buildImportChainCatalog() {
  const jd = (await read("config/jd-store-accounts.json")).stores.filter((s) => s.enabled);
  const tmall = (await read("config/tmall-store-accounts.json")).stores.filter((s) => s.enabled);
  const market = await read("config/jd-market-ranking-daily.json");
  const entities = [{ key: "jackyun", name: "吉客云 ERP", platform: "ERP" },
    ...jd.map((s) => ({ key: s.storeKey, name: s.shopName, platform: "京东" })),
    ...tmall.map((s) => ({ key: s.storeKey, name: s.shopName.replace(/^天猫-/, ""), platform: "天猫" }))];
  const chains = [
    { key: "jackyun", label: "吉客云 ERP · 五表", platform: "ERP", modules: ["货品主数据", "分仓库存", "库龄", "销售明细", "组合装"], steps: ["建立计划", "五表导出", "完整文件校验", "按依赖顺序导入", "独立批次回查"] },
    { key: "jd", label: "京东 · 商品数据", platform: "京东", modules: ["商品 SKU 主数据", "SKU 分天", "SPU 分天"], steps: ["固定日期与店铺", "逐店串行下载并导入", "批次与日期覆盖回查"] },
    { key: "jd_market", label: "京东商智 · 市场榜单", platform: "京东", modules: market.categories.map((c) => c.systemCategory), steps: ["计算榜单缺失日", "分块下载、校验并导入", "原目标日期覆盖回查"] },
    { key: "jd_promotion", label: "京准通 · AI 推广", platform: "京东", modules: ["推广商品日数据"], steps: ["固定店铺与日期", "生成并下载报表", "校验、导入与回查"] },
    { key: "jd_customer_service", label: "京东 · 客服聊天记录", platform: "京东", modules: ["客服会话 Excel", "聊天记录 LOG", "分天配对导入"], steps: ["固定店铺与截至昨天30天", "双文件下载、校验与分天导入", "原文件、精确批次与实际归属回查"] },
    { key: "tmall", label: "天猫 · 商品、推广与主数据", platform: "天猫", modules: ["生意参谋商品日数据", "推广商品日数据", "店铺货品主数据"], steps: ["核查近7天缺口", "逐日下载缺失商品数据", "签收、导入并回查", "推广下载、导入并回查", "复查并继续下一缺失日", "每日货品更新与收尾"] },
  ];
  const rules = [];
  const add = async (chainKey, entityKeys, file, extra = {}) => {
    const definition = await read(`automation/n8n/${file}.workflow.json`);
    const schedules = definition.nodes.filter((n) => n.type === "n8n-nodes-base.scheduleTrigger")
      .flatMap((n) => n.parameters.rule.interval)
      .map((s) => s.expression || `每 ${s.daysInterval || 1} 天 ${s.triggerAtHour || 0}:${String(s.triggerAtMinute || 0).padStart(2, "0")}`);
    rules.push({ chainKey, entityKeys, workflowId: definition.id, name: definition.name,
      timezone: definition.settings?.timezone || "未配置", schedules, definitionFile: `automation/n8n/${file}.workflow.json`, ...extra });
  };
  await add("jackyun", ["jackyun"], "jackyun-five-dataset-api");
  await add("jd", jd.map((s) => s.storeKey), "jd-multi-store-daily.chromium-silent-copy");
  await add("jd_market", [market.storeKey], "jd-market-ranking-daily.chromium-silent-copy");
  await add("jd_promotion", ["jd-yiyong-director"], "jd-promotion-daily");
  await add("jd_promotion", ["jd-maidehao-operator1"], "jd-promotion-cut-meat-20260813-14");
  for (const [storeKey, file] of [
    ["jd-yiyong-director", "jd-customer-service-daily"],
    ["jd-maidehao-operator1", "jd-customer-service-cut-meat-daily.candidate"],
    ["jd-chudian-weizhang", "jd-customer-service-chudian-daily.candidate"],
    ["jd-cuizhiwang-dengweizhang", "jd-customer-service-dishwasher-daily.candidate"],
  ]) {
    if (!jd.some(store => store.storeKey === storeKey)) throw new Error(`Missing customer-service store: ${storeKey}`);
    await add("jd_customer_service", [storeKey], file);
  }
  for (const s of tmall) {
    const file = `${s.storeKey}-seven-day-gap-loop`;
    await add("tmall", [s.storeKey], file, { masterIntervalDays: 1 });
  }
  return { source: "repository_definitions", entities, chains, rules };
}

// Server-only completion contract: never send executable node parameters to clients.
export async function buildManualCompletionContracts(catalog) {
  const stageOrder = { jackyun: "ABCDE", jd: "ABC", jd_market: "ABC", jd_promotion: "ABC", jd_customer_service: "ABC", tmall: "ABCPM" };
  return Object.fromEntries(await Promise.all(catalog.rules.map(async (rule) => {
    const definition = await read(rule.definitionFile);
    const previous = rule.chainKey === "tmall" ? await read(`automation/n8n/${rule.entityKeys[0]}${
      ["tmall-yijiu", "tmall-yiyong"].includes(rule.entityKeys[0]) ? "-direct-pm-candidate" : "-sycm-cookie-daily"
    }.workflow.json`) : null;
    const unique = (predicate) => {
      const matches = definition.nodes.filter(predicate);
      if (matches.length !== 1 || matches[0].disabled || matches[0].continueOnFail) throw new Error(`Invalid completion contract: ${rule.workflowId}`);
      const node = { name: matches[0].name, type: matches[0].type };
      const old = previous?.nodes.filter(predicate) ?? [];
      if (previous && old.length !== 1) throw new Error(`Invalid historical completion contract: ${rule.workflowId}`);
      if (old[0] && old[0].name !== node.name) node.aliases = [old[0].name];
      return node;
    };
    const loop = rule.chainKey === "tmall" && definition.nodes.some(n => n.name.startsWith("N·"));
    const order = loop ? "ABCPNM" : stageOrder[rule.chainKey];
    const nodes = [unique(n => n.type === "n8n-nodes-base.manualTrigger"),
      ...[...order].map(stage => {
        const node = unique(n => n.name.startsWith(`${stage}·`) && n.type === "n8n-nodes-base.httpRequest");
        if (loop && "BCPN".includes(stage)) {
          node.repeatGroup = "tmallDaily";
          node.maximumAttempts = 8; // One empty preflight plus at most seven dates.
        }
        if (loop && stage === "N") node.optional = true; // Original single-day executions remain valid.
        if (rule.chainKey === "tmall" && stage === "M") node.maximumAttempts = 1;
        return node;
      })];
    if (loop) nodes.push({ ...unique(n => n.name === "全部缺失日已补齐？" && n.type === "n8n-nodes-base.if"), optional: true });
    return [rule.workflowId, nodes];
  })));
}

if (process.argv[1] && import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1]).href) {
  const catalog = await buildImportChainCatalog();
  await writeFile(new URL("lib/imports/chain-catalog.generated.json", root), `${JSON.stringify(catalog, null, 2)}\n`);
  await writeFile(new URL("backend/workflow/import_chain_catalog.json", root), `${JSON.stringify({ workflowIds: catalog.rules.map(r => r.workflowId), manualCompletion: await buildManualCompletionContracts(catalog) }, null, 2)}\n`);
}
