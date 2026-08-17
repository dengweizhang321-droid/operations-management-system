export type ApiErrorOptions = {
  status: number;
  code?: string;
  message: string;
  details?: unknown;
  cause?: unknown;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly details: unknown;

  constructor({ status, code, message, details, cause }: ApiErrorOptions) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
