import type { InventoryReadSection } from "@/lib/inventory/read-regions";

export default function InventoryRegionNotice({ summary, detail, errors, onRetry }: {
  summary: boolean; detail: boolean; errors: Partial<Record<InventoryReadSection, string>>;
  onRetry: (section: InventoryReadSection) => void;
}) {
  return <div aria-live="polite">{(["summary", "detail"] as const).map(section => {
    const ready = section === "summary" ? summary : detail;
    const name = section === "summary" ? "统计与分布" : "当前页明细";
    const error = errors[section];
    if (ready && !error) return null;
    return <section key={section} className={`panel inventory-feedback ${error ? "inventory-feedback-error" : ""}`} role={error ? "alert" : "status"}>
      <div><strong>{name}{error ? "读取失败" : "正在读取"}</strong><p>{error || "页面其他已就绪区域可继续查看。"}</p></div>
      {error && <button type="button" className="row-action" onClick={() => onRetry(section)}>重试{name}</button>}
    </section>;
  })}</div>;
}
