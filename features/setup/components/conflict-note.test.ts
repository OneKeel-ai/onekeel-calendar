import { describe, expect, it } from "vitest";
import { conflictNotice, eventTypeEditHref } from "./conflict-note";

const host = { isHost: true, hostLabel: "You", editHref: "/event-types/et1" };
const other = { isHost: false, hostLabel: "Scott", editHref: null };

describe("what hides free time on Email times", () => {
  it("says nothing when only the host's own calendar is checked", () => {
    expect(conflictNotice(undefined, host)).toBeNull();
  });

  it("warns the host whose meeting type skips their own calendar, with a link to fix it", () => {
    const n = conflictNotice({ primaryIgnored: true, otherCalendars: [], otherCount: 0 }, host)!;
    expect(n.tone).toBe("warning");
    expect(n.lines).toEqual([
      {
        text: "This meeting type does not check your own calendar, so it can offer times when you are busy. Fix it in the meeting type's calendar settings.",
        links: [{ href: "/event-types/et1", label: "Open meeting type settings" }],
      },
    ]);
  });

  it("names the colleagues' calendars that hide the host's free time", () => {
    const n = conflictNotice({ primaryIgnored: false, otherCalendars: ["Andrew", "Chelsea", "Pat"], otherCount: 3 }, host)!;
    expect(n.tone).toBe("info");
    expect(n.lines[0]!.text).toBe(
      "Free times here also leave out any time when these calendars are busy: Andrew, Chelsea, Pat. If you only want to see their calendars, untick them on your Calendars page and use Plan meeting times below instead.",
    );
    expect(n.lines[0]!.links.map((l) => l.href)).toEqual(["/settings/calendars", "/event-types/et1"]);
  });

  it("combines both for Julie's case", () => {
    const n = conflictNotice({ primaryIgnored: true, otherCalendars: ["A", "B", "C", "D"], otherCount: 4 }, host)!;
    expect(n.tone).toBe("warning");
    expect(n.lines).toHaveLength(2);
  });

  it("only describes another host's settings, without telling the user to change them", () => {
    expect(conflictNotice({ primaryIgnored: false, otherCalendars: [], otherCount: 1 }, other)!.lines).toEqual([
      { text: "Scott's free times also leave out times when 1 other calendar they chose is busy.", links: [] },
    ]);
    const both = conflictNotice({ primaryIgnored: true, otherCalendars: [], otherCount: 2 }, other)!;
    expect(both.lines.map((l) => l.text)).toEqual([
      "Scott's meeting type does not check their own calendar, so it can offer times when they are busy.",
      "Scott's free times also leave out times when 2 other calendars they chose are busy.",
    ]);
    expect(both.lines.every((l) => l.links.length === 0)).toBe(true);
  });

  it("builds edit links for personal and team meeting types", () => {
    expect(eventTypeEditHref("et1", null)).toBe("/event-types/et1");
    expect(eventTypeEditHref("et2", "team1")).toBe("/teams/team1/event-types/et2");
  });
});
