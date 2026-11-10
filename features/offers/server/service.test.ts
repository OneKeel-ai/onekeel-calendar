import { describe, expect, it } from "vitest";
import { MAX_OFFER_GUESTS, MAX_OFFER_TITLE, mergeOfferGuests, normalizeOfferGuests, normalizeOfferTitle, offerContentHash } from "./service";

describe("normalizeOfferTitle", () => {
  it("trims, collapses whitespace and strips control characters", () => {
    expect(normalizeOfferTitle("  Quarterly   review\n with\tAcme  ")).toBe("Quarterly review with Acme");
    expect(normalizeOfferTitle("Board\u0000 call\u200b\u202e now")).toBe("Board call now");
  });

  it("turns a blank title into null", () => {
    expect(normalizeOfferTitle("")).toBeNull();
    expect(normalizeOfferTitle(" \n\t\u0007 ")).toBeNull();
  });

  it("leaves the length check to the caller", () => {
    expect(normalizeOfferTitle("x".repeat(MAX_OFFER_TITLE + 1))).toHaveLength(MAX_OFFER_TITLE + 1);
  });
});

describe("normalizeOfferGuests", () => {
  it("lowercases, trims, de-duplicates and drops the hosts' own emails", () => {
    const result = normalizeOfferGuests([" Bob@Example.com", "bob@example.com", "ADA@example.com", "", "cy@example.com "], ["ada@example.com"]);
    expect(result).toEqual({ ok: true, guests: ["bob@example.com", "cy@example.com"] });
  });

  it("rejects an invalid address", () => {
    const result = normalizeOfferGuests(["bob@example.com", "not-an-email"], []);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("not-an-email");
  });

  it(`allows at most ${MAX_OFFER_GUESTS} attendees after de-duplication`, () => {
    const ten = Array.from({ length: MAX_OFFER_GUESTS }, (_, i) => `g${i}@example.com`);
    expect(normalizeOfferGuests([...ten, "G0@example.com"], []).ok).toBe(true);
    expect(normalizeOfferGuests([...ten, "extra@example.com"], []).ok).toBe(false);
    // A host in the list doesn't count toward the cap.
    expect(normalizeOfferGuests([...ten, "host@example.com"], ["host@example.com"]).ok).toBe(true);
  });
});

describe("offerContentHash", () => {
  it("is the same for the same title and attendees in any order", () => {
    expect(offerContentHash("Review", ["a@x.com", "b@x.com"])).toBe(offerContentHash("Review", ["b@x.com", "a@x.com"]));
  });

  it("differs when the title or the attendees differ", () => {
    const base = offerContentHash("Review", ["a@x.com"]);
    expect(offerContentHash("Review 2", ["a@x.com"])).not.toBe(base);
    expect(offerContentHash("Review", ["a@x.com", "b@x.com"])).not.toBe(base);
    expect(offerContentHash(null, ["a@x.com"])).not.toBe(base);
  });
});

describe("mergeOfferGuests", () => {
  it("puts the offer's attendees first, then the booker's, without duplicates, the booker or hosts", () => {
    expect(
      mergeOfferGuests(["exec@acme.com", "cfo@acme.com"], ["Guest@x.com", "exec@acme.com", "me@x.com", "host@us.com"], ["ME@x.com", "host@us.com"]),
    ).toEqual(["exec@acme.com", "cfo@acme.com", "guest@x.com"]);
  });

  it("without an offer behaves like the booker's own de-duplicated list", () => {
    expect(mergeOfferGuests([], ["a@x.com", "A@x.com", "me@x.com"], ["me@x.com"])).toEqual(["a@x.com"]);
  });
});
