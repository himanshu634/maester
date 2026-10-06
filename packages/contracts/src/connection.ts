import { z } from "zod";
import { IsoTimestamp } from "./common.js";

/** A market data source the user connects with their own key, in Settings. */
export const ConnectionProvider = z.enum(["dhan", "fred"]);
export type ConnectionProvider = z.infer<typeof ConnectionProvider>;

/**
 * One saved (or unsaved) connection. The key itself is never sent; `last4` is its last 4 characters.
 * - `expired`: Dhan's token is past its expiry, or Dhan last refused it.
 * - `failing`: the source's last call failed for another reason.
 */
export const Connection = z.object({
  provider: ConnectionProvider,
  state: z.enum(["not_connected", "connected", "expired", "failing"]),
  clientId: z.string().nullable(),
  last4: z.string().nullable(),
  expiresAt: IsoTimestamp.nullable(),
  checkedAt: IsoTimestamp.nullable(),
  /** When readings from this source were last stored. */
  lastRead: IsoTimestamp.nullable(),
  /** Only on the answer to a save: Dhan took the token but the Data API subscription is off. */
  notice: z.enum(["DATA_PLAN_INACTIVE"]).nullable(),
});
export type Connection = z.infer<typeof Connection>;

/** Always two items, Dhan first. */
export const ConnectionList = z.object({ items: z.array(Connection) });
export type ConnectionList = z.infer<typeof ConnectionList>;

export const SaveDhanConnectionRequest = z.object({
  clientId: z.string().trim().min(1).max(32),
  accessToken: z.string().trim().min(20).max(4096),
});
export type SaveDhanConnectionRequest = z.infer<typeof SaveDhanConnectionRequest>;

/** FRED keys are 32 lower-case letters and digits. */
export const SaveFredConnectionRequest = z.object({
  apiKey: z.string().trim().regex(/^[a-z0-9]{32}$/, "A FRED API key is 32 lower-case letters and digits."),
});
export type SaveFredConnectionRequest = z.infer<typeof SaveFredConnectionRequest>;
