export type InventoryReadSection = "summary" | "detail";
export type InventoryRegionPayload<T> = T & { readSection: InventoryReadSection; readScope: string; readSnapshot: string };
export type InventoryRegionState<T> = {
  key: string; value: T; summary: boolean; detail: boolean; snapshot: string; scope: string;
};

export function mergeInventoryRegion<T>(previous: InventoryRegionState<T> | null, key: string, payload: InventoryRegionPayload<T>): InventoryRegionState<T> {
  const same = previous?.key === key && previous.snapshot === payload.readSnapshot && previous.scope === payload.readScope;
  const section = payload.readSection;
  return {
    key, value: section === "summary" && same && previous.detail ? previous.value : payload,
    summary: section === "summary" || Boolean(same && previous.summary),
    detail: section === "detail" || Boolean(same && previous.detail),
    snapshot: payload.readSnapshot, scope: payload.readScope,
  };
}

export async function readInventoryRegions<T>(url: string, options: {
  signal: AbortSignal; section?: InventoryReadSection;
  previous?: { snapshot: string; scope: string } | null;
  validate: (value: T) => void;
  onData: (value: InventoryRegionPayload<T>) => void;
  onError: (section: InventoryReadSection, message: string) => void;
  onReset: () => void;
}) {
  // Regions become visible independently. A racing source update never mixes
  // two snapshots; retry the read-only pair once, then expose a bounded failure.
  let sections: InventoryReadSection[] = options.section ? [options.section] : ["summary", "detail"];
  for (let attempt = 0; attempt < 2 && !options.signal.aborted; attempt++) {
    const tokens: string[] = [];
    await Promise.all(sections.map(async section => {
      try {
        const target = new URL(url, "http://inventory.local");
        target.searchParams.set("section", section);
        const response = await fetch(target.pathname + target.search, { cache: "no-store", signal: options.signal });
        const body = await response.json() as InventoryRegionPayload<T> & { error?: string; message?: string };
        if (!response.ok) throw new Error(body.error || body.message || `库存区域读取失败（${response.status}）`);
        if (body.readSection !== section || !/^[a-f0-9]{64}$/.test(body.readScope) || !/^[a-f0-9]{64}$/.test(body.readSnapshot)) throw new Error("库存区域响应身份不完整");
        options.validate(body);
        if (options.signal.aborted) return;
        tokens.push(`${body.readScope}:${body.readSnapshot}`);
        options.onData(body);
      } catch (error) {
        if (!options.signal.aborted) options.onError(section, error instanceof Error ? error.message : "库存区域读取失败");
      }
    }));
    const prior = options.previous ? `${options.previous.scope}:${options.previous.snapshot}` : null;
    const changedOnLocalRetry = sections.length === 1 && prior !== null && tokens.length === 1 && tokens[0] !== prior;
    if (!changedOnLocalRetry && (tokens.length < 2 || tokens[0] === tokens[1])) return;
    if (options.signal.aborted) return;
    options.onReset();
    sections = ["summary", "detail"];
    if (attempt === 1) sections.forEach(section => options.onError(section, "来源版本持续变化，请刷新重试"));
  }
}
