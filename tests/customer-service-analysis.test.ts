import assert from "node:assert/strict";
import test from "node:test";
import { parseCustomerServiceAnalysisReply } from "../lib/customer-service/contracts";

test("customer-service AI analysis accepts only bounded enum values and requested ids", () => {
  const rows = parseCustomerServiceAnalysisReply(`\n\`\`\`json\n[{"id":12,"robotScope":"contains_robot","problemType":"安装使用","conversionStatus":"not_converted","serviceIssues":"未及时说明接线步骤","summaryText":"顾客咨询接线，客服给出步骤。"},{"id":99,"robotScope":"bad","problemType":"未知","conversionStatus":"converted"}]\n\`\`\``, new Set([12]));
  assert.deepEqual(rows, [{ id: 12, robotScope: "contains_robot", problemType: "安装使用", conversionStatus: "not_converted", serviceIssues: "未及时说明接线步骤", summaryText: "顾客咨询接线，客服给出步骤。" }]);
});

test("customer-service AI analysis rejects non-JSON model output", () => {
  assert.throws(() => parseCustomerServiceAnalysisReply("分析完成", new Set([1])), /有效 JSON/);
});
