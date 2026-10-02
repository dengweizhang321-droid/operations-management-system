import { writeFile } from "node:fs/promises";
import { runBusinessChecks, type ProbeScope } from "./netshop-readiness/business-check";

async function main() {
  const allowed = new Set(["base-url", "platform", "shop", "start", "end", "output"]), values = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i].replace(/^--/, ""), value = process.argv[i + 1];
    if (!process.argv[i].startsWith("--") || !allowed.has(key) || values.has(key) || !value) throw new Error("invalid_arguments");
    values.set(key, value);
  }
  if (["base-url", "platform", "shop", "start", "end"].some(k => !values.has(k))) throw new Error("usage: --base-url http://127.0.0.1:port --platform 京东|天猫 --shop exact-name --start YYYY-MM-DD --end YYYY-MM-DD [--output new-report.json]");
  const scope: ProbeScope = { platform: values.get("platform") as ProbeScope["platform"], shopName: values.get("shop")!, startDate: values.get("start")!, endDate: values.get("end")! };
  const controller = new AbortController(); const interrupt = () => controller.abort(); process.once("SIGINT", interrupt);
  try {
    const report = await runBusinessChecks(values.get("base-url")!, scope, { signal: controller.signal });
    const json = JSON.stringify(report, null, 2) + "\n";
    if (values.has("output")) await writeFile(values.get("output")!, json, { encoding: "utf8", flag: "wx" });
    process.stdout.write(json); process.exitCode = report.businessReady ? 0 : 2;
  } finally { process.removeListener("SIGINT", interrupt); }
}
main().catch(() => { process.stderr.write("Business readiness could not complete; check arguments and a new writable report path. No raw response or credentials logged.\n"); process.exitCode = 1; });
