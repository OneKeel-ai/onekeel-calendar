import { createHash } from "node:crypto";
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database, DbOrTx } from "@/db/client";
import { eventType, eventTypeDurationOption, eventTypeHost, schedulingOffer, user } from "@/db/schema";
import { roleIn } from "@/features/teams/server/access";
import { memberLabel } from "@/features/teams/server/availability";
import { membersOf } from "@/features/teams/server/service";
import { randomToken } from "@/lib/ids";

/**
 * Scheduling offers: the times an assistant emails on a host's behalf, plus a custom meeting
 * title and attendees that every booking made from those links gets. Saved by an authenticated
 * member, referenced from the links by an unguessable id, never editable by the client.
 */

export const MAX_OFFER_GUESTS = 10;
export const MAX_OFFER_TITLE = 150;
/** Longest booking title an offer may set (the offer itself caps titles at MAX_OFFER_TITLE). */
export const MAX_BOOKING_TITLE = 300;
/** Offer ids in links: url-safe, at most 64 characters. */
export const OFFER_ID = /^[A-Za-z0-9_-]+$/;

/** Times added by hand (see `schedulingOffer.manualSlots`) an offer may carry. */
export const MAX_OFFER_MANUAL_SLOTS = 10;
/** How far ahead a time added by hand may be. */
export const MAX_MANUAL_SLOT_DAYS = 365;
const DAY_MS = 86_400_000;
const STEP_MS = 5 * 60_000;

/** A time added by hand as stored and sent by the client: ISO 8601 UTC start, duration in minutes. */
export type ManualSlotInput = { start: string; duration: number };
/** A time added by hand as read back: start in epoch ms. */
export type ManualSlot = { start: number; duration: number };

/**
 * `manualHostId`: the single host the times added by hand were saved for. They only count for that
 * person, so a later change of host can't hand them to someone whose calendar nobody vouched for.
 */
export type OfferView = { id: string; title: string | null; guests: string[]; manualSlots: ManualSlot[]; manualHostId: string | null };

export type SaveOfferInput = { eventTypeId: string; title: string; guests: string[]; manualSlots?: ManualSlotInput[] };

export type SaveOfferResult =
  | { ok: true; offerId: string | null }
  | { ok: false; message: string; fieldErrors?: { title?: string; guests?: string; manualSlots?: string } };

const NOT_AVAILABLE = "This event type isn't available.";
const FIX = "Please fix the highlighted fields.";

const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/g;

/** Trimmed, whitespace collapsed, control characters removed; blank → null. Length is checked by the caller. */
export function normalizeOfferTitle(raw: string): string | null {
  const title = raw.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  return title || null;
}

const email = z.string().max(254).email();

