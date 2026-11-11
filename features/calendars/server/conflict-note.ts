/**
 * Which calendars hide a host's free time for one event type, as plain facts for the UI. Pure (no
 * database or server-only imports), so forms and settings pages can use the helpers too.
 */

/**
 * The conflict-calendar selection rule (INT-006), shared with busy.ts: when the event type has its
 * own list with any of this host's calendars, ONLY those count; otherwise the calendars marked
 * "check for conflicts".
 */
export function selectConflictCalendars<T extends { checkConflicts: boolean; inTypeList: boolean }>(calendars: readonly T[]): T[] {
  const override = calendars.filter((c) => c.inTypeList);
  return override.length ? override : calendars.filter((c) => c.checkConflicts);
}

/**
 * True when the host has a primary calendar and none of their primary calendars is checked: their
 * own meetings don't hide any free time. `checked` is whatever the form or rule would check.
 */
export function primaryNotChecked(calendars: readonly { isPrimary: boolean; checked: boolean }[]): boolean {
  return calendars.some((c) => c.isPrimary) && !calendars.some((c) => c.isPrimary && c.checked);
}

export type ConflictNoteCalendar = { id: string; name: string; isPrimary: boolean; checkConflicts: boolean };

export type ConflictNoteFacts = { primaryIgnored: boolean; otherCalendars: string[]; otherCount: number };

/**
 * The note for one host and event type, or undefined when only the host's primary calendar (or
 * nothing at all, and there is no primary) is checked. `typeList`: the event type's own calendar
 * list. Calendar names only with `showNames` (the viewer is the host).
 */
export function conflictNoteFor(
  calendars: readonly ConflictNoteCalendar[],
  typeList: ReadonlySet<string>,
  showNames: boolean,
): ConflictNoteFacts | undefined {
  const checked = new Set(selectConflictCalendars(calendars.map((c) => ({ ...c, inTypeList: typeList.has(c.id) }))).map((c) => c.id));
  const primaryIgnored = primaryNotChecked(calendars.map((c) => ({ isPrimary: c.isPrimary, checked: checked.has(c.id) })));
  const others = calendars.filter((c) => checked.has(c.id) && !c.isPrimary);
  if (!primaryIgnored && !others.length) return undefined;
  return {
    primaryIgnored,
    otherCalendars: showNames ? others.map((c) => c.name).toSorted((a, b) => a.localeCompare(b)) : [],
    otherCount: others.length,
  };
}
