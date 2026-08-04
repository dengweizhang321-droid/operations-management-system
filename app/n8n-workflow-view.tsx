"use client";

import { Fragment, useEffect, useState } from "react";
import jackyunWorkflowDefinition from "@/automation/n8n/jackyun-five-dataset-daily.workflow.json";
import tmallWorkflowDefinition from "@/automation/n8n/tmall-yijiu-sycm-cookie-daily.workflow.json";

type AppRole = "viewer" | "analyst" | "operator" | "admin";
type WorkflowKey = "jackyun" | "tmall";

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

type HelperHealthPayload = {
  ok?: boolean;
  stage?: string;
  busy?: boolean;
  activeWorkflow?: "tmall" | "jackyun" | null;
  cookieSource?: "ready" | "missing" | "invalid";
  jackyunProfile?: "ready" | "missing" | "invalid";
};

type HelperAvailability = {
  kind: "checking" | "ready" | "running" | "cookie-missing" | "offline";
  label: string;
  detail: string;
};

type WorkflowConfig = {
  key: WorkflowKey;
  definition: N8nWorkflowDefinition;
  subtitle: string;
  tags: string[];
  flowLabel: string;
  pipelineTitle: string;
  pipelineDescription: string;
  workflowMetric: string;
  scheduleMetric: string;
  scheduleDescription: string;
  iframeTitle: string;
  safetyNote: string;
  stageDetails: Record<string, { title: string; description: string }>;
};

const helperHealthUrl = "http://127.0.0.1:5791/health";

const workflowConfigs: Record<WorkflowKey, WorkflowConfig> = {
  jackyun: {
    key: "jackyun",
    definition: jackyunWorkflowDefinition as N8nWorkflowDefinition,
    subtitle: "吉客云 ERP 货品、分仓库存、库龄、销售和组合装的一体化每日导入流程。",
    tags: ["吉客云 ERP", "Asia/Shanghai", "五类严格串行"],
    flowLabel: "A → B → C",
    pipelineTitle: "三段式五类安全导入链路",
    pipelineDescription: "两个触发入口汇入同一条串行链路；任一步失败都会停止后续模块与节点。",
    workflowMetric: "吉客云五类数据导入",
    scheduleMetric: "08:40–18:40",
    scheduleDescription: "上海时区 · 每小时补跑",
    iframeTitle: "吉客云五类数据每日导入 n8n 工作流",
    safetyNote: "页面只嵌入本机编辑器，吉客云账号、密码、Cookie、Token 和 Session 均不进入运营系统。A 会跳过已有完整当日结果；B 复用正式五类 runner 的下载绑定、刷刷仓过滤、批次幂等与落库回查；C 独立重读清单、审计和精确批次。",
    stageDetails: {
      A: { title: "生成安全计划", description: "按上海时区计算昨天，核验本机系统、专用 profile、策略版本和当日完成状态。" },
      B: { title: "五类串行执行", description: "依次完成货品、分仓库存、库龄、销售、组合装的下载、校验、导入和回查。" },
      C: { title: "独立结果核验", description: "重读日汇总、运行清单和模块审计，确认五类顺序、日期与精确批次。" },
    },
  },
  tmall: {
    key: "tmall",
    definition: tmallWorkflowDefinition as N8nWorkflowDefinition,
    subtitle: "天猫货品主数据与生意参谋 SPU 分天数据的一体化导入流程。",
    tags: ["天猫-志高亿玖专卖店", "Asia/Shanghai", "本机安全执行"],
    flowLabel: "M → A → B → C",
    pipelineTitle: "四段式安全导入链路",
    pipelineDescription: "两个触发入口汇入同一条串行链路；任一步失败都会停止后续导入。",
    workflowMetric: "天猫店铺数据导入",
    scheduleMetric: "08:40–18:40",
    scheduleDescription: "上海时区 · 每小时补跑",
    iframeTitle: "天猫店铺数据导入 n8n 工作流",
    safetyNote: "页面只嵌入本机编辑器，Cookie、账号、密码、Token 和 Session 均不进入运营系统。本地 Worker 自动守护一次性环回服务；缺口规划会跳过已覆盖日期，导入接口继续按店铺、数据集、日期和文件内容幂等去重。",
    stageDetails: {
      M: { title: "货品主数据", description: "从店铺独立千牛会话导出全部商品，校验发布模板、库存和行数后导入并回查。" },
      A: { title: "缺口规划", description: "按天猫店铺与 SPU 日数据集查询真实覆盖，只生成注册起始日至昨天的缺失日期。" },
      B: { title: "逐日下载", description: "每个业务日独立下载生意参谋 XLS，并核验店铺身份、文件类型与日期覆盖。" },
      C: { title: "签收导入", description: "签收受控文件，执行幂等导入并回查批次、行数、店铺与同日覆盖。" },
    },
  },
};

