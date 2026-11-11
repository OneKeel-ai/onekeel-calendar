import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPool } from "@/db/client";
import { booking, connectedCalendar, credential, eventTypeConflictCalendar, schedulingOffer, slotReservation } from "@/db/schema";
import { BookingFailure, createBooking, getAvailableSlots, getManualOfferSlots, holdSlot, withManualSlots } from "@/features/bookings/server/service";
import { invalidatePublicContext } from "@/features/bookings/server/public-context";
import { resolveBookingTarget } from "@/features/bookings/server/targets";
import { createEventType } from "@/features/event-types/server/service";
import { getOfferForEventType, saveOffer } from "@/features/offers/server/service";
import { loadSetup } from "@/features/setup/server/load";
import { createTeamEventType, setHosts } from "@/features/teams/server/event-types";
import { resetEnvCache } from "@/lib/env";
import { testDatabase } from "./helpers";
import { booker, code, form, MON, NOW, world } from "./team-fixtures";

const { db, url, close } = testDatabase();
const saved = { ...process.env };

beforeAll(() => {
  // The public slot route reads the app's own database and integration settings from the env.
  process.env = {
    ...saved,
    DATABASE_URL: url,
    APP_URL: "http://localhost:3000",
    AUTH_SECRET: "x".repeat(32),
    ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"),
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: "1",
    SMTP_FROM: "t@x.test",
  };
  resetEnvCache();
});

afterAll(async () => {
  await getPool().end();
  process.env = saved;
  resetEnvCache();
  await close();
});

/**
 * Times added by hand to a scheduling offer: bookable over the host's calendar and outside their
 * working hours (default Mon–Fri 09:00–17:00 UTC here), never over another booking made here.
 */

let teamId: string;
beforeEach(async () => {
  teamId = await world(db); // ada (owner), bob (admin), cy, dee; eve is outside the team
  invalidatePublicContext();
});

const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
const slot = (start: number, duration = 30) => ({ start: iso(start), duration });

/** Ada's personal "intro" (30 or 60 minutes). */
async function personal(patch: Record<string, unknown> = {}) {
  const id = await createEventType(db, "ada", form({ slug: "intro", extraDurations: [60], ...patch }));
  const target = (await resolveBookingTarget(db, { username: "ada", slug: "intro" }))!;
  return { id, target };
}

async function offerWith(eventTypeId: string, manualSlots: { start: string; duration: number }[], extra: { title?: string; guests?: string[] } = {}) {
  const result = await saveOffer(db, "ada", { eventTypeId, title: extra.title ?? "", guests: extra.guests ?? [], manualSlots }, NOW);
  if (!result.ok || !result.offerId) throw new Error(`offer not saved: ${JSON.stringify(result)}`);
  return result.offerId;
}

