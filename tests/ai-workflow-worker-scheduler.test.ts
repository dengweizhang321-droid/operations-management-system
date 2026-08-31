import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workerUrl = new URL("../worker/index.ts", import.meta.url);

test("scheduled and protected local ticks run one isolated workflow and one formal Agent microstep", async () => {
  const source = await readFile(workerUrl, "utf8");

  assert.match(
    source,
    /import \{ runNextAiWorkflowMicrostep \} from "\.\.\/lib\/ai\/agent-workflows";/,
  );
  assert.match(source, /import \{ runNextFormalAiAgentMicrostep \} from "\.\.\/lib\/ai\/agent-executor";/);
  assert.doesNotMatch(source, /runNextAiAgentMicrostep/);

  const maintenanceStart = source.indexOf("async function runScheduledMarketMaintenance");
  const maintenanceEnd = source.indexOf("function allowsLoopbackDevelopmentRequest", maintenanceStart);
  const maintenance = source.slice(maintenanceStart, maintenanceEnd);
  assert.ok(maintenanceStart >= 0 && maintenanceEnd > maintenanceStart);
  assert.equal(
    maintenance.match(/runNextAiWorkflowMicrostep\(\{ db, \.\.\.\(executorAdmission \? \{ executorAdmission \} : \{\}\) \}\)/g)?.length,
    1,
    "one combined scheduler tick must advance at most one workflow microstep",
  );
  assert.match(
    maintenance,
    /const aiWorkflow = await runScheduledMarketTask\([\s\S]*?selectNextWorkflowExecutorAdmission\(db\)[\s\S]*?runNextAiWorkflowMicrostep/,
  );
  assert.equal(
    maintenance.match(/runNextFormalAiAgentMicrostep\(\{ db \}\)/g)?.length,
    1,
    "one combined scheduler tick must advance at most one formal Agent microstep",
  );

  const workflowAt = maintenance.indexOf("const aiWorkflow = await runScheduledMarketTask");
  const agentAt = maintenance.indexOf("const aiAgent = await runScheduledMarketTask");
  const imageCacheAt = maintenance.indexOf("const imageCache = await runScheduledMarketTask");
  const aiSpaceAt = maintenance.indexOf("const aiSpace = await runScheduledMarketTask");
  const annotationsAt = maintenance.indexOf("const annotations = await runScheduledMarketTask");
  assert.ok(workflowAt >= 0 && workflowAt < agentAt && agentAt < imageCacheAt, "workflow and Agent queues must not starve behind image work");
  assert.ok(imageCacheAt < aiSpaceAt && aiSpaceAt < annotationsAt, "existing runner order must remain stable");
  assert.match(maintenance, /return \{ aiWorkflow, aiAgent, imageCache, annotations, aiSpace \};/);

  const localScheduled = source.slice(
    source.indexOf("if (url.pathname === localScheduledPath)"),
    source.indexOf('if (url.pathname === "/_vinext/image")'),
  );
  assert.match(localScheduled, /runScheduledMarketMaintenance\(env\.DB,/);

  const scheduled = source.slice(source.indexOf("async scheduled("));
  assert.match(scheduled, /runScheduledMarketMaintenance\(env\.DB,/);
});

test("each scheduled runner remains failure-isolated", async () => {
  const source = await readFile(workerUrl, "utf8");
  const maintenance = source.slice(
    source.indexOf("async function runScheduledMarketMaintenance"),
    source.indexOf("function allowsLoopbackDevelopmentRequest"),
  );

  for (const binding of ["aiWorkflow", "aiAgent", "imageCache", "aiSpace", "annotations"]) {
    assert.match(
      maintenance,
      new RegExp(`const ${binding} = await runScheduledMarketTask\\(`),
      `${binding} must have its own failure boundary`,
    );
  }
});
