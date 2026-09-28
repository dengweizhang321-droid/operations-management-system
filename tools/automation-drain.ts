import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";

export const automationDrainProtocol = "teruisi-automation-drain-v1";
export const automationRuntime = "D:\\teruisi-runtime\\django-sales";

export function readAutomationDrain(runtime = automationRuntime): { id: string; phase: string } | null {
  const file = path.join(runtime, "run", "automation-drain.json");
  try {
    for (let cursor = file; ; cursor = path.dirname(cursor)) {
      const info = lstatSync(cursor);
      if (info.isSymbolicLink() || (cursor === file && (!info.isFile() || info.nlink !== 1 || info.size > 4096))) {
        throw new Error("invalid_automation_drain_path");
      }
      if (path.dirname(cursor) === cursor) break;
    }
    const gate = JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
    if (gate.version !== automationDrainProtocol || !/^[a-f0-9]{32}$/.test(gate.id)
      || !["helpers", "requests"].includes(gate.phase)
      || typeof gate.runtimeRoot !== "string" || path.resolve(gate.runtimeRoot).toLowerCase() !== path.resolve(runtime).toLowerCase()) {
      throw new Error("invalid_automation_drain_record");
    }
    return { id: gate.id, phase: gate.phase };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
