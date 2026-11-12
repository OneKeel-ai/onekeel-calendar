import { describe, expect, it } from "vitest";
import {
  addGuest,
  commitDraft,
  copyGate,
  DRAFT_MESSAGE,
  EMPTY_MEETING_DETAILS,
  filterSuggestions,
  isValidEmail,
  type MeetingDetailsValue,
  offerKey,
  removeGuest,
  SAVING_MESSAGE,
  splitAddresses,
  DETAILS_SAVE_FAILED,
  EMPTY_MESSAGE,
  offeredSlotsInput,
  offerPlan,
  type OfferRules,
  OPEN_RULES,
  TIMES_SAVE_FAILED,
} from "./meeting-details";

describe("email addresses", () => {
  it("accepts ordinary addresses and rejects broken ones", () => {
    expect(isValidEmail("julie@onekeel.ai")).toBe(true);
    expect(isValidEmail("a.b+tag@sub.example.co")).toBe(true);
    for (const bad of ["julie", "julie@", "@onekeel.ai", "julie@onekeel", "ju lie@onekeel.ai", "a@b@c.com", "a@-x.com", "a@x.c"]) {
      expect(isValidEmail(bad), bad).toBe(false);
    }
  });

  it("splits pasted lists, including Gmail-style names", () => {
    expect(splitAddresses("a@x.com, b@y.com;c@z.com\nd@w.com e@v.com")).toEqual(["a@x.com", "b@y.com", "c@z.com", "d@w.com", "e@v.com"]);
    expect(splitAddresses("Jane Doe <jane@x.com>, Bob Roe <bob@y.com>")).toEqual(["jane@x.com", "bob@y.com"]);
    expect(splitAddresses("mailto:a@x.com")).toEqual(["a@x.com"]);
    expect(splitAddresses("  ,  ")).toEqual([]);
  });
});

describe("chips", () => {
  it("turns valid addresses into lower-case chips without duplicates", () => {
    expect(commitDraft(["a@x.com"], "A@X.com, B@Y.com, b@y.com")).toEqual({ guests: ["a@x.com", "b@y.com"], draft: "", error: null });
  });

  it("keeps an invalid address as text with an error, and never makes it a chip", () => {
    const result = commitDraft([], "good@x.com, nope");
    expect(result.guests).toEqual(["good@x.com"]);
    expect(result.draft).toBe("nope");
    expect(result.error).toBe('"nope" is not a valid email address.');
  });

  it("stops at the limit and keeps the rest typed", () => {
    const nine = Array.from({ length: 9 }, (_, i) => `p${i}@x.com`);
    const result = commitDraft(nine, "ten@x.com, eleven@x.com");
    expect(result.guests).toHaveLength(10);
    expect(result.guests.at(-1)).toBe("ten@x.com");
    expect(result.draft).toBe("eleven@x.com");
    expect(result.error).toBe("You can invite up to 10 people.");
  });

  it("adds a picked suggestion once and removes a chip", () => {
    expect(addGuest(["a@x.com"], "B@Y.com").guests).toEqual(["a@x.com", "b@y.com"]);
    expect(addGuest(["a@x.com"], "a@x.com")).toEqual({ guests: ["a@x.com"], draft: "", error: null });
    expect(removeGuest(["a@x.com", "b@y.com"], "a@x.com")).toEqual(["b@y.com"]);
  });
});

describe("suggestions", () => {
  const contacts = [
    { name: "Chelsea Park", email: "chelsea@onekeel.ai" },
    { name: "Julie Stone", email: "julie@onekeel.ai" },
    { name: "Andrew Hill", email: "andrew@onekeel.ai" },
  ];

  it("matches the typed text against name and email, case-insensitively", () => {
    expect(filterSuggestions(contacts, "JUL", []).map((c) => c.email)).toEqual(["julie@onekeel.ai"]);
    expect(filterSuggestions(contacts, "stone", []).map((c) => c.email)).toEqual(["julie@onekeel.ai"]);
    expect(filterSuggestions(contacts, "onekeel", []).map((c) => c.email)).toHaveLength(3);
  });

  it("hides people already invited and shows nothing for empty text", () => {
    expect(filterSuggestions(contacts, "onekeel", ["julie@onekeel.ai"]).map((c) => c.name)).toEqual(["Chelsea Park", "Andrew Hill"]);
    expect(filterSuggestions(contacts, "  ", [])).toEqual([]);
  });
});

