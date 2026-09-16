"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { businessFileJson as api, businessFilePrincipal, businessVolumeManifest, downloadBusinessFile, downloadBusinessVolume, type BusinessFileRun, type BusinessVolumeManifest, type BusinessVolumeFile } from "@/lib/ai/business-file-download";

const states: Record<string, string> = { queued: "等待生成", building: "生成中", paused: "已暂停", ready: "可下载", cancelled: "已取消" };
const stages: Record<string, string> = { preparing: "整理完整明细", preparing_volume: "准备分卷", rendering: "生成文件", rendering_volume: "生成分卷", saving: "保存文件", verifying: "校验完整性", verifying_volume_file: "校验分卷文件", verifying_complete_delivery: "校验完整多卷交付", ready: "文件已就绪" };

export default function AiBusinessReportFiles({ reportId, allowFormal, volumeMode = false }: { reportId: string; allowFormal: boolean; volumeMode?: boolean }) {
  const [items, setItems] = useState<BusinessFileRun[]>([]);
  const [directories, setDirectories] = useState<Record<string, { version: number; binding: string; manifest: BusinessVolumeManifest }>>({});
  const [principalKey, setPrincipalKey] = useState("");
  const [readError, setReadError] = useState("");
  const [writeError, setWriteError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const live = useRef(true);
  const actor = useRef("");
  const read = useRef<AbortController | null>(null), write = useRef<AbortController | null>(null), download = useRef<AbortController | null>(null);
  const base = "/api/ai/reports/"+reportId+"/files";
  const principal = useCallback((key: string) => {
    const changed = Boolean(actor.current && actor.current !== key);
    if (changed) {
      write.current?.abort(); write.current = null; download.current?.abort(); download.current = null;
      setItems([]); setDirectories({}); setBusy(false); setProgress(null); setNotice("");
      setWriteError("账号已变化，已停止操作并清空原账号文件，请重新查看报告。");
    }
    actor.current = key; setPrincipalKey(key);
    return !changed;
  }, []);
  const load = useCallback(async (force = false) => {
    if (read.current && !force) return;
    read.current?.abort();
    const controller = new AbortController();
    read.current = controller;
    const current = () => live.current && read.current === controller && !controller.signal.aborted;
    try {
      const key = await businessFilePrincipal({ signal: controller.signal });
      if (!current()) return;
      principal(key);
      const data = await api<{ items: BusinessFileRun[] }>(base, {}, { signal: controller.signal });
      if (!Array.isArray(data.items) || data.items.some(item => item.reportId !== reportId)) throw new Error("文件状态响应无效");
      if (current() && actor.current === key) {
        setItems(data.items); setReadError("");
        setDirectories(previous => Object.fromEntries(Object.entries(previous).filter(([id, value]) => data.items.some(item => item.id === id && item.version === value.version && item.bindingDigest === value.binding))));
      }
    } catch (error) { if (current()) { setReadError(error instanceof Error ? error.message : "文件状态读取失败"); setItems([]); setDirectories({}); } }
    finally { if (read.current === controller) read.current = null; }
  }, [base, principal, reportId]);
  useEffect(() => {
    live.current = true;
    actor.current = ""; setPrincipalKey(""); setItems([]); setDirectories({}); setBusy(false); setProgress(null); setReadError(""); setWriteError(""); setNotice("");
    void load(true);
    const focus = () => void load(true);
    window.addEventListener("focus", focus);
    return () => { live.current = false; read.current?.abort(); read.current = null; write.current?.abort(); write.current = null; download.current?.abort(); download.current = null; window.removeEventListener("focus", focus); };
  }, [load]);
  const running = items.some(item => ["queued", "building"].includes(item.status));
  useEffect(() => {
    const timer = window.setInterval(() => void load(), running ? 5000 : 15000);
    return () => window.clearInterval(timer);
  }, [load, running]);
  async function mutate(url: string, body: unknown) {
    if (write.current || download.current || !actor.current) return;
    const key = actor.current, controller = new AbortController(); write.current = controller;
    const current = () => live.current && write.current === controller && actor.current === key && !controller.signal.aborted;
    setBusy(true); setWriteError(""); setNotice("");
    try {
      const identity = await businessFilePrincipal({ signal: controller.signal });
      if (!current() || !principal(identity)) return;
      await api(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, { signal: controller.signal });
      if (current()) { setNotice("任务已保存，后台会继续处理。"); await load(true); }
    } catch (error) { if (current()) setWriteError((error instanceof Error ? error.message : "文件操作失败")+"；如提交结果未知，请刷新列表确认后操作。"); }
    finally { if (write.current === controller) { write.current = null; if (live.current && actor.current === key) setBusy(false); } }
  }
  async function directory(item: BusinessFileRun) {
    if (write.current || download.current || !actor.current) return;
    const key = actor.current, controller = new AbortController(); write.current = controller;
    const current = () => live.current && write.current === controller && actor.current === key && !controller.signal.aborted;
    setBusy(true); setWriteError("");
    try {
      const identity = await businessFilePrincipal({ signal: controller.signal });
      if (!current() || !principal(identity)) return;
      const result = await api<{ item: BusinessFileRun }>(`/api/ai/business-files/${item.id}`, {}, { signal: controller.signal });
      const manifest = businessVolumeManifest(result.item, item.id);
      if (result.item.reportId !== reportId || result.item.version !== item.version || result.item.bindingDigest !== item.bindingDigest) throw new Error("文件任务已变化，请刷新列表。");
      if (current()) setDirectories(previous => ({ ...previous, [item.id]: { version: item.version, binding: item.bindingDigest, manifest } }));
    } catch (error) { if (current()) setWriteError(error instanceof Error ? error.message : "分卷列表读取失败"); }
    finally { if (write.current === controller) { write.current = null; if (live.current && actor.current === key) setBusy(false); } }
  }
  async function save(item: BusinessFileRun, format: BusinessVolumeFile["format"], volumeIndex?: number) {
    if (write.current || download.current || !actor.current) return;
    const key = actor.current, controller = new AbortController(); download.current = controller;
    const current = () => live.current && download.current === controller && actor.current === key && !controller.signal.aborted;
    setProgress(0); setWriteError(""); setNotice("");
    try {
      const identity = await businessFilePrincipal({ signal: controller.signal });
      if (!current() || !principal(identity)) return;
      const options = { signal: controller.signal, onProgress: (received: number, total: number) => { if (current()) setProgress(Math.floor(received/total*100)); } };
      const result = item.rendererVersion === 4
        ? await downloadBusinessVolume(item.id, volumeIndex!, format, { ...options, expectedPrincipalKey: key })
        : format !== "json" ? await downloadBusinessFile(item.id, format, options) : null;
      if (!result || !current()) return;
      const finalIdentity = await businessFilePrincipal({ signal: controller.signal });
      if (!current() || !principal(finalIdentity)) return;
      const url = URL.createObjectURL(result.blob), anchor = document.createElement("a");
      anchor.href = url; anchor.download = result.fileName; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("所选文件已校验，下载已开始。");
    } catch (error) { if (live.current && download.current === controller && actor.current === key) setWriteError(controller.signal.aborted ? "下载已取消，可再次下载已保存的文件。" : error instanceof Error ? error.message : "下载失败"); }
    finally { if (download.current === controller) { download.current = null; if (live.current && actor.current === key) setProgress(null); } }
  }
  const disabled = busy || progress !== null || !principalKey;
  const createBody = (draft: boolean) => volumeMode ? { deliveryMode: "volumes", draft, expectedPrincipalKey: principalKey } : { draft };
  return <section className="report-review" aria-label="完整经营报告文件"><h4>完整报告文件</h4><p className="report-note">HTML 与 Excel 包含同一份封存证据、诊断及明细。生成无需保持网页打开，下载前会校验完整文件。</p>
    {readError && <p role="alert">{readError}</p>}{writeError && <p role="alert">{writeError}</p>}{notice && <p role="status">{notice}</p>}
    {volumeMode && <p className="report-note">多卷报告须保留完整交付清单及各卷；单卷只含其中一部分表。请选择单个文件下载。</p>}
    <div className="report-actions"><button disabled={disabled} onClick={() => void mutate(base, createBody(true))}>{volumeMode ? "生成多卷草稿" : "生成双文件草稿"}</button>{allowFormal && <button className="primary-button" disabled={disabled} onClick={() => void mutate(base, createBody(false))}>{volumeMode ? "生成已复核多卷文件" : "生成已复核双文件"}</button>}<button disabled={busy} onClick={() => void load()}>刷新文件状态</button></div>
    {progress !== null && <p role="status">下载校验 {progress}% <button onClick={() => download.current?.abort()}>取消下载</button></p>}
    {items.map(item => <div className="report-review" key={item.id}><p><strong>{item.draft ? "草稿" : "已复核报告"}</strong> · {states[item.status] ?? item.status} · {stages[item.progress.stage ?? ""] ?? ""}{item.progress.table ? ` · 第 ${item.progress.table} 张表` : ""}{item.progress.rows ? ` · ${item.progress.rows} 行` : ""}</p>
      {item.errorCode && <p className="report-note">生成已暂停，错误标识：{item.errorCode}。恢复会优先核验已完整保存的文件；重新构建会保留旧记录。</p>}
      <div className="report-actions">{item.status === "ready" && (item.rendererVersion === 4 ? <button disabled={disabled} onClick={() => void directory(item)}>查看分卷文件</button> : <><button className="primary-button" disabled={disabled} onClick={() => void save(item, "html")}>下载 HTML</button><button disabled={disabled} onClick={() => void save(item, "xlsx")}>下载 Excel</button></>)}
        {["queued", "building"].includes(item.status) && <button disabled={disabled} onClick={() => void mutate(`/api/ai/business-files/${item.id}/control`, { action: "pause", expectedVersion: item.version })}>暂停生成</button>}
        {item.status === "paused" && <><button disabled={disabled} onClick={() => void mutate(`/api/ai/business-files/${item.id}/control`, { action: "resume", expectedVersion: item.version })}>恢复生成</button><button disabled={disabled} onClick={() => void mutate(`/api/ai/business-files/${item.id}/control`, { action: "rebuild", expectedVersion: item.version })}>重新构建</button></>}
        {!["ready", "cancelled"].includes(item.status) && <button disabled={disabled} onClick={() => void mutate(`/api/ai/business-files/${item.id}/control`, { action: "cancel", expectedVersion: item.version })}>取消生成任务</button>}</div>
      {directories[item.id] && <div aria-label="分卷文件列表"><p>共 {directories[item.id].manifest.volumeCount} 卷；请逐个选择需要的文件。</p><button disabled={disabled} onClick={() => void save(item, "json", 0)}>下载完整交付清单 JSON</button><ul>{directories[item.id].manifest.files.map(file => <li key={`${file.volumeIndex}:${file.format}`}><button disabled={disabled} onClick={() => void save(item, file.format, file.volumeIndex)}>第 {file.volumeIndex} 卷 · {file.format === "html" ? "HTML" : "Excel"}（{(file.bytes/1024/1024).toFixed(2)} MiB）</button></li>)}</ul></div>}
    </div>)}
  </section>;
}
