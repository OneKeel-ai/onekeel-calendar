import { and, eq, gt, lt } from "drizzle-orm";
import type { Database } from "@/db/client";
import { bookingHost } from "@/db/schema";
import type { ExternalBusyFn } from "@/features/bookings/server/core";
import { scheduleForEventType, toScheduleInput } from "@/features/schedules/server/service";
import { expandSchedule, normalize } from "@/lib/availability";
import type { Interval } from "@/lib/availability/types";
import { hiddenFromViewer } from "@/features/privacy/server/guard";
import { requireTeamRole } from "./access";
import { membersOf } from "./service";

/**
 * Team availability view (TEAM-010): each member's working hours and busy blocks for a window,
 * side by side. Busy blocks carry no titles or attendees — only that the time is taken (members
 * may not see each other's meetings).
 */

export type MemberAvailability = {
  userId: string;
  name: string;
  timeZone: string | null;
  working: Interval[];
  busy: Interval[];
  /** The member's calendar couldn't be read (or a required one is missing): the whole window shows as busy. */
  calendarUnavailable?: boolean;
};

export const MAX_VIEW_DAYS = 7;

/** Display label for a member: their real name, or (when blank) only the email's local part, never the whole email. */
export const memberLabel = (name: string | null | undefined, email: string) => name?.trim() || email.split("@")[0];

export async function teamAvailability(
  db: Database,
  actorId: string,
  teamId: string,
  window: Interval,
  externalBusyFor?: (userId: string) => ExternalBusyFn | undefined,
): Promise<MemberAvailability[]> {
  await requireTeamRole(db, actorId, teamId, "member");
  const span = { start: window.start, end: Math.min(window.end, window.start + MAX_VIEW_DAYS * 86_400_000) };
  const all = await membersOf(db, teamId);
  // Private calendars: someone the viewer isn't allowed for is left out entirely (not even shown as busy).
  const hidden = await hiddenFromViewer(db, actorId, all.map((m) => m.userId));
  const members = all.filter((m) => !hidden.has(m.userId));
  return Promise.all(
    members.map(async (m): Promise<MemberAvailability> => {
      const flags = { calendarUnavailable: false };
      const [schedule, bookings, external] = await Promise.all([
        scheduleForEventType(db, m.userId, null),
        db
          .select({ start: bookingHost.blockedStart, end: bookingHost.blockedEnd })
          .from(bookingHost)
          .where(and(eq(bookingHost.userId, m.userId), eq(bookingHost.active, true), lt(bookingHost.blockedStart, new Date(span.end)), gt(bookingHost.blockedEnd, new Date(span.start)))),
        // Fail closed: an unreadable or missing required calendar is never shown as free.
        externalBusyFor?.(m.userId)?.(span).catch((): Interval[] => {
          flags.calendarUnavailable = true;
          return [span];
        }) ?? Promise.resolve([]),
      ]);
      const working = schedule ? expandSchedule(toScheduleInput(schedule), span).working : [];
      const busy = normalize([...bookings.map((b) => ({ start: b.start.getTime(), end: b.end.getTime() })), ...external.map((e) => ({ start: e.start, end: e.end }))]);
      const clip = (i: Interval) => ({ start: Math.max(i.start, span.start), end: Math.min(i.end, span.end) });
      return {
        userId: m.userId,
        name: memberLabel(m.name, m.email),
        timeZone: schedule?.timeZone ?? null,
        working: working.map(clip).filter((i) => i.end > i.start),
        busy: busy.map(clip).filter((i) => i.end > i.start),
        ...(flags.calendarUnavailable ? { calendarUnavailable: true } : {}),
      };
    }),
  );
}
