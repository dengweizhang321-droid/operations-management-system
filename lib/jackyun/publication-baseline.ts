import path from "node:path";
import { lstat, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { readJsonDurableOr as readJsonFileOr, writeJsonDurable } from "./json-file";
import { jackyunModuleOrder, type JackyunModule } from "./post-download";
import { jackyunSalesPeriod } from "./sales-period";
import { isDeepStrictEqual } from "node:util";

export type PublicationBaseline = { version: "jackyun-publication-baseline-v2"; runId: string; runDate: string; asOfDate: string;
  salesStartDate: string; at: string; tokens: Record<JackyunModule, string>;
  rules: { client: string; domains: Record<JackyunModule, string> } };
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function clientRulesDigest(root: string) {
  if (!process.argv[1]) throw new Error("缺少可信执行器规则身份，禁止接续原校验集合。");
  const files = [["execution", path.resolve(process.argv[1])],
    ...["sales-import-policy.json", "inventory-warehouse-mapping.json", "jackyun-export-first-policy.json"].map(name => [name, path.join(root, "config", name)])];
  const identities: Record<string, string | null> = {};
  for (const [name, file] of files) {
    const info = await lstat(file).catch(error => { if (error.code === "ENOENT" && name !== "execution") return null; throw error; });
    if (!info) { identities[name] = null; continue; }
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 32 * 1024 * 1024) throw new Error("校验规则文件身份异常。");
    identities[name] = sha(await readFile(file));
  }
  return sha(Buffer.from(JSON.stringify(identities)));
}
export function recoveryUploadFingerprint(runId: string, moduleKey: JackyunModule, rawHash: string, token: string) {
  if (!/^[A-Za-z0-9._-]{1,96}$/.test(runId) || !/^[a-f0-9]{64}$/.test(rawHash) || !/^(?:[a-f0-9]{64}|initial)$/.test(token)) throw new Error("原采集发布基线无效。");
  const result = `jky-recovery-v1:${runId}:${moduleKey}:${rawHash}:${token}`;
  if (result.length > 200) throw new Error("上传恢复身份超过上限。");
  return result;
}
export function importRecoveryQuery(moduleKey: JackyunModule, plan: { runDate: string; asOfDate: string; salesStartDate?: string }, kind: "scope" | "result") {
  const query = new URLSearchParams({ module: moduleKey, recovery: kind });
  if (moduleKey === "inventory" || moduleKey === "inventory_age") query.set("snapshotDate", plan.runDate);
  if (moduleKey === "sales") {
    query.set("startDate", jackyunSalesPeriod(plan.asOfDate, plan.salesStartDate).startDate);
    query.set("endDate", plan.asOfDate); query.set("channels", "null");
  }
  return query;
}
export function importRecoveryScope(moduleKey: JackyunModule, plan: { runDate: string; asOfDate: string; salesStartDate?: string }) {
  return moduleKey === "inventory" || moduleKey === "inventory_age" ? { dataset: moduleKey === "inventory" ? "stock" : "age", snapshotDate: plan.runDate }
    : moduleKey === "sales" ? { source: "sales_ledger", startDate: jackyunSalesPeriod(plan.asOfDate, plan.salesStartDate).startDate, endDate: plan.asOfDate }
      : { source: moduleKey };
}
export async function collectionPublicationBaseline(root: string, plan: { runId: string; runDate: string; asOfDate: string; salesStartDate?: string },
  options: { allowCapture: boolean; request: typeof fetch; baseUrl: string; assertOwned: () => Promise<void>; at: string }) {
  if (!/^[A-Za-z0-9._-]{1,96}$/.test(plan.runId)) throw new Error("采集基线运行无效。");
  const file = path.join(root, "outputs/jackyun-export-first/publication-baselines", `${plan.runId}.json`);
  const info = await lstat(file).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  if (info && (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 8192)) throw new Error("采集基线文件身份异常。");
  const existing = await readJsonFileOr<PublicationBaseline | null>(file, null);
  const start = jackyunSalesPeriod(plan.asOfDate, plan.salesStartDate).startDate;
  if (existing) {
    if (Object.keys(existing).sort().join() !== ["version", "runId", "runDate", "asOfDate", "salesStartDate", "at", "tokens", "rules"].sort().join()
      || existing.version !== "jackyun-publication-baseline-v2" || existing.runId !== plan.runId || existing.runDate !== plan.runDate
      || existing.asOfDate !== plan.asOfDate || existing.salesStartDate !== start || !Number.isFinite(Date.parse(existing.at))
      || !existing.tokens || Object.keys(existing.tokens).sort().join() !== [...jackyunModuleOrder].sort().join()
      || Object.values(existing.tokens).some(v => !/^(?:[a-f0-9]{64}|initial)$/.test(v))
      || !existing.rules || Object.keys(existing.rules).sort().join() !== "client,domains"
      || !/^[a-f0-9]{64}$/.test(existing.rules.client) || !existing.rules.domains
      || Object.keys(existing.rules.domains).sort().join() !== [...jackyunModuleOrder].sort().join()
      || Object.values(existing.rules.domains).some(v => !/^[a-f0-9]{64}$/.test(v))) throw new Error("原采集发布基线缺少完整规则证明或已损坏，禁止重读当前版本冒充原基线。");
    await options.assertOwned();
    if (existing.rules.client !== await clientRulesDigest(root)) throw new Error("JACKYUN_RULES_CHANGED_MANUAL_ACTION：原执行器或校验规则已变化，禁止混用旧准备文件；请核查原规则和当前版本。");
    for (const moduleKey of jackyunModuleOrder) {
      const response = await options.request(`${options.baseUrl}/api/imports/recovery?${importRecoveryQuery(moduleKey, plan, "scope")}`, { cache: "no-store", signal: AbortSignal.timeout(30000) });
      const result = await response.json() as { ok?: boolean; version?: string; scope?: unknown; rulesDigest?: string };
      await options.assertOwned();
      if (!response.ok || result.ok !== true || result.version !== "import-recovery-query-v1"
        || !isDeepStrictEqual(result.scope, importRecoveryScope(moduleKey, plan)) || result.rulesDigest !== existing.rules.domains[moduleKey]) {
        throw new Error("JACKYUN_RULES_CHANGED_MANUAL_ACTION：原领域规则身份已变化或无法确认，保留原准备文件并停止；禁止重读新规则冒充原基线。");
      }
    }
    return existing;
  }
  if (!options.allowCapture) throw new Error("原采集缺少发布范围基线，只能核验已提交结果；禁止旧文件覆盖新数据。");
  const tokens = {} as Record<JackyunModule, string>;
  const client = await clientRulesDigest(root), domains = {} as Record<JackyunModule, string>;
  for (const moduleKey of jackyunModuleOrder) {
    await options.assertOwned();
    const response = await options.request(`${options.baseUrl}/api/imports/recovery?${importRecoveryQuery(moduleKey, plan, "scope")}`, { cache: "no-store", signal: AbortSignal.timeout(30000) });
    const result = await response.json() as { ok?: boolean; version?: string; stateToken?: string; status?: string; scope?: unknown; rulesDigest?: string };
    await options.assertOwned();
    if (!response.ok || result.ok !== true || result.version !== "import-recovery-query-v1" || result.status !== "ready"
      || !isDeepStrictEqual(result.scope, importRecoveryScope(moduleKey, plan))
      || !/^(?:[a-f0-9]{64}|initial)$/.test(result.stateToken ?? "") || !/^[a-f0-9]{64}$/.test(result.rulesDigest ?? "")) throw new Error(`${moduleKey} 原采集范围版本或领域规则未通过核验，请等待或核查权限。`);
    tokens[moduleKey] = result.stateToken!;
    domains[moduleKey] = result.rulesDigest!;
  }
  if (client !== await clientRulesDigest(root)) throw new Error("校验规则在采集基线建立期间发生变化，保留原计划并停止。");
  const value: PublicationBaseline = { version: "jackyun-publication-baseline-v2", runId: plan.runId, runDate: plan.runDate,
    asOfDate: plan.asOfDate, salesStartDate: start, at: options.at, tokens, rules: { client, domains } };
  await options.assertOwned(); await writeJsonDurable(file, value, true); await options.assertOwned();
  return value;
}
