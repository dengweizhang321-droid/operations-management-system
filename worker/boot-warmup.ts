/**
 * 开机预热：本机刚开机的一段时间内，本地定时触发器（tools/start-local-worker.mjs）会在请求上带
 * 此标记头，让 scheduled 路由暂缓三类重任务（市场标注、客服自动分析、网店投影同步），
 * 避免它们与开机后集中补跑的其他读写抢占 PostgreSQL。标记只能“少做”：缺失或非法一律按非预热处理。
 */
export const BOOT_WARMUP_HEADER = "x-teruisi-boot-warmup";

export type BootWarmupSkip = { skipped: "boot_warmup" };

/** 只认精确值 "1"；任何其他取值（含空串、"true"、多值拼接）都视为非预热。 */
export function isBootWarmupRequest(headers: Headers): boolean {
  return headers.get(BOOT_WARMUP_HEADER) === "1";
}

/** 预热期间返回的跳过结果；与 { ok: true } / { ok: false } 区分，避免被当作执行成功或失败。 */
export function bootWarmupSkipFor(bootWarmup: boolean | undefined): BootWarmupSkip | undefined {
  return bootWarmup === true ? { skipped: "boot_warmup" } : undefined;
}
