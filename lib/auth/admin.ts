import { eq, sql } from "drizzle-orm";
import { type AccessConfig, mayBecomeAdmin } from "./access";
import type { Database } from "@/db/client";
import { user } from "@/db/schema";

/**
 * First-run bootstrap (AUTH-005): promotes the given user to admin if the instance has no admin
 * yet. Runs after the user row is committed, under a global advisory lock, so two concurrent
 * first sign-ups can never both become admin. Returns true when the user was promoted.
 */
/** Serializes every change to who is an (active) admin: first-run promotion and ADM-009 actions. */
export const ADMIN_ROLE_LOCK = sql`SELECT pg_advisory_xact_lock(hashtext('opencalendar:first-admin'))`;

export async function promoteIfNoAdmin(db: Database, userId: string, access?: AccessConfig): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.execute(ADMIN_ROLE_LOCK);
    // With ADMIN_EMAIL configured only that address is ever promoted by the bootstrap.
    if (access?.adminEmail) {
      const [self] = await tx.select({ email: user.email }).from(user).where(eq(user.id, userId)).limit(1);
      if (!self || !mayBecomeAdmin(access, self.email)) return false;
    }
    const [existing] = await tx.select({ id: user.id }).from(user).where(eq(user.role, "admin")).limit(1);
    if (existing) return false;
    await tx.update(user).set({ role: "admin" }).where(eq(user.id, userId));
    return true;
  });
}
