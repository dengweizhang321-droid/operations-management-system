/** Validate the date echo rendered by JD's custom-range control. */
export function jdDateRangeEchoMatches(echoText: string, startDate: string, endDate: string) {
  const currentLine = echoText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^\u5f53\u524d[\uff1a:]/.test(line));
  if (!currentLine || !currentLine.includes(startDate)) return false;
  const hasRangeSeparator = /[~\uff5e\u81f3]/.test(currentLine);
  // A range which begins on the requested day is not a single-day selection.
  if (startDate === endDate) return !hasRangeSeparator;
  return hasRangeSeparator && (currentLine.includes(endDate) || currentLine.includes(endDate.slice(5)));
}
