"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  monitoringStartDate: string;
  trackingWeeks: number;
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
  status: "not_started" | "selling" | "target_achieved" | "stalled" | "no_sales" | "missing_codes" | "tracking_ended";
  codeCount: number;
  current: Metric & { grossMarginRate: number | null };
  previous: Metric;
  cumulative: Metric;
  salesWeekOverWeekRate: number | null;
  quantityWeekOverWeekRate: number | null;
  weeklyUnitTarget: number | null;
  weeklySalesTargetCents: number | null;
  codes: Array<ProductCode & { current: Metric; previous: Metric }>;
};

type FollowupReport = {
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

type ReportConfig = {
  enabled: boolean;
  targetGroupName: string;
  robotName: string;
  sendWeekday: number;
  sendLocalTime: string;
  version: number;
  lastDelivery: null | {
    weekStart: string;
    weekEnd: string;
    status: string;
    deliveredAt: string | null;
  };
};

type LineDraft = {
  name: string;
  matchTerms: string;
  monitoringStartDate: string;
  trackingWeeks: number;
  weeklyUnitTarget: string;
  weeklySalesTargetYuan: string;
  active: boolean;
  productCodes: string;
};

const EMPTY_DRAFT: LineDraft = {
  name: "",
  matchTerms: "",
  monitoringStartDate: "",
  trackingWeeks: 8,
  weeklyUnitTarget: "",
  weeklySalesTargetYuan: "",
  active: true,
  productCodes: "",
};
const WEEKDAYS = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"];

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
    tracking_ended: "跟踪结束",
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
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function lineToDraft(line: ProductLine): LineDraft {
  return {
    name: line.name,
    matchTerms: line.matchTerms.join("、"),
    monitoringStartDate: line.monitoringStartDate,
    trackingWeeks: line.trackingWeeks,
    weeklyUnitTarget: line.weeklyUnitTarget === null ? "" : String(line.weeklyUnitTarget),
    weeklySalesTargetYuan: line.weeklySalesTargetCents === null ? "" : String(line.weeklySalesTargetCents / 100),
    active: line.active,
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
    if (!Number.isInteger(draft.trackingWeeks) || draft.trackingWeeks < 1 || draft.trackingWeeks > 104) return setError("跟踪周数应为 1–104 周。");
    setError("");
    try { await onSave(draft); } catch (reason) { setError(messageOf(reason, "产品线保存失败。")); }
  };
  return <Dialog open onClose={() => !saving && onClose()} dialogId="new-product-line-editor" ariaLabel={line ? "编辑新品产品线" : "新建新品产品线"} className="workflow-edit-modal new-product-line-modal">
    <button type="button" className="workflow-modal-close" aria-label="关闭产品线编辑" disabled={saving} onClick={onClose}>×</button>
    <span className="eyebrow">JACKYUN PRODUCT LINE</span><h2>{line ? "编辑新品产品线" : "新建新品产品线"}</h2>
    <p className="launch-modal-intro">名称由你定义；销售统计只按吉客云货品代码归集。</p>
    <form className="workflow-edit-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <label className="workflow-edit-title-field"><span>产品线名称（必填）</span><input autoFocus maxLength={160} value={draft.name} placeholder="例如：油水分离器" onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
      <label><span>自动学习关键词</span><input maxLength={500} value={draft.matchTerms} placeholder="多个关键词用顿号或逗号分隔" onChange={(event) => setDraft({ ...draft, matchTerms: event.target.value })} /></label>
      <label><span>监控开始日期</span><input type="date" value={draft.monitoringStartDate} onChange={(event) => setDraft({ ...draft, monitoringStartDate: event.target.value })} /></label>
      <label><span>跟踪周数</span><input type="number" min={1} max={104} value={draft.trackingWeeks} onChange={(event) => setDraft({ ...draft, trackingWeeks: Number(event.target.value) })} /></label>
      <label><span>每周销量目标（件）</span><input type="number" min={0} step={1} value={draft.weeklyUnitTarget} onChange={(event) => setDraft({ ...draft, weeklyUnitTarget: event.target.value })} /></label>
      <label><span>每周净销售额目标（元）</span><input type="number" min={0} step="0.01" value={draft.weeklySalesTargetYuan} onChange={(event) => setDraft({ ...draft, weeklySalesTargetYuan: event.target.value })} /></label>
      <label className="new-product-line-codes"><span>吉客云货品代码</span><textarea rows={8} value={draft.productCodes} placeholder="每行填写一个代码；货品名称从吉客云主数据读取" onChange={(event) => setDraft({ ...draft, productCodes: event.target.value })} /><small>保存时会校验代码真实存在；后续导入出现名称唯一匹配的新代码会自动补入。</small></label>
      <label className="workflow-checkbox-field"><input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} /><span>继续监控该产品线</span></label>
      {error && <p className="workflow-edit-validation" role="alert">{error}</p>}
      <div className="workflow-modal-actions workflow-edit-actions"><button type="button" className="secondary-button" disabled={saving} onClick={onClose}>取消</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "保存中…" : "保存产品线"}</button></div>
    </form>
  </Dialog>;
}

