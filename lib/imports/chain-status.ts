export type ChainTodayState = "completed" | "running" | "waiting" | "pending" | "failed" | "cancelled" | "no_record" | "unknown" | "unavailable";
export type ChainTodayItem = {
  workflowId: string; active: boolean | null; state: ChainTodayState; completedToday: boolean;
  completedAt: string | null; executionId: string | null; startedAt: string | null; finishedAt: string | null;
};
export type ChainTodayResponse = { date: string; timezone: "Asia/Shanghai"; checkedAt: string; source: "n8n_execution_metadata" | "synthetic_n8n"; items: ChainTodayItem[] };

export function formatChainStatusTime(value?: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

export function todayStatusLabel(item?: ChainTodayItem) {
  if (!item) return { label: "今天：无法核实", tone: "neutral" };
  const labels: Record<ChainTodayState, string> = { completed: "今天已完成", running: "正在运行", waiting: "等待继续", pending: "待执行", failed: "最近执行失败", cancelled: "最近执行取消", no_record: "未查到今日记录", unknown: "状态未知", unavailable: "无法核实" };
  const tone = item.state === "completed" ? "success" : item.state === "failed" ? "danger" : ["running", "pending"].includes(item.state) ? "pending" : item.state === "waiting" ? "warning" : "neutral";
  return { label: labels[item.state], tone };
}

export function validateTodayStatus(value: ChainTodayResponse): boolean {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value.date) && value.timezone === "Asia/Shanghai"
    && Number.isFinite(Date.parse(value.checkedAt)) && ["n8n_execution_metadata", "synthetic_n8n"].includes(value.source)
    && Array.isArray(value.items) && value.items.length <= 32 && new Set(value.items.map(i => i.workflowId)).size === value.items.length
    && value.items.every(i => typeof i.workflowId === "string" && typeof i.completedToday === "boolean" && (i.active === null || typeof i.active === "boolean")
      && ["completed", "running", "waiting", "pending", "failed", "cancelled", "no_record", "unknown", "unavailable"].includes(i.state)
      && (i.completedToday ? i.completedAt !== null && Number.isFinite(Date.parse(i.completedAt)) : i.completedAt === null)
      && (i.state !== "completed" || i.completedToday)));
}
