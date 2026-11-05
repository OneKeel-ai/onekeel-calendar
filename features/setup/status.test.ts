import { describe, expect, it } from "vitest";
import { buildSteps, calendarStatus } from "./status";

const good = { invalid: false, calendars: [{ name: "Work", checkConflicts: true, isDestination: true }] };

describe("calendarStatus", () => {
  it("is not healthy without a connection", () => {
    expect(calendarStatus([])).toMatchObject({ state: "todo", healthy: false });
  });
  it("flags a broken connection even when another one works", () => {
    expect(calendarStatus([good, { invalid: true, calendars: [] }])).toMatchObject({ state: "attention", healthy: false });
  });
  it("needs at least one calendar checked for conflicts", () => {
    expect(calendarStatus([{ invalid: false, calendars: [{ name: "A", checkConflicts: false, isDestination: false }] }])).toMatchObject({
      state: "attention",
      healthy: false,
    });
  });
  it("requires a writable destination for the calendar event", () => {
    expect(calendarStatus([{ invalid: false, calendars: [{ name: "Read only", checkConflicts: true, isDestination: false }] }])).toMatchObject({ state: "attention", healthy: false });
  });
  it("is healthy with a checked calendar and names the destination", () => {
    const s = calendarStatus([good]);
    expect(s).toMatchObject({ state: "done", healthy: true, checked: 1, destination: "Work" });
  });
});

describe("buildSteps", () => {
  const base = { username: "julie", timeZone: "America/Chicago", connections: [good], enabledEventTypes: 1, workingHourRanges: 5 };
  it("marks everything done for a complete setup", () => {
    expect(buildSteps(base).map((s) => s.state)).toEqual(["done", "done", "done", "done"]);
  });
  it("keeps email times off until the calendar works", () => {
    const steps = buildSteps({ ...base, connections: [] });
    expect(steps.find((s) => s.id === "email")?.state).toBe("todo");
    expect(steps.find((s) => s.id === "calendar")?.state).toBe("todo");
  });
  it("treats UTC as not set and empty hours as unfinished", () => {
    const steps = buildSteps({ ...base, timeZone: "UTC", workingHourRanges: 0 });
    expect(steps.find((s) => s.id === "profile")?.state).toBe("todo");
    expect(steps.find((s) => s.id === "meetings")?.href).toBe("/availability");
  });
});
