import { describe, expect, it } from "vitest";
import { SYNC_GRACE_MS, syncView } from "./calendar-sync";

const base = { required: true, bookingStatus: "accepted", upcoming: true, createdAt: 1_000_000, now: 1_000_000 + 1000, calendarRefs: [] as string[] };

describe("syncView", () => {
  it("confirms when the calendar event is synced", () => {
    expect(syncView({ ...base, calendarRefs: ["synced"] })).toBe("confirmed");
  });
  it("prefers synced over a failed second reference", () => {
    expect(syncView({ ...base, calendarRefs: ["failed", "synced"] })).toBe("confirmed");
  });
  it("reports failure", () => {
    expect(syncView({ ...base, calendarRefs: ["failed"] })).toBe("failed");
  });
  it("is finishing with no reference or a pending one, only for a fresh booking", () => {
    expect(syncView(base)).toBe("finishing");
    expect(syncView({ ...base, calendarRefs: ["pending"] })).toBe("finishing");
    expect(syncView({ ...base, now: base.createdAt + SYNC_GRACE_MS + 1 })).toBe("failed");
  });
  it("leaves optional hosts, host-approval, cancelled and past bookings alone", () => {
    expect(syncView({ ...base, required: false })).toBe("confirmed");
    expect(syncView({ ...base, bookingStatus: "pending" })).toBe("confirmed");
    expect(syncView({ ...base, bookingStatus: "cancelled" })).toBe("confirmed");
    expect(syncView({ ...base, upcoming: false })).toBe("confirmed");
  });
});
