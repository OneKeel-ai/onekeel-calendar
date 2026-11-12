import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getPool } from "@/db/client";
import { booking, calendarGuard, membership, profileSettings, schedulingOffer, teamInvitation } from "@/db/schema";
import { cancelByHost, createBooking, holdSlot, listHostBookings } from "@/features/bookings/server/service";
import { invalidatePublicContext } from "@/features/bookings/server/public-context";
import { resolveBookingTarget } from "@/features/bookings/server/targets";
import { createEventType, listPublicEventTypes } from "@/features/event-types/server/service";
import { getOfferForEventType, offerContentHash, saveOffer } from "@/features/offers/server/service";
import { adminRemoveGuard, adminSaveGuard, bookingNeedsOffer, listGuardViews, removeOwnGuard, saveOwnGuard } from "@/features/privacy/server/guard";
import { loadSetup } from "@/features/setup/server/load";
import { teamAvailability } from "@/features/teams/server/availability";
import { emitWebhooks } from "@/features/webhooks/server/emit";
import { createTeamWebhook } from "@/features/webhooks/server/team-service";
import { createCipher } from "@/lib/crypto/encryption";
import { createTeamEventType, listPublicTeamEventTypes, setHosts } from "@/features/teams/server/event-types";
import { acceptInvitation, createTeam, inviteMember } from "@/features/teams/server/service";
import { resetEnvCache } from "@/lib/env";
import { testDatabase } from "./helpers";
import { booker, code, form, MON, NOW, world } from "./team-fixtures";

/** Who is "signed in" for the public slots route (null = an anonymous client). */
const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/auth/session", () => ({ getSession: async () => (session.userId ? { user: { id: session.userId } } : null) }));

const { db, url, close } = testDatabase();
const saved = { ...process.env };