/** Lowercased, valid, de-duplicated guest emails without the hosts' own; errors name the first problem. */
export function normalizeOfferGuests(raw: readonly string[], hostEmails: readonly string[]): { ok: true; guests: string[] } | { ok: false; error: string } {
  const hosts = new Set(hostEmails.map((e) => e.trim().toLowerCase()));
  const guests = new Set<string>();
  for (const value of raw) {
    const address = value.trim().toLowerCase();
    if (!address) continue;
    if (!email.safeParse(address).success) return { ok: false, error: `“${address.slice(0, 80)}” isn't a valid email address` };
    if (!hosts.has(address)) guests.add(address);
  }
  if (guests.size > MAX_OFFER_GUESTS) return { ok: false, error: `Add at most ${MAX_OFFER_GUESTS} attendees` };
  return { ok: true, guests: [...guests].sort() };
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

const byStart = (a: ManualSlot, b: ManualSlot) => a.start - b.start || a.duration - b.duration;

/**
 * Times added by hand, checked against the event type's durations: each start an ISO 8601
 * instant on a 5-minute boundary, in the future and at most MAX_MANUAL_SLOT_DAYS out; no
 * duplicates; at most MAX_OFFER_MANUAL_SLOTS. Sorted by start. Errors are plain words.
 */
export function normalizeManualSlots(
  raw: readonly ManualSlotInput[],
  durations: readonly number[],
  now: number,
): { ok: true; slots: ManualSlot[] } | { ok: false; error: string } {
  if (raw.length > MAX_OFFER_MANUAL_SLOTS) return { ok: false, error: `Add at most ${MAX_OFFER_MANUAL_SLOTS} times by hand` };
  const seen = new Set<string>();
  const slots: ManualSlot[] = [];
  for (const item of raw) {
    const start = typeof item.start === "string" && ISO_INSTANT.test(item.start.trim()) ? Date.parse(item.start.trim()) : Number.NaN;
    if (!Number.isFinite(start)) return { ok: false, error: "One of the times added by hand isn't a valid date and time" };
    if (start <= now) return { ok: false, error: "A time added by hand is in the past" };
    if (start % STEP_MS !== 0) return { ok: false, error: "Times added by hand must start on a 5-minute mark (like 10:05)" };
    if (start > now + MAX_MANUAL_SLOT_DAYS * DAY_MS) return { ok: false, error: `Times added by hand can be at most ${MAX_MANUAL_SLOT_DAYS} days ahead` };
    if (!durations.includes(item.duration)) return { ok: false, error: `${item.duration} minutes isn't a length this meeting type offers` };
    const key = `${start}|${item.duration}`;
    if (seen.has(key)) return { ok: false, error: "The same time was added by hand twice" };
    seen.add(key);
    slots.push({ start, duration: item.duration });
  }
  return { ok: true, slots: slots.toSorted(byStart) };
}

/**
 * Stable hash of an offer's content: same title, attendees and times added by hand (any order) →
 * same hash. Offers without times added by hand hash exactly as before they existed.
 */
export function offerContentHash(title: string | null, guests: readonly string[], manualSlots: readonly ManualSlot[] = [], manualHostId?: string | null): string {
  const content = manualSlots.length
    ? { title, guests: [...guests].sort(), manualSlots: manualSlots.toSorted(byStart).map((s) => [s.start, s.duration]), ...(manualHostId && { host: manualHostId }) }
    : { title, guests: [...guests].sort() };
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

/** The offer's time added by hand at exactly this start and duration, for the host it was saved for, if any. */
export function findManualSlot(
  offer: Pick<OfferView, "manualSlots" | "manualHostId"> | null | undefined,
  start: number,
  durationMin: number,
  hostId: string,
): ManualSlot | undefined {
  if (!offer?.manualHostId || offer.manualHostId !== hostId) return undefined;
  return offer.manualSlots.find((s) => s.start === start && s.duration === durationMin);
}

/**
 * The attendees of a booking made from an offer: the offer's guests, then the booker's, without
 * duplicates, the booker or any host.
 */
export function mergeOfferGuests(offerGuests: readonly string[], bookerGuests: readonly string[], exclude: readonly string[]): string[] {
  const skip = new Set(exclude.map((e) => e.toLowerCase()));
  return [...new Set([...offerGuests, ...bookerGuests].map((g) => g.toLowerCase()))].filter((g) => !skip.has(g));
}

type OfferEventType = {
  id: string;
  teamId: string | null;
  ownerUserId: string;
  seatsPerSlot: number | null;
  durationMinutes: number;
  schedulingType: "collective" | "round_robin" | "managed" | null;
};

/**
 * The event type, when `userId` may schedule for it: its owner for a personal event type, any
 * member of the owning team for a team event type (the same rule as /schedule). Null otherwise,
 * without revealing whether it exists.
 */
export async function schedulableEventType(db: DbOrTx, userId: string, eventTypeId: string): Promise<OfferEventType | null> {
  const [et] = await db
    .select({
      id: eventType.id,
      teamId: eventType.teamId,
      ownerUserId: eventType.ownerUserId,
      seatsPerSlot: eventType.seatsPerSlot,
      durationMinutes: eventType.durationMinutes,
      schedulingType: eventType.schedulingType,
    })
    .from(eventType)
    .where(eq(eventType.id, eventTypeId));
  if (!et) return null;
  if (et.teamId) return (await roleIn(db, userId, et.teamId)) ? et : null;
  return et.ownerUserId === userId ? et : null;
}

/** Emails of the people who host this event type (they are invited as hosts, never as guests). */
async function hostEmails(db: DbOrTx, et: OfferEventType): Promise<string[]> {
  const rows = et.teamId
    ? await db.select({ email: user.email }).from(eventTypeHost).innerJoin(user, eq(user.id, eventTypeHost.userId)).where(eq(eventTypeHost.eventTypeId, et.id))
    : await db.select({ email: user.email }).from(user).where(eq(user.id, et.ownerUserId));
  return rows.map((r) => r.email);
}

/** Every duration a booker may pick for this event type (default first). */
async function durationsFor(db: DbOrTx, et: OfferEventType): Promise<number[]> {
  const extra = await db.select({ d: eventTypeDurationOption.durationMinutes }).from(eventTypeDurationOption).where(eq(eventTypeDurationOption.eventTypeId, et.id));
  return [et.durationMinutes, ...extra.map((r) => r.d).filter((d) => d !== et.durationMinutes)];
}

/** Times added by hand need exactly one host (a personal event type, or a team one with a single host): that person's id, else null. */
async function singleHostId(db: DbOrTx, et: OfferEventType): Promise<string | null> {
  if (!et.teamId) return et.ownerUserId;
  if (et.schedulingType === "managed") return null;
  const rows = await db.select({ userId: eventTypeHost.userId }).from(eventTypeHost).where(eq(eventTypeHost.eventTypeId, et.id)).limit(2);
  return rows.length === 1 ? rows[0]!.userId : null;
}

/**
 * Saves (or reuses) the offer for this content. Returns `offerId: null` when there is nothing to
 * carry (no title, no attendees and no times added by hand): the plain links already book the
 * default meeting.
 */
export async function saveOffer(db: Database, userId: string, input: SaveOfferInput, now: number = Date.now()): Promise<SaveOfferResult> {
  const et = await schedulableEventType(db, userId, input.eventTypeId);
  if (!et) return { ok: false, message: NOT_AVAILABLE };
  const title = normalizeOfferTitle(input.title);
  if (title && title.length > MAX_OFFER_TITLE) {
    return { ok: false, message: FIX, fieldErrors: { title: `Keep the title under ${MAX_OFFER_TITLE} characters` } };
  }
  const guests = normalizeOfferGuests(input.guests, await hostEmails(db, et));
  if (!guests.ok) return { ok: false, message: FIX, fieldErrors: { guests: guests.error } };
  // Seated events share one booking per slot between bookers, so one link's title or people can't apply.
  if (et.seatsPerSlot && (title || guests.guests.length)) {
    return {
      ok: false,
      message: FIX,
      fieldErrors: {
        ...(title && { title: "Group events with seats can't have their own title" }),
        ...(guests.guests.length > 0 && { guests: "Group events with seats can't have preset attendees" }),
      },
    };
  }
  const rawSlots = input.manualSlots ?? [];
  let manualSlots: ManualSlot[] = [];
  let manualHostId: string | null = null;
  if (rawSlots.length) {
    if (et.seatsPerSlot) return { ok: false, message: FIX, fieldErrors: { manualSlots: "Group events with seats can't have times added by hand" } };
    manualHostId = await singleHostId(db, et);
    if (!manualHostId) {
      return { ok: false, message: FIX, fieldErrors: { manualSlots: "Times added by hand only work for meeting types with one host" } };
    }
    const checked = normalizeManualSlots(rawSlots, await durationsFor(db, et), now);
    if (!checked.ok) return { ok: false, message: FIX, fieldErrors: { manualSlots: checked.error } };
    manualSlots = checked.slots;
  }
  if (!title && !guests.guests.length && !manualSlots.length) return { ok: true, offerId: null };

  const contentHash = offerContentHash(title, guests.guests, manualSlots, manualHostId);
  const where = and(eq(schedulingOffer.createdBy, userId), eq(schedulingOffer.eventTypeId, et.id), eq(schedulingOffer.contentHash, contentHash));
  const [existing] = await db.select({ id: schedulingOffer.id }).from(schedulingOffer).where(where);
  if (existing) return { ok: true, offerId: existing.id };
  // 24 random bytes = 192 bits, 32 url-safe characters.
  await db
    .insert(schedulingOffer)
    .values({
      id: randomToken(24),
      eventTypeId: et.id,
      createdBy: userId,
      title,
      guests: guests.guests,
      manualSlots: manualSlots.map((s) => ({ start: new Date(s.start).toISOString(), duration: s.duration, hostId: manualHostId! })),
      contentHash,
    })
    .onConflictDoNothing();
  // A concurrent save of the same content may have won the insert: read back the single row.
  const [row] = await db.select({ id: schedulingOffer.id }).from(schedulingOffer).where(where);
  return { ok: true, offerId: row.id };
}

/** People the user can add as attendees: the owning team's members. Personal event types: none. */
export async function offerContacts(db: Database, userId: string, eventTypeId: string): Promise<{ name: string; email: string }[]> {
  const et = await schedulableEventType(db, userId, eventTypeId);
  if (!et?.teamId) return [];
  // The hosts are in the meeting already: not offered as people to invite.
  const hosts = new Set((await hostEmails(db, et)).map((e) => e.toLowerCase()));
  return (await membersOf(db, et.teamId))
    .map((m) => ({ name: memberLabel(m.name, m.email), email: m.email.toLowerCase() }))
    .filter((m) => !hosts.has(m.email));
}

/** Loads an offer inside any query context; null when unknown or saved for another event type. */
export async function loadOffer(db: DbOrTx, offerId: string, eventTypeId: string): Promise<OfferView | null> {
  if (!offerId || offerId.length > 64 || !OFFER_ID.test(offerId)) return null;
  const [row] = await db
    .select({
      id: schedulingOffer.id,
      title: schedulingOffer.title,
      guests: schedulingOffer.guests,
      manualSlots: schedulingOffer.manualSlots,
      eventTypeId: schedulingOffer.eventTypeId,
    })
    .from(schedulingOffer)
    .where(eq(schedulingOffer.id, offerId));
  if (!row || row.eventTypeId !== eventTypeId) return null;
  const stored = row.manualSlots ?? [];
  // All of an offer's times are saved for one host; anything else is not trusted.
  const hostIds = new Set(stored.map((s) => s.hostId ?? ""));
  const manualHostId = hostIds.size === 1 ? [...hostIds][0] || null : null;
  const manualSlots = manualHostId
    ? stored.map((s) => ({ start: Date.parse(s.start), duration: s.duration })).filter((s) => Number.isFinite(s.start) && Number.isInteger(s.duration) && s.duration > 0)
    : [];
  return { id: row.id, title: row.title, guests: row.guests, manualSlots, manualHostId };
}

export async function getOfferForEventType(db: Database, offerId: string, eventTypeId: string): Promise<OfferView | null> {
  return loadOffer(db, offerId, eventTypeId);
}

/** The title a link's `offer` sets for this event type, for the booking page's browser tab; null without one. */
export async function offerTitleFromQuery(db: Database, query: Record<string, string | string[] | undefined>, eventTypeId: string): Promise<string | null> {
  const raw = Array.isArray(query.offer) ? query.offer[0] : query.offer;
  if (!raw) return null;
  return (await loadOffer(db, raw, eventTypeId))?.title ?? null;
}
