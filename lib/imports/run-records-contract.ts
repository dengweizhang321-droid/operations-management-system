import type { UnifiedHistoryItem } from "@/app/module-view-shared";

export type ImportRecord = UnifiedHistoryItem & { sortAt: string };
export type ImportRecordsPage = {
  recordRevision?: string;
  items: ImportRecord[];
  sources: Array<{ key: string; label: string }>;
  pagination: { page: number; pageSize: number; total: number; returned: number; truncated: boolean; completeness: "complete" | "truncated_do_not_infer_absence" };
};
