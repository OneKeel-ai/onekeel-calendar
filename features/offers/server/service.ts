import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database, DbOrTx } from "@/db/client";
import { eventType, eventTypeHost, schedulingOffer, user } from "@/db/schema";
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

export type OfferView = { id: string; title: string | null; guests: string[] };

export type SaveOfferInput = { eventTypeId: string; title: string; guests: string[] };

export type SaveOfferResult =
  | { ok: true; offerId: string | null }
  | { ok: false; message: string; fieldErrors?: { title?: string; guests?: string } };

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

/** Stable hash of an offer's content: same title and attendees (any order) → same hash. */
export function offerContentHash(title: string | null, guests: readonly string[]): string {
  return createHash("sha256")
    .update(JSON.stringify({ title, guests: [...guests].sort() }))
    .digest("hex");
}

/**
 * The attendees of a booking made from an offer: the offer's guests, then the booker's, without
 * duplicates, the booker or any host.
 */
export function mergeOfferGuests(offerGuests: readonly string[], bookerGuests: readonly string[], exclude: readonly string[]): string[] {
  const skip = new Set(exclude.map((e) => e.toLowerCase()));
  return [...new Set([...offerGuests, ...bookerGuests].map((g) => g.toLowerCase()))].filter((g) => !skip.has(g));
}

type OfferEventType = { id: string; teamId: string | null; ownerUserId: string; seatsPerSlot: number | null };

/**
 * The event type, when `userId` may schedule for it: its owner for a personal event type, any
 * member of the owning team for a team event type (the same rule as /schedule). Null otherwise,
 * without revealing whether it exists.
 */
export async function schedulableEventType(db: DbOrTx, userId: string, eventTypeId: string): Promise<OfferEventType | null> {
  const [et] = await db
    .select({ id: eventType.id, teamId: eventType.teamId, ownerUserId: eventType.ownerUserId, seatsPerSlot: eventType.seatsPerSlot })
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

/**
 * Saves (or reuses) the offer for this content. Returns `offerId: null` when there is nothing to
 * carry (no title and no attendees): the plain links already book the default meeting.
 */
export async function saveOffer(db: Database, userId: string, input: SaveOfferInput): Promise<SaveOfferResult> {
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
  if (!title && !guests.guests.length) return { ok: true, offerId: null };

  const contentHash = offerContentHash(title, guests.guests);
  const where = and(eq(schedulingOffer.createdBy, userId), eq(schedulingOffer.eventTypeId, et.id), eq(schedulingOffer.contentHash, contentHash));
  const [existing] = await db.select({ id: schedulingOffer.id }).from(schedulingOffer).where(where);
  if (existing) return { ok: true, offerId: existing.id };
  // 24 random bytes = 192 bits, 32 url-safe characters.
  await db
    .insert(schedulingOffer)
    .values({ id: randomToken(24), eventTypeId: et.id, createdBy: userId, title, guests: guests.guests, contentHash })
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
    .select({ id: schedulingOffer.id, title: schedulingOffer.title, guests: schedulingOffer.guests, eventTypeId: schedulingOffer.eventTypeId })
    .from(schedulingOffer)
    .where(eq(schedulingOffer.id, offerId));
  if (!row || row.eventTypeId !== eventTypeId) return null;
  return { id: row.id, title: row.title, guests: row.guests };
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
