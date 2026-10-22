import { listWorkspacesForUser, normalizeEmail, type Db, type WorkspaceRow } from "@maester/db";
import { SettingsError, type Settings } from "./settings.js";

/**
 * The one workspace this server reads: `MAESTER_WORKSPACE_ID` when set (it wins), else the first workspace, by creation
 * time, of the user with `MAESTER_USER_EMAIL`. A miss is a `SettingsError` naming the setting to fix.
 */
export async function resolveWorkspace(db: Db, settings: Settings): Promise<WorkspaceRow> {
  if (settings.workspaceId !== null) {
    const found = await db.query.workspace.findFirst({ where: (w, { eq }) => eq(w.id, settings.workspaceId!) });
    if (!found) throw new SettingsError("MAESTER_WORKSPACE_ID", "no such workspace");
    return found;
  }
  const email = normalizeEmail(settings.userEmail ?? "");
  const user = await db.query.user.findFirst({ where: (u, { sql }) => sql`lower(${u.email}) = ${email}` });
  const first = user ? (await listWorkspacesForUser(db, user.id))[0] : undefined;
  if (!first) throw new SettingsError("MAESTER_USER_EMAIL", "no user with a workspace");
  return first;
}
