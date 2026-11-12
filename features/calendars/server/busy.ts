import { and, desc, eq, gte, inArray, lt, lte } from "drizzle-orm";
import type { Database } from "@/db/client";
import { booking, bookingReference, calendarBusyCache, connectedCalendar, credential, destinationCalendar, eventType, eventTypeConflictCalendar } from "@/db/schema";
import type { Interval } from "@/lib/availability/types";
import { assertCalendarsUsable, assertDestinationUsable, busyModeFor, type DestinationState, isCalendarRequired, resolveProviderFailure } from "@/lib/calendars/safety";
import { getProvider } from "@/lib/integrations/registry";
import type { BusyInterval, ProviderId } from "@/lib/integrations/types";
import { errorSummary, logger } from "@/lib/logger";
import { isHostOf } from "@/features/bookings/server/core";
import { selectConflictCalendars } from "./conflict-note";
import { blockedCalendarAddressesFor, isBlockedCalendar } from "@/features/privacy/server/guard";
import { assertConferencingReady } from "./conferencing";
import { type IntegrationDeps, withCredential } from "./credentials";

/**
 * External busy times for slot computation (AVL-006/007):
 * cache per calendar + window, short TTLs, parallel fetch with a timeout, stale cache on
 * failure, and fail closed (whole window busy) when nothing is known. Events OpenCalendar
 * created itself are ignored because the bookings already count.
 */

export const CACHE_TTL_MS: Record<ProviderId, number> = {
  google: 2 * 60_000,
  microsoft: 2 * 60_000,
  zoom: 0,
  caldav: 5 * 60_000,
  ics_feed: 5 * 60_000,
};

/**
 * Polling interval per provider (AVL-007): CALENDAR_POLL_SECONDS (default 5 min) for CalDAV and
 * ICS feeds; Google and Microsoft are re-read at least every 2 minutes (push notifications, which
 * would invalidate them sooner, are not implemented yet).
 */
export function cacheTtlMs(provider: string, pollSeconds: number | undefined): number {
  const base = CACHE_TTL_MS[provider as ProviderId] ?? 60_000;
  if (pollSeconds === undefined) return base;
  const configured = pollSeconds * 1000;
  return provider === "google" || provider === "microsoft" ? Math.min(base, configured) : provider === "zoom" ? 0 : configured;
}
export const FETCH_TIMEOUT_MS = 4_000;
/** Booking/holding re-checks with data at most this old (the display TTLs above are longer). */
export const BOOKING_MAX_AGE_MS = 30_000;
/** Stale data used when a provider fails is only trusted up to this age; older fails closed. */
export const STALE_MAX_MS = 6 * 3_600_000;
const DAY = 86_400_000;

export type ExternalBusy = { busy: (Interval & { ref: string })[]; degraded: boolean };

type CalendarRow = { id: string; credentialId: string; externalId: string; name: string; provider: string; invalid: boolean };

/** Conflict calendars in one query: the event type's override if it has one, else the defaults (INT-006). */
async function conflictCalendars(db: Database, userId: string, eventTypeId?: string): Promise<CalendarRow[]> {
  const [all, blocked] = await Promise.all([conflictCalendarRows(db, userId, eventTypeId), blockedCalendarAddressesFor(db, userId)]);
  // Private calendars: someone's private calendar never counts for a user not allowed for them, even if ticked before.
  const rows = all.filter((r) => !isBlockedCalendar(blocked, r.externalId));
  const chosen = selectConflictCalendars(rows.map((r) => ({ ...r, inTypeList: r.overrideFor !== null })));
  return chosen.map(({ invalidAt, checkConflicts: _c, overrideFor: _o, inTypeList: _t, ...r }) => ({ ...r, invalid: invalidAt !== null }));
}

async function conflictCalendarRows(db: Database, userId: string, eventTypeId?: string) {
  return db
    .select({
      id: connectedCalendar.id,
      credentialId: connectedCalendar.credentialId,
      externalId: connectedCalendar.externalId,
      name: connectedCalendar.name,
      provider: credential.provider,
      invalidAt: credential.invalidAt,
      checkConflicts: connectedCalendar.checkConflicts,
      overrideFor: eventTypeConflictCalendar.eventTypeId,
    })
    .from(connectedCalendar)
    .innerJoin(credential, eq(credential.id, connectedCalendar.credentialId))
    .leftJoin(
      eventTypeConflictCalendar,
      and(
        eq(eventTypeConflictCalendar.connectedCalendarId, connectedCalendar.id),
        eq(eventTypeConflictCalendar.eventTypeId, eventTypeId ?? ""),
      ),
    )
    .where(eq(connectedCalendar.userId, userId));
}