describe("saving times added by hand", () => {
  it("saves them on their own, as ISO strings, and reads them back in epoch ms", async () => {
    const { id } = await personal();
    const offer = await offerWith(id, [slot(MON("19:00"), 60), slot(MON("06:00"))]);
    const [row] = await db.select().from(schedulingOffer).where(eq(schedulingOffer.id, offer));
    expect(row.manualSlots).toEqual([
      { start: "2026-10-05T06:00:00.000Z", duration: 30, hostId: "ada" },
      { start: "2026-10-05T19:00:00.000Z", duration: 60, hostId: "ada" },
    ]);
    expect(await getOfferForEventType(db, offer, id)).toEqual({
      id: offer,
      title: null,
      guests: [],
      manualSlots: [
        { start: MON("06:00"), duration: 30 },
        { start: MON("19:00"), duration: 60 },
      ],
      manualHostId: "ada",
    });
  });

  it("keeps offers immutable: same times in any order reuse the row, other times make a new one", async () => {
    const { id } = await personal();
    const first = await offerWith(id, [slot(MON("06:00")), slot(MON("19:00"))], { title: "Review" });
    expect(await offerWith(id, [slot(MON("19:00")), slot(MON("06:00"))], { title: "Review" })).toBe(first);
    expect(await offerWith(id, [slot(MON("06:00"))], { title: "Review" })).not.toBe(first);
    const titleOnly = await saveOffer(db, "ada", { eventTypeId: id, title: "Review", guests: [] }, NOW);
    expect(titleOnly.ok && titleOnly.offerId).not.toBe(first);
    expect(await saveOffer(db, "ada", { eventTypeId: id, title: "", guests: [], manualSlots: [] }, NOW)).toEqual({ ok: true, offerId: null });
  });

  it("validates count, past, 5-minute marks, 365 days, durations and duplicates with a manualSlots error", async () => {
    const { id } = await personal();
    const refused = async (manualSlots: { start: string; duration: number }[]) =>
      expect(await saveOffer(db, "ada", { eventTypeId: id, title: "", guests: [], manualSlots }, NOW)).toMatchObject({ ok: false, fieldErrors: { manualSlots: expect.any(String) } });
    await refused(Array.from({ length: 11 }, (_, i) => slot(MON("00:00") + i * 60 * MIN)));
    await refused([slot(NOW - 60 * MIN)]);
    await refused([slot(MON("06:07"))]);
    await refused([slot(NOW + 366 * 24 * 60 * MIN)]);
    await refused([slot(MON("06:00"), 45)]);
    await refused([slot(MON("06:00")), slot(MON("06:00"))]);
    await refused([{ start: "next monday", duration: 30 }]);
    expect(await db.select().from(schedulingOffer)).toHaveLength(0);
  });

  it("allows a team event type with a single host, refuses several hosts and seats", async () => {
    const single = await createTeamEventType(db, "ada", teamId, "round_robin", form({ slug: "cy-intro" }));
    await setHosts(db, "ada", teamId, single, { hosts: [{ userId: "cy", isFixed: true, weight: 100, priority: 2 }], roundRobinWindowDays: 30 });
    const multi = await createTeamEventType(db, "ada", teamId, "collective", form({ slug: "panel" }));
    await setHosts(db, "ada", teamId, multi, {
      hosts: [
        { userId: "cy", isFixed: true, weight: 100, priority: 2 },
        { userId: "dee", isFixed: true, weight: 100, priority: 2 },
      ],
      roundRobinWindowDays: 30,
    });
    const seated = await createEventType(db, "ada", form({ slug: "webinar", seatsPerSlot: 5 }));
    const save = (eventTypeId: string, userId = "bob") => saveOffer(db, userId, { eventTypeId, title: "", guests: [], manualSlots: [slot(MON("06:00"))] }, NOW);
    expect(await save(single)).toMatchObject({ ok: true, offerId: expect.any(String) });
    expect(await save(multi)).toMatchObject({ ok: false, fieldErrors: { manualSlots: expect.stringContaining("one host") } });
    expect(await save(seated, "ada")).toMatchObject({ ok: false, fieldErrors: { manualSlots: expect.stringContaining("seats") } });
  });
});