function checkingHelper(key: WorkflowKey): HelperAvailability {
  return {
    kind: "checking",
    label: "正在检测辅助服务",
    detail: key === "jackyun"
      ? "正在确认 5791 环回服务、本机运营系统和吉客云专用 Chrome profile。"
      : "正在确认 5791 环回服务是否在线、Cookie 原文件是否可读取。",
  };
}

function helperAvailability(payload: HelperHealthPayload, key: WorkflowKey): HelperAvailability {
  if (payload.ok !== true) throw new Error("invalid_health_response");
  if (key === "jackyun" && payload.jackyunProfile !== "ready") {
    return {
      kind: "cookie-missing",
      label: "吉客云专用会话待恢复",
      detail: "辅助服务在线，但专用 Chrome profile 缺失或结构无效；先执行 npm run jackyun:login 完成人工登录。",
    };
  }
  if (key === "tmall" && payload.cookieSource !== "ready") {
    return {
      kind: "cookie-missing",
      label: "Cookie 文件待恢复",
      detail: "辅助服务在线，但 Cookie 原文件不存在或路径无效；更新本机 .runtime 指针后重新检测。",
    };
  }
  if (payload.busy || payload.stage !== "ready") {
    const activeLabel = payload.activeWorkflow === "jackyun" ? "吉客云" : payload.activeWorkflow === "tmall" ? "天猫" : "当前";
    return {
      kind: "running",
      label: `${activeLabel}流程执行中`,
      detail: "辅助服务正在处理当前串行链路，请等待本轮完成并自动重新待命后再发起下一轮。",
    };
  }
  return key === "jackyun" ? {
    kind: "ready",
    label: "可以安全启动",
    detail: "服务与专用 profile 已就绪；A 会跳过已有完整当日结果，任一失败都会阻断后续五类任务。",
  } : {
    kind: "ready",
    label: "可以安全启动",
    detail: "服务已在线；A 仅规划缺失日期，C 对同店同日同内容返回 duplicate，不会重复入库。",
  };
}

