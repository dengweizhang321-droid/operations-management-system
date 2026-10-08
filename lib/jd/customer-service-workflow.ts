import { parseCustomerServiceImport, validateCustomerServiceConversationMessages } from "../customer-service/import-service";

import { customerServiceStore, jdCustomerServiceStores } from "./customer-service-stores";

export const jdCustomerServiceWorkflow = Object.freeze({
  version: 1,
  ...jdCustomerServiceStores[0],
  entryUrl: "https://shop.jd.com/jdm/kefu/kf-manage-lite/#/UtilsSetting/ChatLog",
  timezone: "Asia/Shanghai",
  cron: "0 9 * * *",
  rollingDays: 30,
  failureEscalationThreshold: 4,
  retryDelayMinutes: 60,
  notificationAudience: "owner_direct_message",
} as const);

export class JdCustomerServiceWorkflowError extends Error {
  constructor(public readonly code: string) { super(code); }
}
function reject(code: string): never { throw new JdCustomerServiceWorkflowError(code); }
const dayMilliseconds = 86_400_000;
function dateOnly(value: string) {
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(timestamp)
    || new Date(timestamp).toISOString().slice(0, 10) !== value) reject("INVALID_DATE");
  return timestamp;
}
export type CustomerServicePeriod = { scheduledDate: string; startDate: string; endDate: string };

// Freeze this range when the logical daily run is created, including retries
// crossing Shanghai midnight. Never derive a new period from retry wall time.
export function customerServicePeriod(now: Date): CustomerServicePeriod {
  if (!Number.isFinite(now.getTime())) reject("INVALID_DATE");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find(value => value.type === type)?.value ?? "";
  const scheduledDate = `${part("year")}-${part("month")}-${part("day")}`;
  const today = dateOnly(scheduledDate);
  return {
    scheduledDate,
    startDate: new Date(today - 30 * dayMilliseconds).toISOString().slice(0, 10),
    endDate: new Date(today - dayMilliseconds).toISOString().slice(0, 10),
  };
}
export function assertCustomerServicePeriod(period: CustomerServicePeriod) {
  const today = dateOnly(period.scheduledDate);
  if (dateOnly(period.startDate) !== today - 30 * dayMilliseconds
    || dateOnly(period.endDate) !== today - dayMilliseconds) reject("PERIOD_MISMATCH");
}

export type CustomerServiceExportEvidence = CustomerServicePeriod & {
  storeKey: string; shopId: string; shopName: string;
  view: "list" | "messages";
  queryConfirmed: boolean;
  unfiltered: boolean;
  // Source-provided export completion, not just a button click or local file.
  exportCompleted: boolean;
};
export function assertCustomerServiceExportEvidence(
  actual: CustomerServiceExportEvidence, period: CustomerServicePeriod, view: "list" | "messages", storeKey = jdCustomerServiceWorkflow.storeKey as string,
) {
  assertCustomerServicePeriod(period);
  const store = customerServiceStore(storeKey);
  if (actual.storeKey !== store.storeKey
    || actual.shopId !== store.shopId
    || actual.shopName !== store.shopName) reject("STORE_IDENTITY_MISMATCH");
  if (actual.scheduledDate !== period.scheduledDate || actual.startDate !== period.startDate
    || actual.endDate !== period.endDate || actual.view !== view) reject("EXPORT_SCOPE_MISMATCH");
  if (actual.queryConfirmed !== true || actual.unfiltered !== true || actual.exportCompleted !== true)
    reject("EXPORT_EVIDENCE_INCOMPLETE");
}

