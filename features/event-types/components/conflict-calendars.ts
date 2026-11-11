/**
 * Plain-language checks for the per-meeting-type "Check these calendars for conflicts" list (pure,
 * unit tested). Text only: nothing here changes what is saved.
 */

export type ConflictCalendar = { id: string; name: string; account: string; primary?: boolean };

/**
 * The user's own main calendar. Uses the `primary` flag when the page passes it; otherwise falls
 * back to the provider convention that the main calendar is named after its account (Google names
 * it with the account's email address).
 */
export function isOwnMainCalendar(cal: ConflictCalendar, all: readonly ConflictCalendar[]): boolean {
  if (all.some((c) => c.primary !== undefined)) return cal.primary === true;
  return cal.name.trim().toLowerCase() === cal.account.trim().toLowerCase();
}

/**
 * True when some calendars are ticked for this type but not the user's own main one: the type
 * then offers times when the user is busy. Nothing ticked means the account defaults apply.
 */
export function ownCalendarUnchecked(calendars: readonly ConflictCalendar[], checkedIds: readonly string[]): boolean {
  if (checkedIds.length === 0) return false;
  const own = calendars.filter((c) => isOwnMainCalendar(c, calendars));
  if (own.length === 0) return false;
  return !own.some((c) => checkedIds.includes(c.id));
}

export const CONFLICT_HELP_TEXT =
  "Tick only the calendars whose events should block your own meetings. To just look at a teammate's calendar while picking times, use Email times.";

export const OWN_CALENDAR_WARNING = "Your own calendar is not checked, so this meeting type can offer times when you are busy.";
