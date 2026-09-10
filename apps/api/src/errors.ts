import type { ErrorCode, FieldError } from "@maester/contracts";

export const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 400,
  CONFLICT: 409,
  UPLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  INVALID_STATE: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export class HttpError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly fields?: FieldError[],
  ) {
    super(message);
    this.name = "HttpError";
    this.status = STATUS[code];
  }
}

export function errorBody(code: ErrorCode, message: string, traceId: string, fields?: FieldError[]) {
  return { error: { code, message, ...(fields && fields.length ? { fields } : {}), traceId } };
}