export default function N8nWorkflowView({ currentUser }: N8nWorkflowViewProps) {
  const [selectedWorkflowKey, setSelectedWorkflowKey] = useState<WorkflowKey>("jackyun");
  const [frameKey, setFrameKey] = useState(0);
  const [frameReady, setFrameReady] = useState(false);
  const [helperRefreshKey, setHelperRefreshKey] = useState(0);
  const [helperStatus, setHelperStatus] = useState<HelperAvailability>(() => checkingHelper("jackyun"));
  const config = workflowConfigs[selectedWorkflowKey];
  const workflow = config.definition;
  const workflowUrl = `http://localhost:5678/workflow/${encodeURIComponent(workflow.id)}`;
  const canManageWorkflow = currentUser?.role === "operator" || currentUser?.role === "admin";
  const helperBlocksExecution = helperStatus.kind !== "ready";
  const requestStages = workflow.nodes
    .filter((node) => node.type === "n8n-nodes-base.httpRequest")
    .map((node) => {
      const code = node.name.split("·", 1)[0] || "?";
      const details = config.stageDetails[code] ?? { title: node.name, description: "执行受控的本机工作流步骤。" };
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

  useEffect(() => {
    let cancelled = false;
    let activeController: AbortController | null = null;
    const check = async () => {
      activeController?.abort();
      const controller = new AbortController();
      activeController = controller;
      const timeout = window.setTimeout(() => controller.abort(), 2_000);
      try {
        const response = await fetch(helperHealthUrl, { cache: "no-store", signal: controller.signal });
        const payload = await response.json() as HelperHealthPayload;
        if (!response.ok) throw new Error("helper_unavailable");
        if (!cancelled) setHelperStatus(helperAvailability(payload, selectedWorkflowKey));
      } catch {
        if (!cancelled) {
          setHelperStatus({
            kind: "offline",
            label: "辅助服务离线",
            detail: "请用受控启动命令重启本地 Worker；5791 服务会自动拉起并在每轮结束后重新待命。",
          });
        }
      } finally {
        window.clearTimeout(timeout);
      }
    };

    void check();
    const interval = window.setInterval(() => void check(), 5_000);
    return () => {
      cancelled = true;
      activeController?.abort();
      window.clearInterval(interval);
    };
  }, [helperRefreshKey, selectedWorkflowKey]);

  const refreshFrame = () => {
    setFrameReady(false);
    setFrameKey((key) => key + 1);
  };

  const refreshHelperStatus = () => {
    setHelperStatus(checkingHelper(selectedWorkflowKey));
    setHelperRefreshKey((key) => key + 1);
  };

  const selectWorkflow = (key: WorkflowKey) => {
    if (key === selectedWorkflowKey) return;
    setSelectedWorkflowKey(key);
    setHelperStatus(checkingHelper(key));
    setFrameReady(false);
    setFrameKey((value) => value + 1);
  };

  return (
    <section className="n8n-workflow-module" data-testid="n8n-workflow-module">
      <nav className="n8n-workflow-switcher" aria-label="工作流选择">
        {(Object.keys(workflowConfigs) as WorkflowKey[]).map((key) => (
          <button
            type="button"
            key={key}
            className={selectedWorkflowKey === key ? "is-active" : ""}
            aria-pressed={selectedWorkflowKey === key}
            onClick={() => selectWorkflow(key)}
          >
            <span>{key === "jackyun" ? "吉" : "天"}</span>
            <strong>{workflowConfigs[key].definition.name}</strong>
          </button>
        ))}
      </nav>

      <section className="n8n-workflow-hero">
        <div className="n8n-workflow-hero-copy">
          <span className="n8n-workflow-kicker"><i /> n8n automation</span>
          <h2>{workflow.name}</h2>
          <p>{config.subtitle}</p>
          <div className="n8n-workflow-tags">
            {config.tags.map((tag) => <span key={tag}>{tag}</span>)}
          </div>
        </div>
        <div className="n8n-workflow-hero-status">
          <span className={workflow.active ? "is-active" : "is-draft"}>{workflow.active ? "已启用" : "待发布"}</span>
          <strong>{config.flowLabel}</strong>
          <small>工作流 ID · {workflow.id}</small>
        </div>
      </section>

      <section className="n8n-workflow-metrics" aria-label="工作流摘要">
        <article><span>工作流</span><strong>1</strong><small>{config.workflowMetric}</small></article>
        <article><span>处理阶段</span><strong>{requestStages.length}</strong><small>{requestStages.map((stage) => stage.name).join("、")}</small></article>
        <article><span>触发入口</span><strong>{triggerCount}</strong><small>手动运行 + 定时补跑</small></article>
        <article><span>补跑时段</span><strong>{config.scheduleMetric}</strong><small>{config.scheduleDescription}</small></article>
      </section>

      <section className="panel n8n-pipeline-panel" aria-labelledby="n8n-pipeline-title">
        <div className="n8n-panel-heading">
          <div><span>FLOW OVERVIEW</span><h3 id="n8n-pipeline-title">{config.pipelineTitle}</h3><p>{config.pipelineDescription}</p></div>
          <div className="n8n-loopback-status">
            <span className={`n8n-helper-pill is-${helperStatus.kind}`}><i />{helperStatus.label}</span>
            <span className="n8n-loopback-badge">仅访问 127.0.0.1:5791</span>
          </div>
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
          <div className={`n8n-helper-banner is-${helperStatus.kind}`} data-helper-status={helperStatus.kind} aria-live="polite">
            <span><i />{helperStatus.label}</span>
            <p>{helperStatus.detail}</p>
            <button type="button" onClick={refreshHelperStatus}>重新检测</button>
          </div>
          <div className="n8n-frame-shell">
            {!frameReady && <div className="n8n-frame-loading" role="status"><span /><strong>正在连接本机 n8n</strong><small>如果出现登录页，请先完成 n8n 登录。</small></div>}
            {helperBlocksExecution && <div className="n8n-helper-gate" role="alert">
              <span>执行门禁</span>
              <strong>{helperStatus.label}</strong>
              <p>{helperStatus.detail}</p>
              <button type="button" onClick={refreshHelperStatus}>重新检测</button>
            </div>}
            <iframe
              key={`${selectedWorkflowKey}-${frameKey}`}
              className="n8n-workflow-frame"
              src={workflowUrl}
              title={config.iframeTitle}
              onLoad={() => setFrameReady(true)}
              referrerPolicy="no-referrer"
              sandbox="allow-downloads allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
              allow="clipboard-read; clipboard-write"
            />
          </div>
          <footer className="n8n-editor-note"><span>安全与去重</span><p>{config.safetyNote}</p></footer>
        </> : <div className="n8n-access-card">
          <span>锁</span><div><strong>需要操作员或管理员权限</strong><p>当前账号可查看流程概览，但不能加载可执行的 n8n 编辑器。该限制防止只读账号绕过系统权限发起真实导入。</p></div>
        </div>}
      </section>
    </section>
  );
}
