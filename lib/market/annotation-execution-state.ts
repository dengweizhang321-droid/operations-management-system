import type { AnnotationReadIssue } from "./annotation-read-channel";

/** Display only: never grants dispatch, resume or model access. */
export function annotationExecutionState(input: {
  jobStatus?: string;
  executor?: string;
  run?: { state: string; lastFailureCode: string; nextRunAt: string | null } | null;
  activeClaims?: number;
  receivedAt: number | null;
  issue: AnnotationReadIssue | null;
  now: number;
}) {
  const intent = input.run?.state === "running" ? "继续执行" : input.run?.state === "paused" ? "已暂停" : input.run?.state === "completed" ? "已结束" : "尚未确认";
  const stale = input.receivedAt === null || input.now - input.receivedAt > 30_000;
  const reading = input.issue ? input.issue.kind === "maintenance" ? "维护中，等待重新读取" : "读取失败，保留上次数据" : stale ? "等待最新状态" : "已读取最新状态";
  let execution: string;
  if (input.executor === "local") execution = ["committed", "review_ready"].includes(input.jobStatus ?? "") ? "识别已结束" : ["cancelled", "deleted"].includes(input.jobStatus ?? "") ? "任务已结束" : "由本地执行器处理";
  else if (input.issue?.kind === "maintenance") execution = "维护中，暂不派发";
  else if (input.issue || stale) execution = "暂无法核实";
  else if (input.run?.lastFailureCode === "inference_result_unknown" && input.run.state === "paused") execution = "结果待核验（已暂停）";
  else if ((input.activeClaims ?? 0) > 0) execution = input.run?.state === "paused" ? "正在完成在途图片，随后暂停" : `正在处理 ${input.activeClaims} 张`;
  else if (["committed", "review_ready"].includes(input.jobStatus ?? "")) execution = "识别已结束";
  else if (input.run?.state === "paused") execution = "已暂停派发";
  else if (input.run?.state === "running") execution = input.run.nextRunAt && Date.parse(input.run.nextRunAt) > input.now ? "等待冷却结束" : "等待后台派发";
  else execution = "尚未执行";
  return { intent, execution, reading, stale };
}
