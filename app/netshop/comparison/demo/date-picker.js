(() => {
  "use strict";

  const DAY_MS = 86400000;
  const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
  let dialog = null;
  let state = null;
  let returnFocus = null;
  let drag = null;
  let suppressClickUntil = 0;

  function isDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function addDays(value, days) {
    return new Date(new Date(`${value}T00:00:00.000Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10);
  }

  function moveMonth(month, amount) {
    const date = new Date(`${month}-01T00:00:00.000Z`);
    date.setUTCMonth(date.getUTCMonth() + amount);
    return date.toISOString().slice(0, 7);
  }

  function monthEnd(month) {
    return addDays(`${moveMonth(month, 1)}-01`, -1);
  }

  function addMonths(value, amount) {
    const month = moveMonth(value.slice(0, 7), amount);
    return `${month}-${String(Math.min(Number(value.slice(8)), Number(monthEnd(month).slice(8)))).padStart(2, "0")}`;
  }

  function dayCount(start, end) {
    return Math.round((new Date(`${end}T00:00:00.000Z`) - new Date(`${start}T00:00:00.000Z`)) / DAY_MS) + 1;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  }

  function validate() {
    if (!state.startDate || !state.endDate) return { valid: false, message: "请选择开始与结束日期。" };
    if (!isDate(state.startDate) || !isDate(state.endDate)) return { valid: false, message: "请输入有效日期，格式为 YYYY-MM-DD。" };
    if (state.startDate < state.minDate || state.endDate < state.minDate) return { valid: false, message: `最早可选日期为 ${state.minDate}。` };
    if (state.startDate > state.maxDate || state.endDate > state.maxDate) return { valid: false, message: `最晚可选日期为 ${state.maxDate}，不能选择未来日期。` };
    if (state.startDate > state.endDate) return { valid: false, message: "结束日期不能早于开始日期。" };
    const days = dayCount(state.startDate, state.endDate);
    if (days > state.maxDays) return { valid: false, message: `已选 ${days} 天，最长可选 ${state.maxDays} 天（含起止日）。` };
    return { valid: true, days, message: `已选 ${days} 天（含起止日）。` };
  }

  function available(value) {
    return isDate(value) && value >= state.minDate && value <= state.maxDate;
  }

  function visibleMonth(value) {
    const firstMonth = state.minDate.slice(0, 7);
    const maxMonth = state.maxDate.slice(0, 7);
    const lastLeftMonth = firstMonth === maxMonth ? firstMonth : moveMonth(maxMonth, -1);
    const requested = isDate(value) ? value.slice(0, 7) : maxMonth;
    return requested < firstMonth ? firstMonth : requested > lastLeftMonth ? lastLeftMonth : requested;
  }

  function makeShortcuts() {
    const today = state.maxDate;
    const year = Number(today.slice(0, 4));
    const month = today.slice(0, 7);
    const quarter = String(Math.floor((Number(today.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, "0");
    const lastMonth = moveMonth(month, -1);
    const periods = [
      ["去年", `${year - 1}-01-01`, `${year - 1}-12-31`],
      ["今年", `${year}-01-01`, today],
      ["本季", `${year}-${quarter}-01`, today],
      ["本月", `${month}-01`, today],
      ["近一年", addMonths(today, -12), today],
      ["近6月", addMonths(today, -6), today],
      ["近3月", addMonths(today, -3), today],
      ["上月", `${lastMonth}-01`, monthEnd(lastMonth)],
      ["近1月", addMonths(today, -1), today],
      ["近7天", addDays(today, -6), today],
      ["前7天", addDays(today, -13), addDays(today, -7)],
      ["昨天", addDays(today, -1), addDays(today, -1)],
      ["今天", today, today],
    ];
    return periods.map(([label, originalStart, originalEnd]) => {
      // Intersect ranges; a shortcut outside the limits must not invent a boundary day.
      const start = originalStart < state.minDate ? state.minDate : originalStart;
      const end = originalEnd > state.maxDate ? state.maxDate : originalEnd;
      const disabled = start > end || dayCount(start, end) > state.maxDays;
      return { label, start, end, originalStart, originalEnd, disabled, clipped: start !== originalStart || end !== originalEnd };
    });
  }

  function renderMonth(month) {
    const first = `${month}-01`;
    const offset = new Date(`${first}T00:00:00.000Z`).getUTCDay();
    const days = Number(monthEnd(month).slice(8));
    const title = `${Number(month.slice(0, 4))}年${Number(month.slice(5))}月`;
    const slots = Array.from({ length: 42 }, (_, index) => {
      const day = index - offset + 1;
      if (day < 1 || day > days) return '<span class="comparison-date-picker__blank" aria-hidden="true"></span>';
      const date = `${month}-${String(day).padStart(2, "0")}`;
      return `<button type="button" class="comparison-date-picker__day" data-date-action="day" data-date-value="${date}" data-testid="date-day-${date}" aria-label="${title}${day}日" aria-pressed="false" ${available(date) ? "" : "disabled"}>${day}</button>`;
    }).join("");
    return `<section class="comparison-date-picker__month" aria-label="${title}"><h3>${title}</h3><div class="comparison-date-picker__weekdays" aria-hidden="true">${WEEKDAYS.map((day) => `<span>${day}</span>`).join("")}</div><div class="comparison-date-picker__days">${slots}</div></section>`;
  }

  function renderCalendars() {
    dialog.querySelector(".comparison-date-picker__months").innerHTML = renderMonth(state.leftMonth) + renderMonth(moveMonth(state.leftMonth, 1));
    dialog.querySelector('[data-date-action="prev-month"]').disabled = state.leftMonth <= state.minDate.slice(0, 7);
    dialog.querySelector('[data-date-action="next-month"]').disabled = state.leftMonth >= visibleMonth(state.maxDate);
    paintDraft();
  }

  function fieldInvalid(value) {
    return Boolean(value && !available(value));
  }

  function paintDraft() {
    if (!dialog || !state) return;
    const validation = validate();
    const ordered = isDate(state.startDate) && isDate(state.endDate) && state.startDate <= state.endDate;
    dialog.querySelectorAll('[data-date-action="day"]').forEach((button) => {
      const value = button.dataset.dateValue;
      const isStart = value === state.startDate;
      const isEnd = value === state.endDate;
      button.classList.toggle("is-start", isStart);
      button.classList.toggle("is-end", isEnd);
      button.classList.toggle("is-in-range", ordered && value > state.startDate && value < state.endDate);
      button.setAttribute("aria-pressed", String(isStart || isEnd));
    });
    dialog.querySelectorAll('[data-date-action="shortcut"]').forEach((button) => {
      const item = state.shortcuts.find((shortcut) => shortcut.label === button.dataset.dateValue);
      const active = !item.disabled && item.start === state.startDate && item.end === state.endDate && (!state.shortcut || state.shortcut === item.label);
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    const startInput = dialog.querySelector('[data-date-action="start-input"]');
    const endInput = dialog.querySelector('[data-date-action="end-input"]');
    startInput.value = state.startDate;
    endInput.value = state.endDate;
    startInput.setAttribute("aria-invalid", String(fieldInvalid(state.startDate)));
    endInput.setAttribute("aria-invalid", String(fieldInvalid(state.endDate) || Boolean(ordered === false && isDate(state.startDate) && isDate(state.endDate))));
    const status = dialog.querySelector(".comparison-date-picker__status");
    status.textContent = validation.message;
    status.classList.toggle("is-error", !validation.valid && Boolean(state.startDate && state.endDate));
    dialog.querySelector(".comparison-date-picker__notice").textContent = state.notice;
    const apply = dialog.querySelector('[data-date-action="apply"]');
    apply.disabled = !validation.valid || state.applying;
    apply.textContent = state.applying ? "应用中…" : "确定";
  }

  function selectDate(value) {
    if (!available(value)) return;
    state.notice = "";
    state.shortcut = "";
    if (!available(state.startDate) || state.endDate) {
      state.startDate = value;
      state.endDate = "";
    } else {
      const anchor = state.startDate;
      state.startDate = value < anchor ? value : anchor;
      state.endDate = value < anchor ? anchor : value;
    }
    paintDraft();
  }

  function apply() {
    if (!validate().valid || state.applying) return;
    const current = state;
    current.applying = true;
    paintDraft();
    let result;
    try {
      result = current.onApply(current.startDate, current.endDate);
    } catch (error) {
      current.applying = false;
      if (state === current) paintDraft();
      throw error;
    }
    if (result && typeof result.then === "function") {
      Promise.resolve(result).then(() => {
        if (state === current && dialog.open) close();
      }, (error) => {
        current.applying = false;
        if (state === current) paintDraft();
        throw error;
      });
    } else if (state === current && dialog.open) close();
  }

  function handleClick(event) {
    const button = event.target.closest("button[data-date-action]");
    if (!button || !dialog.contains(button) || button.disabled) return;
    switch (button.dataset.dateAction) {
      case "day":
        if (event.detail && Date.now() < suppressClickUntil) { suppressClickUntil = 0; return; }
        selectDate(button.dataset.dateValue);
        break;
      case "prev-month":
      case "next-month":
        state.leftMonth = moveMonth(state.leftMonth, button.dataset.dateAction === "prev-month" ? -1 : 1);
        renderCalendars();
        break;
      case "shortcut": {
        const shortcut = state.shortcuts.find((item) => item.label === button.dataset.dateValue);
        if (!shortcut || shortcut.disabled) return;
        state.startDate = shortcut.start;
        state.endDate = shortcut.end;
        state.leftMonth = visibleMonth(shortcut.start);
        state.shortcut = shortcut.label;
        state.notice = shortcut.clipped ? `“${shortcut.label}”原范围 ${shortcut.originalStart} — ${shortcut.originalEnd}，已按可选日期裁切为 ${shortcut.start} — ${shortcut.end}。` : "";
        renderCalendars();
        break;
      }
      case "clear":
        state.startDate = "";
        state.endDate = "";
        state.notice = "";
        state.shortcut = "";
        paintDraft();
        dialog.querySelector('[data-date-action="start-input"]').focus();
        break;
      case "cancel": close(); break;
      case "apply": apply(); break;
    }
  }

  function updateDrag(event) {
    if (!drag || drag.pointerId !== event.pointerId || !dialog.open) return;
    const target = document.elementFromPoint(event.clientX, event.clientY);
    const button = target && target.closest('[data-date-action="day"]');
    if (!button || !dialog.contains(button) || button.disabled) return;
    const value = button.dataset.dateValue;
    if (value === drag.last) return;
    drag.last = value;
    drag.moved = drag.moved || value !== drag.anchor;
    if (!drag.moved) return;
    state.startDate = value < drag.anchor ? value : drag.anchor;
    state.endDate = value < drag.anchor ? drag.anchor : value;
    state.notice = "";
    state.shortcut = "";
    paintDraft();
  }

  function createDialog() {
    dialog = document.createElement("dialog");
    dialog.className = "comparison-date-picker";
    dialog.dataset.testid = "date-picker";
    dialog.setAttribute("aria-labelledby", "comparison-date-picker-title");
    dialog.setAttribute("aria-describedby", "comparison-date-picker-help");
    document.body.appendChild(dialog);
    dialog.addEventListener("click", handleClick);
    dialog.addEventListener("input", (event) => {
      const action = event.target.dataset.dateAction;
      if (action !== "start-input" && action !== "end-input") return;
      state[action === "start-input" ? "startDate" : "endDate"] = event.target.value;
      state.notice = "";
      state.shortcut = "";
      paintDraft();
    });
    dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
    dialog.addEventListener("keydown", (event) => {
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialog.querySelectorAll("button:not(:disabled), input:not(:disabled)")).filter((element) => element.getClientRects().length);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    dialog.addEventListener("pointerdown", (event) => {
      const button = event.target.closest('[data-date-action="day"]');
      if (!button || button.disabled || event.button !== 0 || event.pointerType === "touch" || state.applying) return;
      drag = { pointerId: event.pointerId, anchor: button.dataset.dateValue, last: button.dataset.dateValue, moved: false, startDate: state.startDate, endDate: state.endDate, notice: state.notice, shortcut: state.shortcut };
    });
    document.addEventListener("pointermove", updateDrag);
    document.addEventListener("pointerup", (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      updateDrag(event);
      if (drag.moved) suppressClickUntil = Date.now() + 350;
      drag = null;
    });
    document.addEventListener("pointercancel", (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (drag.moved) {
        state.startDate = drag.startDate;
        state.endDate = drag.endDate;
        state.notice = drag.notice;
        state.shortcut = drag.shortcut;
        paintDraft();
      }
      drag = null;
    });
  }

  function snapshot() {
    if (!state) return { open: false };
    const validation = validate();
    return { open: Boolean(dialog && dialog.open), label: state.label, startDate: state.startDate, endDate: state.endDate, minDate: state.minDate, maxDate: state.maxDate, maxDays: state.maxDays, leftMonth: state.leftMonth, rightMonth: moveMonth(state.leftMonth, 1), valid: validation.valid, days: validation.days || null, validationMessage: validation.message, notice: state.notice, applying: state.applying };
  }

  function open(options) {
    if (!options || !isDate(options.minDate) || !isDate(options.maxDate) || options.minDate > options.maxDate) throw new TypeError("日期选择器需要有效且有序的 minDate/maxDate。");
    const maxDays = options.maxDays === undefined ? 366 : options.maxDays;
    if (!Number.isInteger(maxDays) || maxDays < 1) throw new TypeError("maxDays 必须为正整数。");
    if (typeof options.onApply !== "function") throw new TypeError("日期选择器需要 onApply 回调。");
    if (dialog && dialog.open) close();
    returnFocus = document.activeElement;
    drag = null;
    suppressClickUntil = 0;
    state = { label: String(options.label || "自定义统计周期"), startDate: String(options.startDate || ""), endDate: String(options.endDate || ""), minDate: options.minDate, maxDate: options.maxDate, maxDays, onApply: options.onApply, notice: "", shortcut: "", applying: false };
    state.leftMonth = visibleMonth(state.startDate);
    state.shortcuts = makeShortcuts();
    if (!dialog) createDialog();
    dialog.innerHTML = `<header class="comparison-date-picker__header"><h2 id="comparison-date-picker-title">${escapeHtml(state.label)}</h2><button type="button" class="comparison-date-picker__close" data-date-action="cancel" aria-label="取消日期选择">×</button></header>
      <p class="comparison-date-picker__help" id="comparison-date-picker-help">点击开始与结束日期，或用鼠标跨月拖选。日期按上海日历日显示。</p>
      <div class="comparison-date-picker__shortcuts" aria-label="快捷日期">${state.shortcuts.map((item) => `<button type="button" data-date-action="shortcut" data-date-value="${item.label}" data-testid="date-shortcut-${item.label}" aria-pressed="false" ${item.disabled ? "disabled" : ""}>${item.label}</button>`).join("")}</div>
      <div class="comparison-date-picker__navigation"><button type="button" data-date-action="prev-month" data-testid="date-prev-month" aria-label="上一月">‹</button><span>可选 ${state.minDate} — ${state.maxDate} · 最长 ${maxDays} 天</span><button type="button" data-date-action="next-month" data-testid="date-next-month" aria-label="下一月">›</button></div>
      <div class="comparison-date-picker__months"></div>
      <div class="comparison-date-picker__draft"><label>开始日期<input type="text" inputmode="numeric" maxlength="10" autocomplete="off" placeholder="YYYY-MM-DD" data-date-action="start-input" data-testid="date-draft-start" aria-describedby="comparison-date-picker-status"></label><span aria-hidden="true">—</span><label>结束日期<input type="text" inputmode="numeric" maxlength="10" autocomplete="off" placeholder="YYYY-MM-DD" data-date-action="end-input" data-testid="date-draft-end" aria-describedby="comparison-date-picker-status"></label></div>
      <div class="comparison-date-picker__feedback"><p class="comparison-date-picker__status" id="comparison-date-picker-status" role="status" aria-live="polite"></p><p class="comparison-date-picker__notice" aria-live="polite"></p></div>
      <footer class="comparison-date-picker__footer"><button type="button" data-date-action="clear" data-testid="date-clear">清空</button><div><button type="button" data-date-action="cancel" data-testid="date-cancel">取消</button><button type="button" class="comparison-date-picker__apply" data-date-action="apply" data-testid="date-apply">确定</button></div></footer>`;
    renderCalendars();
    dialog.showModal();
    dialog.querySelector('[data-date-action="start-input"]').focus();
    return snapshot();
  }

  function close() {
    drag = null;
    if (!dialog || !dialog.open) return;
    dialog.close();
    const focusTarget = returnFocus;
    returnFocus = null;
    if (focusTarget && focusTarget.isConnected && typeof focusTarget.focus === "function") focusTarget.focus();
  }

  window.comparisonDatePicker = { open, close, snapshot };
})();
