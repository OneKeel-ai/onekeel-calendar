import { describe, expect, it } from "vitest";
import {
  assertCalendarsUsable,
  busyModeFor,
  CalendarUnavailableError,
  isCalendarRequired,
  parseRequiredHosts,
  REQUIRED_DISPLAY_STALE_MAX_MS,
  resolveProviderFailure,
} from "./safety";

const cal = (over: Partial<{ id: string; name: string; invalid: boolean }> = {}) => ({ id: "c1", name: "Julie Gmail", invalid: false, ...over });
const reason = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(CalendarUnavailableError);
    return (e as CalendarUnavailableError).reason;
  }
  return null;
};

describe("required-host config", () => {
  it("is off when unset or empty, so existing hosts and tests are unchanged", () => {
    expect(isCalendarRequired({ id: "u1" }, undefined)).toBe(false);
    expect(isCalendarRequired({ id: "u1" }, "  ")).toBe(false);
  });
  it("matches '*', ids and emails case-insensitively", () => {
    expect(isCalendarRequired({ id: "u9" }, "*")).toBe(true);
    expect(isCalendarRequired({ id: "U1" }, "u1, u2")).toBe(true);
    expect(isCalendarRequired({ id: "x", email: "Julie@Kunes.com" }, "julie@kunes.com")).toBe(true);
    expect(isCalendarRequired({ id: "x", email: "other@kunes.com" }, "julie@kunes.com")).toBe(false);
    expect(parseRequiredHosts("a,*").all).toBe(true);
  });
});

describe("assertCalendarsUsable", () => {
  it("required host with no calendar (never connected or connection deleted) is refused", () => {
    expect(reason(() => assertCalendarsUsable([], true))).toBe("missing");
  });
  it("required host with a revoked calendar is refused, even if another is fine", () => {
    expect(reason(() => assertCalendarsUsable([cal(), cal({ id: "c2", name: "Work", invalid: true })], true))).toBe("disconnected");
    const err = (() => { try { assertCalendarsUsable([cal({ invalid: true })], true); } catch (e) { return e as CalendarUnavailableError; } })();
    expect(err?.calendars).toEqual(["Julie Gmail"]);
    expect(err?.code).toBe("CALENDAR_UNAVAILABLE");
  });
  it("healthy required host passes", () => {
    expect(reason(() => assertCalendarsUsable([cal()], true))).toBeNull();
  });
  it("optional hosts keep the old behaviour (no calendar / revoked calendar do not throw)", () => {
    expect(reason(() => assertCalendarsUsable([], false))).toBeNull();
    expect(reason(() => assertCalendarsUsable([cal({ invalid: true })], false))).toBeNull();
  });
});

describe("resolveProviderFailure", () => {
  const now = 10_000_000;
  const fresh = { busy: [{ start: 1, end: 2 }], fetchedAt: now - 60_000 };
  const old = { busy: [{ start: 1, end: 2 }], fetchedAt: now - 3_600_000 };

  it("final booking never accepts stale cache for a required host: explicit error", () => {
    expect(reason(() => resolveProviderFailure({ stale: fresh, now, mode: "booking", required: true }))).toBe("provider_failed");
    expect(reason(() => resolveProviderFailure({ stale: undefined, now, mode: "booking", required: true }))).toBe("provider_failed");
  });
  it("final booking for an optional host ignores stale cache and treats the window as busy", () => {
    expect(resolveProviderFailure({ stale: fresh, now, mode: "booking", required: false })).toEqual({ kind: "window_busy" });
  });
  it("display of a required host uses only a few-minute-old cache", () => {
    expect(resolveProviderFailure({ stale: fresh, now, mode: "display", required: true })).toEqual({ kind: "use_stale", busy: fresh.busy });
    expect(reason(() => resolveProviderFailure({ stale: old, now, mode: "display", required: true }))).toBe("provider_failed");
    const edge = { busy: [], fetchedAt: now - REQUIRED_DISPLAY_STALE_MAX_MS };
    expect(reason(() => resolveProviderFailure({ stale: edge, now, mode: "display", required: true }))).toBe("provider_failed");
    expect(reason(() => resolveProviderFailure({ stale: undefined, now, mode: "display", required: true }))).toBe("provider_failed");
  });
  it("display of an optional host keeps the old 6 hour allowance; no cache means window busy", () => {
    expect(resolveProviderFailure({ stale: old, now, mode: "display", required: false })).toEqual({ kind: "use_stale", busy: old.busy });
    expect(resolveProviderFailure({ stale: undefined, now, mode: "display", required: false })).toEqual({ kind: "window_busy" });
  });
  it("a cache row dated in the future is not trusted", () => {
    expect(resolveProviderFailure({ stale: { busy: [], fetchedAt: now + 1000 }, now, mode: "display", required: false })).toEqual({ kind: "window_busy" });
    expect(reason(() => resolveProviderFailure({ stale: { busy: [], fetchedAt: now + 1000 }, now, mode: "display", required: true }))).toBe("provider_failed");
  });
});

describe("busyModeFor", () => {
  it("finite max age = booking/hold, infinite or missing = display", () => {
    expect(busyModeFor(30_000)).toBe("booking");
    expect(busyModeFor(Number.POSITIVE_INFINITY)).toBe("display");
    expect(busyModeFor(undefined)).toBe("display");
  });
});
