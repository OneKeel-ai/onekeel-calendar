import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  findBookingById: vi.fn(),
  syncCreated: vi.fn(),
  syncRescheduled: vi.fn(),
  syncCancelled: vi.fn(),
  scheduleEffects: vi.fn(),
}));
vi.mock("@/features/bookings/server/service", () => ({ findBookingById: m.findBookingById }));
vi.mock("@/features/calendars/server/sync", () => ({ syncCreated: m.syncCreated, syncRescheduled: m.syncRescheduled, syncCancelled: m.syncCancelled }));
vi.mock("@/features/bookings/server/notifications", () => ({ buildBookingEmails: () => [{ template: "booking-scheduled", to: "guest@example.com" }] }));
vi.mock("./booking-effects", () => ({ scheduleEffects: m.scheduleEffects, decisionUrls: () => ({}) }));

import { createBookingProcessHandler, RetrySyncError } from "./booking-process";

const details = { booking: { id: "b1", status: "accepted", rescheduled: false }, host: { id: "u1", email: "julie@example.com" }, attendees: [] };
const FAILED = { failures: ["google: HTTP 400"], retryable: false };
const OK = { failures: [], retryable: false };

type Ref = { bookingId: string; kind: string; externalId: string | null; status: string };
const SYNCED: Ref = { bookingId: "b1", kind: "calendar", externalId: "ev1", status: "synced" };
/** The booking_reference rows the proof query returns; `selects` counts how often it ran. */
let refs: Ref[] = [SYNCED];
let selects = 0;
const fakeDb = {
  select: () => ({
    from: () => ({
      where: () => {
        selects++;
        return Promise.resolve(refs);
      },
    }),
  }),
};

function setup() {
  const enqueueEmail = vi.fn().mockResolvedValue(undefined);
  const handler = createBookingProcessHandler({
    db: fakeDb as never,
    cipher: { decrypt: () => "tok" } as never,
    appUrl: "https://cal.example.com",
    authSecret: "s",
    integrations: {} as never,
    enqueueEmail,
    enqueueJob: vi.fn() as never,
    now: () => 1,
  });
  const run = (event: string, job: { retryCount?: number; retryLimit?: number } = {}, extra: Record<string, unknown> = {}) =>
    handler([{ id: "j1", data: { bookingId: "b1", event, previousBookingId: "b0", sealedToken: "x", ...extra }, ...job }]);
  return { enqueueEmail, run };
}

beforeEach(() => {
  vi.resetAllMocks();
  refs = [SYNCED];
  selects = 0;
  m.findBookingById.mockResolvedValue(details);
  m.syncCreated.mockResolvedValue(OK);
  m.syncRescheduled.mockResolvedValue(OK);
  m.syncCancelled.mockResolvedValue(OK);
  vi.stubEnv("CALENDAR_REQUIRED_HOSTS", "*");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("booking.process for a required-calendar host", () => {
  it("does not send the confirmation or schedule effects when the calendar write failed permanently", async () => {
    m.syncCreated.mockResolvedValue(FAILED);
    const { run, enqueueEmail } = setup();
    await run("created");
    expect(enqueueEmail).not.toHaveBeenCalled();
    expect(m.scheduleEffects).not.toHaveBeenCalled();
  });

  it("does not send the rescheduled confirmation after a failed calendar move", async () => {
    m.syncRescheduled.mockResolvedValue(FAILED);
    const { run, enqueueEmail } = setup();
    await run("rescheduled");
    expect(enqueueEmail).not.toHaveBeenCalled();
  });

  it("retries a transient failure first, and withholds on the final attempt", async () => {
    m.syncCreated.mockResolvedValue({ failures: ["timeout"], retryable: true });
    const { run, enqueueEmail } = setup();
    await expect(run("created", { retryCount: 0, retryLimit: 3 })).rejects.toBeInstanceOf(RetrySyncError);
    await run("created", { retryCount: 3, retryLimit: 3 });
    expect(enqueueEmail).not.toHaveBeenCalled();
  });

  it("sends the confirmation and schedules effects when the sync succeeded", async () => {
    const { run, enqueueEmail } = setup();
    await run("created");
    expect(enqueueEmail).toHaveBeenCalledTimes(1);
    expect(m.scheduleEffects).toHaveBeenCalledTimes(1);
  });

  it("withholds when the sync reports no failure but no synced calendar event exists", async () => {
    for (const bad of [[], [{ ...SYNCED, externalId: null }], [{ ...SYNCED, status: "failed" }], [{ ...SYNCED, kind: "conferencing" }]]) {
      refs = bad;
      const { run, enqueueEmail } = setup();
      await run("created");
      expect(enqueueEmail).not.toHaveBeenCalled();
    }
    expect(m.scheduleEffects).not.toHaveBeenCalled();
  });

  it("seat joins skip the sync but still need the shared booking's calendar event", async () => {
    refs = [];
    const failing = setup();
    await failing.run("created", {}, { seatJoined: true, seatAttendeeId: "a1" });
    expect(failing.enqueueEmail).not.toHaveBeenCalled();
    expect(m.syncCreated).not.toHaveBeenCalled();
    refs = [SYNCED];
    const ok = setup();
    await ok.run("created", {}, { seatJoined: true, seatAttendeeId: "a1" });
    expect(ok.enqueueEmail).toHaveBeenCalledTimes(1);
  });

  it("leaves approval requests and cancellations alone, even with no calendar event", async () => {
    refs = [];
    m.syncCancelled.mockResolvedValue(FAILED);
    const { run, enqueueEmail } = setup();
    await run("requested");
    await run("cancelled");
    expect(enqueueEmail).toHaveBeenCalledTimes(2);
  });
});

describe("booking.process for an optional host (unchanged)", () => {
  it("still sends the confirmation after a failed sync", async () => {
    vi.stubEnv("CALENDAR_REQUIRED_HOSTS", "");
    refs = [];
    m.syncCreated.mockResolvedValue(FAILED);
    const { run, enqueueEmail } = setup();
    await run("created");
    expect(enqueueEmail).toHaveBeenCalledTimes(1);
    expect(selects).toBe(0); // optional hosts are never asked for proof
  });

  it("only hosts named in the setting are required", async () => {
    vi.stubEnv("CALENDAR_REQUIRED_HOSTS", "someone-else@example.com");
    m.syncCreated.mockResolvedValue(FAILED);
    const { run, enqueueEmail } = setup();
    await run("created");
    expect(enqueueEmail).toHaveBeenCalledTimes(1);
  });
});
