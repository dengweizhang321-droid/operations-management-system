import path from "node:path";

import { ClosureRefusal, assertConfirmMode, readControlFile, sha256 } from "../lib/closure/kernel";
import { inspectJdLogisticsZeroEffect } from "./jd-logistics-zero-effect-closure";
import {
  TMALL_DIRECT_MASTER_ABANDON_ACTION,
  abandonTmallDirectMasterBatchContentMismatch,
  activeAuditPath,
  defaultDirectAuditDirectory,
  type AbandonOptions,
} from "./tmall-direct-master-abandon";
import {
  TMALL_DIRECT_PROMOTION_ADMIN_ACTIONS,
  abandonExpiredPromotion,
  inspectPromotionAudit,
  probePromotionAudit,
  resolveSubmittingPromotion,
  type PromotionAdminOptions,
} from "./tmall-direct-promotion-admin-core";

/**
 * Table-driven registry behind tools/closure-admin.ts. Each pipeline keeps its own judgement; the CLI layer only
 * validates the shared confirmation protocol and prints one JSON shape. Not part of the helper bundle closure
 * (a test pins that), and free of module-URL metadata so tests can import it.
 */
export type ClosureArgs = {
  storeKey?: string; reason?: string; expectSha256?: string; root?: string; auditDirectory?: string;
  dryRun: boolean; confirmed: boolean;
};
/** Test seams only; the CLI never sets them. */
export type ClosureDeps = {
  master?: Partial<AbandonOptions>;
  promotion?: Partial<PromotionAdminOptions>;
};
export type ClosureContext = { args: ClosureArgs; deps: ClosureDeps };
export type ClosureAction = (context: ClosureContext) => Promise<Record<string, unknown>>;
export type ClosureAdapter = { name: string; description: string; actions: Record<string, ClosureAction>; mutating: ReadonlySet<string> };

function fail(reason: string, message: string): never { throw new ClosureRefusal(reason, message); }
const needStore = (args: ClosureArgs) => args.storeKey ?? fail("store_key_required", "必须提供 --store-key");

const jdLogistics: ClosureAdapter = {
  name: "jd-logistics",
  description: "京东物流零效果闭合：仅检查；失败计划由下一轮 A 在计划锁内自动闭合，无人工 mutation",
  mutating: new Set(),
  actions: {
    inspect: async ({ args }) => {
      const root = path.resolve(args.root ?? process.cwd());
      return { root, note: "只读判定；闭合由下一轮 A 自动执行，没有人工 mutation 动作", ...await inspectJdLogisticsZeroEffect(root) };
    },
  },
};

const masterDirectory = (args: ClosureArgs) => path.resolve(args.auditDirectory ?? defaultDirectAuditDirectory());
const tmallDirectMaster: ClosureAdapter = {
  name: "tmall-direct-master",
  description: "天猫直连货品批次内容串单作废（先 --dry-run，再 --confirm --expect-sha256 <活动清单摘要> --reason）",
  mutating: new Set([TMALL_DIRECT_MASTER_ABANDON_ACTION]),
  actions: {
    [TMALL_DIRECT_MASTER_ABANDON_ACTION]: async ({ args, deps }) => {
      const storeKey = needStore(args);
      const bytes = await readControlFile(activeAuditPath(storeKey, masterDirectory(args)), 4 * 1024 * 1024,
        reason => fail(reason, "活动清单不是普通单链接文件或已变化"));
      const activeSha = bytes ? sha256(bytes) : null;
      if (args.confirmed) {
        if (!activeSha) fail("no_active_audit", "当前店铺不存在可作废的直连货品活动清单");
        if (activeSha !== args.expectSha256) fail("sha256_mismatch", "活动清单字节与 --expect-sha256 不一致（已变化），拒绝处理，请重新 --dry-run");
      }
      const result = await abandonTmallDirectMasterBatchContentMismatch({
        storeKey, reason: args.reason ?? "", operatorConfirmed: args.confirmed, dryRun: args.dryRun,
        auditDirectory: args.auditDirectory, ...deps.master,
      });
      return { ...result, ...(args.dryRun && activeSha ? { expectSha256: activeSha } : {}) };
    },
  },
};