export default function NewProductSalesFollowupView({ canWrite }: { canWrite: boolean }) {
  const [lines, setLines] = useState<ProductLine[]>([]);
  const [report, setReport] = useState<FollowupReport | null>(null);
  const [config, setConfig] = useState<ReportConfig | null>(null);
  const [weekStart, setWeekStart] = useState(previousMonday);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [learning, setLearning] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [editor, setEditor] = useState<ProductLine | "create" | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [configDraft, setConfigDraft] = useState<ReportConfig | null>(null);

  const load = useCallback(async (targetWeek = weekStart) => {
    setLoading(true); setError("");
    try {
      const [linePayload, reportPayload, configPayload] = await Promise.all([
        requestJson<{ items: ProductLine[] }>("/api/workflow/new-product-lines"),
        requestJson<FollowupReport>(`/api/workflow/new-product-weekly-followup?weekStart=${encodeURIComponent(targetWeek)}`),
        requestJson<{ config: ReportConfig }>("/api/workflow/new-product-weekly-report-config"),
      ]);
      setLines(linePayload.items);
      setReport(reportPayload);
      setConfig(configPayload.config);
      setConfigDraft(configPayload.config);
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
      name: draft.name.trim(), matchTerms, monitoringStartDate: draft.monitoringStartDate,
      trackingWeeks: draft.trackingWeeks,
      weeklyUnitTarget: draft.weeklyUnitTarget === "" ? null : Number(draft.weeklyUnitTarget),
      weeklySalesTargetCents: draft.weeklySalesTargetYuan === "" ? null : Math.round(Number(draft.weeklySalesTargetYuan) * 100),
      active: draft.active, codes,
    };
    try {
      if (editor && editor !== "create") {
        await requestJson(`/api/workflow/new-product-lines/${encodeURIComponent(editor.id)}`, { method: "PATCH", body: { ...payload, expectedVersion: editor.version } });
        setFeedback(`产品线“${payload.name}”已更新。`);
      } else {
        await requestJson("/api/workflow/new-product-lines", { method: "POST", body: payload });
        setFeedback(`产品线“${payload.name}”已创建。`);
      }
      setEditor(null);
      await load();
      await learn(true);
    } finally { setSaving(false); }
  };

  const saveConfig = async () => {
    if (!canWrite || !configDraft || !config || saving) return;
    setSaving(true); setFeedback("");
    try {
      const result = await requestJson<{ config: ReportConfig }>("/api/workflow/new-product-weekly-report-config", {
        method: "PATCH",
        body: {
          enabled: configDraft.enabled,
          targetGroupName: configDraft.targetGroupName,
          robotName: configDraft.robotName,
          sendWeekday: configDraft.sendWeekday,
          sendLocalTime: configDraft.sendLocalTime,
          expectedVersion: config.version,
        },
      });
      setConfig(result.config); setConfigDraft(result.config);
      setFeedback(result.config.enabled ? "新品钉钉周报配置已启用；发送任务按本机时间执行。" : "新品钉钉周报配置已保存并保持停用。");
    } catch (reason) { setFeedback(messageOf(reason, "新品周报配置保存失败。")); }
    finally { setSaving(false); }
  };

  const currentByLine = useMemo(() => new Map(report?.items.map((item) => [item.id, item]) ?? []), [report]);

  return <div className="new-product-followup-view">
    <section className="workflow-toolbar workflow-section-hero launch-followup-hero"><div><span className="eyebrow">NEW PRODUCT WEEKLY SALES</span><h2>上新销售跟进</h2><p>以吉客云货品代码归集销售，由你定义产品线名称；周报周期使用运行机器的本地时间。</p></div><div className="workflow-hero-actions"><span>{report?.timezone ?? "读取本机时区中"}</span><button type="button" className="secondary-button" disabled={learning || !canWrite} onClick={() => void learn()}>{learning ? "学习中…" : "学习新代码"}</button><button type="button" className="primary-button" disabled={!canWrite} onClick={() => setEditor("create")}>＋ 新建产品线</button></div></section>
    {feedback && <div className="workflow-feedback" role="status"><span>i</span><p>{feedback}</p><button type="button" aria-label="关闭提示" onClick={() => setFeedback("")}>×</button></div>}
    <section className="panel launch-followup-controls"><label><span>报告周（星期一）</span><input type="date" value={weekStart} onChange={(event) => setWeekStart(event.target.value)} /></label><button type="button" className="secondary-button" disabled={loading} onClick={() => void load(weekStart)}>刷新周报</button><span>销售数据截至：{report?.dataCutoffDate ?? "暂无"}</span>{report?.dataIncomplete && <strong>本周数据尚未完整</strong>}</section>
    {error && <section className="panel data-state operations-data-state operations-data-state-error" role="alert"><span className="state-symbol">!</span><strong>新品销售跟进加载失败</strong><p>{error}</p><button type="button" className="secondary-button" onClick={() => void load()}>重新加载</button></section>}
    {loading && !report ? <section className="panel data-state operations-data-state"><span className="state-spinner" /><strong>正在生成新品销售周报</strong><p>读取产品线、吉客云代码与销售事实…</p></section> : report && <>
      <section className="launch-followup-summary"><article className="panel"><span>监控产品线</span><strong>{report.summary.lineCount}</strong><small>已销售 {report.summary.sellingCount} · 达标 {report.summary.targetAchievedCount}</small></article><article className="panel"><span>本周净销量</span><strong>{report.summary.netQuantity.toLocaleString("zh-CN")}</strong><small>吉客云代码口径</small></article><article className="panel"><span>本周净销售额</span><strong>{money(report.summary.netSalesCents)}</strong><small>退款 {money(report.summary.refundAmountCents)}</small></article><article className="panel"><span>需要跟进</span><strong>{report.summary.noSalesCount + report.summary.stalledCount}</strong><small>未开单 {report.summary.noSalesCount} · 停滞 {report.summary.stalledCount}</small></article></section>
      <section className="panel"><div className="data-table-wrap"><table className="data-table launch-followup-table"><thead><tr><th>产品线</th><th>吉客云代码</th><th>状态</th><th>本周销量</th><th>本周净销售额</th><th>销售额环比</th><th>毛利</th><th>上新累计</th><th>操作</th></tr></thead><tbody>{lines.map((line) => { const item = currentByLine.get(line.id); return <tr key={line.id}><td><strong>{line.name}</strong><small>{line.monitoringStartDate} 起 · {line.trackingWeeks} 周</small></td><td><strong>{line.codes.filter((code) => code.active).length}</strong><small>{line.codes.filter((code) => code.active).slice(0, 2).map((code) => code.productCode).join("、") || "待补充"}</small></td><td>{item ? <span className={`status followup-${item.status}`}>{statusLabel(item.status)}</span> : "—"}</td><td><strong>{item?.current.netQuantity.toLocaleString("zh-CN") ?? "—"}</strong><small>上周 {item?.previous.netQuantity.toLocaleString("zh-CN") ?? "—"}</small></td><td><strong>{item ? money(item.current.netSalesCents) : "—"}</strong><small>退款 {item ? money(item.current.refundAmountCents) : "—"}</small></td><td className={item?.salesWeekOverWeekRate !== null && Number(item?.salesWeekOverWeekRate) < 0 ? "red-text" : "green-text"}>{rate(item?.salesWeekOverWeekRate ?? null)}</td><td><strong>{item ? money(item.current.grossProfitCents) : "—"}</strong><small>{item?.current.grossMarginRate === null || item?.current.grossMarginRate === undefined ? "—" : `${(item.current.grossMarginRate * 100).toFixed(1)}%`}</small></td><td><strong>{item ? money(item.cumulative.netSalesCents) : "—"}</strong><small>{item?.cumulative.netQuantity.toLocaleString("zh-CN") ?? "—"} 件</small></td><td><div className="launch-followup-actions"><button type="button" className="row-action" onClick={() => setExpanded(expanded === line.id ? null : line.id)}>{expanded === line.id ? "收起代码" : "查看代码"}</button><button type="button" className="row-action" disabled={!canWrite} onClick={() => setEditor(line)}>编辑</button></div></td></tr>; })}{lines.length === 0 && <tr><td colSpan={9}><div className="table-state">尚未建立新品产品线，请先添加产品线名称和吉客云代码。</div></td></tr>}</tbody></table></div>
      {expanded && currentByLine.get(expanded) && <div className="launch-followup-code-detail"><h3>{currentByLine.get(expanded)?.name} · 吉客云代码明细</h3><div>{currentByLine.get(expanded)?.codes.map((code) => <article key={code.productCode}><strong>{code.productCode}</strong><span>{code.productName}</span><small>{code.source === "learned" ? "自动学习" : "手工添加"} · 本周 {code.current.netQuantity} 件 / {money(code.current.netSalesCents)}</small></article>)}</div></div>}
      </section>
      <section className="launch-followup-bottom"><article className="panel launch-followup-message"><header><div><h3>钉钉周报预览</h3><p>真实发送前会再次核验唯一群名、唯一机器人和幂等键。</p></div><span>{report.weekStart} 至 {report.weekEnd}</span></header><pre>{report.messageText}</pre></article>
      {configDraft && <article className="panel launch-followup-config"><header><div><h3>自动发送配置</h3><p>时间使用运行机器当前本地时区。</p></div><span>{configDraft.enabled ? "已启用" : "未启用"}</span></header><label><span>指定群名称</span><input readOnly value={configDraft.targetGroupName} /></label><label><span>机器人名称</span><input readOnly value={configDraft.robotName} /></label><small>按当前系统通知安全边界固定为“志高助手” → “测试群聊”；发送前仍动态校验唯一身份及机器人已入群。</small><div><label><span>发送日</span><select value={configDraft.sendWeekday} onChange={(event) => setConfigDraft({ ...configDraft, sendWeekday: Number(event.target.value) })}>{WEEKDAYS.map((label, index) => <option key={label} value={index}>{label}</option>)}</select></label><label><span>本机时间</span><input type="time" value={configDraft.sendLocalTime} onChange={(event) => setConfigDraft({ ...configDraft, sendLocalTime: event.target.value })} /></label></div>{configDraft.lastDelivery && <small>最近投递：{configDraft.lastDelivery.weekStart} 至 {configDraft.lastDelivery.weekEnd} · {configDraft.lastDelivery.status}{configDraft.lastDelivery.deliveredAt ? ` · ${new Date(configDraft.lastDelivery.deliveredAt).toLocaleString("zh-CN")}` : ""}</small>}<label className="workflow-checkbox-field"><input type="checkbox" checked={configDraft.enabled} onChange={(event) => setConfigDraft({ ...configDraft, enabled: event.target.checked })} /><span>启用每周钉钉同步</span></label><button type="button" className="primary-button" disabled={!canWrite || saving} onClick={() => void saveConfig()}>{saving ? "保存中…" : "保存发送配置"}</button></article>}
      </section>
    </>}
    {editor && <ProductLineEditor key={editor === "create" ? "create" : `${editor.id}-${editor.version}`} line={editor === "create" ? null : editor} saving={saving} onClose={() => setEditor(null)} onSave={saveLine} />}
  </div>;
}
