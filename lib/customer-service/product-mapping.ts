export type CustomerServiceMasterProductRow = {
  sku_id: string;
  spu_id: string;
  product_code: string;
  raw_json: string;
};

export type CustomerServiceSalesProductRow = {
  online_spec_code: string;
  product_code: string;
  category: string;
};

export type CustomerServiceProductMapping = {
  matchedSkuId: string;
  spuId: string;
  onlineSpecCode: string;
  erpProductCode: string;
  category: string;
  matchDirection: "forward" | "reverse";
};

function safeObject(input: string) {
  try {
    const parsed = JSON.parse(input) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function mapMasterRow(row: CustomerServiceMasterProductRow) {
  const raw = safeObject(row.raw_json);
  return {
    matchedSkuId: row.sku_id.trim(),
    spuId: String(raw.SPUID ?? raw.spuId ?? row.spu_id ?? row.product_code ?? "").trim(),
    onlineSpecCode: String(raw["商家SKU"] ?? "").trim(),
    erpProductCode: "",
    category: "",
  };
}

export function customerServiceOnlineSpecCodes(rows: CustomerServiceMasterProductRow[]) {
  return [...new Set(rows.map((row) => mapMasterRow(row).onlineSpecCode).filter(Boolean))];
}

export function buildCustomerServiceProductMappings(
  requestedProductCodes: string[],
  masterRows: CustomerServiceMasterProductRow[],
  salesRows: CustomerServiceSalesProductRow[],
) {
  const requested = new Set(requestedProductCodes.filter(Boolean));
  const masterEntries = masterRows.map(mapMasterRow).filter((item) => item.matchedSkuId);
  const mappings = new Map<string, CustomerServiceProductMapping>();

  // Exact SKUID matches always win over the reverse fallback.
  for (const entry of masterEntries) {
    if (requested.has(entry.matchedSkuId) && !mappings.has(entry.matchedSkuId)) {
      mappings.set(entry.matchedSkuId, { ...entry, matchDirection: "forward" });
    }
  }

  const reverseCandidates = new Map<string, typeof masterEntries>();
  for (const entry of masterEntries) {
    if (!entry.onlineSpecCode || !requested.has(entry.onlineSpecCode)) continue;
    const candidates = reverseCandidates.get(entry.onlineSpecCode) ?? [];
    if (!candidates.some((item) => item.matchedSkuId === entry.matchedSkuId)) candidates.push(entry);
    reverseCandidates.set(entry.onlineSpecCode, candidates);
  }
  for (const [onlineSpecCode, candidates] of reverseCandidates) {
    const candidate = candidates[0];
    if (mappings.has(onlineSpecCode) || candidates.length !== 1 || !candidate) continue;
    mappings.set(onlineSpecCode, { ...candidate, matchDirection: "reverse" });
  }

  const salesByOnlineSpecCode = new Map<string, { erpProductCode: string; category: string }>();
  for (const row of salesRows) {
    const key = row.online_spec_code.trim();
    if (!key) continue;
    const current = salesByOnlineSpecCode.get(key);
    if (!current) {
      salesByOnlineSpecCode.set(key, { erpProductCode: row.product_code.trim(), category: row.category.trim() });
    } else {
      if (!current.erpProductCode) current.erpProductCode = row.product_code.trim();
      if (!current.category) current.category = row.category.trim();
    }
  }
  for (const [lookupCode, mapping] of mappings) {
    const sale = salesByOnlineSpecCode.get(mapping.onlineSpecCode);
    if (sale) mappings.set(lookupCode, { ...mapping, ...sale });
  }
  return mappings;
}
