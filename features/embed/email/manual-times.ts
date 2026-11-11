import { formatDate, type LocalDate, localDateOf, localParts, wallToUtc } from "@/lib/availability/tz";

/**
 * "Add times by hand" on Email times, kept free of React so it is unit tested directly.
 *
 * A hand-added time is a start the host's booking page does not offer (their calendar shows it as
 * busy, or it is outside working hours) that the sender knows is fine. It is saved in the offer, so
 * only that link can book it. Picks are ISO starts (UTC instants); `manual` names the picks that
 * were added by hand and is always a subset of `slots`.
 */

/** Same shape as the server's offer input: start is ISO 8601 UTC, duration in minutes. */
export type ManualSlot = { start: string; duration: number };

export type PickState = { slots: readonly string[]; manual: readonly string[] };

export const NO_PICKS: PickState = { slots: [], manual: [] };

/** Hours the planner shows at least while adding times by hand (wall clock, panel's time zone). */
export const MANUAL_HOURS = { from: 7, to: 19 } as const;

const byTime = (a: string, b: string) => Date.parse(a) - Date.parse(b);

const FIVE_MIN = 5 * 60_000;

/**
 * Adds or removes one pick. A start already picked is removed (whichever way it was added). A new
 * one is only added while under `limit`; `byHand` marks it as added by hand.
 */
export function togglePick(state: PickState, slot: string, limit: number, byHand = false): PickState {
  if (state.slots.includes(slot)) {
    return { slots: state.slots.filter((s) => s !== slot), manual: state.manual.filter((s) => s !== slot) };
  }
  if (state.slots.length >= limit) return state;
  return {
    slots: [...state.slots, slot].sort(byTime),
    manual: byHand ? [...state.manual, slot].sort(byTime) : state.manual,
  };
}

/** Hand-added picks, in time order (only those still picked). */
export function manualPicks(state: PickState): string[] {
  return state.manual.filter((s) => state.slots.includes(s)).sort(byTime);
}

/** What the offer saves for the hand-added picks, for the current meeting length. */
export function manualSlotsInput(state: PickState, duration: number): ManualSlot[] {
  return manualPicks(state).map((start) => ({ start, duration }));
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

const wallMinutes = (ms: number, timeZone: string) => {
  const p = localParts(ms, timeZone);
  return p.hour * 60 + p.minute;
};

/**
 * Spacing and alignment of the cells a sender can add by hand. The meeting type's slot step is
 * read from its free times: the common divisor of the gaps between free starts on the same day,
 * never longer than the meeting. With too few free times to tell, the meeting length is used and
 * cells start on the hour. `phase` keeps cells in line with the free times (e.g. :15 and :45).
 */
export function slotGrid(free: readonly string[], duration: number, timeZone: string): { step: number; phase: number } {
  const starts = free.map((s) => Date.parse(s)).filter(Number.isFinite).sort((a, b) => a - b);
  let step = 0;
  for (let i = 1; i < starts.length; i++) {
    const prev = starts[i - 1]!;
    const cur = starts[i]!;
    if (formatDate(localDateOf(prev, timeZone)) !== formatDate(localDateOf(cur, timeZone))) continue;
    const gap = Math.round((cur - prev) / 60_000);
    if (gap > 0) step = gcd(step, gap);
  }
  step = step >= 5 ? Math.min(step, duration) : duration;
  if (!(step > 0)) step = 30;
  const first = starts[0];
  const phase = first === undefined ? 0 : wallMinutes(first, timeZone) % step;
  return { step, phase };
}

export type ManualChoicesInput = {
  days: readonly LocalDate[];
  timeZone: string;
  /** Shown hours of the planner; new cells are offered inside them only. */
  hours: { from: number; to: number };
  step: number;
  phase: number;
  /** The host's free times (ISO); these keep their normal button and are never added by hand. */
  free: ReadonlySet<string>;
  now: number;
  /** "Add times by hand" is on: offer every other future cell. */
  on: boolean;
  /** Hand-added picks: always listed on their day (so they can be removed), even with the switch off. */
  picked: readonly string[];
};

/**
 * Starts that can be added (or are added) by hand, per local day (yyyy-MM-dd) of the shown week,
 * in time order. Cells are on the slot grid inside the shown hours, in the future, and not a free
 * time. Clock-change gaps are skipped and a repeated hour is listed once.
 */
export function manualChoices(input: ManualChoicesInput): Map<string, string[]> {
  const { days, timeZone, hours, step, phase, free, now, on, picked } = input;
  const out = new Map<string, string[]>();
  const shown = new Set(days.map(formatDate));
  const add = (key: string, iso: string) => {
    const list = out.get(key) ?? [];
    if (!list.includes(iso)) list.push(iso);
    out.set(key, list);
  };
  if (on && step > 0) {
    const from = hours.from * 60;
    const to = hours.to * 60;
    const firstCell = from + ((((phase - from) % step) + step) % step);
    for (const day of days) {
      const key = formatDate(day);
      for (let m = firstCell; m + step <= to; m += step) {
        const ms = wallToUtc(day, m, timeZone);
        if (wallMinutes(ms, timeZone) !== m || formatDate(localDateOf(ms, timeZone)) !== key) continue; // clock-change gap
        if (ms <= now || ms % FIVE_MIN !== 0) continue; // the server takes future starts on 5-minute marks only
        const iso = new Date(ms).toISOString();
        if (free.has(iso)) continue;
        add(key, iso);
      }
    }
  }
  for (const iso of picked) {
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms) || free.has(iso)) continue;
    const key = formatDate(localDateOf(ms, timeZone));
    if (shown.has(key)) add(key, iso);
  }
  for (const list of out.values()) list.sort(byTime);
  return out;
}

/** The line under the planner while hand-added times are picked; null when there are none. */
export function manualNotice(count: number): string | null {
  if (count <= 0) return null;
  return `${count} ${count === 1 ? "time" : "times"} added by hand. The client can book ${count === 1 ? "it" : "them"} even though the calendar shows ${count === 1 ? "it" : "them"} as busy or outside working hours.`;
}
