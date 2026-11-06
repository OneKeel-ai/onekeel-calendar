import { beforeEach, describe, expect, it, vi } from "vitest";

const withCredential = vi.fn();
const zoomCredentialFor = vi.fn();
vi.mock("./credentials", () => ({ withCredential: (...a: unknown[]) => withCredential(...a) }));
vi.mock("./conferencing", () => ({ zoomCredentialFor: (...a: unknown[]) => zoomCredentialFor(...a) }));
vi.mock("./busy", () => ({ invalidateBusyCache: vi.fn() }));
vi.mock("@/features/bookings/server/service", () => ({ findBookingById: vi.fn() }));
vi.mock("@/features/bookings/server/notifications", () => ({ coHosts: () => [] }));

import { IntegrationError } from "@/lib/integrations/errors";
import { syncCreated } from "./sync";

/** Every select resolves to [] (no prior references); inserts/updates are recorded. */
function deps() {
  const chain = () => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "innerJoin", "where"]) c[m] = () => c;
    c.then = (resolve: (v: unknown) => unknown) => Promise.resolve([]).then(resolve);
    return c;
  };
  const select = vi.fn(chain);
  const insert = vi.fn(() => ({ values: () => Promise.resolve() }));
  const update = vi.fn(() => ({ set: () => ({ where: () => Promise.resolve() }) }));
  return { deps: { db: { select, insert, update }, env: { APP_URL: "https://cal.example.com" }, now: () => 0 } as never, select };
}

const details = {
  booking: { id: "b1", uid: "u1", icalUid: "ical", title: "Intro", locationKind: "zoom", locationValue: null, eventTypeId: "et1", startAt: new Date(1e12), endAt: new Date(1e12 + 1_800_000), notes: null },
  host: { id: "charlie", name: "Charlie", email: "c@example.com", timeZone: "UTC" },
  attendees: [],
} as never;

beforeEach(() => {
  withCredential.mockReset();
  zoomCredentialFor.mockReset();
});

describe("syncCreated for a Zoom booking", () => {
  it("creates no calendar event when the host has no valid Zoom", async () => {
    zoomCredentialFor.mockResolvedValue(null);
    const { deps: d } = deps();
    const out = await syncCreated(d, details);
    expect(zoomCredentialFor).toHaveBeenCalledWith(expect.anything(), "charlie");
    expect(withCredential).not.toHaveBeenCalled();
    expect(out.failures).toContain("Zoom is not connected");
    expect(out.failures.some((f) => f.startsWith("Calendar: not created"))).toBe(true);
    expect(out.meetingUrl).toBeUndefined();
  });

  it("creates no calendar event when the Zoom meeting fails, and lets a transient failure retry", async () => {
    zoomCredentialFor.mockResolvedValue("zoom-cred");
    withCredential.mockRejectedValue(new IntegrationError("transient", "Zoom down"));
    const { deps: d } = deps();
    const out = await syncCreated(d, details);
    // Only the Zoom call: the calendar write would have been a second withCredential call.
    expect(withCredential).toHaveBeenCalledTimes(1);
    expect(withCredential.mock.calls[0][1]).toBe("zoom-cred");
    expect(out.retryable).toBe(true);
    expect(out.failures.some((f) => f.startsWith("Calendar: not created"))).toBe(true);
  });
});