/** The calendar bookings are written to, mirroring sync.ts: event type override, else the host's default. */
async function destinationState(db: Database, userId: string, eventTypeId?: string): Promise<DestinationState | null> {
  const override = eventTypeId ? await db.select({ dest: eventType.destinationCalendarId }).from(eventType).where(eq(eventType.id, eventTypeId)) : [];
  const [userDest] = await db.select().from(destinationCalendar).where(eq(destinationCalendar.userId, userId));
  const id = override[0]?.dest ?? userDest?.connectedCalendarId;
  if (!id) return null;
  const [row] = await db
    .select({ readOnly: connectedCalendar.readOnly, invalidAt: credential.invalidAt, externalId: connectedCalendar.externalId })
    .from(connectedCalendar)
    .innerJoin(credential, eq(credential.id, connectedCalendar.credentialId))
    .where(and(eq(connectedCalendar.id, id), eq(connectedCalendar.userId, userId)));
  // Someone else's private calendar is never a usable destination (as in sync.ts).
  if (row && isBlockedCalendar(await blockedCalendarAddressesFor(db, userId), row.externalId)) return null;
  return row ? { readOnly: row.readOnly, invalid: row.invalidAt !== null } : null;
}

/** IDs/UIDs of external events that mirror this host's own bookings (TEAM-004: co-hosted too). */
async function ownEventIds(db: Database, userId: string, window: Interval, appHost: string): Promise<Set<string>> {
  const rows = await db
    .select({ externalId: bookingReference.externalId, icalUid: booking.icalUid })
    .from(booking)
    .leftJoin(bookingReference, eq(bookingReference.bookingId, booking.id))
    // Any booking they host: collective co-hosts get the organizer's event as an invitation.
    .where(and(isHostOf(userId), lt(booking.startAt, new Date(window.end + DAY)), gte(booking.endAt, new Date(window.start - DAY))));
  const ids = new Set<string>();
  for (const r of rows) {
    if (r.externalId) ids.add(r.externalId);
    ids.add(`${r.icalUid}@${appHost}`); // CalDAV objects carry the booking's iCal UID
  }
  return ids;
}

