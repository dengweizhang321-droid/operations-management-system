"use client";

import { useEffect, useRef, useState } from "react";

type Model = { id: string; name: string; version: number };
type Method = { id: string; name: string; kind: "library_guidance" | "bundled"; version: string | number; digest: string };
type Options = { models: Model[]; methods: Method[]; firstScenario: { platform: string; shop: string } };
type Task = { id: string; name: string; revision: number; version: number; enabled: boolean };
type Page = { items: Task[]; nextCursor: string | null };
type Detail = { item: Task & { spec: { prompt: string; trigger: { kind: string; hour?: number; minute?: number } } };
  readiness: { ready: boolean; blockers: string[] } };

const labels: Record<string, string> = {
  long_term_authorization_missing: "缺少长期执行授权", recurring_cost_authorization_not_bound: "未绑定周期费用授权",
  unified_pi_executor_not_adopted: "正式执行器尚未采用", trusted_dependency_reader_not_bound: "数据依赖读取器尚未绑定",
  library_guidance_is_not_pi_runtime_skill: "此方法来自报告资源库", principal_and_delivery_binding_not_bound: "未绑定投递对象",
  model_version_changed: "模型版本已变化", trusted_trigger_adapter_not_bound: "触发来源尚未准入",
};

class TaskRequestError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch("/api/ai/pi/" + path, { cache: "no-store", ...init });
  const data = await response.json();
  if (!response.ok) throw new TaskRequestError(response.status, data.code || "", data.error || "任务请求失败");
  return data as T;
}

export function dailyDraft(options: Options, method: Method, model: Model, time: string, id: string) {
  const [hour, minute] = time.split(":").map(Number);
  const shop = options.firstScenario.shop;
  return { clientRequestId: id, name: shop + "经营日报", spec: {
    skill: { kind: method.kind, id: method.id, version: method.version, digest: method.digest },
    prompt: "核对上一完整日的经营日报。ERP 销售仅列所选店铺；库存另列全部计入库存的仓。缺少来源时等待或记录缺口，不用榜单替代。",
    shopSelection: options.firstScenario, modelId: model.id, modelVersion: model.version,
    trigger: { kind: "time", timezone: "Asia/Shanghai", cadence: "daily", hour, minute, day: 1, windowSeconds: 3600 },
    dataDependencies: [
      { dataset: "erp_shop_sales", dayOffset: 1, requiredFields: ["sales_amount_cents", "quantity"] },
      { dataset: "inventory_included_warehouses", dayOffset: 1, requiredFields: ["included_warehouse_quantity"] },
    ],
    deliveryTargets: [], missedPolicy: "wait_for_data_until_deadline", parameters: {},
  } };
}

