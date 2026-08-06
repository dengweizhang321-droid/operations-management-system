export function normalizeTableCellValue(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 180);
}

export function tableRowMatchesColumnFilters(
  values: readonly (string | readonly string[])[],
  filters: ReadonlyMap<number, ReadonlySet<string>>,
) {
  for (const [columnIndex, selectedValues] of filters) {
    const value = values[columnIndex] ?? "";
    const candidates = Array.isArray(value) ? value : [value];
    if (selectedValues.size > 0 && !candidates.some((candidate) => selectedValues.has(candidate))) return false;
  }
  return true;
}
