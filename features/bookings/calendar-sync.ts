/**
 * What the booking page may say about a booking whose host must have a working calendar
 * (CALENDAR_REQUIRED_HOSTS). Only the derived state leaves the server, never reference rows.
 */
export type SyncView = "confirmed" | "finishing" | "failed";

/** How long a booking may wait for its calendar event before the page stops saying "finishing". */
export const SYNC_GRACE_MS = 5 * 60_000;

export function syncView(input: {
  required: boolean;
  bookingStatus: string;
  upcoming: boolean;
  createdAt: number;
  now: number;
  /** Statuses of this booking's calendar references. */
  calendarRefs: readonly string[];
}): SyncView {
  // Cancelled, declined, awaiting host or payment, past, or an optional-calendar host: unchanged.
  if (!input.required || input.bookingStatus !== "accepted" || !input.upcoming) return "confirmed";
  if (input.calendarRefs.includes("synced")) return "confirmed";
  if (input.calendarRefs.includes("failed")) return "failed";
  return input.now - input.createdAt < SYNC_GRACE_MS ? "finishing" : "failed";
}
