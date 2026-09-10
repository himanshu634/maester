import { z } from "zod";
import { IsoTimestamp, Uuid } from "./common.js";

export const MembershipRole = z.enum(["owner"]);
export const MembershipState = z.enum(["active", "revoked"]);

export const Workspace = z.object({
  id: Uuid,
  name: z.string(),
  ownerUserId: z.string(),
  locale: z.string(),
  createdAt: IsoTimestamp,
});
export type Workspace = z.infer<typeof Workspace>;

export const Membership = z.object({
  id: Uuid,
  workspaceId: Uuid,
  userId: z.string(),
  role: MembershipRole,
  state: MembershipState,
});
export type Membership = z.infer<typeof Membership>;

export const Me = z.object({
  user: z.object({ id: z.string(), name: z.string(), email: z.string() }),
  workspaces: z.array(Workspace),
});
export type Me = z.infer<typeof Me>;
