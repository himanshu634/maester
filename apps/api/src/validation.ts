import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { ZodType } from "zod";
import { errorBody } from "./errors.js";

export function validate<T extends ZodType, Target extends keyof ValidationTargets>(target: Target, schema: T) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      const fields = result.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message }));
      const traceId = (c.get("traceId" as never) as string | undefined) ?? "unknown";
      return c.json(errorBody("VALIDATION_FAILED", "request validation failed", traceId, fields), 400);
    }
  });
}
