import { z } from "zod";

export const ErrorCode = z.enum([
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION_FAILED",
  "CONFLICT",
  "UPLOAD_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "INVALID_STATE",
  "RATE_LIMITED",
  "INTERNAL",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const FieldError = z.object({ path: z.string(), message: z.string() });
export type FieldError = z.infer<typeof FieldError>;

export const ApiError = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    fields: z.array(FieldError).optional(),
    traceId: z.string(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

export const IsoTimestamp = z.iso.datetime({ offset: true });
export const DecimalString = z.string().regex(/^-?\d+(\.\d+)?$/, "decimal string");
export const Uuid = z.uuid();

export const ListQuery = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListQuery = z.infer<typeof ListQuery>;

export function paginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}
