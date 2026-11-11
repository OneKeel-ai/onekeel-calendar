import { describe, expect, it } from "vitest";
import { isManualSlotAvailable, isSlotAvailable } from "./slots";
import type { EventTypeInput, HostInput } from "./types";

const MIN = 60_000;
const at = (iso: string) => Date.parse(iso);
const NOW = at("2026-10-01T08:00:00Z");

const event: EventTypeInput = {
  durationMin: 30,
  bufferBeforeMin: 0,
  bufferAfterMin: 10,
  minNoticeMin: 7 * 24 * 60, // a week's notice
  horizon: { type: "rolling_days", days: 2 },
  limits: { bookings: { day: 1 } },
};

/** Works Mon–Fri 09:00–17:00 UTC; calendar busy all of Monday 5 Oct; one booking that day. */
const host: HostInput = {
  userId: "h",
  schedule: { timeZone: "UTC", rules: [1, 2, 3, 4, 5].map((weekday) => ({ weekday: weekday as 1, start: "09:00", end: "17:00" })), overrides: [{ date: "2026-10-06", ranges: [] }] },
  bookings: [{ uid: "b1", start: at("2026-10-05T12:00:00Z"), end: at("2026-10-05T12:30:00Z"), bufferBeforeMin: 0, bufferAfterMin: 15 }],
  ooo: [],
  holds: [],
  externalBusy: [{ start: at("2026-10-05T00:00:00Z"), end: at("2026-10-07T00:00:00Z"), ref: "Work" }],
  sameTypeBookings: [{ uid: "b1", start: at("2026-10-05T12:00:00Z"), end: at("2026-10-05T12:30:00Z") }],
};

const slot = (iso: string, minutes = 30) => ({ start: at(iso), end: at(iso) + minutes * MIN });

describe("isManualSlotAvailable", () => {
  it("ignores working hours, date overrides, notice, the booking window, limits and calendar busy time", () => {
    for (const iso of ["2026-10-05T06:00:00Z", "2026-10-05T10:00:00Z", "2026-10-06T10:00:00Z", "2026-10-20T22:00:00Z"]) {
      expect(isSlotAvailable(event, host, slot(iso), { now: NOW }).ok, iso).toBe(false);
      expect(isManualSlotAvailable(event, host, slot(iso), { now: NOW }), iso).toEqual({ ok: true });
    }
  });

  it("refuses a start in the past", () => {
    expect(isManualSlotAvailable(event, host, slot("2026-10-01T07:30:00Z"), { now: NOW })).toEqual({ ok: false, reason: "in_past" });
  });

  it("refuses an overlap with another booking made here, and its buffers", () => {
    expect(isManualSlotAvailable(event, host, slot("2026-10-05T12:15:00Z"), { now: NOW })).toEqual({ ok: false, reason: "booking_conflict" });
    // b1 ends 12:30 with a 15-minute buffer after it.
    expect(isManualSlotAvailable(event, host, slot("2026-10-05T12:30:00Z"), { now: NOW })).toEqual({ ok: false, reason: "buffer" });
    // This event's own 10-minute buffer after 11:30–12:00 reaches into b1.
    expect(isManualSlotAvailable(event, host, slot("2026-10-05T11:30:00Z"), { now: NOW })).toEqual({ ok: false, reason: "buffer" });
    expect(isManualSlotAvailable(event, host, slot("2026-10-05T12:45:00Z"), { now: NOW })).toEqual({ ok: true });
    // The booking being moved doesn't count.
    expect(isManualSlotAvailable(event, host, slot("2026-10-05T12:15:00Z"), { now: NOW, rescheduleUid: "b1" })).toEqual({ ok: true });
  });

  it("refuses a slot held by another booker and a duration that doesn't match", () => {
    const held = { ...host, holds: [{ start: at("2026-10-05T06:00:00Z"), end: at("2026-10-05T06:30:00Z") }] };
    expect(isManualSlotAvailable(event, held, slot("2026-10-05T06:15:00Z"), { now: NOW })).toEqual({ ok: false, reason: "slot_held" });
    expect(isManualSlotAvailable(event, host, slot("2026-10-05T06:00:00Z", 60), { now: NOW })).toEqual({ ok: false, reason: "not_offered" });
  });
});
