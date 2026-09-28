"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import "./database-backups.css";

type Backup = { backupId: string; completedAt: string; sizeBytes: number; manifestSha256: string; protected: boolean };
type Result = { backupId?: string; uploadId?: string; downloadId?: string; sizeBytes?: number; isolatedRestoreVerified?: boolean; retention?: { status?: string }; releaseRetention?: { status: string } };
type Job = { id: string; action: string; status: string; createdAt: number; result?: Result; error?: string };
type Snapshot = { enabled: boolean; items: Backup[]; jobs: Job[]; uploads: Array<{ id: string; sizeBytes: number; status: string }>; invalidBackupIds: string[]; uploadChunkBytes: number; maximumArchiveBytes: number };
type Writable = { write(data: Uint8Array): Promise<void>; close(): Promise<void>; abort(): Promise<void> };
type SavePicker = (options: { suggestedName: string }) => Promise<{ createWritable(): Promise<Writable> }>;
const endpoint = "/api/access-control/backups";
const names: Record<string, string> = { backup: "创建备份", export: "导出备份", "verify-import": "导入校验", rehearse: "隔离恢复验证", protect: "保护恢复点", unprotect: "解除保护", retention: "清理过期备份" };
const statuses: Record<string, string> = { queued: "等待执行", running: "处理中", completed: "已完成", failed: "失败", unknown: "结果待核查" };
const newId = () => crypto.randomUUID().replaceAll("-", "");
const sizeText = (bytes: number) => `${(bytes / 1024 ** 2).toFixed(1)} MB`;
const dateText = (value: string | number) => new Date(typeof value === "number" ? value * 1000 : value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
class ApiFailure extends Error { constructor(message: string, readonly rejected: boolean) { super(message); } }

async function api<T>(payload?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const response = await fetch(endpoint, { method: payload ? "POST" : "GET", cache: "no-store", signal,
    ...(payload ? { headers: { "content-type": "application/json" }, body: JSON.stringify(payload) } : {}) });
  const data = await response.json();
  if (!response.ok) throw new ApiFailure(data.error || "备份操作失败", response.status >= 400 && response.status < 500);
  return data as T;
}

async function sha256(bytes: Uint8Array) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource)), (b) => b.toString(16).padStart(2, "0")).join("");
}