const promotionOptions = ({ args, deps }: ClosureContext): PromotionAdminOptions => ({
  storeKey: needStore(args), reason: args.reason, expectSha256: args.expectSha256,
  operatorConfirmed: args.confirmed, dryRun: args.dryRun, auditDirectory: args.auditDirectory, ...deps.promotion,
});
const tmallDirectPromotion: ClosureAdapter = {
  name: "tmall-direct-promotion",
  description: "天猫直连推广活动清单：inspect/probe 只读；resolve-submitting 与 abandon-expired 先 --dry-run 再 --confirm --expect-sha256 --reason",
  mutating: new Set(["resolve-submitting", "abandon-expired"]),
  actions: {
    inspect: async context => ({ ...await inspectPromotionAudit(promotionOptions(context)) }),
    probe: async context => ({ ...await probePromotionAudit(promotionOptions(context)) }),
    "resolve-submitting": async context => ({ ...await resolveSubmittingPromotion(promotionOptions(context)) }),
    "abandon-expired": async context => ({ ...await abandonExpiredPromotion(promotionOptions(context)) }),
  },
};
// The registry must expose exactly the actions the promotion admin core defines.
for (const action of TMALL_DIRECT_PROMOTION_ADMIN_ACTIONS) {
  if (!(action in tmallDirectPromotion.actions)) throw new Error(`closure adapter 缺少动作 ${action}`);
}

export const CLOSURE_ADAPTERS: readonly ClosureAdapter[] = [jdLogistics, tmallDirectMaster, tmallDirectPromotion];

// ---------------------------------------------------------------------------------------------------------
// Argument parsing and the single JSON output shape
// ---------------------------------------------------------------------------------------------------------
const valueFlags = {
  "--pipeline": "pipeline", "--action": "action", "--store-key": "storeKey", "--reason": "reason",
  "--expect-sha256": "expectSha256", "--root": "root", "--audit-directory": "auditDirectory",
} as const;
type ValueKey = typeof valueFlags[keyof typeof valueFlags];

export function parseClosureArgv(argv: readonly string[]) {
  const values: Partial<Record<ValueKey, string>> = {};
  let dryRun = false, confirmed = false;
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index]!;
    if (flag === "--dry-run" || flag === "--confirm") {
      if (flag === "--dry-run" ? dryRun : confirmed) fail("duplicate_argument", `${flag} 重复`);
      if (flag === "--dry-run") dryRun = true; else confirmed = true;
      continue;
    }
    const key = (valueFlags as Record<string, ValueKey | undefined>)[flag];
    if (!key) fail("unknown_argument", `未知参数 ${flag}`);
    if (values[key!] !== undefined) fail("duplicate_argument", `${flag} 重复`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) fail("argument_missing_value", `${flag} 缺少参数值`);
    values[key!] = value;
    index++;
  }
  const { pipeline, action, ...rest } = values;
  return { pipeline, action, args: { ...rest, dryRun, confirmed } as ClosureArgs };
}

export type ClosureOutput = { exitCode: 0 | 1; output: Record<string, unknown> };
export async function runClosureAdmin(argv: readonly string[], deps: ClosureDeps = {}): Promise<ClosureOutput> {
  let pipeline: string | undefined, action: string | undefined;
  try {
    const parsed = parseClosureArgv(argv);
    ({ pipeline, action } = parsed);
    if (!pipeline || !action) fail("missing_argument", "必须提供 --pipeline 与 --action");
    const adapter = CLOSURE_ADAPTERS.find(candidate => candidate.name === pipeline);
    if (!adapter) return fail("unknown_pipeline", `未知 pipeline ${pipeline}；可用：${CLOSURE_ADAPTERS.map(item => item.name).join(" | ")}`);
    const handler = Object.hasOwn(adapter.actions, action!) ? adapter.actions[action!] : undefined;
    if (!handler) return fail("unknown_action", `${pipeline} 不支持动作 ${action}；可用：${Object.keys(adapter.actions).join(" | ")}`);
    const { args } = parsed;
    if (adapter.mutating.has(action!)) {
      assertConfirmMode({ dryRun: args.dryRun, confirmed: args.confirmed, expectSha256: args.expectSha256, reason: args.reason });
    } else if (args.dryRun || args.confirmed || args.expectSha256 !== undefined || args.reason !== undefined) {
      fail("readonly_action_flags", `${pipeline}/${action} 是只读动作，不接受 --dry-run/--confirm/--expect-sha256/--reason`);
    }
    const result = await handler({ args, deps });
    return { exitCode: 0, output: { ...result, ok: true, pipeline, action } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const reason = (error as { reason?: unknown }).reason;
    return {
      exitCode: 1,
      output: {
        ok: false, pipeline: pipeline ?? null, action: action ?? null, reason: typeof reason === "string" ? reason : "error",
        error: message.replace(/[\r\n]+/g, " ").slice(0, 500),
      },
    };
  }
}
