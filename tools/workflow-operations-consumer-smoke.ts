import {
  listOperationsRecordsPageData,
  listWorkflowTasksPageData,
  listWorkflowTemplatesPageData,
} from "@/lib/ai/page-data-tools";
import { readDjangoWorkflowConsumer } from "@/lib/django/workflow-consumer-reader";

const query = (process.env.TERUISI_WORKFLOW_SMOKE_QUERY ?? "").trim();
if (query.length < 2 || query.length > 80) {
  throw new Error("TERUISI_WORKFLOW_SMOKE_QUERY 必须是 2–80 个字符");
}

const principal = {
  email: "local-admin@teruisi.local",
  displayName: "本地管理员",
  role: "admin" as const,
  scope: null,
};
const scopedPrincipal = {
  ...principal,
  scope: { warehouses: [] as string[], channels: [] as string[], platforms: ["__workflow_smoke_no_match__"] },
};

const [search, tasks, templates, scopedOperations] = await Promise.all([
  readDjangoWorkflowConsumer(principal, {
    operation: "workflow_search",
    query,
    offset: 0,
    limit: 5,
  }),
  listWorkflowTasksPageData({ q: query, page: 1, limit: 5 }, { principal }),
  listWorkflowTemplatesPageData({ page: 1, limit: 5 }, { principal }),
  listOperationsRecordsPageData({ page: 1, limit: 5 }, { principal: scopedPrincipal }),
]);

const result = {
  status: "passed",
  workflowRevision: search.revision,
  searchReturned: search.data.items.length,
  searchTaskReturned: search.data.items.filter((item) => item.targetHint === "task").length,
  aiTaskReturned: tasks.items.length,
  aiTemplateReturned: templates.items.length,
  scopedOperationReturned: scopedOperations.items.length,
  scopedOperationMode: scopedOperations.filtersApplied.dataScope,
};

if (
  !/^\d+:[0-9a-f]{12}$/.test(search.revision)
  || result.searchTaskReturned < 1
  || result.aiTaskReturned < 1
  || result.scopedOperationReturned !== 0
  || result.scopedOperationMode !== "restricted"
) {
  throw new Error(`运营事务消费链路 smoke 未满足正式契约: ${JSON.stringify(result)}`);
}

process.stdout.write(`${JSON.stringify(result)}\n`);
