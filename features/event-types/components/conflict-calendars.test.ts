import { describe, expect, it } from "vitest";
import { isOwnMainCalendar, ownCalendarUnchecked } from "./conflict-calendars";

const julie = { id: "c1", name: "julie@onekeel.ai", account: "julie@onekeel.ai" };
const andrew = { id: "c2", name: "andrew@onekeel.ai", account: "julie@onekeel.ai" };
const holidays = { id: "c3", name: "Holidays", account: "julie@onekeel.ai" };

describe("own calendar warning on a meeting type's calendar list", () => {
  it("warns when others are ticked but not the user's own main calendar", () => {
    expect(ownCalendarUnchecked([julie, andrew, holidays], ["c2", "c3"])).toBe(true);
    expect(ownCalendarUnchecked([julie, andrew, holidays], ["c1", "c2"])).toBe(false);
  });

  it("says nothing when none is ticked (account defaults apply) or the main calendar is unknown", () => {
    expect(ownCalendarUnchecked([julie, andrew], [])).toBe(false);
    expect(ownCalendarUnchecked([andrew, holidays].map((c) => ({ ...c, account: "Work" })), ["c3"])).toBe(false);
  });

  it("prefers the page's primary flag over the name convention", () => {
    const flagged = [{ ...julie, primary: false }, { ...holidays, primary: true }];
    expect(isOwnMainCalendar(flagged[0]!, flagged)).toBe(false);
    expect(ownCalendarUnchecked(flagged, ["c1"])).toBe(true);
  });
});