describe("booking a time added by hand", () => {
  /** The host's calendar is busy all Monday; records whether it was read. */
  function busyCalendar() {
    const calls: unknown[] = [];
    return {
      calls,
      externalBusy: async (window: { start: number; end: number }) => {
        calls.push(window);
        return [{ start: MON("00:00"), end: MON("23:59"), ref: "Work" }];
      },
    };
  }

  const base = (target: Awaited<ReturnType<typeof personal>>["target"]) => ({
    host: target.host,
    eventType: target.eventType,
    durationMin: 30,
    booker: booker(1),
    guests: [] as string[],
    now: NOW,
  });

  it("books over the host's calendar and outside working hours, without reading the calendar", async () => {
    const { id, target } = await personal({ minNoticeMinutes: 7 * 24 * 60 });
    const offer = await offerWith(id, [slot(MON("06:00")), slot(MON("10:00"))], { title: "Board prep" });
    const { calls, externalBusy } = busyCalendar();
    const writable: string[] = [];
    const calendarWritable = async (hostId: string) => void writable.push(hostId);
    const early = await createBooking(db, { ...base(target), start: MON("06:00"), offer, externalBusy, calendarWritable });
    expect(early.booking).toMatchObject({ title: "Board prep", offerId: offer, status: "accepted" });
    // Inside working hours but busy on the calendar and within the week's notice.
    await createBooking(db, { ...base(target), booker: booker(2), start: MON("10:00"), offer, externalBusy, calendarWritable });
    expect(calls).toHaveLength(0);
    expect(writable).toEqual(["ada", "ada"]);
  });

  it("refuses the same start without the offer, with another offer, or at another duration", async () => {
    const { id, target } = await personal();
    const offer = await offerWith(id, [slot(MON("06:00"))]);
    const other = await offerWith(id, [slot(MON("07:00"))]);
    const { externalBusy } = busyCalendar();
    expect(await code(createBooking(db, { ...base(target), start: MON("06:00"), externalBusy }))).toBe("SLOT_UNAVAILABLE");
    expect(await code(createBooking(db, { ...base(target), start: MON("06:00"), offer: other, externalBusy }))).toBe("SLOT_UNAVAILABLE");
    expect(await code(createBooking(db, { ...base(target), start: MON("06:00"), durationMin: 60, offer, externalBusy }))).toBe("SLOT_UNAVAILABLE");
    expect(await code(createBooking(db, { ...base(target), start: MON("06:00"), offer: "gone-offer", externalBusy }))).toBe("OFFER_INVALID");
    expect(await db.select().from(booking)).toHaveLength(0);
  });

  it("does not affect normal times: an offer link still respects the calendar elsewhere", async () => {
    const { id, target } = await personal();
    const offer = await offerWith(id, [slot(MON("06:00"))]);
    const { externalBusy } = busyCalendar();
    expect(await code(createBooking(db, { ...base(target), start: MON("11:00"), offer, externalBusy }))).toBe("SLOT_UNAVAILABLE");
  });

  it("refuses a time that overlaps another booking made here", async () => {
    const { id, target } = await personal();
    await createBooking(db, { ...base(target), start: MON("10:00"), booker: booker(9) });
    const offer = await offerWith(id, [slot(MON("10:15"))]);
    expect(await code(createBooking(db, { ...base(target), start: MON("10:15"), offer }))).toBe("SLOT_UNAVAILABLE");
  });

  it("refuses a time that is in the past by now", async () => {
    const { id, target } = await personal();
    const offer = await offerWith(id, [slot(MON("06:00"))]);
    expect(await code(createBooking(db, { ...base(target), start: MON("06:00"), offer, now: MON("06:30") }))).toBe("SLOT_UNAVAILABLE");
  });

  it("refuses a time held by another booker, and books it with the holder's own token", async () => {
    const { id, target } = await personal();
    const offer = await offerWith(id, [slot(MON("06:00"))]);
    const hold = { host: target.host, eventType: target.eventType, start: MON("06:00"), durationMin: 30, now: NOW };
    expect(await code(holdSlot(db, { ...hold, token: "t".repeat(32) }))).toBe("SLOT_UNAVAILABLE"); // no offer: outside hours
    expect(await code(holdSlot(db, { ...hold, token: "t".repeat(32), offer: "unknown" }))).toBe("OFFER_INVALID");
    await holdSlot(db, { ...hold, token: "t".repeat(32), offer });
    expect(await db.select().from(slotReservation)).toHaveLength(1);
    expect(await code(holdSlot(db, { ...hold, token: "u".repeat(32), offer }))).toBe("SLOT_UNAVAILABLE");
    expect(await code(createBooking(db, { ...base(target), start: MON("06:00"), offer, holdToken: "u".repeat(32) }))).toBe("SLOT_UNAVAILABLE");
    await createBooking(db, { ...base(target), start: MON("06:00"), offer, holdToken: "t".repeat(32) });
  });

  it("refuses a CALENDAR_UNAVAILABLE write check, but needs no calendar read", async () => {
    const { id, target } = await personal();
    const offer = await offerWith(id, [slot(MON("06:00"))]);
    const unreadable = async (): Promise<never> => {
      throw new BookingFailure("CALENDAR_UNAVAILABLE", "provider_failed");
    };
    // Reading would fail: a time added by hand doesn't read, so it books.
    await createBooking(db, { ...base(target), start: MON("06:00"), offer, externalBusy: unreadable });
    // Writing would fail: refused.
    const offer2 = await offerWith(id, [slot(MON("07:00"))]);
    expect(await code(createBooking(db, { ...base(target), booker: booker(2), start: MON("07:00"), offer: offer2, calendarWritable: unreadable }))).toBe("CALENDAR_UNAVAILABLE");
  });

  it("lets the client move the booking to another time added by hand on the same offer, but not off-hours elsewhere", async () => {
    const { id, target } = await personal();
    const offer = await offerWith(id, [slot(MON("06:00")), slot(MON("06:15")), slot(MON("19:00"))], { title: "Board prep" });
    const { externalBusy } = busyCalendar();
    const first = await createBooking(db, { ...base(target), start: MON("06:00"), offer, externalBusy });
    // Overlaps the booking being moved: allowed.
    const moved = await createBooking(db, { ...base(target), start: MON("06:15"), externalBusy, reschedule: { uid: first.booking.uid, token: first.token } });
    expect(moved.booking).toMatchObject({ offerId: offer, title: "Board prep", rescheduledFromId: first.booking.id });
    const again = await createBooking(db, { ...base(target), start: MON("19:00"), externalBusy, reschedule: { uid: moved.booking.uid, token: moved.token } });
    expect(again.booking.startAt.getTime()).toBe(MON("19:00"));
    expect(await code(createBooking(db, { ...base(target), start: MON("20:00"), externalBusy, reschedule: { uid: again.booking.uid, token: again.token } }))).toBe("SLOT_UNAVAILABLE");
  });

  it("is only honoured with a single host: a team type that gained a host books by the usual rules", async () => {
    const team = await createTeamEventType(db, "ada", teamId, "round_robin", form({ slug: "cy-intro" }));
    await setHosts(db, "ada", teamId, team, { hosts: [{ userId: "cy", isFixed: true, weight: 100, priority: 2 }], roundRobinWindowDays: 30 });
    const offer = (await saveOffer(db, "bob", { eventTypeId: team, title: "", guests: [], manualSlots: [slot(MON("06:00"))] }, NOW)) as { offerId: string };
    const teamInput = async () => {
      const t = (await resolveBookingTarget(db, { team: "acme", slug: "cy-intro" }))!;
      return { host: t.host, hosts: t.hosts, hostsLabel: t.displayName, eventType: t.eventType, start: MON("06:00"), durationMin: 30, booker: booker(1), guests: [], now: NOW, offer: offer.offerId };
    };
    const created = await createBooking(db, await teamInput());
    expect(created.booking.organizerId).toBe("cy");
    await setHosts(db, "ada", teamId, team, {
      hosts: [
        { userId: "cy", isFixed: false, weight: 100, priority: 2 },
        { userId: "dee", isFixed: false, weight: 100, priority: 2 },
      ],
      roundRobinWindowDays: 30,
    });
    expect(await code(createBooking(db, { ...(await teamInput()), booker: booker(2) }))).toBe("SLOT_UNAVAILABLE");
  });

  it("is only honoured for the host it was saved for: a type whose single host changed books by the usual rules", async () => {
    const team = await createTeamEventType(db, "ada", teamId, "round_robin", form({ slug: "cy-intro" }));
    await setHosts(db, "ada", teamId, team, { hosts: [{ userId: "cy", isFixed: true, weight: 100, priority: 2 }], roundRobinWindowDays: 30 });
    const offer = (await saveOffer(db, "bob", { eventTypeId: team, title: "", guests: [], manualSlots: [slot(MON("06:00"))] }, NOW)) as { offerId: string };
    expect((await getOfferForEventType(db, offer.offerId, team))?.manualHostId).toBe("cy");
    // Cy is replaced by Dee: nobody vouched for Dee's 06:00, so it is outside working hours again.
    await setHosts(db, "ada", teamId, team, { hosts: [{ userId: "dee", isFixed: true, weight: 100, priority: 2 }], roundRobinWindowDays: 30 });
    const t = (await resolveBookingTarget(db, { team: "acme", slug: "cy-intro" }))!;
    const input = { host: t.host, hosts: t.hosts, hostsLabel: t.displayName, eventType: t.eventType, start: MON("06:00"), durationMin: 30, booker: booker(1), guests: [], now: NOW, offer: offer.offerId };
    expect(await code(createBooking(db, input))).toBe("SLOT_UNAVAILABLE");
    expect(await db.select().from(booking)).toHaveLength(0);
  });
});