async function cached(db: Database, calendarId: string, window: Interval) {
  const [row] = await db
    .select()
    .from(calendarBusyCache)
    .where(
      and(
        eq(calendarBusyCache.connectedCalendarId, calendarId),
        lte(calendarBusyCache.rangeStart, new Date(window.start)),
        gte(calendarBusyCache.rangeEnd, new Date(window.end)),
      ),
    )
    .orderBy(desc(calendarBusyCache.fetchedAt))
    .limit(1);
  return row;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function getExternalBusy(
  deps: IntegrationDeps,
  input: { userId: string; eventTypeId?: string; window: Interval; timeZone: string; maxAgeMs?: number; requireCalendar?: boolean },
): Promise<ExternalBusy> {
  const calendars = await conflictCalendars(deps.db, input.userId, input.eventTypeId);
  // Required hosts (CALENDAR_REQUIRED_HOSTS): no calendar, a revoked one, or a provider failure
  // throws CalendarUnavailableError instead of returning "free". Optional hosts keep old behaviour.
  const required = input.requireCalendar ?? isCalendarRequired({ id: input.userId });
  const mode = busyModeFor(input.maxAgeMs);
  assertCalendarsUsable(calendars, required);
  if (required) assertDestinationUsable(await destinationState(deps.db, input.userId, input.eventTypeId), required);
  // A Zoom-only event type needs this host's own valid Zoom connection, required calendar or not.
  await assertConferencingReady(deps.db, input.userId, input.eventTypeId);
  if (!calendars.length) return { busy: [], degraded: false };
  const now = deps.now();
  const results = new Map<string, BusyInterval[]>();
  const toFetch = new Map<string, CalendarRow[]>();
  let degraded = false;

  // Calendars whose credential the provider rejected are skipped (fail open), deliberately: the
  // alternative would make the host unbookable until they reconnect. They are told at once by
  // email and a dashboard banner (INT-012), and transient failures below still fail closed.
  const readable = calendars.filter((cal) => !cal.invalid);
  if (readable.length < calendars.length) degraded = true;
  const hits = await Promise.all(readable.map((cal) => cached(deps.db, cal.id, input.window)));
  readable.forEach((cal, i) => {
    const hit = hits[i];
    const ttl = Math.min(cacheTtlMs(cal.provider, deps.env?.CALENDAR_POLL_SECONDS), input.maxAgeMs ?? Number.POSITIVE_INFINITY);
    if (hit && now - hit.fetchedAt.getTime() < ttl) results.set(cal.id, hit.busy);
    else toFetch.set(cal.credentialId, [...(toFetch.get(cal.credentialId) ?? []), cal]);
  });

  await Promise.all(
    [...toFetch].map(async ([credentialId, cals]) => {
      try {
        const fetched = await withTimeout(
          withCredential(deps, credentialId, (ctx, provider) =>
            provider.calendar!.getBusy(
              ctx,
              cals.map((c) => c.externalId),
              { ...input.window, timeZone: input.timeZone },
            ),
          ),
          FETCH_TIMEOUT_MS,
        );
        for (const cal of cals) {
          const busy = fetched[cal.externalId] ?? [];
          results.set(cal.id, busy);
          await deps.db
            .insert(calendarBusyCache)
            .values({ connectedCalendarId: cal.id, rangeStart: new Date(input.window.start), rangeEnd: new Date(input.window.end), busy, fetchedAt: new Date(now) })
            .onConflictDoUpdate({
              target: [calendarBusyCache.connectedCalendarId, calendarBusyCache.rangeStart, calendarBusyCache.rangeEnd],
              set: { busy, fetchedAt: new Date(now) },
            });
        }
      } catch (error) {
        degraded = true;
        logger.warn("calendar.busy_fetch_failed", { credentialId, provider: getProvider(cals[0].provider).id, ...errorSummary(error) });
        for (const cal of cals) {
          const outcome = resolveProviderFailure({ stale: await cached(deps.db, cal.id, input.window), now, mode, required, calendarName: cal.name });
          // Fail closed: without trustworthy data the whole window counts as busy.
          results.set(cal.id, outcome.kind === "use_stale" ? outcome.busy : [{ start: input.window.start, end: input.window.end }]);
        }
      }
    }),
  );

  // Only look up our own events when there is something to match them against.
  const hasIds = [...results.values()].some((list) => list.some((b) => b.externalEventId));
  const own = hasIds ? await ownEventIds(deps.db, input.userId, input.window, new URL(deps.env.APP_URL).hostname) : new Set<string>();
  const busy = calendars.flatMap((cal) =>
    (results.get(cal.id) ?? [])
      .filter((b) => !(b.externalEventId && own.has(b.externalEventId)))
      .filter((b) => b.end > input.window.start && b.start < input.window.end)
      .map((b) => ({ start: b.start, end: b.end, ref: cal.name })),
  );
  return { busy, degraded };
}

/**
 * The write-side half of getExternalBusy's checks, without reading any calendar: for a host who
 * must have a working calendar, the booking's destination calendar must exist, be theirs, be
 * writable and have a valid credential; a Zoom-only event type needs their Zoom connection. Used
 * for a time added by hand to a scheduling offer, which is booked without reading the calendars.
 * Throws CalendarUnavailableError like getExternalBusy.
 */
export async function assertBookingWritable(db: Database, input: { userId: string; eventTypeId?: string; requireCalendar?: boolean }): Promise<void> {
  const required = input.requireCalendar ?? isCalendarRequired({ id: input.userId });
  if (required) assertDestinationUsable(await destinationState(db, input.userId, input.eventTypeId), required);
  await assertConferencingReady(db, input.userId, input.eventTypeId);
}

/** Drops cached busy data for a calendar after we wrote to it (write-through). */
export async function invalidateBusyCache(db: Database, connectedCalendarIds: string[]): Promise<void> {
  if (connectedCalendarIds.length) await db.delete(calendarBusyCache).where(inArray(calendarBusyCache.connectedCalendarId, connectedCalendarIds));
}

export async function pruneBusyCache(db: Database, now: number): Promise<void> {
  await db.delete(calendarBusyCache).where(lt(calendarBusyCache.fetchedAt, new Date(now - DAY)));
}