const maxFileBytes = 25 * 1024 * 1024;
export function inspectCustomerServicePair(input: {
  period: CustomerServicePeriod; storeKey?: string;
  sessionBytes: Uint8Array; chatBytes: Uint8Array;
  sessionEvidence: CustomerServiceExportEvidence; chatEvidence: CustomerServiceExportEvidence;
}) {
  assertCustomerServiceExportEvidence(input.sessionEvidence, input.period, "list", input.storeKey);
  assertCustomerServiceExportEvidence(input.chatEvidence, input.period, "messages", input.storeKey);
  for (const bytes of [input.sessionBytes, input.chatBytes]) {
    if (bytes.byteLength === 0 || bytes.byteLength > maxFileBytes) reject("INVALID_FILE_SIZE");
  }
  let parsed: ReturnType<typeof parseCustomerServiceImport>;
  try {
    parsed = parseCustomerServiceImport(input.sessionBytes, new TextDecoder("utf-8", { fatal: true }).decode(input.chatBytes));
    validateCustomerServiceConversationMessages(parsed.conversations);
  } catch {
    // Parser diagnostics can contain customer timestamps/fields. Only emit a
    // fixed error code to automation logs and AI escalation envelopes.
    return reject("PAIR_PARSE_REJECTED");
  }
  if (!parsed.summary.sessionCount || !parsed.summary.chatSessionCount || !parsed.conversations.length)
    reject("EMPTY_PAIR");
  const minimum = `${input.period.startDate} 00:00:00`;
  const maximum = `${input.period.endDate} 23:59:59`;
  for (const row of parsed.conversations) {
    // JD filters by consultation start, but exports the complete conversation,
    // including later replies. Do not drop/reject those replies at midnight.
    const times = [row.consultedAt, row.chatStartedAt].filter(Boolean);
    if (!times.length || times.some(value => value < minimum || value > maximum)) reject("FILE_DATE_OUT_OF_SCOPE");
    // The existing interactive import infers another shop for this prefix.
    // An automated, explicitly bound shop must never take that fallback.
    if (input.storeKey === undefined && row.agent.startsWith("志高厨电")) reject("IMPORT_SHOP_REWRITE_REJECTED");
  }
  if (new TextEncoder().encode(JSON.stringify(parsed.conversations)).byteLength > 16 * 1024 * 1024)
    reject("NORMALIZED_PAYLOAD_TOO_LARGE");
  return parsed;
}

export type CustomerServiceFailureClass = "safe_before_export" | "login_or_identity" | "export_unknown"
  | "import_unknown" | "validation" | "verification";
export type CustomerServiceFailureLedger = {
  logicalRunId: string; period: CustomerServicePeriod;
  failures: Array<{ executionId: string; kind: CustomerServiceFailureClass }>;
};
const failureClasses = new Set<CustomerServiceFailureClass>([
  "safe_before_export", "login_or_identity", "export_unknown", "import_unknown", "validation", "verification",
]);
export function recordCustomerServiceFailure(
  ledger: CustomerServiceFailureLedger, executionId: string, kind: CustomerServiceFailureClass,
) {
  assertCustomerServicePeriod(ledger.period);
  const validId = (value: string) => typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
  if (!validId(ledger.logicalRunId) || !validId(executionId) || !failureClasses.has(kind)
    || !Array.isArray(ledger.failures) || ledger.failures.length > 4
    || ledger.failures.some(item => !validId(item.executionId) || !failureClasses.has(item.kind))
    || new Set(ledger.failures.map(item => item.executionId)).size !== ledger.failures.length) reject("INVALID_FAILURE_LEDGER");
  const old = ledger.failures.find(item => item.executionId === executionId);
  if (old && old.kind !== kind) reject("FAILURE_REPLAY_MISMATCH");
  if (!old && ledger.failures.length >= 4) reject("FAILURE_LEDGER_TERMINAL");
  const failures = old ? [...ledger.failures] : [...ledger.failures, { executionId, kind }];
  const needsHuman = failures.some(item => item.kind !== "safe_before_export");
  const aiRequired = failures.length >= jdCustomerServiceWorkflow.failureEscalationThreshold;
  return {
    ledger: { ...ledger, failures },
    retry: !needsHuman && !aiRequired,
    aiRequired,
    notifyOwner: needsHuman || aiRequired,
    // Recipient resolution and one-time delivery belong to the existing
    // verified DingTalk sender, not to customer records or n8n input text.
    escalationKey: `${ledger.logicalRunId}:customer-service-repair`,
  };
}
