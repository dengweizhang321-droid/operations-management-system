"use client";

import { useRef, useState } from "react";
import Dialog from "./ui/dialog";
import type { JdLogisticsDepartment, JdMonitorWarehouse, JdWarehousePreference } from "@/lib/inventory/jd-logistics-contract";

export default function JdMonitorWarehouseSettings({ department, warehouses, saving, onClose, onSave }: {
  department: JdLogisticsDepartment; warehouses: JdMonitorWarehouse[]; saving: boolean;
  onClose: () => void; onSave: (rows: JdWarehousePreference[]) => Promise<void>;
}) {
  const [rows, setRows] = useState(() => {
    const configured = department.warehousePreferences ?? [];
    const known = new Set(configured.map(row => row.warehouseKey));
    return [...configured, ...warehouses.filter(row => !known.has(row.key)).map(row => ({ warehouseKey: row.key, enabled: true, displayName: "" }))];
  });
  const [error, setError] = useState("");
  const dragged = useRef<string | null>(null);
  const names = new Map(warehouses.map(row => [row.key, row.name]));
  const move = (from: number, to: number) => setRows(previous => {
    if (saving || from < 0 || to < 0 || to >= previous.length || from === to) return previous;
    const next = [...previous]; next.splice(to, 0, ...next.splice(from, 1)); return next;
  });
  return <Dialog open dialogId="jd-monitor-warehouses" ariaLabel="仓库设置" className="panel jd-logistics-dialog jd-monitor-warehouse-dialog" onClose={() => { if (!saving) onClose(); }}>
    <form onSubmit={event => { event.preventDefault(); setError(""); void onSave(rows).catch(reason => setError(reason instanceof Error ? reason.message : "保存失败，请刷新后重试")); }}>
      <header><div><h2>仓库设置</h2><p>{department.name} · 拖动调整显示顺序</p></div><button type="button" className="row-action" disabled={saving} onClick={onClose}>关闭</button></header>
      <p>关闭仓库后，其数据不显示，也不计入本页合计与健康统计。名称留空时使用来源名称；原始仓库身份保留。</p>
      <div className="jd-monitor-warehouse-list">{rows.map((row, index) => <div key={row.warehouseKey} className={`jd-monitor-warehouse-row${row.enabled ? "" : " disabled"}`} onDragOver={event => { if (!saving && dragged.current) event.preventDefault(); }} onDrop={event => { event.preventDefault(); if (dragged.current) move(rows.findIndex(value => value.warehouseKey === dragged.current), index); dragged.current = null; }}>
        <button type="button" className="row-action jd-monitor-drag" draggable={!saving} disabled={saving} aria-label={`拖动${names.get(row.warehouseKey) ?? row.warehouseKey}`} onDragStart={event => { dragged.current = row.warehouseKey; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", row.warehouseKey); }} onDragEnd={() => { dragged.current = null; }}>⠿</button>
        <label className="jd-monitor-warehouse-name"><span title={row.warehouseKey}>{names.get(row.warehouseKey) ?? row.warehouseKey}</span><input aria-label={`${names.get(row.warehouseKey) ?? row.warehouseKey}的自定义名称`} maxLength={80} placeholder="自定义名称（留空沿用来源）" value={row.displayName} disabled={saving} onChange={event => setRows(previous => previous.map(value => value.warehouseKey === row.warehouseKey ? { ...value, displayName: event.target.value } : value))} /></label>
        <label className="jd-monitor-switch"><input type="checkbox" role="switch" aria-label={`${names.get(row.warehouseKey) ?? row.warehouseKey}显示开关`} checked={row.enabled} disabled={saving} onChange={event => setRows(previous => previous.map(value => value.warehouseKey === row.warehouseKey ? { ...value, enabled: event.target.checked } : value))} /><span>{row.enabled ? "显示" : "关闭"}</span></label>
        <div className="jd-monitor-order-buttons"><button type="button" className="row-action" aria-label={`上移${names.get(row.warehouseKey) ?? row.warehouseKey}`} disabled={saving || index === 0} onClick={() => move(index, index - 1)}>↑</button><button type="button" className="row-action" aria-label={`下移${names.get(row.warehouseKey) ?? row.warehouseKey}`} disabled={saving || index === rows.length - 1} onClick={() => move(index, index + 1)}>↓</button></div>
      </div>)}{!rows.length && <p>当前事业部尚无库存来源仓库。</p>}</div>
      {error && <p role="alert" className="jd-logistics-error">{error}</p>}
      <footer><span>可用上下按钮调整顺序</span><button className="primary-button" disabled={saving}>{saving ? "保存中…" : "保存仓库设置"}</button></footer>
    </form>
  </Dialog>;
}
