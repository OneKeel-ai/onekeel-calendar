"use server";

import { z } from "zod";
import { getDb } from "@/db/client";
import { invalidatePublicContext } from "@/features/bookings/server/public-context";
import { requireAdminAction, requireUser } from "@/lib/auth/session";
import {
  adminRemoveGuard,
  adminSaveGuard,
  getGuardView,
  type GuardResult,
  type GuardView,
  listGuardViews,
  removeOwnGuard,
  saveOwnGuard,
} from "./guard";

/**
 * Private calendar settings. Authentication here; the rules (who may change which guard, the
 * team invariant) are enforced in guard.ts from the server's own records.
 */

const FIX = "Please fix the highlighted fields.";
const ADMIN_ONLY = "Only the instance admin can do that.";

// Generous raw limits: guard.ts normalizes and applies the real caps with field errors.
const lists = {
  delegates: z.array(z.string().max(320)).max(100),
  calendarAddresses: z.array(z.string().max(1024)).max(100),
};
const ownSchema = z.object(lists);
const adminSchema = z.object({ email: z.string().max(320), ...lists });
const emailOnly = z.object({ email: z.string().max(320) });

function parseFailure(error: z.ZodError): GuardResult {
  const fields = new Set(error.issues.map((i) => String(i.path[0])));
  return {
    ok: false,
    message: FIX,
    fieldErrors: {
      ...(fields.has("email") && { email: "Enter a valid email address" }),
      ...(fields.has("delegates") && { delegates: "Too many people" }),
      ...(fields.has("calendarAddresses") && { calendarAddresses: "Too many calendar addresses" }),
    },
  };
}

/** Private calendar settings change who can book publicly: drop the cached public pages. */
function changed(result: GuardResult): GuardResult {
  if (result.ok) invalidatePublicContext();
  return result;
}

export async function getMyGuardAction(): Promise<GuardView | null> {
  const user = await requireUser();
  return getGuardView(getDb(), user.email);
}

export async function saveMyGuardAction(input: { delegates: string[]; calendarAddresses: string[] }): Promise<GuardResult> {
  const user = await requireUser();
  const parsed = ownSchema.safeParse(input);
  if (!parsed.success) return parseFailure(parsed.error);
  return changed(await saveOwnGuard(getDb(), { id: user.id, email: user.email }, parsed.data));
}

export async function removeMyGuardAction(): Promise<GuardResult> {
  const user = await requireUser();
  return changed(await removeOwnGuard(getDb(), { email: user.email }));
}

/** Instance admin only; anyone else gets an empty list. */
export async function listGuardsAction(): Promise<GuardView[]> {
  const admin = await requireAdminAction();
  if (!admin) return [];
  return listGuardViews(getDb());
}

export async function adminSaveGuardAction(input: { email: string; delegates: string[]; calendarAddresses: string[] }): Promise<GuardResult> {
  const admin = await requireAdminAction();
  if (!admin) return { ok: false, message: ADMIN_ONLY };
  const parsed = adminSchema.safeParse(input);
  if (!parsed.success) return parseFailure(parsed.error);
  return changed(await adminSaveGuard(getDb(), admin.id, parsed.data));
}

export async function adminRemoveGuardAction(input: { email: string }): Promise<GuardResult> {
  const admin = await requireAdminAction();
  if (!admin) return { ok: false, message: ADMIN_ONLY };
  const parsed = emailOnly.safeParse(input);
  if (!parsed.success) return parseFailure(parsed.error);
  return changed(await adminRemoveGuard(getDb(), parsed.data));
}
