import { inArray, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { user } from "@/db/schema";
import { guardsOfUsers } from "@/features/privacy/server/guard";
import type { ScheduleType } from "../types";

/**
 * /schedule: for each host (of the listed types) who keeps their calendar private, the display
 * labels (name, else email) of everyone who may schedule for them, the host first. The loader only
 * lists hosts the viewer is allowed for, so the viewer is always one of these people.
 */
export async function loadPrivateHosts(db: DbOrTx, hostIds: readonly string[]): Promise<Map<string, NonNullable<ScheduleType["privateHost"]>>> {
  const out = new Map<string, NonNullable<ScheduleType["privateHost"]>>();
  const guards = await guardsOfUsers(db, hostIds);
  if (!guards.size) return out;
  const emails = [...new Set([...guards.values()].flatMap((g) => [g.email, ...g.delegates]))];
  const rows = await db
    .select({ email: sql<string>`lower(${user.email})`, name: user.name })
    .from(user)
    .where(inArray(sql`lower(${user.email})`, emails));
  const names = new Map(rows.map((r) => [r.email, r.name?.trim() ?? ""]));
  const label = (email: string) => names.get(email) || email;
  for (const [hostId, g] of guards) out.set(hostId, { allowed: [label(g.email), ...g.delegates.map(label)] });
  return out;
}
