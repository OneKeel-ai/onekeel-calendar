import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth";

/**
 * Private calendars ("calendar guard"). A row means the person with this account email keeps
 * their calendar private: only they and their `delegates` may see their free/busy time, schedule
 * for them, or see and manage their meetings. Everything is stored lower-case.
 */
export const calendarGuard = pgTable("calendar_guard", {
  /** Lower-cased account email of the protected person (the account may not exist yet). */
  email: text("email").primaryKey(),
  /** Lower-cased emails of the people allowed besides the person themself. */
  delegates: jsonb("delegates").$type<string[]>().notNull().default([]),
  /** Extra calendar ids/addresses to protect (lower-cased); the account email is always protected. */
  calendarAddresses: jsonb("calendar_addresses").$type<string[]>().notNull().default([]),
  createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