describe("copy gate", () => {
  const typed: MeetingDetailsValue = { title: "Auto Group x OneKeel.ai: Demo", guests: ["a@x.com"], draft: "" };
  const key = offerKey("et1", typed);

  it("allows copying without an offer when both fields are empty", () => {
    expect(copyGate("et1", EMPTY_MEETING_DETAILS, { status: "idle" })).toEqual({ canCopy: true });
    expect(copyGate("et1", { title: "   ", guests: [], draft: "" }, { status: "saving", key: "x" })).toEqual({ canCopy: true });
  });

  it("blocks copying until exactly what is on screen is saved", () => {
    expect(copyGate("et1", typed, { status: "idle" })).toEqual({ canCopy: false, status: "saving", message: SAVING_MESSAGE });
    expect(copyGate("et1", typed, { status: "saving", key })).toMatchObject({ canCopy: false, status: "saving" });
    expect(copyGate("et1", typed, { status: "saved", key, offerId: "off_1" })).toEqual({ canCopy: true, offerId: "off_1" });
    // Saved for older content, or for another meeting type: not usable.
    expect(copyGate("et1", { ...typed, title: "Changed" }, { status: "saved", key, offerId: "off_1" })).toMatchObject({ canCopy: false, status: "saving" });
    expect(copyGate("et2", typed, { status: "saved", key, offerId: "off_1" })).toMatchObject({ canCopy: false });
  });

  it("treats a trimmed title as the same content", () => {
    expect(copyGate("et1", { ...typed, title: `  ${typed.title} ` }, { status: "saved", key, offerId: "off_1" })).toEqual({ canCopy: true, offerId: "off_1" });
  });

  it("shows a save error and stays blocked", () => {
    expect(copyGate("et1", typed, { status: "error", key, message: "Too many guests" })).toEqual({ canCopy: false, status: "error", message: "Too many guests" });
  });

  it("never allows copy for a saved non-empty offer without an id", () => {
    expect(copyGate("et1", typed, { status: "saved", key, offerId: null })).toMatchObject({ canCopy: false, status: "error" });
  });

  it("blocks copying while an address is still typed", () => {
    expect(copyGate("et1", { ...typed, draft: "bob@" }, { status: "saved", key, offerId: "off_1" })).toEqual({ canCopy: false, status: "draft", message: DRAFT_MESSAGE });
    expect(copyGate("et1", { ...EMPTY_MEETING_DETAILS, draft: "x" }, { status: "idle" })).toMatchObject({ canCopy: false, status: "draft" });
  });
});

describe("copy gate with times added by hand", () => {
  const manual = [{ start: "2026-11-16T13:00:00.000Z", duration: 30 }];

  it("needs a saved offer for a hand-added time alone (no title, no people)", () => {
    const key = offerKey("et1", EMPTY_MEETING_DETAILS, manual);
    expect(copyGate("et1", EMPTY_MEETING_DETAILS, { status: "idle" }, manual)).toEqual({ canCopy: false, status: "saving", message: SAVING_MESSAGE });
    expect(copyGate("et1", EMPTY_MEETING_DETAILS, { status: "saved", key, offerId: "off_9" }, manual)).toEqual({ canCopy: true, offerId: "off_9" });
  });

  it("locks copy again when the hand-added times or their length change", () => {
    const key = offerKey("et1", EMPTY_MEETING_DETAILS, manual);
    const saved = { status: "saved", key, offerId: "off_9" } as const;
    expect(copyGate("et1", EMPTY_MEETING_DETAILS, saved, [...manual, { start: "2026-11-16T14:00:00.000Z", duration: 30 }])).toMatchObject({ canCopy: false });
    expect(copyGate("et1", EMPTY_MEETING_DETAILS, saved, [{ ...manual[0]!, duration: 60 }])).toMatchObject({ canCopy: false });
    expect(copyGate("et1", EMPTY_MEETING_DETAILS, saved, [])).toEqual({ canCopy: true });
  });

  it("keeps the old key when nothing was added by hand", () => {
    expect(offerKey("et1", EMPTY_MEETING_DETAILS, [])).toBe(offerKey("et1", EMPTY_MEETING_DETAILS));
    expect(offerKey("et1", EMPTY_MEETING_DETAILS, manual)).not.toBe(offerKey("et1", EMPTY_MEETING_DETAILS));
  });

  it("stays locked on a manualSlots error or a saved offer without an id", () => {
    const key = offerKey("et1", EMPTY_MEETING_DETAILS, manual);
    const error = { status: "error", key, message: "Please fix", fieldErrors: { manualSlots: "A time added by hand is in the past" } } as const;
    expect(copyGate("et1", EMPTY_MEETING_DETAILS, error, manual)).toEqual({ canCopy: false, status: "error", message: "Please fix" });
    expect(copyGate("et1", EMPTY_MEETING_DETAILS, { status: "saved", key, offerId: null }, manual)).toMatchObject({ canCopy: false, status: "error" });
  });
});

