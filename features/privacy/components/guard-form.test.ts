import { describe, expect, it } from "vitest";
import { addChip, commitChips, DRAFT_LEFT, EMPTY_CHIPS, guardChanged, guardEmail, guardForm, guardInput, removeChip } from "./guard-form";

describe("guard form", () => {
  it("starts from the saved guard, or empty", () => {
    expect(guardForm(null)).toEqual({ delegates: EMPTY_CHIPS, addresses: EMPTY_CHIPS });
    expect(guardForm({ delegates: ["c@x.com"], calendarAddresses: ["old@x.com"] })).toEqual({
      delegates: { items: ["c@x.com"], draft: "" },
      addresses: { items: ["old@x.com"], draft: "" },
    });
  });

  it("turns typed addresses into lower-case chips and keeps bad ones typed", () => {
    expect(commitChips(EMPTY_CHIPS, "Chelsea@X.com, julie@x.com", 10, "people")).toEqual({ list: { items: ["chelsea@x.com", "julie@x.com"], draft: "" }, error: null });
    expect(commitChips(EMPTY_CHIPS, "chelsea@", 10, "people")).toEqual({ list: { items: [], draft: "chelsea@" }, error: '"chelsea@" is not a valid email address.' });
    expect(commitChips({ items: ["a@x.com"], draft: "  " }, "  ", 10, "people")).toEqual({ list: { items: ["a@x.com"], draft: "" }, error: null });
  });

  it("stops at the limit with a message for this list", () => {
    const full = { items: Array.from({ length: 10 }, (_, i) => `p${i}@x.com`), draft: "" };
    expect(commitChips(full, "new@x.com", 10, "addresses").error).toBe("You can add up to 10 addresses.");
    expect(addChip(full, "new@x.com", 10, "people").error).toBe("You can add up to 10 people.");
    expect(removeChip(full, "p0@x.com").items).toHaveLength(9);
  });

  it("won't send while an address is half typed", () => {
    const value = { delegates: { items: ["c@x.com"], draft: "ju" }, addresses: EMPTY_CHIPS };
    expect(guardInput(value)).toEqual({ ok: false, field: "delegates", message: DRAFT_LEFT });
    expect(guardInput({ delegates: { items: [], draft: "" }, addresses: { items: [], draft: "x" } })).toMatchObject({ ok: false, field: "calendarAddresses" });
    expect(guardInput(guardForm({ delegates: ["c@x.com"], calendarAddresses: [] }))).toEqual({ ok: true, input: { delegates: ["c@x.com"], calendarAddresses: [] } });
  });

  it("knows when something changed", () => {
    const saved = { delegates: ["a@x.com", "b@x.com"], calendarAddresses: [] };
    expect(guardChanged(guardForm(saved), saved)).toBe(false);
    expect(guardChanged({ ...guardForm(saved), delegates: { items: ["b@x.com", "a@x.com"], draft: "" } }, saved)).toBe(false);
    expect(guardChanged({ ...guardForm(saved), delegates: { items: ["a@x.com"], draft: "" } }, saved)).toBe(true);
    expect(guardChanged(guardForm(null), null)).toBe(true);
  });

  it("checks the admin form's email", () => {
    expect(guardEmail("  Tre@OneKeel.ai ")).toEqual({ ok: true, email: "tre@onekeel.ai" });
    expect(guardEmail("")).toEqual({ ok: false, message: "Enter the person's email address." });
    expect(guardEmail("tre")).toEqual({ ok: false, message: '"tre" is not a valid email address.' });
  });
});