describe("public slots with an offer", () => {
  it("adds the offer's matching times added by hand, de-duplicated and only with the offer", async () => {
    const { id, target } = await personal();
    // 10:00 is also a normal slot; 06:00 isn't; 19:00 is 60 minutes; Tuesday is outside the window.
    const offer = await offerWith(id, [slot(MON("06:00")), slot(MON("10:00")), slot(MON("19:00"), 60), slot(MON("06:00") + 24 * 60 * MIN)]);
    const loaded = (await getOfferForEventType(db, offer, id))!;
    const window = { start: MON("00:00"), end: MON("23:59") };
    const request = { host: target.host, eventType: target.eventType, durationMin: 30, window, now: NOW };
    const normal = await getAvailableSlots(db, request);
    const manual = await getManualOfferSlots(db, { ...request, manualSlots: loaded.manualSlots });
    expect(manual.map((s) => iso(s.start))).toEqual([iso(MON("06:00")), iso(MON("10:00"))]);
    const merged = withManualSlots(normal, manual);
    expect(merged.filter((s) => s.start === MON("10:00"))).toHaveLength(1);
    expect(merged.map((s) => s.start)).toEqual([MON("06:00"), ...normal.map((s) => s.start)]);
    expect(merged[0]).toEqual({ start: MON("06:00"), end: MON("06:30") });
    expect(withManualSlots(normal, [])).toEqual(normal);
    // A booking made here hides it; a past one is never listed.
    await createBooking(db, { ...request, start: MON("06:00"), durationMin: 30, booker: booker(1), guests: [], offer });
    expect(await getManualOfferSlots(db, { ...request, manualSlots: loaded.manualSlots })).toEqual([{ start: MON("10:00"), end: MON("10:30") }]);
    expect(await getManualOfferSlots(db, { ...request, now: MON("12:00"), manualSlots: loaded.manualSlots })).toEqual([]);
  });

  it("serves them from the slot route only with the offer; without it the response is unchanged", async () => {
    const { POST } = await import("@/app/api/public/slots/route");
    const { id } = await personal();
    // Real clock here: the route uses Date.now(). 02:00 UTC two days out is outside working hours.
    const day = 24 * 60 * MIN;
    const start = Math.floor(Date.now() / day) * day + 2 * day + 2 * 60 * MIN;
    const result = await saveOffer(db, "ada", { eventTypeId: id, title: "", guests: [], manualSlots: [slot(start)] });
    const offer = (result as { offerId: string }).offerId;
    const ask = async (extra: Record<string, unknown>) => {
      const body = { username: "ada", slug: "intro", duration: 30, start: start - 12 * 60 * MIN, end: start + 12 * 60 * MIN, ...extra };
      const res = await POST(new Request("http://localhost:3000/api/public/slots", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
      expect(res.status).toBe(200);
      return res.text();
    };
    const plain = await ask({});
    const withOffer = JSON.parse(await ask({ offer })) as { slots: { start: number; end: number }[] };
    expect(withOffer.slots).toContainEqual({ start, end: start + 30 * MIN });
    expect(JSON.stringify({ slots: withOffer.slots.filter((s) => s.start !== start) })).toBe(plain);
    expect(JSON.parse(plain).slots.some((s: { start: number }) => s.start === start)).toBe(false);
    // An unknown offer or another duration adds nothing.
    expect(await ask({ offer: "unknown-offer" })).toBe(plain);
    expect(JSON.parse(await ask({ offer, duration: 60 })).slots.some((s: { start: number }) => s.start === start)).toBe(false);
  });
});

describe("conflict notes on /schedule", () => {
  let n = 0;
  async function calendarOf(userId: string, name: string, patch: { isPrimary?: boolean; checkConflicts?: boolean } = {}) {
    const credId = `cred-${userId}`;
    await db.insert(credential).values({ id: credId, userId, provider: "google", label: `${userId}@example.com`, encryptedPayload: "x" }).onConflictDoNothing();
    const id = `cal-${++n}`;
    await db.insert(connectedCalendar).values({ id, credentialId: credId, userId, externalId: id, name, isPrimary: patch.isPrimary ?? false, checkConflicts: patch.checkConflicts ?? false });
    return id;
  }
  const typesOf = async (viewer: string) => (await loadSetup(db, { id: viewer, name: viewer, username: viewer })).principals.flatMap((p) => p.types);

  it("is omitted when only the primary calendar is checked", async () => {
    await createEventType(db, "ada", form({ slug: "intro" }));
    await calendarOf("ada", "Ada", { isPrimary: true, checkConflicts: true });
    await calendarOf("ada", "Holidays");
    const [type] = await typesOf("ada");
    expect(type.conflictNote).toBeUndefined();
  });

  it("names extra checked calendars, and a per-type list that leaves out the primary, for the host", async () => {
    const intro = await createEventType(db, "ada", form({ slug: "intro" }));
    const other = await createEventType(db, "ada", form({ slug: "other" }));
    await calendarOf("ada", "Ada", { isPrimary: true, checkConflicts: true });
    const sam = await calendarOf("ada", "Sam", { checkConflicts: true });
    const lee = await calendarOf("ada", "Lee");
    await db.insert(eventTypeConflictCalendar).values([
      { eventTypeId: other, connectedCalendarId: sam },
      { eventTypeId: other, connectedCalendarId: lee },
    ]);
    const types = await typesOf("ada");
    expect(types.find((t) => t.id === intro)?.conflictNote).toEqual({ primaryIgnored: false, otherCalendars: ["Sam"], otherCount: 1 });
    expect(types.find((t) => t.id === other)?.conflictNote).toEqual({ primaryIgnored: true, otherCalendars: ["Lee", "Sam"], otherCount: 2 });
  });

  it("gives a count but no calendar names for another host", async () => {
    const team = await createTeamEventType(db, "ada", teamId, "round_robin", form({ slug: "cy-intro" }));
    await setHosts(db, "ada", teamId, team, { hosts: [{ userId: "cy", isFixed: true, weight: 100, priority: 2 }], roundRobinWindowDays: 30 });
    await calendarOf("cy", "Cy", { isPrimary: true });
    const secret = await calendarOf("cy", "Secret board calendar", { checkConflicts: true });
    await db.insert(eventTypeConflictCalendar).values({ eventTypeId: team, connectedCalendarId: secret });
    const setup = await loadSetup(db, { id: "bob", name: "Bob", username: "bob" });
    const type = setup.principals.flatMap((p) => p.types).find((t) => t.id === team);
    expect(type?.conflictNote).toEqual({ primaryIgnored: true, otherCalendars: [], otherCount: 1 });
    expect(JSON.stringify(setup.principals)).not.toContain("Secret board calendar");
    // Cy sees the name of their own calendar.
    expect((await typesOf("cy")).find((t) => t.id === team)?.conflictNote?.otherCalendars).toEqual(["Secret board calendar"]);
  });
});
