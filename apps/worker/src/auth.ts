import { OAuth2Client } from "google-auth-library";
import type { WorkerEnv } from "./env.js";

export class DispatchAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DispatchAuthError";
  }
}

const oauth = new OAuth2Client();

export async function verifyDispatchRequest(env: WorkerEnv, headers: Headers): Promise<void> {
  if (env.DISPATCH_MODE === "local") {
    const secret = headers.get("x-dispatch-secret");
    if (!secret || secret !== env.DISPATCH_SECRET) throw new DispatchAuthError("missing or invalid dispatch secret");
    return;
  }
  const authz = headers.get("authorization") ?? "";
  const token = authz.startsWith("Bearer ") ? authz.slice(7) : null;
  if (!token) throw new DispatchAuthError("missing bearer token");
  let email: string | undefined;
  try {
    const ticket = await oauth.verifyIdToken({ idToken: token, audience: env.WORKER_URL });
    email = ticket.getPayload()?.email;
  } catch {
    throw new DispatchAuthError("invalid OIDC token");
  }
  if (!email || email !== env.API_SERVICE_ACCOUNT_EMAIL) throw new DispatchAuthError("token issued for an unexpected service account");
}
