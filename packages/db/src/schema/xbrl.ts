import { sql } from "drizzle-orm";
import { boolean, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { financialFact } from "./extraction.js";
import { document, ts, workspace } from "./platform.js";

/** Where an XBRL fact was read: the element and context in the instance, and the rounding it declared. */
export const xbrlSource = pgTable(
  "xbrl_source",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspace.id),
    factId: uuid("fact_id").notNull().references(() => financialFact.id),
    documentId: uuid("document_id").notNull().references(() => document.id),
    element: text("element").notNull(),
    contextId: text("context_id").notNull(),
    /** The fact's `decimals` as written: `"INF"` or an integer, as text. */
    decimals: text("decimals"),
    /** True when the fact is `xsi:nil`; the fact is then `unparsed`, never zero. */
    nil: boolean("nil").notNull().default(false),
    /** The element map's concept when the fact was written, so a later map does not change what a read meant. */
    concept: text("concept"),
    footnoteIds: text("footnote_ids").array().notNull().default(sql`'{}'::text[]`),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("xbrl_source_fact").on(t.factId)],
);

export type XbrlSourceRow = typeof xbrlSource.$inferSelect;
