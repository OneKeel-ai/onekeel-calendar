import { describe, expect, it, vi } from "vitest";
import { credential, eventTypeLocation } from "@/db/schema";
import { CalendarUnavailableError } from "@/lib/calendars/safety";
import { assertConferencingReady, hostsMissingZoom, isZoomOnly, pickZoomCredential, zoomCredentialFor } from "./conferencing";

const at = (iso: string) => new Date(iso);
type Row = { id: string; userId: string; provider: string; invalidAt: Date | null; createdAt: Date };
const row = (over: Partial<Row>): Row => ({ id: "z1", userId: "charlie", provider: "zoom", invalidAt: null, createdAt: at("2026-01-01"), ...over });

/** select().from(table).where() resolves to the rows for that table; records what was queried. */
function fakeDb(tables: { locations?: { kind: string }[]; credentials?: Row[] }) {
  const from = vi.fn((table: unknown) => ({
    where: () => Promise.resolve(table === eventTypeLocation ? (tables.locations ?? []) : table === credential ? (tables.credentials ?? []) : []),
  }));
  return { db: { select: () => ({ from }) } as never, from };
}

describe("pickZoomCredential", () => {
  it("picks the newest valid Zoom credential, skipping invalid and non-Zoom ones", () => {
    const rows = [
      row({ id: "old", createdAt: at("2026-01-01") }),
      row({ id: "revoked", createdAt: at("2026-06-01"), invalidAt: at("2026-06-02") }),
      row({ id: "google", provider: "google", createdAt: at("2026-07-01") }),
      row({ id: "new", createdAt: at("2026-03-01") }),
    ];
    expect(pickZoomCredential(rows, "charlie")).toBe("new");
  });

  it("is deterministic on equal timestamps and never uses another user's credential", () => {
    expect(pickZoomCredential([row({ id: "a" }), row({ id: "b" })], "charlie")).toBe("b");
    expect(pickZoomCredential([row({ id: "b" }), row({ id: "a" })], "charlie")).toBe("b");
    expect(pickZoomCredential([row({ id: "julies", userId: "julie" })], "charlie")).toBeNull();
  });

  it("returns null when every Zoom credential is invalid", () => {
    expect(pickZoomCredential([row({ invalidAt: at("2026-02-01") })], "charlie")).toBeNull();
    expect(pickZoomCredential([], "charlie")).toBeNull();
  });
});

describe("conferencing readiness", () => {
  it("detects Zoom-only event types", () => {
    expect(isZoomOnly([{ kind: "zoom" }])).toBe(true);
    expect(isZoomOnly([{ kind: "zoom" }, { kind: "phone_host" }])).toBe(false);
    expect(isZoomOnly([])).toBe(false);
  });

  it("fails closed for a Zoom-only event type whose host has no valid Zoom", async () => {
    const { db } = fakeDb({ locations: [{ kind: "zoom" }], credentials: [row({ invalidAt: at("2026-02-01") })] });
    await expect(assertConferencingReady(db, "charlie", "et1")).rejects.toBeInstanceOf(CalendarUnavailableError);
    await expect(assertConferencingReady(fakeDb({ locations: [{ kind: "zoom" }] }).db, "charlie", "et1")).rejects.toMatchObject({ reason: "missing" });
  });

  it("passes with the host's valid Zoom, and doesn't gate non-Zoom-only types or the team view", async () => {
    await expect(assertConferencingReady(fakeDb({ locations: [{ kind: "zoom" }], credentials: [row({})] }).db, "charlie", "et1")).resolves.toBeUndefined();
    const mixed = fakeDb({ locations: [{ kind: "zoom" }, { kind: "phone_host" }] });
    await expect(assertConferencingReady(mixed.db, "charlie", "et1")).resolves.toBeUndefined();
    expect(mixed.from).not.toHaveBeenCalledWith(credential);
    const none = fakeDb({});
    await expect(assertConferencingReady(none.db, "charlie", "")).resolves.toBeUndefined();
    expect(none.from).not.toHaveBeenCalled();
  });

  it("lists hosts who can't provide a chosen Zoom meeting", async () => {
    expect(await hostsMissingZoom(fakeDb({}).db, ["charlie", "charlie"])).toEqual(["charlie"]);
    expect(await hostsMissingZoom(fakeDb({ credentials: [row({})] }).db, ["charlie"])).toEqual([]);
    expect(await zoomCredentialFor(fakeDb({ credentials: [row({ id: "z9" })] }).db, "charlie")).toBe("z9");
  });
});
