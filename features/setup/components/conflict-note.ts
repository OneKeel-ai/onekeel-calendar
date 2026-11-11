import type { ScheduleType } from "../types";

/**
 * What hides free time on Email times, in plain words (pure, unit tested). The server says whether
 * the meeting type skips the host's own calendar and which other calendars it checks; ticking a
 * colleague's calendar there removes every time that colleague is busy from the host's free times.
 */

export type ConflictNote = NonNullable<ScheduleType["conflictNote"]>;

export type NoticeLink = { href: string; label: string };
export type NoticeLine = { text: string; links: NoticeLink[] };
export type ConflictNotice = { tone: "warning" | "info"; lines: NoticeLine[] };

export const CALENDARS_HREF = "/settings/calendars";

/** Edit page of a meeting type: personal ones under /event-types, team ones under their team. */
export function eventTypeEditHref(typeId: string, teamId: string | null): string {
  const id = encodeURIComponent(typeId);
  return teamId ? `/teams/${encodeURIComponent(teamId)}/event-types/${id}` : `/event-types/${id}`;
}

const calendarsWord = (n: number) => (n === 1 ? "calendar" : "calendars");

/**
 * The notice under "Host: ..." or null when nothing hides free time. `isHost`: the signed-in user
 * hosts this meeting type (only then are calendar names known and fixes suggested).
 */
export function conflictNotice(
  note: ConflictNote | undefined,
  ctx: { isHost: boolean; hostLabel: string; editHref: string | null },
): ConflictNotice | null {
  if (!note) return null;
  const lines: NoticeLine[] = [];
  const edit: NoticeLink[] = ctx.editHref ? [{ href: ctx.editHref, label: "Open meeting type settings" }] : [];
  if (ctx.isHost) {
    if (note.primaryIgnored) {
      lines.push({
        text: "This meeting type does not check your own calendar, so it can offer times when you are busy. Fix it in the meeting type's calendar settings.",
        links: edit,
      });
    }
    if (note.otherCalendars.length > 0) {
      lines.push({
        text: `Free times here also leave out any time when these calendars are busy: ${note.otherCalendars.join(", ")}. If you only want to see their calendars, untick them on your Calendars page and use Plan meeting times below instead.`,
        links: [{ href: CALENDARS_HREF, label: "Open Calendars" }, ...(note.primaryIgnored ? [] : edit)],
      });
    } else if (note.otherCount > 0) {
      lines.push({ text: `Free times here also leave out any time when ${note.otherCount} other ${calendarsWord(note.otherCount)} are busy.`, links: [] });
    }
  } else {
    if (note.primaryIgnored) {
      lines.push({ text: `${ctx.hostLabel}'s meeting type does not check their own calendar, so it can offer times when they are busy.`, links: [] });
    }
    if (note.otherCount > 0) {
      lines.push({
        text: `${ctx.hostLabel}'s free times also leave out times when ${note.otherCount} other ${calendarsWord(note.otherCount)} they chose ${note.otherCount === 1 ? "is" : "are"} busy.`,
        links: [],
      });
    }
  }
  if (lines.length === 0) return null;
  return { tone: note.primaryIgnored ? "warning" : "info", lines };
}
