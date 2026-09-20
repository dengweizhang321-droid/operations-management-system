export type AnnotationAgentErrorCode = "authentication" | "bad_request" | "lease_conflict";

const publicErrors: Record<AnnotationAgentErrorCode, { status: 400 | 401 | 409; message: string }> = {
  authentication: { status: 401, message: "本地 agent 认证失败" },
  bad_request: { status: 400, message: "本地 agent 请求参数无效" },
  lease_conflict: { status: 409, message: "任务 lease 已失效或发生版本冲突，请重新领取" },
};

export class AnnotationAgentError extends Error {
  readonly code: AnnotationAgentErrorCode;

  constructor(code: AnnotationAgentErrorCode) {
    super(publicErrors[code].message);
    this.name = "AnnotationAgentError";
    this.code = code;
  }
}

export function annotationAgentErrorResponse(error: unknown) {
  if (error instanceof AnnotationAgentError) {
    const detail = publicErrors[error.code];
    return { status: detail.status, error: detail.message } as const;
  }
  return { status: 500 as const, error: "本地 agent 服务暂时不可用" };
}
