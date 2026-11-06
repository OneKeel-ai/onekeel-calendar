import { describe, expect, it } from "vitest";
import { addDays, parseDate, wallToUtc } from "@/lib/availability/tz";
import {
  type BusyPerson,
  busyDuring,
  colorFor,
  dayBlocks,
  displayHours,
  MAX_VIEW_MS,
  pickPrincipal,
  pickType,
  planKey,
  selectionIn,
  shownPeople,
  toggleViewed,
  weekWindow,
} from "./planner";
import { toggleSlot } from "./selection";

const NY = "America/New_York";
const at = (date: string, hhmm: string, tz = NY) => {
  const [h, m] = hhmm.split(":").map(Number);
  return wallToUtc(parseDate(date), h! * 60 + m!, tz);
};
const iso = (date: string, hhmm: string, tz = NY) => new Date(at(date, hhmm, tz)).toISOString();

const charlie: BusyPerson = { userId: "u-charlie", name: "Charlie", timeZone: NY, busy: [{ start: at("2026-11-10", "10:00"), end: at("2026-11-10", "11:00") }] };
const andrew: BusyPerson = { userId: "u-andrew", name: "Andrew", timeZone: NY, busy: [{ start: at("2026-11-10", "10:30"), end: at("2026-11-10", "12:00") }] };
const julie: BusyPerson = { userId: "u-julie", name: "Julie", timeZone: NY, busy: [] };
const people = [julie, charlie, andrew];

describe("viewed calendars are display only", () => {
  it("ticking a calendar changes only the viewed list", () => {
    const target = { calLink: "team/exec/charlie-30", label: "Intro" };
    const before = JSON.stringify(target);
    const viewed = toggleViewed(toggleViewed([], "u-charlie"), "u-andrew");
    expect(viewed).toEqual(["u-charlie", "u-andrew"]);
    expect(toggleViewed(viewed, "u-charlie")).toEqual(["u-andrew"]);
    expect(JSON.stringify(target)).toBe(before);
  });

  it("shows only ticked people, in server order", () => {
    expect(shownPeople(people, ["u-andrew", "u-charlie"]).map((p) => p.name)).toEqual(["Charlie", "Andrew"]);
    expect(shownPeople(people, [])).toEqual([]);
  });

  it("flags busy viewers on a slot without removing it", () => {
    const offered = [iso("2026-11-10", "09:30"), iso("2026-11-10", "10:00"), iso("2026-11-10", "12:00")];
    const flags = offered.map((s) => busyDuring(s, 30, [charlie, andrew]));
    expect(flags).toEqual([[], ["Charlie"], []]);
    // 10:30 overlaps both; the half-open end means 11:00 clears Charlie.
    expect(busyDuring(iso("2026-11-10", "10:30"), 30, [charlie, andrew])).toEqual(["Charlie", "Andrew"]);
    expect(busyDuring(iso("2026-11-10", "11:00"), 30, [charlie])).toEqual([]);
    // The offered list itself is never filtered by the view.
    expect(offered).toHaveLength(3);
  });

  it("keeps a person's color while others are ticked or unticked", () => {
    expect(colorFor(people, "u-andrew")).toBe(colorFor(people, "u-andrew"));
    expect(colorFor(people, "u-andrew")).not.toBe(colorFor(people, "u-charlie"));
  });
});

describe("host switch", () => {
  const principals = [
    { id: "self", label: "You", teamId: null, types: [{ id: "a" }] },
    { id: "t_charlie", label: "Charlie", teamId: "team1", types: [{ id: "c1" }, { id: "c2" }] },
    { id: "t_empty", label: "Nobody", teamId: "team1", types: [] },
  ];

  it("picks a host with meeting types and falls back to the first", () => {
    expect(pickPrincipal(principals, "t_charlie")?.id).toBe("t_charlie");
    expect(pickPrincipal(principals, "t_empty")?.id).toBe("self");
    expect(pickPrincipal(principals, null)?.id).toBe("self");
    expect(pickType(principals[1]!.types, "missing")?.id).toBe("c1");
  });

  it("a different host or meeting type is a different plan", () => {
    expect(planKey("self", "a")).not.toBe(planKey("t_charlie", "c1"));
    expect(planKey("t_charlie", "c1")).not.toBe(planKey("t_charlie", "c2"));
  });

  it("drops picks made for another booking page", () => {
    const state = { scope: "julie/intro", slots: toggleSlot([], iso("2026-11-10", "09:00"), 10) };
    expect(selectionIn(state, "julie/intro")).toHaveLength(1);
    expect(selectionIn(state, "team/exec/charlie-30")).toEqual([]);
  });

  it("keeps picks from several weeks and stops at 10", () => {
    let picks: readonly string[] = [];
    for (let w = 0; w < 3; w++) picks = toggleSlot(picks, iso(`2026-11-${10 + w * 7}`, "09:00"), 10);
    expect(picks).toHaveLength(3);
    for (let i = 0; i < 12; i++) picks = toggleSlot(picks, iso("2026-12-01", `${8 + i}:00`), 10);
    expect(picks).toHaveLength(10);
  });
});

describe("time window", () => {
  it("covers a normal week exactly", () => {
    const w = weekWindow(parseDate("2026-11-09"), NY);
    expect(w.end - w.start).toBe(MAX_VIEW_MS);
  });

  it("stays inside the 7-day limit across the fall clock change", () => {
    // Nov 1 2026: clocks go back in New York, so that local week is 7 days plus an hour.
    const w = weekWindow(parseDate("2026-10-29"), NY);
    expect(w.start).toBe(at("2026-10-29", "00:00"));
    expect(w.end - w.start).toBe(MAX_VIEW_MS);
  });

  it("places blocks by wall clock, also on a clock-change day", () => {
    const hours = { from: 8, to: 18 };
    const day = parseDate("2026-11-01");
    const blocks = dayBlocks([{ start: at("2026-11-01", "09:00"), end: at("2026-11-01", "10:00") }], day, NY, hours);
    expect(blocks).toEqual([{ top: 10, height: 10 }]);
  });

  it("cuts blocks to the day and the shown hours", () => {
    const hours = { from: 8, to: 18 };
    const day = parseDate("2026-11-10");
    const overnight = { start: at("2026-11-09", "22:00"), end: at("2026-11-10", "09:00") };
    expect(dayBlocks([overnight], day, NY, hours)).toEqual([{ top: 0, height: 10 }]);
    expect(dayBlocks([overnight], addDays(day, 1), NY, hours)).toEqual([]);
    const allDay = { start: at("2026-11-10", "00:00"), end: at("2026-11-11", "00:00") };
    expect(dayBlocks([allDay], day, NY, hours)).toEqual([{ top: 0, height: 100 }]);
  });

  it("widens the hours to fit early and late offered times", () => {
    const days = [parseDate("2026-11-10")];
    expect(displayHours([], 30, days, NY)).toEqual({ from: 8, to: 18 });
    expect(displayHours([iso("2026-11-10", "07:00"), iso("2026-11-10", "18:00")], 30, days, NY)).toEqual({ from: 7, to: 19 });
    // Times outside the shown days don't stretch the grid.
    expect(displayHours([iso("2026-11-12", "06:00")], 30, days, NY)).toEqual({ from: 8, to: 18 });
  });
});
