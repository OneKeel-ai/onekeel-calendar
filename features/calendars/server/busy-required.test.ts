import { beforeEach, describe, expect, it, vi } from "vitest";
import { calendarBusyCache, connectedCalendar } from "@/db/schema";
import { CalendarUnavailableError } from "@/lib/calendars/safety";

const withCredential = vi.fn();
vi.mock("./credentials", () => ({ withCredential: (...args: unknown[]) => withCredential(...args) }));
vi.mock("@/lib/integrations/registry", () => ({ getProvider: () => ({ id: "google" }) }));

import { getExternalBusy } from "./busy";

const NOW = 1_000_000_000_000;
const window = { start: NOW, end: NOW + 86_400_000 };

type Cal = { id: string; credentialId: string; externalId: string; name: string; provider: string; invalidAt: Date | null; checkConflicts: boolean; overrideFor: null };
const cal = (over: Partial<Cal> = {}): Cal => ({ id: "c1", credentialId: "k1", externalId: "ext", name: "Julie Gmail", provider: "google", invalidAt: null, checkConflicts: true, overrideFor: null, ...over });

/** Minimal drizzle stand-in: select().from(table)... resolves to the rows for that table. */
function fakeDb(calendars: Cal[], cacheRow?: { busy: { start: number; end: number }[]; fetchedAt: Date }) {
  const chain = (rows: unknown[]) => {
    const c: Record<string, unknown> = {};
    for (const m of ["innerJoin", "leftJoin", "where", "orderBy"]) c[m] = () => c;
    c.limit = () => Promise.resolve(rows);
    c.then = (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve);
    return c;
  };
  return {
    select: () => ({ from: (table: unknown) => chain(table === connectedCalendar ? calendars : table === calendarBusyCache ? (cacheRow ? [cacheRow] : []) : []) }),
    insert: () => ({ values: () => ({ onConflictDoUpdate: () => Promise.resolve() }) }),
  };
}

const deps = (db: unknown) => ({ db, env: { APP_URL: "https://cal.example.com" }, now: () => NOW }) as never;
const ask = (db: unknown, extra: { maxAgeMs?: number; requireCalendar?: boolean }) =>
  getExternalBusy(deps(db), { userId: "u1", window, timeZone: "UTC", ...extra });

// Braces matter: returning the mock from beforeEach makes vitest call it as a cleanup hook after
// every test, which re-runs mockRejectedValue(boom) as an unhandled rejection.
beforeEach(() => {
  withCredential.mockReset();
});

describe("getExternalBusy for a required host", () => {
  it("refuses when no calendar is configured (no free slots, no booking)", async () => {
    await expect(ask(fakeDb([]), { requireCalendar: true, maxAgeMs: 30_000 })).rejects.toBeInstanceOf(CalendarUnavailableError);
    await expect(ask(fakeDb([]), { requireCalendar: true })).rejects.toMatchObject({ reason: "missing" });
    expect(withCredential).not.toHaveBeenCalled();
  });

  it("refuses when the Google credential was revoked, without calling the provider", async () => {
    const db = fakeDb([cal({ invalidAt: new Date(NOW - 1000) })], { busy: [], fetchedAt: new Date(NOW - 1000) });
    await expect(ask(db, { requireCalendar: true })).rejects.toMatchObject({ reason: "disconnected" });
    expect(withCredential).not.toHaveBeenCalled();
  });

  it("final booking: provider failure with a 1 minute old cache row is an explicit error, not stale busy times", async () => {
    withCredential.mockRejectedValue(new Error("boom"));
    const db = fakeDb([cal()], { busy: [], fetchedAt: new Date(NOW - 60_000) });
    await expect(ask(db, { requireCalendar: true, maxAgeMs: 30_000 })).rejects.toMatchObject({ reason: "provider_failed" });
  });

  it("display: provider failure with no recent cache throws instead of showing the host as free", async () => {
    withCredential.mockRejectedValue(new Error("boom"));
    const db = fakeDb([cal()], { busy: [], fetchedAt: new Date(NOW - 3_600_000) });
    await expect(ask(db, { requireCalendar: true })).rejects.toMatchObject({ reason: "provider_failed" });
  });

  it("healthy calendar returns the provider's busy times", async () => {
    withCredential.mockResolvedValue({ ext: [{ start: NOW + 1000, end: NOW + 2000 }] });
    const result = await ask(fakeDb([cal()]), { requireCalendar: true, maxAgeMs: 30_000 });
    expect(result.busy).toEqual([{ start: NOW + 1000, end: NOW + 2000, ref: "Julie Gmail" }]);
  });
});

describe("getExternalBusy for an optional host (old behaviour kept)", () => {
  it("no calendar means no external busy and no error", async () => {
    expect(await ask(fakeDb([]), { requireCalendar: false })).toEqual({ busy: [], degraded: false });
  });

  it("final booking provider failure no longer uses stale cache: whole window is busy", async () => {
    withCredential.mockRejectedValue(new Error("boom"));
    const db = fakeDb([cal()], { busy: [], fetchedAt: new Date(NOW - 60_000) });
    const result = await ask(db, { requireCalendar: false, maxAgeMs: 30_000 });
    expect(result.busy).toEqual([{ start: window.start, end: window.end, ref: "Julie Gmail" }]);
  });
});
