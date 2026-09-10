import type { Context } from "hono";
import { HttpError } from "../errors.js";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuidParam(c: Context, name: string): string {
  const value = c.req.param(name);
  if (!value || !UUID.test(value)) throw new HttpError("NOT_FOUND", `${name} not found`);
  return value;
}
