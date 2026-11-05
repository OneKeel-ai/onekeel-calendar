import type { BusyInterval } from "@/lib/integrations/types";

/**
 * Fail-closed calendar policy for hosts who MUST have a working calendar (e.g. a shared
 * assistant booking on someone's behalf). Pure functions only; features/calendars/server/busy.ts
 * calls them. Configuration: CALENDAR_REQUIRED_HOSTS = "*" (every host) or a comma-separated list
 * of host user ids / emails. Unset or empty = nobody is required, so existing behaviour and
 * non-calendar event types are unchanged.
 */

export type CalendarUnavailableReason = "missing" | "disconnected" | "provider_failed";

/** Thrown instead of returning busy times when a required calendar cannot be trusted. */
export class CalendarUnavailableError extends Error {
  readonly code = "CALENDAR_UNAVAILABLE" as const;
  constructor(
    public readonly reason: CalendarUnavailableReason,
    public readonly calendars: string[] = [],
  ) {
    super(`CALENDAR_UNAVAILABLE:${reason}`);
    this.name = "CalendarUnavailableError";
  }
}

export type RequiredHosts = { all: boolean; ids: ReadonlySet<string> };

export function parseRequiredHosts(raw: string | undefined | null): RequiredHosts {
  const parts = (raw ?? "").split(",").map((p) => p.trim().toLowerCase()).filter(Boolean);
  return { all: parts.includes("*"), ids: new Set(parts.filter((p) => p !== "*")) };
}

/** Is a working calendar mandatory for this host? Reads the env at call time unless `raw` is given. */
export function isCalendarRequired(host: { id: string; email?: string | null }, raw: string | undefined | null = process.env.CALENDAR_REQUIRED_HOSTS): boolean {
  const { all, ids } = parseRequiredHosts(raw);
  return all || ids.has(host.id.toLowerCase()) || (!!host.email && ids.has(host.email.toLowerCase()));
}

export type CalendarState = { id: string; name: string; invalid: boolean };

/**
 * Called with the host's conflict calendars before any busy data is used. For a required host:
 * no calendar at all -> "missing" (also what a deleted/disconnected connection looks like),
 * any revoked/invalid credential -> "disconnected". Optional hosts keep the old behaviour.
 */
export function assertCalendarsUsable(calendars: readonly CalendarState[], required: boolean): void {
  if (!required) return;
  if (!calendars.length) throw new CalendarUnavailableError("missing");
  const bad = calendars.filter((c) => c.invalid);
  if (bad.length) throw new CalendarUnavailableError("disconnected", bad.map((c) => c.name));
}

/** Booking/holding passes a finite maxAgeMs; the display endpoint passes Infinity. */
export type BusyMode = "booking" | "display";
export const busyModeFor = (maxAgeMs: number | undefined): BusyMode => (Number.isFinite(maxAgeMs ?? Number.POSITIVE_INFINITY) ? "booking" : "display");

/** Old ceiling for optional hosts on the display path. */
export const OPTIONAL_STALE_MAX_MS = 6 * 3_600_000;
/** Display-only ceiling for required hosts: a short blip, never hours-old data. */
export const REQUIRED_DISPLAY_STALE_MAX_MS = 5 * 60_000;

export type FailureOutcome = { kind: "use_stale"; busy: BusyInterval[] } | { kind: "window_busy" };

/**
 * A provider read failed. Booking mode never trusts the cache (throws for required hosts, and
 * treats the whole window as busy for optional ones). Display mode may use recent stale data;
 * otherwise a required host throws and an optional host's whole window counts as busy.
 */
export function resolveProviderFailure(input: {
  stale: { busy: BusyInterval[]; fetchedAt: Date | number } | undefined;
  now: number;
  mode: BusyMode;
  required: boolean;
  calendarName?: string;
}): FailureOutcome {
  if (input.mode === "booking") {
    if (input.required) throw new CalendarUnavailableError("provider_failed", input.calendarName ? [input.calendarName] : []);
    return { kind: "window_busy" };
  }
  const { stale, now } = input;
  const age = stale ? now - (stale.fetchedAt instanceof Date ? stale.fetchedAt.getTime() : stale.fetchedAt) : Number.POSITIVE_INFINITY;
  const limit = input.required ? REQUIRED_DISPLAY_STALE_MAX_MS : OPTIONAL_STALE_MAX_MS;
  if (stale && age >= 0 && age < limit) return { kind: "use_stale", busy: stale.busy };
  // Required host, no recent data: say so explicitly (the slot list is empty with a reason).
  if (input.required) throw new CalendarUnavailableError("provider_failed", input.calendarName ? [input.calendarName] : []);
  return { kind: "window_busy" };
}
