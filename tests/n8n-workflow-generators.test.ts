import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Live n8n is the source of truth, and the committed JSON mirrors it. Rerunning a
// generator as documented must reproduce the committed bytes exactly; otherwise a
// regeneration silently changes production schedules or retry wiring.
const repo = fileURLToPath(new URL("../", import.meta.url));
const committedDirectory = new URL("../automation/n8n/", import.meta.url);

const generators: Array<{ command: string[]; outputs: string[] }> = [
  { command: ["tools/generate-jackyun-export-first-workflow.mjs"], outputs: ["jackyun-five-dataset-daily.workflow.json"] },
  { command: ["tools/generate-jackyun-export-first-workflow.mjs", "--direct-http"], outputs: ["jackyun-five-dataset-http.workflow.json"] },
  { command: ["tools/generate-jackyun-export-first-workflow.mjs", "--api-only"], outputs: ["jackyun-five-dataset-api.workflow.json"] },
  {
    command: ["tools/generate-jd-customer-service-workflow.mjs", "--release"],
    outputs: ["jd-customer-service-daily.candidate.workflow.json", "jd-customer-service-daily.workflow.json"],
  },
  {
    command: ["--import", "tsx", "tools/generate-jd-customer-service-store-workflows.ts"],
    outputs: [
      "jd-customer-service-chudian-daily.candidate.workflow.json",
      "jd-customer-service-cut-meat-daily.candidate.workflow.json",
      "jd-customer-service-dishwasher-daily.candidate.workflow.json",
    ],
  },
];

for (const { command, outputs } of generators) {
  test(`${command.filter(arg => arg !== "--import" && arg !== "tsx").join(" ")} reproduces the committed workflow JSON`, async () => {
    const outDir = await mkdtemp(join(tmpdir(), "teruisi-n8n-generator-"));
    try {
      const result = spawnSync(process.execPath, command, {
        cwd: repo, encoding: "utf8", env: { ...process.env, N8N_WORKFLOW_OUT_DIR: outDir }, timeout: 60000,
      });
      assert.equal(result.status, 0, `generator failed:\n${result.stderr}`);
      assert.deepEqual((await readdir(outDir)).sort(), [...outputs].sort());
      for (const fileName of outputs) {
        const generated = await readFile(join(outDir, fileName));
        const committed = await readFile(new URL(fileName, committedDirectory));
        assert.equal(generated.toString("utf8"), committed.toString("utf8"), `${fileName} drifted from its generator`);
        assert.ok(generated.equals(committed), `${fileName} differs at the byte level`);
      }
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
}

test("customer-service store candidates keep their own live schedule and retry webhook", async () => {
  const expected: Array<[string, string, string]> = [
    ["jd-customer-service-daily.workflow.json", "5 9 * * *", "每天 09:05 执行"],
    ["jd-customer-service-chudian-daily.candidate.workflow.json", "25 9 * * *", "每天 09:25 执行"],
    ["jd-customer-service-dishwasher-daily.candidate.workflow.json", "45 9 * * *", "每天 09:45 执行"],
    ["jd-customer-service-cut-meat-daily.candidate.workflow.json", "5 10 * * *", "每天 10:05 执行"],
  ];
  const paths = new Set<string>();
  for (const [fileName, cron, name] of expected) {
    const workflow = JSON.parse(await readFile(new URL(fileName, committedDirectory), "utf8"));
    const trigger = workflow.nodes.find((node: { type: string }) => node.type === "n8n-nodes-base.scheduleTrigger");
    assert.equal(trigger.parameters.rule.interval[0].expression, cron, fileName);
    assert.equal(trigger.name, name, fileName);
    assert.equal(workflow.settings.timezone, "Asia/Shanghai", fileName);
    paths.add(workflow.meta.hourlyRetryPolicy.webhookPath);
  }
  assert.equal(paths.size, expected.length);
});
