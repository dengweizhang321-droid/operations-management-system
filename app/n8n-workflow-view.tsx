"use client";

import { Fragment, useState } from "react";
import workflowDefinition from "@/automation/n8n/tmall-yijiu-sycm-cookie-daily.workflow.json";

type AppRole = "viewer" | "analyst" | "operator" | "admin";

type N8nWorkflowViewProps = {
  currentUser: { role: AppRole } | null;
};

type N8nWorkflowDefinition = {
  id: string;
  name: string;
  active: boolean;
  nodes: Array<{
    name: string;
    type: string;
    parameters?: { url?: string };
  }>;
};

const workflow = workflowDefinition as N8nWorkflowDefinition;
const workflowUrl = `http://localhost:5678/workflow/${encodeURIComponent(workflow.id)}`;

const stageDetails: Record<string, { title: string; description: string }> = {
  M: {
    title: "货品主数据",
    description: "从店铺独立千牛会话导出全部商品，校验发布模板、库存和行数后导入并回查。",
  },
  A: {
    title: "缺口规划",
    description: "按天猫店铺与 SPU 日数据集查询真实覆盖，只生成注册起始日至昨天的缺失日期。",
  },
  B: {
    title: "逐日下载",
    description: "每个业务日独立下载生意参谋 XLS，并核验店铺身份、文件类型与日期覆盖。",
  },
  C: {
    title: "签收导入",
    description: "签收受控文件，执行幂等导入并回查批次、行数、店铺与同日覆盖。",
  },
};

const requestStages = workflow.nodes
  .filter((node) => node.type === "n8n-nodes-base.httpRequest")
  .map((node) => {
    const code = node.name.split("·", 1)[0] || "?";
    const details = stageDetails[code] ?? { title: node.name, description: "执行受控的本机工作流步骤。" };
    return {
      code,
      name: details.title,
      description: details.description,
      endpoint: node.parameters?.url?.replace(/^https?:\/\/127\.0\.0\.1:5791/, "") || "本机环回服务",
    };
  });

const triggerCount = workflow.nodes.filter((node) =>
  node.type === "n8n-nodes-base.manualTrigger" || node.type === "n8n-nodes-base.scheduleTrigger"
).length;

export default function N8nWorkflowView({ currentUser }: N8nWorkflowViewProps) {
  const [frameKey, setFrameKey] = useState(0);
  const [frameReady, setFrameReady] = useState(false);
  const canManageWorkflow = currentUser?.role === "operator" || currentUser?.role === "admin";

  const refreshFrame = () => {
    setFrameReady(false);
    setFrameKey((key) => key + 1);
  };

  return (
    <section className="n8n-workflow-module" data-testid="n8n-workflow-module">
      <section className="n8n-workflow-hero">
        <div className="n8n-workflow-hero-copy">
          <span className="n8n-workflow-kicker"><i /> n8n automation</span>
          <h2>{workflow.name}</h2>
          <p>天猫货品主数据与生意参谋 SPU 分天数据的一体化导入流程。</p>
          <div className="n8n-workflow-tags">
            <span>天猫-志高亿玖专卖店</span>
            <span>Asia/Shanghai</span>
            <span>本机安全执行</span>
          </div>
        </div>
        <div className="n8n-workflow-hero-status">
          <span className={workflow.active ? "is-active" : "is-draft"}>{workflow.active ? "已启用" : "待发布"}</span>
          <strong>M → A → B → C</strong>
          <small>工作流 ID · {workflow.id}</small>
        </div>
      </section>

      <section className="n8n-workflow-metrics" aria-label="工作流摘要">
        <article><span>工作流</span><strong>1</strong><small>天猫店铺数据导入</small></article>
        <article><span>处理阶段</span><strong>{requestStages.length}</strong><small>货品、规划、下载、导入</small></article>
        <article><span>触发入口</span><strong>{triggerCount}</strong><small>手动运行 + 定时补跑</small></article>
        <article><span>补跑时段</span><strong>08:40–18:40</strong><small>上海时区 · 每小时</small></article>
      </section>

      <section className="panel n8n-pipeline-panel" aria-labelledby="n8n-pipeline-title">
        <div className="n8n-panel-heading">
          <div><span>FLOW OVERVIEW</span><h3 id="n8n-pipeline-title">四段式安全导入链路</h3><p>两个触发入口汇入同一条串行链路；任一步失败都会停止后续导入。</p></div>
          <span className="n8n-loopback-badge">仅访问 127.0.0.1:5791</span>
        </div>
        <div className="n8n-pipeline-flow">
          <div className="n8n-trigger-stack" aria-label="触发入口">
            <div><i className="manual">↗</i><span><strong>手动运行</strong><small>人工确认后启动</small></span></div>
            <div><i className="schedule">◷</i><span><strong>定时补跑</strong><small>08:40–18:40 每小时</small></span></div>
          </div>
          <span className="n8n-flow-arrow" aria-hidden="true">→</span>
          {requestStages.map((stage, index) => (
            <Fragment key={stage.code}>
              <article className="n8n-stage-card">
                <div><span>{stage.code}</span><code>{stage.endpoint}</code></div>
                <strong>{stage.name}</strong>
                <p>{stage.description}</p>
              </article>
              {index < requestStages.length - 1 && <span className="n8n-flow-arrow" aria-hidden="true">→</span>}
            </Fragment>
          ))}
        </div>
      </section>

      <section className="panel n8n-editor-panel" aria-labelledby="n8n-editor-title">
        <div className="n8n-panel-heading n8n-editor-heading">
          <div><span>LIVE WORKFLOW</span><h3 id="n8n-editor-title">n8n 工作流画布</h3><p>直接使用本机 n8n 登录态；运营系统不会读取或保存 n8n 凭证。</p></div>
          {canManageWorkflow && <div className="n8n-editor-actions">
            <button type="button" onClick={refreshFrame}>刷新画布</button>
            <a href={workflowUrl} target="_blank" rel="noreferrer">在 n8n 中打开 ↗</a>
          </div>}
        </div>
        {canManageWorkflow ? <>
          <div className="n8n-frame-shell">
            {!frameReady && <div className="n8n-frame-loading" role="status"><span /><strong>正在连接本机 n8n</strong><small>如果出现登录页，请先完成 n8n 登录。</small></div>}
            <iframe
              key={frameKey}
              className="n8n-workflow-frame"
              src={workflowUrl}
              title="天猫店铺数据导入 n8n 工作流"
              onLoad={() => setFrameReady(true)}
              referrerPolicy="no-referrer"
              sandbox="allow-downloads allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
              allow="clipboard-read; clipboard-write"
            />
          </div>
          <footer className="n8n-editor-note"><span>安全边界</span><p>页面只嵌入本机编辑器。Cookie、账号、密码、Token 和 Session 均不进入运营系统；执行前仍需启动一次性环回辅助进程。</p></footer>
        </> : <div className="n8n-access-card">
          <span>锁</span><div><strong>需要操作员或管理员权限</strong><p>当前账号可查看流程概览，但不能加载可执行的 n8n 编辑器。该限制防止只读账号绕过系统权限发起真实导入。</p></div>
        </div>}
      </section>
    </section>
  );
}