describe("copy gate when the client can only book the picked times", () => {
  const free = "2026-11-16T15:00:00.000Z";
  const hand = "2026-11-16T13:00:00.000Z";
  const only = (starts: string[], duration = 30): OfferRules => ({ onlyOffered: true, slots: offeredSlotsInput(starts, duration) });

  it("lists every picked time, free or added by hand, in time order with the current length", () => {
    expect(offeredSlotsInput([free, hand], 45)).toEqual([
      { start: hand, duration: 45 },
      { start: free, duration: 45 },
    ]);
  });

  it("has nothing to save or copy while no time is picked", () => {
    expect(offerPlan("et1", EMPTY_MEETING_DETAILS, [], only([]))).toEqual({ kind: "empty" });
    expect(copyGate("et1", { title: "Demo", guests: [], draft: "" }, { status: "idle" }, [], only([]))).toEqual({ canCopy: false, status: "empty", message: EMPTY_MESSAGE });
  });

  it("saves an offer for picked times alone and sends onlyOffered with every slot", () => {
    const plan = offerPlan("et1", EMPTY_MEETING_DETAILS, [], only([free]));
    expect(plan).toMatchObject({ kind: "save", input: { eventTypeId: "et1", title: "", guests: [], manualSlots: [], onlyOffered: true, slots: [{ start: free, duration: 30 }] } });
    const key = plan.kind === "save" ? plan.key : "";
    expect(copyGate("et1", EMPTY_MEETING_DETAILS, { status: "idle" }, [], only([free]))).toMatchObject({ canCopy: false, status: "saving" });
    expect(copyGate("et1", EMPTY_MEETING_DETAILS, { status: "saved", key, offerId: "off_2" }, [], only([free]))).toEqual({ canCopy: true, offerId: "off_2" });
  });

  it("locks copy again when the picks, their length or the switch change", () => {
    const key = offerKey("et1", EMPTY_MEETING_DETAILS, [], only([free]));
    const saved = { status: "saved", key, offerId: "off_2" } as const;
    expect(copyGate("et1", EMPTY_MEETING_DETAILS, saved, [], only([free, hand]))).toMatchObject({ canCopy: false, status: "saving" });
    expect(copyGate("et1", EMPTY_MEETING_DETAILS, saved, [], only([free], 60))).toMatchObject({ canCopy: false, status: "saving" });
    // Switch turned on: nothing typed, so plain links (no offer) again.
    expect(copyGate("et1", EMPTY_MEETING_DETAILS, saved, [], OPEN_RULES)).toEqual({ canCopy: true });
    const typed = { title: "Demo", guests: [], draft: "" };
    expect(offerKey("et1", typed, [], only([free]))).not.toBe(offerKey("et1", typed, [], OPEN_RULES));
  });

  it("keeps the old key while the switch is on", () => {
    expect(offerKey("et1", EMPTY_MEETING_DETAILS, [], OPEN_RULES)).toBe(offerKey("et1", EMPTY_MEETING_DETAILS));
    expect(offerPlan("et1", EMPTY_MEETING_DETAILS, [], OPEN_RULES)).toEqual({ kind: "none" });
    const plan = offerPlan("et1", { title: "Demo", guests: [] }, [], OPEN_RULES);
    expect(plan.kind === "save" && plan.input).toEqual({ eventTypeId: "et1", title: "Demo", guests: [], manualSlots: [], onlyOffered: false });
  });

  it("stays locked on a slots error, or a saved offer without an id", () => {
    const key = offerKey("et1", EMPTY_MEETING_DETAILS, [], only([free]));
    expect(copyGate("et1", EMPTY_MEETING_DETAILS, { status: "error", key, message: "Fix", fieldErrors: { slots: "A time is in the past" } }, [], only([free]))).toEqual({ canCopy: false, status: "error", message: "Fix" });
    expect(copyGate("et1", EMPTY_MEETING_DETAILS, { status: "saved", key, offerId: null }, [], only([free]))).toEqual({ canCopy: false, status: "error", message: TIMES_SAVE_FAILED });
  });
});

describe("copy gate for a private host", () => {
  const rules: OfferRules = { onlyOffered: false, slots: [], privateHost: true };

  it("always saves first, even with nothing typed, and puts the id in the links", () => {
    const plan = offerPlan("et1", EMPTY_MEETING_DETAILS, [], rules);
    expect(plan.kind).toBe("save");
    const key = plan.kind === "save" ? plan.key : "";
    expect(copyGate("et1", EMPTY_MEETING_DETAILS, { status: "idle" }, [], rules)).toMatchObject({ canCopy: false, status: "saving" });
    expect(copyGate("et1", EMPTY_MEETING_DETAILS, { status: "saved", key, offerId: "off_3" }, [], rules)).toEqual({ canCopy: true, offerId: "off_3" });
  });

  it("trusts the server when it needs no offer for an empty save", () => {
    const key = offerKey("et1", EMPTY_MEETING_DETAILS, [], rules);
    expect(copyGate("et1", EMPTY_MEETING_DETAILS, { status: "saved", key, offerId: null }, [], rules)).toEqual({ canCopy: true });
    expect(copyGate("et1", { title: "Demo", guests: [], draft: "" }, { status: "saved", key: offerKey("et1", { title: "Demo", guests: [] }, [], rules), offerId: null }, [], rules)).toEqual({
      canCopy: false,
      status: "error",
      message: DETAILS_SAVE_FAILED,
    });
  });
});
