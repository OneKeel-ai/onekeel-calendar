import { describe, expect, it } from "vitest";
import { parseDate, wallToUtc } from "@/lib/availability/tz";
import { MANUAL_HOURS, manualChoices, manualNotice, manualPicks, manualSlotsInput, NO_PICKS, slotGrid, togglePick } from "./manual-times";
import { displayHours } from "./planner";

const CHI = "America/Chicago";
const iso = (date: string, time: string, tz = CHI) => {
  const [h, m] = time.split(":").map(Number);
  return new Date(wallToUtc(parseDate(date), h! * 60 + m!, tz)).toISOString();
};
const day = parseDate("2026-11-16");
const now = Date.parse("2026-11-10T12:00:00Z");

describe("hand-added pick bookkeeping", () => {
  it("adds by hand, keeps time order with normal picks, and removes on a second click", () => {
    let s = togglePick(NO_PICKS, iso("2026-11-16", "10:00"), 10);
    s = togglePick(s, iso("2026-11-16", "07:30"), 10, true);
    expect(s.slots).toEqual([iso("2026-11-16", "07:30"), iso("2026-11-16", "10:00")]);
    expect(manualPicks(s)).toEqual([iso("2026-11-16", "07:30")]);
    expect(manualSlotsInput(s, 30)).toEqual([{ start: iso("2026-11-16", "07:30"), duration: 30 }]);
    s = togglePick(s, iso("2026-11-16", "07:30"), 10, true);
    expect(s).toEqual({ slots: [iso("2026-11-16", "10:00")], manual: [] });
  });

  it("counts hand-added times toward the same limit", () => {
    let s = NO_PICKS;
    for (let i = 0; i < 9; i++) s = togglePick(s, iso("2026-11-16", `${8 + i}:00`), 10);
    s = togglePick(s, iso("2026-11-16", "18:00"), 10, true);
    const full = togglePick(s, iso("2026-11-16", "18:30"), 10, true);
    expect(full).toBe(s);
    expect(full.slots).toHaveLength(10);
  });

  it("removes a hand-added pick even when toggled from the free-time side", () => {
    const s = togglePick(NO_PICKS, iso("2026-11-16", "09:00"), 10, true);
    expect(togglePick(s, iso("2026-11-16", "09:00"), 10)).toEqual(NO_PICKS);
  });
});

describe("slot grid", () => {
  it("reads the step from same-day free times, capped at the meeting length", () => {
    expect(slotGrid([iso("2026-11-16", "09:00"), iso("2026-11-16", "09:15"), iso("2026-11-16", "10:00")], 30, CHI)).toEqual({ step: 15, phase: 0 });
    expect(slotGrid([iso("2026-11-16", "09:00"), iso("2026-11-16", "11:00")], 30, CHI)).toEqual({ step: 30, phase: 0 });
    expect(slotGrid([iso("2026-11-16", "09:15"), iso("2026-11-16", "10:15")], 60, CHI)).toEqual({ step: 60, phase: 15 });
  });

  it("falls back to the meeting length without enough free times", () => {
    expect(slotGrid([], 45, CHI)).toEqual({ step: 45, phase: 0 });
    expect(slotGrid([iso("2026-11-16", "09:00"), iso("2026-11-17", "09:30")], 30, CHI)).toEqual({ step: 30, phase: 0 });
  });
});

describe("hand-addable cells", () => {
  const base = { days: [day], timeZone: CHI, step: 30, phase: 0, now, on: true, picked: [] as string[] };
  const hours = displayHours([], 30, [day], CHI, MANUAL_HOURS);

  it("covers 7:00 AM to 7:00 PM on the slot step, leaving free times to their own button", () => {
    expect(hours).toEqual({ from: 7, to: 19 });
    const free = new Set([iso("2026-11-16", "09:00")]);
    const cells = manualChoices({ ...base, hours, free }).get("2026-11-16")!;
    expect(cells[0]).toBe(iso("2026-11-16", "07:00"));
    expect(cells.at(-1)).toBe(iso("2026-11-16", "18:30"));
    expect(cells).toHaveLength(23);
    expect(cells).not.toContain(iso("2026-11-16", "09:00"));
  });

  it("widens with free times outside that range", () => {
    expect(displayHours([iso("2026-11-16", "06:00"), iso("2026-11-16", "19:30")], 30, [day], CHI, MANUAL_HOURS)).toEqual({ from: 6, to: 20 });
  });

  it("offers nothing in the past and nothing while the switch is off", () => {
    const later = Date.parse(iso("2026-11-16", "17:10"));
    expect(manualChoices({ ...base, hours, free: new Set(), now: later }).get("2026-11-16")).toEqual([iso("2026-11-16", "17:30"), iso("2026-11-16", "18:00"), iso("2026-11-16", "18:30")]);
    expect(manualChoices({ ...base, hours, free: new Set(), on: false }).size).toBe(0);
  });

  it("keeps hand-added picks listed (to remove them) with the switch off or outside the hours", () => {
    const picked = [iso("2026-11-16", "21:00"), iso("2026-11-23", "08:00")];
    const map = manualChoices({ ...base, hours, free: new Set(), on: false, picked });
    expect([...map.entries()]).toEqual([["2026-11-16", [iso("2026-11-16", "21:00")]]]);
  });

  it("skips the clock-change gap and only offers 5-minute marks", () => {
    const spring = parseDate("2027-03-14");
    const cells = manualChoices({ ...base, days: [spring], hours: { from: 1, to: 4 }, free: new Set(), now }).get("2027-03-14")!;
    expect(cells.map((c) => new Date(c).toLocaleTimeString("en-US", { timeZone: CHI, hour: "numeric", minute: "2-digit" }))).toEqual(["1:00 AM", "1:30 AM", "3:00 AM", "3:30 AM"]);
    const odd = manualChoices({ ...base, step: 7, hours: { from: 9, to: 10 }, free: new Set() }).get("2026-11-16")!;
    expect(odd.every((c) => Date.parse(c) % 300_000 === 0)).toBe(true);
  });
});

describe("notice under the planner", () => {
  it("is shown only when hand-added times exist", () => {
    expect(manualNotice(0)).toBeNull();
    expect(manualNotice(1)).toBe("1 time added by hand. The client can book it even though the calendar shows it as busy or outside working hours.");
    expect(manualNotice(3)).toBe("3 times added by hand. The client can book them even though the calendar shows them as busy or outside working hours.");
  });
});
