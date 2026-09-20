export const customerServiceRobotScopes = ["robot_only", "contains_robot", "exclude_robot"] as const;
export const customerServiceProblemTypes = ["商品咨询", "价格优惠", "物流发货", "售后维修", "退换货", "安装使用", "发票开票", "催单改单", "其他"] as const;
export const customerServiceConversionStatuses = ["converted", "not_converted", "unknown"] as const;
export type CustomerServiceRobotScope = (typeof customerServiceRobotScopes)[number];
export type CustomerServiceProblemType = (typeof customerServiceProblemTypes)[number];
export type CustomerServiceConversionStatus = (typeof customerServiceConversionStatuses)[number];
export type CustomerServiceAnnotationInput = Partial<{ robotScope: CustomerServiceRobotScope; problemType: CustomerServiceProblemType; conversionStatus: CustomerServiceConversionStatus; serviceIssues: string; summaryText: string; analysisSource: "ai" | "manual" }>;

export type CustomerServiceAnalysisResult = {
  id: number;
  robotScope: CustomerServiceRobotScope;
  problemType: CustomerServiceProblemType;
  conversionStatus: CustomerServiceConversionStatus;
  serviceIssues: string;
  summaryText: string;
};

function cleanText(value: unknown, limit: number) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

export function parseCustomerServiceAnalysisReply(reply: string, allowedIds: Set<number>): CustomerServiceAnalysisResult[] {
  const fenced = reply.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const start = reply.indexOf("[");
  const end = reply.lastIndexOf("]");
  const source = fenced ?? (start >= 0 && end > start ? reply.slice(start, end + 1) : reply);
  let parsed: unknown;
  try { parsed = JSON.parse(source); } catch { throw new Error("AI 返回内容不是有效 JSON，请重试"); }
  if (!Array.isArray(parsed)) throw new Error("AI 返回内容缺少分析结果数组");
  const results: CustomerServiceAnalysisResult[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const id = Number(row.id);
    const robotScope = row.robotScope as CustomerServiceRobotScope;
    const problemType = row.problemType as CustomerServiceProblemType;
    const conversionStatus = row.conversionStatus as CustomerServiceConversionStatus;
    if (!allowedIds.has(id) || !customerServiceRobotScopes.includes(robotScope) || !customerServiceProblemTypes.includes(problemType) || !customerServiceConversionStatuses.includes(conversionStatus)) continue;
    results.push({ id, robotScope, problemType, conversionStatus, serviceIssues: cleanText(row.serviceIssues, 1000), summaryText: cleanText(row.summaryText, 1000) });
  }
  if (!results.length) throw new Error("AI 未返回可保存的分析结果");
  return results;
}
