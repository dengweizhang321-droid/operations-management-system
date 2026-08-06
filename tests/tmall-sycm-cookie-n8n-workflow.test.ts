import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowPath = new URL("../automation/n8n/tmall-yijiu-sycm-cookie-daily.workflow.json", import.meta.url);

test("Cookie 直连 n8n 副本保持货品前置与推广收尾五段式、上海时区和凭证隔离", async () => {
  const raw = await readFile(workflowPath, "utf8");
  const workflow = JSON.parse(raw) as {
    id: string;
    name: string;
    active: boolean;
    settings: { timezone?: string };
    nodes: Array<{
      name: string;
      type: string;
      parameters?: {
        command?: string;
        url?: string;
        rule?: { interval?: Array<{ expression?: string }> };
        sendHeaders?: boolean;
        headerParameters?: { parameters?: Array<{ name?: string; value?: string }> };
        options?: { timeout?: number };
      };
    }>;
    connections: Record<string, { main?: Array<Array<{ node?: string }>> }>;
  };
  assert.equal(workflow.id, "M4xY8kQ2vR6sT9pC");
  assert.equal(workflow.name, "天猫店铺数据导入");
  assert.equal(workflow.active, false);
  assert.equal(workflow.settings.timezone, "Asia/Shanghai");
  assert.ok(workflow.nodes.some((node) => node.type === "n8n-nodes-base.manualTrigger"));
  const scheduleNode = workflow.nodes.find((node) => node.type === "n8n-nodes-base.scheduleTrigger");
  assert.equal(scheduleNode?.name, "每天 09:10-19:10 每小时补跑");
  assert.equal(scheduleNode?.parameters?.rule?.interval?.[0]?.expression, "10 9-19 * * *");
  const requestNodes = workflow.nodes.filter((node) => node.type === "n8n-nodes-base.httpRequest");
  assert.deepEqual(requestNodes.map((node) => node.parameters?.url), [
    "http://127.0.0.1:5791/product-master",
    "http://127.0.0.1:5791/plan",
    "http://127.0.0.1:5791/fetch",
    "http://127.0.0.1:5791/import",
    "http://127.0.0.1:5791/promotion",
  ]);
  for (const node of requestNodes) {
    assert.equal(node.parameters?.sendHeaders, true);
    assert.deepEqual(node.parameters?.headerParameters?.parameters, [{
      name: "X-TERUISI-N8N-EXECUTION-ID",
      value: "={{ $execution.id }}",
    }]);
  }
  assert.equal(workflow.nodes.some((node) => node.type === "n8n-nodes-base.executeCommand"), false);
  assert.match(raw, /导出全部商品/);
  assert.match(raw, /重要通知/);
  assert.match(raw, /商品管家/);
  assert.match(raw, /再从右下角打开“商品管家”/);
  assert.match(raw, /推广 > 货品全站推 > 报表/);
  assert.match(raw, /全部数据指标/);
  assert.match(raw, /开始和结束日期都选同一个业务日/);
  assert.match(raw, /当天完整成功后才进入下一天/);
  assert.match(raw, /生成成功/);
  assert.doesNotMatch(raw, /从左下角打开“商品管家”/);
  assert.doesNotMatch(raw, /批量导出表格/);
  assert.equal(workflow.connections["手动运行"]?.main?.[0]?.[0]?.node, "M·商品管家批量导出、校验并导入");
  assert.equal(workflow.connections["每天 09:10-19:10 每小时补跑"]?.main?.[0]?.[0]?.node, "M·商品管家批量导出、校验并导入");
  assert.equal(workflow.connections["M·商品管家批量导出、校验并导入"]?.main?.[0]?.[0]?.node, "A·算缺哪些日期");
  assert.equal(workflow.connections["C·签收、导入并覆盖回查"]?.main?.[0]?.[0]?.node, "P·全站推逐日报表下载、导入并回查");
  assert.equal(requestNodes[0]?.parameters?.options?.timeout, 1_800_000);
  assert.equal(requestNodes.at(-1)?.parameters?.options?.timeout, 21_600_000);
  assert.doesNotMatch(raw, /--(?:username|password|cookie)\b|TMALL_(?:USERNAME|PASSWORD)\b|Cookie:\s*[^`\n]/i);
  assert.doesNotMatch(raw, /localhost:8000|teruisi123|_tb_token_=|cookie2=/i);
});

test("运营系统在左侧工作流板块受控嵌入天猫 n8n 画布", async () => {
  const [page, view] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/n8n-workflow-view.tsx", import.meta.url), "utf8"),
  ]);

  const workflowNavigation = page.indexOf('{ key: "n8n_workflows", label: "工作流"');
  const dashboardNavigation = page.indexOf('{ key: "dashboard", label: "BI 看板"');
  assert.ok(dashboardNavigation >= 0 && dashboardNavigation < workflowNavigation);
  assert.match(page, /n8n_workflows: \(\{ currentUser \}\) => <N8nWorkflowView currentUser=\{currentUser\}/);
  assert.match(view, /tmall-yijiu-sycm-cookie-daily\.workflow\.json/);
  assert.match(view, /jackyun-five-dataset-daily\.workflow\.json/);
  assert.match(view, /http:\/\/localhost:5678\/workflow\//);
  assert.match(view, /canManageN8nWorkflow\(currentUser\?\.role\)/);
  assert.match(view, /workflowEditorReady \? <div className="n8n-frame-shell">/);
  assert.match(view, /iframeTitle: "天猫店铺数据导入 n8n 工作流"/);
  assert.match(view, /iframeTitle: "吉客云导入系统 n8n 工作流"/);
  assert.match(view, /sandbox="allow-downloads[^"]+allow-scripts"/);
  assert.match(view, /账号、密码、Cookie、Token 和 Session 均不进入运营系统/);
  assert.match(view, /http:\/\/127\.0\.0\.1:5791\/health/);
  assert.match(view, /data-helper-status=\{helperStatus\.kind\}/);
  assert.match(view, /同店同日同内容返回 duplicate/);
  assert.match(view, /M → A → B → C → P/);
  assert.match(view, /全站推推广/);
  assert.match(view, /scheduleMetric: "09:10–19:10"/);
  assert.match(view, /\{config\.scheduleMetric\} 每小时/);
  assert.match(view, /辅助服务已就绪/);
  assert.match(view, /实际发布状态以 n8n 画布为准/);
});

test("n8n 工作流视图只在操作角色且 helper ready 时挂载可执行入口", async () => {
  const [{ createElement }, { renderToStaticMarkup }, workflowView] = await Promise.all([
    import("react"),
    import("react-dom/server"),
    import("../app/n8n-workflow-view"),
  ]);
  const {
    default: N8nWorkflowView,
    canManageN8nWorkflow,
    shouldMountN8nWorkflowEditor,
  } = workflowView;

  const viewerHtml = renderToStaticMarkup(createElement(N8nWorkflowView, { currentUser: { role: "viewer" } }));
  const operatorHtml = renderToStaticMarkup(createElement(N8nWorkflowView, { currentUser: { role: "operator" } }));

  assert.match(viewerHtml, /吉客云导入系统/);
  assert.match(viewerHtml, /天猫店铺数据导入/);
  assert.match(viewerHtml, /需要操作员或管理员权限/);
  assert.doesNotMatch(viewerHtml, /<iframe/);
  assert.equal(canManageN8nWorkflow("viewer"), false);
  assert.equal(canManageN8nWorkflow("analyst"), false);
  assert.equal(canManageN8nWorkflow("operator"), true);
  assert.equal(canManageN8nWorkflow("admin"), true);
  for (const helperKind of ["checking", "running", "cookie-missing", "offline"] as const) {
    assert.equal(shouldMountN8nWorkflowEditor("operator", helperKind), false);
    assert.equal(shouldMountN8nWorkflowEditor("admin", helperKind), false);
  }
  assert.equal(shouldMountN8nWorkflowEditor("viewer", "ready"), false);
  assert.equal(shouldMountN8nWorkflowEditor("analyst", "ready"), false);
  assert.equal(shouldMountN8nWorkflowEditor("operator", "ready"), true);
  assert.equal(shouldMountN8nWorkflowEditor("admin", "ready"), true);
  assert.doesNotMatch(operatorHtml, /<iframe/);
  assert.doesNotMatch(operatorHtml, /href="http:\/\/localhost:5678\/workflow\//);
  assert.doesNotMatch(operatorHtml, /刷新画布|在 n8n 中打开/);
  assert.match(operatorHtml, /data-helper-status="checking"/);
  assert.match(operatorHtml, /执行门禁/);
});
