"use client";
import { useEffect, useRef, useState } from "react";
import { addIsoDays, addIsoMonths, clampIsoDate, startOfIsoMonth, endOfIsoMonth, isoDayDifference } from "./module-view-shared";
type PickerPeriod = { startDate: string; endDate: string };

function CalendarMonth({ month, minDate, maxDate, startDate, endDate, onSelect, onDragStart, onDragEnter, onDragEnd }: {
  month: string;
  minDate: string;
  maxDate: string;
  startDate: string | null;
  endDate: string | null;
  onSelect: (date: string) => void;
  onDragStart: (date: string) => void;
  onDragEnter: (date: string) => void;
  onDragEnd: () => void;
}) {
  const firstDate = `${month}-01`;
  const firstWeekday = new Date(`${firstDate}T00:00:00Z`).getUTCDay();
  const calendarStart = addIsoDays(firstDate, -firstWeekday);
  const title = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${firstDate}T00:00:00Z`));
  const weekNames = ["日", "一", "二", "三", "四", "五", "六"];
  return <div className="period-calendar"><h4>{title}</h4><div className="period-weekdays">{weekNames.map((day) => <span key={day}>{day}</span>)}</div><div className="period-days">{Array.from({ length: 42 }, (_, index) => {
    const date = addIsoDays(calendarStart, index);
    const outside = !date.startsWith(month);
    const disabled = date < minDate || date > maxDate;
    const selected = date === startDate || date === endDate;
    const inRange = Boolean(startDate && endDate && date > startDate && date < endDate);
    return <button type="button" key={date} disabled={disabled} className={`${outside ? "outside" : ""} ${selected ? "selected" : ""} ${inRange ? "in-range" : ""}`} data-date={date} aria-label={date} aria-pressed={selected || inRange} onPointerDown={e => { if (e.button === 0) onDragStart(date); }} onPointerEnter={() => onDragEnter(date)} onPointerMove={e => { if (e.pointerType !== "mouse" && e.buttons) { const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLButtonElement>("button[data-date]"); if (target && !target.disabled) onDragEnter(target.dataset.date!); } }} onPointerUp={onDragEnd} onClick={() => onSelect(date)} onKeyDown={e => { const shift = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "ArrowDown" ? 7 : e.key === "ArrowUp" ? -7 : 0; if (shift) { e.preventDefault(); const target = e.currentTarget.closest(".stat-period-picker")?.querySelector<HTMLButtonElement>(`button[aria-label="${addIsoDays(date, shift)}"]`); target?.focus(); } }} style={{ touchAction: "none" }}>{date.slice(8)}</button>;
  })}</div></div>;
}

export default function StatisticalPeriodPicker({ minDate, maxDate, startDate, endDate, onApply, onCancel, periodIntent }: {
  minDate: string;
  maxDate: string;
  startDate: string;
  endDate: string;
  onCancel?: () => void;
  periodIntent?: "rolling" | "quarter";
  onApply: (startDate: string, endDate: string, intent?: "rolling" | "quarter") => void;
}) {
  const [draftIntent, setDraftIntent] = useState<"rolling" | "quarter" | undefined>(periodIntent);
  const pickerElement = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel?.(); };
    const outside = (e: PointerEvent) => { const owner = pickerElement.current?.closest(".ov-date,.date-selector"); if (!(owner ?? pickerElement.current)?.contains(e.target as Node)) onCancel?.(); };
    document.addEventListener("keydown", escape); document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("keydown", escape); document.removeEventListener("pointerdown", outside); };
  }, [onCancel]);
  const drag = useRef<{ start: string; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [draftStart, setDraftStart] = useState<string | null>(startDate);
  const [draftEnd, setDraftEnd] = useState<string | null>(endDate);
  const [leftMonth, setLeftMonth] = useState(startDate.slice(0, 7));
  useEffect(() => {
    setDraftStart(startDate); setDraftEnd(endDate); setLeftMonth(startDate.slice(0, 7)); setDraftIntent(periodIntent);
  }, [endDate, startDate, periodIntent]);
  const clampPeriod = (period: PickerPeriod): PickerPeriod => {
    const nextStart = clampIsoDate(period.startDate, minDate, maxDate);
    const nextEnd = clampIsoDate(period.endDate, minDate, maxDate);
    return nextStart <= nextEnd ? { startDate: nextStart, endDate: nextEnd } : { startDate: nextEnd, endDate: nextEnd };
  };
  const year = Number(maxDate.slice(0, 4));
  const month = Number(maxDate.slice(5, 7));
  const quarterStartMonth = Math.floor((month - 1) / 3) * 3 + 1;
  const shortcuts: Array<{ label: string; period: PickerPeriod }> = [
    { label: "去年", period: { startDate: `${year - 1}-01-01`, endDate: `${year - 1}-12-31` } },
    { label: "今年", period: { startDate: `${year}-01-01`, endDate: maxDate } },
    { label: "本季", period: { startDate: `${year}-${String(quarterStartMonth).padStart(2, "0")}-01`, endDate: maxDate } },
    { label: "本月", period: { startDate: startOfIsoMonth(maxDate), endDate: maxDate } },
    { label: "近一年", period: { startDate: addIsoMonths(maxDate, -12), endDate: maxDate } },
    { label: "近6月", period: { startDate: addIsoMonths(maxDate, -6), endDate: maxDate } },
    { label: "近3月", period: { startDate: addIsoMonths(maxDate, -3), endDate: maxDate } },
    { label: "上月", period: { startDate: startOfIsoMonth(addIsoMonths(maxDate, -1)), endDate: endOfIsoMonth(addIsoMonths(maxDate, -1)) } },
    { label: "近1月", period: { startDate: addIsoMonths(maxDate, -1), endDate: maxDate } },
    { label: "近7天", period: { startDate: addIsoDays(maxDate, -6), endDate: maxDate } },
    { label: "前7天", period: { startDate: addIsoDays(maxDate, -13), endDate: addIsoDays(maxDate, -7) } },
    { label: "昨天", period: { startDate: addIsoDays(maxDate, -1), endDate: addIsoDays(maxDate, -1) } },
    { label: "今天", period: { startDate: maxDate, endDate: maxDate } },
  ].map((item) => ({ ...item, period: clampPeriod(item.period) }));
  const chooseDate = (date: string) => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    setDraftIntent(undefined);
    if (!draftStart || draftEnd) { setDraftStart(date); setDraftEnd(null); return; }
    if (date < draftStart) { setDraftStart(date); setDraftEnd(draftStart); return; }
    setDraftEnd(date);
  };
  const onDragStart = (date: string) => { drag.current = { start: date, moved: false }; };
  const onDragEnter = (date: string) => {
    if (!drag.current || date === drag.current.start) return;
    drag.current.moved = true;
    setDraftIntent(undefined);
    setDraftStart(date < drag.current.start ? date : drag.current.start);
    setDraftEnd(date < drag.current.start ? drag.current.start : date);
  };
  const onDragEnd = () => { suppressClick.current = Boolean(drag.current?.moved); drag.current = null; };
  useEffect(() => { const clear = () => { drag.current = null; }; window.addEventListener("pointerup", clear); return () => window.removeEventListener("pointerup", clear); }, []);
  const applyShortcut = (period: PickerPeriod) => { setDraftStart(period.startDate); setDraftEnd(period.endDate); setLeftMonth(period.startDate.slice(0, 7)); };
  const selectedShortcut = shortcuts.find((item) => item.period.startDate === draftStart && item.period.endDate === draftEnd)?.label;
  const rightMonth = addIsoMonths(`${leftMonth}-01`, 1).slice(0, 7);
  const exceedsMaximumDays = Boolean(draftStart && draftEnd && isoDayDifference(draftStart, draftEnd) + 1 > 366);
  return <div className="stat-period-picker" ref={pickerElement} aria-label="自定义统计周期">
    <div className="period-shortcuts">{shortcuts.map((item) => <button type="button" key={item.label} className={selectedShortcut === item.label ? "active" : ""} onClick={() => { applyShortcut(item.period); setDraftIntent(item.label === "本季" ? "quarter" : item.label.startsWith("近") || item.label === "前7天" ? "rolling" : undefined); }}>{item.label}</button>)}</div>
    <div className="period-calendars"><button type="button" className="period-nav" onClick={() => setLeftMonth(addIsoMonths(`${leftMonth}-01`, -1).slice(0, 7))} aria-label="上一月">‹</button><CalendarMonth month={leftMonth} minDate={minDate} maxDate={maxDate} startDate={draftStart} endDate={draftEnd} onSelect={chooseDate} onDragStart={onDragStart} onDragEnter={onDragEnter} onDragEnd={onDragEnd} /><CalendarMonth month={rightMonth} minDate={minDate} maxDate={maxDate} startDate={draftStart} endDate={draftEnd} onSelect={chooseDate} onDragStart={onDragStart} onDragEnter={onDragEnter} onDragEnd={onDragEnd} /><button type="button" className="period-nav" onClick={() => setLeftMonth(addIsoMonths(`${leftMonth}-01`, 1).slice(0, 7))} aria-label="下一月">›</button></div>
    <div className="period-picker-footer"><span>{draftStart ? `${draftStart} 00:00:00` : "请选择开始日期"}</span><i className={exceedsMaximumDays ? "period-limit-warning" : ""}>{exceedsMaximumDays ? "最长366天" : "—"}</i><span>{draftEnd ? `${draftEnd} 23:59:59` : "请选择结束日期"}</span><div>{onCancel && <button type="button" onClick={onCancel}>取消</button>}<button type="button" onClick={() => { setDraftStart(null); setDraftEnd(null); setDraftIntent(undefined); }}>清空</button><button type="button" className="primary-button" disabled={!draftStart || !draftEnd || exceedsMaximumDays} onClick={() => draftStart && draftEnd && onApply(draftStart, draftEnd, draftIntent)}>确定</button></div></div>
  </div>;
}
