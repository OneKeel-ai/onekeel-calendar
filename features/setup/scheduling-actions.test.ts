import { beforeEach, describe, expect, it, vi } from "vitest";

const teamAvailability = vi.fn();
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "julie", timeZone: "America/Chicago" }) }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/features/calendars/server/runtime", () => ({ cachedExternalBusyFor: () => async () => [] }));
vi.mock("@/features/teams/server/availability", () => ({ MAX_VIEW_DAYS: 7, teamAvailability: (...a: unknown[]) => teamAvailability(...a) }));

import { TeamError } from "@/features/teams/server/access";
import { loadScheduleAvailability } from "./server/scheduling-actions";

const DAY = 86_400_000;
const T = 1_800_000_000_000;

beforeEach(() => { teamAvailability.mockReset(); });

describe("loadScheduleAvailability", () => {
  it("checks the caller's own team membership and returns only sanitized busy data", async () => {
    teamAvailability.mockResolvedValue([
      { userId: "charlie", name: "Charlie", email: "c@x.com", timeZone: "UTC", working: [{ start: T, end: T + 1 }], busy: [{ start: T, end: T + 2, title: "Secret", ref: "evt" }] },
    ]);
    const out = await loadScheduleAvailability("team1", T, T + 7 * DAY);
    expect(teamAvailability.mock.calls[0].slice(1, 4)).toEqual(["julie", "team1", { start: T, end: T + 7 * DAY }]);
    expect(out).toEqual({ members: [{ userId: "charlie", name: "Charlie", timeZone: "UTC", working: [{ start: T, end: T + 1 }], busy: [{ start: T, end: T + 2 }] }] });
  });

  it("refuses windows over 7 days or reversed, without reading anything", async () => {
    expect((await loadScheduleAvailability("team1", T, T + 8 * DAY)).error).toBeTruthy();
    expect((await loadScheduleAvailability("team1", T, T)).error).toBeTruthy();
    expect((await loadScheduleAvailability("", T, T + DAY)).error).toBeTruthy();
    expect(teamAvailability).not.toHaveBeenCalled();
  });

  it("returns a generic error to non-members", async () => {
    teamAvailability.mockRejectedValue(new TeamError("NOT_FOUND"));
    expect(await loadScheduleAvailability("other", T, T + DAY)).toEqual({ members: [], error: "This team isn't available." });
  });

  it("does not expose unexpected provider diagnostics", async () => {
    teamAvailability.mockRejectedValue(new Error("db password=hunter2"));
    const out = await loadScheduleAvailability("team1", T, T + DAY);
    expect(out.members).toEqual([]);
    expect(out.error).not.toContain("hunter2");
  });
});
