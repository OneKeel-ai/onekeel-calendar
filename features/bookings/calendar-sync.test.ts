import { describe, expect, it } from "vitest";
import { SYNC_GRACE_MS, syncView } from "./calendar-sync";

const base = { required: true, bookingStatus: "accepted", upcoming: true, changedAt: 1_000_000, now: 1_000_000 + 1000, calendarRefs: [] as string[] };
const late = { now: base.changedAt + SYNC_GRACE_MS + 1 };

describe("syncView", () => {
  it("confirms when the calendar event is synced, even if another reference failed", () => {
    expect(syncView({ ...base, calendarRefs: ["synced"] })).toBe("confirmed");
    expect(syncView({ ...base, ...late, calendarRefs: ["failed", "synced"] })).toBe("confirmed");
  });
  it("keeps saying finishing while missing, pending or failed references may still be retrying", () => {
    for (const calendarRefs of [[], ["pending"], ["failed"]]) expect(syncView({ ...base, calendarRefs })).toBe("finishing");
  });
  it("reports failure only after the grace period since the last change", () => {
    for (const calendarRefs of [[], ["pending"], ["failed"]]) expect(syncView({ ...base, ...late, calendarRefs })).toBe("failed");
  });
  it("leaves optional hosts, host-approval, cancelled and past bookings alone", () => {
    expect(syncView({ ...base, required: false })).toBe("confirmed");
    expect(syncView({ ...base, bookingStatus: "pending" })).toBe("confirmed");
    expect(syncView({ ...base, bookingStatus: "cancelled" })).toBe("confirmed");
    expect(syncView({ ...base, upcoming: false })).toBe("confirmed");
  });
});
