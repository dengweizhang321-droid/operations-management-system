import { jackyunModuleOrder, type JackyunModule } from "./post-download";
import { readJsonFile, writeJsonAtomic } from "./json-file";

export const jackyunBrowserStates = [
  "PRECHECKED",
  "ENTER_MODULE",
  "VERIFY_FIELD",
  "QUERY_ONCE",
  "WAIT_TABLE_STABLE",
  "ARM_DOWNLOAD",
  "EXPORT_ONCE",
  "CONFIRM_EXPORT_DIALOG",
  "WAIT_EVENT_AND_FILE",
  "HANDOFF_EXACT_PATH",
  "RUNNER_VERIFIED",
  "MODULE_DONE",
  "BLOCKED",
] as const;

export type JackyunBrowserState = (typeof jackyunBrowserStates)[number];

export type JackyunStateEvent = {
  module: JackyunModule;
  state: JackyunBrowserState;
  enteredAt: string;
  elapsedMs: number;
  evidence: Record<string, unknown>;
};

export type JackyunBrowserRunState = {
  version: 1;
  runId: string;
  policyVersion: string;
  status: "running" | "completed" | "blocked";
  currentModule: JackyunModule;
  currentState: JackyunBrowserState;
  stateEnteredAt: string;
  events: JackyunStateEvent[];
  failureCode?: string;
  failureMessage?: string;
};

const preExportResumeStates = new Set<JackyunBrowserState>([
  "PRECHECKED",
  "ENTER_MODULE",
  "VERIFY_FIELD",
  "QUERY_ONCE",
  "WAIT_TABLE_STABLE",
]);

const controllerSideEffectKeys = [
  "queryIntentAt",
  "tableStableAt",
  "expectedSourceRows",
  "exportIntentAt",
  "exportConfirmation",
  "downloadEventAt",
  "downloadProvenance",
  "filePath",
] as const;

const controllerPostQuerySideEffectKeys = controllerSideEffectKeys.filter((key) => key !== "queryIntentAt");

/**
 * A blocked run may be retried automatically only when both state files prove
 * that the current module never issued a query, armed an export, downloaded a
 * file, or handed anything to the importer.
 */
export function isSafePreExportBlockedResume(
  state: JackyunBrowserRunState,
  module: JackyunModule,
  controllerModuleState: Record<string, unknown> | null | undefined,
) {
  if (state.status !== "blocked" || state.currentState !== "BLOCKED" || state.currentModule !== module) return false;
  const moduleEvents = state.events.filter((event) => event.module === module);
  if (!moduleEvents.length || moduleEvents.some((event) => !preExportResumeStates.has(event.state))) return false;
  if (!controllerModuleState) return false;
  if (["pending", "navigated"].includes(String(controllerModuleState.status))) {
    return controllerSideEffectKeys.every((key) => controllerModuleState[key] === undefined || controllerModuleState[key] === null);
  }
  const failure = controllerModuleState.tableReadbackFailure as { code?: unknown } | null | undefined;
  const retryCount = Number(controllerModuleState.queryRetryCount ?? 0);
  return controllerModuleState.status === "queried"
    && typeof controllerModuleState.queryIntentAt === "string"
    && failure?.code === "zero_rows"
    && Number.isSafeInteger(retryCount)
    && retryCount === 0
    && controllerPostQuerySideEffectKeys.every((key) => controllerModuleState[key] === undefined || controllerModuleState[key] === null);
}

const allowedNext = new Map<JackyunBrowserState, readonly JackyunBrowserState[]>([
  ["PRECHECKED", ["ENTER_MODULE", "BLOCKED"]],
  ["ENTER_MODULE", ["VERIFY_FIELD", "QUERY_ONCE", "WAIT_TABLE_STABLE", "BLOCKED"]],
  ["VERIFY_FIELD", ["VERIFY_FIELD", "QUERY_ONCE", "WAIT_TABLE_STABLE", "BLOCKED"]],
  ["QUERY_ONCE", ["WAIT_TABLE_STABLE", "BLOCKED"]],
  ["WAIT_TABLE_STABLE", ["ARM_DOWNLOAD", "BLOCKED"]],
  ["ARM_DOWNLOAD", ["EXPORT_ONCE", "BLOCKED"]],
  ["EXPORT_ONCE", ["CONFIRM_EXPORT_DIALOG", "WAIT_EVENT_AND_FILE", "BLOCKED"]],
  ["CONFIRM_EXPORT_DIALOG", ["WAIT_EVENT_AND_FILE", "BLOCKED"]],
  ["WAIT_EVENT_AND_FILE", ["HANDOFF_EXACT_PATH", "BLOCKED"]],
  ["HANDOFF_EXACT_PATH", ["RUNNER_VERIFIED", "BLOCKED"]],
  ["RUNNER_VERIFIED", ["MODULE_DONE", "BLOCKED"]],
  ["MODULE_DONE", ["ENTER_MODULE", "BLOCKED"]],
  ["BLOCKED", []],
]);

