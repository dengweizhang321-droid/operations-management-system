"use client";

import { useEffect, useRef, useState } from "react";
import catalog from "@/lib/imports/chain-catalog.generated.json";
import { describeSchedule } from "@/lib/imports/run-presentation";
import type { CurrentUser } from "./module-view-shared";

type Rule = typeof catalog.rules[number];

export default function ImportChainRulesView({ currentUser }: { currentUser: CurrentUser | null }) {
  const [platform, setPlatform] = useState("全部");
  const [selection, setSelection] = useState<{ rule: Rule; entityKey: string } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const canOpenN8n = currentUser?.role === "operator" || currentUser?.role === "admin";
  const entities = catalog.entities.filter((e) => platform === "全部" || e.platform === platform);
  const chains = catalog.chains.filter((c) => platform === "全部" || c.platform === platform);
  const selectedChain = catalog.chains.find((c) => c.key === selection?.rule.chainKey);
  const selectedEntity = catalog.entities.find((e) => e.key === selection?.entityKey);

  useEffect(() => {
    if (selection) dialog.current?.showModal();
    else dialog.current?.close();
  }, [selection]);

  return <div className="import-monitor">
    <div className="import-monitor-note" role="note"><strong>一条链路 × 店铺 / 账号 × 数据模块 × 运行频率</strong><p>这里展示仓库内的链路配置。启停状态、今天是否执行及下次运行时间，以 n8n 已发布版本为准。</p></div>
    <section className="panel table-panel import-chain-panel">
      <div className="import-monitor-toolbar"><div><h2>链路规则</h2><span className="import-monitor-muted">{catalog.chains.length} 条链路 · {catalog.rules.length} 份工作流配置 · 由 n8n 执行</span></div><label>平台<select aria-label="链路平台" value={platform} onChange={(e) => setPlatform(e.target.value)}>{["全部", "ERP", "京东", "天猫"].map((p) => <option key={p}>{p}</option>)}</select></label></div>
      <div className="data-table-wrap import-matrix-scroll" tabIndex={0} role="region" aria-label="链路与店铺规则矩阵，可横向滚动">
        <table className="data-table import-chain-matrix" data-column-filter-scope="none"><thead>
          <tr><th rowSpan={2} scope="col">链路</th><th colSpan={entities.length} scope="colgroup" className="import-matrix-group">执行主体（账号 / 店铺）</th></tr>
          <tr>{entities.map((entity) => <th scope="col" key={entity.key}><strong>{entity.name}</strong><small>{entity.platform}</small></th>)}</tr>
        </thead><tbody>{chains.map((chain) => <tr key={chain.key}>
          <th scope="row"><strong>{chain.label}</strong><small>{chain.modules.length} 个数据模块</small><span className="import-run-badge is-neutral">n8n 工作流</span></th>
          {entities.map((entity) => {
            const rules = catalog.rules.filter((r) => r.chainKey === chain.key && r.entityKeys.includes(entity.key));
            return <td key={entity.key}>{rules.length ? rules.map((rule) => <div className="import-rule-cell" key={rule.workflowId}>
              <span>{rule.schedules.map(describeSchedule).join("、") || "手动触发"}</span>
              {rule.masterIntervalDays && <small>主数据每 {rule.masterIntervalDays} 天更新</small>}
              <small>启停状态待在 n8n 核实</small>
              <button type="button" className="text-button" onClick={() => setSelection({ rule, entityKey: entity.key })}>查看规则 →</button>
            </div>) : <span className="import-monitor-muted" title={entity.platform === chain.platform ? "仓库没有为此主体配置该链路" : "此链路不适用于该平台"}>{entity.platform === chain.platform ? "未配置" : "—"}</span>}</td>;
          })}
        </tr>)}</tbody></table>
      </div>
      <footer className="import-monitor-footer">同一个工作流覆盖多店时，各格共用同一份执行配置。选择平台可缩小矩阵。</footer>
    </section>
    <dialog ref={dialog} className="import-rule-dialog" aria-labelledby="import-rule-title" onClose={() => setSelection(null)} onCancel={() => setSelection(null)}>
      {selection && selectedChain && <>
        <header><div><span className="import-monitor-muted">链路规则详情</span><h2 id="import-rule-title">{selectedChain.label}</h2><p>{selectedEntity?.name}</p></div><button type="button" className="secondary-button" onClick={() => setSelection(null)} aria-label="关闭规则详情">关闭</button></header>
        <div className="import-rule-dialog-body">
          <dl className="import-run-facts"><div><dt>工作流</dt><dd>{selection.rule.name}</dd></div><div><dt>配置频率</dt><dd>{selection.rule.schedules.map(describeSchedule).join("、") || "手动触发"}</dd></div><div><dt>时区</dt><dd>{selection.rule.timezone}</dd></div><div><dt>启停 / 今天 / 下次</dt><dd>尚未接入实时状态，请在 n8n 查看</dd></div>{selection.rule.masterIntervalDays && <div><dt>主数据更新周期</dt><dd>每 {selection.rule.masterIntervalDays} 天；到期情况由执行记录决定</dd></div>}</dl>
          <h3>数据模块</h3><div className="import-rule-modules">{selectedChain.modules.map((m) => <span key={m}>{m}</span>)}</div>
          <h3>执行步骤</h3><ol className="import-rule-steps">{selectedChain.steps.map((step) => <li key={step}>{step}</li>)}</ol>
          <h3>共用此工作流的主体</h3><p>{catalog.entities.filter((e) => selection.rule.entityKeys.includes(e.key)).map((e) => e.name).join("、")}</p>
          <details className="import-rule-provenance"><summary>配置来源</summary><p>{selection.rule.definitionFile}</p><p>工作流 ID：{selection.rule.workflowId}</p><p>仓库定义不能证明当前已发布，也不能证明某次执行成功。</p></details>
        </div>
        <footer>{canOpenN8n ? <><a className="secondary-button" href={`http://localhost:5678/workflow/${encodeURIComponent(selection.rule.workflowId)}/executions`} target="_blank" rel="noreferrer">在 n8n 查看运行记录 ↗</a><a className="primary-button" href={`http://localhost:5678/workflow/${encodeURIComponent(selection.rule.workflowId)}`} target="_blank" rel="noreferrer">打开 n8n 工作流 ↗</a></> : <span className="import-monitor-muted">操作员和管理员可打开 n8n 工作流。</span>}</footer>
      </>}
    </dialog>
  </div>;
}