beforeAll(() => {
  // The public slot route reads the app's own database and settings from the env.
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
 * Private calendars: only the person and their delegates may see their free/busy time, schedule
 * for them, or see and manage their meetings. World: ada (owner), bob (admin), cy, dee (members)
 * of "acme"; eve is outside. Emails are `<id>@example.com`.
 */

let teamId: string;
beforeEach(async () => {
  teamId = await world(db);
  await db.execute(sql`TRUNCATE "calendar_guard"`);
  session.userId = null;
  invalidatePublicContext();
});

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const iso = (ms: number) => new Date(ms).toISOString();
const me = (id: string) => ({ id, email: `${id}@example.com` });
const invitee = (id: string) => ({ id, email: `${id}@example.com`, emailVerified: true });
/** Puts a guard row in directly, as old data or an earlier save would have. */
const guard = (id: string, delegates: string[] = []) =>
  db.insert(calendarGuard).values({ email: `${id}@example.com`, delegates: delegates.map((d) => `${d}@example.com`) });

async function invite(actor: string, team: string, who: string) {
  return inviteMember(db, actor, team, { email: `${who}@example.com`, role: "member" }, NOW);
}

describe("saving a guard", () => {
  it("lets the person turn it on, change it and remove it, lower-cased and de-duplicated", async () => {
    expect(await saveOwnGuard(db, me("eve"), { delegates: [" ADA@Example.com ", "ada@example.com", ""], calendarAddresses: ["Board@Group.Calendar.Google.com"] })).toEqual({ ok: true });
    const [row] = await db.select().from(calendarGuard);
    expect(row).toMatchObject({ email: "eve@example.com", delegates: ["ada@example.com"], calendarAddresses: ["board@group.calendar.google.com"], createdBy: "eve" });
    expect(await saveOwnGuard(db, me("eve"), { delegates: ["eve@example.com"], calendarAddresses: [] })).toMatchObject({ ok: false, fieldErrors: { delegates: expect.any(String) } });
    expect(await saveOwnGuard(db, me("eve"), { delegates: Array.from({ length: 11 }, (_, i) => `p${i}@x.com`), calendarAddresses: [] })).toMatchObject({ ok: false, fieldErrors: { delegates: expect.any(String) } });
    expect(await saveOwnGuard(db, me("eve"), { delegates: ["not an email"], calendarAddresses: [] })).toMatchObject({ ok: false, fieldErrors: { delegates: expect.any(String) } });
    expect(await removeOwnGuard(db, me("eve"))).toEqual({ ok: true });
    expect(await db.select().from(calendarGuard)).toHaveLength(0);
  });

  it("is refused with blockers while the person shares a team with someone not on the list", async () => {
    const result = await saveOwnGuard(db, me("cy"), { delegates: ["bob@example.com"], calendarAddresses: [] });
    expect(result).toEqual({ ok: false, message: expect.any(String), blockers: [{ team: "Acme", people: ["Ada", "Dee"] }] });
    expect(await db.select().from(calendarGuard)).toHaveLength(0);
    // Everyone in the team on the list: allowed.
    expect(await saveOwnGuard(db, me("cy"), { delegates: ["ada@example.com", "bob@example.com", "dee@example.com"], calendarAddresses: [] })).toEqual({ ok: true });
  });

  it("lets the instance admin set, change or remove a guard only while no account exists", async () => {
    expect(await adminSaveGuard(db, "ada", { email: "Tre@Example.com", delegates: ["chelsea@example.com"], calendarAddresses: [] })).toEqual({ ok: true });
    expect(await adminSaveGuard(db, "ada", { email: "tre@example.com", delegates: ["chelsea@example.com", "x@example.com"], calendarAddresses: [] })).toEqual({ ok: true });
    expect(await listGuardViews(db)).toEqual([
      { email: "tre@example.com", delegates: ["chelsea@example.com", "x@example.com"], calendarAddresses: [], hasAccount: false, updatedAt: expect.any(String) },
    ]);
    // An account exists (case differs): only the person themself may change it now.
    await db.execute(sql`INSERT INTO "user" (id, name, email, email_verified) VALUES ('tre', 'Tré', 'TRE@example.com', true)`);
    expect(await adminSaveGuard(db, "ada", { email: "tre@example.com", delegates: [], calendarAddresses: [] })).toMatchObject({ ok: false, message: expect.stringContaining("Only they") });
    expect(await adminRemoveGuard(db, { email: "tre@example.com" })).toMatchObject({ ok: false });
    expect(await adminSaveGuard(db, "ada", { email: "eve@example.com", delegates: [], calendarAddresses: [] })).toMatchObject({ ok: false });
    expect((await listGuardViews(db))[0]).toMatchObject({ delegates: ["chelsea@example.com", "x@example.com"], hasAccount: true });
    expect(await saveOwnGuard(db, { id: "tre", email: "TRE@example.com" }, { delegates: ["chelsea@example.com"], calendarAddresses: [] })).toEqual({ ok: true });
    expect((await listGuardViews(db))[0].delegates).toEqual(["chelsea@example.com"]);
  });
});

describe("teams keep private people apart", () => {
  it("(a) refuses inviting a private person into a team with people not on their list", async () => {
    await guard("eve", ["ada"]);
    expect(await code(invite("ada", teamId, "eve"))).toBe("PRIVATE_CALENDAR:invitee");
    const exec = await createTeam(db, "ada", { name: "Exec", slug: "exec", logoUrl: null, brandColor: null });
    const { invitationId } = await invite("ada", exec, "eve");
    expect(await code(acceptInvitation(db, invitee("eve"), invitationId, NOW))).toBe("OK");
  });

  it("(b) refuses inviting someone not allowed into a team with a private person; a delegate may join", async () => {
    const exec = await createTeam(db, "ada", { name: "Exec", slug: "exec", logoUrl: null, brandColor: null });
    await acceptInvitation(db, invitee("eve"), (await invite("ada", exec, "eve")).invitationId, NOW);
    await saveOwnGuard(db, me("eve"), { delegates: ["ada@example.com", "bob@example.com"], calendarAddresses: [] });
    expect(await code(invite("ada", exec, "dee"))).toBe("PRIVATE_CALENDAR:member");
    const bob = await invite("ada", exec, "bob");
    expect(await code(acceptInvitation(db, invitee("bob"), bob.invitationId, NOW))).toBe("OK");
  });

  it("counts pending invitations at invite time", async () => {
    const exec = await createTeam(db, "ada", { name: "Exec", slug: "exec", logoUrl: null, brandColor: null });
    await invite("ada", exec, "dee");
    await guard("eve", ["ada"]);
    expect(await code(invite("ada", exec, "eve"))).toBe("PRIVATE_CALENDAR:invitee");
  });

  it("re-checks at accept: both ways, whatever changed since the invitation", async () => {
    const exec = await createTeam(db, "ada", { name: "Exec", slug: "exec", logoUrl: null, brandColor: null });
    const forEve = await invite("ada", exec, "eve");
    const forDee = await invite("ada", exec, "dee");
    await acceptInvitation(db, invitee("dee"), forDee.invitationId, NOW);
    await saveOwnGuard(db, me("eve"), { delegates: ["ada@example.com"], calendarAddresses: [] }); // eve isn't in the team yet
    expect(await code(acceptInvitation(db, invitee("eve"), forEve.invitationId, NOW))).toBe("PRIVATE_CALENDAR:invitee");

    const board = await createTeam(db, "ada", { name: "Board", slug: "board", logoUrl: null, brandColor: null });
    const eveToBoard = await invite("ada", board, "eve");
    const cyToBoard = await db
      .insert(teamInvitation)
      .values({ id: "inv-cy", teamId: board, email: "cy@example.com", role: "member", invitedBy: "ada", expiresAt: new Date(NOW + DAY) })
      .returning();
    await acceptInvitation(db, invitee("eve"), eveToBoard.invitationId, NOW);
    expect(await code(acceptInvitation(db, invitee("cy"), cyToBoard[0].id, NOW))).toBe("PRIVATE_CALENDAR:member");
    expect(await db.select().from(membership).where(eq(membership.teamId, board))).toHaveLength(2);
  });
});

/** Cy hosts a round-robin type of acme; old data: cy went private (delegate bob) while still in acme. */
async function privateCyInAcme() {
  const type = await createTeamEventType(db, "ada", teamId, "round_robin", form({ slug: "cy-intro" }));
  await setHosts(db, "ada", teamId, type, { hosts: [{ userId: "cy", isFixed: true, weight: 100, priority: 2 }], roundRobinWindowDays: 30 });
  const target = (await resolveBookingTarget(db, { team: "acme", slug: "cy-intro" }))!;
  const made = await createBooking(db, { host: target.host, hosts: target.hosts, eventType: target.eventType, start: MON("10:00"), durationMin: 30, booker: booker(1), guests: [], now: NOW });
  await guard("cy", ["bob"]);
  return { type, target, bookingId: made.booking.id };
}

describe("defense in depth when old data breaks the invariant", () => {
  it("a team owner not allowed for the host can't see or cancel the booking; an allowed admin can", async () => {
    const { bookingId } = await privateCyInAcme();
    const upcoming = { tab: "upcoming" as const, now: NOW };
    expect(await listHostBookings(db, "ada", upcoming)).toHaveLength(0);
    expect((await listHostBookings(db, "bob", upcoming)).map((b) => b.id)).toEqual([bookingId]);
    expect((await listHostBookings(db, "cy", upcoming)).map((b) => b.id)).toEqual([bookingId]);
    expect(await code(cancelByHost(db, { hostId: "ada", bookingId, now: NOW }))).toBe("NOT_FOUND");
    expect(await code(cancelByHost(db, { hostId: "bob", bookingId, now: NOW }))).toBe("OK");
  });

  it("team availability leaves the private person out for a viewer not allowed", async () => {
    await privateCyInAcme();
    const window = { start: MON("00:00"), end: MON("00:00") + DAY };
    expect((await teamAvailability(db, "dee", teamId, window)).map((m) => m.userId).toSorted()).toEqual(["ada", "bob", "dee"]);
    expect((await teamAvailability(db, "bob", teamId, window)).map((m) => m.userId)).toContain("cy");
  });

  it("the /schedule loader leaves the host out for a viewer not allowed, and says who may schedule otherwise", async () => {
    const { type } = await privateCyInAcme();
    const types = async (viewer: string) => (await loadSetup(db, { id: viewer, name: viewer, username: viewer })).principals.flatMap((p) => p.types);
    expect((await types("dee")).some((t) => t.id === type)).toBe(false);
    expect((await types("bob")).find((t) => t.id === type)?.privateHost).toEqual({ allowed: ["Cy", "Bob"] });
    expect((await types("cy")).find((t) => t.id === type)?.privateHost).toEqual({ allowed: ["Cy", "Bob"] });
  });

  it("saving an offer is refused for a saver not allowed; an allowed one always gets an id", async () => {
    const { type } = await privateCyInAcme();
    expect(await saveOffer(db, "dee", { eventTypeId: type, title: "", guests: [] }, NOW)).toEqual({ ok: false, message: "This event type isn't available." });
    const blank = await saveOffer(db, "bob", { eventTypeId: type, title: "", guests: [] }, NOW);
    expect(blank).toMatchObject({ ok: true, offerId: expect.any(String) });
    expect(await saveOffer(db, "bob", { eventTypeId: type, title: "", guests: [] }, NOW)).toEqual(blank);
  });

  it("team webhooks only get the meeting when the person who set them up is allowed", async () => {
    const { bookingId } = await privateCyInAcme();
    const cipher = createCipher({ current: Buffer.alloc(32, 7).toString("base64") });
    // Ada (owner, not allowed for Cy) and Bob (admin, Cy's delegate) each set up a team webhook.
    const adas = await createTeamWebhook(db, cipher, "ada", teamId, { url: "https://hooks.example.com/ada", triggers: ["BOOKING_CREATED"] });
    const bobs = await createTeamWebhook(db, cipher, "bob", teamId, { url: "https://hooks.example.com/bob", triggers: ["BOOKING_CREATED"] });
    const sent: string[] = [];
    const enqueue = async (id: string) => void sent.push(id);
    expect(await emitWebhooks({ db, enqueue }, { trigger: "BOOKING_CREATED", bookingId })).toBe(1);
    const rows = await db.execute(sql`SELECT webhook_id FROM webhook_delivery`);
    expect(rows.rows.map((r) => r.webhook_id)).toEqual([bobs.id]);
    expect(rows.rows.map((r) => r.webhook_id)).not.toContain(adas.id);
    // Without the guard both would fire.
    await db.execute(sql`TRUNCATE "calendar_guard"`);
    await db.execute(sql`TRUNCATE "webhook_delivery"`);
    expect(await emitWebhooks({ db, enqueue }, { trigger: "BOOKING_CREATED", bookingId })).toBe(2);
  });

  it("an admin not allowed can't make the private person a host", async () => {
    await guard("cy", ["bob"]);
    const type = await createTeamEventType(db, "ada", teamId, "round_robin", form({ slug: "x" }));
    const hosts = { hosts: [{ userId: "cy", isFixed: true, weight: 100, priority: 2 }], roundRobinWindowDays: 30 };
    expect(await code(setHosts(db, "ada", teamId, type, hosts))).toBe("PRIVATE_CALENDAR:member");
    expect(await code(setHosts(db, "ada", teamId, type, { ...hosts, assignAll: true }))).toBe("PRIVATE_CALENDAR:member");
    expect(await code(setHosts(db, "bob", teamId, type, hosts))).toBe("OK");
  });
});

describe("by invitation only (public)", () => {
  it("leaves the types out of public listings and group links", async () => {
    await createEventType(db, "eve", form({ slug: "intro" }));
    await createEventType(db, "cy", form({ slug: "intro" }));
    await db.insert(profileSettings).values(["cy", "dee"].map((userId) => ({ userId, allowDynamicGroup: true })));
    expect(await resolveBookingTarget(db, { username: "cy+dee", slug: "intro" })).not.toBeNull();
    const { type } = await privateCyInAcme();
    await guard("eve");
    expect(await listPublicEventTypes(db, "eve")).toEqual([]);
    expect((await listPublicEventTypes(db, "cy")).map((t) => t.slug)).toEqual([]);
    expect((await listPublicTeamEventTypes(db, teamId)).some((t) => t.id === type)).toBe(false);
    expect(await resolveBookingTarget(db, { username: "cy+dee", slug: "intro" })).toBeNull();
    expect(await bookingNeedsOffer(db, type)).toBe(true);
  });

  it("refuses holds and bookings without a valid offer; works with one", async () => {
    const id = await createEventType(db, "eve", form({ slug: "intro" }));
    await guard("eve");
    const target = (await resolveBookingTarget(db, { username: "eve", slug: "intro" }))!;
    const base = { host: target.host, eventType: target.eventType, durationMin: 30, now: NOW, start: MON("10:00") };
    expect(await code(holdSlot(db, { ...base, token: "t".repeat(20) }))).toBe("OFFER_REQUIRED");
    expect(await code(holdSlot(db, { ...base, token: "t".repeat(20), offer: "made-up" }))).toBe("OFFER_INVALID");
    expect(await code(createBooking(db, { ...base, booker: booker(1), guests: [] }))).toBe("OFFER_REQUIRED");
    expect(await code(createBooking(db, { ...base, booker: booker(1), guests: [], offer: "made-up" }))).toBe("OFFER_INVALID");
    const result = await saveOffer(db, "eve", { eventTypeId: id, title: "", guests: [] }, NOW);
    const offer = (result as { offerId: string }).offerId;
    expect(offer).toEqual(expect.any(String));
    expect(await code(holdSlot(db, { ...base, token: "t".repeat(20), offer }))).toBe("OK");
    const made = await createBooking(db, { ...base, booker: booker(1), guests: [], offer, holdToken: "t".repeat(20) });
    expect(made.booking.offerId).toBe(offer);
    // The client moves it with the manage token; the booking's own offer applies.
    expect(await code(createBooking(db, { ...base, start: MON("11:00"), booker: booker(1), guests: [], reschedule: { uid: made.booking.uid, token: made.token } }))).toBe("OK");
  });

  it("the slot route answers invitation_only without an offer and lists times with one", async () => {
    const { POST } = await import("@/app/api/public/slots/route");
    const id = await createEventType(db, "eve", form({ slug: "intro" }));
    await guard("eve");
    const offer = ((await saveOffer(db, "eve", { eventTypeId: id, title: "", guests: [] })) as { offerId: string }).offerId;
    const start = Math.floor(Date.now() / DAY) * DAY + 2 * DAY;
    const ask = async (extra: Record<string, unknown>) => {
      const body = { username: "eve", slug: "intro", duration: 30, start, end: start + 7 * DAY, ...extra };
      const res = await POST(new Request("http://localhost:3000/api/public/slots", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
      expect(res.status).toBe(200);
      return (await res.json()) as { slots: unknown[]; unavailable?: string };
    };
    expect(await ask({})).toEqual({ slots: [], unavailable: "invitation_only", message: "This meeting is by invitation. Ask your contact for times." });
    expect(await ask({ offer: "made-up" })).toMatchObject({ slots: [], unavailable: "invitation_only" });
    expect((await ask({ offer })).slots.length).toBeGreaterThan(0);
  });

  it("shows free times without an offer only to the signed-in host or someone they named", async () => {
    const { POST } = await import("@/app/api/public/slots/route");
    const id = await createEventType(db, "eve", form({ slug: "intro" }));
    await guard("eve", ["bob"]);
    void id;
    const start = Math.floor(Date.now() / DAY) * DAY + 2 * DAY;
    const ask = async () => {
      const body = { username: "eve", slug: "intro", duration: 30, start, end: start + 7 * DAY };
      const res = await POST(new Request("http://localhost:3000/api/public/slots", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
      return (await res.json()) as { slots: unknown[]; unavailable?: string };
    };
    session.userId = "ada"; // signed in, but not named by Eve
    expect(await ask()).toMatchObject({ slots: [], unavailable: "invitation_only" });
    session.userId = "bob"; // named by Eve
    expect((await ask()).slots.length).toBeGreaterThan(0);
    session.userId = "eve";
    expect((await ask()).slots.length).toBeGreaterThan(0);
    session.userId = null;
    expect(await ask()).toMatchObject({ slots: [], unavailable: "invitation_only" });
  });

  it("a cancelled booking's link opens nothing, and a live booking without an offer can't be moved online", async () => {
    const { POST } = await import("@/app/api/public/slots/route");
    const id = await createEventType(db, "eve", form({ slug: "intro" }));
    const target = (await resolveBookingTarget(db, { username: "eve", slug: "intro" }))!;
    const start = Math.floor(Date.now() / DAY) * DAY + 2 * DAY;
    // Booked before the calendar went private, so the booking has no offer.
    const window = { username: "eve", slug: "intro", duration: 30, start, end: start + 7 * DAY };
    const post = async (body: Record<string, unknown>) => {
      const res = await POST(new Request("http://localhost:3000/api/public/slots", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
      return (await res.json()) as { slots: { start: number }[]; unavailable?: string };
    };
    const free = (await post(window)).slots;
    expect(free.length).toBeGreaterThan(1);
    const made = await createBooking(db, { host: target.host, eventType: target.eventType, start: free[0].start, durationMin: 30, booker: booker(1), guests: [], now: Date.now() });
    await guard("eve");
    void id;
    const withToken = { ...window, reschedule: made.booking.uid, token: made.token };
    // A live booking without an offer: its link no longer lists the host's free time.
    expect(await post(withToken)).toMatchObject({ slots: [], unavailable: "invitation_only" });
    expect(await code(createBooking(db, { host: target.host, eventType: target.eventType, start: free[1].start, durationMin: 30, booker: booker(1), guests: [], now: Date.now(), reschedule: { uid: made.booking.uid, token: made.token } }))).toBe("OFFER_REQUIRED");
    // Cancelled: the same link still opens nothing, with or without the guard.
    await db.update(booking).set({ status: "cancelled" }).where(eq(booking.id, made.booking.id));
    expect(await post(withToken)).toMatchObject({ slots: [], unavailable: "invitation_only" });
    await db.execute(sql`TRUNCATE "calendar_guard"`);
    const afterCancel = await post(withToken);
    // Not treated as a reschedule any more: the cancelled booking's own slot is not handed back as "free for you".
    expect(afterCancel.unavailable).toBeUndefined();
  });

  it("a link stops working when the person who made it is taken off the list, and an all-times link expires", async () => {
    const { type, target } = await privateCyInAcme(); // Cy is private, Bob is named
    const made = (await saveOffer(db, "bob", { eventTypeId: type, title: "Review", guests: [] }, NOW)) as { offerId: string };
    expect(await getOfferForEventType(db, made.offerId, type)).toMatchObject({ id: made.offerId, restricted: false });
    // Older than 30 days: an all-times link for a private host no longer works.
    await db.update(schedulingOffer).set({ createdAt: new Date(Date.now() - 31 * DAY) }).where(eq(schedulingOffer.id, made.offerId));
    expect(await getOfferForEventType(db, made.offerId, type)).toBeNull();
    await db.update(schedulingOffer).set({ createdAt: new Date() }).where(eq(schedulingOffer.id, made.offerId));
    expect(await getOfferForEventType(db, made.offerId, type)).not.toBeNull();
    // Cy takes Bob off the list: every link Bob made stops working at once.
    await db.update(calendarGuard).set({ delegates: [] }).where(eq(calendarGuard.email, "cy@example.com"));
    expect(await getOfferForEventType(db, made.offerId, type)).toBeNull();
    const base = { host: target.host, hosts: target.hosts, eventType: target.eventType, durationMin: 30, booker: booker(2), guests: [], now: NOW };
    expect(await code(createBooking(db, { ...base, start: MON("13:00"), offer: made.offerId }))).toBe("OFFER_INVALID");
  });
});

describe("only the times I sent (restricted offers)", () => {
  const slot = (start: number, duration = 30) => ({ start: iso(start), duration });

  async function personal(patch: Record<string, unknown> = {}) {
    const id = await createEventType(db, "ada", form({ slug: "intro", extraDurations: [60], ...patch }));
    const target = (await resolveBookingTarget(db, { username: "ada", slug: "intro" }))!;
    return { id, target };
  }

  it("validates the times: 1 to 10, like times added by hand, and every hand-added time on the card", async () => {
    const { id } = await personal();
    const save = (input: Partial<Parameters<typeof saveOffer>[2]>) => saveOffer(db, "ada", { eventTypeId: id, title: "", guests: [], onlyOffered: true, ...input }, NOW);
    expect(await save({ slots: [] })).toMatchObject({ ok: false, fieldErrors: { slots: expect.any(String) } });
    expect(await save({ slots: Array.from({ length: 11 }, (_, i) => slot(MON("10:00") + i * 30 * MIN)) })).toMatchObject({ ok: false, fieldErrors: { slots: expect.any(String) } });
    expect(await save({ slots: [slot(MON("10:07"))] })).toMatchObject({ ok: false, fieldErrors: { slots: expect.any(String) } });
    expect(await save({ slots: [slot(NOW - DAY)] })).toMatchObject({ ok: false, fieldErrors: { slots: expect.any(String) } });
    expect(await save({ slots: [slot(MON("10:00"), 45)] })).toMatchObject({ ok: false, fieldErrors: { slots: expect.any(String) } });
    expect(await save({ slots: [slot(MON("10:00")), slot(MON("10:00"))] })).toMatchObject({ ok: false, fieldErrors: { slots: expect.any(String) } });
    expect(await save({ slots: [slot(MON("10:00"))], manualSlots: [slot(MON("06:00"))] })).toMatchObject({ ok: false, fieldErrors: { slots: expect.any(String) } });
    const ok = await save({ slots: [slot(MON("11:00")), slot(MON("10:00"))] });
    expect(ok).toMatchObject({ ok: true, offerId: expect.any(String) });
    // Same times in another order: the same offer. Unrestricted with the same content: another one.
    expect(await save({ slots: [slot(MON("10:00")), slot(MON("11:00"))] })).toEqual(ok);
    expect(await saveOffer(db, "ada", { eventTypeId: id, title: "", guests: [], slots: [slot(MON("10:00"))] }, NOW)).toEqual({ ok: true, offerId: null });
    const view = await getOfferForEventType(db, (ok as { offerId: string }).offerId, id);
    expect(view).toMatchObject({ restricted: true, offeredSlots: [{ start: MON("10:00"), duration: 30 }, { start: MON("11:00"), duration: 30 }] });
  });

  it("refuses any other start or duration at hold and booking; reschedule only to the offer's other times", async () => {
    const { id, target } = await personal();
    const offer = ((await saveOffer(db, "ada", { eventTypeId: id, title: "", guests: [], onlyOffered: true, slots: [slot(MON("10:00")), slot(MON("11:00"))] }, NOW)) as { offerId: string }).offerId;
    const base = { host: target.host, eventType: target.eventType, durationMin: 30, now: NOW, offer };
    expect(await code(holdSlot(db, { ...base, start: MON("12:00"), token: "h".repeat(20) }))).toBe("SLOT_UNAVAILABLE");
    expect(await code(holdSlot(db, { ...base, start: MON("10:00"), durationMin: 60, token: "h".repeat(20) }))).toBe("SLOT_UNAVAILABLE");
    expect(await code(holdSlot(db, { ...base, start: MON("10:00"), token: "h".repeat(20) }))).toBe("OK");
    expect(await code(createBooking(db, { ...base, start: MON("12:00"), booker: booker(1), guests: [] }))).toBe("SLOT_UNAVAILABLE");
    const made = await createBooking(db, { ...base, start: MON("10:00"), booker: booker(1), guests: [], holdToken: "h".repeat(20) });
    const reschedule = { uid: made.booking.uid, token: made.token };
    // The URL's offer is ignored on reschedule; the booking's own (restricted) offer applies.
    expect(await code(createBooking(db, { ...base, offer: undefined, start: MON("12:00"), booker: booker(1), guests: [], reschedule }))).toBe("SLOT_UNAVAILABLE");
    expect(await code(createBooking(db, { ...base, offer: undefined, start: MON("11:00"), booker: booker(1), guests: [], reschedule }))).toBe("OK");
  });

  it("still applies normal availability to offered times not added by hand", async () => {
    const { id, target } = await personal();
    // 06:00 is outside working hours (09:00-17:00): offered but not available.
    const offer = ((await saveOffer(db, "ada", { eventTypeId: id, title: "", guests: [], onlyOffered: true, slots: [slot(MON("06:00"))] }, NOW)) as { offerId: string }).offerId;
    expect(await code(createBooking(db, { host: target.host, eventType: target.eventType, durationMin: 30, now: NOW, offer, start: MON("06:00"), booker: booker(1), guests: [] }))).toBe("SLOT_UNAVAILABLE");
  });

  it("refuses a recurring booking from a restricted offer", async () => {
    const id = await createEventType(db, "ada", form({ slug: "weekly", recurringFrequency: "weekly", recurringMaxCount: 4 }));
    const target = (await resolveBookingTarget(db, { username: "ada", slug: "weekly" }))!;
    const offer = ((await saveOffer(db, "ada", { eventTypeId: id, title: "", guests: [], onlyOffered: true, slots: [slot(MON("10:00"))] }, NOW)) as { offerId: string }).offerId;
    const input = { host: target.host, eventType: target.eventType, durationMin: 30, now: NOW, offer, start: MON("10:00"), booker: booker(1), guests: [] };
    expect(await code(createBooking(db, { ...input, recurringCount: 2 }))).toBe("INVALID_RECURRENCE");
    expect(await code(createBooking(db, input))).toBe("OK");
  });

  it("leaves offers saved before this change unrestricted, with their hash", async () => {
    const { id, target } = await personal();
    const old = await saveOffer(db, "ada", { eventTypeId: id, title: "Review", guests: [] }, NOW);
    const [row] = await db.select().from(schedulingOffer).where(eq(schedulingOffer.id, (old as { offerId: string }).offerId));
    expect(row).toMatchObject({ restricted: false, offeredSlots: [], contentHash: offerContentHash("Review", []) });
    const made = await createBooking(db, { host: target.host, eventType: target.eventType, durationMin: 30, now: NOW, offer: row.id, start: MON("12:00"), booker: booker(1), guests: [] });
    expect(made.booking.title).toBe("Review");
  });

  it("filters the slot route to the times on the card", async () => {
    const { POST } = await import("@/app/api/public/slots/route");
    const { id } = await personal();
    // Real clock: the next weekday at least two days out, 10:00 and 11:00 UTC (inside working hours).
    let day = Math.floor(Date.now() / DAY) * DAY + 2 * DAY;
    while ([0, 6].includes(new Date(day).getUTCDay())) day += DAY;
    const ten = day + 10 * 60 * MIN;
    const eleven = day + 11 * 60 * MIN;
    const offer = ((await saveOffer(db, "ada", { eventTypeId: id, title: "", guests: [], onlyOffered: true, slots: [slot(ten), slot(eleven)] })) as { offerId: string }).offerId;
    const ask = async (extra: Record<string, unknown>) => {
      const body = { username: "ada", slug: "intro", duration: 30, start: day, end: day + DAY, ...extra };
      const res = await POST(new Request("http://localhost:3000/api/public/slots", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
      return (await res.json()) as { slots: { start: number; end: number }[] };
    };
    expect((await ask({ offer })).slots).toEqual([
      { start: ten, end: ten + 30 * MIN },
      { start: eleven, end: eleven + 30 * MIN },
    ]);
    expect((await ask({ offer, duration: 60 })).slots).toEqual([]);
    expect((await ask({})).slots.length).toBeGreaterThan(2);
    expect(await db.select().from(booking)).toHaveLength(0);
  });
});
