export type ChainTodayState = "completed" | "running" | "waiting" | "pending" | "failed" | "cancelled" | "no_record" | "unknown" | "unavailable";
export type ChainExecutionMode = "trigger" | "webhook" | "manual";
export type ChainTodayItem = {
  workflowId: string; active: boolean | null; state: ChainTodayState; completedToday: boolean;
  completedAt: string | null; completedMode?: ChainExecutionMode | null;
  executionId: string | null; executionMode?: ChainExecutionMode | null; startedAt: string | null; finishedAt: string | null;
};
export type ChainTodayResponse = { date: string; timezone: "local" | "Asia/Shanghai"; dayStart?: string; dayEnd?: string; checkedAt: string; source: "n8n_execution_metadata" | "synthetic_n8n"; items: ChainTodayItem[] };

export function formatChainStatusTime(value?: string | null, zone: ChainTodayResponse["timezone"] = "Asia/Shanghai") {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  // New responses carry the execution host's explicit local offset. Display
  // that wall clock instead of reinterpreting it in the browser's timezone.
  if (zone === "local" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}.*[+-]\d{2}:\d{2}$/.test(value)) {
    return `${value.slice(5, 10).replace("-", "/")} ${value.slice(11, 16)}`;
  }
  if (zone === "local") return "—";
  // Compatibility for pre-adoption UTC responses; new APIs send explicit offsets.
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

export function isCurrentChainDay(value: ChainTodayResponse | null, now = Date.now()): boolean {
  if (!value) return false;
  if (value.timezone === "local") {
    return now >= Date.parse(value.dayStart ?? "") && now < Date.parse(value.dayEnd ?? "");
  }
  return value.date === new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(now));
}

export function todayStatusLabel(item?: ChainTodayItem) {
  if (!item) return { label: "今天：无法核实", tone: "neutral" };
  if (item.state === "completed" && item.completedMode === "manual") return { label: "今日手动补跑已完成", tone: "success" };
  if (item.state === "completed" && item.completedMode === "webhook") return { label: "今天重试已完成", tone: "success" };
  if (item.state === "completed" && item.completedMode === "trigger") return { label: "今天定时已完成", tone: "success" };
  if (item.state === "running" && item.executionMode === "webhook") return { label: "自动重试运行中", tone: "pending" };
  if (item.state === "running" && item.executionMode === "trigger") return { label: "定时执行中", tone: "pending" };
  if (item.state === "waiting" && item.executionMode === "webhook") return { label: "自动重试等待继续", tone: "warning" };
  const labels: Record<ChainTodayState, string> = { completed: "今天已完成", running: "正在运行", waiting: "等待继续", pending: "待执行", failed: "最近自动执行失败", cancelled: "最近自动执行取消", no_record: "未查到今日执行记录", unknown: "状态未知", unavailable: "无法核实" };
  const tone = item.state === "completed" ? "success" : item.state === "failed" ? "danger" : ["running", "pending"].includes(item.state) ? "pending" : item.state === "waiting" ? "warning" : "neutral";
  return { label: labels[item.state], tone };
}

export function completedAtLabel(item: ChainTodayItem) {
  if (item.completedMode === "manual") return "今日手动补跑完成于";
  return item.completedMode === "webhook" ? "今日重试完成于" : item.completedMode === "trigger" ? "今日定时完成于" : "今日完成于";
}

export function validateTodayStatus(value: ChainTodayResponse): boolean {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value.date) && ["local", "Asia/Shanghai"].includes(value.timezone)
    && (value.timezone !== "local" || (Number.isFinite(Date.parse(value.dayStart ?? ""))
      && Number.isFinite(Date.parse(value.dayEnd ?? ""))
      && Date.parse(value.dayStart!) <= Date.parse(value.checkedAt) && Date.parse(value.checkedAt) < Date.parse(value.dayEnd!)))
    && Number.isFinite(Date.parse(value.checkedAt)) && ["n8n_execution_metadata", "synthetic_n8n"].includes(value.source)
    && Array.isArray(value.items) && value.items.length <= 32 && new Set(value.items.map(i => i.workflowId)).size === value.items.length
    && value.items.every(i => typeof i.workflowId === "string" && typeof i.completedToday === "boolean" && (i.active === null || typeof i.active === "boolean")
      && ["completed", "running", "waiting", "pending", "failed", "cancelled", "no_record", "unknown", "unavailable"].includes(i.state)
      && (i.completedMode === undefined || i.completedMode === null || ["trigger", "webhook", "manual"].includes(i.completedMode))
      && (i.executionMode === undefined || i.executionMode === null || ["trigger", "webhook", "manual"].includes(i.executionMode))
      && (i.executionMode !== "manual" || (i.state === "completed" && i.completedMode === "manual"))
      && (i.completedToday ? i.completedAt !== null && Number.isFinite(Date.parse(i.completedAt)) : i.completedAt === null)
      && (i.state !== "completed" || i.completedToday)));
}
