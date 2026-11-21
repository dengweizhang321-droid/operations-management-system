// Live n8n schedules for the four JD customer-service workflows. Live n8n is the
// source of truth; the repo copies run in fixed Beijing time
// (settings.timezone = Asia/Shanghai), independent of the host clock.
export const jdCustomerServiceCron = Object.freeze({
  JdCustomerService2026: "5 9 * * *",
  JdCustomerServiceChudian2026: "25 9 * * *",
  JdCustomerServiceDishwasher2026: "45 9 * * *",
  JdCustomerServiceCutMeat2026: "5 10 * * *",
});

// The schedule node ID was derived from its original name before the live times
// were staggered. Keep that seed so regenerating never changes published node IDs.
export const jdCustomerServiceScheduleIdSeed = "每天 09:00 执行";

export function jdCustomerServiceScheduleName(cron) {
  const match = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(cron);
  if (!match) throw new Error(`Unsupported customer-service cron: ${cron}`);
  return `每天 ${match[2].padStart(2, "0")}:${match[1].padStart(2, "0")} 执行`;
}

export function jdCustomerServiceStoreCron(workflowId) {
  const cron = jdCustomerServiceCron[workflowId];
  if (!cron) throw new Error(`No live schedule registered for ${workflowId}`);
  return cron;
}

// Rename a node and its connection key in place, keeping key order and every
// edge that points at it, so the serialized definition only changes the name.
export function renameWorkflowNode(workflow, from, to) {
  const nodes = workflow.nodes.filter(node => node.name === from);
  if (nodes.length !== 1) throw new Error(`Expected exactly one node named ${from}`);
  nodes[0].name = to;
  workflow.connections = Object.fromEntries(Object.entries(workflow.connections).map(([key, value]) => [
    key === from ? to : key,
    JSON.parse(JSON.stringify(value), (field, item) => field === "node" && item === from ? to : item),
  ]));
}
