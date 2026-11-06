import { addDays, type LocalDate, localParts, wallToUtc } from "@/lib/availability/tz";
import type { Interval } from "@/lib/availability/types";

/**
 * Planning view of the email times tool, kept free of React so it is easy to test.
 *
 * The rule this file protects: calendars the sender chooses to view are a picture only. They
 * never change who hosts the meeting, who is invited, or which times are offered. Offered times
 * always come from the host's own booking page (POST /api/public/slots).
 */

/** One viewed person, as returned by the team availability read. Busy blocks carry no titles. */
export type BusyPerson = {
  userId: string;
  name: string;
  timeZone: string | null;
  busy: readonly Interval[];
  /** Their calendar couldn't be read, so the whole window counts as busy. */
  calendarUnavailable?: boolean;
};

/** Loads viewed calendars for a window (at most 7 days, enforced again on the server). */
export type LoadBusy = (start: number, end: number) => Promise<{ members: readonly BusyPerson[]; error?: string }>;

const DAY_MS = 86_400_000;
export const MAX_VIEW_MS = 7 * DAY_MS;

/**
 * Window the planner reads for the week shown, from local midnight of the first day to local
 * midnight after the last, in the sender's zone. A week with a clock change can be an hour longer
 * than 7 days, so the end is clamped to stay inside the server's 7-day limit.
 */
export function weekWindow(weekStart: LocalDate, timeZone: string): Interval {
  const start = wallToUtc(weekStart, 0, timeZone);
  const end = Math.min(wallToUtc(addDays(weekStart, 7), 0, timeZone), start + MAX_VIEW_MS);
  return { start, end };
}

/** Ticks or unticks a calendar to view. Returns a new list; host and offered times are untouched. */
export function toggleViewed(viewed: readonly string[], userId: string): readonly string[] {
  return viewed.includes(userId) ? viewed.filter((id) => id !== userId) : [...viewed, userId];
}

/** People to draw, in the order the server returned them, limited to the ticked ones. */
export function shownPeople<P extends BusyPerson>(people: readonly P[], viewed: readonly string[]): P[] {
  return people.filter((p) => viewed.includes(p.userId));
}

/** Fixed, readable colors for viewed calendars (full class strings so the stylesheet keeps them). */
export const PERSON_COLORS = [
  { block: "bg-sky-500/75", swatch: "bg-sky-500" },
  { block: "bg-amber-500/75", swatch: "bg-amber-500" },
  { block: "bg-violet-500/75", swatch: "bg-violet-500" },
  { block: "bg-rose-500/75", swatch: "bg-rose-500" },
  { block: "bg-teal-600/75", swatch: "bg-teal-600" },
  { block: "bg-orange-600/75", swatch: "bg-orange-600" },
] as const;

/** Color by position in the full returned list, so a person keeps one color while others are ticked. */
export function colorFor(people: readonly BusyPerson[], userId: string) {
  const index = Math.max(0, people.findIndex((p) => p.userId === userId));
  return PERSON_COLORS[index % PERSON_COLORS.length]!;
}

/** Names of viewed people busy at any point of [slot, slot + duration). A hint, never a filter. */
export function busyDuring(slot: string, durationMin: number, people: readonly BusyPerson[]): string[] {
  const start = Date.parse(slot);
  if (!Number.isFinite(start)) return [];
  const end = start + durationMin * 60_000;
  return people.filter((p) => p.busy.some((b) => b.start < end && b.end > start)).map((p) => p.name);
}

/** Minutes after local midnight, by the wall clock (so 9:00 sits at 9:00 on a clock-change day). */
const wallMinutes = (ms: number, timeZone: string) => {
  const p = localParts(ms, timeZone);
  return p.hour * 60 + p.minute;
};

/**
 * Hours the grid shows: 8:00 to 18:00, widened to cover every offered time and pick in the
 * shown days. Busy time outside that range can't affect a pick, so it is left out.
 */
export function displayHours(
  starts: readonly string[],
  durationMin: number,
  days: readonly LocalDate[],
  timeZone: string,
): { from: number; to: number } {
  let from = 8;
  let to = 18;
  if (days.length === 0) return { from, to };
  const first = wallToUtc(days[0]!, 0, timeZone);
  const last = wallToUtc(addDays(days[days.length - 1]!, 1), 0, timeZone);
  for (const slot of starts) {
    const start = Date.parse(slot);
    if (!Number.isFinite(start) || start < first || start >= last) continue;
    const startMin = wallMinutes(start, timeZone);
    const endMin = startMin + durationMin;
    from = Math.min(from, Math.floor(startMin / 60));
    to = Math.max(to, Math.min(24, Math.ceil(endMin / 60)));
  }
  return { from, to };
}

export type Block = { top: number; height: number };

/**
 * Places intervals in one day column as percentages of the shown hours, by wall clock time in
 * `timeZone`. Parts outside the day or the shown hours are cut off.
 */
export function dayBlocks(
  intervals: readonly Interval[],
  day: LocalDate,
  timeZone: string,
  hours: { from: number; to: number },
): Block[] {
  const dayStart = wallToUtc(day, 0, timeZone);
  const dayEnd = wallToUtc(addDays(day, 1), 0, timeZone);
  const lo = hours.from * 60;
  const hi = hours.to * 60;
  const span = hi - lo;
  if (span <= 0) return [];
  const blocks: Block[] = [];
  for (const i of intervals) {
    const s = Math.max(i.start, dayStart);
    const e = Math.min(i.end, dayEnd);
    if (e <= s) continue;
    const startMin = wallMinutes(s, timeZone);
    const endMin = e >= dayEnd ? 24 * 60 : Math.max(startMin, wallMinutes(e, timeZone));
    const top = Math.max(startMin, lo);
    const bottom = Math.min(endMin, hi);
    if (bottom <= top) continue;
    blocks.push({ top: ((top - lo) / span) * 100, height: ((bottom - top) / span) * 100 });
  }
  return blocks;
}

/** Slot starts (ISO) as intervals of the meeting length. */
export const slotIntervals = (slots: readonly string[], durationMin: number): Interval[] =>
  slots
    .map((s) => Date.parse(s))
    .filter(Number.isFinite)
    .map((start) => ({ start, end: start + durationMin * 60_000 }));

/**
 * Picks belong to one booking page. If the page changes (another host or meeting type), the old
 * picks are dropped instead of being offered on someone else's calendar.
 */
export type ScopedSelection = { scope: string; slots: readonly string[] };

export const selectionIn = (state: ScopedSelection, scope: string): readonly string[] =>
  state.scope === scope ? state.slots : [];

/** Key for one host plus meeting type; the planner remounts (and starts empty) when it changes. */
export const planKey = (principalId: string, typeId: string) => `${principalId}:${typeId}`;

/** The chosen host, falling back to the first one that has a meeting type. */
export function pickPrincipal<P extends { id: string; types: readonly { id: string }[] }>(principals: readonly P[], id: string | null): P | undefined {
  const usable = principals.filter((p) => p.types.length > 0);
  return usable.find((p) => p.id === id) ?? usable[0];
}

/** The chosen meeting type of that host, falling back to its first. */
export function pickType<T extends { id: string }>(types: readonly T[], id: string | null): T | undefined {
  return types.find((t) => t.id === id) ?? types[0];
}
