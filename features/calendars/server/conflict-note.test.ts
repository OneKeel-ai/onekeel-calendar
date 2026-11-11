import { describe, expect, it } from "vitest";
import { conflictNoteFor, primaryNotChecked, selectConflictCalendars } from "./conflict-note";

const cal = (id: string, patch: Partial<{ name: string; isPrimary: boolean; checkConflicts: boolean }> = {}) => ({
  id,
  name: patch.name ?? id,
  isPrimary: patch.isPrimary ?? false,
  checkConflicts: patch.checkConflicts ?? false,
});

const mine = cal("me", { name: "Jen Work", isPrimary: true, checkConflicts: true });
const colleagues = [cal("c1", { name: "Sam", checkConflicts: true }), cal("c2", { name: "Ana", checkConflicts: true }), cal("c3", { name: "Lee" })];

describe("selectConflictCalendars", () => {
  it("uses only the event type's own list when it has any of the host's calendars", () => {
    const rows = [{ ...mine, inTypeList: false }, { ...colleagues[0], inTypeList: true }, { ...colleagues[2], inTypeList: true }];
    expect(selectConflictCalendars(rows).map((c) => c.id)).toEqual(["c1", "c3"]);
  });

  it("otherwise the calendars checked for conflicts", () => {
    const rows = [mine, ...colleagues].map((c) => ({ ...c, inTypeList: false }));
    expect(selectConflictCalendars(rows).map((c) => c.id)).toEqual(["me", "c1", "c2"]);
  });
});

describe("primaryNotChecked", () => {
  it("is true only when there is a primary calendar and none is checked", () => {
    expect(primaryNotChecked([{ isPrimary: true, checked: false }, { isPrimary: false, checked: true }])).toBe(true);
    expect(primaryNotChecked([{ isPrimary: true, checked: true }])).toBe(false);
    expect(primaryNotChecked([{ isPrimary: true, checked: false }, { isPrimary: true, checked: true }])).toBe(false);
    expect(primaryNotChecked([{ isPrimary: false, checked: false }])).toBe(false);
    expect(primaryNotChecked([])).toBe(false);
  });
});

describe("conflictNoteFor", () => {
  it("is omitted when only the primary calendar is checked", () => {
    expect(conflictNoteFor([mine, cal("c3", { name: "Lee" })], new Set(), true)).toBeUndefined();
    expect(conflictNoteFor([], new Set(), true)).toBeUndefined();
  });

  it("lists the extra calendars, sorted, for the host themself", () => {
    expect(conflictNoteFor([mine, ...colleagues], new Set(), true)).toEqual({ primaryIgnored: false, otherCalendars: ["Ana", "Sam"], otherCount: 2 });
  });

  it("flags an event type list that leaves out the primary calendar", () => {
    expect(conflictNoteFor([mine, ...colleagues], new Set(["c1", "c2", "c3"]), true)).toEqual({
      primaryIgnored: true,
      otherCalendars: ["Ana", "Lee", "Sam"],
      otherCount: 3,
    });
  });

  it("gives a count but no names for another host", () => {
    expect(conflictNoteFor([mine, ...colleagues], new Set(["c1"]), false)).toEqual({ primaryIgnored: true, otherCalendars: [], otherCount: 1 });
  });

  it("flags a primary calendar that isn't checked even when nothing else is", () => {
    expect(conflictNoteFor([{ ...mine, checkConflicts: false }], new Set(), true)).toEqual({ primaryIgnored: true, otherCalendars: [], otherCount: 0 });
  });
});
