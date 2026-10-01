/** The owning ERP integer quantity is not a physical item count or an order count. */
export function formatNativeIntegerQuantityValue(value: number | null): string {
  if (value === null || !Number.isSafeInteger(value)) return "—";
  return `${value.toLocaleString("zh-CN", { maximumFractionDigits: 0 })} 原生数量`;
}
