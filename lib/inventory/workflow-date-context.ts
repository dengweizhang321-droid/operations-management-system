import { workflowLocalDate, workflowTimeZone } from "../imports/local-time";

export const workflowCollectionDatePolicy = "host_local_calendar_v1";
export type WorkflowCollectionDateContext = { datePolicy?: typeof workflowCollectionDatePolicy; timeZone?: string };

/** Old collection manifests keep their original Shanghai calendar. */
export function collectionDateContext(value: WorkflowCollectionDateContext): WorkflowCollectionDateContext {
  if (value.datePolicy === undefined && value.timeZone === undefined) return {};
  if (value.datePolicy !== workflowCollectionDatePolicy || typeof value.timeZone !== "string" || !value.timeZone.trim()) {
    throw new Error("WORKFLOW_COLLECTION_DATE_CONTEXT_INVALID");
  }
  new Intl.DateTimeFormat("en", { timeZone: value.timeZone }).format(0);
  return { datePolicy: value.datePolicy, timeZone: value.timeZone };
}

export function newCollectionDateContext() {
  return { datePolicy: workflowCollectionDatePolicy, timeZone: workflowTimeZone() } as const;
}

export function collectionDay(now: Date, context: WorkflowCollectionDateContext = {}) {
  return workflowLocalDate(now, 0, collectionDateContext(context).timeZone ?? "Asia/Shanghai");
}
