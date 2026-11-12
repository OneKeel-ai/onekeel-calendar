import { describe, expect, it } from "vitest";
import { blockedAddresses, isAllowedFor, isBlockedCalendar, MAX_GUARD_ADDRESSES, MAX_GUARD_DELEGATES, normalizeGuardInput } from "./guard";

const tre = { email: "tre@example.com", delegates: ["chelsea@example.com"], calendarAddresses: ["board@group.calendar.google.com"] };

describe("isAllowedFor", () => {
  it("allows the person and their delegates only, whatever the case", () => {
    expect(isAllowedFor(tre, "TRE@example.com")).toBe(true);
    expect(isAllowedFor(tre, " Chelsea@Example.com ")).toBe(true);
    expect(isAllowedFor(tre, "admin@example.com")).toBe(false);
    expect(isAllowedFor(tre, "")).toBe(false);
    expect(isAllowedFor(tre, null)).toBe(false);
  });
});

describe("blockedAddresses", () => {
  it("blocks the account email and extra addresses for anyone not allowed", () => {
    expect([...blockedAddresses([tre], "admin@example.com")].toSorted()).toEqual(["board@group.calendar.google.com", "tre@example.com"]);
    expect(blockedAddresses([tre], "chelsea@example.com").size).toBe(0);
    // An unknown viewer is blocked from everything.
    expect(blockedAddresses([tre], "").size).toBe(2);
  });

  it("matches calendar ids case-insensitively", () => {
    const blocked = blockedAddresses([tre], "x@example.com");
    expect(isBlockedCalendar(blocked, "Tre@Example.com")).toBe(true);
    expect(isBlockedCalendar(blocked, "x@example.com")).toBe(false);
    expect(isBlockedCalendar(new Set(), "tre@example.com")).toBe(false);
  });
});

describe("normalizeGuardInput", () => {
  it("lower-cases, trims, drops blanks and duplicates, and sorts", () => {
    expect(normalizeGuardInput({ email: " Tre@Example.com", delegates: ["B@x.com", "a@x.com", "b@x.com", " "], calendarAddresses: ["Board@G.com", "board@g.com", "tre@example.com"] })).toEqual({
      ok: true,
      guard: { email: "tre@example.com", delegates: ["a@x.com", "b@x.com"], calendarAddresses: ["board@g.com"] },
    });
  });

  it("refuses invalid emails, the person as their own delegate, and too many entries", () => {
    expect(normalizeGuardInput({ email: "nope", delegates: [], calendarAddresses: [] })).toMatchObject({ ok: false, fieldErrors: { email: expect.any(String) } });
    expect(normalizeGuardInput({ email: "t@x.com", delegates: ["not-an-email"], calendarAddresses: [] })).toMatchObject({ ok: false, fieldErrors: { delegates: expect.any(String) } });
    expect(normalizeGuardInput({ email: "t@x.com", delegates: ["T@x.com"], calendarAddresses: [] })).toMatchObject({ ok: false, fieldErrors: { delegates: expect.stringContaining("themself") } });
    const many = (n: number) => Array.from({ length: n }, (_, i) => `p${i}@x.com`);
    expect(normalizeGuardInput({ email: "t@x.com", delegates: many(MAX_GUARD_DELEGATES), calendarAddresses: many(MAX_GUARD_ADDRESSES) }).ok).toBe(true);
    expect(normalizeGuardInput({ email: "t@x.com", delegates: many(MAX_GUARD_DELEGATES + 1), calendarAddresses: [] })).toMatchObject({ ok: false, fieldErrors: { delegates: expect.any(String) } });
    expect(normalizeGuardInput({ email: "t@x.com", delegates: [], calendarAddresses: many(MAX_GUARD_ADDRESSES + 1) })).toMatchObject({ ok: false, fieldErrors: { calendarAddresses: expect.any(String) } });
    expect(normalizeGuardInput({ email: "t@x.com", delegates: [], calendarAddresses: ["has space"] })).toMatchObject({ ok: false, fieldErrors: { calendarAddresses: expect.any(String) } });
  });
});