export default function AiDailyTaskDrafts({ owner }: { owner: string }) {
  const storageKey = "ai-daily-draft-v1:" + owner;
  const [open, setOpen] = useState(false), [revision, setRevision] = useState(0);
  const [cursor, setCursor] = useState(""), [page, setPage] = useState<Page | null>(null);
  const [options, setOptions] = useState<Options | null>(null), [selected, setSelected] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [methodKey, setMethodKey] = useState(""), [modelId, setModelId] = useState(""), [time, setTime] = useState("09:00");
  const [pending, setPending] = useState(""), [busy, setBusy] = useState(false), sending = useRef(false);
  const [notice, setNotice] = useState(""), [error, setError] = useState("");
  const [saveError, setSaveError] = useState(""), [optionsError, setOptionsError] = useState("");

  useEffect(() => {
    if (!open) return;
    let current = true;
    setError(""); setPage(null); setOptions(null);
    try { setPending(sessionStorage.getItem(storageKey) || ""); }
    catch { setError("浏览器无法保存请求标识，暂时无法创建草稿。"); }
    setOptionsError("");
    api<{ draftOptions: Options }>("task-connectors?draftOptions=1")
      .then(opts => { if (current) setOptions(opts.draftOptions); })
      .catch(e => { if (current) setOptionsError(e.message); });
    api<Page>("task-definitions?limit=20" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""))
      .then(rows => { if (current) setPage(rows); }).catch(e => { if (current) setError(e.message); });
    return () => { current = false; };
  }, [open, storageKey, revision, cursor]);

  useEffect(() => {
    let current = true;
    setDetail(null);
    if (open && selected) api<Detail>("task-definitions/" + encodeURIComponent(selected))
      .then(value => { if (current) setDetail(value); }).catch(e => { if (current) setError(e.message); });
    return () => { current = false; };
  }, [open, selected, revision]);

  const method = options?.methods.find(item => item.kind + ":" + item.id === methodKey);
  const model = options?.models.find(item => item.id === modelId);
  async function save() {
    if (sending.current || (!pending && !options)) return;
    if (!pending && (!method || !model || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) return;
    sending.current = true; setBusy(true); setSaveError(""); setNotice("");
    try {
      let raw = sessionStorage.getItem(storageKey);
      if (!raw) {
        if (!options || !method || !model) return;
        raw = JSON.stringify(dailyDraft(options, method, model, time, crypto.randomUUID()));
        sessionStorage.setItem(storageKey, raw);
      }
      setPending(raw);
      const result = await api<{ item: Task }>("task-definitions", {
        method: "POST", headers: { "content-type": "application/json" }, body: raw,
      });
      sessionStorage.removeItem(storageKey); setPending(""); setSelected(result.item.id); setCursor("");
      setRevision(v => v + 1); setNotice("停用草稿已保存。");
    } catch (e) {
      // The server checks ownership before looking up an old request ID. A
      // denied account cannot establish whether an earlier attempt committed.
      if (e instanceof TaskRequestError && ((e.status === 400 && e.code === "invalid_request")
          || (e.status === 409 && e.code === "version_conflict") || e.status === 413)) {
        try { sessionStorage.removeItem(storageKey); setPending(""); }
        catch { /* The pending ID is still safe to retry when storage returns. */ }
        setRevision(v => v + 1);
      }
      setSaveError(e instanceof Error ? e.message : "保存失败");
    }
    finally { setBusy(false); sending.current = false; }
  }

  return <section className="panel ai-admin-card">
    <div className="section-header"><div><h3>经营日报任务草稿</h3><p>京东志高商用设备旗舰店 · ERP 销售按店，库存按计入库存的仓单列。</p></div>
      <button type="button" className="secondary-button" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "收起" : "管理草稿"}</button></div>
    {open && <>
      {error && <p role="alert">{error}</p>}{optionsError && <p role="alert">方法或模型目录暂不可用：{optionsError}</p>}{saveError && <p role="alert">{saveError}</p>}{notice && <p role="status">{notice}</p>}
      <div className="ai-config-form"><label>已发布方法<select disabled={!!pending || busy} value={methodKey} onChange={e => setMethodKey(e.target.value)}>
        <option value="">请选择方法及版本</option>{options?.methods.map(x => <option key={x.kind + ":" + x.id} value={x.kind + ":" + x.id}>{x.name} · {x.version} · {x.kind === "bundled" ? "Pi 技能" : "报告方法"}</option>)}</select></label>
        <label>模型<select disabled={!!pending || busy} value={modelId} onChange={e => setModelId(e.target.value)}><option value="">请选择模型及版本</option>{options?.models.map(x => <option value={x.id} key={x.id}>{x.name} · v{x.version}</option>)}</select></label>
        <label>计划时间（上海）<input type="time" value={time} disabled={!!pending || busy} onChange={e => setTime(e.target.value)}/></label>
        <button type="button" className="secondary-button" disabled={busy || (!pending && (!options || !method || !model || !time))} onClick={() => void save()}>{pending ? "重试原保存请求" : "保存停用草稿"}</button>
      </div>
      {pending && <p role="status">已保留原保存请求，重试会使用同一标识。</p>}
      {options && (!options.methods.length || !options.models.length) && <p>保存草稿需要可用模型和已发布的方法，请先在 AI 管理中配置。</p>}
      <p>草稿不会触发定时、模型调用或投递。</p>
      {page && (page.items.length ? <ul>{page.items.map(x => <li key={x.id}><button className="text-button" type="button" onClick={() => setSelected(x.id)}>{x.name} · 修订 {x.revision}</button>　{x.enabled ? "已启用" : "已停用"}</li>)}</ul> : <p>暂无任务草稿。</p>)}
      {cursor && <button type="button" className="text-button" onClick={() => setCursor("")}>返回首页</button>}
      {page?.nextCursor && <button type="button" className="text-button" onClick={() => setCursor(page.nextCursor!)}>下一页</button>}
      {detail && <div><h4>{detail.item.name} · 修订 {detail.item.revision}</h4><p>{detail.item.spec.prompt}</p>
        <p>启用条件：{detail.readiness.blockers.map(x => labels[x] || x).join("、") || "已满足"}</p></div>}
    </>}
  </section>;
}
