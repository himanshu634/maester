import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../app.js";
import type { Auth } from "../auth.js";
import { HttpError } from "../errors.js";

export function requireSession(auth: Auth) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const result = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!result) throw new HttpError("UNAUTHENTICATED", "sign in required");
    c.set("user", { id: result.user.id, name: result.user.name, email: result.user.email });
    c.set("session", { id: result.session.id, userId: result.session.userId });
    await next();
  });
}
