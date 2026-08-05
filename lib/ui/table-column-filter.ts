export function normalizeTableCellValue(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 180);
}

export function tableRowMatchesColumnFilters(
  values: readonly string[],
  filters: ReadonlyMap<number, ReadonlySet<string>>,
) {
  for (const [columnIndex, selectedValues] of filters) {
    if (selectedValues.size > 0 && !selectedValues.has(values[columnIndex] ?? "")) return false;
  }
  return true;
}
