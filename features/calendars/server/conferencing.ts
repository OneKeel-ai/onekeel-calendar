import { and, eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { credential, eventTypeLocation } from "@/db/schema";
import { CalendarUnavailableError } from "@/lib/calendars/safety";

/**
 * Conferencing readiness (INT-009): a booking that promises a Zoom link must be able to get one
 * from the ACTUAL host's own Zoom connection. Never another user's credential, never a silent
 * fallback to a different location.
 */

export type ConferencingCredentialRow = { id: string; userId?: string; provider: string; invalidAt: Date | null; createdAt: Date | null };

/**
 * The host's Zoom credential to use, chosen deterministically: Zoom only, skip ones the provider
 * rejected, newest connection first (ties broken by id). Null when none is valid.
 */
export function pickZoomCredential(rows: readonly ConferencingCredentialRow[], userId?: string): string | null {
  const valid = rows.filter((r) => r.provider === "zoom" && !r.invalidAt && (userId === undefined || r.userId === undefined || r.userId === userId));
  const sorted = valid.toSorted((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  return sorted[0]?.id ?? null;
}

/** The host's valid Zoom credential id (see `pickZoomCredential`), or null. */
export async function zoomCredentialFor(db: DbOrTx, userId: string): Promise<string | null> {
  const rows = await db
    .select({ id: credential.id, userId: credential.userId, provider: credential.provider, invalidAt: credential.invalidAt, createdAt: credential.createdAt })
    .from(credential)
    .where(and(eq(credential.userId, userId), eq(credential.provider, "zoom")));
  return pickZoomCredential(rows, userId);
}

/** Every offered location is Zoom: the invitee has no non-Zoom choice. */
export const isZoomOnly = (locations: readonly { kind: string }[]) => locations.length > 0 && locations.every((l) => l.kind === "zoom");

/**
 * Slot/booking preflight for one host and event type: a Zoom-only event type whose host has no
 * valid Zoom connection is not bookable (fails closed exactly like a missing required calendar,
 * so the slot endpoint shows no times and booking/holding refuse with CALENDAR_UNAVAILABLE).
 */
export async function assertConferencingReady(db: DbOrTx, userId: string, eventTypeId: string | undefined): Promise<void> {
  if (!eventTypeId) return;
  const locations = await db.select({ kind: eventTypeLocation.kind }).from(eventTypeLocation).where(eq(eventTypeLocation.eventTypeId, eventTypeId));
  if (!isZoomOnly(locations)) return;
  if (!(await zoomCredentialFor(db, userId))) throw new CalendarUnavailableError("missing", ["Zoom"]);
}

/** Hosts (by id) that can't provide the Zoom meeting a booker chose. Empty when all can. */
export async function hostsMissingZoom(db: DbOrTx, hostIds: readonly string[]): Promise<string[]> {
  const ids = [...new Set(hostIds)];
  const found = await Promise.all(ids.map(async (id) => ((await zoomCredentialFor(db, id)) ? null : id)));
  return found.filter((id): id is string => id !== null);
}
