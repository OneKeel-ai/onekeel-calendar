import { describe, expect, it } from "vitest";
import {
  findManualSlot,
  MAX_OFFER_GUESTS,
  MAX_OFFER_MANUAL_SLOTS,
  MAX_OFFER_TITLE,
  mergeOfferGuests,
  normalizeManualSlots,
  normalizeOfferGuests,
  normalizeOfferTitle,
  offerAllows,
  offerContentHash,
  normalizeOfferedSlots,
} from "./service";

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

describe("normalizeManualSlots", () => {
  const now = Date.parse("2026-10-01T08:00:00Z");
  const at = (iso: string, duration = 30) => ({ start: iso, duration });
  const check = (raw: { start: string; duration: number }[], durations = [30, 60]) => normalizeManualSlots(raw, durations, now);

  it("parses ISO instants (any offset) into epoch ms, sorted by start", () => {
    expect(check([at("2026-10-05T10:00:00.000Z", 60), at("2026-10-05T05:30:00-04:00")])).toEqual({
      ok: true,
      slots: [
        { start: Date.parse("2026-10-05T09:30:00Z"), duration: 30 },
        { start: Date.parse("2026-10-05T10:00:00Z"), duration: 60 },
      ],
    });
  });

  it("refuses unparseable or non-ISO starts", () => {
    for (const start of ["", "tomorrow", "2026-10-05", "2026-10-05T10:00:00", "1759658400000", "2026-13-05T10:00:00Z"]) {
      expect(check([at(start)]).ok, start).toBe(false);
    }
  });

  it("refuses past or current starts and starts more than 365 days out", () => {
    expect(check([at("2026-10-01T08:00:00Z")])).toMatchObject({ ok: false, error: expect.stringContaining("past") });
    expect(check([at("2026-09-30T10:00:00Z")]).ok).toBe(false);
    expect(check([at("2027-10-01T08:00:00Z")]).ok).toBe(true); // exactly 365 days
    expect(check([at("2027-10-01T08:05:00Z")])).toMatchObject({ ok: false, error: expect.stringContaining("365 days") });
  });

  it("requires a 5-minute boundary", () => {
    expect(check([at("2026-10-05T10:05:00Z")]).ok).toBe(true);
    expect(check([at("2026-10-05T10:07:00Z")])).toMatchObject({ ok: false, error: expect.stringContaining("5-minute") });
    expect(check([at("2026-10-05T10:05:30Z")]).ok).toBe(false);
  });

  it("requires one of the event type's durations", () => {
    expect(check([at("2026-10-05T10:00:00Z", 45)])).toMatchObject({ ok: false, error: expect.stringContaining("45 minutes") });
    expect(check([at("2026-10-05T10:00:00Z", 60)]).ok).toBe(true);
  });

  it("refuses duplicates (same instant and duration, however written) but allows another duration", () => {
    expect(check([at("2026-10-05T10:00:00Z"), at("2026-10-05T12:00:00+02:00")])).toMatchObject({ ok: false, error: expect.stringContaining("twice") });
    expect(check([at("2026-10-05T10:00:00Z"), at("2026-10-05T10:00:00Z", 60)]).ok).toBe(true);
  });

  it(`allows at most ${MAX_OFFER_MANUAL_SLOTS}`, () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => at(new Date(Date.parse("2026-10-05T00:00:00Z") + i * 3_600_000).toISOString()));
    expect(check(many(MAX_OFFER_MANUAL_SLOTS)).ok).toBe(true);
    expect(check(many(MAX_OFFER_MANUAL_SLOTS + 1))).toMatchObject({ ok: false, error: expect.stringContaining(String(MAX_OFFER_MANUAL_SLOTS)) });
  });
});

