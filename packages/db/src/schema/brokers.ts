import { sql } from "drizzle-orm";
import { check, index, integer, numeric, pgTable, primaryKey, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth.js";
import { ts, workspace } from "./platform.js";

/**
 * One broker account in a workspace (Holdings). `broker` is a broker plugin's id. The
 * credentials (a JSON object of the plugin's credential keys) and the day's access token are
 * kept only as AES-256-GCM ciphertext under CONNECTIONS_KEY. Disconnecting clears both and keeps
 * the row, so the holdings it read stay, with their dates.
 */
export const brokerConnection = pgTable("broker_connection", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspace.id),
  broker: text("broker").notNull(),
  credentialsCiphertext: text("credentials_ciphertext"),
  keyLast4: text("key_last4"),
  accountId: text("account_id"),
  tokenCiphertext: text("token_ciphertext"),
  signedInAt: ts("signed_in_at"),
  tokenExpiresAt: ts("token_expires_at"),
  /** Set when the broker refused the session before its expiry (BROKER_SIGNED_OUT), or a read failed. */
  lastErrorCode: text("last_error_code"),
  savedAt: ts("saved_at").notNull().defaultNow(),
  savedByUserId: text("saved_by_user_id").references(() => user.id, { onDelete: "set null" }),
}, (t) => [uniqueIndex("broker_connection_workspace_broker").on(t.workspaceId, t.broker)]);
export type BrokerConnectionRow = typeof brokerConnection.$inferSelect;
export type NewBrokerConnection = typeof brokerConnection.$inferInsert;

/** A single-use nonce for one trip to the broker's login page, valid for 10 minutes. */
export const brokerLoginState = pgTable("broker_login_state", {
  nonce: text("nonce").primaryKey(),
  connectionId: uuid("connection_id").notNull().references(() => brokerConnection.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  expiresAt: ts("expires_at").notNull(),
});
export type BrokerLoginStateRow = typeof brokerLoginState.$inferSelect;

/** One read of a broker account's holdings. Its lines never change. */
export const holdingRead = pgTable("holding_read", {
  id: uuid("id").primaryKey(),
  connectionId: uuid("connection_id").notNull().references(() => brokerConnection.id, { onDelete: "cascade" }),
  startedAt: ts("started_at").notNull().defaultNow(),
  finishedAt: ts("finished_at"),
  state: text("state", { enum: ["running", "ok", "failed"] }).notNull(),
  errorCode: text("error_code"),
  lineCount: integer("line_count"),
}, (t) => [
  check("holding_read_state", sql`${t.state} in ('running', 'ok', 'failed')`),
  index("holding_read_connection_started").on(t.connectionId, t.startedAt),
]);
export type HoldingReadRow = typeof holdingRead.$inferSelect;

/** One holding as the broker reported it in one read: facts, as printed. */
export const holdingLine = pgTable("holding_line", {
  readId: uuid("read_id").notNull().references(() => holdingRead.id, { onDelete: "cascade" }),
  isin: text("isin").notNull(),
  exchange: text("exchange").notNull(),
  symbol: text("symbol").notNull(),
  quantity: numeric("quantity").notNull(),
  t1Quantity: numeric("t1_quantity").notNull(),
  averagePrice: numeric("average_price").notNull(),
  lastPrice: numeric("last_price"),
}, (t) => [primaryKey({ name: "holding_line_pk", columns: [t.readId, t.isin, t.exchange] })]);
export type HoldingLineRow = typeof holdingLine.$inferSelect;
export type NewHoldingLine = typeof holdingLine.$inferInsert;
