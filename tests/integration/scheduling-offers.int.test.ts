import { asc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { attendee, booking, eventType, schedulingOffer } from "@/db/schema";
import { createBooking, listHostBookings } from "@/features/bookings/server/service";
import { resolveBookingTarget } from "@/features/bookings/server/targets";
import { createEventType } from "@/features/event-types/server/service";
import { getOfferForEventType, offerContacts, saveOffer } from "@/features/offers/server/service";
import { createTeamEventType, setHosts } from "@/features/teams/server/event-types";
import { testDatabase } from "./helpers";
import { booker, code, form, MON, NOW, world } from "./team-fixtures";

const { db, close } = testDatabase();
afterAll(close);

/**
 * Scheduling offers: an assistant saves a custom title and preset attendees for a host's event
 * type; bookings made from the offer's links get both, and the client can't change or drop them.
 */

let teamId: string;
beforeEach(async () => {
  teamId = await world(db); // ada (owner), bob (admin), cy, dee; eve is outside the team
});

/** A team event type hosted by Cy alone (the /schedule case), and Ada's personal "intro". */
async function types(patch: Record<string, unknown> = {}) {
  const team = await createTeamEventType(db, "ada", teamId, "round_robin", form({ slug: "cy-intro", ...patch }));
  await setHosts(db, "ada", teamId, team, { hosts: [{ userId: "cy", isFixed: true, weight: 100, priority: 2 }], roundRobinWindowDays: 30 });
  const personal = await createEventType(db, "ada", form({ slug: "intro", ...patch }));
  return { team, personal };
}

const guestsOf = async (bookingId: string) =>
  (await db.select().from(attendee).where(eq(attendee.bookingId, bookingId)).orderBy(asc(attendee.createdAt))).filter((a) => a.isGuest).map((a) => a.email);

const offerId = async (userId: string, eventTypeId: string, title: string, guests: string[]) => {
  const result = await saveOffer(db, userId, { eventTypeId, title, guests });
  if (!result.ok || !result.offerId) throw new Error(`offer not saved: ${JSON.stringify(result)}`);
  return result.offerId;
};

describe("saving an offer", () => {
  it("lets the owner of a personal event type and any member of the owning team save one", async () => {
    const { team, personal } = await types();
    expect((await saveOffer(db, "ada", { eventTypeId: personal, title: "Review", guests: [] })).ok).toBe(true);
    for (const member of ["ada", "bob", "cy", "dee"]) expect((await saveOffer(db, member, { eventTypeId: team, title: "Review", guests: [] })).ok).toBe(true);
  });

  it("refuses everyone else the same way as a missing event type", async () => {
    const { team, personal } = await types();
    const denied = { ok: false, message: "This event type isn't available." };
    expect(await saveOffer(db, "bob", { eventTypeId: personal, title: "Review", guests: [] })).toEqual(denied);
    expect(await saveOffer(db, "eve", { eventTypeId: team, title: "Review", guests: [] })).toEqual(denied);
    expect(await saveOffer(db, "ada", { eventTypeId: "nope", title: "Review", guests: [] })).toEqual(denied);
    expect(await db.select().from(schedulingOffer)).toHaveLength(0);
  });

  it("returns the same id for the same content and a long random id", async () => {
    const { team } = await types();
    const first = await offerId("bob", team, "  Quarterly   review ", ["CFO@acme.com", "exec@acme.com"]);
    const again = await offerId("bob", team, "Quarterly review", ["exec@acme.com", "cfo@acme.com", "exec@acme.com"]);
    expect(again).toBe(first);
    expect(first).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(await offerId("bob", team, "Quarterly review 2", ["exec@acme.com"])).not.toBe(first);
    expect(await db.select().from(schedulingOffer)).toHaveLength(2);
    expect(await getOfferForEventType(db, first, team)).toEqual({ id: first, title: "Quarterly review", guests: ["cfo@acme.com", "exec@acme.com"], manualSlots: [], manualHostId: null });
  });

  it("returns no offer when there is neither a title nor an attendee", async () => {
    const { team } = await types();
    expect(await saveOffer(db, "bob", { eventTypeId: team, title: "  ", guests: [" "] })).toEqual({ ok: true, offerId: null });
  });

  it("validates the title and attendees, and drops the host's own email", async () => {
    const { team } = await types();
    const long = await saveOffer(db, "bob", { eventTypeId: team, title: "x".repeat(151), guests: [] });
    expect(long).toMatchObject({ ok: false, fieldErrors: { title: expect.any(String) } });
    const bad = await saveOffer(db, "bob", { eventTypeId: team, title: "", guests: ["nope"] });
    expect(bad).toMatchObject({ ok: false, fieldErrors: { guests: expect.any(String) } });
    const many = await saveOffer(db, "bob", { eventTypeId: team, title: "", guests: Array.from({ length: 11 }, (_, i) => `g${i}@x.com`) });
    expect(many).toMatchObject({ ok: false, fieldErrors: { guests: expect.any(String) } });
    const id = await offerId("bob", team, "", ["cy@example.com", "dee@example.com"]);
    expect((await getOfferForEventType(db, id, team))?.guests).toEqual(["dee@example.com"]);
  });

  it("refuses a title and preset attendees on a seated event type", async () => {
    const seated = await createEventType(db, "ada", form({ slug: "webinar", seatsPerSlot: 5 }));
    expect(await saveOffer(db, "ada", { eventTypeId: seated, title: "", guests: ["x@acme.com"] })).toMatchObject({ ok: false, fieldErrors: { guests: expect.any(String) } });
    expect(await saveOffer(db, "ada", { eventTypeId: seated, title: "Webinar", guests: [] })).toMatchObject({ ok: false, fieldErrors: { title: expect.any(String) } });
    expect(await db.select().from(schedulingOffer)).toHaveLength(0);
  });

  it("only finds an offer for its own event type", async () => {
    const { team, personal } = await types();
    const id = await offerId("ada", personal, "Review", []);
    expect(await getOfferForEventType(db, id, team)).toBeNull();
    expect(await getOfferForEventType(db, "unknown", personal)).toBeNull();
  });
});

describe("offer contacts", () => {
  it("lists the team's members except the host, and nobody for personal types or outsiders", async () => {
    const { team, personal } = await types();
    const contacts = await offerContacts(db, "bob", team);
    // Cy hosts the meeting, so Cy is already in it and is not offered as someone to invite.
    expect(contacts.map((c) => c.email).toSorted()).toEqual(["ada@example.com", "bob@example.com", "dee@example.com"]);
    expect(contacts.every((c) => c.name.length > 0)).toBe(true);
    expect(await offerContacts(db, "ada", personal)).toEqual([]);
    expect(await offerContacts(db, "eve", team)).toEqual([]);
  });
});

describe("booking from an offer", () => {
  async function teamTarget() {
    const target = (await resolveBookingTarget(db, { team: "acme", slug: "cy-intro" }))!;
    return {
      host: target.host,
      hosts: target.hosts,
      hostsLabel: target.displayName,
      eventType: target.eventType,
      start: MON("10:00"),
      durationMin: 30,
      booker: booker(1),
      guests: [] as string[],
      now: NOW,
    };
  }

  it("uses the offer's title and invites its attendees with the booker's own guests", async () => {
    const { team } = await types({ maxGuests: 1 });
    const id = await offerId("bob", team, "Quarterly review with Acme", ["exec@acme.com", "cfo@acme.com"]);
    const input = await teamTarget();
    const created = await createBooking(db, { ...input, guests: ["typed@x.com"], offer: id });
    expect(created.booking).toMatchObject({ title: "Quarterly review with Acme", offerId: id });
    // Offer attendees don't count toward maxGuests (1); the booker's own guest does.
    expect(await guestsOf(created.booking.id)).toEqual(["cfo@acme.com", "exec@acme.com", "typed@x.com"]);
    expect(await code(createBooking(db, { ...input, start: MON("11:00"), booker: booker(2), guests: ["a@x.com", "b@x.com"], offer: id }))).toBe("TOO_MANY_GUESTS");
  });

  it("never invites the booker or a host twice", async () => {
    const { team } = await types();
    const id = await offerId("bob", team, "", ["b1@example.com", "exec@acme.com"]);
    const input = await teamTarget();
    const created = await createBooking(db, { ...input, guests: ["cy@example.com", "exec@acme.com"], offer: id });
    expect(await guestsOf(created.booking.id)).toEqual(["exec@acme.com"]);
    // No title in the offer: the usual title.
    expect(created.booking.title).not.toBe("");
    expect(created.booking.offerId).toBe(id);
  });

  it("fails closed for an unknown offer or one saved for another event type", async () => {
    const { personal } = await types();
    const other = await offerId("ada", personal, "Personal review", ["x@acme.com"]);
    const input = await teamTarget();
    expect(await code(createBooking(db, { ...input, offer: "unknown-offer-id" }))).toBe("OFFER_INVALID");
    expect(await code(createBooking(db, { ...input, offer: other }))).toBe("OFFER_INVALID");
    expect(await db.select().from(booking)).toHaveLength(0);
  });

  it("fails closed when the event type became seated after the offer was saved, title only included", async () => {
    const { team } = await types();
    const titleOnly = await offerId("bob", team, "Review", []);
    const id = await offerId("bob", team, "Review", ["exec@acme.com"]);
    await db.update(eventType).set({ seatsPerSlot: 3 }).where(eq(eventType.id, team));
    expect(await code(createBooking(db, { ...(await teamTarget()), offer: titleOnly }))).toBe("OFFER_INVALID");
    await db.update(eventType).set({ seatsPerSlot: null }).where(eq(eventType.id, team));
    await db.update(eventType).set({ seatsPerSlot: 3 }).where(eq(eventType.id, team));
    expect(await code(createBooking(db, { ...(await teamTarget()), offer: id }))).toBe("OFFER_INVALID");
  });

  it("keeps the offer on reschedule without the client sending it again", async () => {
    const { team } = await types();
    const id = await offerId("bob", team, "Quarterly review", ["exec@acme.com"]);
    const other = await offerId("bob", team, "Something else", ["intruder@x.com"]);
    const input = await teamTarget();
    const first = await createBooking(db, { ...input, guests: ["typed@x.com"], offer: id });
    const moved = await createBooking(db, { ...input, start: MON("11:00"), reschedule: { uid: first.booking.uid, token: first.token } });
    expect(moved.booking).toMatchObject({ title: "Quarterly review", offerId: id, rescheduledFromId: first.booking.id });
    expect(await guestsOf(moved.booking.id)).toEqual(["exec@acme.com", "typed@x.com"]);
    // A different offer sent with a reschedule is ignored: the original booking's offer stays.
    const again = await createBooking(db, { ...input, start: MON("12:00"), offer: other, reschedule: { uid: moved.booking.uid, token: moved.token } });
    expect(again.booking).toMatchObject({ title: "Quarterly review", offerId: id });
    expect(await guestsOf(again.booking.id)).toEqual(["exec@acme.com", "typed@x.com"]);
  });

  it("puts the offer on every occurrence of a recurring booking", async () => {
    await createEventType(db, "ada", form({ slug: "weekly", recurringFrequency: "weekly", recurringMaxCount: 4 }));
    const target = (await resolveBookingTarget(db, { username: "ada", slug: "weekly" }))!;
    const id = await offerId("ada", target.eventType.id, "Weekly sync", ["exec@acme.com"]);
    const created = await createBooking(db, {
      host: target.host,
      eventType: target.eventType,
      start: MON("10:00"),
      durationMin: 30,
      booker: booker(1),
      guests: [],
      now: NOW,
      recurringCount: 3,
      offer: id,
    });
    expect(created.series).toHaveLength(3);
    for (const row of created.series!) {
      expect(row).toMatchObject({ title: "Weekly sync", offerId: id });
      expect(await guestsOf(row.id)).toEqual(["exec@acme.com"]);
    }
  });

  it("shows the custom title in the host's bookings list", async () => {
    const { team } = await types();
    const titled = await offerId("bob", team, "Quarterly review", []);
    const untitled = await offerId("bob", team, "", ["exec@acme.com"]);
    const input = await teamTarget();
    await createBooking(db, { ...input, offer: titled });
    await createBooking(db, { ...input, start: MON("11:00"), booker: booker(2), offer: untitled });
    await createBooking(db, { ...input, start: MON("12:00"), booker: booker(3) });
    const list = await listHostBookings(db, "cy", { tab: "upcoming", now: NOW });
    expect(list.map((b) => b.customTitle)).toEqual(["Quarterly review", null, null]);
  });
});
