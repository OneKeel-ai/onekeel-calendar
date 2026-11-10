import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * createBookingAction's request glue around scheduling offers: the offer id reaches the booking
 * service, only the booker's own guests go through the per-guest rate limit, and an invalid offer
 * fails with its own message. Everything with I/O is mocked; the booking itself is covered by
 * tests/integration/scheduling-offers.int.test.ts.
 */

const mocks = vi.hoisted(() => ({
  overLimit: vi.fn(async (_limit: string, _key: string) => false),
  createBooking: vi.fn(),
  getOffer: vi.fn(async (_db: unknown, _id: string, _eventTypeId: string): Promise<{ id: string; title: string | null; guests: string[] } | null> => null),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ CAPTCHA: "off", JITSI_BASE_URL: "https://meet.example.com", AUTH_SECRET: "x".repeat(32) }) }));
vi.mock("@/lib/security/public-limits", () => ({ clientIp: () => "203.0.113.1", overLimit: mocks.overLimit }));
vi.mock("@/lib/security/captcha", () => ({ verifyCaptcha: async () => true }));
vi.mock("@/lib/crypto/encryption", () => ({ cipherFromEnv: () => ({ encrypt: (v: string) => `sealed:${v}` }) }));
vi.mock("@/lib/jobs/enqueue", () => ({ enqueue: vi.fn() }));
vi.mock("@/features/calendars/server/runtime", () => ({ externalBusyFor: () => undefined }));
vi.mock("@/features/calendars/server/conferencing", () => ({ hostsMissingZoom: async () => [] }));
vi.mock("@/features/offers/server/service", () => ({ getOfferForEventType: mocks.getOffer }));
vi.mock("./targets", () => ({
  resolveBookingTarget: async () => ({
    kind: "user",
    host: { id: "h1", name: "Ada", email: "ada@example.com" },
    eventType: { id: "et1", slug: "intro", questions: [], locations: [], redirectUrl: null, linkOnly: false },
    displayName: "Ada",
  }),
}));
vi.mock("./service", async (importOriginal) => ({ ...(await importOriginal<typeof import("./service")>()), createBooking: mocks.createBooking }));

const { createBookingAction } = await import("./public-actions");
const { BookingFailure } = await import("./core");

const payload = {
  username: "ada",
  slug: "intro",
  start: Date.parse("2026-10-05T10:00:00Z"),
  duration: 30,
  booker: { name: "Grace", email: "grace@example.com", timeZone: "UTC" },
  guests: ["typed@example.com"],
  idempotencyKey: "6f1c1f9e-3c1a-4c3b-9a55-2d1d1c7b8e01",
  offer: "Zq9_offer-ID_0123456789abcdefABCD",
};

const created = {
  booking: { id: "b1", uid: "u1", title: "Quarterly review", status: "accepted", startAt: new Date(payload.start), endAt: new Date(payload.start + 1_800_000) },
  attendees: [],
  token: "t",
};

beforeEach(() => {
  mocks.overLimit.mockClear();
  mocks.createBooking.mockReset();
  mocks.getOffer.mockReset();
  mocks.getOffer.mockResolvedValue({ id: payload.offer, title: "Quarterly review", guests: ["exec@acme.com"] });
});

describe("createBookingAction with a scheduling offer", () => {
  it("passes the offer id to the booking and limits typed guests and offer attendees separately", async () => {
    mocks.createBooking.mockResolvedValue(created);
    const result = await createBookingAction(payload);
    expect(result).toMatchObject({ ok: true, data: { uid: "u1" } });
    expect(mocks.createBooking).toHaveBeenCalledOnce();
    expect(mocks.createBooking.mock.calls[0][1]).toMatchObject({ offer: payload.offer, guests: ["typed@example.com"] });
    const guestChecks = mocks.overLimit.mock.calls.filter(([limit]) => limit === "bookAsGuest").map(([, key]) => key);
    // The offer's attendees never spend the booker-guest limit; they have their own, roomier one.
    expect(guestChecks).toEqual(["typed@example.com"]);
    expect(mocks.getOffer).toHaveBeenCalledWith(expect.anything(), payload.offer, "et1");
    expect(mocks.overLimit.mock.calls.filter(([limit]) => limit === "bookAsOfferGuest").map(([, key]) => key)).toEqual(["exec@acme.com"]);
  });

  it("refuses when a forwarded link would flood someone the offer invites", async () => {
    mocks.overLimit.mockImplementation(async (limit: string) => limit === "bookAsOfferGuest");
    const result = await createBookingAction(payload);
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/Too many requests/) });
    expect(mocks.createBooking).not.toHaveBeenCalled();
    mocks.overLimit.mockImplementation(async () => false);
  });

  it("does not spend the offer attendees' limit on a reschedule", async () => {
    mocks.createBooking.mockResolvedValue(created);
    await createBookingAction({ ...payload, reschedule: { uid: "u0", token: "tok" } });
    expect(mocks.overLimit.mock.calls.some(([limit]) => limit === "bookAsOfferGuest")).toBe(false);
  });

  it("still refuses when a typed guest is over their limit", async () => {
    mocks.overLimit.mockImplementation(async (limit: string) => limit === "bookAsGuest");
    const result = await createBookingAction(payload);
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/Too many requests/) });
    expect(mocks.createBooking).not.toHaveBeenCalled();
    mocks.overLimit.mockImplementation(async () => false);
  });

  it("maps OFFER_INVALID to a message telling the client to ask for new times", async () => {
    mocks.createBooking.mockRejectedValue(new BookingFailure("OFFER_INVALID"));
    expect(await createBookingAction(payload)).toEqual({ ok: false, message: "This scheduling link is no longer valid. Ask the sender for new times." });
  });

  it("rejects a malformed offer id before booking", async () => {
    const result = await createBookingAction({ ...payload, offer: "bad id" });
    expect(result).toMatchObject({ ok: false, fieldErrors: { offer: expect.any(String) } });
    expect(mocks.createBooking).not.toHaveBeenCalled();
  });
});
