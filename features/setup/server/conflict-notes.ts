import { inArray } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { connectedCalendar, eventTypeConflictCalendar } from "@/db/schema";
import { conflictNoteFor } from "@/features/calendars/server/conflict-note";
import { blockedCalendarAddressesByUser, isBlockedCalendar } from "@/features/privacy/server/guard";
import type { ScheduleType } from "../types";

/**
 * /schedule: for each listed event type and its single host, which calendars hide free time
 * (ScheduleType.conflictNote). Two queries for any number of types. Calendar names are only
 * filled in when the signed-in user is that host; other hosts' get a count only.
 */
export async function loadConflictNotes(
  db: DbOrTx,
  viewerId: string,
  items: readonly { eventTypeId: string; hostId: string }[],
): Promise<Map<string, NonNullable<ScheduleType["conflictNote"]>>> {
  const notes = new Map<string, NonNullable<ScheduleType["conflictNote"]>>();
  if (!items.length) return notes;
  const hostIds = [...new Set(items.map((i) => i.hostId))];
  const typeIds = [...new Set(items.map((i) => i.eventTypeId))];
  const [all, lists, blocked] = await Promise.all([
    db
      .select({
        id: connectedCalendar.id,
        userId: connectedCalendar.userId,
        externalId: connectedCalendar.externalId,
        name: connectedCalendar.name,
        isPrimary: connectedCalendar.isPrimary,
        checkConflicts: connectedCalendar.checkConflicts,
      })
      .from(connectedCalendar)
      .where(inArray(connectedCalendar.userId, hostIds)),
    db
      .select({ eventTypeId: eventTypeConflictCalendar.eventTypeId, calendarId: eventTypeConflictCalendar.connectedCalendarId })
      .from(eventTypeConflictCalendar)
      .where(inArray(eventTypeConflictCalendar.eventTypeId, typeIds)),
    blockedCalendarAddressesByUser(db, hostIds),
  ]);
  // Private calendars: a host's connected copy of someone's private calendar never counts (as in busy.ts).
  const calendars = all.filter((c) => !isBlockedCalendar(blocked.get(c.userId) ?? new Set(), c.externalId));
  for (const { eventTypeId, hostId } of items) {
    const typeList = new Set(lists.filter((l) => l.eventTypeId === eventTypeId).map((l) => l.calendarId));
    const note = conflictNoteFor(
      calendars.filter((c) => c.userId === hostId),
      typeList,
      hostId === viewerId,
    );
    if (note) notes.set(eventTypeId, note);
  }
  return notes;
}