export class JackyunBrowserStateMachine {
  private constructor(
    readonly statePath: string,
    private value: JackyunBrowserRunState,
  ) {}

  static async create(input: { statePath: string; runId: string; policyVersion: string }) {
    const state: JackyunBrowserRunState = {
      version: 1,
      runId: input.runId,
      policyVersion: input.policyVersion,
      status: "running",
      currentModule: jackyunModuleOrder[0],
      currentState: "PRECHECKED",
      stateEnteredAt: new Date().toISOString(),
      events: [],
    };
    await writeJsonAtomic(input.statePath, state);
    return new JackyunBrowserStateMachine(input.statePath, state);
  }

  static async load(statePath: string) {
    const state = await readJsonFile<JackyunBrowserRunState>(statePath);
    return new JackyunBrowserStateMachine(statePath, state);
  }

  snapshot() {
    return structuredClone(this.value);
  }

  async reconcileForResume(module: JackyunModule, evidence: Record<string, unknown> = {}) {
    if (this.value.status === "completed") throw new Error("已完成的浏览器状态机不能续跑。");
    const now = new Date().toISOString();
    const resumeState: JackyunBrowserState = this.value.currentState === "BLOCKED"
      ? "ENTER_MODULE"
      : this.value.currentState;
    this.value.events.push({
      module: this.value.currentModule,
      state: this.value.currentState,
      enteredAt: this.value.stateEnteredAt,
      elapsedMs: Math.max(0, Date.parse(now) - Date.parse(this.value.stateEnteredAt)),
      evidence: { ...evidence, resumedToModule: module, resumeState },
    });
    this.value.currentModule = module;
    if (typeof evidence.policyVersion === "string") this.value.policyVersion = evidence.policyVersion;
    this.value.currentState = resumeState;
    this.value.stateEnteredAt = now;
    this.value.status = "running";
    delete this.value.failureCode;
    delete this.value.failureMessage;
    await writeJsonAtomic(this.statePath, this.value);
  }

  async transition(module: JackyunModule, next: JackyunBrowserState, evidence: Record<string, unknown>) {
    if (this.value.status !== "running") throw new Error(`浏览器状态机已经${this.value.status}，不能继续推进。`);
    if (module !== this.value.currentModule) throw new Error(`状态机当前模块是 ${this.value.currentModule}，不能记录 ${module}。`);
    const allowed = allowedNext.get(this.value.currentState) ?? [];
    if (!allowed.includes(next)) throw new Error(`非法状态转换：${this.value.currentState} -> ${next}`);
    const now = new Date().toISOString();
    this.value.events.push({
      module,
      state: this.value.currentState,
      enteredAt: this.value.stateEnteredAt,
      elapsedMs: Date.parse(now) - Date.parse(this.value.stateEnteredAt),
      evidence,
    });
    this.value.currentState = next;
    this.value.stateEnteredAt = now;
    if (next === "MODULE_DONE") {
      const index = jackyunModuleOrder.indexOf(module);
      if (index === jackyunModuleOrder.length - 1) this.value.status = "completed";
    }
    await writeJsonAtomic(this.statePath, this.value);
  }

  async startNextModule() {
    if (this.value.currentState !== "MODULE_DONE" || this.value.status !== "running") {
      throw new Error("只有当前模块完成后才能进入下一模块。");
    }
    const index = jackyunModuleOrder.indexOf(this.value.currentModule);
    const next = jackyunModuleOrder[index + 1];
    if (!next) throw new Error("没有待执行的下一模块。");
    this.value.currentModule = next;
    this.value.currentState = "ENTER_MODULE";
    this.value.stateEnteredAt = new Date().toISOString();
    await writeJsonAtomic(this.statePath, this.value);
  }

  async block(failureCode: string, failureMessage: string, evidence: Record<string, unknown> = {}) {
    const now = new Date().toISOString();
    this.value.events.push({
      module: this.value.currentModule,
      state: this.value.currentState,
      enteredAt: this.value.stateEnteredAt,
      elapsedMs: Date.parse(now) - Date.parse(this.value.stateEnteredAt),
      evidence,
    });
    this.value.currentState = "BLOCKED";
    this.value.stateEnteredAt = now;
    this.value.status = "blocked";
    this.value.failureCode = failureCode;
    this.value.failureMessage = failureMessage;
    await writeJsonAtomic(this.statePath, this.value);
  }
}
