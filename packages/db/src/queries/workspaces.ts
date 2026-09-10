import { and, eq } from "drizzle-orm";
import type { Db } from "../client.js";
import { membership, workspace, type MembershipRow, type WorkspaceRow } from "../schema/platform.js";

export async function listWorkspacesForUser(db: Db, userId: string): Promise<WorkspaceRow[]> {
  const rows = await db
    .select({ workspace })
    .from(membership)
    .innerJoin(workspace, eq(membership.workspaceId, workspace.id))
    .where(and(eq(membership.userId, userId), eq(membership.state, "active")))
    .orderBy(workspace.createdAt);
  return rows.map((r) => r.workspace);
}

export async function getWorkspaceForUser(
  db: Db,
  userId: string,
  workspaceId: string,
): Promise<{ workspace: WorkspaceRow; membership: MembershipRow } | null> {
  const rows = await db
    .select({ workspace, membership })
    .from(membership)
    .innerJoin(workspace, eq(membership.workspaceId, workspace.id))
    .where(and(eq(membership.userId, userId), eq(membership.workspaceId, workspaceId), eq(membership.state, "active")))
    .limit(1);
  return rows[0] ?? null;
}

export async function ensurePersonalWorkspace(
  db: Db,
  input: { userId: string; userName: string },
): Promise<WorkspaceRow> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ workspace })
      .from(membership)
      .innerJoin(workspace, eq(membership.workspaceId, workspace.id))
      .where(and(eq(membership.userId, input.userId), eq(membership.role, "owner"), eq(membership.state, "active")))
      .limit(1);
    if (existing[0]) return existing[0].workspace;

    const [created] = await tx
      .insert(workspace)
      .values({ id: crypto.randomUUID(), name: `${input.userName}'s workspace`, ownerUserId: input.userId })
      .returning();
    await tx.insert(membership).values({
      id: crypto.randomUUID(),
      workspaceId: created!.id,
      userId: input.userId,
      role: "owner",
      state: "active",
    });
    return created!;
  });
}
