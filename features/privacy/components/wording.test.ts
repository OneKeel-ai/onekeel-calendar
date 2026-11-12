import { describe, expect, it } from "vitest";
import { blockerMessage, guardOrigin, guardRowSummary, joinNames, privateHostNotice, WHAT_PRIVACY_DOES, WHAT_PRIVACY_DOES_NOT } from "./wording";

describe("joining names", () => {
  it("uses commas and 'and'", () => {
    expect(joinNames([])).toBe("");
    expect(joinNames(["Tré"])).toBe("Tré");
    expect(joinNames(["Tré", "Chelsea"])).toBe("Tré and Chelsea");
    expect(joinNames(["Tré", "Chelsea", "Julie"])).toBe("Tré, Chelsea and Julie");
  });

  it("skips blanks and repeats", () => {
    expect(joinNames([" Tré ", "", "Chelsea", "Tré"])).toBe("Tré and Chelsea");
  });
});

describe("private host notice", () => {
  it("names who can see or schedule the host", () => {
    expect(privateHostNotice("Tré", ["Tré", "Chelsea"])).toBe("Private calendar. Only Tré and Chelsea can see or schedule Tré. Clients can only book through links you send.");
    expect(privateHostNotice("you", ["Tré", "Chelsea", "Julie"])).toBe("Private calendar. Only Tré, Chelsea and Julie can see or schedule you. Clients can only book through links you send.");
  });

  it("never invents names", () => {
    expect(privateHostNotice("Tré", [])).toBe("Private calendar. Clients can only book through links you send.");
  });
});

describe("settings wording", () => {
  it("lists exactly six points and what it does not do", () => {
    expect(WHAT_PRIVACY_DOES).toHaveLength(6);
    expect(WHAT_PRIVACY_DOES_NOT).toBe("What it does not do: it does not change who can see your calendar in Google itself.");
    for (const line of [...WHAT_PRIVACY_DOES, WHAT_PRIVACY_DOES_NOT]) expect(line).not.toMatch(/\u2014/);
  });

  it("explains a blocking team plainly", () => {
    expect(blockerMessage({ team: "Sales", people: ["Andrew", "Julie"] })).toBe("You share the team Sales with Andrew and Julie. Leave that team, or add them above, then save again.");
  });

  it("summarises an admin row", () => {
    expect(guardOrigin(true)).toBe("Set by the person");
    expect(guardOrigin(false)).toBe("Set up in advance");
    expect(guardRowSummary({ delegates: ["chelsea@x.com"], calendarAddresses: [] })).toEqual({ delegates: "chelsea@x.com", addresses: "None" });
    expect(guardRowSummary({ delegates: [], calendarAddresses: ["old@x.com", "tre@y.com"] })).toEqual({ delegates: "Only them", addresses: "old@x.com, tre@y.com" });
  });
});