describe("offerContentHash with times added by hand", () => {
  const a = { start: Date.parse("2026-10-05T10:00:00Z"), duration: 30 };
  const b = { start: Date.parse("2026-10-06T07:00:00Z"), duration: 60 };

  it("is unchanged for offers without them (existing rows keep their hash)", () => {
    expect(offerContentHash("Review", ["a@x.com"], [])).toBe(offerContentHash("Review", ["a@x.com"]));
  });

  it("includes them, in any order", () => {
    const base = offerContentHash("Review", [], [a, b]);
    expect(offerContentHash("Review", [], [b, a])).toBe(base);
    expect(base).not.toBe(offerContentHash("Review", []));
    expect(offerContentHash("Review", [], [a])).not.toBe(base);
    expect(offerContentHash("Review", [], [a, { ...b, duration: 30 }])).not.toBe(base);
  });
});

describe("findManualSlot", () => {
  it("matches only the exact start and duration, for the host it was saved for", () => {
    const offer = { manualSlots: [{ start: 1_000_000, duration: 30 }], manualHostId: "cy" };
    expect(findManualSlot(offer, 1_000_000, 30, "cy")).toEqual({ start: 1_000_000, duration: 30 });
    expect(findManualSlot(offer, 1_000_000, 60, "cy")).toBeUndefined();
    expect(findManualSlot(offer, 1_060_000, 30, "cy")).toBeUndefined();
    expect(findManualSlot(null, 1_000_000, 30, "cy")).toBeUndefined();
  });

  it("is not honoured for another host, or when no host was recorded", () => {
    const slots = [{ start: 1_000_000, duration: 30 }];
    expect(findManualSlot({ manualSlots: slots, manualHostId: "cy" }, 1_000_000, 30, "dee")).toBeUndefined();
    expect(findManualSlot({ manualSlots: slots, manualHostId: null }, 1_000_000, 30, "cy")).toBeUndefined();
  });
});

describe("restricted offers (only the times sent)", () => {
  const now = Date.parse("2026-10-01T08:00:00Z");
  const at = (iso: string, duration = 30) => ({ start: iso, duration });

  it("needs 1 to 10 valid, distinct times", () => {
    expect(normalizeOfferedSlots([], [30], now)).toMatchObject({ ok: false });
    expect(normalizeOfferedSlots(Array.from({ length: 11 }, (_, i) => at(`2026-10-05T1${i % 10}:${i < 10 ? "00" : "30"}:00Z`)), [30], now)).toMatchObject({ ok: false });
    expect(normalizeOfferedSlots([at("2026-10-05T10:00:00Z"), at("2026-10-05T10:00:00Z")], [30], now)).toMatchObject({ ok: false });
    expect(normalizeOfferedSlots([at("2026-10-05T10:00:00Z", 45)], [30], now)).toMatchObject({ ok: false });
    expect(normalizeOfferedSlots([at("2026-10-05T11:00:00Z"), at("2026-10-05T10:00:00Z")], [30], now)).toEqual({
      ok: true,
      slots: [
        { start: Date.parse("2026-10-05T10:00:00Z"), duration: 30 },
        { start: Date.parse("2026-10-05T11:00:00Z"), duration: 30 },
      ],
    });
  });

  it("hashes the times order-independently and leaves unrestricted hashes unchanged", () => {
    const a = { start: 1, duration: 30 };
    const b = { start: 2, duration: 30 };
    expect(offerContentHash("T", [], [], null, [a, b])).toBe(offerContentHash("T", [], [], null, [b, a]));
    expect(offerContentHash("T", [], [], null, [a])).not.toBe(offerContentHash("T", [], [], null, [a, b]));
    expect(offerContentHash("T", [], [], null, [a])).not.toBe(offerContentHash("T", []));
    expect(offerContentHash("T", [], [], null, null)).toBe(offerContentHash("T", []));
  });

  it("allows only the times on the card when restricted, anything otherwise", () => {
    const offer = { restricted: true, offeredSlots: [{ start: 1000, duration: 30 }] };
    expect(offerAllows(offer, 1000, 30)).toBe(true);
    expect(offerAllows(offer, 1000, 60)).toBe(false);
    expect(offerAllows(offer, 2000, 30)).toBe(false);
    expect(offerAllows({ restricted: false, offeredSlots: [] }, 2000, 30)).toBe(true);
    expect(offerAllows(null, 2000, 30)).toBe(true);
    expect(offerAllows({ restricted: true, offeredSlots: [] }, 1000, 30)).toBe(false);
  });
});
