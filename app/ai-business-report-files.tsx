"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { businessFileJson as api, downloadBusinessFile, type BusinessFileRun } from "@/lib/ai/business-file-download";

const states: Record<string, string> = { queued: "等待生成", building: "生成中", paused: "已暂停", ready: "可下载", cancelled: "已取消" };
const stages: Record<string, string> = { preparing: "整理完整明细", rendering: "生成双文件", saving: "保存文件", verifying: "校验完整性", ready: "文件已就绪" };

export default function AiBusinessReportFiles({ reportId, allowFormal }: { reportId: string; allowFormal: boolean }) {
  const [items, setItems] = useState<BusinessFileRun[]>([]);
  const [readError, setReadError] = useState("");
  const [writeError, setWriteError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const live = useRef(true);
  const read = useRef<AbortController | null>(null), write = useRef<AbortController | null>(null), download = useRef<AbortController | null>(null);
  const base = "/api/ai/reports/"+reportId+"/files";
  const load = useCallback(async (force = false) => {
    if (read.current && !force) return;
    read.current?.abort();
    const controller = new AbortController();
    read.current = controller;
    const current = () => live.current && read.current === controller && !controller.signal.aborted;
    try {
      const data = await api<{ items: BusinessFileRun[] }>(base, {}, { signal: controller.signal });
      if (!Array.isArray(data.items)) throw new Error("文件状态响应无效");
      if (current()) { setItems(data.items); setReadError(""); }
    } catch (error) { if (current()) setReadError(error instanceof Error ? error.message : "文件状态读取失败"); }
    finally { if (read.current === controller) read.current = null; }
  }, [base]);
  useEffect(() => {
    live.current = true;
    void load(true);
    return () => { live.current = false; read.current?.abort(); read.current = null; write.current?.abort(); download.current?.abort(); };
  }, [load]);
  const running = items.some(item => ["queued", "building"].includes(item.status));
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [load, running]);
  async function mutate(url: string, body: unknown) {
    setBusy(true); setWriteError(""); setNotice("");
    write.current = new AbortController();
    try {
      await api(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, { signal: write.current.signal });
      if (live.current) { setNotice("任务已保存，后台会继续处理。"); await load(true); }
    } catch (error) { if (live.current) setWriteError(error instanceof Error ? error.message : "文件操作失败，请刷新查看状态"); }
    finally { if (live.current) setBusy(false); }
  }
  async function save(item: BusinessFileRun, format: "html" | "xlsx") {
    setProgress(0); setWriteError(""); setNotice("");
    download.current = new AbortController();
    try {
      const result = await downloadBusinessFile(item.id, format, { signal: download.current.signal, onProgress: (received, total) => { if (live.current) setProgress(Math.floor(received/total*100)); } });
      if (!live.current) return;
      const url = URL.createObjectURL(result.blob), anchor = document.createElement("a");
      anchor.href = url; anchor.download = result.fileName; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("文件已校验，下载已开始。");
    } catch (error) { if (live.current) setWriteError(download.current.signal.aborted ? "下载已取消，可再次下载已保存的文件。" : error instanceof Error ? error.message : "下载失败"); }
    finally { if (live.current) setProgress(null); }
  }
  const disabled = busy || progress !== null;
  return <section className="report-review" aria-label="完整经营报告文件"><h4>完整报告文件</h4><p className="report-note">HTML 与 Excel 包含同一份封存证据、诊断及明细。生成无需保持网页打开，下载前会校验完整文件。</p>
    {readError && <p role="alert">{readError}</p>}{writeError && <p role="alert">{writeError}</p>}{notice && <p role="status">{notice}</p>}
    <div className="report-actions"><button disabled={disabled} onClick={() => void mutate(base, { draft: true })}>生成双文件草稿</button>{allowFormal && <button className="primary-button" disabled={disabled} onClick={() => void mutate(base, { draft: false })}>生成已复核双文件</button>}<button disabled={busy} onClick={() => void load()}>刷新文件状态</button></div>
    {progress !== null && <p role="status">下载校验 {progress}% <button onClick={() => download.current?.abort()}>取消下载</button></p>}
    {items.map(item => <div className="report-review" key={item.id}><p><strong>{item.draft ? "草稿" : "已复核报告"}</strong> · {states[item.status] ?? item.status} · {stages[item.progress.stage ?? ""] ?? ""}{item.progress.table ? ` · 第 ${item.progress.table} 张表` : ""}{item.progress.rows ? ` · ${item.progress.rows} 行` : ""}</p>
      {item.errorCode && <p className="report-note">生成已暂停，错误标识：{item.errorCode}。恢复会优先核验已完整保存的文件；重新构建会保留旧记录。</p>}
      <div className="report-actions">{item.status === "ready" && <><button className="primary-button" disabled={disabled} onClick={() => void save(item, "html")}>下载 HTML</button><button disabled={disabled} onClick={() => void save(item, "xlsx")}>下载 Excel</button></>}
        {["queued", "building"].includes(item.status) && <button disabled={disabled} onClick={() => void mutate(`/api/ai/business-files/${item.id}/control`, { action: "pause", expectedVersion: item.version })}>暂停生成</button>}
        {item.status === "paused" && <><button disabled={disabled} onClick={() => void mutate(`/api/ai/business-files/${item.id}/control`, { action: "resume", expectedVersion: item.version })}>恢复生成</button><button disabled={disabled} onClick={() => void mutate(`/api/ai/business-files/${item.id}/control`, { action: "rebuild", expectedVersion: item.version })}>重新构建</button></>}
        {!["ready", "cancelled"].includes(item.status) && <button disabled={disabled} onClick={() => void mutate(`/api/ai/business-files/${item.id}/control`, { action: "cancel", expectedVersion: item.version })}>取消生成任务</button>}</div>
    </div>)}
  </section>;
}
