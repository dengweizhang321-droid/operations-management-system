/* eslint-disable @next/next/no-img-element -- 产品线图片地址由操作员维护，域名不能预先固定到 Next Image 白名单。 */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { requestJson } from "@/lib/http/api-client";
import Dialog from "./ui/dialog";

type ProductCode = {
  id: string;
  productCode: string;
  productName: string;
  source: "manual" | "learned";
  sourceBatchId: string;
  active: boolean;
};

type ProductLine = {
  id: string;
  name: string;
  matchTerms: string[];
  productImageUrl: string;
  monitoringStartDate: string;
  weeklyUnitTarget: number | null;
  weeklySalesTargetCents: number | null;
  active: boolean;
  version: number;
  codes: ProductCode[];
};

type Metric = {
  netQuantity: number;
  grossSalesCents: number;
  refundAmountCents: number;
  netSalesCents: number;
  grossProfitCents: number;
};

type FollowupItem = {
  id: string;
  name: string;
  brand: string;
  productImageUrl: string;
  status: "not_started" | "selling" | "target_achieved" | "stalled" | "no_sales" | "missing_codes";
  codeCount: number;
  current: Metric & { grossMarginRate: number | null };
  previous: Metric;
  cumulative: Metric;
  salesWeekOverWeekRate: number | null;
  quantityWeekOverWeekRate: number | null;
  weeklyNetQuantities: number[];
  weeklyUnitTarget: number | null;
  weeklySalesTargetCents: number | null;
  codes: Array<ProductCode & { current: Metric; previous: Metric }>;
};

type ReportWeek = {
  weekStart: string;
  weekEnd: string;
  weekNumber: number;
  label: string;
  dateRange: string;
  dataComplete: boolean;
};

type FollowupReport = {
  timelineStart: string;
  weeks: ReportWeek[];
  weekStart: string;
  weekEnd: string;
  timezone: string;
  localToday: string;
  dataCutoffDate: string | null;
  dataIncomplete: boolean;
  reportSha256: string;
  messageText: string;
  summary: Metric & {
    lineCount: number;
    sellingCount: number;
    noSalesCount: number;
    stalledCount: number;
    targetAchievedCount: number;
  };
  items: FollowupItem[];
};

type LineDraft = {
  name: string;
  matchTerms: string;
  productImageUrl: string;
  monitoringStartDate: string;
  weeklyUnitTarget: string;
  weeklySalesTargetYuan: string;
  productCodes: string;
};

const EMPTY_DRAFT: LineDraft = {
  name: "",
  matchTerms: "",
  productImageUrl: "",
  monitoringStartDate: "",
  weeklyUnitTarget: "",
  weeklySalesTargetYuan: "",
  productCodes: "",
};
const REPORT_TIMELINE_START = "2026-08-03";