export default function DatabaseBackups({ canManage }: { canManage: boolean }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [trusted, setTrusted] = useState(false);
  const [uploadId, setUploadId] = useState("");
  const generation = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const transfer = useRef<AbortController | null>(null);
  // Retain the exact request after an ambiguous response; retry never creates a new job.
  const pending = useRef<Record<string, unknown> | null>(null);
  const [hasPending, setHasPending] = useState(false);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    try {
      const data = await api<Snapshot>(undefined, controller.signal);
      if (current === generation.current && !controller.signal.aborted) setSnapshot(data);
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "读取失败");
    }
  }, []);
  useEffect(() => {
    if (!canManage) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => { window.clearInterval(timer); abort.current?.abort(); transfer.current?.abort(); };
  }, [canManage, refresh]);

  async function job(action: string, target = "", manifestSha256 = "") {
    setBusy(true); setError("");
    const payload = pending.current ?? { operation: "job", id: newId(), action, target, manifestSha256 };
    pending.current = payload; setHasPending(true);
    try {
      await api(payload);
      pending.current = null; setHasPending(false);
      setProgress("任务已提交，可在下方查看进度。关闭页面不会重复执行。");
      await refresh();
    } catch (reason) {
      if (reason instanceof ApiFailure && reason.rejected) { pending.current = null; setHasPending(false); }
      setError(`${reason instanceof Error ? reason.message : "提交未确认"}${pending.current ? "。重试会核对原任务编号。" : ""}`);
    }
    finally { setBusy(false); }
  }

  async function upload() {
    if (!file || !snapshot || !trusted) return;
    if (file.size > snapshot.maximumArchiveBytes) { setError("备份包超过 8 GiB 上限"); return; }
    setBusy(true); setError("");
    const id = uploadId || newId();
    setUploadId(id);
    const controller = new AbortController(); transfer.current = controller;
    try {
      const initial = await api<{ offset: number }>({ operation: "upload-start", id, sizeBytes: file.size }, controller.signal);
      for (let offset = initial.offset; offset < file.size;) {
        const bytes = new Uint8Array(await file.slice(offset, offset + snapshot.uploadChunkBytes).arrayBuffer());
        let text = "";
        for (let index = 0; index < bytes.length; index += 8192) text += String.fromCharCode(...bytes.subarray(index, index + 8192));
        const result = await api<{ offset: number }>({ operation: "upload-chunk", id, offset, data: btoa(text), sha256: await sha256(bytes) }, controller.signal);
        if (result.offset !== offset + bytes.length) throw new Error("上传回执偏移不一致");
        offset = result.offset;
        setProgress(`上传 ${Math.floor(offset / file.size * 100)}% · ${sizeText(offset)} / ${sizeText(file.size)}`);
      }
      await job("verify-import", id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "上传失败"); }
    finally { setBusy(false); }
  }

  async function download(item: Job) {
    const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
    if (!picker) { setError("请使用支持保存文件的 Chrome 或 Edge 安全连接打开系统后下载。"); return; }
    let output: Writable | undefined;
    const controller = new AbortController(); transfer.current = controller;
    try {
      const handle = await picker.call(window, { suggestedName: `${item.result?.backupId || item.id}.zip` });
      output = await handle.createWritable();
      setBusy(true); setError("");
      const total = item.result?.sizeBytes ?? 0;
      for (let offset = 0; offset < total;) {
        const response = await fetch(`${endpoint}?downloadId=${item.id}&offset=${offset}`, { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "下载失败");
        const bytes = Uint8Array.from(atob(data.data), (c) => c.charCodeAt(0));
        if (data.offset !== offset || data.sizeBytes !== total || data.nextOffset !== offset + bytes.length || !bytes.length || await sha256(bytes) !== data.sha256) throw new Error("下载分块校验失败");
        await output.write(bytes); offset = data.nextOffset;
        setProgress(`下载 ${Math.floor(offset / total * 100)}%`);
      }
      await output.close(); output = undefined; setProgress("备份包已保存。");
    } catch (reason) {
      await output?.abort();
      setError(reason instanceof Error ? reason.message : "下载失败");
    } finally { setBusy(false); }
  }

  if (!canManage) return <section className="panel data-state"><strong>仅管理员可管理数据库备份</strong><p>需要管理员角色且数据范围不受限。</p></section>;
  const active = snapshot?.jobs.some((item) => ["queued", "running", "unknown"].includes(item.status));
  const disabled = busy || !!active || !snapshot?.enabled || hasPending;
  return <div className="settings-backups">
    <section className="panel" style={{ padding: 24 }}>
      <div className="section-header"><div><h2>数据库备份</h2><p>E 盘最多保留 3 个完整恢复点，受保护备份占用名额。新备份验证成功后再清理旧份。</p></div>
        <button className="primary-button" disabled={disabled} onClick={() => void job("backup")}>立即备份</button></div>
      {snapshot && !snapshot.enabled && <p role="status">备份管理尚待受控上线启用，当前生产备份规则保持原状态。</p>}
      {error && <p className="inventory-feedback-error" role="alert">{error}</p>}
      {progress && <p role="status">{progress}</p>}
      {hasPending && <button className="secondary-button" disabled={busy} onClick={() => void job("")}>核对原请求</button>}
      {snapshot?.invalidBackupIds.length ? <p role="alert">有 {snapshot.invalidBackupIds.length} 份备份校验异常，暂停清理并核查。</p> : null}
      <div className="backup-table-scroll"><table><thead><tr><th>备份时间</th><th>大小</th><th>恢复点</th><th>操作</th></tr></thead><tbody>
        {snapshot?.items.map((item) => <tr key={item.backupId}><td>{dateText(item.completedAt)}</td><td>{sizeText(item.sizeBytes)}</td><td><span>{item.protected ? "已保护" : "自动轮换"}</span><br /><small>{item.backupId}</small></td>
          <td><button className="secondary-button" disabled={disabled} onClick={() => void job("export", item.backupId, item.manifestSha256)}>导出</button>{" "}
            <button className="secondary-button" disabled={disabled} onClick={() => {
              if (item.protected && !window.confirm("解除后，该恢复点可能在下次备份时被淘汰。确认已不再需要它用于迁移回退？")) return;
              void job(item.protected ? "unprotect" : "protect", item.backupId, item.manifestSha256);
            }}>{item.protected ? "解除保护" : "保护"}</button></td></tr>)}
      </tbody></table></div>
      {snapshot && !snapshot.items.length && <p>还没有归档恢复点。</p>}
    </section>
    <section className="panel" style={{ padding: 24, marginTop: 16 }}>
      <h2>导入备份包</h2><p>选择系统导出的 ZIP 备份包。上传后先校验，再按需进行隔离恢复验证；生产数据库恢复须另外确认维护窗口。</p>
      <input aria-label="选择数据库备份包" type="file" accept=".zip" disabled={busy || !!uploadId} onChange={(event) => { setFile(event.target.files?.[0] ?? null); setTrusted(false); }} />
      <label style={{ display: "block", margin: "12px 0" }}><input type="checkbox" checked={trusted} disabled={busy} onChange={(event) => setTrusted(event.target.checked)} /> 我确认这是本人可信来源的系统备份</label>
      <button className="primary-button" disabled={disabled || !file || !trusted} onClick={() => void upload()}>{uploadId ? "继续上传并校验" : "上传并校验"}</button>{" "}
      {uploadId && <button className="secondary-button" disabled={busy || !!active} onClick={() => {
        void api({ operation: "discard-upload", id: uploadId }).then(() => { setUploadId(""); setFile(null); setProgress("导入临时文件已清理。"); }).catch((reason: Error) => setError(reason.message));
      }}>清理导入文件</button>}
      {snapshot?.uploads?.filter((item) => item.id !== uploadId).map((item) => <p key={item.id}>
        待处理导入 · {sizeText(item.sizeBytes)} · {item.status === "sealed" ? "已封存" : "上传未完成"}{" "}
        <button className="secondary-button" disabled={busy || !!active} onClick={() => {
          void api({ operation: "discard-upload", id: item.id }).then(refresh).catch((reason: Error) => setError(reason.message));
        }}>清理临时文件</button>
      </p>)}
    </section>
    <section className="panel" style={{ padding: 24, marginTop: 16 }}><h2>最近任务</h2><p>保留原任务编号，失败或结果未知时不会自动重放。</p>
      {snapshot?.jobs.map((item) => <div key={item.id} style={{ padding: "12px 0", borderBottom: "1px solid var(--color-border)" }}>
        <strong>{names[item.action] || item.action} · {statuses[item.status] || item.status}</strong>{" "}<small>{dateText(item.createdAt)}</small>
        {item.error && <p role="alert">{item.error}</p>}
        {item.status === "completed" && item.result?.downloadId && <button className="secondary-button" disabled={busy} onClick={() => void download(item)}>保存备份包</button>}
        {item.status === "completed" && item.action === "verify-import" && <button className="secondary-button" disabled={disabled} onClick={() => void job("rehearse", item.result?.uploadId)}>隔离恢复验证</button>}
        {item.result?.isolatedRestoreVerified && <p>隔离恢复验证通过。生产数据尚未恢复，等待确认具体恢复点和维护窗口。</p>}
        {item.result?.retention?.status === "blocked" && <p role="alert">数据库备份已生成并保留，E 盘归档或轮换未完成，请查看运维回执；不要重复生成或手动删除旧备份。</p>}
        {item.result?.releaseRetention?.status === "blocked" && <p role="alert">数据库备份已完成，发布包清理未完成，需核查版本保护或当前发布任务。</p>}
      </div>)}
    </section>
  </div>;
}