function messageOf(reason: unknown, fallback: string) {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

function money(cents: number) {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(cents / 100);
}

function rate(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
}

function statusLabel(value: FollowupItem["status"]) {
  return ({
    not_started: "待开始",
    selling: "销售中",
    target_achieved: "本周达标",
    stalled: "本周停滞",
    no_sales: "尚未开单",
    missing_codes: "缺少代码",
  } as const)[value];
}

function localIsoDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function previousMonday() {
  const now = new Date();
  const day = (now.getDay() + 6) % 7;
  now.setHours(12, 0, 0, 0);
  now.setDate(now.getDate() - day - 7);
  const value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return value < REPORT_TIMELINE_START ? REPORT_TIMELINE_START : value;
}

function sparklinePoints(values: number[], width = 150, height = 42) {
  if (values.length === 0) return "4,38";
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = Math.max(1, high - low);
  return values.map((value, index) => {
    const x = 4 + (index * (width - 8)) / Math.max(1, values.length - 1);
    const y = height - 4 - ((value - low) / span) * (height - 8);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function Trend({ values }: { values: number[] }) {
  return <svg className="launch-followup-sparkline" viewBox="0 0 150 42" role="img" aria-label={`周销量趋势：${values.join("、") || "暂无"}`}><polyline points={sparklinePoints(values)} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

type WorkbookImage = { bytes: Uint8Array; extension: "png" | "jpeg" | "gif" };

function dataUrlBytes(dataUrl: string) {
  const encoded = dataUrl.split(",", 2)[1] || "";
  const binary = window.atob(encoded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function trendPngImage(values: number[]): WorkbookImage {
  const canvas = document.createElement("canvas");
  canvas.width = 300;
  canvas.height = 84;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器无法生成 Excel 趋势图。");
  context.scale(2, 2);
  context.strokeStyle = "#4777b5";
  context.lineWidth = 2;
  context.lineCap = "round";
  context.lineJoin = "round";
  const points = sparklinePoints(values);
  context.beginPath();
  for (const [index, point] of points.split(" ").entries()) {
    const [x, y] = point.split(",").map(Number);
    if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
  }
  context.stroke();
  return { bytes: dataUrlBytes(canvas.toDataURL("image/png")), extension: "png" };
}

async function remoteWorkbookImage(source: string): Promise<WorkbookImage | null> {
  if (!source) return null;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(source, { credentials: "omit", referrerPolicy: "no-referrer", signal: controller.signal });
    if (!response.ok) return null;
    const blob = await response.blob();
    if (!blob.type.startsWith("image/") || blob.size < 1 || blob.size > 3 * 1024 * 1024) return null;
    const directExtension = ({ "image/png": "png", "image/jpeg": "jpeg", "image/gif": "gif" } as const)[blob.type as "image/png" | "image/jpeg" | "image/gif"];
    if (directExtension) {
      return { bytes: new Uint8Array(await blob.arrayBuffer()), extension: directExtension };
    }
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = 120;
    canvas.height = 120;
    const context = canvas.getContext("2d");
    if (!context) { bitmap.close(); return null; }
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(canvas.width / bitmap.width, canvas.height / bitmap.height);
    const width = Math.max(1, bitmap.width * scale);
    const height = Math.max(1, bitmap.height * scale);
    context.drawImage(bitmap, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
    bitmap.close();
    return { bytes: dataUrlBytes(canvas.toDataURL("image/png")), extension: "png" };
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

async function loadProductImages(items: FollowupItem[]) {
  const sources = Array.from(new Set(items.map((item) => item.productImageUrl).filter(Boolean)));
  const images = new Map<string, WorkbookImage | null>();
  let cursor = 0;
  const deadline = Date.now() + 15_000;
  async function worker() {
    while (cursor < sources.length && Date.now() < deadline) {
      const source = sources[cursor];
      cursor += 1;
      images.set(source, await remoteWorkbookImage(source));
    }
  }
  await Promise.all(Array.from({ length: Math.min(6, sources.length) }, worker));
  return images;
}

async function downloadMatrixExcel(report: FollowupReport) {
  const { createNewProductFollowupWorkbookBytes } = await import("@/lib/imports/new-product-followup-xlsx");
  const productImages = await loadProductImages(report.items);
  const bytes = createNewProductFollowupWorkbookBytes({
    timelineStart: report.timelineStart,
    dataCutoffDate: report.dataCutoffDate,
    weeks: report.weeks,
    items: report.items.map((item) => ({
      brand: item.brand || "志高",
      name: item.name,
      productImageUrl: item.productImageUrl,
      weeklyNetQuantities: item.weeklyNetQuantities,
      productImage: item.productImageUrl ? productImages.get(item.productImageUrl) ?? null : null,
      trendImage: trendPngImage(item.weeklyNetQuantities),
    })),
  });
  const href = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const link = document.createElement("a");
  link.href = href;
  link.download = `新品销售周报-${report.weekStart}-${report.weekEnd}.xlsx`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(href), 1_000);
}

function lineToDraft(line: ProductLine): LineDraft {
  return {
    name: line.name,
    matchTerms: line.matchTerms.join("、"),
    productImageUrl: line.productImageUrl,
    monitoringStartDate: line.monitoringStartDate,
    weeklyUnitTarget: line.weeklyUnitTarget === null ? "" : String(line.weeklyUnitTarget),
    weeklySalesTargetYuan: line.weeklySalesTargetCents === null ? "" : String(line.weeklySalesTargetCents / 100),
    productCodes: line.codes.filter((code) => code.active).map((code) => code.productCode).join("\n"),
  };
}

function ProductLineEditor({ line, saving, onClose, onSave }: {
  line: ProductLine | null;
  saving: boolean;
  onClose: () => void;
  onSave: (draft: LineDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState<LineDraft>(() => line ? lineToDraft(line) : { ...EMPTY_DRAFT, monitoringStartDate: localIsoDate() });
  const [error, setError] = useState("");
  const submit = async () => {
    if (!draft.name.trim()) return setError("请填写你希望展示的产品线名称。");
    if (!draft.monitoringStartDate) return setError("请选择监控开始日期。");
    setError("");
    try { await onSave(draft); } catch (reason) { setError(messageOf(reason, "产品线保存失败。")); }
  };
  return <Dialog open onClose={() => !saving && onClose()} dialogId="new-product-line-editor" ariaLabel={line ? "编辑新品产品线" : "新建新品产品线"} className="workflow-edit-modal new-product-line-modal">
    <button type="button" className="workflow-modal-close" aria-label="关闭产品线编辑" disabled={saving} onClick={onClose}>×</button>
    <span className="eyebrow">JACKYUN PRODUCT LINE</span><h2>{line ? "编辑新品产品线" : "新建新品产品线"}</h2>
    <p className="launch-modal-intro">名称由你定义；产品线从监控开始日持续跟踪，销售统计只按吉客云货品代码归集。</p>
    <form className="workflow-edit-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <label className="workflow-edit-title-field"><span>产品线名称（必填）</span><input autoFocus maxLength={160} value={draft.name} placeholder="例如：油水分离器" onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
      <label><span>吉客云名称（学习关键词）</span><input maxLength={500} value={draft.matchTerms} placeholder="填写吉客云货品名称关键词，多个用顿号或逗号分隔" onChange={(event) => setDraft({ ...draft, matchTerms: event.target.value })} /><small>货品名称只命中一个产品线时会自动学习归入，多产品线命中时保留人工判断。</small></label>
      <label><span>产品图链接</span><input type="url" maxLength={1000} value={draft.productImageUrl} placeholder="https://…" onChange={(event) => setDraft({ ...draft, productImageUrl: event.target.value })} /><small>请使用可公开读取的 HTTPS 图片地址，以便周报截图和 Excel 嵌入产品图。</small></label>
      <label><span>监控开始日期</span><input type="date" value={draft.monitoringStartDate} onChange={(event) => setDraft({ ...draft, monitoringStartDate: event.target.value })} /></label>
      <label><span>每周销量目标（件）</span><input type="number" min={0} step={1} value={draft.weeklyUnitTarget} onChange={(event) => setDraft({ ...draft, weeklyUnitTarget: event.target.value })} /></label>
      <label><span>每周净销售额目标（元）</span><input type="number" min={0} step="0.01" value={draft.weeklySalesTargetYuan} onChange={(event) => setDraft({ ...draft, weeklySalesTargetYuan: event.target.value })} /></label>
      <label className="new-product-line-codes"><span>吉客云货品代码</span><textarea rows={8} value={draft.productCodes} placeholder="每行填写一个代码；货品名称从吉客云主数据读取" onChange={(event) => setDraft({ ...draft, productCodes: event.target.value })} /><small>保存时会校验代码真实存在；后续导入出现名称唯一匹配的新代码会自动补入。</small></label>
      {error && <p className="workflow-edit-validation" role="alert">{error}</p>}
      <div className="workflow-modal-actions workflow-edit-actions"><button type="button" className="secondary-button" disabled={saving} onClick={onClose}>取消</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "保存中…" : "保存产品线"}</button></div>
    </form>
  </Dialog>;
}

export default function NewProductSalesFollowupView({ canWrite }: { canWrite: boolean }) {
  const [lines, setLines] = useState<ProductLine[]>([]);
  const [report, setReport] = useState<FollowupReport | null>(null);
  const [weekStart, setWeekStart] = useState(previousMonday);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [learning, setLearning] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [togglingLineId, setTogglingLineId] = useState("");
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [editor, setEditor] = useState<ProductLine | "create" | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async (targetWeek = weekStart) => {
    setLoading(true); setError("");
    try {
      const [linePayload, reportPayload] = await Promise.all([
        requestJson<{ items: ProductLine[] }>("/api/workflow/new-product-lines"),
        requestJson<FollowupReport>(`/api/workflow/new-product-weekly-followup?weekStart=${encodeURIComponent(targetWeek)}`),
      ]);
      setLines(linePayload.items);
      setReport(reportPayload);
    } catch (reason) { setError(messageOf(reason, "新品销售跟进读取失败。")); }
    finally { setLoading(false); }
  }, [weekStart]);

  useEffect(() => { void load(); }, [load]);

  const learn = async (quiet = false) => {
    if (!canWrite || learning) return;
    setLearning(true);
    if (!quiet) setFeedback("");
    try {
      const payload = await requestJson<{ result: { added: unknown[]; ambiguous: unknown[]; scanned: number } }>("/api/workflow/new-product-lines/learn", { method: "POST", body: {} });
      if (!quiet || payload.result.added.length > 0 || payload.result.ambiguous.length > 0) {
        setFeedback(`已扫描 ${payload.result.scanned} 个吉客云货品，新增 ${payload.result.added.length} 个监控代码，${payload.result.ambiguous.length} 个多产品线命中未自动归类。`);
      }
      if (payload.result.added.length > 0) await load();
    } catch (reason) { if (!quiet) setFeedback(messageOf(reason, "吉客云代码学习失败。")); }
    finally { setLearning(false); }
  };

  useEffect(() => { if (canWrite && !loading && lines.length > 0) void learn(true); }, [canWrite, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveLine = async (draft: LineDraft) => {
    if (saving) return;
    setSaving(true);
    const codes = [...new Set(draft.productCodes.split(/[\s,，、;；]+/).map((value) => value.trim()).filter(Boolean))].map((productCode) => ({ productCode }));
    const matchTerms = [...new Set(draft.matchTerms.split(/[,，、;；\n]+/).map((value) => value.trim()).filter(Boolean))];
    const payload = {
      name: draft.name.trim(), matchTerms, productImageUrl: draft.productImageUrl.trim(), monitoringStartDate: draft.monitoringStartDate,
      weeklyUnitTarget: draft.weeklyUnitTarget === "" ? null : Number(draft.weeklyUnitTarget),
      weeklySalesTargetCents: draft.weeklySalesTargetYuan === "" ? null : Math.round(Number(draft.weeklySalesTargetYuan) * 100),
      codes,
    };
    try {
      if (editor && editor !== "create") {
        await requestJson(`/api/workflow/new-product-lines/${encodeURIComponent(editor.id)}`, { method: "PATCH", body: { ...payload, expectedVersion: editor.version } });
        setFeedback(`产品线“${payload.name}”已更新。`);
      } else {
        await requestJson("/api/workflow/new-product-lines", { method: "POST", body: { ...payload, active: true } });
        setFeedback(`产品线“${payload.name}”已创建。`);
      }
      setEditor(null);
      await load();
      await learn(true);
    } finally { setSaving(false); }
  };

  const toggleMonitoring = async (line: ProductLine) => {
    if (!canWrite || togglingLineId) return;
    setTogglingLineId(line.id);
    setFeedback("");
    try {
      await requestJson(`/api/workflow/new-product-lines/${encodeURIComponent(line.id)}`, { method: "PATCH", body: { active: !line.active, expectedVersion: line.version } });
      setFeedback(`产品线“${line.name}”已${line.active ? "暂停" : "启动"}监控${line.active ? "，不会出现在钉钉周报预览和发送截图中" : ""}。`);
      if (line.active && expanded === line.id) setExpanded(null);
      await load();
    } catch (reason) { setFeedback(messageOf(reason, `${line.active ? "暂停" : "启动"}监控失败。`)); }
    finally { setTogglingLineId(""); }
  };

  const downloadReportExcel = async () => {
    if (!report || exporting) return;
    setExporting(true);
    setFeedback("");
    try {
      await downloadMatrixExcel(report);
      setFeedback("Excel 周报已生成，表格内容、蓝色调、产品图和趋势图与页面预览保持一致。");
    } catch (reason) { setFeedback(messageOf(reason, "Excel 周报生成失败。")); }
    finally { setExporting(false); }
  };

  const currentByLine = useMemo(() => new Map(report?.items.map((item) => [item.id, item]) ?? []), [report]);

  return <div className="new-product-followup-view">
    <section className="workflow-toolbar workflow-section-hero launch-followup-hero"><div><span className="eyebrow">NEW PRODUCT WEEKLY SALES</span><h2>上新销售跟进</h2><p>以吉客云货品代码归集销售，由你定义产品线名称；周报周期使用运行机器的本地时间。</p></div><div className="workflow-hero-actions"><span>{report?.timezone ?? "读取本机时区中"}</span><button type="button" className="secondary-button" disabled={learning || !canWrite} onClick={() => void learn()}>{learning ? "学习中…" : "学习新代码"}</button><button type="button" className="primary-button" disabled={!canWrite} onClick={() => setEditor("create")}>＋ 新建产品线</button></div></section>
    {feedback && <div className="workflow-feedback" role="status"><span>i</span><p>{feedback}</p><button type="button" aria-label="关闭提示" onClick={() => setFeedback("")}>×</button></div>}
    <section className="panel launch-followup-controls"><label><span>报告周（星期一）</span><input type="date" min={REPORT_TIMELINE_START} value={weekStart} onChange={(event) => setWeekStart(event.target.value)} /></label><button type="button" className="secondary-button" disabled={loading} onClick={() => void load(weekStart)}>刷新周报</button><span>周维度自 {REPORT_TIMELINE_START} 起持续累积 · 销售数据截至：{report?.dataCutoffDate ?? "暂无"}</span>{report?.dataIncomplete && <strong>本周数据尚未完整</strong>}</section>
    {error && <section className="panel data-state operations-data-state operations-data-state-error" role="alert"><span className="state-symbol">!</span><strong>新品销售跟进加载失败</strong><p>{error}</p><button type="button" className="secondary-button" onClick={() => void load()}>重新加载</button></section>}
    {loading && !report ? <section className="panel data-state operations-data-state"><span className="state-spinner" /><strong>正在生成新品销售周报</strong><p>读取产品线、吉客云代码与销售事实…</p></section> : report && <>
      <section className="launch-followup-summary"><article className="panel"><span>监控产品线</span><strong>{report.summary.lineCount}</strong><small>已销售 {report.summary.sellingCount} · 达标 {report.summary.targetAchievedCount}</small></article><article className="panel"><span>本周净销量</span><strong>{report.summary.netQuantity.toLocaleString("zh-CN")}</strong><small>吉客云代码口径</small></article><article className="panel"><span>本周净销售额</span><strong>{money(report.summary.netSalesCents)}</strong><small>退款 {money(report.summary.refundAmountCents)}</small></article><article className="panel"><span>需要跟进</span><strong>{report.summary.noSalesCount + report.summary.stalledCount}</strong><small>未开单 {report.summary.noSalesCount} · 停滞 {report.summary.stalledCount}</small></article></section>
      <section className="panel"><div className="data-table-wrap"><table className="data-table launch-followup-table"><thead><tr><th>产品图</th><th>产品线</th><th>吉客云代码</th><th>状态</th><th>本周销量</th><th>本周净销售额</th><th>销售额环比</th><th>毛利</th><th>上新累计</th><th>操作</th></tr></thead><tbody>{lines.map((line) => { const item = currentByLine.get(line.id); return <tr key={line.id} className={line.active ? "" : "launch-followup-paused-row"}><td className="launch-followup-product-image">{line.productImageUrl ? <img src={line.productImageUrl} alt={`${line.name}产品图`} loading="lazy" referrerPolicy="no-referrer" /> : <span>暂无</span>}</td><td><strong>{line.name}</strong><small>{line.monitoringStartDate} 起 · 持续跟踪</small></td><td><strong>{line.codes.filter((code) => code.active).length}</strong><small>{line.codes.filter((code) => code.active).slice(0, 2).map((code) => code.productCode).join("、") || "待补充"}</small></td><td>{line.active ? (item ? <span className={`status followup-${item.status}`}>{statusLabel(item.status)}</span> : "—") : <span className="status followup-paused">已暂停</span>}</td><td><strong>{item?.current.netQuantity.toLocaleString("zh-CN") ?? "—"}</strong><small>上周 {item?.previous.netQuantity.toLocaleString("zh-CN") ?? "—"}</small></td><td><strong>{item ? money(item.current.netSalesCents) : "—"}</strong><small>退款 {item ? money(item.current.refundAmountCents) : "—"}</small></td><td className={item?.salesWeekOverWeekRate !== null && Number(item?.salesWeekOverWeekRate) < 0 ? "red-text" : "green-text"}>{rate(item?.salesWeekOverWeekRate ?? null)}</td><td><strong>{item ? money(item.current.grossProfitCents) : "—"}</strong><small>{item?.current.grossMarginRate === null || item?.current.grossMarginRate === undefined ? "—" : `${(item.current.grossMarginRate * 100).toFixed(1)}%`}</small></td><td><strong>{item ? money(item.cumulative.netSalesCents) : "—"}</strong><small>{item?.cumulative.netQuantity.toLocaleString("zh-CN") ?? "—"} 件</small></td><td><div className="launch-followup-actions"><button type="button" className="row-action" disabled={!item} onClick={() => setExpanded(expanded === line.id ? null : line.id)}> {expanded === line.id ? "收起代码" : "查看代码"}</button><button type="button" className="row-action" disabled={!canWrite} onClick={() => setEditor(line)}>编辑</button><button type="button" className={`row-action ${line.active ? "warning" : "success"}`} disabled={!canWrite || togglingLineId === line.id} onClick={() => void toggleMonitoring(line)}>{togglingLineId === line.id ? "处理中…" : line.active ? "暂停监控" : "启动监控"}</button></div></td></tr>; })}{lines.length === 0 && <tr><td colSpan={10}><div className="table-state">尚未建立新品产品线，请先添加产品线名称和吉客云代码。</div></td></tr>}</tbody></table></div>
      {expanded && currentByLine.get(expanded) && <div className="launch-followup-code-detail"><h3>{currentByLine.get(expanded)?.name} · 吉客云代码明细</h3><div>{currentByLine.get(expanded)?.codes.map((code) => <article key={code.productCode}><strong>{code.productCode}</strong><span>{code.productName}</span><small>{code.source === "learned" ? "自动学习" : "手工添加"} · 本周 {code.current.netQuantity} 件 / {money(code.current.netSalesCents)}</small></article>)}</div></div>}
      </section>
      <section className="panel launch-followup-matrix"><header><div><span className="eyebrow">DINGTALK REPORT PREVIEW</span><h3>钉钉周报表格预览</h3><p>发送截图按“品牌 / 产品图 / 产品名称 / 趋势 / 连续周销量”展示，周列从 8 月 3 日所在周开始累积；已暂停监控的产品线不会出现。</p></div><div><span>{report.weekStart} 至 {report.weekEnd}</span><Link className="secondary-button" href="/?module=settings&view=dingtalk">钉钉机器人设置</Link><button type="button" className="secondary-button" disabled={exporting} onClick={() => void downloadReportExcel()}>{exporting ? "正在生成…" : "打开 Excel 表格"}</button></div></header><div className="launch-followup-matrix-scroll"><table className="launch-followup-matrix-table"><thead><tr><th>品牌</th><th>产品图</th><th>产品名称</th><th>趋势</th>{report.weeks.map((week) => <th key={week.weekStart}><strong>{week.label}</strong><span>({week.dateRange})</span>{!week.dataComplete && <small>数据未完整</small>}</th>)}</tr></thead><tbody>{report.items.map((item, index) => <tr key={item.id} className={index % 2 === 0 ? "alternate" : ""}><td>{item.brand || "志高"}</td><td className="launch-followup-matrix-image">{item.productImageUrl ? <img src={item.productImageUrl} alt={`${item.name}产品图`} loading="lazy" referrerPolicy="no-referrer" /> : <span>暂无</span>}</td><td>{item.name}</td><td><Trend values={item.weeklyNetQuantities} /></td>{item.weeklyNetQuantities.map((value, weekIndex) => <td key={report.weeks[weekIndex]?.weekStart ?? weekIndex}>{value.toLocaleString("zh-CN")}</td>)}</tr>)}{report.items.length === 0 && <tr><td colSpan={4 + report.weeks.length}>尚无正在监控的新品产品线</td></tr>}</tbody></table></div><footer><span>口径：吉客云货品代码净销量</span><span>销售数据截至：{report.dataCutoffDate ?? "暂无"}</span></footer></section>
    </>}
    {editor && <ProductLineEditor key={editor === "create" ? "create" : `${editor.id}-${editor.version}`} line={editor === "create" ? null : editor} saving={saving} onClose={() => setEditor(null)} onSave={saveLine} />}
  </div>;
}
